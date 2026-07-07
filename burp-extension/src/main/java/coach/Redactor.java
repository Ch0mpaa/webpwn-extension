package coach;

import java.util.regex.Pattern;

/** Strips sensitive values before anything leaves Burp (redacted mode). */
final class Redactor {
    private static final Pattern JWT =
        Pattern.compile("eyJ[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{6,}");
    private static final Pattern APIKEY =
        Pattern.compile("\\b(sk|pk|api|key|ghp|xox[baprs])[-_][A-Za-z0-9]{16,}", Pattern.CASE_INSENSITIVE);
    private static final Pattern PASS =
        Pattern.compile("(\"?password\"?\\s*[:=]\\s*)(\"?)[^\"'&\\s,}]+\\2", Pattern.CASE_INSENSITIVE);

    static boolean sensitiveHeader(String name) {
        String n = name == null ? "" : name.toLowerCase();
        return n.equals("authorization") || n.equals("cookie") || n.equals("set-cookie")
            || n.equals("x-api-key") || n.equals("proxy-authorization");
    }

    static String headerValue(String name, String value) {
        return sensitiveHeader(name) ? "[REDACTED]" : scrub(value);
    }

    static String scrub(String s) {
        if (s == null) return "";
        s = JWT.matcher(s).replaceAll("[REDACTED_JWT]");
        s = APIKEY.matcher(s).replaceAll("[REDACTED_KEY]");
        s = PASS.matcher(s).replaceAll("$1[REDACTED]");
        return s;
    }
}
