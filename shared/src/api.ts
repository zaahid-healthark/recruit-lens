/**
 * REST API DTOs (camelCase, dates as ISO strings) shared by server and mobile.
 */

import type { JdRequirementVerdict } from "./evaluation";

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
  fitScore: number;
  verdictSummary: string;
  requirements: JdRequirementDto[];
}

export interface EvaluationCategoryDto {
  name: string;
  score: number;
  summary: string;
  evidence: string;
  recommendation: string;
}

/** Compact evaluation info embedded in list rows. */
export interface EvaluationSummaryDto {
  overallScore: number;
  roleDesignation: string;
  department: string;
  subCategory: string;
  recommendation: string;
  classificationConfidence: string;
}

export interface EvaluationDto extends EvaluationSummaryDto {
  classificationRationale: string;
  overallSummary: string;
  categories: EvaluationCategoryDto[];
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
  categoryAverages: { name: string; average: number }[];
  byDepartment: { name: string; count: number }[];
  bySubCategory: { name: string; department: string; count: number }[];
  byRole: { name: string; count: number }[];
  /** Candidate volume + mean score per job, for cross-candidate comparison. */
  byJob: { id: string; title: string; count: number; averageOverallScore: number | null }[];
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
