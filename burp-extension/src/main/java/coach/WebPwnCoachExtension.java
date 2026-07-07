package coach;

import burp.api.montoya.BurpExtension;
import burp.api.montoya.MontoyaApi;

/**
 * WebPwn Coach Bridge — a Burp Montoya extension.
 *
 * It does ONE thing: adds a "Send to WebPwn Coach" context-menu action that POSTs
 * the selected request/response to the local WebPwn Coach bridge
 * (http://127.0.0.1:8088/traffic) so the Chrome extension can explain your thinking.
 *
 * It is NOT a proxy, Repeater, or Intruder. It never intercepts or modifies traffic.
 * Burp does the testing; WebPwn Coach explains the reasoning.
 */
public class WebPwnCoachExtension implements BurpExtension {
    @Override
    public void initialize(MontoyaApi api) {
        api.extension().setName("WebPwn Coach Bridge");
        api.userInterface().registerContextMenuItemsProvider(new SendToCoachMenu(api));
        api.logging().logToOutput(
            "WebPwn Coach Bridge loaded.\n" +
            "Right-click a request in Proxy / HTTP history / Repeater → 'Send to WebPwn Coach'.\n" +
            "Posting to http://127.0.0.1:" + BridgeClient.port() + "/traffic " +
            "(override with env WEBPWN_BRIDGE_PORT). Start companion/bridge.js first.");
    }
}
