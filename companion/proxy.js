#!/usr/bin/env node
/*
 * WebPwn Coach — Local Companion Proxy (study proxy, NOT a Burp replacement)
 *
 * A tiny forward proxy on 127.0.0.1:8088 that captures HTTP metadata + body
 * previews so the extension can teach you to read traffic. It is intentionally
 * minimal and safe:
 *   - captures method/url/headers/status/content-type/body-preview
 *   - REDACTS Authorization, Cookie, Set-Cookie, X-API-Key and JWT-like values
 *   - only STORES traffic for allowlisted study domains
 *   - never captures passwords in bodies (form 'password' fields are masked)
 *   - HTTPS: CONNECT is tunneled and only its metadata is recorded (no TLS
 *     interception in the MVP — see README for the CA-cert path)
 *
 * Local API (same port; requests with a path instead of an absolute URL):
 *   GET    /health
 *   GET    /traffic
 *   GET    /traffic/:id
 *   DELETE /traffic
 *   POST   /pause            (toggle capture; body {paused:true|false} optional)
 *
 * Optional upstream (forward to Burp/Caido):
 *   BURP_UPSTREAM=http://127.0.0.1:8080 node proxy.js
 */
"use strict";
const http = require("http");
const net = require("net");
const { URL } = require("url");

const PORT = parseInt(process.env.PORT || "8088", 10);
const HOST = "127.0.0.1";
const MAX = 200;
const BODY_PREVIEW = 2048;
const UPSTREAM = process.env.BURP_UPSTREAM ? new URL(process.env.BURP_UPSTREAM) : null;

const ALLOWLIST = [
  "webpwn.me", "lab.webpwn.me", "localhost", "127.0.0.1",
  "portswigger.net", "web-security-academy.net",
  "hackthebox.com", "academy.hackthebox.com",
  "owasp.org", "juice-shop.herokuapp.com",
];

const REDACT_HEADERS = new Set(["authorization", "cookie", "set-cookie", "x-api-key", "proxy-authorization"]);
const JWT_RE = /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;

let traffic = [];
let seq = 1;
let paused = false;

// ---- helpers ----------------------------------------------------------------

function hostAllowed(host) {
  if (!host) return false;
  const h = host.split(":")[0].toLowerCase();
  return ALLOWLIST.some((a) => h === a || h.endsWith("." + a));
}

function redactHeaders(headers) {
  const out = {};
  for (const k of Object.keys(headers || {})) {
    const lk = k.toLowerCase();
    if (REDACT_HEADERS.has(lk)) out[k] = "[REDACTED]";
    else out[k] = String(headers[k]).replace(JWT_RE, "[REDACTED_JWT]");
  }
  return out;
}

function redactBody(buf, contentType) {
  if (!buf || !buf.length) return "";
  let s = buf.slice(0, BODY_PREVIEW).toString("utf8");
  s = s.replace(JWT_RE, "[REDACTED_JWT]");
  // Mask password fields in form/JSON bodies.
  s = s.replace(/("?password"?\s*[:=]\s*)("?)[^"'&\s,}]+\2/gi, "$1[REDACTED]");
  const truncated = buf.length > BODY_PREVIEW;
  return truncated ? s + "\n…[truncated]" : s;
}

function record(entry) {
  if (paused) return;
  if (!hostAllowed(entry.host)) return; // only store study domains
  entry.id = seq++;
  entry.ts = Date.now();
  traffic.unshift(entry);
  if (traffic.length > MAX) traffic.length = MAX;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(body);
}

// ---- local API (path requests) ----------------------------------------------

function handleApi(req, res) {
  const u = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = u.pathname;

  if (req.method === "OPTIONS") return json(res, 204, {});

  if (path === "/health") {
    return json(res, 200, {
      ok: true, service: "webpwn-coach-proxy", port: PORT,
      paused, captured: traffic.length, upstream: UPSTREAM ? UPSTREAM.href : null,
      allowlist: ALLOWLIST,
    });
  }
  if (path === "/traffic" && req.method === "GET") {
    return json(res, 200, { count: traffic.length, items: traffic.map(summary) });
  }
  if (path.startsWith("/traffic/") && req.method === "GET") {
    const id = parseInt(path.split("/")[2], 10);
    const item = traffic.find((t) => t.id === id);
    return item ? json(res, 200, item) : json(res, 404, { ok: false, error: "not found" });
  }
  if (path === "/traffic" && req.method === "DELETE") {
    traffic = [];
    return json(res, 200, { ok: true, cleared: true });
  }
  if (path === "/pause") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { const j = body ? JSON.parse(body) : {}; paused = typeof j.paused === "boolean" ? j.paused : !paused; }
      catch (_) { paused = !paused; }
      json(res, 200, { ok: true, paused });
    });
    return;
  }
  return json(res, 404, { ok: false, error: "unknown endpoint" });
}

function summary(t) {
  return {
    id: t.id, ts: t.ts, method: t.method, url: t.url, host: t.host,
    status: t.status, contentType: t.contentType, scheme: t.scheme,
  };
}

// ---- forward proxy (absolute-URL requests) ----------------------------------

function handleProxy(req, res) {
  let target;
  try { target = new URL(req.url); } catch (_) { return json(res, 400, { ok: false, error: "bad url" }); }

  const chunks = [];
  req.on("data", (c) => chunks.length < 64 && chunks.push(c));
  req.on("end", () => {
    const reqBody = Buffer.concat(chunks);
    const opts = buildForwardOpts(target, req);
    const upstream = http.request(opts, (up) => {
      const rchunks = [];
      up.on("data", (c) => { if (Buffer.concat(rchunks).length < BODY_PREVIEW * 2) rchunks.push(c); });
      up.on("end", () => {
        const respBody = Buffer.concat(rchunks);
        record({
          scheme: "http",
          method: req.method,
          url: req.url,
          host: target.host,
          status: up.statusCode,
          contentType: up.headers["content-type"] || "",
          reqHeaders: redactHeaders(req.headers),
          reqBody: redactBody(reqBody, req.headers["content-type"]),
          respHeaders: redactHeaders(up.headers),
          respBody: redactBody(respBody, up.headers["content-type"]),
        });
      });
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on("error", (e) => { try { res.writeHead(502); res.end("proxy error: " + e.message); } catch (_) {} });
    if (reqBody.length) upstream.write(reqBody);
    upstream.end();
  });
}

function buildForwardOpts(target, req) {
  if (UPSTREAM) {
    // Forward through Burp/Caido: keep absolute path in request line.
    return {
      host: UPSTREAM.hostname, port: UPSTREAM.port || 8080,
      method: req.method, path: target.href, headers: req.headers,
    };
  }
  return {
    host: target.hostname, port: target.port || 80,
    method: req.method, path: target.pathname + target.search, headers: req.headers,
  };
}

// ---- HTTPS CONNECT (metadata-only tunnel) -----------------------------------

function handleConnect(req, clientSocket, head) {
  const [host, port] = req.url.split(":");
  record({
    scheme: "https", method: "CONNECT", url: req.url, host: req.url,
    status: 200, contentType: "(encrypted — TLS not intercepted)",
    reqHeaders: redactHeaders(req.headers), reqBody: "", respHeaders: {}, respBody: "",
  });
  const [uHost, uPort] = UPSTREAM ? [UPSTREAM.hostname, UPSTREAM.port || 8080] : [host, parseInt(port, 10) || 443];
  const serverSocket = net.connect(uPort, uHost, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (UPSTREAM) serverSocket.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\n\r\n`);
    if (head && head.length) serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });
  serverSocket.on("error", () => clientSocket.end());
  clientSocket.on("error", () => serverSocket.end());
}

// ---- server -----------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.url && /^https?:\/\//i.test(req.url)) return handleProxy(req, res);
  return handleApi(req, res);
});
server.on("connect", handleConnect);

server.listen(PORT, HOST, () => {
  console.log(`WebPwn Coach proxy on http://${HOST}:${PORT}`);
  console.log(`  API: GET /health  GET /traffic  GET /traffic/:id  DELETE /traffic  POST /pause`);
  console.log(`  upstream: ${UPSTREAM ? UPSTREAM.href : "(none — direct)"}`);
  console.log(`  capturing study domains only: ${ALLOWLIST.join(", ")}`);
});

module.exports = { server, hostAllowed, redactHeaders, redactBody };
