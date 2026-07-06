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
