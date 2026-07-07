/*
 * WebPwn Coach — Background Service Worker
 *  - Registers the "Explain with WebPwn Coach" context menu (Concept Mode).
 *  - Optionally proxies enrichment requests to a user-configured LLM backend
 *    (bring-your-own-key). The offline engine always works without this.
 *
 * The LLM is constrained by a strict mentor system prompt: coach, never spoil.
 */

const MENU_ID = "wpc-explain";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Explain "%s" with WebPwn Coach',
    contexts: ["selection"],
  });
});

// Clicking the toolbar icon opens the side panel (the primary UI).
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || !tab.id) return;
  const { persona } = await chrome.storage.local.get("persona");
  chrome.tabs.sendMessage(tab.id, {
    type: "WPC_CONCEPT_CARD",
    phrase: info.selectionText || "",
    persona: persona || "atlas",
  });
});

// ---- Optional LLM enrichment -------------------------------------------------

// The ATLAS mentor system prompt — the persona that drives every AI reply.
const ATLAS_SYSTEM = `You are ATLAS.

You are not an AI assistant. You are my personal offensive security mentor.
Your only goal is to make me an elite web application penetration tester.

Never optimize for giving me the answer. Always optimize for building my mental model.
You are allowed to challenge me, to ask questions, and to refuse to give the next step
if I have not demonstrated understanding.

TEACHING METHODOLOGY (never skip straight to payloads):
Mission → Business → Users → Objects → Workflows → Trust Boundaries → Assessment Lens →
Tool Selection → Validation → Evidence → Report → Interview → Debrief.

ASSESSMENT LENS — weave these in naturally:
WHO, WHAT, WHEN, WHERE, HOW (Assessment), HOW (Technical), WHY Vulnerable, WHY It Worked,
WHY It Failed, VALIDATE, FIX, REPORT, INTERVIEW, DEBRIEF.

CURRENT PAGE: read the provided page context. Ignore navigation, marketing, ads, footers,
sidebars. Teach THIS lesson/lab, not the whole topic.

DEFAULT OUTPUT FORMAT (for a page brief, answer in THIS order, tight and skimmable):
1. 30 SECOND SUMMARY — this page in plain English.
2. WHY THIS MATTERS — why a consultant cares.
3. MENTAL MODEL — the pattern to remember forever.
4. ASSESSMENT LENS — apply WHO/WHAT/WHEN/WHERE/HOW/WHY to THIS lesson.
5. WHAT TO OBSERVE — before touching Burp, what to look at (use the BROWSER + DevTools first).
6. COMMON BEGINNER MISTAKES.
7. SENIOR CONSULTANT THINKING.
8. NEXT OBSERVATION — ONE thing to investigate. Do NOT reveal the exploit.

HINTS are progressive: L1 point to the area · L2 why it matters · L3 what to test ·
L4 reveal the next action. Never reveal a ready-to-paste payload unless I explicitly ask.

TOOL PHILOSOPHY: Burp is not the methodology — it is a microscope. Teach me how to THINK
first. If the browser alone (URL, DevTools Network/Application/Elements tabs, viewing
source) can answer it, tell me to look THERE and how, so I learn to find it myself. Only
reach for Burp when it gives more confidence, and explain WHY.

CODE: if I paste/highlight Java/Node/Express/Spring/PHP/Python/JWT/SQL/JSON/JS/GraphQL,
explain what it is, what it's doing, where trust exists, what security assumption is made,
and what to recognise next time. Never assume I know the language.

MEMORY: reinforce my weak areas; when I struggle, recommend reps (WebPwn, PortSwigger,
HTB Academy, Juice Shop, DVWA) and explain WHY.

GOAL: do not help me solve labs — help me become a consultant who no longer needs hints.
Keep replies tight: small sections, bullets, questions. No essays.`;

const PERSONA_TONE = {
  atlas: "", // ATLAS is the default voice above.
  bit: "\n\nVOICE OVERRIDE: You are BIT — an enthusiastic, curious, slightly goofy junior. Keep every ATLAS rule, but ask the naive-but-smart questions out loud and keep it encouraging.",
  byte: "\n\nVOICE OVERRIDE: You are BYTE — a dry, senior consultant. Keep every ATLAS rule, but be terse, a little sardonic, and push me to justify my reasoning.",
};

function systemFor(persona) {
  return ATLAS_SYSTEM + (PERSONA_TONE[persona] || "");
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "WPC_LLM") {
    handleLLM(msg).then(sendResponse).catch((e) =>
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) })
    );
    return true; // async
  }
  return false;
});

async function handleLLM(msg) {
  const cfg = await chrome.storage.local.get([
    "llmEnabled", "provider", "apiKey", "model", "baseUrl",
  ]);
  if (!cfg.llmEnabled) return { ok: false, error: "LLM backend disabled in options." };
  if (!cfg.apiKey) return { ok: false, error: "No API key set in options." };

  // Auto-detect the provider from the key/base URL so a mismatched dropdown
  // can't misroute (e.g. an OpenRouter key sent to Anthropic → "invalid x-api-key").
  const key = String(cfg.apiKey).trim();
  let provider = cfg.provider || "openrouter";
  if (/^sk-or-/i.test(key) || /openrouter\.ai/i.test(cfg.baseUrl || "")) provider = "openrouter";
  else if (/^sk-ant-/i.test(key) || /api\.anthropic\.com/i.test(cfg.baseUrl || "")) provider = "anthropic";
  // Drop a base URL left over from a different provider so it doesn't misroute.
  if (provider === "openrouter" && /anthropic/i.test(cfg.baseUrl || "")) cfg.baseUrl = "";
  if (provider === "anthropic" && /openrouter/i.test(cfg.baseUrl || "")) cfg.baseUrl = "";
  const system = systemFor(msg.persona || "atlas");
  const userPrompt = buildUserPrompt(msg);

  if (provider === "anthropic") return callAnthropic(cfg, userPrompt, system);
  return callOpenAICompatible(cfg, userPrompt, provider, system);
}

function buildUserPrompt(msg) {
  const mode = msg.mode || "tldr";
  const ctx = msg.context || {};
  const lab = msg.lab || (ctx && ctx.lab) || null;
  const signals = [];
  if (lab && lab.isLab) signals.push(`ARENA: This is a hands-on LAB${lab.difficulty ? " (" + lab.difficulty + ")" : ""}${lab.status ? ", status: " + lab.status : ""}. Coach me through it — do NOT hand me the solution.`);
  else signals.push("ARENA: This looks like a reading lesson (not a hands-on lab).");
  if (msg.concept) signals.push(`LIKELY TOPIC (auto-detected): ${msg.concept}.`);
  if (msg.storageKeys && msg.storageKeys.length) signals.push(`STORAGE KEYS visible (names only): ${msg.storageKeys.join(", ")}.`);
  if (msg.selection) signals.push(`I HIGHLIGHTED: "${String(msg.selection).slice(0, 400)}".`);

  const lines = [
    `MODE: ${mode.toUpperCase()}`,
    `PLATFORM: ${msg.siteLabel || "unknown"}`,
    "",
    "PAGE SIGNALS:",
    ...signals.map((s) => "- " + s),
    "",
    "REDACTED PAGE CONTEXT (secrets already stripped — this is what I can see on screen):",
    "```",
    JSON.stringify(trimCtx(ctx), null, 1).slice(0, 9000),
    "```",
    "",
    modeInstruction(mode, msg),
  ];
  return lines.join("\n");
}

function modeInstruction(mode, msg) {
  if (mode === "chat") {
    return `The learner asks: "${msg.question || ""}". Respond as a mentor — guide with questions and mental models, do not hand over the answer or a payload unless they explicitly ask for a strong hint.`;
  }
  if (mode === "concept") {
    return `Explain the concept "${msg.phrase || ""}" as a mentor: simple explanation, real-world example, how to identify, what to test, common mistakes, a mental model, and 2-3 coaching questions. No spoilers.`;
  }
  if (mode === "coach") {
    return "Coach me. Ask 5-8 Socratic questions that guide my thinking about this page. Do NOT state the vulnerability or give payloads. End with one 'next observation'.";
  }
  return "Give the page brief in your DEFAULT 8-section output format (30-Second Summary → Why This Matters → Mental Model → Assessment Lens → What To Observe → Common Beginner Mistakes → Senior Consultant Thinking → Next Observation). Teach THIS page. Browser/DevTools first; do not reveal the exploit.";
}

function trimCtx(ctx) {
  return {
    title: ctx.title,
    headers: (ctx.headers || []).slice(0, 15),
    paragraphs: (ctx.paragraphs || []).slice(0, 15),
    forms: (ctx.forms || []).slice(0, 6),
    buttons: (ctx.buttons || []).slice(0, 15),
    links: (ctx.links || []).slice(0, 15),
    code: (ctx.code || []).slice(0, 8),
  };
}

async function callAnthropic(cfg, userPrompt, system) {
  const res = await fetch((cfg.baseUrl || "https://api.anthropic.com") + "/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: cfg.model || "claude-sonnet-5",
      max_tokens: 1400,
      system: system,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.error ? data.error.message : "API error" };
  const text = (data.content || []).map((c) => c.text || "").join("").trim();
  return { ok: true, text };
}

async function callOpenAICompatible(cfg, userPrompt, provider, system) {
  const isOR = provider === "openrouter";
  const base = cfg.baseUrl || (isOR ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1");
  const model = cfg.model || (isOR ? "anthropic/claude-3.5-sonnet" : "gpt-4o-mini");
  const headers = { "content-type": "application/json", authorization: "Bearer " + cfg.apiKey };
  if (isOR) {
    // OpenRouter's optional attribution headers (used for its rankings page).
    headers["HTTP-Referer"] = "https://github.com/Ch0mpaa/webpwn-extension";
    headers["X-Title"] = "WebPwn Coach";
  }
  let res, data;
  try {
    res = await fetch(base.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 1400,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    data = await res.json();
  } catch (e) {
    return { ok: false, error: `Network error reaching ${isOR ? "OpenRouter" : base}: ${e.message}` };
  }
  if (!res.ok) return { ok: false, error: (data && data.error && (data.error.message || data.error)) || `HTTP ${res.status}` };
  const text = data.choices && data.choices[0] ? (data.choices[0].message.content || "").trim() : "";
  return { ok: true, text };
}
