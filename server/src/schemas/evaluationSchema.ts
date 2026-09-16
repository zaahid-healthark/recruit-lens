import {
  ANSWER_VERDICTS,
  BEHAVIOURAL_CATEGORIES,
  CLASSIFICATION_CONFIDENCE_LEVELS,
  JD_REQUIREMENT_VERDICTS,
  MATRIX_CATEGORIES,
  MIN_SCORED_CATEGORIES_FOR_OVERALL,
  OTHER_VALUE,
  QUESTION_KINDS,
  TECHNICAL_CATEGORY,
  VERDICT_SCORE_RANGES,
} from "@interview-evaluator/shared";
import { z } from "zod";
import { ANSWER_CONSISTENCY_TOLERANCE } from "../ai/prompts";
import { DEPARTMENT_NAMES, TAXONOMY } from "../config/taxonomy";

/** Models occasionally return floats — round, then require a 0-100 integer. */
const score = z.preprocess(
  (v) => (typeof v === "number" ? Math.round(v) : v),
  z.number().int().min(0).max(100)
);

/**
 * A score the model is allowed to withhold, meaning "the interview never
 * tested this".
 *
 * Models spell that several ways — null, "null", "N/A", "not assessed", an
 * empty string — and every one of them means the same thing. Normalizing them
 * all to null here keeps a well-intentioned answer from failing validation and
 * burning the single repair retry on a formatting quibble.
 */
const optionalScore = z.preprocess(
  (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      if (["", "null", "none", "n/a", "na", "not assessed", "not_assessed"].includes(t)) {
        return null;
      }
      const n = Number(t);
      return Number.isFinite(n) ? Math.round(n) : v;
    }
    return typeof v === "number" ? Math.round(v) : v;
  },
  z.number().int().min(0).max(100).nullable()
);

const categorySchema = z.object({
  name: z.enum(MATRIX_CATEGORIES),
  score: optionalScore,
  summary: z.string().min(1),
  evidence: z.string().min(1),
  recommendation: z.string().min(1),
});

const jdRequirementSchema = z.object({
  requirement: z.string().min(1),
  verdict: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : v),
    z.enum(JD_REQUIREMENT_VERDICTS)
  ),
  evidence: z.string().min(1),
});

const jdMatchSchema = z.object({
  fit_score: optionalScore,
  verdict_summary: z.string().min(1),
  // A JD with zero extractable requirements means the paste was junk — reject
  // rather than store an empty match that reads like "nothing required".
  requirements: z.array(jdRequirementSchema).min(1),
});

const enumish = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : v),
    z.enum(values)
  );

/**
 * One question the recruiter asked. `score` is required, not optional: the
 * question WAS asked, so the answer — including "I don't know" — is evidence.
 * Only untested topics are allowed to be null.
 */
const questionResultSchema = z.object({
  question: z.string().min(1),
  // Older rows (and the odd omission) predate the kind field; "technical" was
  // the only kind that existed when per-question grading was introduced.
  kind: enumish(QUESTION_KINDS).default("technical"),
  answer_summary: z.string().min(1),
  verdict: enumish(ANSWER_VERDICTS),
  score,
  evidence: z.string().default(""),
});

const questionAssessmentSchema = z.object({
  questions: z.array(questionResultSchema).min(1),
  technical_score: optionalScore,
  behavioural_score: optionalScore,
  summary: z.string().min(1),
});

/**
 * Strict validation of the LLM's JSON (spec: validate with zod, one repair
 * retry on failure, then FAILED). Taxonomy membership is enforced dynamically
 * from the config so editing the taxonomy never requires touching this file.
 *
 * `jd_match` is required exactly when a job description was supplied: a model
 * that silently drops it would otherwise produce an evaluation that looks
 * JD-scored in the UI but isn't, so the repair retry gets a chance to fix it.
 */
export const llmEvaluationSchema = z
  .object({
    role_designation: z.string().min(1),
    department: z.string().min(1),
    sub_category: z.string().min(1),
    classification_confidence: z.preprocess(
      (v) => (typeof v === "string" ? v.toLowerCase() : v),
      z.enum(CLASSIFICATION_CONFIDENCE_LEVELS)
    ),
    classification_rationale: z.string().default(""),
    overall_score: optionalScore,
    overall_summary: z.string().min(1),
    coverage_note: z.string().default(""),
    categories: z.array(categorySchema).length(MATRIX_CATEGORIES.length),
    question_assessment: questionAssessmentSchema.nullish().default(null),
    strengths: z.array(z.string()).default([]),
    areas_for_improvement: z.array(z.string()).default([]),
    recommendation: z.string().min(1),
    jd_match: jdMatchSchema.nullish().default(null),
  })
  .superRefine((val, ctx) => {
    if (val.department !== OTHER_VALUE && !DEPARTMENT_NAMES.includes(val.department)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["department"],
        message: `department must be one of: ${[...DEPARTMENT_NAMES, OTHER_VALUE].join(", ")}`,
      });
      return;
    }
    const validSubs = val.department === OTHER_VALUE ? [] : (TAXONOMY[val.department] ?? []);
    if (val.sub_category !== OTHER_VALUE && !validSubs.includes(val.sub_category)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sub_category"],
        message: `sub_category must be "${OTHER_VALUE}" or one of ${val.department}'s sub-categories`,
      });
    }
    const names = new Set(val.categories.map((c) => c.name));
    if (names.size !== MATRIX_CATEGORIES.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categories"],
        message: "categories must contain each matrix category exactly once",
      });
    }
    // The matrix must agree with the answers that were graded question by
    // question. Without this the two halves of the report can contradict each
    // other — every technical answer marked weak, yet a passing Technical
    // Knowledge score — which is exactly how a bad candidate slips through and
    // how a good one gets marked down. Worth the repair retry.
    const qa = val.question_assessment;
    if (qa) {
      const bind = (categoryName: string, answerScore: number, kindLabel: string): void => {
        const category = val.categories.find((c) => c.name === categoryName);
        if (!category) return;
        if (category.score === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["categories"],
            message:
              `the recruiter asked ${kindLabel} questions, so "${categoryName}" must have a ` +
              `numeric score reflecting those answers — it cannot be null`,
          });
          return;
        }
        if (Math.abs(category.score - answerScore) > ANSWER_CONSISTENCY_TOLERANCE) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["categories"],
            message:
              `"${categoryName}" is ${category.score} but the ${kindLabel} answers scored ` +
              `${answerScore}. A category may sit at most ${ANSWER_CONSISTENCY_TOLERANCE} points ` +
              `from the graded answers that bear on it — reconcile them.`,
          });
        }
      };

      if (qa.technical_score !== null) {
        bind(TECHNICAL_CATEGORY, qa.technical_score, "technical");
      }
      if (qa.behavioural_score !== null) {
        for (const name of BEHAVIOURAL_CATEGORIES) {
          bind(name, qa.behavioural_score, "behavioural or situational");
        }
      }
    }
  });

export type ParsedLlmEvaluation = z.infer<typeof llmEvaluationSchema>;

/**
 * Whether a JD was in play is known by the caller, not the payload, so the
 * jd_match presence rule is layered on top of the base schema rather than
 * baked into it.
 */
export function llmEvaluationSchemaFor(hasJob: boolean) {
  return llmEvaluationSchema.superRefine((val, ctx) => {
    if (hasJob && !val.jd_match) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["jd_match"],
        message:
          "a job description was supplied, so jd_match is required (fit_score, verdict_summary, requirements[])",
      });
    }
    if (!hasJob && val.jd_match) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["jd_match"],
        message: "no job description was supplied, so jd_match must be null",
      });
    }
  });
}

/**
 * Tolerant cleanup applied BEFORE zod: models sometimes change casing
 * ("hr" vs "HR", "communication skills") — map back to canonical values
 * case-insensitively so trivially-recoverable outputs don't burn the retry.
 */
export function normalizeLlmResult(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  const canonicalize = (value: unknown, canonical: readonly string[]): unknown => {
    if (typeof value !== "string") return value;
    const hit = canonical.find((c) => c.toLowerCase() === value.trim().toLowerCase());
    return hit ?? value.trim();
  };

  obj.department = canonicalize(obj.department, [...DEPARTMENT_NAMES, OTHER_VALUE]);
  if (obj.department === OTHER_VALUE) {
    obj.sub_category = OTHER_VALUE;
  } else if (typeof obj.department === "string") {
    obj.sub_category = canonicalize(obj.sub_category, [
      ...(TAXONOMY[obj.department] ?? []),
      OTHER_VALUE,
    ]);
  }
  if (Array.isArray(obj.categories)) {
    obj.categories = obj.categories.map((c) => {
      if (typeof c !== "object" || c === null) return c;
      const cat: Record<string, unknown> = { ...(c as Record<string, unknown>) };
      cat.name = canonicalize(cat.name, MATRIX_CATEGORIES);
      return cat;
    });
  }
  // Models write verdicts as "Not Discussed" / "not-discussed" / "NOT_DISCUSSED";
  // the enum's own preprocess handles casing, but an empty requirements array or
  // a JD block wrapped in a stray key is worth normalizing away here.
  if (typeof obj.jd_match === "object" && obj.jd_match !== null) {
    const jd: Record<string, unknown> = { ...(obj.jd_match as Record<string, unknown>) };
    if (Array.isArray(jd.requirements)) {
      jd.requirements = jd.requirements.filter(
        (r) => typeof r === "object" && r !== null && typeof (r as { requirement?: unknown }).requirement === "string"
      );
    }
    obj.jd_match = jd;
  } else if (obj.jd_match === undefined) {
    obj.jd_match = null;
  }
  // "No questions were asked" reaches us as null, as an omitted key, or as an
  // empty questions array — collapse all three to null so downstream code has
  // exactly one shape to check.
  const rawQa = obj.question_assessment ?? obj.technical_assessment;
  if (typeof rawQa === "object" && rawQa !== null) {
    const qa: Record<string, unknown> = { ...(rawQa as Record<string, unknown>) };
    const questions = Array.isArray(qa.questions)
      ? qa.questions.filter(
          (q) =>
            typeof q === "object" &&
            q !== null &&
            typeof (q as { question?: unknown }).question === "string" &&
            (q as { question: string }).question.trim().length > 0
        )
      : [];
    // A model that still emits the old technical-only shape ({score}) has its
    // aggregate read as the technical one rather than dropped on the floor.
    if (qa.technical_score === undefined && typeof qa.score === "number") {
      qa.technical_score = qa.score;
    }
    obj.question_assessment = questions.length > 0 ? { ...qa, questions } : null;
  } else {
    obj.question_assessment = null;
  }
  delete obj.technical_assessment;
  return obj;
}

/**
 * Post-validation guards for the rules that are too important to leave to the
 * model's judgement. Applied to already-valid output, so nothing here can fail
 * an evaluation — each rule only ever withholds a number the evidence does not
 * support.
 */
export function applyScoringGuards(result: ParsedLlmEvaluation): ParsedLlmEvaluation {
  const scored = result.categories.filter((c) => c.score !== null).length;

  // Too little of the candidate is on record to put one number on them. The
  // model is told this rule, but a stated rule is a hope; this is the check.
  if (scored < MIN_SCORED_CATEGORIES_FOR_OVERALL && result.overall_score !== null) {
    result.overall_score = null;
  }

  // An overall score with no recommendation to match reads as a verdict the
  // evidence cannot support, so the recommendation is restated to agree.
  if (result.overall_score === null && !/^\s*insufficient/i.test(result.recommendation)) {
    result.recommendation =
      "Insufficient evidence — this call did not cover enough to judge the candidate. " +
      "A follow-up round is needed before any decision.";
  }

  // The verdict is the judgement; the score only reports it. They were drifting
  // apart — answers graded "adequate" came back at 56-58, which reads as a near
  // miss when the verdict already said the candidate answered the question.
  //
  // A technical answer in this call gets about a minute, so a correct but
  // general answer is the expected good outcome. Specificity moves a score
  // WITHIN its verdict's range; its absence never drops one out of the bottom.
  const qa = result.question_assessment;
  if (qa) {
    for (const q of qa.questions) {
      const range = VERDICT_SCORE_RANGES[q.verdict];
      if (range) q.score = Math.min(range.max, Math.max(range.min, q.score));
    }

    // The aggregates follow the answers they aggregate. Clamping a score up and
    // leaving the total beneath it would just move the contradiction.
    const floorFor = (kinds: string[]): number | null => {
      const of = qa.questions.filter((q) => kinds.includes(q.kind));
      if (of.length === 0) return null;
      if (!of.every((q) => q.verdict === "strong" || q.verdict === "adequate")) return null;
      return Math.min(...of.map((q) => q.score));
    };
    const tech = floorFor(["technical"]);
    if (tech !== null && qa.technical_score !== null && qa.technical_score < tech) {
      qa.technical_score = tech;
    }
    const behav = floorFor(["behavioural", "situational"]);
    if (behav !== null && qa.behavioural_score !== null && qa.behavioural_score < behav) {
      qa.behavioural_score = behav;
    }
  }

  // A candidate cannot be rated below the worst answer they gave, when every
  // answer they gave was acceptable.
  //
  // This is the failure that prompted it: three technical questions, all three
  // graded "adequate", scoring 58, 60 and 56 — and an overall of 49. Every
  // piece of evidence in the report said "this person knows the things"; the
  // summary judgement said otherwise, and the summary judgement is what the
  // recruiter reads. The graded answers are the hardest evidence in the
  // transcript, so an overall beneath all of them is the model second-guessing
  // its own findings on tone rather than on anything the candidate said.
  //
  // Deliberately floors at the LOWEST answer rather than at a passing score:
  // it is derived from the candidate's own worst moment, not from a threshold,
  // so it cannot lift anyone past the gate who did not earn it. Three adequate
  // answers at 40 still floor at 40, and still fail.
  const graded = result.question_assessment?.questions ?? [];
  if (
    result.overall_score !== null &&
    graded.length >= 2 &&
    graded.every((q) => q.verdict === "strong" || q.verdict === "adequate")
  ) {
    const worst = Math.min(...graded.map((q) => q.score));
    if (result.overall_score < worst) result.overall_score = worst;
  }

  // A JD nobody probed produces no fit evidence; 0 would read as a bad
  // candidate rather than as an interview that never asked.
  if (result.jd_match) {
    const probed = result.jd_match.requirements.some((r) => r.verdict !== "not_discussed");
    if (!probed) result.jd_match.fit_score = null;
  }

  return result;
}
