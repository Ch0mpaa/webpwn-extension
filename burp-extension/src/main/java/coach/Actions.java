package coach;

import burp.api.montoya.MontoyaApi;
import burp.api.montoya.proxy.ProxyHttpRequestResponse;

import java.awt.Toolkit;
import java.awt.datatransfer.StringSelection;
import java.util.List;

/** Actions shared by the context menu and the WebPwn Coach tab. */
final class Actions {

    /** Send the most recent Proxy/HTTP-history request to the bridge. */
    static void sendLatestProxy(MontoyaApi api, CoachState state, boolean redact) {
        try {
            List<ProxyHttpRequestResponse> hist = api.proxy().history();
            api.logging().logToOutput("WebPwn Coach: proxy history size = " + hist.size());
            if (hist.isEmpty()) {
                state.lastError = "Proxy history is empty — route Chrome through Burp and load a page first.";
                api.logging().logToError("WebPwn Coach: " + state.lastError);
                return;
            }
            ProxyHttpRequestResponse last = hist.get(hist.size() - 1);
            api.logging().logToOutput("WebPwn Coach: latest proxy request = "
                + safe(last.request() == null ? null : last.request().method()) + " "
                + safe(last.request() == null ? null : last.request().url()));
            String json = TrafficJson.build(last.request(), last.response(), "Proxy/History", redact);
            BridgeClient.post(api, state, "latest proxy" + (redact ? " (redacted)" : " (raw)"), json);
        } catch (Exception e) {
            state.lastError = "sendLatestProxy failed: " + e.getMessage();
            api.logging().logToError("WebPwn Coach: sendLatestProxy failed\n" + BridgeClient.stack(e));
        }
    }

    /** Send the last request captured from a context-menu selection. */
    static void sendSelected(MontoyaApi api, CoachState state, boolean redact) {
        if (!state.hasSelection()) {
            state.lastError = "No selection captured. Right-click a request once (any Send/Copy item), then use this button.";
            api.logging().logToError("WebPwn Coach: " + state.lastError);
            return;
        }
        String json = TrafficJson.build(state.selectedRequest, state.selectedResponse,
            state.selectedTool == null || state.selectedTool.isEmpty() ? "Selection" : state.selectedTool, redact);
        BridgeClient.post(api, state, "selected" + (redact ? " (redacted)" : " (raw)"), json);
    }

    static void copyLatestProxy(MontoyaApi api, CoachState state) {
        try {
            List<ProxyHttpRequestResponse> hist = api.proxy().history();
            if (hist.isEmpty()) { state.lastError = "Proxy history empty — nothing to copy."; return; }
            ProxyHttpRequestResponse last = hist.get(hist.size() - 1);
            copyToClipboard(api, TrafficJson.build(last.request(), last.response(), "Proxy/History", true));
        } catch (Exception e) {
            api.logging().logToError("WebPwn Coach: copyLatestProxy failed\n" + BridgeClient.stack(e));
        }
    }

    static void copyToClipboard(MontoyaApi api, String json) {
        try {
            Toolkit.getDefaultToolkit().getSystemClipboard().setContents(new StringSelection(json), null);
            api.logging().logToOutput("WebPwn Coach: copied WebPwn JSON to clipboard (" + json.length() + " bytes). "
                + "Paste it into the Chrome extension's Traffic tab → 'Or import manually'.");
        } catch (Exception e) {
            api.logging().logToError("WebPwn Coach: clipboard copy failed\n" + BridgeClient.stack(e));
        }
    }

    private static String safe(String s) { return s == null ? "" : s; }
}
