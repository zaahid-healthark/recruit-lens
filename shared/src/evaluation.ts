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

export const CLASSIFICATION_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type ClassificationConfidence = (typeof CLASSIFICATION_CONFIDENCE_LEVELS)[number];

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
  /** 0-100 fit against the JD specifically — distinct from overall_score. */
  fit_score: number;
  verdict_summary: string;
  requirements: LlmJdRequirementResult[];
}

/** One scored category as returned by the LLM. */
export interface LlmCategoryResult {
  name: string;
  score: number;
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
  overall_score: number;
  overall_summary: string;
  categories: LlmCategoryResult[];
  strengths: string[];
  areas_for_improvement: string[];
  recommendation: string;
  /** null when the recording had no Job attached at evaluation time. */
  jd_match: LlmJdMatchResult | null;
}
