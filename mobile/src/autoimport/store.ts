import * as FileSystem from "expo-file-system/legacy";

/**
 * Persistent state for the auto-import watcher, stored as a JSON file in the
 * app's private document directory (no extra native module needed — the SAF
 * folder grant itself is persisted by Android across app restarts).
 */

/** A call started from the Dialer tab, waiting for its recording to appear. */
export interface PendingCall {
  id: string;
  candidateName: string;
  phoneNumber: string;
  /** Normalized digits of phoneNumber, used to match recorder filenames. */
  digits: string;
  startedAt: string; // ISO
  /** Job chosen when dialling; its JD drives scoring once uploaded. */
  jobId: string | null;
  /** Denormalised for display — the job may be renamed or deleted later. */
  jobTitle: string | null;
}

/** Why a file in the watched folder was not uploaded. */
export const SKIP_REASONS = ["unmatched", "too_short", "no_audio", "not_relevant"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/**
 * A file the scanner deliberately did NOT upload, kept so the user can see
 * what was held back and override it. This is the "log" of skipped calls:
 * nothing reaches the server, but nothing disappears silently either.
 */
export interface SkippedFile {
  name: string;
  reason: SkipReason;
  /** null when the probe could not read it. */
  durationSeconds: number | null;
  sizeBytes: number;
  seenAt: string; // ISO
  /**
   * A GUESS at which pending call this belongs to, from timing alone — the
   * dialled number was not in the filename. Never auto-uploaded on this basis:
   * a personal call taken after dialling a candidate would look identical.
   * It only pre-fills the confirmation, so the user decides.
   */
  suggestedCallId: string | null;
  suggestedCandidateName: string | null;
  suggestedJobId: string | null;
  /** Server's explanation when it judged the call unrelated to recruitment. */
  serverReason: string | null;
}

/**
 * Size sighting used by the settling check: a call recorder writes its file
 * for the whole duration of the call, so a file is only uploaded once its
 * size has stopped changing (see scanner.ts).
 */
export interface FileProbe {
  size: number;
  seenAt: string; // ISO
}

export interface AutoImportState {
  /** SAF tree URI granted by the user (null until a folder is chosen). */
  folderUri: string | null;
  folderLabel: string | null;
  enabled: boolean;
  /**
   * Also rename the file inside the recorder's folder to "<Candidate> <date>"
   * after a successful upload. Emulated (SAF has no rename) — see scanner.ts.
   */
  renameOnDisk: boolean;
  /** SAF document URIs already uploaded (or baselined as pre-existing). */
  importedUris: Record<string, true>;
  /** Last seen size per URI — the settling check's memory across scans. */
  probes: Record<string, FileProbe>;
  /** Files the server permanently rejected (4xx) — retried by the daily sweep. */
  rejected: Record<string, string>;
  pendingCalls: PendingCall[];
  /** Files held back from upload, keyed by SAF document URI. */
  skipped: Record<string, SkippedFile>;
  /**
   * Recordings shorter than this are treated as hang-ups, not interviews, and
   * are never uploaded. 0 disables the check.
   */
  minDurationSeconds: number;
  /**
   * Send every settled recording long enough to be an interview, without
   * waiting for it to match a call dialled from the app. Recruiters dial from
   * the phone's own dialer, so nothing would ever match otherwise; the server
   * screens each one and rejects calls unrelated to recruitment.
   */
  autoSendAll: boolean;
  /**
   * Treat a file the user has renamed (so it no longer looks like raw recorder
   * output) as approved, and upload it without waiting to be asked.
   */
  autoSendRenamed: boolean;
  /** Local hour/minute of the daily "upload everything" sweep. */
  dailySweepHour: number;
  dailySweepMinute: number;
  /** YYYY-MM-DD of the last completed daily sweep (null = never). */
  lastSweepDay: string | null;
  lastScanAt: string | null;
  lastScanSummary: string | null;
  totalImported: number;
}

export const DEFAULT_STATE: AutoImportState = {
  folderUri: null,
  folderLabel: null,
  enabled: false,
  renameOnDisk: true,
  importedUris: {},
  probes: {},
  rejected: {},
  pendingCalls: [],
  skipped: {},
  minDurationSeconds: 90,
  autoSendAll: true,
  autoSendRenamed: true,
  dailySweepHour: 17, // 5 PM
  dailySweepMinute: 0,
  lastSweepDay: null,
  lastScanAt: null,
  lastScanSummary: null,
  totalImported: 0,
};

const STATE_FILE = `${FileSystem.documentDirectory ?? ""}auto-import.json`;

/** Pending calls expire after 24h so a stale one can never hijack a match. */
const PENDING_CALL_TTL_MS = 24 * 60 * 60 * 1000;

export function prunePendingCalls(calls: PendingCall[]): PendingCall[] {
  const now = Date.now();
  return calls.filter((c) => {
    const started = Date.parse(c.startedAt);
    return Number.isFinite(started) && now - started < PENDING_CALL_TTL_MS;
  });
}

/** Local calendar day key ("2026-08-20") used to run the sweep once per day. */
export function dayKey(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/**
 * Is the daily sweep due? True once per calendar day, from the configured
 * time onwards — so a phone that was closed at 5 PM sweeps as soon as the
 * app is opened later that day (catch-up), never twice.
 */
export function isSweepDue(state: AutoImportState, now: Date): boolean {
  if (!state.enabled || !state.folderUri) return false;
  if (state.lastSweepDay === dayKey(now)) return false;
  const due = new Date(now);
  due.setHours(state.dailySweepHour, state.dailySweepMinute, 0, 0);
  return now.getTime() >= due.getTime();
}

/** "5:00 PM" for the UI. */
export function formatSweepTime(hour: number, minute: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** Clamp to a sane range so a hand-edited state file cannot skip everything. */
function sanitizeMinDuration(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 600
    ? Math.round(value)
    : fallback;
}

function sanitizeHour(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23
    ? value
    : fallback;
}

function sanitizeMinute(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 59
    ? value
    : fallback;
}

export async function loadState(): Promise<AutoImportState> {
  try {
    const info = await FileSystem.getInfoAsync(STATE_FILE);
    if (!info.exists) return { ...DEFAULT_STATE };
    const raw = await FileSystem.readAsStringAsync(STATE_FILE);
    const parsed = JSON.parse(raw) as Partial<AutoImportState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      importedUris: parsed.importedUris ?? {},
      probes: parsed.probes ?? {},
      rejected: parsed.rejected ?? {},
      pendingCalls: prunePendingCalls(parsed.pendingCalls ?? []),
      skipped: parsed.skipped ?? {},
      minDurationSeconds: sanitizeMinDuration(
        parsed.minDurationSeconds,
        DEFAULT_STATE.minDurationSeconds
      ),
      // Guard against a hand-edited / older state file putting the sweep
      // schedule out of range (setHours would silently roll over).
      dailySweepHour: sanitizeHour(parsed.dailySweepHour, DEFAULT_STATE.dailySweepHour),
      dailySweepMinute: sanitizeMinute(parsed.dailySweepMinute, DEFAULT_STATE.dailySweepMinute),
    };
  } catch {
    // Corrupt/unreadable state file — start fresh rather than crash the app.
    return { ...DEFAULT_STATE };
  }
}

export async function saveState(state: AutoImportState): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(STATE_FILE, JSON.stringify(state));
  } catch {
    /* persistence is best-effort; next successful save catches up */
  }
}
