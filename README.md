# WebPwn Coach 🛰️

An offensive-security **mentor** as a Chrome extension. It teaches you **how to think**
during web application assessments — it is **not** an answer bot and **not** a lab solver.

When you open a learning page it reads the content, ignores the fluff, extracts the
important concepts, and coaches you on *why it matters* and *how a consultant thinks*.

Works on **PortSwigger Academy · Hack The Box Academy · OWASP Juice Shop · WebPwn ·
DVWA · QuickWash · generic web apps**.

The methodology it teaches:

> **Mission → Business → Users → Objects → Workflows → Trust Boundaries →
> Assessment Lens → Tool Choice → Validate → Evidence → Report → Interview → Debrief**

and the full **Assessment Lens**: WHO · WHAT · WHEN · WHERE · HOW (assessment) ·
HOW (technical) · WHY vulnerable · WHY worked · WHY failed · VALIDATE · FIX · REPORT ·
INTERVIEW · **DEBRIEF**.

---

## Install (unpacked)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select the `webpwn-coach-extension/` folder.
4. Pin the ◆ WebPwn Coach icon. **Click it to open the side panel** (the main UI).

No build step. No dependencies. Pure vanilla JS (Manifest V3).

The optional **companion proxy** and **AI backend** are separate opt-ins (below).

---

## The side panel (primary UI)

Clicking the toolbar icon opens a side panel. It **auto-detects the current page** —
switch tabs or navigate and it re-scans on its own, no refresh needed. **Settings** is the
**⚙ gear at the top-right** of the panel. The tabs:

| Panel | What it does |
|---|---|
| **TL;DR** | Fluff-free brief: summary, why it matters, Assessment Lens, mental model, beginner vs senior view, next observation, and the full methodology chain. |
| **Lens** | Pick any concept → its full 14-part Assessment Lens (incl. DEBRIEF) + coaching questions. |
| **Elements** | What's visible: forms, buttons, links, code snippets, cookie/storage **key names**, and the likely **trust boundaries** — with "observe first / ignore as fluff". |
| **Traffic** | Import & understand HTTP (see below). |
| **Highlight** | Guided page highlighting (see below). |
| **Memory** | Your skill profile and weakness tracking (see below). |
| **Reps** | Recommended practice for your weak areas. |
| **Ask** | Ask Coach — a Socratic chat that guides, explains pasted snippets, and never spoils. |
| **Proxy** | Toggle the browser proxy and drive the companion (see below). |
| **⚙ Settings** (gear, top-right) | Persona, context toggles, companion URL, links to AI options. |

### Traffic — import & understand HTTP
Three ways to get traffic, all explained through the Assessment Lens:

- **Paste** a raw HTTP request/response (from Burp/Caido) — or a **JWT / JSON / SQL /
  JS / PHP / Java / Python / Node** snippet — and click **Explain**.
- **Import a HAR** file (browser DevTools → Network → Export HAR).
- **Load from the companion proxy** (Proxy tab must be running).

Select a request, then: **Explain Request · Map to Assessment Lens · Identify
Users/Objects · Suggest Next Test · Create Evidence** (a copy-ready evidence template).

The **code/artifact explainer** teaches, per snippet: what language/format it is, what it
does, the security concept, why it matters, what a beginner should recognise next time,
and the vulnerability family. JWTs are decoded (header/payload/claims/alg/expiry); JSON is
scanned for id/ownership and role fields; SQL for injection surface; server code for
routes and missing auth checks; client JS for the validation trust boundary.

### Memory & Reps — weakness tracking
Locally (nothing leaves the browser) the extension tracks concepts encountered, hints
requested, mistakes, reports written, and interview answers missed, and builds a **skill
profile** across 19 families (Authentication, Authorization, Business Logic, SQLi, XSS,
CSRF, File Upload, Path Traversal, Command Injection, SSRF, XXE, GraphQL, JWT, OAuth,
NoSQL, Race Conditions, Deserialization, Request Smuggling, Cache Poisoning). Weak skills
surface **recommended reps** across PortSwigger, HTB Academy, Juice Shop, DVWA, WebPwn,
and QuickWash — with *why* you struggled and the likely missing prerequisite.

---

## Companion proxy & Proxy Mode (optional)

A tiny local **study proxy** removes the need for FoxyProxy while learning. It is **not**
a Burp replacement and never intercepts/modifies requests.

```bash
cd companion
node proxy.js                 # 127.0.0.1:8088
BURP_UPSTREAM=http://127.0.0.1:8080 node proxy.js   # forward to Burp/Caido
```

In the **Proxy** panel: **Proxy ON → WebPwn Coach (8088)**, **ON → Burp (8080)**, or
**Proxy OFF** (restores system settings). A warning shows whenever a proxy is active. The
panel also shows companion health and a **pause capture** button, and links to the Traffic
tab to browse captured requests.

The companion captures **only allowlisted study domains** (webpwn.me, portswigger /
web-security-academy.net, hackthebox.com, owasp.org, localhost, 127.0.0.1, juice-shop) and
**redacts** `Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, JWTs, and `password=`
fields before storing. **HTTPS**: the MVP records HTTP fully; HTTPS `CONNECT` is tunneled
and only its metadata is recorded (full bodies need a local CA cert — see
`companion/README.md`, or use Burp as the upstream). See `companion/README.md` for the
local API (`/health`, `/traffic`, `/traffic/:id`, `DELETE /traffic`, `/pause`).

---

## Modes

### TL;DR
Click **TL;DR** for a structured brief:

1. **Summary** — what is this page teaching?
2. **Why it matters** — why a consultant cares.
3. **Assessment Lens** — WHO / WHAT / WHEN / WHERE / HOW / WHY / VALIDATE / FIX / REPORT / INTERVIEW.
4. **Mental model** — the pattern to remember.
5. **Common beginner mistakes**.
6. **Common senior thinking**.
7. **Next observation** — what would you look at first?

The brief is re-framed per platform (PortSwigger, HTB, Juice Shop, DVWA, WebPwn, generic).

### Coach
Instead of answers, you get **Socratic questions** that build mentality:

> Bad: “The vulnerability is IDOR.”
> Good: “What object is being requested?”

Hints stay **locked** until you explicitly ask, and even then they are the smallest
nudge — revealed one at a time.

### Concept
Highlight any term on the page → right-click → **“Explain … with WebPwn Coach”** for an
in-page card, or type a term in the popup's Concept tab. Each card covers: simple
explanation, real-world example, how to identify, what to test, common mistakes, a mental
model, coaching questions, and the full Assessment Lens.

Curated concepts include: IDOR, Broken Access Control, JWT, OAuth, Sessions, Cookies,
CSRF, XSS, SQLi, SSRF, RBAC, Mass Assignment, SSTI, Path Traversal / LFI, Command
Injection, XXE, File Upload, Open Redirect, CORS, Business Logic, Rate Limiting /
Enumeration, Insecure Deserialization, and the Trust-Boundary mindset.

### Highlight (guided highlighting)
When you want a hint, the **Highlight** tab marks the relevant parts of the *current
page* instead of just explaining in text — teaching you to **observe** rather than
handing over the answer. It never solves the lab and never reveals a payload by default.

Pick a **focus concept** (defaults to what's detected on the page) and a **hint level**,
then click **Highlight on page**. WebPwn Coach draws non-destructive overlay boxes over:

- forms (GET vs state-changing), buttons, links, inputs
- object identifiers — receipt/order/user/account IDs, UUIDs, tokens (in fields, links, and visible text)
- elements that reveal the current user ("logged in as …")
- visible request/response/code snippets
- a cookies / localStorage / sessionStorage **trust-boundary** indicator (key *names* only — values are never read)

Highlights are colour-coded with the WebPwn palette, and a compact **legend** appears both
in the side panel and as an on-page control bar (with a **Clear ✕** button):

| Colour | Meaning |
|---|---|
| 🟦 cyan | **Observe** — worth a look |
| 🟪 purple | **Trust boundary** — identity / session / auth |
| 🩷 pink | **Hypothesis** — suspicious, I'd probe here |
| 🟩 green | **Validated** — confirmed behaviour |
| 🟥 red | **Impact** — sensitive / destructive |
| ⬜ gray | **Ignore** — chrome / fluff |

Which elements turn **pink** depends on the focus concept (e.g. object IDs for IDOR,
inputs for injection), so the same page teaches differently per concept.

**Hint levels** (progressive — you stay in control):

1. **Point** — just show the areas that matter.
2. **Why** — each highlight explains why it matters.
3. **What to test** — suggestions only, still no payloads.
4. **⚠ Strong hint** — the *exact next action*, revealed **only** when you explicitly
   click the Strong (L4) button. Even then it's a next-action nudge, never a full exploit.

Each highlight session also shows the concise **Assessment Lens**
(WHO / WHAT / WHEN / WHERE / HOW / WHY) for the focus concept, and a **Clear Highlights**
button removes every overlay. Highlights reposition themselves as you scroll or resize.

---

## Personalities

Switch tone (never substance) between three mentors:

- **🛰️ ATLAS** — professional, logical, methodical (default).
- **🐣 BIT** — beginner, curious, a little funny.
- **🧠 BYTE** — senior consultant, dry humor, pushes you to think.

---

## Privacy & the optional AI backend

- The extension is **fully offline** by default — everything above runs from a local
  knowledge base. Nothing leaves your browser.
- **Passwords and secret-like values are never collected.** The extractor skips password
  fields, and a redactor strips tokens/keys/JWTs/hashes before anything could be sent.
- You can **preview exactly what was read** in the popup ("👁 Preview what I read").
- Optionally you can enable a *bring-your-own-key* AI backend for richer,
  page-specific coaching. The AI is bound by a strict mentor prompt: coach, never spoil.
  It only receives the **redacted** context you can preview first.

### Enable the AI backend (OpenRouter, Anthropic, or OpenAI-compatible)
Open the extension **Options** (⚙ Settings → *Open options*, or right-click the icon →
Options):

1. Tick **Enable AI mentor enrichment**.
2. **Provider → OpenRouter** (default). Get a key at **https://openrouter.ai/keys**
   (`sk-or-v1-…`) and paste it into **API key**.
3. **Model** — any OpenRouter model id, e.g. `anthropic/claude-3.5-sonnet`,
   `openai/gpt-4o`, `google/gemini-2.0-flash-001` (browse **openrouter.ai/models**).
   Leave **Base URL** blank — it defaults to `https://openrouter.ai/api/v1`.
4. **Save.** Now the ✦ AI buttons (TL;DR / Traffic) and **Ask Coach** route through your
   OpenRouter account.

Anthropic-direct (`console.anthropic.com`) and any OpenAI-compatible endpoint are also
selectable in the Provider dropdown. Your key is stored in extension storage and sent
only to the provider you choose.

This is a learning tool for **authorized** testing, CTFs, and training labs only.

---

## Project layout

```
webpwn-coach-extension/
├── manifest.json
├── companion/                       # local study proxy (Node, no deps)
│   ├── proxy.js                     # 127.0.0.1:8088 forward proxy + local API
│   ├── package.json
│   └── README.md
├── src/
│   ├── background/background.js     # context menu + side-panel behavior + LLM proxy
│   ├── content/
│   │   ├── content.js               # page read + concept card + highlight/storage routing
│   │   ├── concept-card.css
│   │   ├── highlighter.js           # guided-highlight DOM scanner + overlay
│   │   └── highlight.css
│   ├── sidepanel/                   # PRIMARY UI (10 panels)
│   │   ├── panel.html · panel.css · panel.js
│   ├── popup/                       # legacy quick-view (TL;DR / Coach / Concept)
│   ├── options/                     # settings + AI config
│   ├── lib/
│   │   ├── siteDetect.js            # platform detection (the "modes")
│   │   ├── extractor.js             # read title/headers/forms/links/code
│   │   ├── redact.js                # strip secrets before send
│   │   ├── knowledge.js             # curated concept + Assessment Lens library
│   │   ├── personalities.js         # ATLAS / BIT / BYTE
│   │   ├── engine.js                # TL;DR / Coach / Concept output + highlight plans
│   │   ├── httpparse.js             # raw HTTP + HAR parsing (Traffic)
│   │   ├── explain.js               # code/artifact explainer + traffic→lens
│   │   └── memory.js                # weakness tracking + skill profile + reps
│   └── assets/                      # icons
└── tools/gen-icons.mjs              # regenerate PNG icons
```

The `lib/*` files are plain scripts that attach to a shared `globalThis.WPC`
namespace, so the **exact same engine** runs in the content script, the side panel, and
the popup. The companion proxy is a standalone Node service (see `companion/README.md`).
