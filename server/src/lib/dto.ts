import {
  EvaluationCategoryDto,
  EvaluationDto,
  EvaluationSummaryDto,
  RecordingDetailDto,
  RecordingListItemDto,
  RecordingStatus,
  TranscriptDto,
} from "@interview-evaluator/shared";
import { Evaluation, Recording, Transcript } from "@prisma/client";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asCategories(value: unknown): EvaluationCategoryDto[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => ({
      name: typeof c.name === "string" ? c.name : "",
      score: typeof c.score === "number" ? c.score : 0,
      summary: typeof c.summary === "string" ? c.summary : "",
      evidence: typeof c.evidence === "string" ? c.evidence : "",
      recommendation: typeof c.recommendation === "string" ? c.recommendation : "",
    }));
}

export function toEvaluationSummaryDto(e: Evaluation): EvaluationSummaryDto {
  return {
    overallScore: e.overallScore,
    roleDesignation: e.roleDesignation,
    department: e.department,
    subCategory: e.subCategory,
    recommendation: e.recommendation,
    classificationConfidence: e.classificationConfidence,
  };
}

export function toEvaluationDto(e: Evaluation): EvaluationDto {
  return {
    ...toEvaluationSummaryDto(e),
    classificationRationale: e.classificationRationale,
    overallSummary: e.overallSummary,
    categories: asCategories(e.categoriesJson),
    strengths: asStringArray(e.strengths),
    areasForImprovement: asStringArray(e.areasForImprovement),
    model: e.model,
    createdAt: e.createdAt.toISOString(),
  };
}

export function toTranscriptDto(t: Transcript): TranscriptDto {
  return {
    text: t.text,
    model: t.model,
    language: t.language,
    createdAt: t.createdAt.toISOString(),
  };
}

export function toRecordingListItemDto(
  r: Recording & { evaluation: Evaluation | null }
): RecordingListItemDto {
  return {
    id: r.id,
    originalFilename: r.originalFilename,
    mimeType: r.mimeType,
    durationSeconds: r.durationSeconds,
    importedAt: r.importedAt.toISOString(),
    candidateName: r.candidateName,
    notes: r.notes,
    status: r.status as RecordingStatus,
    errorMessage: r.errorMessage,
    evaluationSummary: r.evaluation ? toEvaluationSummaryDto(r.evaluation) : null,
  };
}

export function toRecordingDetailDto(
  r: Recording & { evaluation: Evaluation | null; transcript: Transcript | null }
): RecordingDetailDto {
  return {
    ...toRecordingListItemDto(r),
    transcript: r.transcript ? toTranscriptDto(r.transcript) : null,
    evaluation: r.evaluation ? toEvaluationDto(r.evaluation) : null,
  };
}
