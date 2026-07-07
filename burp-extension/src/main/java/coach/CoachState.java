package coach;

import burp.api.montoya.http.message.requests.HttpRequest;
import burp.api.montoya.http.message.responses.HttpResponse;

import java.util.concurrent.atomic.AtomicInteger;

/** Shared, mutable state surfaced in the WebPwn Coach Burp tab. */
final class CoachState {
    volatile String bridgeUrl = "http://127.0.0.1:" + BridgeClient.port();
    final AtomicInteger sendCount = new AtomicInteger(0);
    volatile String lastError = "(none)";
    volatile String lastSent = "(none yet)";
    volatile String lastHealth = "(not checked)";

    // Last selection captured from the context menu (so the tab's "Send selected" works).
    volatile HttpRequest selectedRequest;
    volatile HttpResponse selectedResponse;
    volatile String selectedTool = "";

    boolean hasSelection() { return selectedRequest != null; }
}
