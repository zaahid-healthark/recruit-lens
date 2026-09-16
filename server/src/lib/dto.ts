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
  ANSWER_VERDICTS,
  AnswerVerdict,
  QUESTION_KINDS,
  QuestionAssessmentDto,
  QuestionKind,
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

/**
 * Verdicts written before grading covered non-technical questions, when the
 * vocabulary was correct/incorrect. Without this map a stored "correct" would
 * fall through to the default and display as "Could not answer" — turning a
 * candidate's best answer into their worst.
 */
const LEGACY_VERDICTS: Record<string, AnswerVerdict> = {
  correct: "strong",
  partially_correct: "adequate",
  incorrect: "weak",
};

function toAnswerVerdict(v: unknown): AnswerVerdict {
  if (typeof v !== "string") return "not_answered";
  if ((ANSWER_VERDICTS as readonly string[]).includes(v)) return v as AnswerVerdict;
  return LEGACY_VERDICTS[v] ?? "not_answered";
}

function isQuestionKind(v: unknown): v is QuestionKind {
  return typeof v === "string" && (QUESTION_KINDS as readonly string[]).includes(v);
}

/**
 * Parse the stored questionAssessmentJson defensively. A block with no
 * readable questions collapses to null: "the recruiter asked nothing" and
 * "the stored rows were unreadable" should both render as no Q&A section
 * rather than as an empty one implying no questions were asked.
 *
 * Rows written before questions carried a kind, or before the aggregate was
 * split by kind, are read as technical — the only kind that existed then.
 */
function asQuestionAssessment(value: unknown): QuestionAssessmentDto | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const questions = Array.isArray(v.questions)
    ? v.questions
        .filter((q): q is Record<string, unknown> => typeof q === "object" && q !== null)
        .map((q) => ({
          question: typeof q.question === "string" ? q.question : "",
          kind: isQuestionKind(q.kind) ? q.kind : ("technical" as QuestionKind),
          answerSummary: typeof q.answerSummary === "string" ? q.answerSummary : "",
          verdict: toAnswerVerdict(q.verdict),
          score: typeof q.score === "number" ? q.score : 0,
          evidence: typeof q.evidence === "string" ? q.evidence : "",
        }))
        .filter((q) => q.question.length > 0)
    : [];
  if (questions.length === 0) return null;
  const legacyScore = typeof v.score === "number" ? v.score : null;
  return {
    questions,
    technicalScore: typeof v.technicalScore === "number" ? v.technicalScore : legacyScore,
    behaviouralScore: typeof v.behaviouralScore === "number" ? v.behaviouralScore : null,
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
    createdAt: e.createdAt.toISOString(),
  };
}

export function toEvaluationDto(e: Evaluation): EvaluationDto {
  return {
    ...toEvaluationSummaryDto(e),
    classificationRationale: e.classificationRationale,
    overallSummary: e.overallSummary,
    coverageNote: e.coverageNote,
    categories: asCategories(e.categoriesJson),
    questionAssessment: asQuestionAssessment(e.questionAssessmentJson),
    strengths: asStringArray(e.strengths),
    areasForImprovement: asStringArray(e.areasForImprovement),
    jdMatch: asJdMatch(e.jdMatchJson),
    model: e.model,
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
    customInstructions: r.customInstructions,
    detectedRole: r.detectedRole,
    callSummary: r.callSummary,
    autoImported: r.autoImported,
    job: r.job ? { id: r.job.id, title: r.job.title } : null,
    status: r.status as RecordingStatus,
    trashedAt: r.trashedAt ? r.trashedAt.toISOString() : null,
    shortlistedAt: r.shortlistedAt ? r.shortlistedAt.toISOString() : null,
    phoneNumber: r.phoneNumber,
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
