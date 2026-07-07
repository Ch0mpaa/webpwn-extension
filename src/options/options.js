/* WebPwn Coach — Options controller */
const KEYS = ["persona", "llmEnabled", "provider", "apiKey", "model", "baseUrl"];

const $ = (s) => document.querySelector(s);
const els = {
  llmEnabled: $("#llmEnabled"),
  fields: $("#llmFields"),
  provider: $("#provider"),
  apiKey: $("#apiKey"),
  model: $("#model"),
  baseUrl: $("#baseUrl"),
  save: $("#save"),
  status: $("#status"),
  hint: $("#providerHint"),
};

const PROVIDERS = {
  openrouter: {
    key: "sk-or-v1-… (from openrouter.ai/keys)",
    model: "anthropic/claude-3.5-sonnet",
    base: "https://openrouter.ai/api/v1",
    hint: "OpenRouter: create a key at openrouter.ai/keys, then set a model like anthropic/claude-3.5-sonnet, openai/gpt-4o, or any model id from openrouter.ai/models. Base URL is optional — it defaults correctly.",
  },
  anthropic: {
    key: "sk-ant-…",
    model: "claude-sonnet-5",
    base: "https://api.anthropic.com",
    hint: "Anthropic direct: get a key at console.anthropic.com. Use a model id like claude-sonnet-5 or claude-opus-4-8.",
  },
  openai: {
    key: "sk-…",
    model: "gpt-4o-mini",
    base: "https://api.openai.com/v1",
    hint: "Any OpenAI-compatible endpoint. Set the Base URL to your provider and a matching model id.",
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
  });
  els.status.textContent = "Saved ✓";
  setTimeout(() => (els.status.textContent = ""), 1800);
}
