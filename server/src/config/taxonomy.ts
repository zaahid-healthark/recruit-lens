import { OTHER_VALUE, TaxonomyDto, TaxonomyMap } from "@interview-evaluator/shared";

/**
 * ══════════════════════════ EDIT ME ══════════════════════════
 * Single source of truth for the classification taxonomy.
 *
 * - Served to the mobile app via GET /taxonomy (drives its filters).
 * - Injected into the AI scoring prompt (constrains classification).
 * - Mirrored into the DB by `npm run seed -w server` (re-run after editing).
 *
 * "Other" is always allowed as a fallback for both levels and does
 * not need to be listed here.
 * ═════════════════════════════════════════════════════════════
 */
export const TAXONOMY: TaxonomyMap = {
  IDT: [
    "Data Engineering",
    "Data Science & Analytics",
    "Software / Full-Stack Development",
    "BI & Visualization",
    "Cloud / DevOps",
  ],
  RWE: [
    "Epidemiology",
    "Biostatistics",
    "HEOR",
    "Medical Writing",
    "RWE Analytics",
  ],
  "Strategy Counselling": [
    "Market Access",
    "Commercial / Growth Strategy",
    "Business Development",
    "Competitive Intelligence",
    "Engagement / Project Management",
  ],
  HR: [
    "Talent Acquisition",
    "HR Business Partner",
    "Learning & Development",
    "Compensation & Benefits",
    "HR Operations",
  ],
  Finance: [
    "FP&A",
    "Accounting",
    "Controlling",
    "Audit & Compliance",
    "Treasury / Billing",
  ],
};

export const DEPARTMENT_NAMES: string[] = Object.keys(TAXONOMY);

export function taxonomyDto(): TaxonomyDto {
  return {
    departments: DEPARTMENT_NAMES.map((name) => ({
      name,
      subCategories: TAXONOMY[name] ?? [],
    })),
    fallback: OTHER_VALUE,
  };
}
