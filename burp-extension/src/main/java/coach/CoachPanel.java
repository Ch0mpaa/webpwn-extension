package coach;

import burp.api.montoya.MontoyaApi;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JTextField;
import javax.swing.SwingUtilities;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;

/** The "WebPwn Coach" Burp suite tab — a bridge-independent way to send traffic. */
class CoachPanel extends JPanel {
    private final MontoyaApi api;
    private final CoachState state;
    private final JLabel healthLbl = new JLabel();
    private final JLabel sentLbl = new JLabel();
    private final JLabel countLbl = new JLabel();
    private final JLabel errLbl = new JLabel();
    private final JLabel selLbl = new JLabel();
    private final JTextField bridgeField = new JTextField();
    private final JButton sendSelectedBtn = new JButton("Send selected request");

    CoachPanel(MontoyaApi api, CoachState state) {
        this.api = api;
        this.state = state;
        setLayout(new BoxLayout(this, BoxLayout.Y_AXIS));
        setBorder(BorderFactory.createEmptyBorder(14, 14, 14, 14));

        add(title("WebPwn Coach — Traffic Bridge"));
        add(hint("Burp does the testing. This tab sends a selected/latest request to the WebPwn Coach "
            + "Chrome extension so ATLAS can explain your thinking. It is not a proxy and never modifies traffic."));
        add(gap(8));
        add(kv("Extension:", new JLabel("● loaded")));

        JPanel bridgeRow = row();
        bridgeField.setText(state.bridgeUrl);
        bridgeField.setMaximumSize(new Dimension(320, 26));
        bridgeField.setPreferredSize(new Dimension(320, 26));
        JButton saveBridge = new JButton("Save");
        saveBridge.addActionListener(e -> { state.bridgeUrl = bridgeField.getText().trim(); refresh(); });
        bridgeRow.add(new JLabel("Bridge URL: "));
        bridgeRow.add(bridgeField);
        bridgeRow.add(saveBridge);
        add(bridgeRow);

        add(kv("Bridge health:", healthLbl));
        add(kv("Last sent:", sentLbl));
        add(kv("Send count:", countLbl));
        add(kv("Last error:", errLbl));
        add(kv("Selection:", selLbl));
        add(gap(10));

        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEFT, 8, 6));
        buttons.setAlignmentX(Component.LEFT_ALIGNMENT);
        JButton test = new JButton("Test Bridge");
        test.addActionListener(e -> BridgeClient.health(api, state, s -> { healthLbl.setText(s); refresh(); }));
        JButton latest = new JButton("Send latest proxy request");
        latest.addActionListener(e -> { Actions.sendLatestProxy(api, state, true); refreshSoon(); });
        JButton latestRaw = new JButton("Send latest (raw, local)");
        latestRaw.addActionListener(e -> { Actions.sendLatestProxy(api, state, false); refreshSoon(); });
        sendSelectedBtn.addActionListener(e -> { Actions.sendSelected(api, state, true); refreshSoon(); });
        JButton copyLatest = new JButton("Copy latest as WebPwn JSON");
        copyLatest.addActionListener(e -> { Actions.copyLatestProxy(api, state); refreshSoon(); });
        JButton refresh = new JButton("Refresh");
        refresh.addActionListener(e -> refresh());
        buttons.add(test); buttons.add(latest); buttons.add(latestRaw);
        buttons.add(sendSelectedBtn); buttons.add(copyLatest); buttons.add(refresh);
        add(buttons);

        add(gap(8));
        add(hint("“Copy as WebPwn JSON” fallback: if the bridge is down, paste the clipboard JSON into the "
            + "Chrome extension → Traffic tab → “Or import manually”. Analyze with ATLAS is always a manual click."));

        refresh();
        // Kick an initial health check so the tab shows connectivity immediately.
        BridgeClient.health(api, state, s -> { healthLbl.setText(s); refresh(); });
    }

    private void refreshSoon() { SwingUtilities.invokeLater(() -> { try { Thread.sleep(150); } catch (Exception ignored) {} refresh(); }); }

    void refresh() {
        healthLbl.setText(state.lastHealth);
        sentLbl.setText(state.lastSent);
        countLbl.setText(String.valueOf(state.sendCount.get()));
        errLbl.setText(state.lastError);
        bridgeField.setText(state.bridgeUrl);
        boolean sel = state.hasSelection();
        selLbl.setText(sel ? ("captured: " + state.selectedTool) : "none captured yet — right-click a request once");
        sendSelectedBtn.setEnabled(sel);
        sendSelectedBtn.setToolTipText(sel ? "Send the last right-clicked request"
            : "Right-click any request and pick a Send/Copy item once; then this enables.");
    }

    // ---- little layout helpers -------------------------------------------------
    private static JComponentRow row() { return new JComponentRow(); }
    private JPanel kv(String k, JLabel v) {
        JPanel p = row();
        JLabel key = new JLabel(k);
        key.setPreferredSize(new Dimension(110, 20));
        p.add(key); p.add(v);
        return p;
    }
    private JLabel title(String t) { JLabel l = new JLabel(t); l.setFont(l.getFont().deriveFont(Font.BOLD, 15f)); l.setAlignmentX(Component.LEFT_ALIGNMENT); return l; }
    private JLabel hint(String t) { JLabel l = new JLabel("<html><div style='width:520px;color:#888'>" + t + "</div></html>"); l.setAlignmentX(Component.LEFT_ALIGNMENT); return l; }
    private Component gap(int h) { return Box.createVerticalStrut(h); }

    /** A left-aligned FlowLayout row that plays nicely in a BoxLayout column. */
    static class JComponentRow extends JPanel {
        JComponentRow() { super(new FlowLayout(FlowLayout.LEFT, 6, 2)); setAlignmentX(Component.LEFT_ALIGNMENT); setMaximumSize(new Dimension(Integer.MAX_VALUE, 30)); }
    }
}
