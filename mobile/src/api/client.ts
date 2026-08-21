import type {
  BulkStatusDto,
  DashboardStatsDto,
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
    public readonly status?: number
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
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* body was not JSON */
    }
    throw new ApiRequestError(message, response.status);
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
    notes?: string
  ): Promise<RecordingListItemDto> => {
    const form = new FormData();
    // React Native FormData accepts { uri, name, type } file descriptors.
    form.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    if (candidateName) form.append("candidateName", candidateName);
    if (notes) form.append("notes", notes);
    // Don't set Content-Type manually — fetch adds the multipart boundary itself.
    return request<RecordingListItemDto>("/recordings", { method: "POST", body: form }, 120000);
  },
};
