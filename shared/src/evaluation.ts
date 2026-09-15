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
 * Where a candidate's deciding score puts them. These are the band edges from
 * SCORE_BANDS, named: 61 is "meets the bar", 41 is where real capability
 * starts. Kept here so the hire/no-hire line and the score bands can never
 * drift apart.
 */
export const DECISION_THRESHOLDS = {
  /** At or above this, a competent recruiter advances the candidate. */
  advance: 61,
  /** At or above this, there is real capability with gaps worth a second look. */
  borderline: 41,
} as const;

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
    max: 20,
    label: "0-20",
    descriptor: "No relevant capability shown — could not engage with the role at all",
  },
  {
    min: 21,
    max: 40,
    label: "21-40",
    descriptor: "Clearly below the bar — core gaps a hiring manager would reject on",
  },
  {
    min: 41,
    max: 60,
    label: "41-60",
    descriptor: "Borderline — some real capability, but gaps that need a second look",
  },
  {
    min: 61,
    max: 80,
    label: "61-80",
    descriptor: "MEETS THE BAR — a competent recruiter would advance this candidate",
  },
  {
    min: 81,
    max: 100,
    label: "81-100",
    descriptor: "Clearly above the bar — strong across the board",
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
