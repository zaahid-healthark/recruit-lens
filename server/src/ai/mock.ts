import { LlmEvaluationResult, MATRIX_CATEGORIES } from "@interview-evaluator/shared";
import { DEPARTMENT_NAMES, TAXONOMY } from "../config/taxonomy";

/**
 * MOCK_AI mode: deterministic canned transcripts/evaluations so the whole
 * app can be exercised end-to-end with zero OpenAI cost. The same filename
 * always produces the same result (stable across restarts), and results are
 * spread across departments/scores so the dashboard looks alive.
 */

/** FNV-1a — tiny deterministic hash. */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const ROLE_BY_SUBCATEGORY: Record<string, string> = {
  "Data Engineering": "Senior Data Engineer",
  "Data Science & Analytics": "Data Scientist",
  "Software / Full-Stack Development": "Full-Stack Developer",
  "BI & Visualization": "BI Developer",
  "Cloud / DevOps": "DevOps Engineer",
  Epidemiology: "Epidemiologist",
  Biostatistics: "Biostatistician",
  HEOR: "HEOR Consultant",
  "Medical Writing": "Medical Writer",
  "RWE Analytics": "RWE Analyst",
  "Market Access": "Market Access Consultant",
  "Commercial / Growth Strategy": "Strategy Consultant",
  "Business Development": "Business Development Manager",
  "Competitive Intelligence": "Competitive Intelligence Analyst",
  "Engagement / Project Management": "Engagement Manager",
  "Talent Acquisition": "Talent Acquisition Specialist",
  "HR Business Partner": "HR Business Partner",
  "Learning & Development": "L&D Specialist",
  "Compensation & Benefits": "Compensation Analyst",
  "HR Operations": "HR Operations Executive",
  "FP&A": "FP&A Analyst",
  Accounting: "Senior Accountant",
  Controlling: "Financial Controller",
  "Audit & Compliance": "Internal Auditor",
  "Treasury / Billing": "Billing Specialist",
};

const STRENGTH_POOL = [
  "Communicates ideas in a clear, structured way",
  "Backs claims with concrete examples from past projects",
  "Strong fundamentals in the core domain",
  "Asks clarifying questions before answering",
  "Collaborative attitude; speaks positively about past teams",
  "Stays composed under probing follow-up questions",
];

const IMPROVEMENT_POOL = [
  "Answers occasionally drift from the question asked",
  "Limited hands-on depth in some advanced topics",
  "Could quantify impact of past work more precisely",
  "Tends to use filler words when uncertain",
  "Should prepare more questions about the role and company",
  "Edge cases were missed in the problem-solving exercise",
];

export interface MockOverrides {
  department?: string;
  subCategory?: string;
  roleDesignation?: string;
}

export function mockTranscript(filename: string, role: string): string {
  return [
    `Speaker A: Thanks for joining today. To start, can you walk me through your background as it relates to the ${role} position?`,
    `Speaker B: Of course. I've spent the last four years working in this space, most recently leading two delivery projects end to end.`,
    `Speaker A: Great. Can you describe a challenging problem you solved recently?`,
    `Speaker B: Sure — we had a critical process failing intermittently. I isolated the root cause, proposed two options with trade-offs, and we shipped the fix within a week.`,
    `Speaker A: How did you communicate that to stakeholders?`,
    `Speaker B: I kept a short written summary after each milestone and flagged risks early, which kept everyone aligned.`,
    `Speaker A: What tools and methods are you strongest with?`,
    `Speaker B: The standard stack for this role, plus some automation I built myself to speed up repetitive checks.`,
    `Speaker A: Tell me about a time you disagreed with a teammate.`,
    `Speaker B: We disagreed on an approach; I suggested we time-box a small experiment for each option and let the results decide. It kept things objective.`,
    `Speaker A: Why do you want to join us?`,
    `Speaker B: The overlap between your consulting work and my background is strong, and I want ownership of problems from framing to delivery.`,
    `Speaker A: Any questions for me?`,
    `Speaker B: Yes — how does the team measure success in the first six months for this role?`,
    `(mock transcript generated for "${filename}" — MOCK_AI mode)`,
  ].join("\n");
}

export function mockEvaluation(filename: string, overrides: MockOverrides = {}): LlmEvaluationResult {
  const h = hashString(filename);
  const department = overrides.department ?? DEPARTMENT_NAMES[h % DEPARTMENT_NAMES.length];
  const subs = TAXONOMY[department] ?? ["Other"];
  const subCategory = overrides.subCategory ?? subs[h % subs.length];
  const role =
    overrides.roleDesignation ?? ROLE_BY_SUBCATEGORY[subCategory] ?? `${subCategory} Specialist`;

  const base = 48 + (h % 45); // 48-92 → spread across bands
  const offsets = [4, -5, 6, -8, 2];
  const categories = MATRIX_CATEGORIES.map((name, i) => {
    const catScore = Math.max(22, Math.min(97, base + offsets[i] + (((h >> (i * 3)) % 7) - 3)));
    return {
      name: name as string,
      score: catScore,
      summary: `${name}: ${catScore >= 75 ? "consistently strong" : catScore >= 55 ? "solid with a few gaps" : "below the bar for this role"} across the interview.`,
      evidence: `"${catScore >= 60 ? "I isolated the root cause, proposed two options with trade-offs, and we shipped the fix within a week." : "Answers occasionally drifted and needed prompting to get specific."}" (mock quote)`,
      recommendation:
        catScore >= 75
          ? "Keep leveraging this as a differentiator."
          : "Targeted practice with concrete, quantified examples would lift this area.",
    };
  });
  const overall = Math.round(categories.reduce((s, c) => s + c.score, 0) / categories.length);
  const recommendation =
    overall >= 80
      ? "Strong hire — consistently strong signals across the matrix."
      : overall >= 65
        ? "Hire — solid performance; minor gaps are coachable."
        : overall >= 50
          ? "Maybe — mixed signals; consider a focused follow-up round."
          : "No hire — core expectations for the role were not met.";

  const pick = (pool: string[], offset: number): string[] =>
    [0, 1, 2].map((i) => pool[(h + offset + i) % pool.length]);

  return {
    role_designation: role,
    department,
    sub_category: subCategory,
    classification_confidence: (["high", "medium", "high"] as const)[h % 3],
    classification_rationale: `The discussion centered on ${subCategory.toLowerCase()} responsibilities consistent with a ${role} opening. (mock)`,
    overall_score: overall,
    overall_summary: `The candidate interviewed for a ${role} position and scored ${overall}/100 overall. ${
      overall >= 65
        ? "Communication and problem framing stood out; depth was adequate for the level."
        : "Responses lacked the depth and specificity expected at this level."
    } (mock evaluation)`,
    categories,
    strengths: pick(STRENGTH_POOL, 1),
    areas_for_improvement: pick(IMPROVEMENT_POOL, 2),
    recommendation,
  };
}
