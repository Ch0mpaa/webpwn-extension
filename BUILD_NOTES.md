# WebPwn Coach — Build Notes

Engineering notes for the extension: how it's put together, the decisions behind it,
how to build/verify, and the known limitations. Companion to `README.md` (which is the
user-facing guide).

---

## Build / run

There is **no bundler and no dependencies** — it's vanilla Manifest V3. "Building" means
loading it unpacked and validating the sources.

```bash
# Syntax-check every source file + validate the manifest
cd webpwn-coach-extension
for f in $(find src -name '*.js'); do node --check "$f"; done
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"

# Regenerate icons (only needed if the icon design changes)
node tools/gen-icons.mjs

# Load in Chrome
#   chrome://extensions → Developer mode → Load unpacked → select this folder
```

End-to-end verification is done with Playwright against the pre-installed Chromium,
loading the extension for real and driving it through the extension messaging path
(`chrome.tabs.sendMessage`) — see "Testing notes" below.

---

## Architecture

### Shared engine, one namespace
All logic lives in `src/lib/*.js` as **classic scripts** that attach to a single global,
`globalThis.WPC`. This lets the **exact same code** run in three contexts without a build
step or module duplication:

- **content script** (isolated world) — declared in `manifest.json` `content_scripts`
- **popup** — the same files are included via `<script>` tags in `popup.html`
- **fallback injection** — `popup.js` re-injects the same file list with
  `chrome.scripting.executeScript` if the content script wasn't present (page loaded
  before install, etc.)

`background.js` is deliberately dependency-free (context menu + optional LLM proxy only).

### Content-script load order (matters)
```
siteDetect → redact → extractor → knowledge → personalities → engine → highlighter → content
```
`content.js` calls `WPC.engine.*` and `WPC.highlighter.*`, so those must load first.

> Note: the earlier version listed only `siteDetect, redact, extractor, content` in
> `content_scripts`. That left `WPC.engine` undefined in the content world, which would
> have broken the right-click **Concept card**. Adding `knowledge/personalities/engine`
> to the content-script list (needed anyway for highlighting) fixed that latent gap.

### Guided highlighting data flow
```
popup (Highlight tab)
  │  chrome.tabs.sendMessage {type:WPC_HIGHLIGHT, conceptId, level, persona}
  ▼
content.js  → WPC.engine.buildHighlightPlan()   // concept framing + level, NO payloads
            → WPC.highlighter.run(plan)          // scans DOM, draws overlay, returns summary
  │  summary {total, byColor, byCategory, storage, plan{lens6, legend, levelText,…}}
  ▼
popup renders legend counts + Assessment Lens + level text
```
Clearing is symmetric: `WPC_CLEAR_HIGHLIGHT` → `WPC.highlighter.clear()`. There's also a
**Clear ✕** button baked into the on-page control bar so the user can clear without
reopening the popup.

### Separation of concerns for highlighting
- **`engine.buildHighlightPlan`** (knowledge side): *what & why*. Chooses which categories
  are "suspect/pink" from the concept's tags, supplies the level text, the 6-part lens,
  the legend, and persona flavour. Never emits a payload.
- **`content/highlighter.js`** (DOM side): *where*. Scans the live page, categorises
  elements, and draws/positions non-destructive overlay boxes. Owns the finder regexes.
- **`engine.CATEGORY_TEACH`**: the per-category teaching text, indexed by hint level
  (0..3). At **L4**, only focus colours (suspect/danger/trust) receive the "next action"
  line; observe/fluff stay capped at L3 so the strong hint stays focused on the real target.

### Element categories → colours
| category | base colour | notes |
|---|---|---|
| `state-form` | pink (suspect) | POST/PUT/DELETE forms — where authz/CSRF must hold |
| `get-form` | cyan (observe) | input surface |
| `input` | cyan → pink if injection concept | |
| `password` | purple (trust) | presence only; **value never read** |
| `object-id` | cyan → pink if access-control/logic concept | id-ish inputs, id-bearing links, and UUID/labelled-id text (Range-based) |
| `link` | cyan | structural / privileged routes |
| `button` | cyan | workflow actions |
| `action-button` | red (danger) | delete/pay/transfer/admin… |
| `code` | cyan → pink if injection | visible request/response/code |
| `user-context` | purple (trust) | "logged in as …" |
| `storage` | purple (trust) | cookie/localStorage/sessionStorage **key names only** |
| `fluff` | gray (ignore) | nav/footer/cookie banners |

### Non-destructive overlays
Overlay boxes are appended to `document.documentElement` (id `wpc-hl-root`) — the page's
own DOM is never mutated. Object-id text matches use a `Range` + `getBoundingClientRect`
so we can box a substring without wrapping it in a node. Positions are recomputed on a
`requestAnimationFrame` loop plus `scroll`/`resize` listeners, and boxes hide themselves
if their target detaches. Everything (root, control bar, rAF loop, listeners) is torn
down on `clear()`.

---

## Privacy / safety invariants (unchanged and extended)

- **Passwords are never read.** The extractor and highlighter note the *presence* of a
  password field, never its value.
- **Storage values are never read.** The storage indicator lists cookie/localStorage/
  sessionStorage **key names** only, capped at 8 each — never values.
- **No payloads by default.** Coaching and highlights L1–L3 give observation/why/what,
  not exploit strings. L4 ("Strong hint") is gated behind an explicit button click and
  even then yields a *next-action* nudge, not a full exploit.
- **Nothing leaves the browser** unless the user opts into the AI backend, which only
  ever receives the **redacted** context they can preview first.

---

## Testing notes

Because content scripts run in an **isolated world**, `page.evaluate` (main world) can't
see `window.WPC`. The E2E therefore drives the feature exactly as the popup does — via
the service worker's `chrome.tabs.sendMessage` — and then inspects the resulting overlay
DOM (which *is* shared) for box count, per-colour border counts, label text per level,
the on-page bar, and the storage chip. `file://` pages don't get content scripts without
the file-access permission, so the test page is served over `http://localhost`.

Verified behaviours: all 6 theme colours render; concept-driven pink emphasis (IDOR →
object-ids pink, XSS → inputs pink); level text scales point → why → test → next-action;
storage indicator reports names only; `clear()` removes every overlay and the bar.

---

## Architecture v2 — Proxy Switcher + Traffic Bridge (see ARCHITECTURE.md)

The original "companion forward-proxy that captures traffic" was replaced by two separate,
smaller systems. WebPwn Coach never intercepts or modifies traffic.

**Part 1 — Proxy Switcher (extension only).** The Proxy panel is a FoxyProxy replacement:
`chrome.proxy` PAC modes for Direct / Burp / Caido / Custom, each with configurable
host:port stored under `wpc_proxy`, a status chip (`DIRECT`/`BURP ACTIVE`/…), a Restore
Direct button, and an active-mode warning. The PAC always returns `DIRECT` for the bridge's
`127.0.0.1:<port>` so routing everything through Burp doesn't trap the bridge's own API
calls. No companion needed for this.

**Part 2 — Traffic Bridge (`companion/bridge.js`, receive-only).** Replaces the forward
proxy (`proxy.js` deleted). Burp/Caido *push* a request to `POST /traffic` (JSON or raw
HTTP); the extension polls `GET /traffic/recent` every 3s and streams it into the Traffic
tab. `GET /traffic/:id` returns the redacted entry + `hasSensitive` + a local-only `raw`.
Redacts Authorization/Cookie/Set-Cookie/X-API-Key/JWT/`password=`. The extension's
per-request actions (Explain/Lens/Users-Objects/Next-Test/Evidence) are **local**; only the
explicit **Analyze with ATLAS** button sends (redacted) data to the AI. `state.bridgeUrl`
(migrated from the old `companionUrl`) points at it.

Verified: proxy modes set/clear via `chrome.proxy` with bridge-port bypass; bridge
POST(raw+JSON)/recent/detail/redaction/raw-kept-local; Traffic tab shows pushed requests
live, gates AI behind Analyze, and Reveal-raw stays local.

**Part 3 — Guided Step Flow: NOT YET BUILT.** Designed in ARCHITECTURE.md. Next pass:
a "Session" surface as the default (Daily Objective → Business → Observe → Lens → Choose
Tool → Validate → Evidence → Report → Interview → Debrief), one step at a time, driven by
page context + selected bridge request + weak-area memory, with the current tabs demoted
under "Tools".

## MVP expansion — side panel, Traffic, Memory, Proxy

### Side panel is now the primary UI
`manifest.action` no longer sets `default_popup`; instead `background.js` calls
`chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` and the manifest
declares `side_panel.default_path`. The popup files remain (still functional) but the
toolbar click opens `src/sidepanel/panel.html`. The panel loads the same `WPC.*` libs via
`<script>` tags and adds three new ones: `httpparse`, `explain`, `memory`.

New permissions: `sidePanel`, `proxy`.

### New shared libs
- **`httpparse.js`** — `parseText` (raw HTTP request/response paste), `parseHar` (HAR
  export → endpoint summary), `extractParams`. Redacts `Authorization/Cookie/Set-Cookie/
  X-API-Key`/JWTs and masks `password=` on the way in.
- **`explain.js`** — `classify` + `explainArtifact` for JWT / JSON / SQL / SQL-error /
  PHP / Java / Python / Node / client-JS / raw HTTP, each returning the 6 teaching points
  (format, what-it-does, concept link, why, beginner-next, vuln family). Plus
  `trafficLens` (parsed request → full 14-part lens incl. DEBRIEF), `identifyUsersObjects`,
  and a copy-ready evidence template. JWT detection is deliberately lenient on the
  signature so `alg=none` tokens still decode.
- **`memory.js`** — `record` / `profile` / `recommend`. Persists to
  `chrome.storage.local` under `wpc_memory` (falls back to an in-memory object under test).
  Maps 23 knowledge concepts → 19 skill families, scores each skill
  (`strength = seen + 2·reports`, `struggle = hints + 2·mistakes + 2·missed`), assigns a
  level (New/Weak/Practicing/Solid), and recommends reps for the weakest touched skills
  with a "why" and a prerequisite.

### Traffic data flow
```
paste / HAR / companion  →  WPC.http.parse*  →  parsed {request,response}
   selected request  →  actions:
     Explain Request         (params, id flags, auth/cookie presence)
     Map to Assessment Lens  (WPC.explain.trafficLens)
     Identify Users/Objects  (WPC.explain.identifyUsersObjects)
     Suggest Next Test       (concept coach questions — logs a hint)
     Create Evidence         (markdown template — logs a report)
```

### Companion proxy (`companion/proxy.js`)
A dependency-free Node forward proxy on `127.0.0.1:8088`. One server multiplexes:
- **absolute-URL requests** → forward (optionally via `BURP_UPSTREAM`), capture
  metadata + redacted body previews, store only for allowlisted study domains;
- **`CONNECT`** → metadata-only TCP tunnel (no TLS interception in MVP);
- **path requests** → the local API (`/health`, `/traffic`, `/traffic/:id`,
  `DELETE /traffic`, `/pause`) with open CORS (loopback-only dev).

The extension's proxy toggle uses a **PAC script** (not `fixed_servers`) so it can force
`DIRECT` for `127.0.0.1:8088` — otherwise routing all traffic through the companion would
loop the API calls back through itself. `Proxy OFF` calls `chrome.proxy.settings.clear`,
restoring the system proxy.

### Verification for the MVP
- `httpparse` / `explain` / `memory` unit-tested in a Node VM sandbox (parse + redaction,
  JWT/JSON/SQL/code classification, traffic lens + DEBRIEF, skill scoring + recommend).
- Companion proxy tested for real in-process: a proxied POST is captured with correct
  metadata and `Authorization`/`password`/`Set-Cookie` redacted.
- Side panel loaded as an extension page in headless Chromium: all 10 tabs render, the
  Traffic JWT/HTTP explain + actions work, Ask Coach replies, Memory logs + Reps
  recommend, and the Proxy panel reads `chrome.proxy` status. With the companion running,
  the panel's health check and `chrome.proxy` set/get/clear were confirmed.

---

## Known limitations

1. **Heuristic, not semantic.** Element categorisation and object-id detection are
   regex/DOM heuristics. Expect occasional false positives (a random long string flagged
   as a token) or misses (an id with an unusual label). It's a *coaching* aid, not a
   scanner — by design it points you at things to *think about*.
2. **SPAs / dynamic content.** Highlights are computed at click time. If the page mutates
   afterwards (React re-render, AJAX nav), re-click **Highlight** to refresh. There's no
   MutationObserver auto-refresh yet.
3. **Cross-origin iframes.** The scanner only sees the top document. Content inside
   cross-origin iframes (some lab widgets) can't be read or highlighted.
4. **Shadow DOM.** Elements inside closed shadow roots aren't scanned.
5. **`httpOnly` cookies.** The storage indicator can't see `httpOnly` cookies (by browser
   design) — it counts what `document.cookie` exposes, so the cookie count can undercount.
6. **`file://` pages.** Need "Allow access to file URLs" enabled for the extension;
   otherwise content scripts (and highlighting) won't run there.
7. **Restricted pages.** `chrome://`, the Web Store, and other privileged origins block
   content scripts entirely — the popup shows a friendly "can't read this page" message.
8. **Positioning edge cases.** Highlights track scroll/resize via rAF, but elements with
   CSS transforms or `position: sticky` inside transformed ancestors can drift by a few
   pixels. Cosmetic only.
9. **Overlap at high density.** On very dense pages the label chips can overlap; the total
   marks are capped at 46 (focus colours prioritised, fluff last) to keep it readable.
10. **Green (Validated) is reserved.** The palette includes a "validated" green, but the
    tool doesn't auto-confirm findings, so nothing is coloured green automatically today —
    it's reserved for a future "mark as validated" interaction.

### MVP limitations (Traffic / Memory / Proxy)

11. **HTTPS bodies are not visible.** The companion does not do TLS interception. `CONNECT`
    is tunneled and only metadata (host:port) is recorded. Full HTTPS bodies require a
    local CA certificate (out of scope for the MVP) or using Burp/Caido as the upstream.
12. **Companion stores in memory only.** Captured traffic is a 200-entry ring buffer in the
    proxy process — it is lost on restart. No disk persistence yet.
13. **Proxy is browser-wide.** `chrome.proxy` affects the whole browser profile, not just
    study tabs. A warning is shown while active; remember to turn it OFF. If the extension
    is removed while the proxy is on, Chrome restores settings on uninstall, but a crash
    mid-session could leave the PAC set — toggle OFF or restart Chrome to clear.
14. **Heuristic explainer & parsing.** Language/artifact classification and HTTP parsing
    are best-effort. Malformed pastes, unusual header casing, or mixed request+response
    blobs may parse partially. Paste a clean boundary (just the JWT, just the JSON, or a
    complete request block) for best results.
15. **Memory is local & signal-light.** Weakness tracking lives in `chrome.storage.local`
    (this profile only — no sync, no export yet). Automatic events are limited
    (concept-encountered on TL;DR, hint on strong highlight / next-test / chat strong
    hint); mistakes, missed interview answers and reports are mostly logged manually in the
    Memory panel. The skill score is a simple heuristic, not a calibrated assessment.
16. **Reps catalog is curated, not linked.** Recommended reps name the platform + module/
    challenge but don't deep-link (lab URLs change). They're pointers to go practice.
17. **Ask Coach (offline) is shallow.** Without the AI backend, chat replies are
    knowledge-base driven (classify a pasted artifact, or detect a concept and return its
    mental model + coaching questions). It won't hold a long dialogue; enable the AI
    backend for richer conversation.
18. **Allowlist is host-based.** The companion allowlist matches on host suffix; a study
    lab on an unlisted host won't be captured until you add it to `ALLOWLIST` in
    `companion/proxy.js`.
