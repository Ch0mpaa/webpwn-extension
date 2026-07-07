package coach;

import burp.api.montoya.BurpExtension;
import burp.api.montoya.MontoyaApi;

/**
 * WebPwn Coach Bridge — a Burp Montoya extension.
 *
 * Sends a selected/latest request to the local WebPwn Coach bridge so the Chrome
 * extension can explain your thinking. It is NOT a proxy, Repeater, or Intruder, and it
 * never intercepts or modifies traffic. Burp tests; WebPwn Coach explains.
 *
 * Two paths, so a missing context menu is never a dead end:
 *   1. Right-click → "Send to WebPwn Coach"
 *   2. The "WebPwn Coach" suite tab → "Send latest proxy request" / "Copy as WebPwn JSON"
 */
public class WebPwnCoachExtension implements BurpExtension {
    @Override
    public void initialize(MontoyaApi api) {
        api.extension().setName("WebPwn Coach Bridge");
        api.logging().logToOutput("WebPwn Coach: loaded. Bridge default http://127.0.0.1:"
            + BridgeClient.port() + " (override with env WEBPWN_BRIDGE_PORT).");

        CoachState state = new CoachState();

        // Context menu — registered UNCONDITIONALLY; bridge is only contacted on send.
        try {
            api.userInterface().registerContextMenuItemsProvider(new SendToCoachMenu(api, state));
            api.logging().logToOutput("WebPwn Coach: context menu registered.");
        } catch (Throwable t) {
            api.logging().logToError("WebPwn Coach: context menu registration FAILED\n" + BridgeClient.stack(t));
        }

        // Suite tab — the fallback path that does not depend on the context menu.
        try {
            api.userInterface().registerSuiteTab("WebPwn Coach", new CoachPanel(api, state));
            api.logging().logToOutput("WebPwn Coach: tab registered.");
        } catch (Throwable t) {
            api.logging().logToError("WebPwn Coach: tab registration FAILED\n" + BridgeClient.stack(t));
        }

        api.logging().logToOutput("WebPwn Coach: ready. Right-click a request, or use the 'WebPwn Coach' tab → 'Send latest proxy request'.");
    }
}
