/*
 * WebPwn Coach — HTTP / HAR parsing (Traffic Import)
 * Parses pasted raw HTTP requests/responses and HAR exports into a structured
 * shape the coach can teach from. Redacts auth material by default.
 *
 * Attaches to globalThis.WPC.http.
 */
(function () {
  const WPC = (globalThis.WPC = globalThis.WPC || {});

  const REQUEST_LINE = /^([A-Z]+)\s+(\S+)\s+HTTP\/\d(?:\.\d)?\s*$/;
  const STATUS_LINE = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\s*(.*)$/;
  const REDACT_HEADERS = new Set(["authorization", "cookie", "set-cookie", "x-api-key", "proxy-authorization"]);
  const JWT_RE = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;

  function redactValue(name, value) {
    if (REDACT_HEADERS.has(name.toLowerCase())) return "[REDACTED]";
    return String(value).replace(JWT_RE, "[REDACTED_JWT]");
  }
  function redactBody(s) {
    return String(s || "")
      .replace(JWT_RE, "[REDACTED_JWT]")
      .replace(/("?password"?\s*[:=]\s*)("?)[^"'&\s,}]+\2/gi, "$1[REDACTED]");
  }

  function parseHeaderLines(lines) {
    const headers = [];
    for (const ln of lines) {
      const idx = ln.indexOf(":");
      if (idx < 1) continue;
      const name = ln.slice(0, idx).trim();
      const value = ln.slice(idx + 1).trim();
      headers.push({ name, value: redactValue(name, value), raw: name });
    }
    return headers;
  }
  function headerVal(headers, name) {
    const h = headers.find((x) => x.raw.toLowerCase() === name.toLowerCase());
    return h ? h.value : "";
  }

  function splitBlocks(raw) {
    // Split a blob into request/response by locating request & status lines.
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    let cur = null;
    for (const ln of lines) {
      if (REQUEST_LINE.test(ln) || STATUS_LINE.test(ln)) {
        if (cur) blocks.push(cur);
        cur = { kind: REQUEST_LINE.test(ln) ? "request" : "response", lines: [ln] };
      } else if (cur) {
        cur.lines.push(ln);
      }
    }
    if (cur) blocks.push(cur);
    return blocks;
  }

  function parseRequestBlock(lines) {
    const m = REQUEST_LINE.exec(lines[0]);
    if (!m) return null;
    const method = m[1];
    const rawUrl = m[2];
    const blank = lines.indexOf("", 1);
    const headerLines = lines.slice(1, blank === -1 ? lines.length : blank);
    const body = blank === -1 ? "" : lines.slice(blank + 1).join("\n").trim();
    const headers = parseHeaderLines(headerLines);
    const host = headerVal(headers, "host");
    let url = rawUrl, path = rawUrl, query = "";
    try {
      const u = new URL(/^https?:\/\//.test(rawUrl) ? rawUrl : "http://" + (host || "x") + rawUrl);
      path = u.pathname; query = u.search; url = u.href;
    } catch (_) {}
    return {
      method, url, path, query, host,
      headers,
      contentType: headerVal(headers, "content-type"),
      hasCookie: !!headerVal(headers, "cookie"),
      hasAuth: !!headerVal(headers, "authorization"),
      body: redactBody(body),
      params: extractParams(query, body, headerVal(headers, "content-type")),
    };
  }

  function parseResponseBlock(lines) {
    const m = STATUS_LINE.exec(lines[0]);
    if (!m) return null;
    const blank = lines.indexOf("", 1);
    const headerLines = lines.slice(1, blank === -1 ? lines.length : blank);
    const body = blank === -1 ? "" : lines.slice(blank + 1).join("\n").trim();
    const headers = parseHeaderLines(headerLines);
    let json = null;
    try { json = JSON.parse(body); } catch (_) {}
    return {
      status: parseInt(m[1], 10),
      statusText: m[2] || "",
      headers,
      contentType: headerVal(headers, "content-type"),
      setsCookie: !!headerVal(headers, "set-cookie"),
      body: redactBody(body),
      json: json && typeof json === "object" ? Object.keys(json).slice(0, 40) : null,
    };
  }

  function extractParams(query, body, contentType) {
    const params = [];
    const push = (name, where) => {
      if (!name) return;
      const idish = /\b(id|user|account|order|receipt|invoice|uid|pid|oid|token|role|admin)\b/i.test(name);
      params.push({ name, where, idish });
    };
    try {
      new URLSearchParams(query.replace(/^\?/, "")).forEach((_, k) => push(k, "query"));
    } catch (_) {}
    if (body) {
      if (/json/i.test(contentType || "")) {
        try { Object.keys(JSON.parse(body)).forEach((k) => push(k, "json-body")); } catch (_) {}
      } else if (/urlencoded/i.test(contentType || "") || /=/.test(body)) {
        try { new URLSearchParams(body).forEach((_, k) => push(k, "form-body")); } catch (_) {}
      }
    }
    return params;
  }

  /** Parse a pasted request and/or response blob. */
  function parseText(raw) {
    const blocks = splitBlocks(raw || "");
    const out = { request: null, response: null, ok: false };
    for (const b of blocks) {
      if (b.kind === "request" && !out.request) out.request = parseRequestBlock(b.lines);
      if (b.kind === "response" && !out.response) out.response = parseResponseBlock(b.lines);
    }
    out.ok = !!(out.request || out.response);
    return out;
  }

  /** Parse a HAR export into a compact endpoint summary. */
  function parseHar(text) {
    let har;
    try { har = JSON.parse(text); } catch (_) { return { ok: false, error: "Not valid JSON/HAR." }; }
    const entries = (har.log && har.log.entries) || [];
    const hosts = new Set();
    const items = entries.slice(0, 200).map((e, i) => {
      const req = e.request || {};
      const res = e.response || {};
      let host = "";
      try { host = new URL(req.url).host; } catch (_) {}
      if (host) hosts.add(host);
      const qp = (req.queryString || []).map((q) => ({ name: q.name, where: "query", idish: /\b(id|user|order|token|role)\b/i.test(q.name) }));
      return {
        id: i + 1,
        method: req.method,
        url: req.url,
        host,
        status: res.status,
        contentType: (res.content && res.content.mimeType) || "",
        setsCookie: (res.headers || []).some((h) => h.name.toLowerCase() === "set-cookie"),
        hasAuth: (req.headers || []).some((h) => h.name.toLowerCase() === "authorization"),
        params: qp,
      };
    });
    return { ok: true, count: items.length, hosts: [...hosts], items };
  }

  WPC.http = { parseText, parseHar, extractParams, redactBody };
})();
