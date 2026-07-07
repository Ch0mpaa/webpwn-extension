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

// The ATLAS mentor system prompt — lean mentor mode. No methodology frameworks.
const ATLAS_SYSTEM = `You are ATLAS, my personal offensive-security study mentor.

Your job: help me understand what I'm reading FAST so I can move on. I get bored reading
full pages — cut the fluff and give me the signal.

Style:
- Plain English. Concise. High signal. No filler, no lecturing, no rigid frameworks.
- Do NOT dump a methodology, an "assessment lens", or long section templates. Mentor mode only.
- Explain the key ideas and what they actually MEAN. Use the page content I give you.
- When I'm stuck or confused, EXPLAIN it clearly, then give concrete, actionable steps:
  "Right now you can: 1) … 2) … 3) …". Actionable, not vague questions.
- Explaining a concept fully IS your job. The ONE thing you hold back is a ready-to-paste
  exploit / lab-solution payload — for those, point me the right way instead of handing it over.
- Follow the specific format each message asks for.`;

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
    "llmEnabled", "provider", "apiKey", "model", "baseUrl", "modelSummarize", "modelCoach",
  ]);
  if (!cfg.llmEnabled) return { ok: false, error: "LLM backend disabled in options." };

  // Auto-detect the provider from the key/base URL so a mismatched dropdown
  // can't misroute (e.g. an OpenRouter key sent to Anthropic → "invalid x-api-key").
  const key = String(cfg.apiKey || "").trim();
  const base = String(cfg.baseUrl || "").trim();
  // An explicit base URL is the strongest signal (so a local endpoint wins even
  // if a leftover sk-or key is still in the field). Only fall back to key prefix
  // when no base URL is set (the common OpenRouter case).
  let provider;
  if (/openrouter\.ai/i.test(base)) provider = "openrouter";
  else if (/api\.anthropic\.com/i.test(base)) provider = "anthropic";
  else if (base) provider = "openai"; // any other custom base = OpenAI-compatible (local models, etc.)
  else if (/^sk-or-/i.test(key)) provider = "openrouter";
  else if (/^sk-ant-/i.test(key)) provider = "anthropic";
  else provider = cfg.provider || "openrouter";

  // Hosted providers need a key; local/custom OpenAI-compatible servers usually don't.
  if ((provider === "openrouter" || provider === "anthropic") && !key) {
    return { ok: false, error: "No API key set in options." };
  }
  // Per-task model: summaries (mode tldr) use the cheap/free model; everything
  // else (chat/concept/coach/analyze) uses the stronger coach model.
  cfg.model = pickModel(cfg, provider, msg.mode);

  const system = systemFor(msg.persona || "atlas");
  const messages = buildMessages(msg);

  if (provider === "anthropic") return callAnthropic(cfg, messages, system);
  return callOpenAICompatible(cfg, messages, provider, system);
}

function pickModel(cfg, provider, mode) {
  const def = (cfg.model || "").trim();
  // Anthropic-direct uses a single model (openrouter-style ids won't work there).
  if (provider === "anthropic") return def || undefined;
  const summarize = (cfg.modelSummarize || "").trim();
  const coach = (cfg.modelCoach || "").trim();
  if (mode === "tldr") return summarize || def || coach || undefined;
  return coach || def || summarize || undefined;
}

// Build the full chat transcript sent to the model. The FIRST user turn is the
// page context (what I'm looking at); the coach acknowledges it; then the real
// conversation follows. Multi-turn callers (the Coach chat) pass `msg.history`
// so follow-ups — e.g. grading a quiz answer — remember the earlier turns.
// Single-shot callers (Brief / Traffic) pass no history and we append the
// mode-specific instruction as the final user turn.
function buildMessages(msg) {
  const messages = [
    { role: "user", content: pageContextBlock(msg) },
    { role: "assistant", content: "Got it — I've read this page and I'm ready. What do you need?" },
  ];
  const history = Array.isArray(msg.history) ? msg.history.slice(-10) : [];
  if (history.length) {
    for (const h of history) {
      const role = (h.role === "assistant" || h.role === "coach") ? "assistant" : "user";
      const content = String(h.content || h.text || "").slice(0, 6000);
      if (content) messages.push({ role, content });
    }
    // The model must answer, so the transcript has to end on a user turn.
    if (messages[messages.length - 1].role !== "user") {
      messages.push({ role: "user", content: modeInstruction(msg.mode || "chat", msg) });
    }
  } else {
    messages.push({ role: "user", content: modeInstruction(msg.mode || "tldr", msg) });
  }
  // Collapse consecutive same-role turns — Anthropic requires strict user/assistant
  // alternation, and a coach-only chat entry before a quick action can produce two
  // assistant turns in a row.
  const merged = [];
  for (const m of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else merged.push({ role: m.role, content: m.content });
  }
  return merged;
}

// The page-context turn: full visible text + structured extract + signals.
function pageContextBlock(msg) {
  const ctx = msg.context || {};
  const lab = msg.lab || (ctx && ctx.lab) || null;
  const signals = [];
  if (lab && lab.isLab) signals.push(`ARENA: This is a hands-on LAB${lab.difficulty ? " (" + lab.difficulty + ")" : ""}${lab.status ? ", status: " + lab.status : ""}. Coach me through it — do NOT hand me the solution.`);
  else signals.push("ARENA: This looks like a reading lesson (not a hands-on lab).");
  if (msg.concept) signals.push(`LIKELY TOPIC (auto-detected): ${msg.concept}.`);
  if (msg.storageKeys && msg.storageKeys.length) signals.push(`STORAGE KEYS visible (names only): ${msg.storageKeys.join(", ")}.`);
  if (msg.selection) signals.push(`I HIGHLIGHTED: "${String(msg.selection).slice(0, 400)}".`);

  const fullText = String(ctx.fullText || "").slice(0, 12000);
  return [
    `PLATFORM: ${msg.siteLabel || "unknown"}`,
    "",
    "PAGE SIGNALS:",
    ...signals.map((s) => "- " + s),
    "",
    "FULL VISIBLE PAGE TEXT (secrets stripped — the real content is in here; IGNORE nav / product / marketing chrome and teach the actual lesson/content on this page):",
    "```",
    fullText || "(no visible text captured)",
    "```",
    "",
    "STRUCTURED EXTRACT (title / headings / forms / links):",
    "```",
    JSON.stringify(trimCtx(ctx), null, 1).slice(0, 4000),
    "```",
    "",
    "That's what's on my screen. Read it, then help with what I ask next.",
  ].join("\n");
}

function modeInstruction(mode, msg) {
  if (mode === "help") {
    return `I'm looking at this page and said: "${msg.question || ""}".\n` +
      `I'm probably stuck or confused. Using the FULL VISIBLE PAGE TEXT above:\n` +
      `1) Explain what I'm asking about, clearly and simply — a few lines, plain English.\n` +
      `2) Then give me concrete, actionable steps: "Right now you can: 1) … 2) … 3) …".\n` +
      `Actionable and specific, not vague questions. Only hold back a ready-to-paste exploit/lab-solution payload — for that, point me the right way. No methodology, no lens, no fluff.`;
  }
  if (mode === "chat") {
    return `I asked: "${msg.question || ""}". Answer directly and simply using the page content; explain fully, only withhold a ready-to-paste exploit payload. If I'm stuck, end with "Right now you can: 1)… 2)… 3)…". Short and plain. No methodology.`;
  }
  if (mode === "concept") {
    return `Explain "${msg.phrase || ""}" simply, in the context of this page: what it means and why it matters, in a few lines. Then "Right now you can: 1)… 2)… 3)…" (what to look at / do). No fluff, no methodology, no exploit payloads.`;
  }
  if (mode === "concepts") {
    return `Explain the CORE CONCEPTS of THIS page/section simply — each key idea in one or two short bullets: what it means and why it matters. Plain English, high signal, no fluff, no methodology.`;
  }
  if (mode === "quiz") {
    return `Give me ONE multiple-choice question (options A, B, C, D) that tests the key content of THIS page/section. Show only the question and the four options — do NOT reveal or hint at the correct answer yet. End by asking: "What's your answer? (A, B, C or D)".`;
  }
  // Default = the fast TL;DR.
  return `Give me a fast TL;DR of THIS page as up to 10 short bullet points — ONLY the key ideas that actually matter, no fluff, no methodology, no assessment lens. One line per bullet, plain English. Finish with a single line: "**Bottom line:** …". I want to digest it in ~30 seconds and move on.`;
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

async function callAnthropic(cfg, messages, system) {
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
      messages: messages,
    }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.error ? data.error.message : "API error" };
  const text = (data.content || []).map((c) => c.text || "").join("").trim();
  return { ok: true, text };
}

async function callOpenAICompatible(cfg, messages, provider, system) {
  const isOR = provider === "openrouter";
  const base = cfg.baseUrl || (isOR ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1");
  const model = cfg.model || (isOR ? "anthropic/claude-3.5-sonnet" : "gpt-4o-mini");
  const headers = { "content-type": "application/json" };
  if (cfg.apiKey) headers.authorization = "Bearer " + cfg.apiKey; // local servers often need no key
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
        messages: [{ role: "system", content: system }, ...messages],
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
