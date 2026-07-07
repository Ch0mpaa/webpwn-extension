/*
 * WebPwn Coach — Guided Highlighter (content side)
 * Scans the live page for observation-worthy elements and draws NON-DESTRUCTIVE
 * overlay boxes over them (we never modify the page's own DOM/content).
 *
 * It teaches observation: "look at this object id", "this form changes state",
 * "this button performs an action", "this looks like a trust boundary".
 *
 * Colors come from WPC.engine.HL_COLORS; teaching text from CATEGORY_TEACH.
 * Passwords and secret values are NEVER read — only the presence of fields
 * and the NAMES of storage keys are noted.
 */
(function () {
  const WPC = (globalThis.WPC = globalThis.WPC || {});

  const ROOT_ID = "wpc-hl-root";
  const BAR_ID = "wpc-hl-bar";
  const MAX = 46;

  let active = null; // { targets:[{el,category,colorKey,label}], raf, level }

  // ---- Element scanning ------------------------------------------------------

  const ID_HINT = /\b(id|user|account|order|receipt|invoice|customer|token|uuid|ref|number|no)\b/i;
  const DESTRUCTIVE = /\b(delete|remove|destroy|drop|pay|purchase|buy|checkout|transfer|withdraw|admin|promote|deactivate|revoke|ban|reset)\b/i;
  const USER_CTX = /(logged in as|signed in as|current user|my account|your account|welcome,?\s+[\w.@-]+|hello,?\s+[\w.@-]+)/i;
  const ERROR_TEXT = /(invalid|incorrect|does not exist|no such|not found|failed|wrong|denied|unauthori|already (taken|exists)|try again)/i;
  function labelFor(inp) {
    try {
      if (inp.id) {
        const l = document.querySelector(`label[for="${CSS.escape(inp.id)}"]`);
        if (l) return l.textContent || "";
      }
      const wrap = inp.closest("label");
      return wrap ? wrap.textContent || "" : "";
    } catch (_) { return ""; }
  }
  const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
  const ID_IN_URL = /([?&/](id|user|account|order|receipt|invoice|customer|uid|pid|oid)[=/][A-Za-z0-9._-]+)|\/\d{2,}(\b|\/)/i;
  const LABELLED_ID = /\b(order|receipt|invoice|account|user|customer|transaction|ticket|reference)\s*(id|number|no|ref|#)?\s*[:#]?\s*[A-Za-z0-9-]{2,}\b/i;

  function visible(el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || st.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  }
  function inViewportBand(el) {
    // Allow off-screen (we reposition on scroll), but skip absurd sizes.
    const r = el.getBoundingClientRect();
    return r.width < 4000 && r.height < 4000;
  }

  function scan(plan) {
    const pink = new Set(plan.pinkCategories || []);
    const push = (arr, el, category, colorKey) => {
      if (arr.length >= MAX) return;
      if (!visible(el) || !inViewportBand(el)) return;
      if (arr.some((t) => t.el === el && t.category === category)) return;
      arr.push({ el, category, colorKey });
    };
    const colorFor = (category, base) => (pink.has(category) ? "suspect" : base);
    const targets = [];

    // Forms — GET (observe) vs state-changing (suspect by nature).
    document.querySelectorAll("form").forEach((f) => {
      const method = (f.getAttribute("method") || "GET").toUpperCase();
      const stateChanging = method !== "GET";
      push(targets, f, stateChanging ? "state-form" : "get-form",
        stateChanging ? "suspect" : colorFor("get-form", "observe"));
    });

    const hasPassword = !!document.querySelector('input[type=password]');

    // Inputs — password / username / id-ish / generic. Ask a question of each.
    document.querySelectorAll("input, select, textarea").forEach((inp) => {
      const type = (inp.getAttribute("type") || inp.tagName).toLowerCase();
      const nameish = [inp.name, inp.id, inp.getAttribute("placeholder"), labelFor(inp)].filter(Boolean).join(" ");
      if (type === "password") return push(targets, inp, "password", "suspect");
      if (type === "hidden" && !ID_HINT.test(nameish)) return; // skip noise
      if (/\b(user(name)?|email|login|e-mail|account)\b/i.test(nameish))
        return push(targets, inp, "username-input", "suspect");
      if (ID_HINT.test(nameish)) return push(targets, inp, "object-id", colorFor("object-id", "observe"));
      push(targets, inp, "input", colorFor("input", "observe"));
    });

    // Buttons — login (identity moment) / destructive / generic action.
    document.querySelectorAll("button, input[type=submit], input[type=button], [role=button]").forEach((b) => {
      const txt = (b.value || b.textContent || b.getAttribute("aria-label") || "").trim();
      if (/\b(log ?in|sign ?in|log ?on|authenticate)\b/i.test(txt) || (hasPassword && /submit|continue|go/i.test(txt)))
        return push(targets, b, "login-button", "trust");
      if (DESTRUCTIVE.test(txt)) return push(targets, b, "action-button", "danger");
      push(targets, b, "button", "observe");
    });

    // Error / status messages — the classic enumeration oracle.
    document.querySelectorAll("body *:not(script):not(style)").forEach((el) => {
      if (targets.filter((t) => t.category === "error-text").length >= 3) return;
      if (el.children.length > 0) return; // leaf-ish
      const t = (el.textContent || "").trim();
      if (t.length > 2 && t.length < 90 && ERROR_TEXT.test(t)) push(targets, el, "error-text", "suspect");
    });

    // Links — carrying an object id = object-id; else structural link.
    const seenHref = new Set();
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      const txt = (a.textContent || "").trim();
      if (!txt || txt.length < 2) return;
      const key = href + "|" + txt.slice(0, 20);
      if (seenHref.has(key)) return;
      seenHref.add(key);
      if (ID_IN_URL.test(href) || UUID.test(href)) return push(targets, a, "object-id", colorFor("object-id", "observe"));
      if (/\b(admin|account|settings|profile|api|dashboard|user)\b/i.test(href)) push(targets, a, "link", colorFor("link", "observe"));
    });

    // Visible code / request-response snippets.
    const seenCode = new Set();
    document.querySelectorAll("pre, code").forEach((c) => {
      if (c.tagName === "CODE" && c.closest("pre")) return;
      const t = (c.textContent || "").trim();
      if (t.length < 10 || seenCode.has(t)) return;
      seenCode.add(t);
      push(targets, c, "code", colorFor("code", "observe"));
    });

    // Elements that reveal the current user.
    document.querySelectorAll("body *:not(script):not(style)").forEach((el) => {
      if (targets.filter((t) => t.category === "user-context").length >= 3) return;
      if (el.children.length > 0) return; // leaf-ish only
      const t = (el.textContent || "").trim();
      if (t.length > 0 && t.length < 80 && USER_CTX.test(t)) push(targets, el, "user-context", "trust");
    });

    // Object identifiers sitting in visible text (Range-based, non-destructive).
    scanTextIds(targets, colorFor);

    // Fluff — nav / footer / cookie banners (teach what to ignore).
    document.querySelectorAll("nav, footer, aside, [class*=cookie], [class*=advert], [class*=banner]").forEach((el) => {
      if (targets.filter((t) => t.category === "fluff").length >= 4) return;
      push(targets, el, "fluff", "fluff");
    });

    // Prioritise: focus colours first, fluff last; cap total.
    const rank = { suspect: 0, danger: 1, trust: 2, observe: 3, valid: 4, fluff: 5 };
    targets.sort((a, b) => (rank[a.colorKey] ?? 9) - (rank[b.colorKey] ?? 9));
    return targets.slice(0, MAX);
  }

  function scanTextIds(targets, colorFor) {
    let count = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (count >= 10) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") return NodeFilter.FILTER_REJECT;
        const txt = n.nodeValue || "";
        if (txt.length < 4 || txt.length > 200) return NodeFilter.FILTER_SKIP;
        return UUID.test(txt) || LABELLED_ID.test(txt) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    let node;
    while ((node = walker.nextNode()) && count < 10) {
      const txt = node.nodeValue;
      const m = UUID.exec(txt) || LABELLED_ID.exec(txt);
      if (!m) continue;
      try {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, Math.min(txt.length, m.index + m[0].length));
        const rect = range.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        targets.push({ range, category: "object-id", colorKey: colorFor("object-id", "observe") });
        count++;
      } catch (_) {}
    }
  }

  // ---- Storage / cookie indicator (names only, never values) -----------------

  function storageIndicator() {
    const out = { cookies: 0, local: [], session: [] };
    try {
      out.cookies = (document.cookie ? document.cookie.split(";").filter((s) => s.trim()) : []).length;
    } catch (_) {}
    try {
      for (let i = 0; i < localStorage.length && out.local.length < 8; i++) out.local.push(localStorage.key(i));
    } catch (_) {}
    try {
      for (let i = 0; i < sessionStorage.length && out.session.length < 8; i++) out.session.push(sessionStorage.key(i));
    } catch (_) {}
    return out;
  }

  // ---- Overlay rendering -----------------------------------------------------

  function colorHex(key) {
    const c = (WPC.engine && WPC.engine.HL_COLORS) || {};
    return (c[key] && c[key].hex) || "#22d3ee";
  }
  function teachFor(category, level, colorKey) {
    const map = (WPC.engine && WPC.engine.CATEGORY_TEACH) || {};
    const arr = map[category] || map.input || ["Look here."];
    // At level 4, only focus colours get the "next action"; the rest cap at L3.
    const focus = colorKey === "suspect" || colorKey === "danger" || colorKey === "trust";
    const applied = level === 4 && !focus ? 3 : level;
    return arr[Math.min(applied, arr.length) - 1] || arr[0];
  }

  function ensureStyles() {
    if (document.getElementById("wpc-hl-styles")) return;
    const link = document.createElement("link");
    link.id = "wpc-hl-styles";
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("src/content/highlight.css");
    document.documentElement.appendChild(link);
  }

  function run(plan) {
    clear();
    ensureStyles();
    const targets = scan(plan);
    const storage = storageIndicator();

    const root = document.createElement("div");
    root.id = ROOT_ID;
    document.documentElement.appendChild(root);

    const boxes = [];
    targets.forEach((t, i) => {
      const box = document.createElement("div");
      box.className = "wpc-hl-box";
      const hex = colorHex(t.colorKey);
      box.style.setProperty("--wpc-c", hex);
      const label = document.createElement("div");
      label.className = "wpc-hl-label";
      label.style.setProperty("--wpc-c", hex);
      const cat = document.createElement("b");
      cat.textContent = t.category === "fluff" ? "✕" : "?";
      label.appendChild(cat);
      label.appendChild(document.createTextNode(" " + teachFor(t.category, plan.level, t.colorKey)));
      box.appendChild(label);
      root.appendChild(box);
      boxes.push({ box, target: t });
    });

    active = { boxes, level: plan.level, raf: 0, storage };
    position();
    startTracking();
    renderBar(plan, targets, storage);

    // Summarise for the popup legend.
    const byColor = {};
    const byCategory = {};
    for (const t of targets) {
      byColor[t.colorKey] = (byColor[t.colorKey] || 0) + 1;
      byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    }
    if (storage.cookies || storage.local.length || storage.session.length) byColor.trust = (byColor.trust || 0) + 1;
    return { ok: true, total: targets.length, byColor, byCategory, storage, level: plan.level, conceptName: plan.conceptName };
  }

  function rectOf(target) {
    if (target.range) {
      try { return target.range.getBoundingClientRect(); } catch (_) { return null; }
    }
    if (target.el && document.contains(target.el)) return target.el.getBoundingClientRect();
    return null;
  }

  function position() {
    if (!active) return;
    const sx = window.scrollX, sy = window.scrollY;
    for (const { box, target } of active.boxes) {
      const r = rectOf(target);
      if (!r || (r.width < 2 && r.height < 2)) { box.style.display = "none"; continue; }
      box.style.display = "block";
      box.style.top = r.top + sy + "px";
      box.style.left = r.left + sx + "px";
      box.style.width = r.width + "px";
      box.style.height = r.height + "px";
    }
  }

  function startTracking() {
    const loop = () => {
      if (!active) return;
      position();
      active.raf = requestAnimationFrame(loop);
    };
    active.raf = requestAnimationFrame(loop);
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position, true);
  }

  function renderBar(plan, targets, storage) {
    const bar = document.createElement("div");
    bar.id = BAR_ID;
    const legend = plan.legend
      .map((l) => `<span class="wpc-lg"><i style="background:${l.hex}"></i>${escape_(l.label)}</span>`)
      .join("");
    const storeTxt =
      storage.cookies || storage.local.length || storage.session.length
        ? `<span class="wpc-store">🗝 storage: ${storage.cookies} cookie(s), ${storage.local.length} local, ${storage.session.length} session</span>`
        : "";
    bar.innerHTML = `
      <div class="wpc-bar-row">
        <span class="wpc-bar-brand">◆ WebPwn Coach</span>
        <span class="wpc-bar-lvl">HINT L${plan.level} · ${targets.length} marks</span>
        <button class="wpc-bar-clear" title="Clear highlights">Clear ✕</button>
      </div>
      <div class="wpc-bar-legend">${legend}</div>
      ${storeTxt ? `<div class="wpc-bar-store">${storeTxt}</div>` : ""}
    `;
    document.documentElement.appendChild(bar);
    bar.querySelector(".wpc-bar-clear").addEventListener("click", clear);
  }

  function clear() {
    if (active) {
      cancelAnimationFrame(active.raf);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position, true);
      active = null;
    }
    const root = document.getElementById(ROOT_ID);
    if (root) root.remove();
    const bar = document.getElementById(BAR_ID);
    if (bar) bar.remove();
    return { ok: true, cleared: true };
  }

  function escape_(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  WPC.highlighter = { run, clear, scan, storageIndicator };
})();
