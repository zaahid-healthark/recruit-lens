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
  TECHNICAL_ANSWER_VERDICTS,
  TechnicalAnswerVerdict,
  TechnicalAssessmentDto,
  TranscriptDto,
} from "@interview-evaluator/shared";
import { Evaluation, Job, Recording, Transcript } from "@prisma/client";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * A missing score stays missing. Coercing it to 0 would turn "the interview
 * never tested this" into "the candidate scored zero" — the exact confusion
 * the nullable scores exist to prevent.
 */
function asScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asCategories(value: unknown): EvaluationCategoryDto[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => ({
      name: typeof c.name === "string" ? c.name : "",
      score: asScore(c.score),
      summary: typeof c.summary === "string" ? c.summary : "",
      evidence: typeof c.evidence === "string" ? c.evidence : "",
      recommendation: typeof c.recommendation === "string" ? c.recommendation : "",
    }));
}

function isVerdict(v: unknown): v is JdRequirementVerdict {
  return typeof v === "string" && (JD_REQUIREMENT_VERDICTS as readonly string[]).includes(v);
}

function isTechnicalVerdict(v: unknown): v is TechnicalAnswerVerdict {
  return typeof v === "string" && (TECHNICAL_ANSWER_VERDICTS as readonly string[]).includes(v);
}

/**
 * Parse the stored technicalAssessmentJson defensively. A block with no
 * readable questions collapses to null: "the recruiter asked nothing" and
 * "the stored rows were unreadable" should both render as no Q&A section
 * rather than as an empty one implying no questions were asked.
 */
function asTechnicalAssessment(value: unknown): TechnicalAssessmentDto | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const questions = Array.isArray(v.questions)
    ? v.questions
        .filter((q): q is Record<string, unknown> => typeof q === "object" && q !== null)
        .map((q) => ({
          question: typeof q.question === "string" ? q.question : "",
          answerSummary: typeof q.answerSummary === "string" ? q.answerSummary : "",
          verdict: isTechnicalVerdict(q.verdict)
            ? q.verdict
            : ("not_answered" as TechnicalAnswerVerdict),
          score: typeof q.score === "number" ? q.score : 0,
          evidence: typeof q.evidence === "string" ? q.evidence : "",
        }))
        .filter((q) => q.question.length > 0)
    : [];
  if (questions.length === 0) return null;
  return {
    questions,
    score: typeof v.score === "number" ? v.score : 0,
    summary: typeof v.summary === "string" ? v.summary : "",
  };
}

/**
 * Parse the stored jdMatchJson defensively — it is model-produced JSON that
 * was validated on the way in, but an older row (or a hand-edited one) must
 * not be able to crash the detail screen.
 */
function asJdMatch(value: unknown): JdMatchDto | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  // The requirements are the substance; a null fitScore is a legitimate
  // verdict ("nothing was probed"), so only a block with no requirements at
  // all is treated as absent.
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
  if (requirements.length === 0) return null;
  return {
    fitScore: asScore(v.fitScore),
    verdictSummary: typeof v.verdictSummary === "string" ? v.verdictSummary : "",
    requirements,
  };
}

export function toJobDto(
  j: Job & {
    recordings?: { evaluation: { overallScore: number | null } | null }[];
    _count?: { recordings: number };
  }
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
    coverageNote: e.coverageNote,
    categories: asCategories(e.categoriesJson),
    technicalAssessment: asTechnicalAssessment(e.technicalAssessmentJson),
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
    detectedRole: r.detectedRole,
    callSummary: r.callSummary,
    autoImported: r.autoImported,
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
