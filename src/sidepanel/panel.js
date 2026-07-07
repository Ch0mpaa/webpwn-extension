/*
 * WebPwn Coach — Side Panel controller
 * The primary UI. Panels: TL;DR · Lens · Elements · Traffic · Highlight ·
 * Memory · Reps · Ask · Proxy · Settings. Reuses the shared WPC engine + the
 * traffic/explain/memory libs. Nothing leaves the browser without consent.
 */
const WPC = globalThis.WPC;

const state = {
  persona: "atlas",
  mode: "ask",
  raw: null,
  clean: null,
  storage: null,
  site: { id: "generic", label: "Generic Web Application", badge: "…" },
  llmEnabled: false,
  bridgeUrl: "http://127.0.0.1:8088",
  proxy: { mode: "direct", burpHost: "127.0.0.1", burpPort: "8080", caidoHost: "127.0.0.1", caidoPort: "8080", customHost: "127.0.0.1", customPort: "8080" },
  settings: { incPageText: true, incCookies: true, incStorage: true, incImport: true },
  recordedUrl: null,
  // per-panel scratch
  hl: { conceptId: null, level: 1, summary: null, plan: null },
  lensConceptId: null,
  traffic: { parsed: null, artifact: null, companion: [], selected: null },
  chat: [],
};

const $ = (s) => document.querySelector(s);
const el = {
  siteBadge: $("#siteBadge"), personaRow: $("#personaRow"), personaIntro: $("#personaIntro"),
  tabs: $("#tabs"), output: $("#output"), aiBtn: $("#aiBtn"), statusMsg: $("#statusMsg"),
  settingsBtn: $("#settingsBtn"), refreshBtn: $("#refreshBtn"),
};

// Panels whose content depends on the current page — auto re-render on nav.
const PAGE_MODES = ["tldr", "lens", "elements", "highlight"];
let rescanTimer = null;

init();

async function init() {
  const st = await chrome.storage.local.get(["persona", "llmEnabled", "bridgeUrl", "companionUrl", "wpc_settings", "wpc_proxy"]);
  state.persona = st.persona || "atlas";
  state.llmEnabled = !!st.llmEnabled;
  state.bridgeUrl = st.bridgeUrl || st.companionUrl || state.bridgeUrl;
  if (st.wpc_settings) Object.assign(state.settings, st.wpc_settings);
  if (st.wpc_proxy) Object.assign(state.proxy, st.wpc_proxy);
  markPersona();
  bindUI();
  await loadContext();
  render();
}

function bindUI() {
  el.personaRow.addEventListener("click", (e) => {
    const b = e.target.closest(".persona"); if (!b) return;
    state.persona = b.dataset.persona;
    chrome.storage.local.set({ persona: state.persona });
    markPersona(); render();
  });
  el.tabs.addEventListener("click", (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    state.mode = b.dataset.mode;
    el.settingsBtn.classList.remove("active");
    [...el.tabs.children].forEach((t) => t.classList.toggle("active", t === b));
    render();
  });
  el.settingsBtn.addEventListener("click", () => {
    state.mode = "settings";
    [...el.tabs.children].forEach((t) => t.classList.remove("active"));
    el.settingsBtn.classList.add("active");
    render();
  });
  el.aiBtn.addEventListener("click", enrichAI);
  el.refreshBtn.addEventListener("click", async () => {
    el.statusMsg.textContent = "Re-scanning…";
    await loadContext();
    el.statusMsg.textContent = state.clean ? "Re-scanned." : "Couldn't read this page.";
    render();
  });

  // Auto-detect the current page: re-scan when the active tab changes or a page
  // finishes loading — no manual refresh needed.
  chrome.tabs.onActivated.addListener(() => scheduleRescan());
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    if (tab && tab.active && (info.status === "complete" || info.url)) scheduleRescan();
  });
  if (chrome.windows && chrome.windows.onFocusChanged) {
    chrome.windows.onFocusChanged.addListener((wid) => { if (wid !== chrome.windows.WINDOW_ID_NONE) scheduleRescan(); });
  }
  // Content script tells us when a single-page-app navigation happened.
  chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === "WPC_NAV") scheduleRescan(); });
}

function scheduleRescan() {
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(autoRescan, 300);
}

async function autoRescan() {
  const prevUrl = state.raw && state.raw.url;
  await loadContext();
  const newUrl = state.raw && state.raw.url;
  if (newUrl === prevUrl) return; // same page — nothing to redraw
  // Page changed: reset page-scoped scratch so panels reflect the new page.
  state.hl = { conceptId: null, level: state.hl.level, summary: null, plan: null };
  state.lensConceptId = null;
  // Only redraw page-dependent panels; don't clobber typing in Traffic/Ask/etc.
  if (PAGE_MODES.includes(state.mode)) render();
}

function markPersona() {
  [...el.personaRow.children].forEach((b) => b.classList.toggle("active", b.dataset.persona === state.persona));
}

async function loadContext() {
  const tab = await activeTab();
  if (!tab) return;
  try {
    let resp = await sendToTab(tab.id, { type: "WPC_EXTRACT" });
    if (!resp || !resp.ok) { await injectContent(tab.id); resp = await sendToTab(tab.id, { type: "WPC_EXTRACT" }); }
    if (resp && resp.ok && resp.context) {
      state.raw = resp.context;
      state.site = WPC.detectSite(resp.context);
      state.clean = WPC.redactContext(resp.context).context;
      const lab = state.raw.lab;
      el.siteBadge.textContent =
        state.site.badge + (lab && lab.isLab ? " · 🧪" + (lab.status ? " " + lab.status : " lab") : "");
      const s = await sendToTab(tab.id, { type: "WPC_STORAGE" });
      state.storage = s && s.ok ? s.storage : null;
    } else {
      el.siteBadge.textContent = "no page";
      state.clean = null;
    }
  } catch (_) { state.clean = null; }
}

// ---- Router -----------------------------------------------------------------

function render() {
  if (state.traffic.poll) { clearInterval(state.traffic.poll); state.traffic.poll = null; }
  el.aiBtn.classList.toggle("hidden", !(state.llmEnabled && (state.mode === "tldr" || state.mode === "traffic")));
  const need = ["tldr", "lens", "elements", "highlight"];
  if (need.includes(state.mode) && !state.clean) {
    el.output.innerHTML = `<div class="card"><p class="muted">Open a learning page (PortSwigger, HTB, Juice Shop, DVWA…) — I detect it automatically. I can't read browser-internal pages.</p></div>`;
    return;
  }
  ({ tldr: renderTLDR, lens: renderLens, elements: renderElements, traffic: renderTraffic,
     highlight: renderHighlight, memory: renderMemory, reps: renderReps, ask: renderAsk,
     proxy: renderProxy, settings: renderSettings }[state.mode] || renderTLDR)();
}

// ---- TL;DR ------------------------------------------------------------------

function renderTLDR() {
  const d = WPC.engine.buildTLDR(state.clean, { persona: state.persona });
  el.personaIntro.textContent = d.personaIntro;
  // memory: record concept-encountered once per page
  if (d.concepts[0] && state.recordedUrl !== state.raw.url) {
    state.recordedUrl = state.raw.url;
    WPC.memory.record({ type: "concept-encountered", conceptId: d.concepts[0].id });
  }
  const chips = d.concepts.map((c) => `<span class="chip" data-concept="${c.id}">${esc(c.name)}</span>`).join("");
  const lab = d.lab;
  const labBanner = lab && lab.isLab
    ? `<div class="warn">🧪 <b>Hands-on lab${lab.difficulty ? " · " + esc(lab.difficulty) : ""}${lab.status ? " · " + esc(lab.status) : ""}.</b> You're in the arena — I'll coach you through it, I won't solve it. Work the methodology, not the payload.</div>`
    : "";
  const m = d.mission;
  const missionCard = m ? `
    <div class="card mission">
      <h3>🎯 Your mission here</h3>
      <p class="mission-fear">${esc(m.fear)}</p>
      <p><b class="ok-line">First job:</b> ${esc(m.firstJob)}</p>
      <p class="muted small">${esc(m.notYet)}</p>
      <div class="lab" style="margin-top:6px">You're looking for</div>
      <ul>${m.lookFor.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <p class="mission-prove">❓ ${esc(m.prove)}</p>
    </div>` : "";
  // AI is the only thing that can truly summarize arbitrary content (HTB modules,
  // AI red-teaming, anything outside the built-in web-vuln library).
  const aiHero = state.llmEnabled
    ? `<div class="card mission">
         <h3>✦ Read this page with ATLAS</h3>
         <p class="muted small">Fast 10-point TL;DR of the key ideas — no fluff. Works on any topic.</p>
         <div class="row">
           <button id="aiSummarize" class="btn primary">✦ 10-point TL;DR</button>
           <button id="aiSelection" class="btn">Explain highlighted text</button>
         </div>
       </div>`
    : `<div class="warn">Turn on the AI backend (⚙ Settings → Open options → OpenRouter) so I can summarize <i>any</i> page, not just the built-in web-vuln topics. Then ✦ buttons appear here.</div>`;

  const weakBanner = d.weakDetection
    ? `<div class="warn">🤔 This page is outside my built-in web-vuln library, so the offline breakdown below is generic. For a real summary of <b>this</b> page, use <b>✦ Summarize this page</b> above.</div>`
    : "";

  el.output.innerHTML = `
    ${aiHero}
    <div id="aiOut"></div>
    ${labBanner}
    ${weakBanner}
    ${whatIRead()}
    <p class="muted small" style="margin:2px 0 8px">Topic (for reference): ${chips || esc(d.lensSource)}</p>
    ${card("In plain English", `<p>${esc(d.summary)}</p>`)}
    <details class="preview" style="margin-top:4px">
      <summary class="small muted">Show the methodology breakdown (lens, mental model, mistakes) — off to the side</summary>
      <div style="margin-top:8px">
        ${missionCard}
        ${card("Why it matters (consultant)", `<p>${esc(d.whyItMatters)}</p>`)}
        ${card(`Assessment Lens · ${esc(d.lensSource)}`, lensTable(fullLens(d.lens, d.lensSource)))}
        ${card("Mental model", `<div class="mental">🧭 ${esc(d.mentalModel)}</div>`)}
        ${card("What to observe — browser first (before Burp)", ul(d.browserFirst))}
        ${card("Beginner mistakes", ul(d.beginnerMistakes))}
        ${card("Senior thinking", ul(d.seniorThinking))}
        ${card(d.siteFraming.title, frameChain(d.siteFraming.chain) + `<p class="muted small" style="margin-top:6px">${esc(d.siteFraming.note)}</p>`)}
        ${card("Next observation", `<p class="next">▶ ${esc(d.nextObservation)}</p><p class="nudge">${esc(d.nudge)}</p>`)}
      </div>
    </details>`;
  wireConceptChips();
  const sb = $("#aiSummarize"); if (sb) sb.addEventListener("click", summarizeWithAI);
  const se = $("#aiSelection"); if (se) se.addEventListener("click", explainSelection);
}

// Transparency: show exactly what the extractor read, so wrong-region grabs
// (e.g. a portal/dashboard instead of the lesson) are obvious. Hit ⟳ to re-read.
function whatIRead() {
  const c = state.clean || {};
  const s = c.stats || {};
  const head = (c.headers || []).slice(0, 6).map((h) => "• " + h.text).join("\n");
  const firstPara = (c.paragraphs || [])[0] || "(no body text found — likely a portal/nav page; open the actual lesson and hit ⟳)";
  return `<details class="preview" style="margin:0 0 8px">
    <summary class="small muted">👁 What I read — “${esc(c.title || "")}” · ${s.paragraphs || 0}p · ${s.headers || 0}h · ${s.buttons || 0}btn · ${s.links || 0}link</summary>
    <div class="pre" style="margin-top:6px">${esc((head ? head + "\n\n" : "") + firstPara).slice(0, 900)}</div>
    <p class="muted small" style="margin-top:4px">Wrong content? Open the actual lesson, then hit ⟳ (top-right) to re-scan.</p>
  </details>`;
}

// Ask ATLAS to summarize the actual page (works on any topic).
async function summarizeWithAI() {
  if (!state.clean) return;
  const out = $("#aiOut") || el.output;
  out.innerHTML = `<div class="card ai-out"><h3>✦ ATLAS</h3><p class="spin">Reading the page…</p></div>`;
  try {
    const resp = await chrome.runtime.sendMessage(Object.assign(
      { type: "WPC_LLM", mode: "tldr", context: state.clean }, await llmMeta()));
    out.innerHTML = `<div class="card ai-out"><h3>✦ ATLAS — this page</h3><div class="md">${aiHtml(resp)}</div></div>`;
  } catch (e) { out.innerHTML = `<div class="card ai-out"><h3>✦ ATLAS</h3><p class="muted">${esc(e.message)}</p></div>`; }
}

// Grab the user's current page selection and have ATLAS explain it in context.
async function explainSelection() {
  const out = $("#aiOut") || el.output;
  const tab = await activeTab(); if (!tab) return;
  const sel = await sendToTab(tab.id, { type: "WPC_GET_SELECTION" });
  const text = sel && sel.selection ? sel.selection.trim() : "";
  if (!text) { out.innerHTML = `<div class="card"><p class="muted">Highlight some text on the page first, then click “Explain highlighted text”.</p></div>`; return; }
  out.innerHTML = `<div class="card ai-out"><h3>✦ ATLAS explains</h3><p class="muted small">“${esc(text.slice(0, 120))}${text.length > 120 ? "…" : ""}”</p><p class="spin">Thinking…</p></div>`;
  try {
    const resp = await chrome.runtime.sendMessage(Object.assign(
      { type: "WPC_LLM", mode: "concept", phrase: text, context: state.clean || {} }, await llmMeta()));
    out.innerHTML = `<div class="card ai-out"><h3>✦ ATLAS explains</h3><p class="muted small">“${esc(text.slice(0, 120))}${text.length > 120 ? "…" : ""}”</p><div class="md">${aiHtml(resp)}</div></div>`;
  } catch (e) { out.innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p></div>`; }
}

// ---- Lens -------------------------------------------------------------------

function renderLens() {
  const detected = detectedConcepts();
  if (!state.lensConceptId) state.lensConceptId = detected[0].id;
  const all = detected.concat(WPC.KNOWLEDGE.filter((c) => !detected.some((x) => x.id === c.id)));
  const opts = all.map((c) => `<option value="${c.id}" ${c.id === state.lensConceptId ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  const concept = WPC.getConcept(state.lensConceptId);
  el.output.innerHTML = `
    ${card("Assessment Lens", `<div class="lab">Concept</div><select id="lensSel">${opts}</select>`)}
    ${card(esc(concept.name), `<p>${esc(concept.simple)}</p><div class="mental">🧭 ${esc(concept.mental)}</div>`)}
    ${card("Full lens (+ DEBRIEF)", lensTable(fullLens(concept.lens, concept.name)))}
    ${card("Coach asks", `<ul>${concept.coach.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>`)}`;
  $("#lensSel").addEventListener("change", (e) => { state.lensConceptId = e.target.value; renderLens(); });
}

function fullLens(l, name) {
  return Object.assign({}, l, {
    DEBRIEF: `What did this teach you about ${(name || "the concept").toLowerCase()}? What would you check first next time?`,
  });
}

// ---- Elements ---------------------------------------------------------------

function renderElements() {
  const c = state.clean;
  const st = state.storage || { cookies: 0, local: [], session: [] };
  const forms = (c.forms || []).map((f) =>
    `<li><span class="tag">${esc(f.method)}</span> ${esc(f.action)} — <span class="muted">${f.fields.map((x) => esc(x.name) + ":" + esc(x.type)).join(", ")}</span></li>`).join("");
  el.output.innerHTML = `
    ${card("What's visible here", `<p class="muted small">Users, objects, actions, workflows — read the surface before Burp.</p>`)}
    ${card(`Forms (${(c.forms || []).length})`, forms ? `<ul>${forms}</ul>` : `<p class="muted">none</p>`)}
    ${card(`Buttons (${(c.buttons || []).length})`, listTags(c.buttons))}
    ${card(`Links (${(c.links || []).length})`, (c.links || []).slice(0, 20).map((l) => `<div class="small">• ${esc(l.text)} <span class="muted">→ ${esc(l.href)}</span></div>`).join("") || `<p class="muted">none</p>`)}
    ${card(`Code / snippets (${(c.code || []).length})`, (c.code || []).slice(0, 6).map((x) => `<div class="pre">${esc(x)}</div>`).join("") || `<p class="muted">none visible</p>`)}
    ${card("Cookies / storage (trust boundary)", storageBlock(st))}
    ${card("Find it in the Inspector (learn to see it yourself)", ul(WPC.engine.browserFirstFor(detectedConcepts()[0])))}
    ${card("Likely trust boundaries", ul(trustBoundaryHints(c, st)))}
    ${card("Observe first / ignore", `<p><b class="ok-line">Observe:</b> forms that change state, object IDs, auth/session indicators, API-looking links.</p><p class="muted"><b>Ignore (fluff):</b> nav chrome, marketing copy, footers.</p>`)}`;
}
function listTags(arr) { return (arr || []).length ? `<div class="chips">${arr.slice(0, 24).map((b) => `<span class="tag">${esc(b)}</span>`).join("")}</div>` : `<p class="muted">none</p>`; }
function storageBlock(s) {
  const keys = (s.local || []).concat(s.session || []);
  return `<p class="small">${s.cookies} cookie(s) · ${(s.local || []).length} localStorage · ${(s.session || []).length} sessionStorage</p>
    ${keys.length ? `<p class="muted small">keys: ${keys.map(esc).join(", ")} <i>(names only — values never read)</i></p>` : `<p class="muted small">no storage keys</p>`}`;
}
function trustBoundaryHints(c, st) {
  const out = [];
  if ((c.forms || []).some((f) => f.fields.some((x) => x.type === "password"))) out.push("A login/credential form — the auth boundary (anon → authenticated).");
  if ((c.forms || []).some((f) => f.method !== "GET")) out.push("State-changing forms — client → server boundary; authz/CSRF must hold.");
  if (st.cookies || (st.local || []).length) out.push("Cookies/storage carry identity — browser ↔ server session boundary.");
  if ((c.links || []).some((l) => /api|admin|account|settings/i.test(l.href))) out.push("Privileged/API routes — role ↔ role and user ↔ server boundaries.");
  if (!out.length) out.push("Every input that reaches the server is a boundary — validate on the trusted side.");
  return out;
}

// ---- Highlight (reuses the content highlighter) -----------------------------

function detectedConcepts() {
  const found = (WPC.detectConceptsForContext
    ? WPC.detectConceptsForContext(state.clean, 5)
    : WPC.detectConcepts(state.clean.bodyText || "", 5)).map((f) => f.concept);
  if (!found.length) found.push(WPC.getConcept("trust-boundary"));
  return found;
}

function renderHighlight() {
  const concepts = detectedConcepts();
  if (!state.hl.conceptId) state.hl.conceptId = concepts[0].id;
  const all = concepts.concat(WPC.KNOWLEDGE.filter((c) => !concepts.some((x) => x.id === c.id)));
  const opts = all.map((c) => `<option value="${c.id}" ${c.id === state.hl.conceptId ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  const levels = [1, 2, 3].map((n) => `<button class="btn lvl ${state.hl.level === n ? "primary" : ""}" data-level="${n}">L${n}</button>`).join("");
  const legend = WPC.engine.HL_COLORS;
  const rows = Object.keys(legend).map((k) => {
    const n = state.hl.summary && state.hl.summary.byColor ? state.hl.summary.byColor[k] || 0 : "";
    return `<div class="legend-row"><span class="sw" style="background:${legend[k].hex}"></span><b>${esc(legend[k].label)}</b><span class="muted">${esc(legend[k].desc)}</span><span class="legend-count">${n}</span></div>`;
  }).join("");
  const plan = state.hl.plan, summ = state.hl.summary;
  el.output.innerHTML = `
    ${card("Guided highlighting", `<p class="muted small">Marks page elements so you learn to observe. Won't solve the lab.</p>
      <div class="lab">Focus concept</div><select id="hlSel">${opts}</select>
      <div class="lab" style="margin-top:8px">Hint level</div>
      <div class="row">${levels}<button class="btn pink lvl ${state.hl.level === 4 ? "active" : ""}" data-level="4">⚠ Strong (L4)</button></div>
      <div class="row"><button id="hlGo" class="btn primary">✦ Highlight on page</button><button id="hlClear" class="btn red">Clear</button></div>`)}
    ${plan ? card(plan.levelText.split("·")[0].trim() + " · " + esc(plan.conceptName), `<p>${esc(plan.levelText)}</p><p class="nudge">${esc(plan.intro)}</p>`) : ""}
    ${card(summ ? `Found ${summ.total} to observe` : "Legend", `<div class="legend">${rows}</div>${summ ? storageMini(summ.storage) : `<p class="muted small" style="margin-top:6px">Counts appear after you highlight.</p>`}`)}
    ${plan ? card(`Lens · ${esc(plan.conceptName)}`, lensTable(plan.lens6)) : ""}
    ${state.hl.level < 4 ? `<p class="muted small">Want the exact next action? Click <b>⚠ Strong (L4)</b>.</p>` : `<p class="muted small">Strong hint active — concept-relevant marks name the next action.</p>`}`;
  $("#hlSel").addEventListener("change", (e) => { state.hl.conceptId = e.target.value; state.hl.summary = null; state.hl.plan = null; renderHighlight(); });
  el.output.querySelectorAll(".lvl").forEach((b) => b.addEventListener("click", () => { state.hl.level = parseInt(b.dataset.level, 10); doHighlight(); }));
  $("#hlGo").addEventListener("click", doHighlight);
  $("#hlClear").addEventListener("click", clearHighlight);
}
function storageMini(s) {
  if (!s || (!s.cookies && !(s.local || []).length && !(s.session || []).length)) return "";
  return `<div class="hl-store">🗝 storage: ${s.cookies} cookie(s), ${(s.local || []).length} local, ${(s.session || []).length} session <span class="muted">(names only)</span></div>`;
}
async function doHighlight() {
  const tab = await activeTab(); if (!tab) return;
  el.statusMsg.textContent = "Highlighting…";
  const resp = await sendToTab(tab.id, { type: "WPC_HIGHLIGHT", conceptId: state.hl.conceptId, level: state.hl.level, persona: state.persona });
  if (resp && resp.ok) {
    state.hl.summary = resp; state.hl.plan = resp.plan;
    el.statusMsg.textContent = `Marked ${resp.total} element(s).`;
    if (state.hl.level >= 4) WPC.memory.record({ type: "hint-requested", conceptId: state.hl.conceptId, note: "strong hint" });
  } else el.statusMsg.textContent = "Couldn't highlight this page.";
  renderHighlight();
}
async function clearHighlight() {
  const tab = await activeTab(); if (!tab) return;
  await sendToTab(tab.id, { type: "WPC_CLEAR_HIGHLIGHT" });
  state.hl.summary = null; state.hl.plan = null; el.statusMsg.textContent = "Cleared.";
  renderHighlight();
}

// ---- Traffic ----------------------------------------------------------------

function renderTraffic() {
  const sel = state.traffic.selected;
  el.output.innerHTML = `
    ${card("Live traffic", `<p class="muted small">In Burp, use the <b>WebPwn Coach</b> tab → <b>Send latest proxy request</b> (or right-click → Send to WebPwn Coach). It appears here — click one and I'll walk it.</p>
      <div class="lab">Bridge URL (this is the coach bridge on :8088 — NOT Burp's :8080)</div>
      <div class="row"><input id="tBridge" type="text" value="${esc(state.bridgeUrl)}" style="flex:3 1 140px"><button id="tBridge88" class="btn">Use :8088</button></div>
      ${proxyPortWarn()}
      <div id="tStatus" class="small muted" style="margin-top:8px">checking bridge…</div>
      <div id="tList" class="tlist" style="margin-top:8px"></div>
      <div class="row"><button id="tRefresh" class="btn">Refresh now</button><button id="tClear" class="btn red">Clear captured</button></div>`)}
    ${card("Or import manually", `<details><summary class="small muted">Paste a raw HTTP request/response, or a JWT / JSON / SQL / code snippet</summary>
      <textarea id="tIn" placeholder="Paste HTTP request/response or a snippet…" style="margin-top:8px"></textarea>
      <div class="row"><button id="tExplain" class="btn primary">Explain</button>
      <label class="btn" style="text-align:center">Import HAR<input id="harIn" type="file" accept=".har,application/json" hidden></label></div></details>`)}
    <div id="tResult"></div>`;
  $("#tExplain").addEventListener("click", () => explainPasted($("#tIn").value));
  $("#harIn").addEventListener("change", importHar);
  $("#tRefresh").addEventListener("click", () => pollCompanion());
  $("#tClear").addEventListener("click", clearCompanion);
  const setBridge = (url) => { state.bridgeUrl = url; chrome.storage.local.set({ bridgeUrl: url }); renderTraffic(); };
  $("#tBridge").addEventListener("change", (e) => setBridge((e.target.value || "").trim() || state.bridgeUrl));
  $("#tBridge88").addEventListener("click", () => setBridge("http://127.0.0.1:8088"));
  if (state.traffic.companion.length) renderCompanionList();
  if (sel) renderTrafficResult(sel);
  // Auto-poll the companion so proxied traffic streams in live.
  pollCompanion();
  state.traffic.poll = setInterval(() => pollCompanion(), 3000);
}

function bridgeBase() { return state.bridgeUrl.replace(/\/$/, ""); }
function proxyPortWarn() {
  let port = "";
  try { port = new URL(state.bridgeUrl).port; } catch (_) {}
  if (["8080", "8081", "8082", "8083"].includes(port)) {
    return `<div class="warn">⚠ Bridge URL is on port ${esc(port)} — that's your <b>proxy</b> (Burp/Caido), not the coach bridge. The bridge runs on <b>:8088</b>. Click “Use :8088”.</div>`;
  }
  return "";
}

async function pollCompanion() {
  const st = $("#tStatus");
  try {
    const r = await fetch(bridgeBase() + "/traffic/recent");
    const data = await r.json();
    const prev = state.traffic.companion.length;
    state.traffic.companion = data.items || [];
    if (st) st.innerHTML = `<span class="ok-line">● bridge connected</span> — ${state.traffic.companion.length} request(s) received from Burp/Caido`;
    if (state.traffic.companion.length !== prev || !document.querySelector("#tList .titem")) renderCompanionList();
  } catch (e) {
    if (st) st.innerHTML = `<span class="bad-line">● can't reach bridge at ${esc(bridgeBase())}</span> (${esc(e.message || "fetch failed")}). Start it: <span class="mono">node companion/bridge.js</span>, and check the port matches Settings → Traffic bridge URL.`;
  }
}

function explainPasted(text) {
  text = (text || "").trim();
  if (!text) return;
  // WebPwn traffic JSON (Burp extension → "Copy as WebPwn JSON" fallback).
  let obj = null;
  if (text[0] === "{") { try { obj = JSON.parse(text); } catch (_) {} }
  if (obj && (obj.method || obj.url) && (obj.reqHeaders || obj.path || obj.url)) {
    const parsed = companionToParsed(normalizeWebpwn(obj));
    const sensitive = obj.redacted === "true" || !!(obj.reqHeaders && (obj.reqHeaders.Authorization || obj.reqHeaders.Cookie || obj.reqHeaders.authorization || obj.reqHeaders.cookie));
    state.traffic.selected = { source: "paste-json", parsed, sensitive, raw: obj.raw || "", analyzed: false };
    el.statusMsg.textContent = `Imported ${obj.method || ""} ${(obj.path || obj.url || "").slice(0, 40)} from Burp.`;
    return renderTraffic();
  }
  const kind = WPC.explain.classify(text);
  if (kind === "http") {
    state.traffic.selected = { source: "paste", parsed: WPC.http.parseText(text) };
  } else {
    state.traffic.selected = { source: "paste", artifact: WPC.explain.explainArtifact(text) };
  }
  renderTraffic();
}

// Map a WebPwn traffic JSON object to the shape companionToParsed expects.
function normalizeWebpwn(o) {
  let host = "";
  try { host = new URL(o.url, "http://x").host; } catch (_) {}
  return {
    method: o.method || "", url: o.url || o.path || "", path: o.path || "", host,
    reqHeaders: lowerKeys(o.reqHeaders), reqBody: o.reqBody || "",
    status: o.status || null, contentType: (o.respHeaders && (o.respHeaders["Content-Type"] || o.respHeaders["content-type"])) || "",
    respHeaders: o.respHeaders || {}, respBody: o.respBody || "",
  };
}
function lowerKeys(h) {
  const out = {};
  for (const k of Object.keys(h || {})) out[k.toLowerCase()] = h[k];
  return out;
}

function importHar(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const res = WPC.http.parseHar(String(reader.result));
    if (!res.ok) { el.statusMsg.textContent = res.error; return; }
    state.traffic.companion = res.items.map((it) => ({ ...it, _har: true }));
    el.statusMsg.textContent = `HAR: ${res.count} requests across ${res.hosts.length} host(s).`;
    renderTraffic();
  };
  reader.readAsText(file);
}

async function clearCompanion() {
  try { await fetch(bridgeBase() + "/traffic", { method: "DELETE" }); } catch (_) {}
  state.traffic.companion = []; state.traffic.selected = null; renderTraffic();
}
function renderCompanionList() {
  const list = $("#tList"); if (!list) return;
  list.innerHTML = state.traffic.companion.slice(0, 60).map((t, i) =>
    `<div class="titem" data-i="${i}"><span class="m">${esc(t.method)}</span><span class="u">${esc(t.url || t.path || "")}</span>${t.tool ? `<span class="tag">${esc(t.tool)}</span>` : ""}<span class="s">${esc(String(t.status || ""))}</span></div>`).join("");
  list.querySelectorAll(".titem").forEach((row) => row.addEventListener("click", () => selectCompanion(parseInt(row.dataset.i, 10))));
}
async function selectCompanion(i) {
  const item = state.traffic.companion[i];
  let parsed;
  if (item._har) {
    parsed = { request: { method: item.method, url: item.url, path: safePath(item.url), query: "", host: item.host, headers: [], params: item.params || [], hasAuth: item.hasAuth, hasCookie: false, contentType: item.contentType, body: "" }, response: { status: item.status, statusText: "", contentType: item.contentType, headers: [] } };
  } else {
    try {
      const r = await fetch(bridgeBase() + "/traffic/" + item.id);
      const full = await r.json();
      parsed = companionToParsed(full);
      state.traffic.selected = { source: "bridge", parsed, sensitive: full.hasSensitive, raw: full.raw || "", analyzed: false };
      return renderTraffic();
    } catch (_) { el.statusMsg.textContent = "Couldn't load detail."; return; }
  }
  state.traffic.selected = { source: "har", parsed };
  renderTraffic();
}
function companionToParsed(full) {
  let search = "";
  try { search = new URL(full.url, "http://x").search; } catch (_) {}
  const params = WPC.http.extractParams(search, full.reqBody || "", full.contentType || "");
  return {
    request: { method: full.method, url: full.url, path: full.path || safePath(full.url), query: search, host: full.host, headers: [], params, hasAuth: !!(full.reqHeaders && full.reqHeaders.authorization), hasCookie: !!(full.reqHeaders && full.reqHeaders.cookie), contentType: full.contentType, body: full.reqBody || "" },
    response: { status: full.status, statusText: "", contentType: full.contentType, headers: [], body: full.respBody || "" },
  };
}
function safePath(u) { try { return new URL(u).pathname; } catch (_) { return u || ""; } }

function renderTrafficResult(sel) {
  const box = $("#tResult"); if (!box) return;
  if (sel.artifact) { box.innerHTML = artifactHtml(sel.artifact); wireConceptChips(); return; }
  if (!sel.parsed || !sel.parsed.ok && !sel.parsed.request) { box.innerHTML = card("No parse", `<p class="muted">Couldn't parse that as HTTP.</p>`); return; }
  const p = sel.parsed;
  const sensitiveWarn = sel.sensitive
    ? `<div class="warn">⚠ This request contains sensitive headers (Authorization / Cookie / token). They're redacted before anything is sent to AI. Reveal raw stays local.</div>`
    : "";
  box.innerHTML = `
    ${sensitiveWarn}
    ${card("Selected request", `<div class="pre">${esc((p.request ? p.request.method + " " + p.request.path + (p.request.query || "") : "") + (p.response ? "  →  " + p.response.status : ""))}</div>
      <div class="row">
        <button class="btn" data-act="explain">Explain (local)</button>
        <button class="btn" data-act="lens">Map to Lens</button>
        <button class="btn" data-act="who">Users/Objects</button>
        <button class="btn pink" data-act="test">Next Test</button>
        <button class="btn" data-act="evidence">Evidence</button>
      </div>
      <div class="row">
        ${sel.raw ? `<button class="btn" data-act="raw">Reveal raw (local)</button>` : ""}
        ${state.llmEnabled ? `<button id="tAnalyze" class="btn primary">✦ Analyze with ATLAS (sends to AI)</button>` : `<span class="muted small">Enable AI in Settings to Analyze with ATLAS.</span>`}
      </div>
      <p class="muted small">Local buttons never leave your browser. Only “Analyze with ATLAS” sends (redacted) data to the AI — and only when you click it.</p>`)}
    <div id="tAct"></div>`;
  box.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => trafficAction(b.dataset.act, p, sel)));
  const az = $("#tAnalyze");
  if (az) az.addEventListener("click", () => analyzeRequest(p, sel));
}

async function analyzeRequest(p, sel) {
  const out = $("#tAct");
  out.innerHTML = card("✦ ATLAS analysis", `<p class="spin">Analyzing…</p>`);
  const tl = WPC.explain.trafficLens(p);
  try {
    const resp = await chrome.runtime.sendMessage(Object.assign(
      { type: "WPC_LLM", mode: "chat",
        question: `Walk me through this captured request as my mentor. Method ${p.request.method} ${p.request.path}${p.request.query || ""}, status ${p.response ? p.response.status : "?"}. Cover: parameters, cookies/auth presence, object IDs, status meaning, response differences to look for, the trust boundary, and the single likely next test. Ask me questions; don't hand me the exploit.`,
        context: state.clean || {} },
      await llmMeta()));
    out.innerHTML = card("✦ ATLAS analysis", `<div class="md">${aiHtml(resp)}</div>`);
    if (sel) sel.analyzed = true;
  } catch (e) { out.innerHTML = card("✦ ATLAS analysis", `<p class="muted">${esc(e.message)}</p>`); }
}
function trafficAction(act, p, sel) {
  const out = $("#tAct");
  if (act === "raw") {
    out.innerHTML = card("Raw (local only — never sent)", `<div class="pre">${esc((sel && sel.raw) || "(no raw available)")}</div>`);
    return;
  }
  const tl = WPC.explain.trafficLens(p);
  if (act === "explain") {
    const s = [`${p.request ? p.request.method + " " + p.request.path : ""}`, ...(p.request ? p.request.params.map((x) => `param ${x.name}${x.idish ? " (looks like an id ⚑)" : ""} in ${x.where}`) : [])];
    out.innerHTML = card("Explain request", ul(s) + `<p class="muted small">Auth: ${p.request && p.request.hasAuth ? "present (redacted)" : "none"} · Cookie: ${p.request && p.request.hasCookie ? "present" : "none"}</p>`);
  } else if (act === "lens") {
    out.innerHTML = card(`Assessment Lens · ${esc(tl.concept.name)}`, lensTable(tl.lens));
  } else if (act === "who") {
    out.innerHTML = card("Users / Objects", `<p><b>Objects:</b> ${tl.usersObjects.objects.map(esc).join(", ") || "—"}</p><p><b>Users:</b> ${tl.usersObjects.users.map(esc).join(", ") || "—"}</p><p class="muted small">Whose object is each of these? That's the ownership question.</p>`);
  } else if (act === "test") {
    out.innerHTML = card("Suggest next test (coaching)", `<ul>${tl.nextTest.map((q) => `<li>${esc(q)}</li>`).join("")}</ul><p class="muted small">Questions, not payloads. Form a hypothesis first.</p>`);
    WPC.memory.record({ type: "hint-requested", conceptId: tl.concept.id, note: "traffic next-test" });
  } else if (act === "evidence") {
    out.innerHTML = card("Evidence template", `<div class="pre">${esc(tl.evidence)}</div><div class="row"><button id="evCopy" class="btn">Copy</button></div>`);
    const btn = $("#evCopy"); if (btn) btn.addEventListener("click", () => { navigator.clipboard.writeText(tl.evidence); el.statusMsg.textContent = "Evidence copied."; WPC.memory.record({ type: "report-written", conceptId: tl.concept.id }); });
  }
}

function artifactHtml(a) {
  if (!a.ok) return card("Explainer", `<p class="muted">${esc(a.message)}</p>`);
  const conceptChip = a.concept ? `<span class="chip" data-concept="${a.concept.id}">${esc(a.concept.name)}</span>` : "";
  return `
    ${card(esc(a.type), `<p class="muted small">${esc(a.format)}</p>`)}
    ${card("Structure", ul(a.structure))}
    ${card("What it does", `<p>${esc(a.whatItDoes)}</p>`)}
    ${card("Why it matters", `<p>${esc(a.why)}</p>`)}
    ${card("Beginner: recognise next time", `<p>${esc(a.beginnerNext)}</p>`)}
    ${card("Vulnerability family", `<p>${esc(a.vulnFamily)}</p>${conceptChip ? `<div class="chips" style="margin-top:6px">${conceptChip}</div>` : ""}`)}
    ${a.coach && a.coach.length ? card("Coach asks", `<ul>${a.coach.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>`) : ""}`;
}

// ---- Memory -----------------------------------------------------------------

async function renderMemory() {
  const prof = await WPC.memory.profile();
  const practised = prof.rows.filter((r) => r.reps > 0 || r.hints > 0 || r.seen > 0);
  const shown = practised.length ? practised : prof.rows.slice(0, 6);
  const rows = shown.map((r) => {
    const acc = r.accuracy === null ? "—" : Math.round(r.accuracy * 100) + "%";
    const iv = r.interview === null ? "—" : r.interview + "%";
    const barPct = r.reps === 0 ? 4 : Math.max(6, Math.min(100, (r.accuracy || 0) * 100));
    const color = r.level === "Solid" ? "var(--green)" : r.level === "Struggling" ? "var(--red)" : r.level === "Practicing" ? "var(--amber)" : "var(--gray)";
    return `<div class="skill"><div class="top"><span>${esc(r.skill)}</span><span class="lvl-${r.level}">${r.level}</span></div>
      <div class="bar"><span style="width:${barPct}%;background:${color}"></span></div>
      <div class="small muted mono">${r.reps} rep(s) · acc ${acc} · ${r.hints} hint(s) · interview ${iv}</div></div>`;
  }).join("") || `<p class="muted small">Nothing practised yet. Do a rep to start earning a profile.</p>`;
  const events = prof.events.slice(0, 12).map((e) => `<div class="small muted">• ${esc(e.type)} — ${esc(e.skill)}${e.note ? " (" + esc(e.note) + ")" : ""}</div>`).join("") || `<p class="muted small">No activity yet.</p>`;
  const skillOpts = WPC.memory.SKILLS.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  el.output.innerHTML = `
    ${card("Skill profile — earned, not guessed", `<p class="muted small">Competence comes only from completed reps + accuracy. Page views don't count.</p>${rows}`)}
    ${card("Log a rep (be honest — this is how you level up)", `<div class="lab">Skill</div><select id="mSkill">${skillOpts}</select>
      <div class="row">
        <button class="btn" data-rep="1">✓ Solved it unaided</button>
        <button class="btn" data-log="hint-requested">Solved with a hint</button>
        <button class="btn red" data-rep="0">✗ Couldn't solve it</button>
      </div>
      <div class="row"><button class="btn" data-log="report-written">Wrote a report</button></div>
      <div class="lab" style="margin-top:8px">Interview answer (0–100)</div>
      <div class="row"><input id="mIv" type="text" placeholder="e.g. 70" style="max-width:90px"><button id="mIvBtn" class="btn">Log interview</button></div>`)}
    ${card("Recent activity", events)}
    ${card("", `<div class="row"><button id="mReset" class="btn red">Reset memory</button></div>`)}`;
  el.output.querySelectorAll("[data-rep]").forEach((b) => b.addEventListener("click", async () => {
    await WPC.memory.record({ type: "rep-completed", correct: b.dataset.rep === "1", skill: $("#mSkill").value });
    el.statusMsg.textContent = "Rep logged."; renderMemory();
  }));
  el.output.querySelectorAll("[data-log]").forEach((b) => b.addEventListener("click", async () => {
    await WPC.memory.record({ type: b.dataset.log, skill: $("#mSkill").value });
    el.statusMsg.textContent = "Logged."; renderMemory();
  }));
  $("#mIvBtn").addEventListener("click", async () => {
    const v = parseInt($("#mIv").value, 10);
    if (isNaN(v)) { el.statusMsg.textContent = "Enter a 0–100 score."; return; }
    await WPC.memory.record({ type: "interview", score: v, skill: $("#mSkill").value });
    el.statusMsg.textContent = "Interview logged."; renderMemory();
  });
  $("#mReset").addEventListener("click", async () => { await WPC.memory._reset(); renderMemory(); });
}

// ---- Reps -------------------------------------------------------------------

async function renderReps() {
  const recs = await WPC.memory.recommend(4);
  if (!recs.length) { el.output.innerHTML = card("Recommended reps", `<p class="muted">Practice a bit first — I'll recommend reps for your weak areas.</p>`); return; }
  el.output.innerHTML = recs.map((r) => card(`${esc(r.skill)} · ${esc(r.level)}`, `
    <p class="small"><b>Why:</b> ${esc(r.why)}</p>
    <p class="small muted"><b>Prerequisite:</b> ${esc(r.prerequisite)}</p>
    <div class="lab" style="margin-top:6px">Practice reps</div>
    <ul>${r.reps.map((x) => `<li><span class="tag">${esc(x.platform)}</span> ${esc(x.label)}</li>`).join("")}</ul>`)).join("");
}

// ---- Coach (the default) — "here's what I see, what do you need?" -----------

function pageOneLiner() {
  const c = state.clean;
  if (!c || !(c.title || (c.headers && c.headers.length) || c.fullText)) {
    return "I can't read this page — open a lesson/lab and I'll take a look.";
  }
  let topic = (c.title || "").replace(/\s*[|\-–—].*$/, "").trim();
  if (!topic || topic.length < 3) topic = (c.headers && c.headers[0] && c.headers[0].text) || "this page";
  const where = state.site && state.site.label && state.site.id !== "generic" ? " on " + state.site.label : "";
  return `I can see you're on **${topic}**${where}.`;
}

function renderAsk() {
  el.personaIntro.textContent = "";
  const msgs = state.chat.map((m) => m.role === "user"
    ? `<div class="msg user">${esc(m.text)}</div>`
    : `<div class="msg coach">${renderMarkdown(m.text)}</div>`).join("");
  const opener = `${pageOneLiner()}\n\n**What are you stuck on?** Tell me in your own words — "I'm lost in X", "what does this mean?", or paste a request / JWT / code — and I'll explain it and tell you what to do.`;
  const toolbar = state.llmEnabled
    ? `<div class="row" style="margin-bottom:8px">
         <button id="coachTldr" class="btn primary">📄 TL;DR this page (10 pts)</button>
         <button id="coachSel" class="btn">Explain what I highlighted</button>
       </div>`
    : `<div class="warn">Turn on the AI backend (⚙ Settings → Open options) so I can summarize and explain. Without it I can only point you at concepts.</div>`;
  el.output.innerHTML = `
    ${toolbar}
    <div class="chat" id="chat">${msgs || `<div class="msg coach">${renderMarkdown(opener)}</div>`}</div>
    <div class="chat-in"><textarea id="askIn" placeholder="What do you need help with?"></textarea><button id="askGo" class="btn primary">Send</button></div>
    ${state.chat.length ? `<div class="row" style="margin-top:6px"><button id="askClear" class="btn ghost-btn">New question</button></div>` : ""}`;
  const go = $("#askGo"), input = $("#askIn");
  const send = () => askSend(input.value);
  go.addEventListener("click", send);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  const clr = $("#askClear"); if (clr) clr.addEventListener("click", () => { state.chat = []; renderAsk(); });
  const t = $("#coachTldr"); if (t) t.addEventListener("click", () => coachRun("tldr", "TL;DR this page"));
  const cs = $("#coachSel"); if (cs) cs.addEventListener("click", coachExplainSelection);
  const chat = $("#chat"); if (chat) chat.scrollTop = chat.scrollHeight;
  if (input) input.focus();
}

// Run an AI request and drop the answer straight into the Coach chat.
async function coachRun(mode, userLabel, extra) {
  state.chat.push({ role: "user", text: userLabel });
  state.chat.push({ role: "coach", text: "_…reading the page…_" });
  renderAsk();
  try {
    const resp = await chrome.runtime.sendMessage(Object.assign(
      { type: "WPC_LLM", mode, context: state.clean || {} }, extra || {}, await llmMeta()));
    state.chat.pop();
    state.chat.push({ role: "coach", text: resp && resp.ok ? cleanAI(resp.text) : "AI unavailable: " + ((resp && resp.error) || "error") });
  } catch (e) { state.chat.pop(); state.chat.push({ role: "coach", text: "AI error: " + e.message }); }
  renderAsk();
}

async function coachExplainSelection() {
  const tab = await activeTab(); if (!tab) return;
  const sel = await sendToTab(tab.id, { type: "WPC_GET_SELECTION" });
  const text = sel && sel.selection ? sel.selection.trim() : "";
  if (!text) {
    state.chat.push({ role: "coach", text: "Highlight some text on the page first, then click **Explain what I highlighted**." });
    return renderAsk();
  }
  coachRun("concept", `Explain: "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`, { phrase: text });
}

async function askSend(text) {
  text = (text || "").trim(); if (!text) return;
  const input = $("#askIn"); if (input) input.value = "";
  state.chat.push({ role: "user", text });
  if (state.llmEnabled) {
    state.chat.push({ role: "coach", text: "_…thinking…_" });
    renderAsk();
    try {
      const resp = await chrome.runtime.sendMessage(Object.assign(
        { type: "WPC_LLM", mode: "help", question: text, context: state.clean || {} },
        await llmMeta()));
      state.chat.pop();
      state.chat.push({ role: "coach", text: resp && resp.ok ? cleanAI(resp.text) : "AI unavailable: " + ((resp && resp.error) || "error") });
    } catch (e) { state.chat.pop(); state.chat.push({ role: "coach", text: "AI error: " + e.message }); }
  } else {
    state.chat.push({ role: "coach", text: coachReply(text) + "\n\n_(Turn on the AI backend in ⚙ Settings so I can explain things in full, not just point.)_" });
  }
  renderAsk();
}

function coachReply(text) {
  // Artifact? explain it.
  const kind = WPC.explain.classify(text);
  if (["jwt", "json", "sql", "sql-error", "php", "java", "python", "node", "javascript", "http"].includes(kind)) {
    const a = WPC.explain.explainArtifact(text);
    if (a.ok) return `That looks like ${a.type}.\n• ${a.whatItDoes}\n• Why it matters: ${a.why}\n• Family: ${a.vulnFamily}\nAsk yourself: ${(a.coach || ["What is it and where does it enter the system?"])[0]}`;
  }
  const strong = /\bstrong hint\b|\bnext action\b|\bjust tell me\b/i.test(text);
  const found = WPC.detectConcepts(text, 1);
  const c = found[0] ? found[0].concept : WPC.getConcept("trust-boundary");
  if (strong) {
    WPC.memory.record({ type: "hint-requested", conceptId: c.id, note: "chat strong hint" });
    return `Strong hint on ${c.name}:\n▶ ${c.next}\n(Still your call to execute it — and to prove impact safely.)`;
  }
  return `Sounds like ${c.name}.\n🧭 ${c.mental}\nStart here:\n• ${c.coach[0]}\n• ${c.coach[1] || c.coach[0]}\nWhat do you observe?`;
}

// ---- Proxy ------------------------------------------------------------------

// ---- Part 1: Proxy Switcher (FoxyProxy replacement — chrome.proxy only) ------

const PROXY_LABELS = { direct: "DIRECT", burp: "BURP ACTIVE", caido: "CAIDO ACTIVE", custom: "CUSTOM ACTIVE" };

function proxyTargets() {
  const p = state.proxy;
  return {
    burp: { host: p.burpHost || "127.0.0.1", port: p.burpPort || "8080" },
    caido: { host: p.caidoHost || "127.0.0.1", port: p.caidoPort || "8080" },
    custom: { host: p.customHost || "127.0.0.1", port: p.customPort || "8080" },
  };
}
function bridgePort() { try { return new URL(state.bridgeUrl).port || "8088"; } catch (_) { return "8088"; } }

async function renderProxy() {
  const mode = state.proxy.mode || "direct";
  const t = proxyTargets();
  const active = mode !== "direct";
  const tgt = active ? t[mode] : null;
  el.output.innerHTML = `
    ${active ? `<div class="warn">⚠ <b>${PROXY_LABELS[mode]}</b> — all browser traffic is routed through ${esc(tgt.host)}:${esc(tgt.port)}. Click Direct when you're done.</div>` : ""}
    ${card("Proxy Switcher", `<p class="muted small">Your FoxyProxy replacement. Routes Chrome's traffic — it does NOT intercept or modify anything (that's Burp/Caido's job).</p>
      <p class="small">Status: <b class="${active ? "bad-line" : "ok-line"}">${PROXY_LABELS[mode]}</b>${active ? ` <span class="muted">→ ${esc(tgt.host)}:${esc(tgt.port)}</span>` : ""}</p>
      <div class="row">
        <button class="btn ${mode === "direct" ? "primary" : ""}" data-px="direct">Direct</button>
        <button class="btn ${mode === "burp" ? "primary" : ""}" data-px="burp">Burp</button>
        <button class="btn ${mode === "caido" ? "primary" : ""}" data-px="caido">Caido</button>
        <button class="btn ${mode === "custom" ? "primary" : ""}" data-px="custom">Custom</button>
      </div>
      <div class="row"><button id="pxDirect" class="btn red">Restore Direct</button></div>`)}
    ${card("Targets (host / port)", `
      ${proxyRow("burp", "Burp", t.burp)}
      ${proxyRow("caido", "Caido", t.caido)}
      ${proxyRow("custom", "Custom", t.custom)}
      <div class="row"><button id="pxSave" class="btn primary">Save targets</button></div>
      <p class="muted small" style="margin-top:6px">${bridgePort()} (the bridge) always stays Direct so its API isn't routed through the proxy.</p>`)}`;
  el.output.querySelectorAll("[data-px]").forEach((b) => b.addEventListener("click", () => applyProxyMode(b.dataset.px)));
  bindEl("#pxDirect", () => applyProxyMode("direct"));
  bindEl("#pxSave", saveProxyTargets);
}
function proxyRow(key, label, t) {
  return `<div class="lab">${label}</div><div class="row">
    <input id="px_${key}_host" type="text" value="${esc(t.host)}" placeholder="host" style="flex:2 1 120px">
    <input id="px_${key}_port" type="text" value="${esc(t.port)}" placeholder="port" style="flex:1 1 60px">
  </div>`;
}
function bindEl(sel, fn) { const e = $(sel); if (e) e.addEventListener("click", fn); }

async function saveProxyTargets() {
  for (const k of ["burp", "caido", "custom"]) {
    state.proxy[k + "Host"] = ($(`#px_${k}_host`).value || "").trim() || "127.0.0.1";
    state.proxy[k + "Port"] = ($(`#px_${k}_port`).value || "").trim() || "8080";
  }
  await chrome.storage.local.set({ wpc_proxy: state.proxy });
  el.statusMsg.textContent = "Targets saved.";
  if (state.proxy.mode !== "direct") applyProxyMode(state.proxy.mode); else renderProxy();
}

function pacFor(host, port) {
  const bp = bridgePort();
  return `function FindProxyForURL(url, host){ if(url.indexOf('127.0.0.1:${bp}')>-1||url.indexOf('localhost:${bp}')>-1)return 'DIRECT'; return 'PROXY ${host}:${port}'; }`;
}
async function applyProxyMode(mode) {
  state.proxy.mode = mode;
  await chrome.storage.local.set({ wpc_proxy: state.proxy });
  try {
    if (mode === "direct") {
      await chrome.proxy.settings.clear({ scope: "regular" });
      el.statusMsg.textContent = "DIRECT — system proxy restored.";
    } else {
      const t = proxyTargets()[mode];
      await chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data: pacFor(t.host, t.port) } }, scope: "regular" });
      el.statusMsg.textContent = `${PROXY_LABELS[mode]} → ${t.host}:${t.port}. ⚠ all browser traffic routed.`;
    }
  } catch (e) { el.statusMsg.textContent = "Proxy error: " + e.message; }
  renderProxy();
}

// ---- Settings ---------------------------------------------------------------

function renderSettings() {
  const s = state.settings;
  el.output.innerHTML = `
    ${card("Coach personality", `<div class="chips">${["atlas", "bit", "byte"].map((p) => `<span class="chip ${state.persona === p ? "" : ""}" data-persona="${p}">${WPC.getPersona(p).icon} ${WPC.getPersona(p).name}</span>`).join("")}</div>`)}
    ${card("What context may be used", `<p class="muted small">Nothing is sent anywhere unless you enable the AI backend and click AI. These control what's included then.</p>
      ${toggle("incPageText", "Page text", s.incPageText)}
      ${toggle("incCookies", "Cookie names", s.incCookies)}
      ${toggle("incStorage", "Storage key names", s.incStorage)}
      ${toggle("incImport", "Imported traffic", s.incImport)}`)}
    ${card("Traffic bridge URL", `<p class="muted small">Where the Burp/Caido bridge listens (receive-only).</p><input id="setBridge" type="text" value="${esc(state.bridgeUrl)}"><div class="row"><button id="setSave" class="btn primary">Save</button></div>`)}
    ${card("AI backend & keys", `<p class="muted small">AI is optional and off by default. Keys are stored in extension storage. Configure it on the full options page.</p><div class="row"><button id="openOpts" class="btn">Open options</button></div>`)}
    ${card("Privacy", `<ul class="small"><li>Passwords are never collected.</li><li>Tokens/cookies/JWTs redacted by default.</li><li>Preview context before any send; nothing auto-sends.</li></ul>`)}`;
  el.output.querySelectorAll("[data-persona]").forEach((c) => c.addEventListener("click", () => { state.persona = c.dataset.persona; chrome.storage.local.set({ persona: state.persona }); markPersona(); renderSettings(); }));
  el.output.querySelectorAll("[data-toggle]").forEach((t) => t.addEventListener("change", () => { state.settings[t.dataset.toggle] = t.checked; chrome.storage.local.set({ wpc_settings: state.settings }); }));
  $("#setSave").addEventListener("click", () => { state.bridgeUrl = $("#setBridge").value.trim() || state.bridgeUrl; chrome.storage.local.set({ bridgeUrl: state.bridgeUrl }); el.statusMsg.textContent = "Saved."; });
  $("#openOpts").addEventListener("click", () => chrome.runtime.openOptionsPage());
}
function toggle(key, label, checked) {
  return `<label class="small" style="display:flex;gap:8px;align-items:center;margin:5px 0"><input type="checkbox" data-toggle="${key}" ${checked ? "checked" : ""}> ${esc(label)}</label>`;
}

// ---- AI enrichment ----------------------------------------------------------

// Common page signals sent to the AI so it "sees what I see" and coaches to it.
async function llmMeta() {
  let conceptName = null;
  try {
    const f = WPC.detectConceptsForContext(state.clean || {}, 1);
    conceptName = f[0] ? f[0].concept.name : null;
  } catch (_) {}
  const keys = state.settings.incStorage && state.storage
    ? (state.storage.local || []).concat(state.storage.session || []).slice(0, 10)
    : [];
  let memory = null;
  try {
    const prof = await WPC.memory.profile();
    const weak = prof.rows.filter((r) => r.reps > 0 && r.level !== "Solid").slice(0, 3)
      .map((r) => `${r.skill} (${r.reps} reps, ${r.accuracy === null ? "—" : Math.round(r.accuracy * 100) + "%"})`);
    if (weak.length) memory = weak.join("; ");
  } catch (_) {}
  let request = null;
  const sel = state.traffic.selected;
  if (sel && sel.parsed && sel.parsed.request) {
    const rq = sel.parsed.request;
    request = `${rq.method} ${rq.path}${rq.query || ""} · params: ${(rq.params || []).map((p) => p.name).join(", ") || "none"} · status: ${sel.parsed.response ? sel.parsed.response.status : "?"}`;
  }
  return {
    persona: state.persona,
    siteLabel: state.site.label,
    lab: state.raw ? state.raw.lab : null,
    concept: conceptName,
    storageKeys: keys,
    memory,
    request,
  };
}

async function enrichAI() {
  if (!state.clean) return;
  el.statusMsg.textContent = "Asking AI…";
  const box = document.createElement("div"); box.className = "card";
  box.innerHTML = `<h3>✦ AI Mentor (${state.mode})</h3><p class="muted">Thinking…</p>`;
  el.output.prepend(box);
  try {
    const resp = await chrome.runtime.sendMessage(Object.assign(
      { type: "WPC_LLM", mode: state.mode === "traffic" ? "tldr" : state.mode, context: state.clean },
      await llmMeta()));
    box.innerHTML = `<h3>✦ AI Mentor</h3><div class="md">${aiHtml(resp, "failed")}</div>`;
  } catch (e) { box.innerHTML = `<h3>✦ AI Mentor</h3><p class="muted">${esc(e.message)}</p>`; }
  el.statusMsg.textContent = "";
}

// ---- shared view helpers ----------------------------------------------------

function card(title, inner) { return `<div class="card">${title ? `<h3>${esc(title)}</h3>` : ""}${inner}</div>`; }
function ul(arr) { return `<ul>${(arr || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`; }
function lensTable(l) {
  return `<table class="lens-tbl">${Object.keys(l).map((k) => `<tr><th>${esc(k)}</th><td>${esc(l[k])}</td></tr>`).join("")}</table>`;
}
function frameChain(chain) {
  return `<div class="chain">${chain.map((c, i) => (i ? '<span class="arrow">→</span>' : "") + `<span>${esc(c)}</span>`).join("")}</div>`;
}
function wireConceptChips() {
  el.output.querySelectorAll(".chip[data-concept]").forEach((chip) => chip.addEventListener("click", () => {
    state.lensConceptId = chip.dataset.concept; state.mode = "lens";
    [...el.tabs.children].forEach((t) => t.classList.toggle("active", t.dataset.mode === "lens"));
    render();
  }));
}

// ---- chrome plumbing --------------------------------------------------------

function activeTab() { return new Promise((res) => chrome.tabs.query({ active: true, currentWindow: true }, (t) => res(t[0]))); }
function sendToTab(tabId, msg) {
  return new Promise((res) => chrome.tabs.sendMessage(tabId, msg, (r) => { if (chrome.runtime.lastError) return res(null); res(r); }));
}
async function injectContent(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [
      "src/lib/siteDetect.js", "src/lib/redact.js", "src/lib/extractor.js",
      "src/lib/knowledge.js", "src/lib/personalities.js", "src/lib/engine.js",
      "src/content/highlighter.js", "src/content/content.js",
    ] });
  } catch (_) {}
}
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
// Reasoning models (local, R1-style) emit <think>…</think> chain-of-thought — strip it.
function cleanAI(t) {
  return String(t == null ? "" : t)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();
}
function aiText(resp, fallback) {
  return resp && resp.ok ? (cleanAI(resp.text) || "(empty response)") : ((resp && resp.error) || fallback || "AI unavailable");
}
function aiHtml(resp, fallback) {
  if (resp && resp.ok) return renderMarkdown(cleanAI(resp.text) || "(empty response)");
  return `<p class="muted">${esc((resp && resp.error) || fallback || "AI unavailable")}</p>`;
}

// Small, dependency-free, XSS-safe Markdown renderer for AI output.
function renderMarkdown(src) {
  src = String(src == null ? "" : src);
  const e = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const blocks = [];
  src = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    blocks.push(`<pre class="md-code">${e(code.replace(/\n$/, ""))}</pre>`);
    return ` B${blocks.length - 1} `;
  });
  const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : "#");
  const inline = (t) => {
    t = e(t);
    t = t.replace(/`([^`]+)`/g, '<code class="md-ic">$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) => `<a href="${e(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${txt}</a>`);
    return t;
  };
  const lines = src.split(/\r?\n/);
  let html = "", i = 0;
  const isBlockStart = (l) => /^(#{1,6}\s|\s*[-*+]\s|\s*\d+\.\s|\s*>|\s*\|)/.test(l) || /^ B\d+ $/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    const bm = line.match(/^ B(\d+) $/);
    if (bm) { html += blocks[+bm[1]]; i++; continue; }
    if (/^\s*\|(.+)\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1])) {
      const headers = line.split("|").slice(1, -1).map((c) => c.trim());
      i += 2; const rows = [];
      while (i < lines.length && /^\s*\|(.+)\|\s*$/.test(lines[i])) { rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim())); i++; }
      html += `<table class="md-tbl"><thead><tr>${headers.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      continue;
    }
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) { const lvl = Math.min(6, hm[1].length); html += `<div class="md-h md-h${lvl}">${inline(hm[2])}</div>`; i++; continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { html += `<hr class="md-hr">`; i++; continue; }
    if (/^\s*>\s?/.test(line)) { const q = []; while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, "")); i++; } html += `<blockquote class="md-q">${inline(q.join(" "))}</blockquote>`; continue; }
    if (/^\s*[-*+]\s+/.test(line)) { const it = []; while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { it.push(lines[i].replace(/^\s*[-*+]\s+/, "")); i++; } html += `<ul class="md-ul">${it.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`; continue; }
    if (/^\s*\d+\.\s+/.test(line)) { const it = []; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { it.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; } html += `<ol class="md-ol">${it.map((x) => `<li>${inline(x)}</li>`).join("")}</ol>`; continue; }
    if (/^\s*$/.test(line)) { i++; continue; }
    const para = [line]; i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) { para.push(lines[i]); i++; }
    html += `<p class="md-p">${inline(para.join(" "))}</p>`;
  }
  return html;
}
