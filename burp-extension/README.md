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
3. You'll see `WebPwn Coach Bridge loaded` in the extension's Output.

## Use

Right-click a request/response in **Proxy → HTTP history**, **Proxy → Intercept**, or
**Repeater**, then choose:

- **Send to WebPwn Coach (redacted)** — sensitive values are stripped *before leaving Burp*.
- **Send to WebPwn Coach (raw, local)** — full values, plus a raw dump kept **local-only**
  in the bridge for the extension's "Reveal raw" (never sent to AI).

The Chrome extension's **Traffic** tab polls the bridge and shows what arrives, tagged with
the Burp tool source (Proxy/History or Repeater/Editor). Selecting a request runs local
actions (Explain / Map to Lens / Users-Objects / Next Test / Evidence); **only "✦ Analyze
with ATLAS" sends (redacted) data to the AI, and only when you click it.**

## What it sends

`method`, `url`, `path`, `query` params, request headers, request body, response status,
response headers, a response body **preview**, and the Burp **tool** source. In redacted
mode, `Authorization` / `Cookie` / `Set-Cookie` / `X-API-Key` / JWTs / `password=` / API
keys are replaced with `[REDACTED]` before the POST.

Configure the bridge port with the `WEBPWN_BRIDGE_PORT` environment variable (default 8088).

## Roadmap

- Caido plugin (same `POST /traffic` contract).
- MCP server exposing `list_recent_requests / get_request / explain_request / create_evidence`.
