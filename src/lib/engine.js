/*
 * WebPwn Coach — Engine
 * Turns extracted page context + detected concepts into the structured,
 * mentality-first output the UI renders. It NEVER hands over an answer or a
 * payload. It teaches how to think and asks the next good question.
 *
 * Works fully offline against the local knowledge base. If the user has
 * configured an optional LLM backend, the background worker can enrich these
 * results — but the offline engine is always the baseline.
 */
(function () {
  const WPC = (globalThis.WPC = globalThis.WPC || {});

  // Site-specific framing chains (the "modes").
  const SITE_FRAMES = {
    portswigger: {
      title: "PortSwigger Lens",
      chain: ["Concept", "Business Context", "Assessment Lens", "Burp Tool", "Evidence", "Reporting"],
      note: "Every Academy lab maps to a real consulting finding. Frame it that way, not as a puzzle.",
    },
    htb: {
      title: "HTB Academy Lens",
      chain: ["Concept", "Assumed Knowledge", "What You Should Already Know", "What To Observe", "Real Consulting Link"],
      note: "HTB assumes prerequisites. Name what's assumed before you dive in.",
    },
    webpwn: {
      title: "WebPwn Lens",
      chain: ["Assessment Lens", "Mission", "Evidence", "Report", "Interview"],
      note: "Tie everything back to mission, evidence, and how you'd defend it in an interview.",
    },
    juiceshop: {
      title: "Juice Shop Lens",
      chain: ["Feature", "Workflow", "Objects", "Trust Boundary", "Hypothesis", "Evidence"],
      note: "It's a real-ish shop. Think like you're assessing a client's e-commerce app.",
    },
    dvwa: {
      title: "DVWA Lens",
      chain: ["Concept", "Security Level", "Trust Boundary", "Hypothesis", "Evidence"],
      note: "DVWA's levels ARE the lesson: watch how the fix changes across low/medium/high.",
    },
    generic: {
      title: "Consultant Lens",
      chain: ["Business", "Application", "Workflow", "Objects", "Trust Boundaries", "Hypothesis", "Testing", "Evidence"],
      note: "No platform hints — so bring your own structure.",
    },
  };

  const CONSULTANT_CHAIN = ["Business", "Application", "Workflow", "Objects", "Trust Boundaries", "Hypothesis", "Testing", "Evidence"];

  function primaryConcepts(ctx, limit) {
    const found = WPC.detectConceptsForContext
      ? WPC.detectConceptsForContext(ctx, limit || 4)
      : WPC.detectConcepts(ctx.bodyText || "", limit || 4);
    if (found.length) return found;
    // Fallback: teach the core mindset when no concept is obvious.
    const tb = WPC.getConcept("trust-boundary");
    return tb ? [{ concept: tb, score: 1, hitTerms: [] }] : [];
  }

  /** Build TL;DR structured output. */
  function buildTLDR(ctx, opts) {
    opts = opts || {};
    const site = WPC.detectSite(ctx);
    const persona = WPC.getPersona(opts.persona);
    const found = primaryConcepts(ctx, 4);
    const top = found[0] ? found[0].concept : null;
    const frame = SITE_FRAMES[site.id] || SITE_FRAMES.generic;

    const conceptNames = found.map((f) => f.concept.name);

    // Content-derived TL;DR: lead with the page's own topic (title + first real
    // sentence), then map it to the detected concept. This is a summary of THIS
    // page, not a canned concept blurb.
    const lead = pageLead(ctx);
    const summary = lead
      ? (top
          ? `${lead} That's ${top.name.replace(/\s*\(.*\)/, "")} territory.`
          : `${lead} No single vuln class jumps out — treat it as raw application surface.`)
      : (top
          ? `This page is about ${top.name}. At its core: ${top.simple}`
          : `This page doesn't announce a single vulnerability class. Read what it does, then decide what's worth trusting.`);

    const whyItMatters = top
      ? `A consultant cares because ${lensWhy(top)} On a real engagement this is where an attacker ends up ` +
        `${top.lens.what.toLowerCase().replace(/\.$/, "")} — so it maps to actual client risk, not a lab point.`
      : `A consultant cares because every feature is attack surface. The value isn't the payload ` +
        `— it's spotting where the app trusts the user and shouldn't.`;

    return {
      kind: "tldr",
      site,
      persona: { id: persona.id, name: persona.name, icon: persona.icon, blurb: persona.blurb },
      personaIntro: persona.intro(site),
      concepts: found.map((f) => ({ id: f.concept.id, name: f.concept.name, score: f.score })),
      summary,
      whyItMatters,
      lens: top ? top.lens : WPC.getConcept("trust-boundary").lens,
      lensSource: top ? top.name : "Trust Boundaries",
      mentalModel: top ? top.mental : WPC.getConcept("trust-boundary").mental,
      beginnerMistakes: top ? top.mistakes : WPC.getConcept("trust-boundary").mistakes,
      seniorThinking: top ? top.senior : WPC.getConcept("trust-boundary").senior,
      nextObservation: top ? top.next : WPC.getConcept("trust-boundary").next,
      browserFirst: browserFirstFor(top || WPC.getConcept("trust-boundary")),
      mission: WPC.getMission ? WPC.getMission((top || WPC.getConcept("trust-boundary")).id, top) : null,
      lab: ctx.lab || null,
      siteFraming: { title: frame.title, chain: frame.chain, note: frame.note },
      consultantChain: CONSULTANT_CHAIN,
      nudge: persona.nudge(),
      signoff: persona.signoff(),
      stats: ctx.stats || null,
    };
  }

  // Build a one-line "what is this page about" lead from the page's own content.
  function pageLead(ctx) {
    let topic = (ctx.headers && ctx.headers[0] && ctx.headers[0].text) || ctx.title || "";
    topic = topic.replace(/\s*[|\-–—]\s*(web security academy|portswigger|hack the box|academy).*$/i, "").trim();
    const para = (ctx.paragraphs || []).find((p) => p && p.length > 50) || "";
    const firstSentence = para
      ? para.split(/(?<=[.!?])\s+/)[0].slice(0, 220).replace(/…$/, "").trim()
      : "";
    if (topic && firstSentence) return `“${topic}” — ${firstSentence}`;
    if (topic) return `This page covers “${topic}.”`;
    if (firstSentence) return firstSentence;
    return "";
  }

  // Browser-first coaching: what to check in the browser / DevTools BEFORE Burp,
  // so the learner practises finding things in Inspect themselves.
  function browserFirstFor(c) {
    const tags = (c && c.tags) || [];
    const has = (x) => tags.includes(x);
    const out = [];
    if (has("session") || has("auth"))
      out.push("DevTools → Application → Cookies & Storage: find the value that equals “logged-in you”. Note HttpOnly / Secure / SameSite.");
    if (has("access-control") || has("authorization"))
      out.push("DevTools → Network: find the request carrying the object id — that's the one you'll compare across accounts.");
    if (has("injection"))
      out.push("DevTools → Network: submit once, watch the exact request your input creates, and read the response difference.");
    if (has("client-side"))
      out.push("View-source / DevTools → Elements: is the validation only client-side? Then find the request it produces.");
    out.push("Right-click → Inspect. Use View-Source and the Network tab first — reproduce what you see before reaching for Burp.");
    return out.slice(0, 3);
  }

  function lensWhy(c) {
    // Compose a natural "why it matters" fragment from the lens.
    return `${c.lens.whyVuln.replace(/\.$/, "")}.`;
  }

  /** Build Coach Mode output — questions, not answers. Hints stay locked. */
  function buildCoach(ctx, opts) {
    opts = opts || {};
    const site = WPC.detectSite(ctx);
    const persona = WPC.getPersona(opts.persona);
    const found = primaryConcepts(ctx, 3);

    const questions = [];
    for (const f of found) {
      for (const q of f.concept.coach) {
        questions.push({ conceptId: f.concept.id, concept: f.concept.name, text: persona.question(q) });
      }
    }
    // Always fold in the universal consultant questions.
    const tb = WPC.getConcept("trust-boundary");
    for (const q of tb.coach) {
      questions.push({ conceptId: tb.id, concept: "Mindset", text: persona.question(q) });
    }

    // Hints are held back and only released on explicit request per concept.
    const hints = found.map((f) => ({
      conceptId: f.concept.id,
      concept: f.concept.name,
      hints: f.concept.hints.slice(),
    }));

    return {
      kind: "coach",
      site,
      persona: { id: persona.id, name: persona.name, icon: persona.icon },
      intro: persona.intro(site),
      questions: dedupeQuestions(questions).slice(0, 12),
      hints, // UI keeps these hidden until user clicks "reveal a hint"
      nudge: persona.nudge(),
    };
  }

  function dedupeQuestions(qs) {
    const seen = new Set();
    const out = [];
    for (const q of qs) {
      const k = q.text.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(q);
    }
    return out;
  }

  /** Build a Concept card from a highlighted phrase or explicit id. */
  function buildConcept(input, opts) {
    opts = opts || {};
    const persona = WPC.getPersona(opts.persona);
    let concept = null;
    if (opts.conceptId) concept = WPC.getConcept(opts.conceptId);
    if (!concept && input) concept = WPC.lookupConcept(input);

    if (!concept) {
      return {
        kind: "concept",
        found: false,
        phrase: input || "",
        message:
          "I don't have a curated card for that yet. Try the mindset move: what is it, where does it enter " +
          "the system, and who trusts it? Highlight a known term (JWT, IDOR, CSRF, SSRF, RBAC…) for a full card.",
        suggestions: WPC.KNOWLEDGE.slice(0, 8).map((c) => c.name),
      };
    }

    return {
      kind: "concept",
      found: true,
      persona: { id: persona.id, name: persona.name, icon: persona.icon },
      id: concept.id,
      name: concept.name,
      simple: concept.simple,
      example: concept.example,
      identify: concept.identify,
      test: concept.test,
      mistakes: concept.mistakes,
      mental: concept.mental,
      coach: concept.coach.map((q) => persona.question(q)),
      next: concept.next,
      lens: concept.lens,
    };
  }

  /** Reveal one hint at a time for a concept (Coach Mode, on request). */
  function revealHint(conceptId, index) {
    const c = WPC.getConcept(conceptId);
    if (!c || !c.hints || index >= c.hints.length) return null;
    return { conceptId, index, total: c.hints.length, hint: c.hints[index] };
  }

  // ---- Guided Highlighting ---------------------------------------------------
  // WebPwn theme colors, keyed by semantic meaning. The highlighter maps
  // element categories onto these.
  const HL_COLORS = {
    observe: { hex: "#22d3ee", label: "Observe", desc: "worth a look" },
    trust: { hex: "#a855f7", label: "Trust boundary", desc: "identity / session / auth" },
    suspect: { hex: "#ff6ac1", label: "Hypothesis", desc: "suspicious — I'd probe here" },
    valid: { hex: "#7ee787", label: "Validated", desc: "confirmed behaviour" },
    danger: { hex: "#ff6b6b", label: "Impact", desc: "sensitive / destructive" },
    fluff: { hex: "#6b7684", label: "Ignore", desc: "chrome / fluff" },
  };

  // Each highlight asks a QUESTION that teaches observation (L1), then deepens:
  //  L1 the question · L2 why it matters · L3 what to compare/test · L4 next action
  const CATEGORY_TEACH = {
    "login-button": [
      "What changes after you log in — a cookie? a JWT? a session? a redirect?",
      "The login response is where identity is issued — that's the moment to watch.",
      "Log in with DevTools → Network open and compare a success vs a failure.",
      "Next: capture this login and diff the response for valid vs invalid input.",
    ],
    "username-input": [
      "Could this field reveal whether a username actually exists?",
      "Auth systems often treat known vs unknown usernames differently.",
      "Submit a likely-valid username vs a random one and compare the responses.",
      "Next: diff the message, size, status and timing between the two.",
    ],
    "error-text": [
      "Is this message identical for every username — or does it leak which are valid?",
      "Different messages are the classic username-enumeration oracle.",
      "Trigger it with a known user vs a random one and compare word-for-word.",
      "Next: record this exact string for valid vs invalid input and diff it.",
    ],
    password: [
      "Is a wrong password's response identical to a wrong username's?",
      "A difference between the two is an enumeration oracle. (Its value is never read.)",
      "Hold the password constant, vary the username, and watch the response.",
      "Next: compare (valid user, bad pass) vs (bad user, bad pass).",
    ],
    "get-form": [
      "Where does what you type here end up on the server?",
      "Input that reaches the server is attack surface.",
      "Send a benign marker and follow where it surfaces.",
      "Next: place one probe here and read the response difference.",
    ],
    "state-form": [
      "What does submitting this change — and what proves you're allowed to?",
      "State-changing requests are where authorization and CSRF must hold.",
      "Capture the request and ask what an attacker couldn't guess.",
      "Next: replay it with altered fields, or from another session.",
    ],
    input: [
      "What would a value here have to be to change how the server interprets it?",
      "Untrusted input is where injection and logic bugs enter.",
      "Send a benign marker and follow where it surfaces.",
      "Next: place one probe here and read the response difference.",
    ],
    "object-id": [
      "Whose object is this id — and what happens if you change it?",
      "Ids you control are where broken authorization hides.",
      "Compare this id against one from another account you own.",
      "Next: swap it for another user's value in one request and compare.",
    ],
    link: [
      "Where does this go — and could it expose a privileged route?",
      "Links reveal the app's structure and privileged areas.",
      "Inspect the target; consider requesting it from a lower-priv session.",
      "Next: request this route directly from a low-priv session.",
    ],
    button: [
      "What does this action do — and what does it assume already happened?",
      "Every action is a workflow step.",
      "Consider reordering, skipping, or replaying it.",
      "Next: trigger it out of sequence and watch the server.",
    ],
    "action-button": [
      "Who is actually allowed to perform this action?",
      "Sensitive actions must be authorized server-side, not hidden in the UI.",
      "Ask what stops a lower-priv user from triggering it.",
      "Next: replay it from a low-privilege session.",
    ],
    code: [
      "What does this tell you about how the server expects input?",
      "Snippets reveal parameters, ids, and expected formats.",
      "Map the parameters here to inputs you control.",
      "Next: reproduce this request and modify one field.",
    ],
    "user-context": [
      "This tells you who you are right now — how would another user's view differ?",
      "Knowing your identity is step one for access-control testing.",
      "Compare what this user sees vs another account.",
      "Next: note this identity, then try to reach another user's object.",
    ],
    storage: [
      "Which of these is your identity — and can it be read or reused?",
      "Session/identity lives here; flags and scope decide who can read it.",
      "Check what identifies you and whether it rotates and expires.",
      "Next: reuse the session value after logout and see if it still works.",
    ],
    fluff: [
      "Ignore this — it's page chrome, not attack surface.",
      "Consultants filter fluff out fast to focus on the functional surface.",
      "Nothing to test here.",
      "Ignore — not part of the attack surface.",
    ],
  };

  const LEVEL_TEXT = {
    1: "Level 1 · The questions. Hover each mark — I'm asking, you observe.",
    2: "Level 2 · Why each question matters.",
    3: "Level 3 · What to compare/test. Suggestions only — no payloads.",
    4: "Level 4 · Strong hint. The exact next action, because you asked for it.",
  };

  // Which categories become 'suspect' (pink) depends on the concept's nature.
  function pinkCategoriesFor(concept) {
    const tags = (concept && concept.tags) || [];
    const set = new Set();
    const has = (t) => tags.includes(t);
    if (has("access-control") || has("authorization") || has("logic")) {
      ["object-id", "state-form"].forEach((c) => set.add(c));
    }
    if (has("injection")) ["input", "get-form", "code"].forEach((c) => set.add(c));
    if (has("client-side")) ["input", "link"].forEach((c) => set.add(c));
    if (has("session") || has("auth")) set.add("storage");
    return [...set];
  }

  /**
   * Build a highlight plan: the concept framing + teaching level, plus the
   * hints for the on-page overlay. Element FINDING happens in the content-side
   * highlighter; this only supplies the "what & why", never a payload.
   */
  function buildHighlightPlan(input, opts) {
    opts = opts || {};
    const persona = WPC.getPersona(opts.persona);
    const level = Math.min(4, Math.max(1, opts.level || 1));
    let concept = opts.conceptId ? WPC.getConcept(opts.conceptId) : null;
    if (!concept && input) concept = WPC.lookupConcept(input);
    if (!concept) concept = WPC.getConcept("trust-boundary");

    const intro =
      level >= 4
        ? persona.question("Strong hint incoming — I'll name the next action, but you still do the thinking.")
        : persona.nudge();

    return {
      kind: "highlight-plan",
      conceptId: concept.id,
      conceptName: concept.name,
      level,
      levelText: LEVEL_TEXT[level],
      pinkCategories: pinkCategoriesFor(concept),
      strongHintAvailable: level < 4,
      persona: { id: persona.id, name: persona.name, icon: persona.icon },
      intro,
      // Compact 6-part lens for the highlight panel.
      lens6: {
        WHO: concept.lens.who,
        WHAT: concept.lens.what,
        WHEN: concept.lens.when,
        WHERE: concept.lens.where,
        HOW: concept.lens.howAssessment,
        WHY: concept.lens.whyVuln,
      },
      legend: Object.keys(HL_COLORS).map((k) => ({
        key: k,
        hex: HL_COLORS[k].hex,
        label: HL_COLORS[k].label,
        desc: HL_COLORS[k].desc,
      })),
    };
  }

  WPC.engine = {
    buildTLDR,
    buildCoach,
    buildConcept,
    revealHint,
    buildHighlightPlan,
    browserFirstFor,
    HL_COLORS,
    CATEGORY_TEACH,
    SITE_FRAMES,
  };
})();
