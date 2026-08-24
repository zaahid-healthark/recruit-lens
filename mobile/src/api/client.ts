import type {
  BulkStatusDto,
  DashboardStatsDto,
  JobDto,
  RecordingDetailDto,
  RecordingListItemDto,
  TaxonomyDto,
} from "@interview-evaluator/shared";
import { API_BASE_URL, API_KEY } from "../config";

/**
 * REST client for the Interview Evaluator backend.
 *
 * NOTE: only `import type` is used from the shared package — types are erased
 * at bundle time, so Metro never needs to resolve the workspace package at
 * runtime. Keep it that way (runtime imports work too via metro.config.js,
 * but type-only is bulletproof).
 */

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /** Machine-readable code from the API body, for branching on a specific failure. */
    public readonly code?: string
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/**
 * Default timeout is generous on purpose: free hosting tiers (Render, Fly, …)
 * suspend idle instances, and the first request after a sleep pays a cold-start
 * cost that routinely runs 30-60s. A tighter timeout just turns a slow wake-up
 * into a spurious "server unreachable" error.
 */
const DEFAULT_TIMEOUT_MS = 60000;

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { "x-api-key": API_KEY, ...((init.headers as Record<string, string>) ?? {}) },
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      throw new ApiRequestError(
        "Request timed out. If the backend is on a free hosting plan it may be waking up from sleep — try again in a few seconds."
      );
    }
    throw new ApiRequestError(
      `Cannot reach the server at ${API_BASE_URL}. Check the URL and that the phone has network access (for a server on your PC: LAN IP, same Wi-Fi, firewall open).`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let message = `Request failed (HTTP ${response.status})`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: { message?: string; code?: string } };
      if (body?.error?.message) message = body.error.message;
      code = body?.error?.code;
    } catch {
      /* body was not JSON */
    }
    throw new ApiRequestError(message, response.status, code);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface UploadFileInput {
  uri: string;
  name: string;
  mimeType: string;
}

export const api = {
  listRecordings: (): Promise<RecordingListItemDto[]> =>
    request<RecordingListItemDto[]>("/recordings"),

  getRecording: (id: string): Promise<RecordingDetailDto> =>
    request<RecordingDetailDto>(`/recordings/${id}`),

  evaluateRecording: (id: string): Promise<{ id: string; message: string }> =>
    request(`/recordings/${id}/evaluate`, { method: "POST" }),

  deleteRecording: (id: string): Promise<void> =>
    request<void>(`/recordings/${id}`, { method: "DELETE" }),

  startBulkEvaluation: (): Promise<BulkStatusDto> =>
    request<BulkStatusDto>("/evaluate/bulk", { method: "POST" }),

  getBulkStatus: (): Promise<BulkStatusDto> => request<BulkStatusDto>("/evaluate/bulk/status"),

  getDashboardStats: (): Promise<DashboardStatsDto> =>
    request<DashboardStatsDto>("/dashboard/stats"),

  getTaxonomy: (): Promise<TaxonomyDto> => request<TaxonomyDto>("/taxonomy"),

  uploadRecording: (
    file: UploadFileInput,
    candidateName?: string,
    notes?: string,
    // Long interview recordings on mobile data need more than the default;
    // the auto-import scanner passes a larger value.
    timeoutMs = 120000,
    jobId?: string | null
  ): Promise<RecordingListItemDto> => {
    const form = new FormData();
    // React Native FormData accepts { uri, name, type } file descriptors.
    form.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    if (candidateName) form.append("candidateName", candidateName);
    if (notes) form.append("notes", notes);
    if (jobId) form.append("jobId", jobId);
    // Don't set Content-Type manually — fetch adds the multipart boundary itself.
    return request<RecordingListItemDto>("/recordings", { method: "POST", body: form }, timeoutMs);
  },

  /**
   * Partial update. Only the keys present are changed, so renaming cannot
   * clear the job link; pass an explicit null to clear a nullable field.
   */
  updateRecording: (
    id: string,
    patch: {
      jobId?: string | null;
      candidateName?: string | null;
      notes?: string | null;
      originalFilename?: string;
    }
  ): Promise<RecordingDetailDto> =>
    request<RecordingDetailDto>(`/recordings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),

  /** Attach (or detach, with null) the job this recording is screened against. */
  setRecordingJob: (id: string, jobId: string | null): Promise<RecordingDetailDto> =>
    api.updateRecording(id, { jobId }),

  /**
   * Playable source for the stored audio, for expo-audio.
   *
   * The key travels as a header rather than a query parameter: query strings
   * end up in server logs and caches, and expo-audio can set headers on a
   * remote source, so there is no reason to leak it into the URL.
   */
  recordingAudioSource: (id: string): { uri: string; headers: Record<string, string> } => ({
    uri: `${API_BASE_URL}/recordings/${id}/audio`,
    headers: { "x-api-key": API_KEY },
  }),

  listJobs: (includeArchived = false): Promise<JobDto[]> =>
    request<JobDto[]>(`/jobs${includeArchived ? "?includeArchived=true" : ""}`),

  createJob: (input: {
    title: string;
    jdText: string;
    department?: string | null;
    subCategory?: string | null;
  }): Promise<JobDto> =>
    request<JobDto>("/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),

  updateJob: (
    id: string,
    input: {
      title?: string;
      jdText?: string;
      department?: string | null;
      subCategory?: string | null;
      archived?: boolean;
    }
  ): Promise<JobDto> =>
    request<JobDto>(`/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),

  deleteJob: (id: string): Promise<void> =>
    request<void>(`/jobs/${id}`, { method: "DELETE" }),
};
