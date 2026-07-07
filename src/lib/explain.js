/*
 * WebPwn Coach — Code & Artifact Explainer
 * Given a snippet (JWT, JSON, SQL, JS/PHP/Java/Python/Node, or an HTTP
 * request/response), classify it and teach: what it is, what it does, the
 * security concept, why it matters, what a beginner should recognise next
 * time, and the vulnerability family. Never a payload.
 *
 * Also frames parsed traffic through the full Assessment Lens (+ DEBRIEF),
 * identifies users/objects, and suggests the next test (coaching, gated).
 *
 * Attaches to globalThis.WPC.explain.
 */
(function () {
  const WPC = (globalThis.WPC = globalThis.WPC || {});

  // Lenient on the signature so alg=none tokens (empty 3rd segment) still classify.
  const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/;
  const SQL_RE = /\b(select|insert|update|delete|union|from|where|drop|or\s+1=1)\b/i;
  const SQL_ERR = /(sql syntax|sqlstate|ora-\d+|mysql_fetch|unclosed quotation|psql:|syntax error at or near)/i;

  function b64urlDecode(s) {
    try {
      s = s.replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4) s += "=";
      return decodeURIComponent(
        atob(s).split("").map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
      );
    } catch (_) {
      try { return atob(s); } catch (__) { return ""; }
    }
  }

  function link(conceptId) {
    const c = WPC.getConcept && WPC.getConcept(conceptId);
    return c ? { id: c.id, name: c.name, coach: c.coach.slice(0, 2) } : null;
  }

  // ---- classifiers -----------------------------------------------------------

  function classify(text) {
    const t = (text || "").trim();
    if (!t) return "empty";
    if (JWT_RE.test(t)) return "jwt";
    if (WPC.http && /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\S+\s+HTTP\/|^HTTP\/\d/m.test(t)) return "http";
    if ((t.startsWith("{") || t.startsWith("[")) && isJson(t)) return "json";
    if (SQL_ERR.test(t)) return "sql-error";
    if (SQL_RE.test(t) && /\b(from|where|select|values)\b/i.test(t)) return "sql";
    if (/<\?php|\$_(GET|POST|REQUEST|SESSION|COOKIE)\b/.test(t)) return "php";
    if (/\b(public\s+class|import\s+java|@RequestMapping|@GetMapping|HttpServletRequest)\b/.test(t)) return "java";
    if (/\b(def\s+\w+\(|import\s+(flask|django)|@app\.route|request\.(args|form))\b/.test(t)) return "python";
    if (/\b(app\.(get|post|use)|req\.(query|params|body)|res\.(send|json)|require\()/.test(t)) return "node";
    if (/\b(function|const|let|var|=>|document\.|window\.|addEventListener)\b/.test(t)) return "javascript";
    return "unknown";
  }
  function isJson(t) { try { JSON.parse(t); return true; } catch (_) { return false; } }

  // ---- explainers ------------------------------------------------------------

  function explainJwt(text) {
    const tok = (text.match(JWT_RE) || [text])[0];
    const [h, p] = tok.split(".");
    let header = {}, payload = {};
    try { header = JSON.parse(b64urlDecode(h)); } catch (_) {}
    try { payload = JSON.parse(b64urlDecode(p)); } catch (_) {}
    const alg = header.alg || "?";
    const claims = Object.keys(payload);
    const juicy = claims.filter((k) => /^(role|admin|isadmin|scope|iss|aud|sub|user|email|perm)/i.test(k));
    const exp = payload.exp ? new Date(payload.exp * 1000).toISOString() : "(none — no expiry!)";
    return {
      type: "JWT (JSON Web Token)",
      format: "Three base64url segments: header.payload.signature (encoded, NOT encrypted).",
      structure: [
        `HEADER: alg=${alg}, typ=${header.typ || "?"} — declares how it's signed.`,
        `PAYLOAD claims: ${claims.join(", ") || "(none)"}.`,
        `SIGNATURE: proves integrity IF the server actually verifies it.`,
        `EXPIRY (exp): ${exp}.`,
      ],
      whatItDoes: "Carries identity/role claims the server trusts on each request.",
      concept: link("jwt"),
      why: "Anyone can read the payload (it's just base64). Security depends entirely on the signature check and the algorithm.",
      beginnerNext: "Decode the payload first. Look for role/admin claims and a missing/short exp. Note the alg.",
      vulnFamily: "JWT — alg confusion (none/RS256→HS256), weak secret, missing verification, no expiry.",
      highlights: { alg, hasExpiry: !!payload.exp, interestingClaims: juicy },
      coach: (link("jwt") || {}).coach || [],
    };
  }

  function explainJson(text) {
    let obj = {};
    try { obj = JSON.parse(text); } catch (_) {}
    const keys = Array.isArray(obj) ? (obj[0] ? Object.keys(obj[0]) : []) : Object.keys(obj);
    const idKeys = keys.filter((k) => /\b(id|_id|uid|user|owner|account|order)\b/i.test(k));
    const roleKeys = keys.filter((k) => /\b(role|admin|isadmin|scope|perm|is_.*)\b/i.test(k));
    return {
      type: "JSON object" + (Array.isArray(obj) ? " (array)" : ""),
      format: "Key/value data — often an object the API owns and returns.",
      structure: [
        `Keys: ${keys.slice(0, 20).join(", ") || "(none)"}.`,
        idKeys.length ? `Object-ownership fields: ${idKeys.join(", ")} — whose object is this?` : "No obvious id fields.",
        roleKeys.length ? `Role/permission fields: ${roleKeys.join(", ")} — server-controlled or client-writable?` : "",
      ].filter(Boolean),
      whatItDoes: "Represents an application object (a record, user, order, session…).",
      concept: link(idKeys.length ? "idor" : roleKeys.length ? "mass-assignment" : "trust-boundary"),
      why: "IDs reveal object ownership (IDOR territory); role/flag fields reveal what you might over-write (mass assignment).",
      beginnerNext: "Ask for every key: who should be allowed to READ it, and who should be allowed to WRITE it?",
      vulnFamily: idKeys.length ? "Authorization / IDOR / BOLA" : roleKeys.length ? "Mass Assignment" : "Object modelling",
      highlights: { idKeys, roleKeys },
      coach: ["Which of these fields should only the server set?", "Whose object does this id refer to?"],
    };
  }

  function explainSql(text, isError) {
    return {
      type: isError ? "SQL error message" : "SQL query",
      format: isError ? "A database error leaking query structure." : "A SQL statement — data and code share one string.",
      structure: isError
        ? ["The error reveals the DB engine and often where your input landed in the query."]
        : ["Look for where user input is concatenated into the statement (quotes, WHERE clauses)."],
      whatItDoes: isError ? "Signals your input reached the SQL layer and broke its grammar." : "Queries/changes the database based on parameters.",
      concept: link("sqli"),
      why: "If input is concatenated (not parameterised), you can change the query's meaning — that's SQL injection.",
      beginnerNext: "Find the injection point: which user-supplied value sits inside the query? Is it quoted?",
      vulnFamily: "SQL Injection (error/union/boolean/time-based).",
      highlights: { engineHint: (text.match(SQL_ERR) || [])[0] || null },
      coach: (link("sqli") || {}).coach || [],
    };
  }

  function explainServerCode(text, lang) {
    const langName = { php: "PHP", java: "Java", python: "Python", node: "Node/Express" }[lang] || lang;
    const auth = /\b(auth|login|isAdmin|role|permission|@PreAuthorize|current_user|req\.user|session)\b/i.test(text);
    return {
      type: `${langName} server code`,
      format: `Server-side ${langName} — a route/controller handling a request.`,
      structure: [
        "Identify the ROUTE (what URL/verb triggers it).",
        "Identify where REQUEST INPUT is read (query/body/params).",
        auth ? "An auth/role check appears present — is it BEFORE the sensitive action?" : "No obvious authorization check — is one missing?",
      ],
      whatItDoes: "Receives a request, reads input, and performs an action or query.",
      concept: link(auth ? "access-control" : "trust-boundary"),
      why: "Bugs cluster where input is trusted and where authorization is (or isn't) enforced before the action.",
      beginnerNext: "Trace input from the request to the action. Ask: is it validated? Is the caller authorized?",
      vulnFamily: auth ? "Broken Access Control / Authorization" : "Input trust / injection surface",
      highlights: { authCheckSeen: auth },
      coach: ["Where does untrusted input enter this handler?", "Is authorization checked before the sensitive action?"],
    };
  }

  function explainClientJs(text) {
    const validation = /\b(validate|required|pattern|checkPassword|if\s*\(.*length|test\()/i.test(text);
    return {
      type: "Client-side JavaScript",
      format: "Runs in the browser — fully visible and modifiable by the user.",
      structure: [
        validation ? "Contains validation logic — but client-side checks are advisory only." : "Handles UI/behaviour in the browser.",
        "Anything enforced here can be bypassed by not using the UI.",
      ],
      whatItDoes: "Controls front-end behaviour; may include validation or hidden endpoints.",
      concept: link("trust-boundary"),
      why: "Client-side validation is a UX nicety, not a security control. The server must re-validate everything.",
      beginnerNext: "Never trust front-end validation. Find the request it produces and test the server directly.",
      vulnFamily: "Client vs server trust boundary (bypassable validation).",
      highlights: { validationSeen: validation },
      coach: ["What does this enforce — and does the server enforce it too?", "What request does this code ultimately send?"],
    };
  }

  function explainHttp(text) {
    const parsed = WPC.http ? WPC.http.parseText(text) : { ok: false };
    return {
      type: "HTTP request/response",
      format: "Raw HTTP — method, URL, headers, body, status.",
      structure: buildHttpStructure(parsed),
      whatItDoes: "A single client↔server exchange — the unit of web testing.",
      concept: link("trust-boundary"),
      why: "Every request crosses a trust boundary. Parameters, ids, cookies and status codes tell the story.",
      beginnerNext: "Read the method+URL, then the parameters, then cookies/auth, then the status. Ask what each trusts.",
      vulnFamily: "Depends on the endpoint — map it through the Assessment Lens.",
      parsed,
      coach: ["What object does this request act on?", "What makes it authorized — and could an attacker forge that?"],
    };
  }
  function buildHttpStructure(p) {
    const s = [];
    if (p.request) {
      s.push(`REQUEST: ${p.request.method} ${p.request.path}${p.request.query || ""}`);
      if (p.request.params.length) s.push("Params: " + p.request.params.map((x) => x.name + (x.idish ? "⚑" : "")).join(", "));
      s.push(`Auth header: ${p.request.hasAuth ? "present (redacted)" : "none"} · Cookie: ${p.request.hasCookie ? "present" : "none"}`);
    }
    if (p.response) s.push(`RESPONSE: ${p.response.status} ${p.response.statusText} (${p.response.contentType || "?"})`);
    return s;
  }

  /** Main entry: explain any pasted artifact. */
  function explainArtifact(text) {
    const kind = classify(text);
    switch (kind) {
      case "empty": return { ok: false, message: "Paste a snippet: a JWT, JSON, SQL, code, or an HTTP request/response." };
      case "jwt": return ok(explainJwt(text));
      case "json": return ok(explainJson(text));
      case "sql": return ok(explainSql(text, false));
      case "sql-error": return ok(explainSql(text, true));
      case "php": case "java": case "python": case "node": return ok(explainServerCode(text, kind));
      case "javascript": return ok(explainClientJs(text));
      case "http": return ok(explainHttp(text));
      default:
        return ok({
          type: "Unrecognised snippet",
          format: "Couldn't confidently classify this.",
          structure: ["Try pasting a cleaner boundary (just the JWT, just the JSON, or the full HTTP block)."],
          whatItDoes: "—",
          concept: link("trust-boundary"),
          why: "Even so: what is it, where does it enter the system, and who trusts it?",
          beginnerNext: "Isolate the interesting part and paste that.",
          vulnFamily: "—",
          coach: ["What is this, in one sentence?", "Where would it cross a trust boundary?"],
        });
    }
  }
  function ok(o) { return Object.assign({ ok: true }, o); }

  // ---- Traffic → Assessment Lens + actions -----------------------------------

  function identifyUsersObjects(parsed) {
    const objects = new Set(), users = new Set();
    const scan = (p) => {
      if (!p) return;
      (p.params || []).forEach((x) => {
        if (/\b(user|owner|account|email|username)\b/i.test(x.name)) users.add(x.name);
        else if (x.idish) objects.add(x.name);
      });
      (p.path || "").split("/").forEach((seg) => { if (/^\d{2,}$/.test(seg)) objects.add("path segment " + seg); });
    };
    scan(parsed.request);
    return { users: [...users], objects: [...objects] };
  }

  function trafficLens(parsed, opts) {
    opts = opts || {};
    // Guess the most relevant concept from the endpoint.
    const blob = [
      parsed.request && parsed.request.path,
      (parsed.request && parsed.request.params || []).map((p) => p.name).join(" "),
      parsed.response && parsed.response.status,
    ].join(" ");
    const found = WPC.detectConcepts ? WPC.detectConcepts(blob, 1) : [];
    const concept = found[0] ? found[0].concept : WPC.getConcept("trust-boundary");
    const l = concept.lens;
    return {
      concept: { id: concept.id, name: concept.name },
      lens: {
        WHO: l.who, WHAT: l.what, WHEN: l.when, WHERE: l.where,
        "HOW (assessment)": l.howAssessment, "HOW (technical)": l.howTechnical,
        "WHY vulnerable": l.whyVuln, "WHY worked": l.whyWorked, "WHY failed": l.whyFailed,
        VALIDATE: l.validate, FIX: l.fix, REPORT: l.report, INTERVIEW: l.interview,
        DEBRIEF: `What did this exchange teach you about ${concept.name.toLowerCase()}? What would you check first next time?`,
      },
      usersObjects: identifyUsersObjects(parsed),
      nextTest: (concept.coach || []).slice(0, 2),
      evidence: evidenceTemplate(parsed, concept),
    };
  }

  function evidenceTemplate(parsed, concept) {
    const req = parsed.request || {};
    const res = parsed.response || {};
    return [
      `## Finding: ${concept.name}`,
      "",
      `**Endpoint:** ${req.method || "?"} ${req.path || "?"}${req.query || ""}`,
      `**Observed status:** ${res.status || "?"} ${res.statusText || ""}`,
      `**Object(s) referenced:** ${(identifyUsersObjects(parsed).objects.join(", ") || "—")}`,
      "",
      "**Observation:** <what you saw>",
      "**Hypothesis:** <what you think is wrong and why>",
      "**Reproduction:** <steps — two accounts / one modified request>",
      "**Impact:** <business impact for the client>",
      "**Validation:** <how you confirmed it, not just suspected>",
      "**Remediation:** " + concept.lens.fix,
    ].join("\n");
  }

  WPC.explain = { classify, explainArtifact, trafficLens, identifyUsersObjects };
})();
