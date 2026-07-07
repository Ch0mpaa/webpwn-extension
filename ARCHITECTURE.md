# WebPwn Coach — Architecture (v2)

This supersedes the original "companion forward-proxy" idea. WebPwn Coach does **not**
intercept, modify, or replace Burp/Caido. It has three separate systems.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Chrome                                                              │
│                                                                     │
│   ┌───────────────┐        Part 1: PROXY SWITCHER (chrome.proxy)    │
│   │ WebPwn Coach  │──────► routes browser traffic to:               │
│   │  side panel   │        Direct · Burp 8080 · Caido host:port ·   │
│   └──────┬────────┘        Custom host:port                         │
│          │                                                          │
│          │ browser traffic (when a proxy mode is active)            │
│          ▼                                                          │
│     ┌─────────┐   intercept / Repeater / Intruder / replay          │
│     │ Burp /  │   (WebPwn Coach NEVER does this)                    │
│     │ Caido   │                                                     │
│     └────┬────┘                                                     │
│          │ Part 2: user "sends" a selected request/response         │
│          ▼         (Burp ext / context-menu / webhook / paste)      │
│   ┌──────────────┐  POST /traffic                                   │
│   │ Bridge       │◄──────────── receive-only, 127.0.0.1             │
│   │ companion    │  GET /health · GET /traffic/recent · /traffic/:id│
│   └──────┬───────┘  redacts Authorization/Cookie/Set-Cookie/JWT     │
│          │ extension polls /traffic/recent                          │
│          ▼                                                          │
│   ┌───────────────┐  Part 3: GUIDED STEP FLOW (ATLAS)               │
│   │ WebPwn Coach  │  Daily Objective → Business → Observe → Lens →  │
│   │  (Session)    │  Choose Tool → Validate → Evidence → Report →   │
│   └───────────────┘  Interview → Debrief.  AI only after "Analyze". │
└─────────────────────────────────────────────────────────────────────┘
```

## Part 1 — Proxy Switcher (FoxyProxy replacement)
- Pure `chrome.proxy` management in the extension. **No companion involved.**
- One-click modes: **Direct · Burp (127.0.0.1:8080) · Caido (host/port) · Custom (host/port)**.
- Status chip: `DIRECT` / `BURP ACTIVE` / `CAIDO ACTIVE` / `CUSTOM ACTIVE`.
- Configurable host/port per mode, a **Restore Direct** button, and a **warning banner**
  whenever a proxy mode is active.
- Implemented with a PAC script so the bridge's own `127.0.0.1:<port>` always stays
  `DIRECT` (otherwise routing everything through Burp would trap the bridge's API calls).
- The extension does **not** intercept or modify traffic.

## Part 2 — Burp/Caido Traffic Bridge (receive-only)
- Local companion **`companion/bridge.js`** on `127.0.0.1:8088`. It is **not a proxy** — it
  only *receives* traffic Burp/Caido pushes to it.
- API: `GET /health`, `POST /traffic`, `GET /traffic/recent`, `GET /traffic/:id`,
  `DELETE /traffic`.
- **Preferred ingestion: the Burp Montoya extension** (`burp-extension/`, built JAR at
  `burp-extension/dist/`). Right-click a request in Proxy/History/Repeater →
  **"Send to WebPwn Coach"** (redacted, or raw-local). Copy/paste and `POST /traffic`
  webhook remain as fallbacks. A Caido plugin and an MCP server (`list_recent_requests /
  get_request / explain_request / create_evidence`) are the roadmap.
- Redacts `Authorization`, `Cookie`, `Set-Cookie`, JWTs, `password=` by default; keeps a
  local raw view on demand; flags when sensitive headers are present.
- The extension polls `/traffic/recent`, the user selects a request, and **only after
  clicking Analyze** is anything sent to the AI.

## Part 3 — Guided Step Flow (the mentor)
- A **Session** experience that is the default surface. ATLAS decides the next step; one
  step visible at a time; each step asks you to *do* something and never dumps answers.
- Steps: Daily Objective → Business Context → Observe → Assessment Lens → Choose Tool →
  Validate → Evidence → Report → Interview → Debrief.
- Uses the live page context, the selected bridge request, and weak-area memory. Tracks
  where you got stuck; stores session memory locally; greets with "Yesterday you struggled
  with X — watch for Y today."
- The existing panels (TL;DR, Lens, Elements, Traffic, Highlight, Memory, Reps, Ask) are
  **demoted to "Tools"**, not removed.

## Build order
1. **Part 1 Proxy Switcher** — chrome.proxy modes + status + settings. *(this pass)*
2. **Part 2 Traffic Bridge** — receive-only companion + polling + Analyze-gated AI. *(this pass)*
3. **Part 3 Guided Step Flow** — Session as default, tabs under Tools. *(next pass)*

## Non-goals (explicit)
Not a proxy. Not an interceptor. Not a Burp/Caido/Repeater/Intruder replacement. No silent
AI sends.
