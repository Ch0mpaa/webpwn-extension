/*
 * WebPwn Coach — Content Script
 * Runs in the page's isolated world. Responsibilities:
 *   - Extract page context on demand (via WPC.extract).
 *   - Report the current text selection.
 *   - Render an in-page "Concept card" when the user highlights a term
 *     and picks "Explain with WebPwn Coach" (Concept Mode).
 *
 * All heavy lifting lives in the shared WPC.* libs loaded before this file.
 */
(function () {
  const WPC = globalThis.WPC || {};
  let cardEl = null;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      switch (msg && msg.type) {
        case "WPC_PING":
          sendResponse({ ok: true, site: safe(() => WPC.detectSite({})) });
          return true;

        case "WPC_EXTRACT": {
          const raw = safe(() => WPC.extract());
          sendResponse({ ok: !!raw, context: raw });
          return true;
        }

        case "WPC_GET_SELECTION": {
          sendResponse({ ok: true, selection: getSelection_() });
          return true;
        }

        case "WPC_CONCEPT_CARD": {
          // From the context menu: build + show a concept card for a phrase.
          const phrase = (msg.phrase || getSelection_() || "").trim();
          showConceptCard(phrase, msg.persona);
          sendResponse({ ok: true });
          return true;
        }

        case "WPC_HIGHLIGHT": {
          // Guided highlighting: build a plan, then overlay it on the page.
          const plan = WPC.engine.buildHighlightPlan(msg.phrase || "", {
            persona: msg.persona,
            conceptId: msg.conceptId,
            level: msg.level,
          });
          const summary = WPC.highlighter.run(plan);
          sendResponse(Object.assign({ ok: true, plan: publicPlan(plan) }, summary));
          return true;
        }

        case "WPC_CLEAR_HIGHLIGHT": {
          const r = WPC.highlighter ? WPC.highlighter.clear() : { ok: true };
          sendResponse(r);
          return true;
        }

        case "WPC_STORAGE": {
          // Cookie/localStorage/sessionStorage key names only — never values.
          const s = WPC.highlighter ? WPC.highlighter.storageIndicator() : { cookies: 0, local: [], session: [] };
          sendResponse({ ok: true, storage: s });
          return true;
        }

        default:
          return false;
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
      return true;
    }
  });

  function publicPlan(p) {
    return {
      conceptId: p.conceptId,
      conceptName: p.conceptName,
      level: p.level,
      levelText: p.levelText,
      intro: p.intro,
      strongHintAvailable: p.strongHintAvailable,
      lens6: p.lens6,
      legend: p.legend,
      persona: p.persona,
    };
  }

  function getSelection_() {
    const s = window.getSelection ? String(window.getSelection()) : "";
    return s.replace(/\s+/g, " ").trim().slice(0, 500);
  }

  function showConceptCard(phrase, persona) {
    if (!WPC.engine) return;
    const data = WPC.engine.buildConcept(phrase, { persona });
    removeCard();
    ensureStyles();

    const card = document.createElement("div");
    card.className = "wpc-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "WebPwn Coach concept");

    if (!data.found) {
      card.innerHTML = `
        <div class="wpc-card-head">
          <span class="wpc-logo">◆ WebPwn Coach</span>
          <button class="wpc-x" aria-label="Close">✕</button>
        </div>
        <div class="wpc-card-body">
          <p class="wpc-muted">${escapeHtml(data.message)}</p>
          <div class="wpc-chips">${data.suggestions
            .map((s) => `<span class="wpc-chip">${escapeHtml(s)}</span>`)
            .join("")}</div>
        </div>`;
    } else {
      card.innerHTML = `
        <div class="wpc-card-head">
          <span class="wpc-logo">◆ ${escapeHtml(data.name)}</span>
          <button class="wpc-x" aria-label="Close">✕</button>
        </div>
        <div class="wpc-card-body">
          <p class="wpc-simple">${escapeHtml(data.simple)}</p>
          <div class="wpc-block"><b>Real-world</b><p>${escapeHtml(data.example)}</p></div>
          <div class="wpc-block"><b>How to identify</b><ul>${li(data.identify)}</ul></div>
          <div class="wpc-block"><b>What to test</b><ul>${li(data.test)}</ul></div>
          <div class="wpc-block"><b>Common mistakes</b><ul>${li(data.mistakes)}</ul></div>
          <div class="wpc-mental">🧭 ${escapeHtml(data.mental)}</div>
          <div class="wpc-block"><b>Coach asks</b><ul class="wpc-q">${li(data.coach)}</ul></div>
          <details class="wpc-lens">
            <summary>Assessment Lens (WHO · WHAT · WHY · VALIDATE · FIX · REPORT)</summary>
            ${lensHtml(data.lens)}
          </details>
          <p class="wpc-next">▶ Next: ${escapeHtml(data.next)}</p>
        </div>`;
    }

    document.documentElement.appendChild(card);
    cardEl = card;
    card.querySelector(".wpc-x").addEventListener("click", removeCard);
    // Dismiss on Escape.
    document.addEventListener("keydown", onKey, { once: false });
    positionCard(card);
  }

  function onKey(e) {
    if (e.key === "Escape") removeCard();
  }
  function removeCard() {
    if (cardEl && cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
    cardEl = null;
    document.removeEventListener("keydown", onKey);
  }

  function positionCard(card) {
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r && (r.top || r.left)) {
          const top = Math.min(window.innerHeight - 40, r.bottom + 8) + window.scrollY;
          card.style.top = Math.max(12 + window.scrollY, top) + "px";
          card.style.left = Math.min(window.innerWidth - 380, Math.max(12, r.left)) + "px";
          return;
        }
      }
    } catch (_) {}
    card.style.top = 20 + window.scrollY + "px";
    card.style.right = "20px";
  }

  function lensHtml(l) {
    const rows = [
      ["WHO", l.who], ["WHAT", l.what], ["WHEN", l.when], ["WHERE", l.where],
      ["HOW (assessment)", l.howAssessment], ["HOW (technical)", l.howTechnical],
      ["WHY vulnerable", l.whyVuln], ["WHY it worked", l.whyWorked], ["WHY it failed", l.whyFailed],
      ["VALIDATE", l.validate], ["FIX", l.fix], ["REPORT", l.report], ["INTERVIEW", l.interview],
    ];
    return `<table class="wpc-lens-tbl">${rows
      .map((r) => `<tr><th>${r[0]}</th><td>${escapeHtml(r[1])}</td></tr>`)
      .join("")}</table>`;
  }

  function li(arr) {
    return (arr || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function safe(fn) {
    try { return fn(); } catch (_) { return null; }
  }

  function ensureStyles() {
    if (document.getElementById("wpc-card-styles")) return;
    const link = document.createElement("link");
    link.id = "wpc-card-styles";
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("src/content/concept-card.css");
    document.documentElement.appendChild(link);
  }
})();
