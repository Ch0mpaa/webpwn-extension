package coach;

import burp.api.montoya.MontoyaApi;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/** Fire-and-forget POST to the local WebPwn Coach bridge. */
final class BridgeClient {
    private static final HttpClient CLIENT =
        HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();

    static int port() {
        String p = System.getenv("WEBPWN_BRIDGE_PORT");
        try { return p != null ? Integer.parseInt(p.trim()) : 8088; } catch (Exception e) { return 8088; }
    }

    static void post(MontoyaApi api, String json) {
        HttpRequest req = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port() + "/traffic"))
            .timeout(Duration.ofSeconds(5))
            .header("content-type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .build();
        CLIENT.sendAsync(req, HttpResponse.BodyHandlers.ofString())
            .thenAccept(r -> api.logging().logToOutput("WebPwn Coach: sent (HTTP " + r.statusCode() + ") " + r.body()))
            .exceptionally(t -> {
                api.logging().logToError("WebPwn Coach: bridge not reachable on 127.0.0.1:" + port()
                    + " — start companion/bridge.js. " + t.getMessage());
                return null;
            });
    }
}
