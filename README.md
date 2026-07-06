# WebPwn Coach 🛰️

An offensive-security **mentor** as a Chrome extension. It teaches you **how to think**
during web application assessments — it is **not** an answer bot and **not** a lab solver.

When you open a learning page it reads the content, ignores the fluff, extracts the
important concepts, and coaches you on *why it matters* and *how a consultant thinks*.

Works on **PortSwigger Academy · Hack The Box Academy · OWASP Juice Shop · WebPwn ·
DVWA · generic web apps**.

---

## Install (unpacked)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select the `webpwn-coach-extension/` folder.
4. Pin the ◆ WebPwn Coach icon and open any learning page.

No build step. No dependencies. Pure vanilla JS (Manifest V3).

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
- Optionally, in **Settings** you can enable a *bring-your-own-key* AI backend
  (Anthropic Claude or any OpenAI-compatible endpoint) for richer, page-specific
  coaching. The AI is bound by a strict mentor prompt: coach, never spoil. It only
  receives the **redacted** context you can preview first.

This is a learning tool for **authorized** testing, CTFs, and training labs only.

---

## Project layout

```
webpwn-coach-extension/
├── manifest.json
├── src/
│   ├── background/background.js     # context menu + optional LLM proxy
│   ├── content/
│   │   ├── content.js               # page read + in-page concept card + msg routing
│   │   ├── concept-card.css
│   │   ├── highlighter.js           # guided-highlight DOM scanner + overlay
│   │   └── highlight.css
│   ├── popup/                       # main UI (TL;DR / Coach / Concept)
│   ├── options/                     # settings + AI config
│   ├── lib/
│   │   ├── siteDetect.js            # platform detection (the "modes")
│   │   ├── extractor.js             # read title/headers/forms/links/code
│   │   ├── redact.js                # strip secrets before send
│   │   ├── knowledge.js             # curated concept + Assessment Lens library
│   │   ├── personalities.js         # ATLAS / BIT / BYTE
│   │   └── engine.js                # TL;DR / Coach / Concept output + highlight plans
│   └── assets/                      # icons
└── tools/gen-icons.mjs              # regenerate PNG icons
```

The `lib/*` files are plain scripts that attach to a shared `globalThis.WPC`
namespace, so the **exact same engine** runs in both the content script and the popup.
