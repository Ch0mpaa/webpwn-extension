/* WebPwn Coach — Options controller */
const KEYS = ["persona", "llmEnabled", "provider", "apiKey", "model", "baseUrl", "modelSummarize", "modelCoach"];

const $ = (s) => document.querySelector(s);
const els = {
  llmEnabled: $("#llmEnabled"),
  fields: $("#llmFields"),
  provider: $("#provider"),
  apiKey: $("#apiKey"),
  model: $("#model"),
  baseUrl: $("#baseUrl"),
  modelSummarize: $("#modelSummarize"),
  modelCoach: $("#modelCoach"),
  save: $("#save"),
  status: $("#status"),
  hint: $("#providerHint"),
};

const PROVIDERS = {
  openrouter: {
    key: "sk-or-v1-… (from openrouter.ai/keys)",
    model: "anthropic/claude-3.5-sonnet",
    base: "https://openrouter.ai/api/v1",
    hint: "OpenRouter: key from openrouter.ai/keys. Pick per-task models — Summarize uses a cheap/:free model (append :free for free variants, or use openrouter/auto), Coach uses a stronger one (e.g. anthropic/claude-3.7-sonnet or an opus id). Blank fields fall back to Default model. Browse openrouter.ai/models.",
  },
  anthropic: {
    key: "sk-ant-…",
    model: "claude-sonnet-5",
    base: "https://api.anthropic.com",
    hint: "Anthropic direct: get a key at console.anthropic.com. Use a model id like claude-sonnet-5 or claude-opus-4-8.",
  },
  openai: {
    key: "(blank for local servers)",
    model: "your served model id",
    base: "http://192.168.x.x:8001/v1",
    hint: "Any OpenAI-compatible endpoint, including LOCAL models (vLLM, LM Studio, Ollama /v1, text-generation-webui). Set Base URL to your server's /v1 URL and Default model to whatever it serves. API key can be left blank for local servers. Any base URL that isn't OpenRouter/Anthropic is treated as this. For a single local model, leave the per-task Summarize/Coach fields blank so everything uses the Default model.",
  },
};

load();

async function load() {
  const cfg = await chrome.storage.local.get(KEYS);
  const persona = cfg.persona || "atlas";
  const radio = document.querySelector(`input[name=persona][value="${persona}"]`);
  if (radio) radio.checked = true;

  els.llmEnabled.checked = !!cfg.llmEnabled;
  els.provider.value = cfg.provider || "openrouter";
  els.apiKey.value = cfg.apiKey || "";
  els.model.value = cfg.model || "";
  els.baseUrl.value = cfg.baseUrl || "";
  els.modelSummarize.value = cfg.modelSummarize || "";
  els.modelCoach.value = cfg.modelCoach || "";
  toggleFields();
  applyProvider();

  els.llmEnabled.addEventListener("change", toggleFields);
  els.provider.addEventListener("change", applyProvider);
  els.save.addEventListener("click", save);
  document.querySelectorAll('input[name=persona]').forEach((r) =>
    r.addEventListener("change", () =>
      chrome.storage.local.set({ persona: selectedPersona() })
    )
  );
}

function toggleFields() {
  els.fields.classList.toggle("disabled", !els.llmEnabled.checked);
}
function applyProvider() {
  const p = PROVIDERS[els.provider.value] || PROVIDERS.openrouter;
  els.apiKey.placeholder = p.key;
  els.model.placeholder = p.model;
  els.baseUrl.placeholder = p.base;
  els.hint.textContent = p.hint;
}
function selectedPersona() {
  const r = document.querySelector("input[name=persona]:checked");
  return r ? r.value : "atlas";
}

async function save() {
  await chrome.storage.local.set({
    persona: selectedPersona(),
    llmEnabled: els.llmEnabled.checked,
    provider: els.provider.value,
    apiKey: els.apiKey.value.trim(),
    model: els.model.value.trim(),
    baseUrl: els.baseUrl.value.trim(),
    modelSummarize: els.modelSummarize.value.trim(),
    modelCoach: els.modelCoach.value.trim(),
  });
  els.status.textContent = "Saved ✓";
  setTimeout(() => (els.status.textContent = ""), 1800);
}
