import {
  CLASSIFICATION_CONFIDENCE_LEVELS,
  JD_REQUIREMENT_VERDICTS,
  MATRIX_CATEGORIES,
  OTHER_VALUE,
} from "@interview-evaluator/shared";
import { z } from "zod";
import { DEPARTMENT_NAMES, TAXONOMY } from "../config/taxonomy";

/** Models occasionally return floats — round, then require a 0-100 integer. */
const score = z.preprocess(
  (v) => (typeof v === "number" ? Math.round(v) : v),
  z.number().int().min(0).max(100)
);

const categorySchema = z.object({
  name: z.enum(MATRIX_CATEGORIES),
  score,
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
  fit_score: score,
  verdict_summary: z.string().min(1),
  // A JD with zero extractable requirements means the paste was junk — reject
  // rather than store an empty match that reads like "nothing required".
  requirements: z.array(jdRequirementSchema).min(1),
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
    overall_score: score,
    overall_summary: z.string().min(1),
    categories: z.array(categorySchema).length(MATRIX_CATEGORIES.length),
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
  return obj;
}
