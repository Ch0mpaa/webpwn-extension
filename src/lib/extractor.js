/*
 * WebPwn Coach — Context Extractor
 * Reads only the signal from a learning page:
 *   Title, Headers, Paragraphs, Forms, Buttons, Links, visible code.
 * Ignores fluff (nav chrome, cookie banners, scripts, styles).
 * Never reads password fields or hidden secret inputs.
 */
(function () {
  const WPC = (globalThis.WPC = globalThis.WPC || {});

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME"]);
  const FLUFF_HINT = /(cookie|consent|newsletter|advert|banner|footer-nav|social)/i;
  // Site chrome / navigation we must NOT read as content (it pollutes topic
  // detection — e.g. a "My progress" sidebar listing every course section).
  const CHROME_SEL =
    "nav, aside, header, footer, [role=navigation], [role=complementary]," +
    "[class*=progress], [class*=sidebar], [class*=side-nav], [class*=breadcrumb]," +
    "[class*=widgetcontainer], [class*=toc], [id*=sidebar], [id*=nav]";
  function inChrome(el) {
    try { return !!(el.closest && el.closest(CHROME_SEL)); } catch (_) { return false; }
  }

  function clean(s, max) {
    if (!s) return "";
    s = s.replace(/\s+/g, " ").trim();
    if (max && s.length > max) s = s.slice(0, max).trim() + "…";
    return s;
  }

  function isVisible(el) {
    if (!el || SKIP_TAGS.has(el.tagName)) return false;
    // getClientRects() is empty when the element (or any ancestor) is
    // display:none — catches mobile-only / media-query-hidden banners.
    if (!el.getClientRects || el.getClientRects().length === 0) return false;
    const st = el.ownerDocument.defaultView.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
    return true;
  }

  // Pick the real content region by favouring PROSE and penalising link/button-heavy
  // chrome (nav, dashboards, lab-selection portals). This avoids summarising the
  // wrapper UI instead of the lesson.
  function pickMain() {
    const sel =
      "main, article, [role=main], section, .content, #content, .maincontainer, " +
      "[class*=content], [class*=module], [class*=training], [class*=lesson], " +
      "[class*=article], [class*=post], [class*=markdown], [class*=prose], [class*=reading]";
    const cands = [];
    document.querySelectorAll(sel).forEach((el) => { if (cands.length < 300) cands.push(el); });
    document.querySelectorAll("div").forEach((d) => {
      if (cands.length < 400 && d.querySelectorAll(":scope > p").length >= 2) cands.push(d);
    });

    let best = null, bestScore = 0;
    for (const el of cands) {
      if (el === document.body || inChrome(el)) continue;
      let prose = 0;
      el.querySelectorAll("p, li").forEach((p) => { prose += (p.textContent || "").trim().length; });
      if (prose < 150) continue;                       // needs real reading content
      const noise = el.querySelectorAll("a, button, input, nav").length;
      const score = prose - noise * 30;                // dashboards = many links, little prose → low
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best || document.querySelector("main, article, [role=main]") || document.body;
  }

  function extract() {
    const root = pickMain();
    const out = {
      url: location.href,
      host: location.hostname,
      title: clean(document.title, 200),
      headers: [],
      paragraphs: [],
      forms: [],
      buttons: [],
      links: [],
      code: [],
      bodyText: "",
    };

    // Headers
    root.querySelectorAll("h1,h2,h3,h4").forEach((h) => {
      if (out.headers.length >= 25) return;
      if (inChrome(h) || !isVisible(h)) return;
      const t = clean(h.textContent, 160);
      if (t && !FLUFF_HINT.test(t)) out.headers.push({ level: h.tagName, text: t });
    });

    // Paragraphs (skip tiny fragments, hidden/mobile-only content, nav chrome, fluff)
    root.querySelectorAll("p, li").forEach((p) => {
      if (out.paragraphs.length >= 40) return;
      if (inChrome(p) || !isVisible(p) || FLUFF_HINT.test(p.className || "")) return;
      const t = clean(p.textContent, 400);
      if (t && t.length > 40) out.paragraphs.push(t);
    });

    // Forms (fields only — never the values, never passwords)
    root.querySelectorAll("form").forEach((f) => {
      if (out.forms.length >= 12) return;
      const fields = [];
      f.querySelectorAll("input,select,textarea").forEach((inp) => {
        const type = (inp.getAttribute("type") || inp.tagName).toLowerCase();
        if (type === "password") {
          fields.push({ name: inp.name || inp.id || "(password)", type: "password" });
          return; // note its presence, never its value
        }
        fields.push({
          name: inp.name || inp.id || inp.getAttribute("placeholder") || "(unnamed)",
          type,
        });
      });
      out.forms.push({
        action: f.getAttribute("action") || "(same page)",
        method: (f.getAttribute("method") || "GET").toUpperCase(),
        fields,
      });
    });

    // Buttons
    root.querySelectorAll("button, input[type=submit], [role=button]").forEach((b) => {
      if (out.buttons.length >= 25) return;
      const t = clean(b.value || b.textContent, 60);
      if (t) out.buttons.push(t);
    });

    // Links (dedupe, keep meaningful anchor text)
    const seen = new Set();
    root.querySelectorAll("a[href]").forEach((a) => {
      if (out.links.length >= 40) return;
      const t = clean(a.textContent, 80);
      const href = a.getAttribute("href") || "";
      if (!t || t.length < 3 || FLUFF_HINT.test(t)) return;
      const k = t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.links.push({ text: t, href: clean(href, 120) });
    });

    // Visible code snippets (skip <code> nested in <pre> to avoid duplicates)
    const seenCode = new Set();
    root.querySelectorAll("pre, code").forEach((c) => {
      if (out.code.length >= 15) return;
      if (c.tagName === "CODE" && c.closest("pre")) return;
      if (!isVisible(c)) return;
      const t = clean(c.textContent, 500);
      if (t && t.length > 8 && !seenCode.has(t)) {
        seenCode.add(t);
        out.code.push(t);
      }
    });

    // A compact body-text blob for keyword detection
    out.bodyText = clean(
      [
        out.title,
        ...out.headers.map((h) => h.text),
        ...out.paragraphs,
      ].join(" \n "),
      12000
    );

    // Full VISIBLE page text (innerText respects display:none / visibility).
    // This is what the AI actually reads — the model can ignore nav/marketing,
    // but it can't summarise content our region-picker failed to grab. Prefer
    // the picked region, but fall back to the whole body so the lesson is never
    // missed just because it lives in an unusual container.
    let full = "";
    try {
      const regionText = (root.innerText || "").trim();
      const bodyTextAll = (document.body.innerText || "").trim();
      full = regionText.length > 200 ? regionText : bodyTextAll;
      if (bodyTextAll.length > full.length * 1.6) full = bodyTextAll; // body has lots more → use it
    } catch (_) {}
    // Same-origin iframes (some platforms render the lesson in one). Cross-origin
    // frames throw on access → skipped.
    try {
      document.querySelectorAll("iframe").forEach((f) => {
        try {
          const t = f.contentDocument && f.contentDocument.body && f.contentDocument.body.innerText;
          if (t && t.trim().length > 200) full += "\n\n[frame]\n" + t.trim();
        } catch (_) {}
      });
    } catch (_) {}
    out.fullText = full.replace(/\n{3,}/g, "\n\n").slice(0, 16000);

    out.lab = detectLab();

    out.stats = {
      headers: out.headers.length,
      paragraphs: out.paragraphs.length,
      forms: out.forms.length,
      buttons: out.buttons.length,
      links: out.links.length,
      code: out.code.length,
    };
    return out;
  }

  // Detect whether this is a hands-on LAB/CHALLENGE (vs a reading lesson), and
  // its solved state — so the coach can switch into "you're in the arena" mode.
  function detectLab() {
    const out = { isLab: false, kind: "lesson", status: null, difficulty: "", title: "" };
    let txt = "";
    try { txt = (document.body.innerText || "").slice(0, 6000); } catch (_) {}

    // Solved / not-solved status (PortSwigger, HTB, Juice Shop patterns).
    if (/congratulations,?\s+you (have\s+)?solved the lab/i.test(txt)) out.status = "solved";
    else if (/\bnot solved\b/i.test(txt)) out.status = "not-solved";
    else if (/\bis-solved\b/i.test(document.body.className + "")) out.status = "solved";

    // Lab/challenge markers — require a real status/widget, NOT just the word "lab"
    // in body text (reading modules mention "lab" constantly).
    const statusEl = document.querySelector(
      '[class*="lab-status"], [class*="labheader"], [class*="lab-header"]'
    );
    const isLab =
      !!statusEl ||
      out.status !== null ||
      /\b(access the lab|launch (the )?lab|not solved|solve the lab)\b/i.test(txt);
    out.isLab = isLab;
    out.kind = isLab ? "lab" : "lesson";

    // Difficulty (PortSwigger) / and a short lab title from the h1.
    const diff = txt.match(/\b(APPRENTICE|PRACTITIONER|EXPERT)\b/);
    if (diff) out.difficulty = diff[1];
    const h1 = document.querySelector("h1");
    if (h1) out.title = (h1.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
    return out;
  }

  WPC.extract = extract;
})();
