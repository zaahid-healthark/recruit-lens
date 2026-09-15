/**
 * REST API DTOs (camelCase, dates as ISO strings) shared by server and mobile.
 */

import type { JdRequirementVerdict, TechnicalAnswerVerdict } from "./evaluation";

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

/** One technical question the recruiter asked, and how the candidate answered. */
export interface TechnicalQuestionDto {
  question: string;
  answerSummary: string;
  verdict: TechnicalAnswerVerdict;
  score: number;
  evidence: string;
}

/**
 * Technical Q&A block; null when the recruiter asked no technical questions.
 * When present it is the primary evidence behind the Technical Knowledge score.
 */
export interface TechnicalAssessmentDto {
  questions: TechnicalQuestionDto[];
  score: number;
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
}

export interface EvaluationDto extends EvaluationSummaryDto {
  classificationRationale: string;
  overallSummary: string;
  /** What the interview did and did not cover — the caveat on every score. */
  coverageNote: string | null;
  categories: EvaluationCategoryDto[];
  /** null when the recruiter asked no technical questions. */
  technicalAssessment: TechnicalAssessmentDto | null;
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
  /** The job this candidate is being screened for, if any. */
  job: JobRefDto | null;
  /** Role the screening gate heard discussed; null unless auto-imported. */
  detectedRole: string | null;
  /** 1-2 sentence gist, so a row reads without opening the transcript. */
  callSummary: string | null;
  /** True when the app sent this without a human confirming it first. */
  autoImported: boolean;
  status: RecordingStatus;
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

/** Structured error body returned by the API on any failure. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
