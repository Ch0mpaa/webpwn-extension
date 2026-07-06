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

const MENTOR_SYSTEM = [
  "You are WebPwn Coach, an offensive-security MENTOR for authorized web-app assessment learning.",
  "You teach HOW TO THINK. You are NOT an answer bot and NOT a lab solver.",
  "Rules:",
  "- Never reveal the flag/answer or a ready-to-paste payload unless the user explicitly asks for a hint, and even then give the smallest nudge.",
  "- Prefer Socratic questions, mental models, and the Assessment Lens (WHO/WHAT/WHEN/WHERE/HOW/WHY/VALIDATE/FIX/REPORT/INTERVIEW).",
  "- Think in this order: Business → Application → Workflow → Objects → Trust boundaries → Hypothesis → Testing → Evidence.",
  "- Keep it tight: small sections, bullets, questions, comparisons. No essays.",
  "- Build mentality, not memorized payloads.",
].join("\n");

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

  const provider = cfg.provider || "anthropic";
  const userPrompt = buildUserPrompt(msg);

  if (provider === "anthropic") return callAnthropic(cfg, userPrompt);
  return callOpenAICompatible(cfg, userPrompt);
}

function buildUserPrompt(msg) {
  const mode = msg.mode || "tldr";
  const ctx = msg.context || {};
  const lines = [
    `MODE: ${mode.toUpperCase()}`,
    `PLATFORM: ${msg.siteLabel || "unknown"}`,
    "",
    "REDACTED PAGE CONTEXT (secrets already stripped):",
    "```",
    JSON.stringify(trimCtx(ctx), null, 1).slice(0, 9000),
    "```",
    "",
    modeInstruction(mode, msg),
  ];
  return lines.join("\n");
}

function modeInstruction(mode, msg) {
  if (mode === "concept") {
    return `Explain the concept "${msg.phrase || ""}" as a mentor: simple explanation, real-world example, how to identify, what to test, common mistakes, a mental model, and 2-3 coaching questions. No spoilers.`;
  }
  if (mode === "coach") {
    return "Coach me. Ask 5-8 Socratic questions that guide my thinking about this page. Do NOT state the vulnerability or give payloads. End with one 'next observation'.";
  }
  return "Produce a TL;DR: 1) Summary 2) Why it matters (consultant) 3) Assessment Lens (WHO/WHAT/WHEN/WHERE/HOW/WHY) 4) Mental model 5) Common beginner mistakes 6) Common senior thinking 7) Next observation. Keep each section short.";
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

async function callAnthropic(cfg, userPrompt) {
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
      max_tokens: 1200,
      system: MENTOR_SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.error ? data.error.message : "API error" };
  const text = (data.content || []).map((c) => c.text || "").join("").trim();
  return { ok: true, text };
}

async function callOpenAICompatible(cfg, userPrompt) {
  const base = cfg.baseUrl || "https://api.openai.com/v1";
  const res = await fetch(base.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + cfg.apiKey },
    body: JSON.stringify({
      model: cfg.model || "gpt-4o-mini",
      max_tokens: 1200,
      messages: [
        { role: "system", content: MENTOR_SYSTEM },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.error ? data.error.message : "API error" };
  const text = data.choices && data.choices[0] ? data.choices[0].message.content.trim() : "";
  return { ok: true, text };
}
