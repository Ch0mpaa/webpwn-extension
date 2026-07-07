# WebPwn Coach — Companion Proxy

A tiny **study proxy** (no dependencies) that lets the extension show you real traffic
while you learn. It is **not** a Burp replacement and does not intercept/modify requests.

## Run

```bash
cd companion
node proxy.js                 # listens on http://127.0.0.1:8088
# forward everything to Burp/Caido as an upstream:
BURP_UPSTREAM=http://127.0.0.1:8080 node proxy.js
```

Then in the extension's **Proxy** panel click **Proxy ON → WebPwn Coach**, or point your
browser/FoxyProxy at `127.0.0.1:8088`.

## What it captures

For **allowlisted study domains only** (webpwn.me, portswigger/web-security-academy.net,
hackthebox.com, owasp.org, localhost, 127.0.0.1, juice-shop):

- method, URL, host, status, content-type
- request/response headers and a body **preview** (first ~2 KB)

It **redacts by default**: `Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`,
`Proxy-Authorization`, any JWT-looking value, and `password=` fields in bodies.

## Local API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | status, paused flag, capture count, upstream, allowlist |
| GET | `/traffic` | list captured entries (summaries) |
| GET | `/traffic/:id` | full entry (redacted) |
| DELETE | `/traffic` | clear all captured traffic |
| POST | `/pause` | toggle capture (`{"paused":true}` to force a state) |

CORS is open (`*`) because it only binds to loopback for local dev.

## HTTPS

The MVP does **not** do TLS interception. HTTPS `CONNECT` requests are tunneled and only
their **metadata** (host:port) is recorded — bodies stay encrypted. Full HTTPS body
visibility would require generating and trusting a local CA certificate; that's
intentionally out of scope for the MVP. Use HTTP targets (or Burp as upstream) for full
body visibility while studying.

## Safety

- Loopback only (`127.0.0.1`), never `0.0.0.0`.
- Non-allowlisted domains are proxied but **not stored**.
- Passwords are masked; auth material is redacted before storage.
- A **pause** control stops capture without turning the proxy off.
