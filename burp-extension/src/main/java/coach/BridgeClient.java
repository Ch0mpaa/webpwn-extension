package coach;

import burp.api.montoya.MontoyaApi;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.function.Consumer;

/** POST/GET helpers to the local WebPwn Coach bridge, with loud logging + state updates. */
final class BridgeClient {
    private static final HttpClient CLIENT =
        HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();

    static int port() {
        String p = System.getenv("WEBPWN_BRIDGE_PORT");
        try { return p != null ? Integer.parseInt(p.trim()) : 8088; } catch (Exception e) { return 8088; }
    }

    /** Fire-and-forget POST /traffic. Updates counters + last error on the state. */
    static void post(MontoyaApi api, CoachState state, String label, String json) {
        String url = state.bridgeUrl.replaceAll("/+$", "") + "/traffic";
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(5))
                .header("content-type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
            api.logging().logToOutput("WebPwn Coach: POST " + url + "  (" + label + ", " + json.length() + " bytes)");
            CLIENT.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                .thenAccept(r -> {
                    state.sendCount.incrementAndGet();
                    state.lastSent = label + " → HTTP " + r.statusCode() + " " + trim(r.body(), 120);
                    api.logging().logToOutput("WebPwn Coach: sent OK — " + state.lastSent);
                })
                .exceptionally(t -> {
                    state.lastError = "POST failed: " + rootMessage(t);
                    api.logging().logToError("WebPwn Coach: POST failed to " + url + "\n" + stack(t));
                    return null;
                });
        } catch (Exception e) {
            state.lastError = "POST setup failed: " + e.getMessage();
            api.logging().logToError("WebPwn Coach: POST setup failed\n" + stack(e));
        }
    }

    /** GET /health, calling back with a human string on the Swing thread. */
    static void health(MontoyaApi api, CoachState state, Consumer<String> cb) {
        String url = state.bridgeUrl.replaceAll("/+$", "") + "/health";
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(3)).GET().build();
            api.logging().logToOutput("WebPwn Coach: health check " + url);
            CLIENT.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                .thenAccept(r -> {
                    String s = "● reachable (HTTP " + r.statusCode() + ") " + trim(r.body(), 160);
                    state.lastHealth = s;
                    api.logging().logToOutput("WebPwn Coach: health — " + s);
                    javax.swing.SwingUtilities.invokeLater(() -> cb.accept(s));
                })
                .exceptionally(t -> {
                    String s = "● NOT reachable at " + url + " — start companion/bridge.js (" + rootMessage(t) + ")";
                    state.lastHealth = s; state.lastError = s;
                    api.logging().logToError("WebPwn Coach: health failed\n" + stack(t));
                    javax.swing.SwingUtilities.invokeLater(() -> cb.accept(s));
                    return null;
                });
        } catch (Exception e) {
            String s = "● health error: " + e.getMessage();
            state.lastHealth = s;
            javax.swing.SwingUtilities.invokeLater(() -> cb.accept(s));
        }
    }

    private static String trim(String s, int n) { if (s == null) return ""; s = s.replaceAll("\\s+", " "); return s.length() > n ? s.substring(0, n) + "…" : s; }
    private static String rootMessage(Throwable t) { Throwable c = t; while (c.getCause() != null) c = c.getCause(); return c.getClass().getSimpleName() + ": " + c.getMessage(); }
    static String stack(Throwable t) { java.io.StringWriter w = new java.io.StringWriter(); t.printStackTrace(new java.io.PrintWriter(w)); return w.toString(); }
}
