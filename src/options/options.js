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
};

load();

async function load() {
  const cfg = await chrome.storage.local.get(KEYS);
  const persona = cfg.persona || "atlas";
  const radio = document.querySelector(`input[name=persona][value="${persona}"]`);
  if (radio) radio.checked = true;

  els.llmEnabled.checked = !!cfg.llmEnabled;
  els.provider.value = cfg.provider || "anthropic";
  els.apiKey.value = cfg.apiKey || "";
  els.model.value = cfg.model || "";
  els.baseUrl.value = cfg.baseUrl || "";
  toggleFields();

  els.llmEnabled.addEventListener("change", toggleFields);
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
