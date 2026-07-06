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
    const found = WPC.detectConcepts(ctx.bodyText || "", limit || 4);
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

    const summary = top
      ? `This page is teaching around: ${conceptNames.slice(0, 3).join(", ")}. ` +
        `At its core: ${top.simple}`
      : `This page doesn't announce a single vulnerability class. Treat it as raw application ` +
        `surface: read what it does, then decide what's worth trusting.`;

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
      siteFraming: { title: frame.title, chain: frame.chain, note: frame.note },
      consultantChain: CONSULTANT_CHAIN,
      nudge: persona.nudge(),
      signoff: persona.signoff(),
      stats: ctx.stats || null,
    };
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

  WPC.engine = { buildTLDR, buildCoach, buildConcept, revealHint, SITE_FRAMES };
})();
