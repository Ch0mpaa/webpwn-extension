#!/usr/bin/env node
/*
 * WebPwn Coach — Traffic Bridge (receive-only, NOT a proxy)
 *
 * Burp/Caido stay your intercepting proxy + Repeater/Intruder. This bridge only
 * RECEIVES a request/response you choose to send it (via a Burp extension,
 * context-menu action, webhook, or copy/paste) so WebPwn Coach can teach from
 * it. It never intercepts or modifies traffic.
 *
 * API (127.0.0.1:8088):
 *   GET    /health
 *   POST   /traffic            ← Burp/Caido push a request here (JSON or raw HTTP)
 *   GET    /traffic/recent
 *   GET    /traffic/:id
 *   DELETE /traffic
 *
 * Sensitive headers (Authorization/Cookie/Set-Cookie/JWT/password) are REDACTED
 * for anything the extension shows or sends to AI. A local-only raw copy is kept
 * so you can inspect the real request in the extension's "Reveal raw (local)".
 */
"use strict";
const http = require("http");
const { URL } = require("url");

const PORT = parseInt(process.env.PORT || "8088", 10);
const HOST = "127.0.0.1";
const MAX = 300;

const SENSITIVE = /^(authorization|cookie|set-cookie|x-api-key|proxy-authorization)$/i;
const JWT_RE = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;

let traffic = [];
let seq = 1;

function redactHeaders(h) {
  const out = {};
  for (const k of Object.keys(h || {})) {
    out[k] = SENSITIVE.test(k) ? "[REDACTED]" : String(h[k]).replace(JWT_RE, "[REDACTED_JWT]");
  }
  return out;
}
function redactBody(s) {
  if (!s) return "";
  return String(s).slice(0, 4096)
    .replace(JWT_RE, "[REDACTED_JWT]")
    .replace(/("?password"?\s*[:=]\s*)("?)[^"'&\s,}]+\2/gi, "$1[REDACTED]");
}
function hasSensitive(headers, raw) {
  if (headers) for (const k of Object.keys(headers)) if (SENSITIVE.test(k)) return true;
  return JWT_RE.test(raw || "") || /(^|\n)(authorization|cookie|set-cookie):/i.test(raw || "");
}

function json(res, code, obj) {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    // Chrome Private Network Access: allow a public/extension page to reach loopback.
    "access-control-allow-private-network": "true",
  });
  res.end(JSON.stringify(obj));
}

// Parse a raw HTTP request (+ optional response) block into fields.
function parseRaw(raw) {
  const lines = String(raw).replace(/\r\n/g, "\n").split("\n");
  const out = { method: "", url: "", host: "", reqHeaders: {}, reqBody: "", status: null, respHeaders: {}, respBody: "" };
  const reqM = /^([A-Z]+)\s+(\S+)\s+HTTP\//.exec(lines[0] || "");
  let i = 0;
  if (reqM) {
    out.method = reqM[1]; out.url = reqM[2];
    i = 1;
    for (; i < lines.length && lines[i].trim() !== ""; i++) {
      const c = lines[i].indexOf(":"); if (c < 1) continue;
      const n = lines[i].slice(0, c).trim(); const v = lines[i].slice(c + 1).trim();
      out.reqHeaders[n] = v; if (n.toLowerCase() === "host") out.host = v;
    }
    if (i < lines.length) out.reqBody = lines.slice(i + 1).join("\n").trim();
  }
  // Reconstruct absolute URL if only a path was given.
  if (out.url && !/^https?:\/\//.test(out.url) && out.host) out.url = "http://" + out.host + out.url;
  return out;
}

function ingest(payload, contentType) {
  let e;
  if (/json/i.test(contentType || "")) {
    let o = {}; try { o = JSON.parse(payload); } catch (_) {}
    if (o.method || o.url || o.reqHeaders || o.requestHeaders) {
      // Structured push (Burp extension) — always wins; raw is kept only locally.
      e = {
        method: o.method || "", url: o.url || "", host: hostOf(o.url),
        path: o.path || "", tool: o.tool || "",
        reqHeaders: o.reqHeaders || o.requestHeaders || {}, reqBody: o.reqBody || o.requestBody || "",
        status: o.status || (o.response && o.response.status) || null,
        respHeaders: o.respHeaders || o.responseHeaders || {}, respBody: o.respBody || o.responseBody || "",
      };
      e._raw = o.raw || "";
    } else if (o.raw) {
      e = parseRaw(o.raw); e._raw = o.raw; e.tool = o.tool || "";
    } else {
      e = parseRaw(payload); e._raw = payload;
    }
  } else {
    e = parseRaw(payload); e._raw = payload;
  }
  const sensitive = hasSensitive(e.reqHeaders, e._raw) || hasSensitive(e.respHeaders, "");
  return {
    id: seq++, ts: Date.now(),
    tool: e.tool || "", method: e.method || "?", url: e.url || "", path: e.path || "", host: e.host || hostOf(e.url),
    status: e.status, contentType: (e.respHeaders && (e.respHeaders["content-type"] || e.respHeaders["Content-Type"])) || "",
    reqHeaders: redactHeaders(e.reqHeaders), reqBody: redactBody(e.reqBody),
    respHeaders: redactHeaders(e.respHeaders), respBody: redactBody(e.respBody),
    hasSensitive: sensitive,
    raw: e._raw ? String(e._raw).slice(0, 8000) : "",
  };
}
function hostOf(u) { try { return new URL(u).host; } catch (_) { return ""; } }
function summary(t) { return { id: t.id, ts: t.ts, tool: t.tool, method: t.method, url: t.url, path: t.path, host: t.host, status: t.status, hasSensitive: t.hasSensitive }; }

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = u.pathname;
  if (req.method === "OPTIONS") return json(res, 204, {});

  if (path === "/health") return json(res, 200, { ok: true, service: "webpwn-coach-bridge", port: PORT, count: traffic.length });

  if (path === "/traffic" && req.method === "POST") {
    let body = ""; req.on("data", (c) => { if (body.length < 200000) body += c; });
    req.on("end", () => {
      try {
        const entry = ingest(body, req.headers["content-type"]);
        traffic.unshift(entry); if (traffic.length > MAX) traffic.length = MAX;
        json(res, 200, { ok: true, id: entry.id });
      } catch (e) { json(res, 400, { ok: false, error: String(e && e.message || e) }); }
    });
    return;
  }
  if (path === "/traffic/recent" && req.method === "GET") return json(res, 200, { count: traffic.length, items: traffic.map(summary) });
  if (path === "/traffic" && req.method === "DELETE") { traffic = []; return json(res, 200, { ok: true, cleared: true }); }
  if (path.startsWith("/traffic/") && req.method === "GET") {
    const id = parseInt(path.split("/")[2], 10);
    const item = traffic.find((t) => t.id === id);
    return item ? json(res, 200, item) : json(res, 404, { ok: false, error: "not found" });
  }
  return json(res, 404, { ok: false, error: "unknown endpoint" });
});

server.listen(PORT, HOST, () => {
  console.log(`WebPwn Coach traffic bridge on http://${HOST}:${PORT}  (receive-only — not a proxy)`);
  console.log(`  POST /traffic  ·  GET /traffic/recent  ·  GET /traffic/:id  ·  DELETE /traffic  ·  GET /health`);
  console.log(`  Send a request from Burp/Caido (or: curl -X POST -H 'content-type: text/plain' --data-binary @req.txt http://127.0.0.1:${PORT}/traffic)`);
});

module.exports = { server, ingest, redactHeaders, hasSensitive };
