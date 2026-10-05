import {
  CandidateDecision,
  COMMUNICATION_CATEGORY,
  COMMUNICATION_FLOOR,
  DECISION_THRESHOLDS,
  EvaluationDto,
  TECHNICAL_BORDERLINE_RATE,
  TECHNICAL_PASS_RATE,
} from "@interview-evaluator/shared";

/**
 * The screening gate: one rule, shared by everything that shows a decision.
 *
 * It lives apart from the ranking because a candidate's decision has to be the
 * same number on every screen — the report, the candidate list, the dashboard
 * and the ranking. Computing it in one place per screen is how a report came to
 * say "Maybe" beside a score in the fit band. This module has no dependency on
 * the DTO mappers, so they can call it without a cycle.
 */

export function band(score: number): CandidateDecision {
  if (score >= DECISION_THRESHOLDS.advance) return "advance";
  if (score >= DECISION_THRESHOLDS.borderline) return "borderline";
  return "reject";
}

const SEVERITY: CandidateDecision[] = ["reject", "borderline", "advance", "insufficient_evidence"];

/**
 * Where a candidate sits on the gate to a video interview.
 *
 * The gate asks one thing: could they handle the technical questions the
 * recruiter actually asked? So those answers decide it, and two views of the
 * same evidence are used — how many answers LANDED, and how good they were.
 * Counting answers is the more direct reading of "could they answer?", and it
 * survives the model scoring a shade high or low.
 *
 * Deliberately NOT a veto structure. This previously took the worse of JD fit
 * and overall, so a candidate had to clear the bar twice and a 15-minute call
 * that never probed most of the JD could sink someone who answered every
 * question put to them. Fit is now context a recruiter reads, not a gate:
 * a short screening call is not evidence about requirements nobody raised.
 *
 * The asymmetry is deliberate too. A wrongly advanced candidate costs one
 * video call, which will catch them; a wrongly rejected one is lost for good.
 * Where the two readings disagree, the more generous governs — except when the
 * candidate failed most of what was asked, which is exactly what this gate
 * exists to catch and no score is allowed to override.
 */
export interface GateEvidence {
  decidingScore: number | null;
  technicalScore: number | null;
  technicalAsked: number;
  technicalAnswered: number;
  communicationScore: number | null;
}

export function decisionFor(g: GateEvidence): CandidateDecision {
  if (g.decidingScore === null) return "insufficient_evidence";

  let decision: CandidateDecision;
  if (g.technicalAsked > 0) {
    const rate = g.technicalAnswered / g.technicalAsked;
    if (rate < TECHNICAL_BORDERLINE_RATE) {
      // Could not answer most of what was asked. This is the case the gate is
      // for, and a flattering score cannot talk it out.
      return "reject";
    }
    const byRate: CandidateDecision = rate >= TECHNICAL_PASS_RATE ? "advance" : "borderline";
    const byScore = band(g.technicalScore ?? g.decidingScore);
    decision =
      SEVERITY.indexOf(byRate) > SEVERITY.indexOf(byScore) ? byRate : byScore;
  } else {
    // No technical questions asked: nothing to gate on, so fall back to how the
    // call went overall rather than inventing a technical verdict.
    decision = band(g.decidingScore);
  }

  // Communication gates from BELOW only. The next round is a video call the
  // candidate has to hold up in, so being genuinely hard to follow is worth
  // pausing on — but it can never sink someone who answered correctly, and an
  // accent or awkward phrasing is not what this measures.
  if (
    decision === "advance" &&
    g.communicationScore !== null &&
    g.communicationScore < COMMUNICATION_FLOOR
  ) {
    return "borderline";
  }
  return decision;
}

/** The gate's reading of one stored evaluation, with the evidence it used. */
export interface GateSummary extends GateEvidence {
  decision: CandidateDecision;
}

/**
 * Derive the gate evidence from a stored evaluation and decide.
 *
 * `hasJd` only matters when neither the technical score nor the overall score
 * exists, so it defaults to whether a fit score was produced at all — which is
 * true exactly when a job description was attached at evaluation time.
 */
export function summariseGate(
  e: Pick<EvaluationDto, "categories" | "questionAssessment" | "overallScore" | "jdMatch">,
  hasJd: boolean = e.jdMatch !== null
): GateSummary {
  const qa = e.questionAssessment;
  const technicalScore = qa?.technicalScore ?? null;

  // Counted directly rather than inferred from a score. "Adequate" counts as
  // answered: in a 15-20 minute call a correct answer without depth is the
  // normal good outcome, not a near miss.
  const technical = (qa?.questions ?? []).filter((q) => q.kind === "technical");
  const technicalAsked = technical.length;
  const technicalAnswered = technical.filter(
    (q) => q.verdict === "strong" || q.verdict === "adequate"
  ).length;

  const communicationScore =
    e.categories.find((c) => c.name === COMMUNICATION_CATEGORY)?.score ?? null;

  // What the gate decides on. Fit used to lead, which ranked candidates by how
  // much of a JD a short call happened to touch.
  const fitScore = e.jdMatch?.fitScore ?? null;
  const decidingScore = technicalScore ?? e.overallScore ?? (hasJd ? fitScore : null);

  const evidence: GateEvidence = {
    decidingScore,
    technicalScore,
    technicalAsked,
    technicalAnswered,
    communicationScore,
  };
  return { ...evidence, decision: decisionFor(evidence) };
}
