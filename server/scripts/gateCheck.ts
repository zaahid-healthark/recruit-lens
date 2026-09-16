/**
 * Checks the screening gate against the candidates it exists to sort.
 *
 * This gate decides whether someone gets a video interview after a 15-20
 * minute call, and both ways of getting it wrong are expensive: a weak
 * candidate waved through wastes a round, a good one rejected is lost with no
 * way to notice. Neither shows up as an error, so they are asserted here.
 *
 * Scores are stored out of 100 and shown out of 10 — 78 reads as 7.8, and the
 * band a score falls in IS the decision: 7.5+ fit, 6.0-7.4 consider, below
 * that does not proceed.
 *
 *   npm run gate:check -w server
 */
process.env.DATABASE_URL ||= "postgresql://x/y";
process.env.API_KEY ||= "test";

import { CandidateDecision, toDisplayScore } from "@interview-evaluator/shared";
import { applyScoringGuards } from "../src/schemas/evaluationSchema";
import { decisionFor, GateEvidence } from "../src/services/ranking";

interface Case {
  name: string;
  why: string;
  gate: GateEvidence;
  expect: CandidateDecision;
}

const CASES: Case[] = [
  {
    name: "REAL: 3 technical, all adequate",
    why: "The reported call. Every answer the recruiter asked for was acceptable; the pipeline returned 4.9 and 'Maybe'.",
    gate: { decidingScore: 78, technicalScore: 78, technicalAsked: 3, technicalAnswered: 3, communicationScore: 60 },
    expect: "advance",
  },
  {
    name: "brief but correct throughout",
    why: "Adequate-without-depth is the normal good outcome in one minute and must not read as a near miss.",
    gate: { decidingScore: 76, technicalScore: 76, technicalAsked: 5, technicalAnswered: 5, communicationScore: 65 },
    expect: "advance",
  },
  {
    name: "strong and specific",
    why: "Sanity check at the top of the range.",
    gate: { decidingScore: 90, technicalScore: 90, technicalAsked: 4, technicalAnswered: 4, communicationScore: 85 },
    expect: "advance",
  },
  {
    name: "could not answer most questions",
    why: "Exactly what the gate is for.",
    gate: { decidingScore: 45, technicalScore: 45, technicalAsked: 4, technicalAnswered: 1, communicationScore: 70 },
    expect: "reject",
  },
  {
    name: "fails most questions but scored well",
    why: "A light candidate must not pass on a flattering score — the answer count governs.",
    gate: { decidingScore: 80, technicalScore: 80, technicalAsked: 4, technicalAnswered: 1, communicationScore: 75 },
    expect: "reject",
  },
  {
    name: "half the basics landed",
    why: "Genuinely on the line, and should say so rather than pick a side.",
    gate: { decidingScore: 65, technicalScore: 65, technicalAsked: 4, technicalAnswered: 2, communicationScore: 65 },
    expect: "borderline",
  },
  {
    name: "answered well, cannot be understood",
    why: "Communication gates from below: the next round is a video call. It pauses, never rejects.",
    gate: { decidingScore: 80, technicalScore: 80, technicalAsked: 4, technicalAnswered: 4, communicationScore: 25 },
    expect: "borderline",
  },
  {
    name: "fluent but answered nothing",
    why: "Clear English must not carry a candidate who could not answer.",
    gate: { decidingScore: 50, technicalScore: 50, technicalAsked: 3, technicalAnswered: 0, communicationScore: 95 },
    expect: "reject",
  },
  {
    name: "recruiter asked no technical questions",
    why: "An interviewer gap must not become a candidate weakness; fall back to how the call went.",
    gate: { decidingScore: 78, technicalScore: null, technicalAsked: 0, technicalAnswered: 0, communicationScore: 70 },
    expect: "advance",
  },
  {
    name: "nothing on record",
    why: "Set aside, never rejected.",
    gate: { decidingScore: null, technicalScore: null, technicalAsked: 0, technicalAnswered: 0, communicationScore: null },
    expect: "insufficient_evidence",
  },
];

/** Exercises the guards that stop a summary judgement contradicting the answers. */
function guardCase(
  label: string,
  verdicts: Array<"strong" | "adequate" | "weak" | "not_answered">,
  scores: number[],
  overall: number,
  expect: { overall: number; questions?: number[]; technical?: number; communication?: number },
  communication = 60
): boolean {
  const evaluation = {
    overall_score: overall,
    recommendation: "Maybe — see summary",
    categories: [
      { name: "Communication Skills", score: communication, summary: "", evidence: "", recommendation: "" },
      { name: "Technical Knowledge", score: 78, summary: "", evidence: "", recommendation: "" },
      { name: "Problem Solving", score: 75, summary: "", evidence: "", recommendation: "" },
    ],
    question_assessment: {
      questions: verdicts.map((v, i) => ({
        question: "q" + i,
        kind: "technical",
        answer_summary: "",
        verdict: v,
        score: scores[i],
        evidence: "",
      })),
      technical_score: Math.min(...scores),
      behavioural_score: null,
      summary: "",
    },
    jd_match: null,
  } as any;

  const out = applyScoringGuards(evaluation);
  const assessed = out.question_assessment;
  if (!assessed) {
    console.log("FAIL  " + label.padEnd(36) + "question_assessment was dropped");
    return false;
  }
  const gotQ = assessed.questions.map((q) => q.score);
  const gotT = assessed.technical_score;
  const gotC = out.categories.find((c) => c.name === "Communication Skills")?.score ?? null;
  const ok =
    out.overall_score === expect.overall &&
    (expect.communication === undefined || expect.communication === gotC) &&
    (!expect.questions || expect.questions.every((v, i) => v === gotQ[i])) &&
    (expect.technical === undefined || expect.technical === gotT);
  console.log(
    (ok ? "PASS  " : "FAIL  ") +
      label.padEnd(36) +
      `overall ${toDisplayScore(out.overall_score ?? 0)}  answers [${gotQ.map(toDisplayScore).join(", ")}]` +
      `  technical ${gotT === null ? "—" : toDisplayScore(gotT)}` +
      `  comm ${gotC === null ? "—" : toDisplayScore(gotC)}` +
      (ok ? "" : `   (expected overall ${toDisplayScore(expect.overall)})`)
  );
  return ok;
}

let failed = 0;
for (const c of CASES) {
  const got = decisionFor(c.gate);
  const ok = got === c.expect;
  console.log(
    (ok ? "PASS  " : "FAIL  ") +
      c.name.padEnd(36) +
      (c.gate.decidingScore === null ? " —  " : toDisplayScore(c.gate.decidingScore).padEnd(4)) +
      " " +
      got +
      (ok ? "" : `  (expected ${c.expect})`)
  );
  if (!ok) {
    failed++;
    console.log("        " + c.why);
  }
}

console.log();
const guards: boolean[] = [
  // The real call as stored: adequate answers scored 5.6-6.0, beneath the band
  // their own verdict implies. Clamped up to the floor of "adequate".
  guardCase("REAL: adequate scored 5.6-6.0", ["adequate", "adequate", "adequate"], [58, 60, 56], 49, {
    overall: 75,
    questions: [75, 75, 75],
    technical: 75,
  }),
  // The clamp works downward too: a weak answer cannot be scored as a fit.
  guardCase("weak scored up to 8.0", ["weak", "adequate"], [80, 80], 80, {
    overall: 80,
    questions: [59, 80],
  }),
  // Floors at the candidate's OWN worst answer, so it cannot manufacture a fit.
  guardCase("all adequate, overall dragged low", ["adequate", "adequate"], [76, 78], 40, {
    overall: 76,
    technical: 76,
  }),
  // One weak answer and the overall floor does not apply at all.
  guardCase("one weak answer present", ["adequate", "weak"], [80, 40], 55, { overall: 55 }),
  // Answered everything, but the recruiter's "come again" was read as their failing.
  guardCase("all adequate, communication 2.5", ["adequate", "adequate"], [78, 80], 78, {
    overall: 78,
    communication: 40,
  }, 25),
  // A weak answer present, so the communication backstop does not apply.
  guardCase("weak answer, communication 2.5", ["adequate", "weak"], [78, 40], 55, {
    overall: 55,
    communication: 25,
  }, 25),
  // Never lowers a score the model already put above the answers.
  guardCase("overall already above answers", ["adequate", "adequate"], [76, 78], 88, { overall: 88 }),
];
failed += guards.filter((ok) => !ok).length;

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
