import {
  EvaluationCategoryDto,
  EvaluationDto,
  EvaluationSummaryDto,
  JD_REQUIREMENT_VERDICTS,
  JdMatchDto,
  JdRequirementVerdict,
  JobDto,
  RecordingDetailDto,
  RecordingListItemDto,
  RecordingStatus,
  TranscriptDto,
} from "@interview-evaluator/shared";
import { Evaluation, Job, Recording, Transcript } from "@prisma/client";

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

function isVerdict(v: unknown): v is JdRequirementVerdict {
  return typeof v === "string" && (JD_REQUIREMENT_VERDICTS as readonly string[]).includes(v);
}

/**
 * Parse the stored jdMatchJson defensively — it is model-produced JSON that
 * was validated on the way in, but an older row (or a hand-edited one) must
 * not be able to crash the detail screen.
 */
function asJdMatch(value: unknown): JdMatchDto | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.fitScore !== "number") return null;
  const requirements = Array.isArray(v.requirements)
    ? v.requirements
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
        .map((r) => ({
          requirement: typeof r.requirement === "string" ? r.requirement : "",
          verdict: isVerdict(r.verdict) ? r.verdict : ("not_discussed" as JdRequirementVerdict),
          evidence: typeof r.evidence === "string" ? r.evidence : "",
        }))
        .filter((r) => r.requirement.length > 0)
    : [];
  return {
    fitScore: v.fitScore,
    verdictSummary: typeof v.verdictSummary === "string" ? v.verdictSummary : "",
    requirements,
  };
}

export function toJobDto(
  j: Job & { recordings?: { evaluation: { overallScore: number } | null }[]; _count?: { recordings: number } }
): JobDto {
  const scores = (j.recordings ?? [])
    .map((r) => r.evaluation?.overallScore)
    .filter((s): s is number => typeof s === "number");
  return {
    id: j.id,
    title: j.title,
    jdText: j.jdText,
    department: j.department,
    subCategory: j.subCategory,
    archived: j.archived,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
    recordingCount: j._count?.recordings ?? j.recordings?.length ?? 0,
    averageOverallScore: scores.length
      ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
      : null,
  };
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
    jdMatch: asJdMatch(e.jdMatchJson),
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
  r: Recording & { evaluation: Evaluation | null; job?: Job | null }
): RecordingListItemDto {
  return {
    id: r.id,
    originalFilename: r.originalFilename,
    mimeType: r.mimeType,
    durationSeconds: r.durationSeconds,
    importedAt: r.importedAt.toISOString(),
    candidateName: r.candidateName,
    notes: r.notes,
    job: r.job ? { id: r.job.id, title: r.job.title } : null,
    status: r.status as RecordingStatus,
    errorMessage: r.errorMessage,
    evaluationSummary: r.evaluation ? toEvaluationSummaryDto(r.evaluation) : null,
  };
}

export function toRecordingDetailDto(
  r: Recording & { evaluation: Evaluation | null; transcript: Transcript | null; job?: Job | null }
): RecordingDetailDto {
  return {
    ...toRecordingListItemDto(r),
    transcript: r.transcript ? toTranscriptDto(r.transcript) : null,
    evaluation: r.evaluation ? toEvaluationDto(r.evaluation) : null,
  };
}
