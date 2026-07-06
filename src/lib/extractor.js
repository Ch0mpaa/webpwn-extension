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

  function clean(s, max) {
    if (!s) return "";
    s = s.replace(/\s+/g, " ").trim();
    if (max && s.length > max) s = s.slice(0, max).trim() + "…";
    return s;
  }

  function isVisible(el) {
    if (!el || SKIP_TAGS.has(el.tagName)) return false;
    const st = el.ownerDocument.defaultView.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
    return true;
  }

  function pickMain() {
    return (
      document.querySelector("main, article, [role=main], .content, #content") ||
      document.body
    );
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
      const t = clean(h.textContent, 160);
      if (t && !FLUFF_HINT.test(t)) out.headers.push({ level: h.tagName, text: t });
    });

    // Paragraphs (skip tiny fragments and obvious fluff)
    root.querySelectorAll("p, li").forEach((p) => {
      if (out.paragraphs.length >= 40) return;
      if (FLUFF_HINT.test(p.className || "")) return;
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

  WPC.extract = extract;
})();
