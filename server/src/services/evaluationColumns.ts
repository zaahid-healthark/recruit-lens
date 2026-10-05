import { LlmEvaluationResult } from "@interview-evaluator/shared";
import { Prisma } from "@prisma/client";

/**
 * The Evaluation columns for a validated model result.
 *
 * One mapping for everything that writes an evaluation — the pipeline, and
 * the demo seed — so a demo report is stored exactly as a real one is.
 */
export function evaluationColumns(result: LlmEvaluationResult, model: string) {
  return {
    roleDesignation: result.role_designation,
    department: result.department,
    subCategory: result.sub_category,
    classificationConfidence: result.classification_confidence,
    classificationRationale: result.classification_rationale,
    overallScore: result.overall_score,
    overallSummary: result.overall_summary,
    coverageNote: result.coverage_note || null,
    categoriesJson: result.categories as unknown as Prisma.InputJsonValue,
    // Stored camelCase to match every other JSON column (and what the DTO
    // reader expects) — the snake_case shape belongs to the model contract.
    questionAssessmentJson: result.question_assessment
      ? ({
          technicalScore: result.question_assessment.technical_score,
          behaviouralScore: result.question_assessment.behavioural_score,
          summary: result.question_assessment.summary,
          questions: result.question_assessment.questions.map((q) => ({
            question: q.question,
            kind: q.kind,
            answerSummary: q.answer_summary,
            verdict: q.verdict,
            score: q.score,
            evidence: q.evidence,
          })),
        } as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull,
    strengths: result.strengths,
    areasForImprovement: result.areas_for_improvement,
    recommendation: result.recommendation,
    // Prisma requires DbNull (SQL NULL) rather than `null` for optional Json
    // columns — plain null is reserved for "JSON null" and is rejected here.
    jdMatchJson: result.jd_match
      ? ({
          fitScore: result.jd_match.fit_score,
          verdictSummary: result.jd_match.verdict_summary,
          requirements: result.jd_match.requirements,
        } as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull,
    model,
  };
}
