/**
 * REST API DTOs (camelCase, dates as ISO strings) shared by server and mobile.
 */

import type { AnswerVerdict, JdRequirementVerdict, QuestionKind } from "./evaluation";

export const RECORDING_STATUSES = [
  "UNEVALUATED",
  "TRANSCRIBING",
  "SCORING",
  "EVALUATED",
  "FAILED",
] as const;

export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

/**
 * A job opening with its description. Recordings link to one so the AI can
 * score the candidate against real requirements instead of a generic prior.
 */
export interface JobDto {
  id: string;
  title: string;
  jdText: string;
  department: string | null;
  subCategory: string | null;
  /** Hidden from the import picker without deleting it or its history. */
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /** Recordings linked to this job (all statuses). */
  recordingCount: number;
  /** Mean overall score of this job's EVALUATED recordings; null if none yet. */
  averageOverallScore: number | null;
}

/** Compact job reference embedded in recording rows. */
export interface JobRefDto {
  id: string;
  title: string;
}

export interface JdRequirementDto {
  requirement: string;
  verdict: JdRequirementVerdict;
  evidence: string;
}

/** JD-match block; null when the recording was evaluated without a job. */
export interface JdMatchDto {
  /** Null when the interview probed none of the requirements. */
  fitScore: number | null;
  verdictSummary: string;
  requirements: JdRequirementDto[];
}

export interface EvaluationCategoryDto {
  name: string;
  /** Null means the interview never tested this — NOT a low score. */
  score: number | null;
  summary: string;
  evidence: string;
  recommendation: string;
}

/** One question the recruiter asked, and how the candidate answered it. */
export interface QuestionResultDto {
  question: string;
  kind: QuestionKind;
  answerSummary: string;
  verdict: AnswerVerdict;
  score: number;
  evidence: string;
}

/**
 * Per-question grading; null when the recruiter asked nothing substantive.
 * When present it is the primary evidence behind the matrix scores.
 */
export interface QuestionAssessmentDto {
  questions: QuestionResultDto[];
  /** Null when no question of that kind was asked. */
  technicalScore: number | null;
  behaviouralScore: number | null;
  summary: string;
}

/** Compact evaluation info embedded in list rows. */
export interface EvaluationSummaryDto {
  /** Null when the call covered too little to score the candidate at all. */
  overallScore: number | null;
  roleDesignation: string;
  department: string;
  subCategory: string;
  recommendation: string;
  classificationConfidence: string;
  /** When this evaluation was produced — distinct from when the file was uploaded. */
  createdAt: string;
}

export interface EvaluationDto extends EvaluationSummaryDto {
  classificationRationale: string;
  overallSummary: string;
  /** What the interview did and did not cover — the caveat on every score. */
  coverageNote: string | null;
  categories: EvaluationCategoryDto[];
  /** null when the recruiter asked no substantive questions. */
  questionAssessment: QuestionAssessmentDto | null;
  strengths: string[];
  areasForImprovement: string[];
  /** null when this evaluation ran without a job attached. */
  jdMatch: JdMatchDto | null;
  model: string;
  createdAt: string;
}

export interface TranscriptDto {
  text: string;
  model: string;
  language: string | null;
  createdAt: string;
}

export interface RecordingListItemDto {
  id: string;
  originalFilename: string;
  mimeType: string;
  durationSeconds: number | null;
  importedAt: string;
  candidateName: string | null;
  notes: string | null;
  /**
   * Free-text steer the recruiter attached for this evaluation. Directs what
   * the scorer weighs; it cannot relax the evidence rules.
   */
  customInstructions: string | null;
  /** The job this candidate is being screened for, if any. */
  job: JobRefDto | null;
  /** Role the screening gate heard discussed; null unless auto-imported. */
  detectedRole: string | null;
  /** 1-2 sentence gist, so a row reads without opening the transcript. */
  callSummary: string | null;
  /** True when the app sent this without a human confirming it first. */
  autoImported: boolean;
  status: RecordingStatus;
  /**
   * Soft-deleted at this time, or null. Trashed recordings keep their
   * transcript and scores and stay restorable; they drop out of the library,
   * the ranking and the dashboard.
   */
  trashedAt: string | null;
  /**
   * Marked by a person as worth a next round, or null. Never set by the
   * model — the report advises, the recruiter decides.
   */
  shortlistedAt: string | null;
  /** Contact number, entered by a person. */
  phoneNumber: string | null;
  errorMessage: string | null;
  evaluationSummary: EvaluationSummaryDto | null;
}

export interface RecordingDetailDto extends RecordingListItemDto {
  transcript: TranscriptDto | null;
  evaluation: EvaluationDto | null;
}

export interface BulkStatusDto {
  running: boolean;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  currentRecordingId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DashboardStatsDto {
  totals: {
    recordings: number;
    evaluated: number;
    unevaluated: number;
    inProgress: number;
    failed: number;
  };
  averageOverallScore: number | null;
  /** `average` is null for a category no interview has actually tested yet. */
  categoryAverages: { name: string; average: number | null }[];
  byDepartment: { name: string; count: number }[];
  bySubCategory: { name: string; department: string; count: number }[];
  byRole: { name: string; count: number }[];
  /** Candidate volume + mean score per job, for cross-candidate comparison. */
  byJob: { id: string; title: string; count: number; averageOverallScore: number | null }[];
  /**
   * Interviews imported per day, oldest first, covering a fixed recent window
   * with zero-filled gaps — a quiet day is a data point, not a missing one.
   */
  byDay: { date: string; count: number }[];
  scoreHistogram: { band: string; count: number }[];
}

/**
 * Cross-candidate ranking for one job.
 *
 * Computed from stored evidence, never by asking a model to pick a winner: a
 * hiring decision has to be auditable, and "ranked 2nd because they met four
 * of eight requirements to the other candidate's seven" survives being
 * questioned in a way that generated prose does not.
 */
export const CANDIDATE_DECISIONS = [
  /** Worth a video interview: handled the technical questions they were asked. */
  "advance",
  /** Some of the basics landed and some did not — genuinely on the line. */
  "borderline",
  /**
   * The transcript positively shows they fall short of the basics: wrong
   * answers, or unable to explain their own work. Never "did not go deep" —
   * a 15-20 minute call has no room for depth and is not evidence of its
   * absence.
   */
  "reject",
  /**
   * The interview never established enough to judge. NOT a rejection, and
   * deliberately unranked — a thin interview must never read as a weak
   * candidate.
   */
  "insufficient_evidence",
] as const;

export type CandidateDecision = (typeof CANDIDATE_DECISIONS)[number];

export interface RankedCandidateDto {
  recordingId: string;
  candidateName: string | null;
  originalFilename: string;
  /** 1-based position. Null for candidates set aside as unrankable. */
  rank: number | null;
  decision: CandidateDecision;
  /**
   * The number the ranking actually sorted on — the technical answers when the
   * recruiter asked any, because that is what this gate is deciding on.
   */
  decidingScore: number | null;
  overallScore: number | null;
  fitScore: number | null;
  technicalScore: number | null;
  behaviouralScore: number | null;
  requirementCounts: { met: number; partial: number; missing: number; notDiscussed: number };
  questionsAsked: number;
  /** Technical questions asked, and how many drew an adequate-or-better answer. */
  technicalAsked: number;
  technicalAnswered: number;
  categoriesScored: number;
  /** Why this candidate sits here — each line names the evidence behind it. */
  reasons: string[];
  /** Why they placed above the next candidate. Null for the last ranked. */
  aheadOfNext: string | null;
}

export interface JobRankingDto {
  job: JobRefDto;
  /** False when the job has no usable JD, so ranking falls back to overall score. */
  hasJd: boolean;
  /** Ordered best first. */
  ranked: RankedCandidateDto[];
  /** Unrankable — thin interviews and unevaluated recordings, never rejections. */
  setAside: RankedCandidateDto[];
  /** Caveats about comparing these particular candidates at all. */
  comparabilityNotes: string[];
  generatedAt: string;
}

/**
 * A saved, reusable scoring steer. A template only: applying one fills the
 * instructions box, and the recording keeps its own copy of whatever text was
 * actually used, so deleting a preset never rewrites past evaluations.
 */
export interface InstructionPresetDto {
  id: string;
  label: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * What one evaluation cost, read back from the tracing backend.
 *
 * Costs live in Langfuse because that is where token usage is priced. These
 * types exist so the figures can be shown next to the candidates they belong
 * to, rather than leaving someone to match traces to reports by timestamp.
 */
export interface EvaluationCostDto {
  traceId: string;
  /** The recording this priced — the exact join back to a report. */
  recordingId: string | null;
  candidateName: string | null;
  jobTitle: string | null;
  /** Length of the audio, which is what drives the transcription half. */
  audioMinutes: number | null;
  /** USD. Zero can mean genuinely free OR that the backend lacks a price. */
  cost: number;
  /** Wall-clock seconds for the whole evaluation. */
  latencySeconds: number | null;
  at: string;
  /** Deep link to the full trace, for when the summary is not enough. */
  traceUrl: string | null;
}

/** Cost aggregated by stage — transcription against scoring against repairs. */
export interface CostStageDto {
  name: string;
  cost: number;
  calls: number;
  /**
   * True when this stage ran but nothing could be priced. Distinct from a
   * genuine zero: "we cannot see what transcription costs" and "transcription
   * is free" are opposite conclusions from the same number.
   */
  unpriced?: boolean;
  /**
   * Tokens the tracing backend recorded for this stage. Shown because they
   * separate the two reasons a stage prices at zero: no rate for the model
   * (tokens present, cost derivable) versus no usage reported at all.
   */
  inputTokens?: number;
  outputTokens?: number;
  /** True when this app priced the stage from tokens because Langfuse had no rate. */
  derived?: boolean;
}

export interface CostsDto {
  /** False when no Langfuse keys are set; the UI explains how to turn it on. */
  configured: boolean;
  /** Present when tracing is on but could not be read. */
  error?: string;
  calls: EvaluationCostDto[];
  totalCost: number;
  /** Null when nothing priced above zero — an average of zeroes misleads. */
  averageCost: number | null;
  byStage: CostStageDto[];
  currency: string;
  /**
   * True when calls were traced but every one priced at zero, which almost
   * always means the tracing backend has no rate for these models rather than
   * that the calls were free.
   */
  missingPricing?: boolean;
}

/** Structured error body returned by the API on any failure. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
