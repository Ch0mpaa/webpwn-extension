# WebPwn Coach — Burp extension (Montoya)

The **preferred** way to get Burp/Caido traffic into WebPwn Coach. It adds a
**"Send to WebPwn Coach"** right-click action that POSTs the selected request/response to
the local bridge (`http://127.0.0.1:8088/traffic`).

It is **not** a proxy, Repeater, or Intruder, and it never intercepts or modifies traffic.
**Burp does the testing; WebPwn Coach explains the thinking.**

## Build

Requires JDK 17+ (the JAR is compiled against Montoya API `2025.12`, provided by Burp at
runtime).

```bash
cd burp-extension
gradle jar          # → build/libs/webpwn-coach-burp-1.0.0.jar
```

A prebuilt JAR is also committed at `dist/webpwn-coach-burp-1.0.0.jar`.

## Load in Burp

1. Start the bridge: `node ../companion/bridge.js` (listens on `127.0.0.1:8088`).
2. Burp → **Extensions → Installed → Add** → Extension type **Java** → select the JAR.
3. The **Output** log should show, loudly:
   `loaded` → `context menu registered` → `tab registered` → `ready`.
4. A new top-level **WebPwn Coach** tab appears in Burp.

## Two ways to send — the tab never depends on the right-click menu

**A. Right-click** a request in **Proxy → HTTP history / Intercept** or **Repeater** →
**Send to WebPwn Coach (redacted)** / **(raw, local)** / **Copy as WebPwn JSON**.

**B. The WebPwn Coach tab** (use this if the context menu doesn't show):
- **Test Bridge** — GET `/health`, shows reachability + last error.
- **Send latest proxy request** — sends the most recent Proxy/HTTP-history request. (This
  needs nothing selected — it reads `api.proxy().history()`.)
- **Send selected request** — sends the last request you right-clicked (disabled with an
  explanation until you've right-clicked one).
- **Copy latest as WebPwn JSON** — clipboard fallback if the bridge is down.

The tab also shows: extension loaded status, bridge URL (editable), bridge health, send
count, last sent, last error, and the captured selection.

**Redacted** strips `Authorization` / `Cookie` / `Set-Cookie` / `X-API-Key` / JWTs /
`password=` / API keys *before leaving Burp*. **Raw** keeps a **local-only** raw dump in the
bridge for the extension's "Reveal raw" (never sent to AI).

The Chrome extension's **Traffic** tab polls the bridge and shows what arrives, tagged with
the Burp tool source. Local actions (Explain / Map to Lens / Users-Objects / Next Test /
Evidence) never leave the browser; **only "✦ Analyze with ATLAS" sends (redacted) data to
the AI, and only when you click it.**

## Manual validation

1. `node companion/bridge.js`  (leave running).
2. Load the JAR in Burp → confirm the **WebPwn Coach** tab appears and Output shows
   `context menu registered` + `tab registered`.
3. Open the **WebPwn Coach** tab → click **Test Bridge** → expect `● reachable (HTTP 200)`.
4. Route Chrome through Burp (extension **Proxy** tab → **Burp**), load a lab page so it
   enters Proxy history.
5. Click **Send latest proxy request** → Output shows `POST … HTTP 200`, send count goes up.
6. In Chrome, open the extension **Traffic** tab → the request appears (tagged
   `Proxy/History`). Click it → **Analyze with ATLAS** stays a manual click.

**If the right-click menu is missing:** everything above still works from the tab. As a last
resort, **Copy latest as WebPwn JSON** and paste it into the Chrome extension → Traffic tab
→ **Or import manually**.

## Loud logging

Every step logs to the extension's Output/Errors: `loaded`, `context menu registered`,
`tab registered`, health-check result, selected-message count, latest-request found, POST
status, and full exception stack traces.

## What it sends

`method`, `url`, `path`, `query` params, request headers, request body, response status,
response headers, a response body **preview**, and the Burp **tool** source. In redacted
mode, `Authorization` / `Cookie` / `Set-Cookie` / `X-API-Key` / JWTs / `password=` / API
keys are replaced with `[REDACTED]` before the POST.

Configure the bridge port with the `WEBPWN_BRIDGE_PORT` environment variable (default 8088).

## Roadmap

- Caido plugin (same `POST /traffic` contract).
- MCP server exposing `list_recent_requests / get_request / explain_request / create_evidence`.
