/**
 * REST API DTOs (camelCase, dates as ISO strings) shared by server and mobile.
 */

export const RECORDING_STATUSES = [
  "UNEVALUATED",
  "TRANSCRIBING",
  "SCORING",
  "EVALUATED",
  "FAILED",
] as const;

export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

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
