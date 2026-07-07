# WebPwn Coach — Traffic Bridge

A tiny **receive-only** service (no dependencies). Burp/Caido stay your intercepting proxy
and Repeater/Intruder — this bridge only *receives* a request you choose to send it, so
WebPwn Coach can teach from it. **It is not a proxy and never modifies traffic.**

> Routing your browser to Burp/Caido is a separate thing — do that from the extension's
> **Proxy** panel (the Proxy Switcher), not here.

## Run

```bash
cd companion
node bridge.js            # listens on http://127.0.0.1:8088
```

## Send a request to it

Any of these work (MVP → future):

- **Copy/paste** — paste a raw request/response into the extension's Traffic tab.
- **Webhook / curl** — push raw HTTP:
  ```bash
  curl -X POST -H 'content-type: text/plain' \
       --data-binary @request.txt http://127.0.0.1:8088/traffic
  ```
- **JSON** — structured push:
  ```bash
  curl -X POST -H 'content-type: application/json' http://127.0.0.1:8088/traffic \
    -d '{"method":"POST","url":"https://lab/login","reqHeaders":{"Cookie":"session=x"},
         "reqBody":"username=a&password=b","status":200,"respBody":"Invalid username"}'
  ```
- **Later**: a Burp Java/Kotlin extension and a Caido plugin will add a one-click
  "Send to WebPwn Coach"; an MCP server will expose `list_recent_requests / get_request /
  explain_request / create_evidence`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | `{ ok, service:"webpwn-coach-bridge", count }` |
| POST | `/traffic` | receive a request/response (JSON or raw HTTP text) |
| GET | `/traffic/recent` | list received requests (summaries) |
| GET | `/traffic/:id` | full (redacted) entry + `hasSensitive` + local `raw` |
| DELETE | `/traffic` | clear |

CORS is open (`*`) — it binds to loopback only.

## Safety

- `Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, JWTs and `password=` are **redacted**
  in everything the extension shows or sends to AI.
- A **local-only** raw copy is kept so you can inspect the real request via the extension's
  "Reveal raw (local)" — it is never sent anywhere.
- The extension marks entries that contain sensitive headers, and **only sends to AI when
  you click Analyze**.
