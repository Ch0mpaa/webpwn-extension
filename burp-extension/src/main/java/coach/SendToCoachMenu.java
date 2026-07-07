package coach;

import burp.api.montoya.MontoyaApi;
import burp.api.montoya.http.message.HttpRequestResponse;
import burp.api.montoya.ui.contextmenu.ContextMenuEvent;
import burp.api.montoya.ui.contextmenu.ContextMenuItemsProvider;

import javax.swing.JMenuItem;
import java.awt.Component;
import java.util.ArrayList;
import java.util.List;

/**
 * "Send to WebPwn Coach" context menu. Registered unconditionally; bridge health is
 * only checked at send time. If nothing is selected it falls back to the latest proxy
 * request, so the menu is never a dead end. Also caches the selection so the WebPwn
 * Coach tab's "Send selected" button works.
 */
class SendToCoachMenu implements ContextMenuItemsProvider {
    private final MontoyaApi api;
    private final CoachState state;

    SendToCoachMenu(MontoyaApi api, CoachState state) { this.api = api; this.state = state; }

    @Override
    public List<Component> provideMenuItems(ContextMenuEvent event) {
        try {
            List<HttpRequestResponse> items = collect(event);
            String tool = event.messageEditorRequestResponse().isPresent() ? "Repeater/Editor" : "Proxy/History";

            // Cache selection for the tab's "Send selected" button.
            if (!items.isEmpty() && items.get(0) != null && items.get(0).request() != null) {
                state.selectedRequest = items.get(0).request();
                state.selectedResponse = items.get(0).response();
                state.selectedTool = tool;
            }
            api.logging().logToOutput("WebPwn Coach: context menu — " + items.size() + " selected message(s), tool=" + tool);

            JMenuItem redacted = new JMenuItem("Send to WebPwn Coach (redacted)");
            redacted.addActionListener(e -> sendOrLatest(items, tool, true));
            JMenuItem raw = new JMenuItem("Send to WebPwn Coach (raw, local)");
            raw.addActionListener(e -> sendOrLatest(items, tool, false));
            JMenuItem copy = new JMenuItem("Copy as WebPwn JSON");
            copy.addActionListener(e -> copyJson(items, tool));
            return List.of(redacted, raw, copy);
        } catch (Exception ex) {
            // Never let an exception hide the menu.
            api.logging().logToError("WebPwn Coach: provideMenuItems failed\n" + BridgeClient.stack(ex));
            JMenuItem fallback = new JMenuItem("Send latest proxy request to WebPwn Coach");
            fallback.addActionListener(e -> Actions.sendLatestProxy(api, state, true));
            return List.of(fallback);
        }
    }

    private List<HttpRequestResponse> collect(ContextMenuEvent event) {
        List<HttpRequestResponse> items = new ArrayList<>();
        try { items.addAll(event.selectedRequestResponses()); } catch (Exception ignored) {}
        if (items.isEmpty()) {
            try { event.messageEditorRequestResponse().ifPresent(m -> items.add(m.requestResponse())); } catch (Exception ignored) {}
        }
        return items;
    }

    private void sendOrLatest(List<HttpRequestResponse> items, String tool, boolean redact) {
        if (items.isEmpty()) { Actions.sendLatestProxy(api, state, redact); return; }
        int n = 0;
        for (HttpRequestResponse rr : items) {
            if (rr == null || rr.request() == null) continue;
            BridgeClient.post(api, state, tool + (redact ? " (redacted)" : " (raw)"),
                TrafficJson.build(rr.request(), rr.response(), tool, redact));
            n++;
        }
        api.logging().logToOutput("WebPwn Coach: sent " + n + " item(s) " + (redact ? "(redacted)" : "(raw)"));
    }

    private void copyJson(List<HttpRequestResponse> items, String tool) {
        HttpRequestResponse rr = items.isEmpty() ? null : items.get(0);
        if (rr == null || rr.request() == null) { Actions.copyLatestProxy(api, state); return; }
        Actions.copyToClipboard(api, TrafficJson.build(rr.request(), rr.response(), tool, true));
    }
}
