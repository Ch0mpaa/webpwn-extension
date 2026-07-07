package coach;

import burp.api.montoya.http.message.HttpHeader;
import burp.api.montoya.http.message.params.HttpParameterType;
import burp.api.montoya.http.message.params.ParsedHttpParameter;
import burp.api.montoya.http.message.requests.HttpRequest;
import burp.api.montoya.http.message.responses.HttpResponse;

/** Builds the normalized "WebPwn traffic JSON" the bridge / Chrome extension understand. */
final class TrafficJson {
    private static final int BODY_PREVIEW = 4096;

    static String build(HttpRequest req, HttpResponse resp, String tool, boolean redact) {
        StringBuilder b = new StringBuilder();
        b.append('{');
        field(b, "tool", tool).append(',');
        field(b, "method", safe(req::method)).append(',');
        field(b, "url", safe(req::url)).append(',');
        field(b, "path", safe(req::path)).append(',');

        b.append("\"query\":[");
        boolean first = true;
        try {
            for (ParsedHttpParameter p : req.parameters()) {
                if (p.type() != HttpParameterType.URL) continue;
                if (!first) b.append(','); first = false;
                b.append('{');
                field(b, "name", p.name()).append(',');
                field(b, "value", redact ? Redactor.scrub(p.value()) : p.value());
                b.append('}');
            }
        } catch (Exception ignored) {}
        b.append("],");

        b.append("\"reqHeaders\":{");
        first = true;
        for (HttpHeader h : req.headers()) {
            if (!first) b.append(','); first = false;
            String v = redact ? Redactor.headerValue(h.name(), h.value()) : h.value();
            b.append(str(h.name())).append(':').append(str(v));
        }
        b.append("},");

        String reqBody = safe(req::bodyToString);
        field(b, "reqBody", redact ? Redactor.scrub(reqBody) : reqBody).append(',');

        if (resp != null) {
            b.append("\"status\":").append((int) resp.statusCode()).append(',');
            b.append("\"respHeaders\":{");
            first = true;
            for (HttpHeader h : resp.headers()) {
                if (!first) b.append(','); first = false;
                String v = redact ? Redactor.headerValue(h.name(), h.value()) : h.value();
                b.append(str(h.name())).append(':').append(str(v));
            }
            b.append("},");
            String respBody = preview(safe(resp::bodyToString));
            field(b, "respBody", redact ? Redactor.scrub(respBody) : respBody).append(',');
        }

        if (!redact) field(b, "raw", rawDump(req));
        else field(b, "redacted", "true");
        b.append('}');
        return b.toString();
    }

    private static String rawDump(HttpRequest req) {
        StringBuilder r = new StringBuilder();
        r.append(safe(req::method)).append(' ').append(safe(req::path)).append(" HTTP/1.1\n");
        for (HttpHeader h : req.headers()) r.append(h.name()).append(": ").append(h.value()).append('\n');
        r.append('\n').append(safe(req::bodyToString));
        return r.toString();
    }

    private static String preview(String s) {
        if (s == null) return "";
        return s.length() > BODY_PREVIEW ? s.substring(0, BODY_PREVIEW) + "\n…[truncated]" : s;
    }

    private static StringBuilder field(StringBuilder b, String k, String v) {
        return b.append(str(k)).append(':').append(str(v));
    }
    static String str(String s) {
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
                default: if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
            }
        }
        return b.append('"').toString();
    }
    private interface Str { String get(); }
    static String safe(Str s) { try { String v = s.get(); return v == null ? "" : v; } catch (Exception e) { return ""; } }
}
