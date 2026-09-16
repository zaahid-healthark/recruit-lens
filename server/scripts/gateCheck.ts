/**
 * Checks the screening gate against the candidates it exists to sort.
 *
 * This gate decides whether someone gets a video interview after a 15-20
 * minute call, and both ways of getting it wrong are expensive: a weak
 * candidate waved through wastes a round, a good one rejected is lost with no
 * way to notice. Neither shows up as an error, so they are asserted here.
 *
 *   npm run gate:check -w server
 */
process.env.DATABASE_URL ||= "postgresql://x/y";
process.env.API_KEY ||= "test";

import { CandidateDecision } from "@interview-evaluator/shared";
import { decisionFor, GateEvidence } from "../src/services/ranking";

interface Case {
  name: string;
  why: string;
  gate: GateEvidence;
  expect: CandidateDecision;
}

const CASES: Case[] = [
  {
    name: "knows the basics, JD barely probed",
    why: "The reported failure: answered most of what was asked, but a short call left most of the JD untouched and fit vetoed the advance.",
    gate: { decidingScore: 62, technicalScore: 62, technicalAsked: 4, technicalAnswered: 3, communicationScore: 65 },
    expect: "advance",
  },
  {
    name: "brief but correct throughout",
    why: "Adequate-without-depth is the normal good outcome in 15 minutes and must not read as a near miss.",
    gate: { decidingScore: 58, technicalScore: 58, technicalAsked: 5, technicalAnswered: 5, communicationScore: 60 },
    expect: "advance",
  },
  {
    name: "strong and specific",
    why: "Sanity check at the top of the range.",
    gate: { decidingScore: 85, technicalScore: 85, technicalAsked: 4, technicalAnswered: 4, communicationScore: 80 },
    expect: "advance",
  },
  {
    name: "could not answer most questions",
    why: "Exactly what the gate is for.",
    gate: { decidingScore: 40, technicalScore: 40, technicalAsked: 4, technicalAnswered: 1, communicationScore: 70 },
    expect: "reject",
  },
  {
    name: "fails most questions but scored well",
    why: "A light candidate must not pass on a flattering score — the answer count governs.",
    gate: { decidingScore: 72, technicalScore: 72, technicalAsked: 4, technicalAnswered: 1, communicationScore: 75 },
    expect: "reject",
  },
  {
    name: "half the basics landed",
    why: "Genuinely on the line, and should say so rather than pick a side.",
    gate: { decidingScore: 50, technicalScore: 50, technicalAsked: 4, technicalAnswered: 2, communicationScore: 60 },
    expect: "borderline",
  },
  {
    name: "answered well, cannot be understood",
    why: "Communication gates from below: the next round is a video call. It pauses, never rejects.",
    gate: { decidingScore: 70, technicalScore: 70, technicalAsked: 4, technicalAnswered: 4, communicationScore: 20 },
    expect: "borderline",
  },
  {
    name: "fluent but answered nothing",
    why: "Clear English must not carry a candidate who could not answer.",
    gate: { decidingScore: 45, technicalScore: 45, technicalAsked: 3, technicalAnswered: 0, communicationScore: 90 },
    expect: "reject",
  },
  {
    name: "recruiter asked no technical questions",
    why: "An interviewer gap must not become a candidate weakness; fall back to how the call went.",
    gate: { decidingScore: 64, technicalScore: null, technicalAsked: 0, technicalAnswered: 0, communicationScore: 70 },
    expect: "advance",
  },
  {
    name: "nothing on record",
    why: "Set aside, never rejected.",
    gate: { decidingScore: null, technicalScore: null, technicalAsked: 0, technicalAnswered: 0, communicationScore: null },
    expect: "insufficient_evidence",
  },
];

let failed = 0;
for (const c of CASES) {
  const got = decisionFor(c.gate);
  const ok = got === c.expect;
  console.log(
    (ok ? "PASS  " : "FAIL  ") + c.name.padEnd(38) + got + (ok ? "" : `  (expected ${c.expect})`)
  );
  if (!ok) {
    failed++;
    console.log("        " + c.why);
  }
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
