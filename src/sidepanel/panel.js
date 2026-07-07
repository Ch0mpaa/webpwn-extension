/*
 * WebPwn Coach — Side Panel controller
 * The primary UI. Panels: TL;DR · Lens · Elements · Traffic · Highlight ·
 * Memory · Reps · Ask · Proxy · Settings. Reuses the shared WPC engine + the
 * traffic/explain/memory libs. Nothing leaves the browser without consent.
 */
const WPC = globalThis.WPC;

const state = {
  persona: "atlas",
  mode: "tldr",
  raw: null,
  clean: null,
  storage: null,
  site: { id: "generic", label: "Generic Web Application", badge: "…" },
  llmEnabled: false,
  companionUrl: "http://127.0.0.1:8088",
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
  settingsBtn: $("#settingsBtn"),
};

// Panels whose content depends on the current page — auto re-render on nav.
const PAGE_MODES = ["tldr", "lens", "elements", "highlight"];
let rescanTimer = null;

init();

async function init() {
  const st = await chrome.storage.local.get(["persona", "llmEnabled", "companionUrl", "wpc_settings"]);
  state.persona = st.persona || "atlas";
  state.llmEnabled = !!st.llmEnabled;
  if (st.companionUrl) state.companionUrl = st.companionUrl;
  if (st.wpc_settings) Object.assign(state.settings, st.wpc_settings);
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

  // Auto-detect the current page: re-scan when the active tab changes or a page
  // finishes loading — no manual refresh needed.
  chrome.tabs.onActivated.addListener(() => scheduleRescan());
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    if (tab && tab.active && (info.status === "complete" || info.url)) scheduleRescan();
  });
  if (chrome.windows && chrome.windows.onFocusChanged) {
    chrome.windows.onFocusChanged.addListener((wid) => { if (wid !== chrome.windows.WINDOW_ID_NONE) scheduleRescan(); });
  }
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
      el.siteBadge.textContent = state.site.badge;
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
  el.output.innerHTML = `
    ${chips ? `<div class="chips">${chips}</div>` : ""}
    ${card("Summary", `<p>${esc(d.summary)}</p>`)}
    ${card("Why it matters (consultant)", `<p>${esc(d.whyItMatters)}</p>`)}
    ${card(`Assessment Lens · ${esc(d.lensSource)}`, lensTable(fullLens(d.lens, d.lensSource)))}
    ${card("Mental model", `<div class="mental">🧭 ${esc(d.mentalModel)}</div>`)}
    ${card("Beginner mistakes", ul(d.beginnerMistakes))}
    ${card("Senior thinking", ul(d.seniorThinking))}
    ${card(d.siteFraming.title, frameChain(d.siteFraming.chain) + `<p class="muted small" style="margin-top:6px">${esc(d.siteFraming.note)}</p>`)}
    ${card("Methodology", frameChain(["Mission","Business","Users","Objects","Workflows","Trust Boundaries","Assessment Lens","Tool Choice","Validate","Evidence","Report","Interview","Debrief"]))}
    ${card("Next observation", `<p class="next">▶ ${esc(d.nextObservation)}</p><p class="nudge">${esc(d.nudge)}</p>`)}`;
  wireConceptChips();
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
  const found = WPC.detectConcepts(state.clean.bodyText || "", 5).map((f) => f.concept);
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
    ${card("Traffic import", `<p class="muted small">Paste a raw HTTP request/response (from Burp/Caido), or a JWT/JSON/SQL/code snippet.</p>
      <textarea id="tIn" placeholder="Paste HTTP request/response or a snippet…"></textarea>
      <div class="row"><button id="tExplain" class="btn primary">Explain</button>
      <label class="btn" style="text-align:center">Import HAR<input id="harIn" type="file" accept=".har,application/json" hidden></label></div>`)}
    ${card("From companion proxy", `<p class="muted small">Requires the local proxy (Proxy tab → start companion).</p>
      <div class="row"><button id="tLoad" class="btn">Load captured traffic</button><button id="tClear" class="btn red">Clear captured</button></div>
      <div id="tList" class="tlist" style="margin-top:8px"></div>`)}
    <div id="tResult"></div>`;
  $("#tExplain").addEventListener("click", () => explainPasted($("#tIn").value));
  $("#harIn").addEventListener("change", importHar);
  $("#tLoad").addEventListener("click", loadCompanion);
  $("#tClear").addEventListener("click", clearCompanion);
  if (state.traffic.companion.length) renderCompanionList();
  if (sel) renderTrafficResult(sel);
}

function explainPasted(text) {
  text = (text || "").trim();
  if (!text) return;
  const kind = WPC.explain.classify(text);
  if (kind === "http") {
    const parsed = WPC.http.parseText(text);
    state.traffic.selected = { source: "paste", parsed };
  } else {
    const art = WPC.explain.explainArtifact(text);
    state.traffic.selected = { source: "paste", artifact: art };
  }
  renderTraffic();
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

async function loadCompanion() {
  try {
    const r = await fetch(state.companionUrl.replace(/\/$/, "") + "/traffic");
    const data = await r.json();
    state.traffic.companion = data.items || [];
    el.statusMsg.textContent = `Loaded ${state.traffic.companion.length} captured request(s).`;
  } catch (_) {
    el.statusMsg.textContent = "Companion not reachable. Start it (Proxy tab).";
  }
  renderTraffic();
}
async function clearCompanion() {
  try { await fetch(state.companionUrl.replace(/\/$/, "") + "/traffic", { method: "DELETE" }); } catch (_) {}
  state.traffic.companion = []; renderTraffic();
}
function renderCompanionList() {
  const list = $("#tList"); if (!list) return;
  list.innerHTML = state.traffic.companion.slice(0, 60).map((t, i) =>
    `<div class="titem" data-i="${i}"><span class="m">${esc(t.method)}</span><span class="u">${esc(t.url || t.path || "")}</span><span class="s">${esc(String(t.status || ""))}</span></div>`).join("");
  list.querySelectorAll(".titem").forEach((row) => row.addEventListener("click", () => selectCompanion(parseInt(row.dataset.i, 10))));
}
async function selectCompanion(i) {
  const item = state.traffic.companion[i];
  let parsed;
  if (item._har) {
    parsed = { request: { method: item.method, url: item.url, path: safePath(item.url), query: "", host: item.host, headers: [], params: item.params || [], hasAuth: item.hasAuth, hasCookie: false, contentType: item.contentType, body: "" }, response: { status: item.status, statusText: "", contentType: item.contentType, headers: [] } };
  } else {
    try {
      const r = await fetch(state.companionUrl.replace(/\/$/, "") + "/traffic/" + item.id);
      const full = await r.json();
      parsed = companionToParsed(full);
    } catch (_) { el.statusMsg.textContent = "Couldn't load detail."; return; }
  }
  state.traffic.selected = { source: "companion", parsed };
  renderTraffic();
}
function companionToParsed(full) {
  let path = safePath(full.url);
  const params = WPC.http.extractParams(new URL(full.url, "http://x").search, full.reqBody || "", full.contentType || "");
  return {
    request: { method: full.method, url: full.url, path, query: new URL(full.url, "http://x").search, host: full.host, headers: [], params, hasAuth: !!(full.reqHeaders && full.reqHeaders.authorization), hasCookie: !!(full.reqHeaders && full.reqHeaders.cookie), contentType: full.contentType, body: full.reqBody || "" },
    response: { status: full.status, statusText: "", contentType: full.contentType, headers: [], body: full.respBody || "" },
  };
}
function safePath(u) { try { return new URL(u).pathname; } catch (_) { return u || ""; } }

function renderTrafficResult(sel) {
  const box = $("#tResult"); if (!box) return;
  if (sel.artifact) { box.innerHTML = artifactHtml(sel.artifact); wireConceptChips(); return; }
  if (!sel.parsed || !sel.parsed.ok && !sel.parsed.request) { box.innerHTML = card("No parse", `<p class="muted">Couldn't parse that as HTTP.</p>`); return; }
  const p = sel.parsed;
  box.innerHTML = `
    ${card("Selected request", `<div class="pre">${esc((p.request ? p.request.method + " " + p.request.path + (p.request.query || "") : "") + (p.response ? "  →  " + p.response.status : ""))}</div>
      <div class="row">
        <button class="btn" data-act="explain">Explain Request</button>
        <button class="btn" data-act="lens">Map to Lens</button>
        <button class="btn" data-act="who">Identify Users/Objects</button>
        <button class="btn pink" data-act="test">Suggest Next Test</button>
        <button class="btn" data-act="evidence">Create Evidence</button>
      </div>`)}
    <div id="tAct"></div>`;
  box.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => trafficAction(b.dataset.act, p)));
}
function trafficAction(act, p) {
  const out = $("#tAct");
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
  const bars = prof.rows.map((r) => {
    const pct = Math.max(6, Math.min(100, 50 + r.score * 12));
    const color = r.level === "Solid" ? "var(--green)" : r.level === "Weak" ? "var(--red)" : r.level === "Practicing" ? "var(--amber)" : "var(--gray)";
    return `<div class="skill"><div class="top"><span>${esc(r.skill)}</span><span class="lvl-${r.level}">${r.level}</span></div><div class="bar"><span style="width:${pct}%;background:${color}"></span></div></div>`;
  }).join("");
  const events = prof.events.slice(0, 12).map((e) => `<div class="small muted">• ${esc(e.type)} — ${esc(e.skill)}${e.note ? " (" + esc(e.note) + ")" : ""}</div>`).join("") || `<p class="muted small">No activity yet.</p>`;
  const skillOpts = WPC.memory.SKILLS.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  el.output.innerHTML = `
    ${card("Skill profile", `<p class="muted small">Weakest first. Struggle (hints/mistakes/missed) lowers a skill; reps raise it.</p>${bars}`)}
    ${card("Log a moment", `<div class="lab">Skill</div><select id="mSkill">${skillOpts}</select>
      <div class="row">
        <button class="btn" data-log="mistake">I made a mistake</button>
        <button class="btn" data-log="hint-requested">I needed a hint</button>
        <button class="btn" data-log="interview-missed">Missed an interview Q</button>
        <button class="btn" data-log="report-written">Wrote a report</button>
      </div>`)}
    ${card("Recent activity", events)}
    ${card("", `<div class="row"><button id="mReset" class="btn red">Reset memory</button></div>`)}`;
  el.output.querySelectorAll("[data-log]").forEach((b) => b.addEventListener("click", async () => {
    await WPC.memory.record({ type: b.dataset.log, skill: $("#mSkill").value });
    el.statusMsg.textContent = "Logged."; renderMemory();
  }));
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

// ---- Ask Coach --------------------------------------------------------------

function renderAsk() {
  const msgs = state.chat.map((m) => m.role === "user"
    ? `<div class="msg user">${esc(m.text)}</div>`
    : `<div class="msg coach"><pre>${esc(m.text)}</pre></div>`).join("");
  el.output.innerHTML = `
    <div class="card"><h3>Ask Coach</h3><p class="muted small">I guide with questions, not answers. Paste a snippet and I'll explain it. Ask for a "strong hint" only if you really want the next action.</p></div>
    <div class="chat" id="chat">${msgs || `<div class="msg coach"><pre>What are you looking at? Describe the page, or paste a request/JWT/JSON/SQL and I'll help you think.</pre></div>`}</div>
    <div class="chat-in"><textarea id="askIn" placeholder="Ask or paste…"></textarea><button id="askGo" class="btn primary">Send</button></div>`;
  const go = $("#askGo"), input = $("#askIn");
  const send = () => askSend(input.value);
  go.addEventListener("click", send);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); });
  const chat = $("#chat"); if (chat) chat.scrollTop = chat.scrollHeight;
}

async function askSend(text) {
  text = (text || "").trim(); if (!text) return;
  state.chat.push({ role: "user", text });
  const reply = coachReply(text);
  state.chat.push({ role: "coach", text: reply });
  renderAsk();
  if (state.llmEnabled) {
    state.chat.push({ role: "coach", text: "✦ (asking AI mentor…)" });
    renderAsk();
    try {
      const resp = await chrome.runtime.sendMessage({ type: "WPC_LLM", mode: "chat", question: text, context: state.clean || {}, siteLabel: state.site.label });
      state.chat.pop();
      state.chat.push({ role: "coach", text: resp && resp.ok ? "✦ " + resp.text : "✦ AI unavailable: " + ((resp && resp.error) || "error") });
    } catch (e) { state.chat.pop(); state.chat.push({ role: "coach", text: "✦ AI error: " + e.message }); }
    renderAsk();
  }
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

async function renderProxy() {
  const status = await getProxyStatus();
  const enabled = status && status.value && status.value.mode && status.value.mode !== "system" && status.value.mode !== "direct";
  const health = await companionHealth();
  el.output.innerHTML = `
    ${enabled ? `<div class="warn">⚠ Browser traffic is being routed through a proxy (${esc(describeProxy(status))}). Disable when you're done studying.</div>` : ""}
    ${card("Proxy control", `<p class="muted small">Removes the need for FoxyProxy while studying. Uses chrome.proxy — affects the whole browser.</p>
      <p class="small">Status: <b class="${enabled ? "bad-line" : "ok-line"}">${enabled ? describeProxy(status) : "system / off"}</b></p>
      <div class="row">
        <button id="pxCoach" class="btn primary">ON → WebPwn Coach (8088)</button>
        <button id="pxBurp" class="btn">ON → Burp (8080)</button>
      </div>
      <div class="row"><button id="pxOff" class="btn red">Proxy OFF (restore system)</button></div>`)}
    ${card("Companion proxy", health.ok
      ? `<p class="small ok-line">● reachable — ${health.captured} captured, ${health.paused ? "PAUSED" : "capturing"}${health.upstream ? ", upstream " + esc(health.upstream) : ""}</p>
         <div class="row"><button id="pxPause" class="btn">${health.paused ? "Resume capture" : "Pause capture"}</button><button id="pxTraffic" class="btn">Open Traffic tab</button></div>
         <p class="muted small" style="margin-top:6px">Allowlist: ${(health.allowlist || []).map(esc).join(", ")}</p>`
      : `<p class="small bad-line">● not reachable at ${esc(state.companionUrl)}</p>
         <p class="muted small">Start it:</p><div class="pre">cd companion && node proxy.js</div>`)}
    ${card("HTTPS note", `<p class="muted small">MVP records HTTP fully. HTTPS is tunneled (CONNECT metadata only) — full bodies need a local CA cert (see companion/README). Use Burp as upstream for full HTTPS bodies.</p>`)}`;
  bindEl("#pxCoach", () => setProxy("coach"));
  bindEl("#pxBurp", () => setProxy("burp"));
  bindEl("#pxOff", () => clearProxy());
  bindEl("#pxPause", async () => { try { await fetch(state.companionUrl.replace(/\/$/, "") + "/pause", { method: "POST" }); } catch (_) {} renderProxy(); });
  bindEl("#pxTraffic", () => { state.mode = "traffic"; [...el.tabs.children].forEach((t) => t.classList.toggle("active", t.dataset.mode === "traffic")); render(); });
}
function bindEl(sel, fn) { const e = $(sel); if (e) e.addEventListener("click", fn); }

function getProxyStatus() {
  return new Promise((res) => {
    try { chrome.proxy.settings.get({}, (d) => res(d)); } catch (_) { res(null); }
  });
}
function describeProxy(status) {
  const v = status && status.value; if (!v) return "unknown";
  if (v.mode === "pac_script") return v.pacScript && /8080/.test(v.pacScript.data || "") ? "Burp 8080" : "WebPwn Coach 8088";
  return v.mode;
}
function pac(port) {
  return `function FindProxyForURL(url, host){ if(url.indexOf('127.0.0.1:8088')>-1||url.indexOf('localhost:8088')>-1)return 'DIRECT'; return 'PROXY 127.0.0.1:${port}'; }`;
}
async function setProxy(which) {
  const port = which === "burp" ? 8080 : 8088;
  try {
    await chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data: pac(port) } }, scope: "regular" });
    el.statusMsg.textContent = `Proxy ON → ${which === "burp" ? "Burp 8080" : "Coach 8088"}. ⚠ all browser traffic routed.`;
  } catch (e) { el.statusMsg.textContent = "Proxy error: " + e.message; }
  renderProxy();
}
async function clearProxy() {
  try { await chrome.proxy.settings.clear({ scope: "regular" }); el.statusMsg.textContent = "Proxy OFF — system settings restored."; }
  catch (e) { el.statusMsg.textContent = "Error: " + e.message; }
  renderProxy();
}
async function companionHealth() {
  try { const r = await fetch(state.companionUrl.replace(/\/$/, "") + "/health"); return await r.json(); }
  catch (_) { return { ok: false }; }
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
    ${card("Companion proxy URL", `<input id="setCompanion" type="text" value="${esc(state.companionUrl)}"><div class="row"><button id="setSave" class="btn primary">Save</button></div>`)}
    ${card("AI backend & keys", `<p class="muted small">AI is optional and off by default. Keys are stored in extension storage. Configure it on the full options page.</p><div class="row"><button id="openOpts" class="btn">Open options</button></div>`)}
    ${card("Privacy", `<ul class="small"><li>Passwords are never collected.</li><li>Tokens/cookies/JWTs redacted by default.</li><li>Preview context before any send; nothing auto-sends.</li></ul>`)}`;
  el.output.querySelectorAll("[data-persona]").forEach((c) => c.addEventListener("click", () => { state.persona = c.dataset.persona; chrome.storage.local.set({ persona: state.persona }); markPersona(); renderSettings(); }));
  el.output.querySelectorAll("[data-toggle]").forEach((t) => t.addEventListener("change", () => { state.settings[t.dataset.toggle] = t.checked; chrome.storage.local.set({ wpc_settings: state.settings }); }));
  $("#setSave").addEventListener("click", () => { state.companionUrl = $("#setCompanion").value.trim() || state.companionUrl; chrome.storage.local.set({ companionUrl: state.companionUrl }); el.statusMsg.textContent = "Saved."; });
  $("#openOpts").addEventListener("click", () => chrome.runtime.openOptionsPage());
}
function toggle(key, label, checked) {
  return `<label class="small" style="display:flex;gap:8px;align-items:center;margin:5px 0"><input type="checkbox" data-toggle="${key}" ${checked ? "checked" : ""}> ${esc(label)}</label>`;
}

// ---- AI enrichment ----------------------------------------------------------

async function enrichAI() {
  if (!state.clean) return;
  el.statusMsg.textContent = "Asking AI…";
  const box = document.createElement("div"); box.className = "card";
  box.innerHTML = `<h3>✦ AI Mentor (${state.mode})</h3><p class="muted">Thinking…</p>`;
  el.output.prepend(box);
  try {
    const resp = await chrome.runtime.sendMessage({ type: "WPC_LLM", mode: state.mode === "traffic" ? "tldr" : state.mode, context: state.clean, siteLabel: state.site.label });
    box.innerHTML = `<h3>✦ AI Mentor</h3><pre class="pre">${esc(resp && resp.ok ? resp.text : (resp && resp.error) || "failed")}</pre>`;
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
