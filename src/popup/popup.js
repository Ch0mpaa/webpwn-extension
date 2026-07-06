/*
 * WebPwn Coach — Popup controller
 * Orchestrates: persona selection, context extraction (via content script),
 * redaction + preview, and rendering of TL;DR / Coach / Concept modes.
 * All rendering uses the offline WPC.engine. AI is opt-in and only fires
 * on the redacted context the user can preview first.
 */
const WPC = globalThis.WPC;

const state = {
  persona: "atlas",
  mode: "tldr",
  raw: null, // raw extracted context
  clean: null, // redacted context
  redactions: 0,
  site: { id: "generic", label: "Generic Web Application", badge: "Generic Mode" },
  llmEnabled: false,
  lastConceptPhrase: "",
  hlConceptId: null,
  hlLevel: 1,
  hlSummary: null,
  hlPlan: null,
};

const $ = (s) => document.querySelector(s);
const el = {
  siteBadge: $("#siteBadge"),
  personaRow: $("#personaRow"),
  personaIntro: $("#personaIntro"),
  tabs: $("#tabs"),
  output: $("#output"),
  emptyState: $("#emptyState"),
  previewMeta: $("#previewMeta"),
  previewBody: $("#previewBody"),
  redactNote: $("#redactNote"),
  aiBtn: $("#aiBtn"),
  statusMsg: $("#statusMsg"),
  optsBtn: $("#optsBtn"),
};

init();

async function init() {
  const store = await chrome.storage.local.get(["persona", "llmEnabled"]);
  state.persona = store.persona || "atlas";
  state.llmEnabled = !!store.llmEnabled;
  markPersona();
  el.aiBtn.classList.toggle("hidden", !state.llmEnabled);

  bindUI();
  await loadContext();
  render();
}

function bindUI() {
  el.personaRow.addEventListener("click", (e) => {
    const b = e.target.closest(".persona");
    if (!b) return;
    state.persona = b.dataset.persona;
    chrome.storage.local.set({ persona: state.persona });
    markPersona();
    render();
  });
  el.tabs.addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b) return;
    state.mode = b.dataset.mode;
    [...el.tabs.children].forEach((t) => t.classList.toggle("active", t === b));
    render();
  });
  el.aiBtn.addEventListener("click", enrichWithAI);
  el.optsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
}

function markPersona() {
  [...el.personaRow.children].forEach((b) =>
    b.classList.toggle("active", b.dataset.persona === state.persona)
  );
  const p = WPC.getPersona(state.persona);
  el.personaIntro.textContent = `${p.icon} ${p.name} — ${p.blurb}`;
}

async function loadContext() {
  const tab = await activeTab();
  if (!tab) return fail("No active tab.");
  try {
    let resp = await sendToTab(tab.id, { type: "WPC_EXTRACT" });
    if (!resp || !resp.ok) {
      // Content script may not be present (opened before install / restricted page).
      await injectContent(tab.id);
      resp = await sendToTab(tab.id, { type: "WPC_EXTRACT" });
    }
    if (!resp || !resp.ok || !resp.context) return fail("Can't read this page (restricted URL?).");

    state.raw = resp.context;
    state.site = WPC.detectSite(resp.context);
    const red = WPC.redactContext(resp.context);
    state.clean = red.context;
    state.redactions = red.redactions;

    el.siteBadge.textContent = state.site.badge;
    updatePreview();
  } catch (e) {
    fail("Extraction error: " + e.message);
  }
}

function updatePreview() {
  const s = state.raw.stats || {};
  el.previewMeta.textContent = `${s.headers || 0}h · ${s.paragraphs || 0}p · ${s.forms || 0}form · ${s.links || 0}link · ${s.code || 0}code`;
  el.previewBody.textContent = previewText(state.clean);
  el.redactNote.textContent =
    state.redactions > 0
      ? `🔒 ${state.redactions} secret-like value(s) redacted. Passwords are never collected.`
      : "🔒 No secrets detected. Passwords are never collected.";
}

function previewText(c) {
  if (!c) return "(nothing)";
  const parts = [];
  if (c.title) parts.push("TITLE: " + c.title);
  if (c.headers && c.headers.length) parts.push("HEADERS:\n" + c.headers.map((h) => " • " + h.text).join("\n"));
  if (c.paragraphs && c.paragraphs.length) parts.push("TEXT:\n" + c.paragraphs.slice(0, 8).map((p) => " • " + p).join("\n"));
  if (c.forms && c.forms.length)
    parts.push("FORMS:\n" + c.forms.map((f) => ` • ${f.method} ${f.action} [${f.fields.map((x) => x.name + ":" + x.type).join(", ")}]`).join("\n"));
  if (c.buttons && c.buttons.length) parts.push("BUTTONS: " + c.buttons.join(", "));
  if (c.code && c.code.length) parts.push("CODE:\n" + c.code.slice(0, 4).map((x) => " • " + x).join("\n"));
  return parts.join("\n\n");
}

function fail(msg) {
  el.siteBadge.textContent = "unavailable";
  el.previewBody.textContent = msg;
  state.clean = null;
}

// ---- Rendering ---------------------------------------------------------------

function render() {
  if (el.emptyState) el.emptyState.remove();
  if (!state.clean) {
    el.output.innerHTML = `<div class="card"><p class="muted">Open a learning page (PortSwigger, HTB, Juice Shop, DVWA…) and reopen me. I can't read browser-internal pages.</p></div>`;
    return;
  }
  if (state.mode === "tldr") return renderTLDR();
  if (state.mode === "coach") return renderCoach();
  if (state.mode === "concept") return renderConcept();
  if (state.mode === "highlight") return renderHighlight();
}

function renderTLDR() {
  const d = WPC.engine.buildTLDR(state.clean, { persona: state.persona });
  el.personaIntro.textContent = d.personaIntro;
  const chips = d.concepts.map((c) => `<span class="concept-chip" data-id="${c.id}">${esc(c.name)}</span>`).join("");
  el.output.innerHTML = `
    ${chips ? `<div class="concept-chips">${chips}</div>` : ""}
    ${card("Summary", `<p>${esc(d.summary)}</p>`)}
    ${card("Why it matters (consultant)", `<p>${esc(d.whyItMatters)}</p>`)}
    ${card(`Assessment Lens · via ${esc(d.lensSource)}`, lensTable(d.lens))}
    ${card("Mental model", `<div class="mental">🧭 ${esc(d.mentalModel)}</div>`)}
    ${card("Common beginner mistakes", ul(d.beginnerMistakes))}
    ${card("Common senior thinking", ul(d.seniorThinking))}
    ${card(d.siteFraming.title, frameChain(d.siteFraming.chain) + `<p class="muted" style="margin-top:6px">${esc(d.siteFraming.note)}</p>`)}
    ${card("Think like a consultant", frameChain(d.consultantChain))}
    ${card("Next observation", `<p class="next">▶ ${esc(d.nextObservation)}</p><p class="nudge">${esc(d.nudge)}</p>`)}
  `;
  wireChips();
}

function renderCoach() {
  const d = WPC.engine.buildCoach(state.clean, { persona: state.persona });
  el.personaIntro.textContent = d.intro;
  const qs = d.questions
    .map((q) => `<li><span class="q-concept">${esc(q.concept)}</span>${esc(q.text)}</li>`)
    .join("");
  const hintBlocks = d.hints
    .map(
      (h) => `
    <div class="hint-box" data-concept="${h.conceptId}" data-total="${h.hints.length}" data-shown="0">
      <button class="hint-btn">💡 Reveal a hint for ${esc(h.concept)} (0/${h.hints.length})</button>
      <div class="hint-out"></div>
    </div>`
    )
    .join("");
  el.output.innerHTML = `
    ${card("Coach mode — I ask, you think", `<ul class="q-list">${qs}</ul>`)}
    ${card("Stuck? Hints are locked until you ask", hintBlocks + `<p class="nudge" style="margin-top:8px">${esc(d.nudge)}</p>`)}
  `;
  wireHints();
}

function renderConcept() {
  const sel = state.lastConceptPhrase;
  const searchBar = `
    <div class="concept-search">
      <input id="conceptInput" type="text" placeholder="Type or paste a term (JWT, IDOR, SSRF…)" value="${esc(sel)}" />
      <button id="conceptGo">Explain</button>
    </div>
    <p class="muted" style="font-size:11px;margin:-4px 0 10px">Tip: on the page, highlight text → right-click → “Explain with WebPwn Coach”.</p>`;

  let body = "";
  if (sel) {
    const d = WPC.engine.buildConcept(sel, { persona: state.persona });
    body = conceptHtml(d);
  } else {
    body = `<div class="concept-chips">${WPC.KNOWLEDGE.map(
      (c) => `<span class="concept-chip" data-id="${c.id}">${esc(c.name)}</span>`
    ).join("")}</div>`;
  }
  el.output.innerHTML = searchBar + body;
  $("#conceptGo").addEventListener("click", () => {
    state.lastConceptPhrase = $("#conceptInput").value.trim();
    renderConcept();
  });
  $("#conceptInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#conceptGo").click();
  });
  wireChips();
}

function conceptHtml(d) {
  if (!d.found) {
    return `${card("No curated card yet", `<p class="muted">${esc(d.message)}</p>`)}
      <div class="concept-chips">${d.suggestions.map((s) => `<span class="concept-chip">${esc(s)}</span>`).join("")}</div>`;
  }
  return `
    ${card(d.name, `<p>${esc(d.simple)}</p><p class="muted"><b>Real-world:</b> ${esc(d.example)}</p>`)}
    ${card("How to identify", ul(d.identify))}
    ${card("What to test", ul(d.test))}
    ${card("Common mistakes", ul(d.mistakes))}
    ${card("Mental model", `<div class="mental">🧭 ${esc(d.mental)}</div>`)}
    ${card("Coach asks", `<ul class="q-list">${d.coach.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>`)}
    ${card("Assessment Lens", lensTable(d.lens))}
    ${card("Next observation", `<p class="next">▶ ${esc(d.next)}</p>`)}
  `;
}

// ---- Highlight Hint mode -----------------------------------------------------

function detectedConcepts() {
  const found = WPC.detectConcepts(state.clean.bodyText || "", 5).map((f) => f.concept);
  if (!found.length) found.push(WPC.getConcept("trust-boundary"));
  return found;
}

function renderHighlight() {
  const concepts = detectedConcepts();
  if (!state.hlConceptId) state.hlConceptId = concepts[0].id;
  const persona = WPC.getPersona(state.persona);
  el.personaIntro.textContent = `${persona.icon} ${persona.name} — guided highlighting`;

  const options = concepts
    .concat(WPC.KNOWLEDGE.filter((c) => !concepts.some((x) => x.id === c.id)))
    .map((c) => `<option value="${c.id}" ${c.id === state.hlConceptId ? "selected" : ""}>${esc(c.name)}</option>`)
    .join("");

  const levels = [1, 2, 3]
    .map((n) => `<button class="lvl-btn ${state.hlLevel === n ? "active" : ""}" data-level="${n}">L${n}</button>`)
    .join("");

  const legendRows = (WPC.engine.HL_COLORS
    ? Object.keys(WPC.engine.HL_COLORS)
    : []
  )
    .map((k) => {
      const c = WPC.engine.HL_COLORS[k];
      const n = state.hlSummary && state.hlSummary.byColor ? state.hlSummary.byColor[k] || 0 : 0;
      return `<div class="legend-row"><span class="sw" style="background:${c.hex}"></span>
        <b>${esc(c.label)}</b><span class="muted">${esc(c.desc)}</span>
        <span class="legend-count">${state.hlSummary ? n : ""}</span></div>`;
    })
    .join("");

  const summary = state.hlSummary;
  const plan = state.hlPlan;

  el.output.innerHTML = `
    ${card(
      "Guided highlighting",
      `<p class="muted">I mark relevant page elements so you learn to <b>observe</b>. I won't solve the lab — highlights teach where to look.</p>
       <div class="hl-controls">
         <label class="hl-lab">Focus concept
           <select id="hlConcept">${options}</select>
         </label>
         <div class="hl-levels">
           <span class="hl-lab">Hint level</span>
           <div class="lvl-row">${levels}
             <button class="lvl-btn strong ${state.hlLevel === 4 ? "active" : ""}" data-level="4" title="Reveals the exact next action">⚠ Strong (L4)</button>
           </div>
         </div>
         <div class="hl-actions">
           <button id="hlGo" class="primary-btn">✦ Highlight on page</button>
           <button id="hlClear" class="ghost-btn">Clear highlights</button>
         </div>
       </div>`
    )}
    ${plan ? card(plan.levelText.split("·")[0].trim() + " · " + esc(plan.conceptName),
        `<p class="hl-intro">${esc(plan.levelText)}</p><p class="nudge">${esc(plan.intro)}</p>`) : ""}
    ${summary
      ? card(
          `Found ${summary.total} thing(s) to observe`,
          `<div class="legend">${legendRows}</div>
           ${storageLine(summary.storage)}`
        )
      : card("Legend", `<div class="legend">${legendRows}</div>
         <p class="muted" style="font-size:11px;margin-top:6px">Counts appear after you highlight.</p>`)}
    ${plan && plan.lens6 ? card(`Assessment Lens · ${esc(plan.conceptName)}`, lens6Table(plan.lens6)) : ""}
    ${state.hlLevel < 4
      ? `<p class="muted" style="font-size:11px">Want the exact next action? Click <b>⚠ Strong (L4)</b> — that's the only level that spells out what to do.</p>`
      : `<p class="muted" style="font-size:11px">Strong hint active: the concept-relevant marks now name the next action. Everything else stays observation-only.</p>`}
  `;
  wireHighlight();
}

function storageLine(s) {
  if (!s) return "";
  if (!s.cookies && !(s.local || []).length && !(s.session || []).length)
    return `<p class="muted" style="font-size:11px;margin-top:6px">No cookies/storage detected on this page.</p>`;
  const keys = (s.local || []).concat(s.session || []).slice(0, 8);
  return `<div class="hl-store">🗝 <b>Trust boundary — storage</b>: ${s.cookies} cookie(s), ${(s.local || []).length} localStorage, ${(s.session || []).length} sessionStorage.
    ${keys.length ? `<div class="muted" style="font-size:10.5px;margin-top:3px">keys: ${keys.map(esc).join(", ")} <i>(names only — values never read)</i></div>` : ""}</div>`;
}

function lens6Table(l) {
  const order = ["WHO", "WHAT", "WHEN", "WHERE", "HOW", "WHY"];
  return `<table class="lens-tbl">${order
    .map((k) => `<tr><th>${k}</th><td>${esc(l[k])}</td></tr>`)
    .join("")}</table>`;
}

function wireHighlight() {
  const sel = document.getElementById("hlConcept");
  sel.addEventListener("change", () => {
    state.hlConceptId = sel.value;
    state.hlSummary = null;
    state.hlPlan = null;
    renderHighlight();
  });
  el.output.querySelectorAll(".lvl-btn").forEach((b) =>
    b.addEventListener("click", () => {
      state.hlLevel = parseInt(b.dataset.level, 10);
      doHighlight();
    })
  );
  document.getElementById("hlGo").addEventListener("click", doHighlight);
  document.getElementById("hlClear").addEventListener("click", clearHighlight);
}

async function doHighlight() {
  const tab = await activeTab();
  if (!tab) return;
  el.statusMsg.textContent = "Highlighting…";
  const resp = await sendToTab(tab.id, {
    type: "WPC_HIGHLIGHT",
    conceptId: state.hlConceptId,
    level: state.hlLevel,
    persona: state.persona,
  });
  if (resp && resp.ok) {
    state.hlSummary = resp;
    state.hlPlan = resp.plan;
    el.statusMsg.textContent = `Marked ${resp.total} element(s) on the page.`;
  } else {
    el.statusMsg.textContent = "Couldn't highlight this page.";
  }
  renderHighlight();
}

async function clearHighlight() {
  const tab = await activeTab();
  if (!tab) return;
  await sendToTab(tab.id, { type: "WPC_CLEAR_HIGHLIGHT" });
  state.hlSummary = null;
  state.hlPlan = null;
  el.statusMsg.textContent = "Highlights cleared.";
  renderHighlight();
}

// ---- AI enrichment (opt-in) --------------------------------------------------

async function enrichWithAI() {
  if (!state.clean) return;
  el.aiBtn.disabled = true;
  el.statusMsg.textContent = "";
  const spinner = document.createElement("div");
  spinner.className = "card ai-out";
  spinner.innerHTML = `<h3>✦ AI Mentor (${state.mode})</h3><p class="spin">Thinking…</p>`;
  el.output.prepend(spinner);

  const payload = {
    type: "WPC_LLM",
    mode: state.mode,
    context: state.clean, // already redacted + previewable
    siteLabel: state.site.label,
    phrase: state.mode === "concept" ? state.lastConceptPhrase : "",
  };
  try {
    const resp = await chrome.runtime.sendMessage(payload);
    if (resp && resp.ok) {
      spinner.innerHTML = `<h3>✦ AI Mentor (${state.mode})</h3><pre>${esc(resp.text || "(empty)")}</pre>`;
    } else {
      spinner.innerHTML = `<h3>✦ AI Mentor</h3><p class="muted">${esc((resp && resp.error) || "Failed.")}</p>`;
    }
  } catch (e) {
    spinner.innerHTML = `<h3>✦ AI Mentor</h3><p class="muted">${esc(e.message)}</p>`;
  } finally {
    el.aiBtn.disabled = false;
  }
}

// ---- Small view helpers ------------------------------------------------------

function card(title, inner) {
  return `<div class="card"><h3>${esc(title)}</h3>${inner}</div>`;
}
function ul(arr) {
  return `<ul>${(arr || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
}
function lensTable(l) {
  const rows = [
    ["WHO", l.who], ["WHAT", l.what], ["WHEN", l.when], ["WHERE", l.where],
    ["HOW · assessment", l.howAssessment], ["HOW · technical", l.howTechnical],
    ["WHY vulnerable", l.whyVuln], ["WHY it worked", l.whyWorked], ["WHY it failed", l.whyFailed],
    ["VALIDATE", l.validate], ["FIX", l.fix], ["REPORT", l.report], ["INTERVIEW", l.interview],
  ];
  return `<table class="lens-tbl">${rows
    .map((r) => `<tr><th>${esc(r[0])}</th><td>${esc(r[1])}</td></tr>`)
    .join("")}</table>`;
}
function frameChain(chain) {
  const parts = [];
  chain.forEach((c, i) => {
    if (i) parts.push('<span class="arrow">→</span>');
    parts.push(`<span>${esc(c)}</span>`);
  });
  return `<div class="chain">${parts.join("")}</div>`;
}
function wireChips() {
  el.output.querySelectorAll(".concept-chip[data-id]").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.mode = "concept";
      state.lastConceptPhrase = WPC.getConcept(chip.dataset.id)?.name || chip.textContent;
      [...el.tabs.children].forEach((t) => t.classList.toggle("active", t.dataset.mode === "concept"));
      renderConcept();
    });
  });
}
function wireHints() {
  el.output.querySelectorAll(".hint-box").forEach((box) => {
    const btn = box.querySelector(".hint-btn");
    const out = box.querySelector(".hint-out");
    btn.addEventListener("click", () => {
      const shown = parseInt(box.dataset.shown, 10);
      const total = parseInt(box.dataset.total, 10);
      const conceptId = box.dataset.concept;
      const h = WPC.engine.revealHint(conceptId, shown);
      if (!h) {
        btn.disabled = true;
        btn.textContent = "No more hints — back to thinking 🧠";
        return;
      }
      const div = document.createElement("div");
      div.className = "revealed";
      div.textContent = `💡 ${h.hint}`;
      out.appendChild(div);
      const next = shown + 1;
      box.dataset.shown = String(next);
      const concept = WPC.getConcept(conceptId).name;
      btn.textContent =
        next >= total
          ? `That's all hints for ${concept} (${total}/${total})`
          : `💡 Reveal another hint for ${concept} (${next}/${total})`;
      if (next >= total) btn.disabled = true;
    });
  });
}

// ---- Chrome plumbing ---------------------------------------------------------

function activeTab() {
  return new Promise((res) =>
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => res(tabs[0]))
  );
}
function sendToTab(tabId, msg) {
  return new Promise((res) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) return res(null);
      res(resp);
    });
  });
}
async function injectContent(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "src/lib/siteDetect.js",
        "src/lib/redact.js",
        "src/lib/extractor.js",
        "src/lib/knowledge.js",
        "src/lib/personalities.js",
        "src/lib/engine.js",
        "src/content/highlighter.js",
        "src/content/content.js",
      ],
    });
  } catch (_) {}
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
