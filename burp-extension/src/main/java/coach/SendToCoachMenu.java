package coach;

import burp.api.montoya.MontoyaApi;
import burp.api.montoya.http.message.HttpHeader;
import burp.api.montoya.http.message.HttpRequestResponse;
import burp.api.montoya.http.message.params.HttpParameterType;
import burp.api.montoya.http.message.params.ParsedHttpParameter;
import burp.api.montoya.http.message.requests.HttpRequest;
import burp.api.montoya.http.message.responses.HttpResponse;
import burp.api.montoya.ui.contextmenu.ContextMenuEvent;
import burp.api.montoya.ui.contextmenu.ContextMenuItemsProvider;

import javax.swing.JMenuItem;
import java.awt.Component;
import java.util.ArrayList;
import java.util.List;

/** Adds "Send to WebPwn Coach" (redacted / raw-local) to Burp context menus. */
class SendToCoachMenu implements ContextMenuItemsProvider {
    private static final int BODY_PREVIEW = 4096;
    private final MontoyaApi api;

    SendToCoachMenu(MontoyaApi api) { this.api = api; }

    @Override
    public List<Component> provideMenuItems(ContextMenuEvent event) {
        List<HttpRequestResponse> items = collect(event);
        if (items.isEmpty()) return List.of();
        String tool = event.messageEditorRequestResponse().isPresent() ? "Repeater/Editor" : "Proxy/History";

        JMenuItem redacted = new JMenuItem("Send to WebPwn Coach (redacted)");
        redacted.addActionListener(e -> send(items, tool, true));
        JMenuItem raw = new JMenuItem("Send to WebPwn Coach (raw, local)");
        raw.addActionListener(e -> send(items, tool, false));
        return List.of(redacted, raw);
    }

    private List<HttpRequestResponse> collect(ContextMenuEvent event) {
        List<HttpRequestResponse> items = new ArrayList<>(event.selectedRequestResponses());
        if (items.isEmpty()) {
            event.messageEditorRequestResponse().ifPresent(m -> items.add(m.requestResponse()));
        }
        return items;
    }

    private void send(List<HttpRequestResponse> items, String tool, boolean redact) {
        int n = 0;
        for (HttpRequestResponse rr : items) {
            if (rr == null || rr.request() == null) continue;
            BridgeClient.post(api, buildJson(rr, tool, redact));
            n++;
        }
        api.logging().logToOutput("WebPwn Coach: sending " + n + " item(s) " + (redact ? "(redacted)" : "(raw, local)"));
    }

    private String buildJson(HttpRequestResponse rr, String tool, boolean redact) {
        HttpRequest req = rr.request();
        HttpResponse resp = rr.response();

        StringBuilder b = new StringBuilder();
        b.append('{');
        field(b, "tool", tool).append(',');
        field(b, "method", req.method()).append(',');
        field(b, "url", req.url()).append(',');
        field(b, "path", safe(req::path)).append(',');

        // query params
        b.append("\"query\":[");
        boolean first = true;
        try {
            for (ParsedHttpParameter p : req.parameters()) {
                if (p.type() != HttpParameterType.URL) continue;
                if (!first) b.append(',');
                first = false;
                b.append('{');
                field(b, "name", p.name()).append(',');
                field(b, "value", redact ? Redactor.scrub(p.value()) : p.value());
                b.append('}');
            }
        } catch (Exception ignored) {}
        b.append("],");

        // request headers
        b.append("\"reqHeaders\":{");
        first = true;
        for (HttpHeader h : req.headers()) {
            if (!first) b.append(',');
            first = false;
            String v = redact ? Redactor.headerValue(h.name(), h.value()) : h.value();
            b.append(str(h.name())).append(':').append(str(v));
        }
        b.append("},");

        String reqBody = safe(req::bodyToString);
        field(b, "reqBody", redact ? Redactor.scrub(reqBody) : reqBody).append(',');

        // response
        if (resp != null) {
            b.append("\"status\":").append((int) resp.statusCode()).append(',');
            b.append("\"respHeaders\":{");
            first = true;
            for (HttpHeader h : resp.headers()) {
                if (!first) b.append(',');
                first = false;
                String v = redact ? Redactor.headerValue(h.name(), h.value()) : h.value();
                b.append(str(h.name())).append(':').append(str(v));
            }
            b.append("},");
            String respBody = preview(safe(resp::bodyToString));
            field(b, "respBody", redact ? Redactor.scrub(respBody) : respBody).append(',');
        }

        // raw (local-only) — only in raw mode
        if (!redact) {
            field(b, "raw", rawDump(req));
        } else {
            field(b, "redacted", "true");
        }
        b.append('}');
        return b.toString();
    }

    private static String rawDump(HttpRequest req) {
        StringBuilder r = new StringBuilder();
        r.append(req.method()).append(' ').append(safe(req::path)).append(" HTTP/1.1\n");
        for (HttpHeader h : req.headers()) r.append(h.name()).append(": ").append(h.value()).append('\n');
        r.append('\n').append(safe(req::bodyToString));
        return r.toString();
    }

    private static String preview(String s) {
        if (s == null) return "";
        return s.length() > BODY_PREVIEW ? s.substring(0, BODY_PREVIEW) + "\n…[truncated]" : s;
    }

    // ---- tiny JSON helpers -----------------------------------------------------
    private static StringBuilder field(StringBuilder b, String k, String v) {
        return b.append(str(k)).append(':').append(str(v));
    }
    private static String str(String s) {
        if (s == null) return "\"\"";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }
    private interface Str { String get(); }
    private static String safe(Str s) { try { String v = s.get(); return v == null ? "" : v; } catch (Exception e) { return ""; } }
}
