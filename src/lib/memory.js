/*
 * WebPwn Coach — Learning Memory & Recommendation Engine
 * Tracks (locally, first) concepts encountered, hints requested, mistakes,
 * reports written, and interview answers missed. Builds a skill profile and
 * recommends practice reps for weak areas.
 *
 * Storage: chrome.storage.local under "wpc_memory" (falls back to an in-memory
 * object when chrome.storage is unavailable, e.g. unit tests).
 *
 * Attaches to globalThis.WPC.memory.
 */
(function () {
  const WPC = (globalThis.WPC = globalThis.WPC || {});
  const KEY = "wpc_memory";

  const SKILLS = [
    "Authentication", "Authorization", "Business Logic", "SQL Injection", "XSS",
    "CSRF", "File Upload", "Path Traversal", "Command Injection", "SSRF", "XXE",
    "GraphQL", "JWT", "OAuth", "NoSQL", "Race Conditions", "Deserialization",
    "Request Smuggling", "Cache Poisoning",
  ];

  // Map knowledge-base concept ids → skill buckets.
  const CONCEPT_SKILL = {
    idor: "Authorization", "access-control": "Authorization", rbac: "Authorization",
    "mass-assignment": "Authorization", session: "Authentication", cookie: "Authentication",
    jwt: "JWT", oauth: "OAuth", csrf: "CSRF", xss: "XSS", sqli: "SQL Injection",
    ssrf: "SSRF", ssti: "Command Injection", "path-traversal": "Path Traversal",
    "command-injection": "Command Injection", xxe: "XXE", "file-upload": "File Upload",
    "open-redirect": "Authentication", cors: "Authorization", "business-logic": "Business Logic",
    "rate-limit": "Authentication", deserialization: "Deserialization",
    "trust-boundary": "Business Logic",
  };

  // Practice reps per skill across platforms.
  const REPS = {
    Authorization: [
      { platform: "PortSwigger", label: "Access control (apprentice) labs" },
      { platform: "Juice Shop", label: "Basket / view another basket; scoreboard access" },
      { platform: "HTB Academy", label: "Broken Authentication / Authorization module" },
      { platform: "WebPwn", label: "IDOR / BOLA lessons" },
      { platform: "QuickWash", label: "IDOR receipt/order-ownership drill" },
    ],
    Authentication: [
      { platform: "PortSwigger", label: "Authentication labs (password reset, 2FA)" },
      { platform: "DVWA", label: "Brute Force (low→high)" },
      { platform: "HTB Academy", label: "Login Brute Forcing module" },
    ],
    "Business Logic": [
      { platform: "PortSwigger", label: "Business logic vulnerabilities labs" },
      { platform: "Juice Shop", label: "Negative quantity / coupon abuse challenges" },
    ],
    "SQL Injection": [
      { platform: "PortSwigger", label: "SQL injection labs (union, blind)" },
      { platform: "DVWA", label: "SQL Injection + SQLi (Blind)" },
      { platform: "HTB Academy", label: "SQL Injection Fundamentals" },
    ],
    XSS: [
      { platform: "PortSwigger", label: "XSS labs (reflected/stored/DOM)" },
      { platform: "Juice Shop", label: "DOM/Bonus XSS challenges" },
      { platform: "DVWA", label: "XSS (Reflected/Stored/DOM)" },
    ],
    CSRF: [{ platform: "PortSwigger", label: "CSRF labs" }, { platform: "DVWA", label: "CSRF" }],
    "File Upload": [
      { platform: "PortSwigger", label: "File upload vulnerabilities labs" },
      { platform: "DVWA", label: "File Upload" },
      { platform: "HTB Academy", label: "File Upload Attacks" },
    ],
    "Path Traversal": [
      { platform: "PortSwigger", label: "Path traversal labs" },
      { platform: "DVWA", label: "File Inclusion" },
    ],
    "Command Injection": [
      { platform: "PortSwigger", label: "OS command injection / SSTI labs" },
      { platform: "DVWA", label: "Command Injection" },
    ],
    SSRF: [{ platform: "PortSwigger", label: "SSRF labs" }, { platform: "HTB Academy", label: "Server-side Attacks (SSRF)" }],
    XXE: [{ platform: "PortSwigger", label: "XXE injection labs" }],
    GraphQL: [{ platform: "PortSwigger", label: "GraphQL API vulnerabilities labs" }],
    JWT: [{ platform: "PortSwigger", label: "JWT labs" }, { platform: "HTB Academy", label: "Attacking Authentication (JWT)" }],
    OAuth: [{ platform: "PortSwigger", label: "OAuth authentication labs" }],
    NoSQL: [{ platform: "PortSwigger", label: "NoSQL injection labs" }],
    "Race Conditions": [{ platform: "PortSwigger", label: "Race conditions labs" }],
    Deserialization: [{ platform: "PortSwigger", label: "Insecure deserialization labs" }],
    "Request Smuggling": [{ platform: "PortSwigger", label: "HTTP request smuggling labs" }],
    "Cache Poisoning": [{ platform: "PortSwigger", label: "Web cache poisoning labs" }],
  };

  function _get() {
    return new Promise((res) => {
      if (globalThis.chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(KEY, (o) => res(o[KEY] || blank()));
      } else {
        res(globalThis.__wpcMem || blank());
      }
    });
  }
  function _set(mem) {
    return new Promise((res) => {
      mem.updatedAt = Date.now();
      if (globalThis.chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [KEY]: mem }, () => res(mem));
      } else {
        globalThis.__wpcMem = mem;
        res(mem);
      }
    });
  }
  function blankSkill() {
    return { seen: 0, reps: 0, correct: 0, hints: 0, reports: 0, iSum: 0, iCount: 0 };
  }
  function blank() {
    const skills = {};
    for (const s of SKILLS) skills[s] = blankSkill();
    return { events: [], skills, updatedAt: 0 };
  }

  function skillFor(conceptId) { return CONCEPT_SKILL[conceptId] || "Business Logic"; }

  /**
   * Record a learning event. Competence is EARNED — only completed reps and
   * interview answers move a skill up; mere page views (seen) never do.
   *   concept-encountered            → exposure only (no competence)
   *   rep-completed {correct:bool}   → a real attempt at a lab/exercise
   *   hint-requested                 → needed help
   *   interview {score:0..100}       → self-rated interview answer
   *   report-written                 → wrote up a finding
   */
  async function record(ev) {
    const mem = await _get();
    const skill = ev.skill || skillFor(ev.conceptId);
    if (!mem.skills[skill]) mem.skills[skill] = blankSkill();
    const s = mem.skills[skill];
    if (ev.type === "concept-encountered") s.seen++;
    else if (ev.type === "rep-completed") { s.reps++; if (ev.correct) s.correct++; }
    else if (ev.type === "hint-requested") s.hints++;
    else if (ev.type === "report-written") s.reports++;
    else if (ev.type === "interview") { s.iSum += Math.max(0, Math.min(100, ev.score || 0)); s.iCount++; }
    // Back-compat: a bare "mistake" is a failed rep.
    else if (ev.type === "mistake") { s.reps++; }
    else if (ev.type === "interview-missed") { s.iSum += 40; s.iCount++; }
    mem.events.unshift({ type: ev.type, skill, conceptId: ev.conceptId || null, note: ev.note || "", ts: Date.now() });
    if (mem.events.length > 500) mem.events.length = 500;
    return _set(mem);
  }

  function metrics(s) {
    const accuracy = s.reps ? s.correct / s.reps : null;
    const interview = s.iCount ? Math.round(s.iSum / s.iCount) : null;
    return { accuracy, interview };
  }

  // Levels are gated on EARNED reps + accuracy. Nothing is "Solid" without at
  // least 3 completed reps at >=80% accuracy and few hints.
  function levelOf(s) {
    const { accuracy, interview } = metrics(s);
    if (s.reps === 0) return "New";
    if (accuracy !== null && accuracy < 0.5) return "Struggling";
    if (s.reps < 3) return "Learning";
    const cleanHints = s.hints <= Math.ceil(s.reps * 0.5);
    if (accuracy >= 0.8 && cleanHints && (interview === null || interview >= 60)) return "Solid";
    return "Practicing";
  }
  // For sorting weakest-first; untouched skills sink below practised-but-weak.
  function orderScore(s) {
    if (s.reps === 0) return 2; // untouched — not "weak", just unstarted
    const { accuracy } = metrics(s);
    return (accuracy || 0) - Math.min(1, s.hints / (s.reps * 2 || 1));
  }

  async function profile() {
    const mem = await _get();
    const rows = Object.keys(mem.skills).map((name) => {
      const s = mem.skills[name];
      const m = metrics(s);
      return {
        skill: name, seen: s.seen, reps: s.reps, correct: s.correct, hints: s.hints,
        reports: s.reports, accuracy: m.accuracy, interview: m.interview,
        level: levelOf(s), order: orderScore(s),
      };
    });
    rows.sort((a, b) => a.order - b.order || b.hints - a.hints);
    return { rows, events: mem.events.slice(0, 30), updatedAt: mem.updatedAt };
  }

  /** Recommend reps for the weakest, actually-PRACTISED skills. */
  async function recommend(limit) {
    const { rows } = await profile();
    const touched = rows.filter((r) => r.reps > 0 || r.hints > 0);
    let pool = touched.filter((r) => r.level !== "Solid");
    if (!pool.length) pool = touched.length ? [] : rows.filter((r) => /Authentication|Authorization/.test(r.skill));
    return pool.slice(0, limit || 3).map((r) => ({
      skill: r.skill,
      level: r.level,
      why: whyStruggle(r),
      prerequisite: prereqFor(r.skill),
      reps: REPS[r.skill] || [{ platform: "PortSwigger", label: r.skill + " labs" }],
    }));
  }

  function whyStruggle(r) {
    if (r.reps === 0 && r.hints > 0) return `You've asked for hints here but not completed a rep yet — go earn one.`;
    if (r.accuracy !== null && r.accuracy < 0.5) return `You're ${Math.round(r.accuracy * 100)}% across ${r.reps} rep(s) — the pattern isn't clicking yet.`;
    if (r.hints >= 3) return `You've needed ${r.hints} hints — you can get there, but not unaided yet.`;
    if (r.interview !== null && r.interview < 60) return `Your interview answers here average ${r.interview}% — you can do it, not yet explain it.`;
    if (r.reps < 3) return `Only ${r.reps} rep(s) so far — needs more reps to stick.`;
    return "Close — a couple more clean reps and this is solid.";
  }
  function prereqFor(skill) {
    const map = {
      Authorization: "Authentication + the object-ownership model (who owns what).",
      "SQL Injection": "How a query is built from input (data vs code).",
      XSS: "Output context (HTML/attribute/JS) and encoding.",
      CSRF: "Sessions, cookies, and SameSite.",
      JWT: "Base64 vs encryption, and signature verification.",
      OAuth: "Sessions + the authorization-code flow.",
      SSRF: "How servers make outbound requests and internal networks.",
    };
    return map[skill] || "The trust-boundary mindset: where untrusted data crosses into trusted code.";
  }

  WPC.memory = { record, profile, recommend, skillFor, SKILLS, REPS, CONCEPT_SKILL, _reset: () => _set(blank()) };
})();
