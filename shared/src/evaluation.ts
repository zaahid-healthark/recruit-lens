/**
 * The fixed scoring matrix and the JSON shape the LLM must return
 * (snake_case, exactly as specified in the scoring prompt).
 */

export const MATRIX_CATEGORIES = [
  "Communication Skills",
  "Technical Knowledge",
  "Problem Solving",
  "Cultural Fit",
  "Confidence & Clarity",
] as const;

export type MatrixCategoryName = (typeof MATRIX_CATEGORIES)[number];

/**
 * The category that technical questions feed. Named rather than indexed so
 * reordering the matrix cannot silently break the link between the questions
 * a recruiter asked and the score they drive.
 */
export const TECHNICAL_CATEGORY: MatrixCategoryName = "Technical Knowledge";

/**
 * The category that carries the most weight in the overall score.
 *
 * This is a SCREENING GATE, not a hiring decision: the call merges what used
 * to be two rounds — the recruiter's own questions and the basic technical
 * questions an engineer asked in a second call — and the report decides only
 * whether to spend a video interview on this person. So the deciding question
 * is the narrow one the recruiter actually tested: could the candidate answer
 * the technical questions they were asked?
 */
export const PRIMARY_CATEGORY: MatrixCategoryName = TECHNICAL_CATEGORY;

/**
 * Communication gates from BELOW, rather than outranking everything else.
 *
 * Clear English still matters — these candidates explain their work to
 * clients, and the next round is a video call they have to hold up in. But it
 * is a floor, not the primary signal: an accent or an awkward phrase is not a
 * reason to reject someone who answered the questions correctly. Only being
 * genuinely unable to be understood is, because a video screen cannot fix it.
 * It is about being UNDERSTOOD, never about sounding native; see the prompt.
 */
export const COMMUNICATION_CATEGORY: MatrixCategoryName = "Communication Skills";
export const COMMUNICATION_FLOOR = 40;

/**
 * How many of the technical questions a candidate has to actually answer.
 *
 * The gate is a question about answers, not about a score: "could they handle
 * what the recruiter asked?" is answered by counting the answers that landed,
 * which is auditable and survives a model scoring a shade high or low. Rates
 * are over the technical questions ASKED — a recruiter who asked none leaves
 * this silent rather than failing the candidate for it.
 */
export const TECHNICAL_PASS_RATE = 0.6;
export const TECHNICAL_BORDERLINE_RATE = 0.34;

/** The categories that behavioural and situational answers bear on. */
export const BEHAVIOURAL_CATEGORIES: MatrixCategoryName[] = ["Problem Solving", "Cultural Fit"];

export const CLASSIFICATION_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type ClassificationConfidence = (typeof CLASSIFICATION_CONFIDENCE_LEVELS)[number];

/**
 * THE NULL RULE — the single idea the whole scoring contract rests on.
 *
 * A score is a claim about the candidate. Making one requires evidence, so:
 *
 *   null   = the interview never tested this. We do not know.
 *   number = the interview tested it and this is how the candidate did.
 *
 * A candidate who says "I don't know" HAS been tested — that scores low, it is
 * not null. A topic nobody raised is null, never a low number and never a
 * middling one. Fabricating a mid-range score for an untested topic reads as
 * "mediocre candidate" when the truth is "thin interview", which is how a
 * hireable person ends up looking borderline.
 */
export const NOT_ASSESSED_LABEL = "Not assessed";

/**
 * Below this many scored categories there is not enough of a person on record
 * to put a single number on them, so `overall_score` is null instead. Enforced
 * in code after the model answers, not left to the model's judgement.
 */
export const MIN_SCORED_CATEGORIES_FOR_OVERALL = 3;

/**
 * Where a candidate's deciding score puts them.
 *
 * Scores are SHOWN out of 10 and stored out of 100 — the storage is a hundred
 * integers rather than ten, which leaves room for the model to discriminate,
 * and avoids migrating every score already on record. Divide by ten to display
 * (see toDisplayScore); never show the raw number.
 *
 * The bands ARE the actions, which is the property that was missing. A score
 * that does not tell a recruiter what to do is decoration, and 5.5 meaning
 * "advance" was exactly that. Now:
 *
 *   7.5 - 10   fit — send them to the video screen
 *   6.0 - 7.4  consider — a judgement call for a human
 *   below 6.0  do not proceed
 *
 * Everything else is calibrated to land candidates in the right band: an
 * answer the model calls "adequate" scores 7.5 or better BY CONSTRUCTION (see
 * VERDICT_SCORE_RANGES), so "they answered acceptably" and "they scored a fit"
 * cannot contradict each other. That contradiction is what produced a 4.9 for
 * a candidate whose every answer had just been accepted.
 */
export const DECISION_THRESHOLDS = {
  /** At or above this, the candidate is a fit for the video screen. */
  advance: 75,
  /** At or above this, worth a human deciding. Below it, do not proceed. */
  borderline: 60,
} as const;

/** Scores are stored out of 100 and shown out of 10. Always display via this. */
export function toDisplayScore(score: number): string {
  return (score / 10).toFixed(1);
}

export interface ScoreBand {
  min: number;
  max: number;
  label: string;
  descriptor: string;
}

/** Score-band descriptors included in the scoring prompt so scores stay consistent. */
export const SCORE_BANDS: ScoreBand[] = [
  {
    min: 0,
    max: 29,
    label: "0.0-2.9",
    descriptor: "DO NOT PROCEED — could not answer, or could not explain their own work",
  },
  {
    min: 30,
    max: 59,
    label: "3.0-5.9",
    descriptor: "DO NOT PROCEED — answers were wrong, or said nothing a knowledgeable person would say",
  },
  {
    min: 60,
    max: 74,
    label: "6.0-7.4",
    descriptor:
      "CONSIDER — some of the basics landed and some did not; a human decides this one",
  },
  {
    min: 75,
    max: 84,
    label: "7.5-8.4",
    descriptor:
      "FIT — send to the video screen. Correct, sensible answers to the questions asked. " +
      "A short, general, correct answer belongs HERE; one minute per answer cannot show depth",
  },
  {
    min: 85,
    max: 100,
    label: "8.5-10.0",
    descriptor: "STRONG FIT — correct AND specific, with real detail from their own work",
  },
];

/**
 * Job-description matching. Only produced when the recording is linked to a
 * Job — a JD-less evaluation leaves `jd_match` null, so scores from the two
 * modes stay distinguishable rather than silently comparable.
 */
export const JD_REQUIREMENT_VERDICTS = ["met", "partial", "missing", "not_discussed"] as const;

export type JdRequirementVerdict = (typeof JD_REQUIREMENT_VERDICTS)[number];

/** Human-readable labels + intent for each verdict (drives prompt and UI). */
export const JD_VERDICT_LABELS: Record<JdRequirementVerdict, string> = {
  met: "Met",
  partial: "Partially met",
  missing: "Not met",
  /** The interview never covered it — an interviewer gap, not a candidate gap. */
  not_discussed: "Not discussed",
};

/** One requirement extracted from the JD, with the candidate's evidence against it. */
export interface LlmJdRequirementResult {
  requirement: string;
  verdict: JdRequirementVerdict;
  evidence: string;
}

export interface LlmJdMatchResult {
  /**
   * 0-100 fit against the JD specifically — distinct from overall_score.
   * Null when every requirement was "not_discussed": an interview that probed
   * nothing produces no fit evidence, and 0 would read as a bad candidate.
   */
  fit_score: number | null;
  verdict_summary: string;
  requirements: LlmJdRequirementResult[];
}

/**
 * Every substantive question the RECRUITER actually asked, graded one at a
 * time — technical, behavioural, situational, experience and motivation alike.
 *
 * Recruiters are not required to ask any; some screening calls are purely
 * logistical. But when they do ask, those answers are the hardest evidence in
 * the whole transcript, and they must drive the matrix scores rather than sit
 * beside them as decoration.
 */
export const QUESTION_KINDS = [
  /** Role-specific knowledge or skill: a method, a tool, a trade-off, a calculation. */
  "technical",
  /** Past behaviour: a conflict, a failure, how they actually handled something. */
  "behavioural",
  /** Hypothetical: "what would you do if…". */
  "situational",
  /** Their own background: what they built, owned, or delivered. */
  "experience",
  /** Why this role, why leaving, what they want next. */
  "motivation",
] as const;

export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  situational: "Situational",
  experience: "Experience",
  motivation: "Motivation",
};

/**
 * Verdicts span every kind of question, which is why they are not phrased as
 * correct/incorrect: "tell me about a disagreement with a teammate" has no
 * right answer, but it very obviously has strong and weak ones.
 */
export const ANSWER_VERDICTS = ["strong", "adequate", "weak", "not_answered"] as const;

export type AnswerVerdict = (typeof ANSWER_VERDICTS)[number];

export const ANSWER_VERDICT_LABELS: Record<AnswerVerdict, string> = {
  strong: "Strong answer",
  adequate: "Adequate",
  weak: "Weak",
  /** Deflected, changed the subject, or said outright they did not know. */
  not_answered: "Could not answer",
};

/**
 * The score range each verdict must fall in.
 *
 * The verdict is the judgement; the number only reports it. They were drifting
 * apart — answers graded "adequate" came back at 56-58, which reads as a near
 * miss when the verdict already said the candidate answered the question.
 *
 * The ranges are set for the format. A technical answer in this call gets
 * roughly ONE MINUTE, which is not enough to produce war stories or metrics,
 * so a correct but general answer is the expected good outcome and is scored
 * as one. Specificity lifts an answer within its range; its absence never
 * drops one below "they knew this". Only being WRONG or EMPTY does that.
 */
export const VERDICT_SCORE_RANGES: Record<AnswerVerdict, { min: number; max: number }> = {
  /** Correct and they clearly know it. A concrete detail lifts it; brevity does not lower it. */
  strong: { min: 85, max: 100 },
  /** Correct but general — the NORMAL good answer in a one-minute slot, and a FIT. */
  adequate: { min: 75, max: 84 },
  /** Wrong, or words with no content in them. Not merely short or unelaborated. */
  weak: { min: 30, max: 59 },
  /** Deflected, or said outright they did not know. */
  not_answered: { min: 0, max: 29 },
};

export interface LlmQuestionResult {
  /** The question as asked, tightened to one sentence if the recruiter rambled. */
  question: string;
  kind: QuestionKind;
  /** What the candidate actually said back, in a sentence or two. */
  answer_summary: string;
  verdict: AnswerVerdict;
  /**
   * 0-100 for THIS answer. Never null: the question was asked, so the answer
   * (including a non-answer) is evidence. See NOT_ASSESSED_LABEL.
   */
  score: number;
  evidence: string;
}

export interface LlmQuestionAssessment {
  /** Every substantive question asked, in the order they were asked. */
  questions: LlmQuestionResult[];
  /** Aggregate over the technical questions; null when none were asked. */
  technical_score: number | null;
  /** Aggregate over behavioural + situational questions; null when none. */
  behavioural_score: number | null;
  summary: string;
}

/** One scored category as returned by the LLM. */
export interface LlmCategoryResult {
  name: string;
  /** Null when the interview never tested this category. See NOT_ASSESSED_LABEL. */
  score: number | null;
  summary: string;
  evidence: string;
  recommendation: string;
}

/** The complete JSON object the evaluation model must return (snake_case). */
export interface LlmEvaluationResult {
  role_designation: string;
  department: string;
  sub_category: string;
  classification_confidence: ClassificationConfidence;
  classification_rationale: string;
  /** Null when too little was tested to put one number on the candidate. */
  overall_score: number | null;
  overall_summary: string;
  /** What this interview did and did not cover — the caveat on every score. */
  coverage_note: string;
  categories: LlmCategoryResult[];
  /** Null when the recruiter asked no substantive questions at all. */
  question_assessment: LlmQuestionAssessment | null;
  strengths: string[];
  areas_for_improvement: string[];
  recommendation: string;
  /** null when the recording had no Job attached at evaluation time. */
  jd_match: LlmJdMatchResult | null;
}
