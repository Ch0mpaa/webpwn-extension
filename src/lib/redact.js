/*
 * WebPwn Coach — Redaction
 * Before any page text leaves the tab (e.g. to an optional LLM backend),
 * scrub obvious secrets. We never collect passwords or credentials.
 * The user can preview the exact payload before it is sent.
 */
(function () {
  const WPC = (globalThis.WPC = globalThis.WPC || {});

  const PATTERNS = [
    // Bearer / Authorization tokens
    { re: /\b(bearer\s+)[A-Za-z0-9._~+\/-]{12,}=*/gi, tag: "[REDACTED_TOKEN]" },
    // JWT-looking strings (three dot-separated base64url segments)
    { re: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, tag: "[REDACTED_JWT]" },
    // API keys (common prefixes)
    { re: /\b(sk|pk|api|key|ghp|xox[baprs])[-_][A-Za-z0-9]{16,}/gi, tag: "[REDACTED_KEY]" },
    // AWS access key ids
    { re: /\bAKIA[0-9A-Z]{16}\b/g, tag: "[REDACTED_AWS_KEY]" },
    // Private key blocks
    { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, tag: "[REDACTED_PRIVATE_KEY]" },
    // password=... / "password": "..."
    { re: /("?password"?\s*[:=]\s*)("?)[^"'\s,&}]{1,}\2/gi, tag: '$1[REDACTED]' },
    { re: /("?(secret|passwd|pwd|token|apikey|api_key)"?\s*[:=]\s*)("?)[^"'\s,&}]{1,}\3/gi, tag: '$1[REDACTED]' },
    // Long hex blobs (session ids etc.)
    { re: /\b[a-f0-9]{32,}\b/gi, tag: "[REDACTED_HEX]" },
  ];

  /**
   * Redact secrets from a string.
   * @param {string} text
   * @returns {{text:string, count:number}}
   */
  function redact(text) {
    if (!text) return { text: "", count: 0 };
    let count = 0;
    let out = String(text);
    for (const p of PATTERNS) {
      out = out.replace(p.re, (m, ...groups) => {
        count++;
        // Support replacements that reference capture group 1 (keeps the key name).
        if (/\$1/.test(p.tag)) {
          return p.tag.replace("$1", groups[0] || "");
        }
        return p.tag;
      });
    }
    return { text: out, count };
  }

  /** Redact every string field of an extracted-context object. */
  function redactContext(ctx) {
    let total = 0;
    const walk = (v) => {
      if (typeof v === "string") {
        const r = redact(v);
        total += r.count;
        return r.text;
      }
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") {
        const o = {};
        for (const k of Object.keys(v)) o[k] = walk(v[k]);
        return o;
      }
      return v;
    };
    const clean = walk(ctx);
    return { context: clean, redactions: total };
  }

  WPC.redact = redact;
  WPC.redactContext = redactContext;
})();
