/*
 * WebPwn Coach — Personalities
 * Three voices frame the same guidance differently. They change TONE and
 * framing only — never the substance, and never spoilers.
 *
 *  ATLAS — professional, logical, methodical (default)
 *  BIT   — beginner, curious, funny (asks the naive-but-smart question)
 *  BYTE  — senior consultant, dry humor, pushes you to think
 */
(function () {
  const WPC = (globalThis.WPC = globalThis.WPC || {});

  const PERSONAS = {
    atlas: {
      id: "atlas",
      name: "ATLAS",
      blurb: "Professional · Logical · Methodical",
      icon: "🛰️",
      intro: (site) =>
        `ATLAS online. We're on ${site.label}. Let's work the problem methodically — structure before payloads.`,
      // wraps a coaching question
      question: (q) => q,
      nudge: () =>
        "Stay structured: business → app → workflow → objects → boundaries → hypothesis → test → evidence.",
      signoff: () => "Document your reasoning as you go — evidence is the deliverable.",
    },
    bit: {
      id: "bit",
      name: "BIT",
      blurb: "Beginner · Curious · A little goofy",
      icon: "🐣",
      intro: (site) =>
        `Bit here! Ooo, ${site.label}. Okay okay — I have SO many questions. Let's figure this out together?`,
      question: (q) => `Hmm, wait — ${q.charAt(0).toLowerCase() + q.slice(1)}`,
      nudge: () =>
        "I keep reminding myself: don't grab a payload yet. Understand the thing first!",
      signoff: () => "Did we actually understand WHY? That's the win, right?",
    },
    byte: {
      id: "byte",
      name: "BYTE",
      blurb: "Senior consultant · Dry humor · Pushes you",
      icon: "🧠",
      intro: (site) =>
        `Byte. ${site.label}, is it. Fine. Before you touch anything — tell me what you're actually looking at.`,
      question: (q) => `${q} And don't hand-wave it.`,
      nudge: () =>
        "Scanners find syntax. Consultants find assumptions. Which are you being right now?",
      signoff: () =>
        "If you can't explain why it matters to the client, you don't have a finding yet.",
    },
  };

  WPC.PERSONAS = PERSONAS;
  WPC.getPersona = (id) => PERSONAS[id] || PERSONAS.atlas;
})();
