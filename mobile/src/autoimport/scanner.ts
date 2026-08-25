import * as FileSystem from "expo-file-system/legacy";
import { api, ApiRequestError } from "../api/client";
import {
  buildCandidateFilename,
  extensionOf,
  fileNameFromSafUri,
  filenameMatchesNumber,
  isAudioFilename,
  mimeFromExtension,
  timestampFromFilename,
} from "./naming";
import { probeDurationSeconds } from "./duration";
import { AutoImportState, FileProbe, PendingCall, SkippedFile } from "./store";

/**
 * One pass of the watched-folder scanner:
 *   list folder → keep audio files that have finished being written →
 *   decide whether each one is a real interview → upload → rename on disk.
 *
 * ONLY recordings matching a pending call (i.e. dialled from the Dialer tab)
 * are uploaded. A call recorder captures every call including personal ones,
 * and those must never reach the server. Files held back are recorded in
 * state.skipped with a reason so the user can see and override them — held
 * back is not the same as thrown away.
 *
 * A matched file is uploaded as "<Candidate> <date>.<ext>" with candidateName
 * and the dialled job's JD attached. Transient upload failures are NOT
 * recorded, so they retry on the next scan.
 */

export interface ScanOutcome {
  ok: boolean;
  /** Files uploaded this pass. */
  imported: number;
  /** How many of those were matched to a pending Dialer call. */
  matchedCalls: number;
  /** Files skipped because they are still being written (call in progress). */
  settling: number;
  /** Files held back this pass because no pending call matched them. */
  unmatched: number;
  /** Files held back this pass for being shorter than the minimum. */
  tooShort: number;
  /** Files the server decoded and found silent. */
  noAudio: number;
  /** Files renamed inside the recorder's folder. */
  renamed: number;
  discovered: number;
  error: string | null;
}

/**
 * A file whose size has not changed for this long is treated as finished.
 * Call recorders write continuously for the whole call (15-30+ min), so this
 * is what stops a partial recording from being uploaded mid-call.
 */
export const SETTLE_MS = 25_000;

/** Time-based matching only trusts pending calls younger than this. */
const CALL_MATCH_WINDOW_MS = 12 * 60 * 60 * 1000;
/** Allow small clock skew between "Call" tap and the recorder's file stamp. */
const CLOCK_SKEW_MS = 2 * 60 * 1000;

/**
 * Cap for the on-disk rename. SAF has no rename operation, so it is emulated
 * by copying the bytes through JS as base64 — fine for the compact formats
 * call recorders use (30 min of AMR is ~2 MB), but a large file would risk an
 * out-of-memory crash, so those keep their original name instead.
 */
const MAX_RENAME_BYTES = 16 * 1024 * 1024;

/** Uploading a long interview over mobile data needs more than the default. */
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** SAF document URIs of all audio files currently in the folder. */
export async function listAudioFiles(folderUri: string): Promise<string[]> {
  const entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(folderUri);
  return entries.filter((uri) => isAudioFilename(fileNameFromSafUri(uri)));
}

/** Current byte size of a SAF document, or null when it cannot be read. */
async function sizeOf(uri: string): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && typeof info.size === "number" ? info.size : null;
  } catch {
    return null;
  }
}

/** Best-effort recording time: filename stamp, else the matched call, else now. */
function recordedAtFor(filename: string, call: PendingCall | null): Date {
  const fromName = timestampFromFilename(filename);
  if (fromName) return fromName;
  if (call) {
    const started = Date.parse(call.startedAt);
    if (Number.isFinite(started)) return new Date(started);
  }
  return new Date();
}

/**
 * Confident match: the recorder embedded the dialled number in the filename.
 *
 * This is the ONLY basis on which a recording is uploaded automatically.
 * Timing is deliberately not accepted as proof — see suggestPendingCall.
 */
function matchPendingCall(filename: string, calls: PendingCall[]): PendingCall | null {
  return calls.find((c) => filenameMatchesNumber(filename, c.digits)) ?? null;
}

/**
 * Best guess at which pending call an unmatched recording belongs to, from
 * timing alone.
 *
 * This is NOT proof of anything. A recruiter who dials a candidate, gets no
 * recording, and later takes a personal call would produce a file that fits
 * this test perfectly — so acting on it would upload a private call to the
 * server. It exists only to pre-fill the confirmation the user is shown; the
 * decision to upload stays with them.
 */
function suggestPendingCall(calls: PendingCall[], recordedAt: Date | null): PendingCall | null {
  const live = calls.filter((c) => Date.now() - Date.parse(c.startedAt) < CALL_MATCH_WINDOW_MS);
  if (
    live.length === 1 &&
    recordedAt !== null &&
    recordedAt.getTime() >= Date.parse(live[0].startedAt) - CLOCK_SKEW_MS
  ) {
    return live[0];
  }
  return null;
}

/**
 * A 4xx (other than timeout/rate-limit) means this file will never be
 * accepted — record it and move on instead of blocking every later file.
 * Anything else (network error, 5xx) means "try again later".
 */
function isPermanentRejection(err: unknown): boolean {
  const status = err instanceof ApiRequestError ? err.status : undefined;
  return (
    typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429
  );
}

/**
 * Rename a document inside the watched folder. SAF exposes no rename, so this
 * creates a new document with the target name, copies the bytes, verifies the
 * copy, and only then deletes the original. Returns the new URI, or null when
 * the rename was skipped/failed (in which case the original is untouched).
 */
async function renameInFolder(
  folderUri: string,
  fileUri: string,
  currentName: string,
  newName: string,
  size: number
): Promise<string | null> {
  if (newName === currentName) return null;
  if (size <= 0 || size > MAX_RENAME_BYTES) return null;

  let newUri: string | null = null;
  try {
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    newUri = await FileSystem.StorageAccessFramework.createFileAsync(
      folderUri,
      newName,
      mimeFromExtension(extensionOf(newName))
    );
    await FileSystem.writeAsStringAsync(newUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    // Never delete the original until the copy is provably complete.
    const written = await sizeOf(newUri);
    if (written !== size) throw new Error(`copy size mismatch (${written} vs ${size})`);
    await FileSystem.StorageAccessFramework.deleteAsync(fileUri);
    return newUri;
  } catch {
    if (newUri) {
      // Roll back the half-written copy so the folder is left clean.
      await FileSystem.StorageAccessFramework.deleteAsync(newUri).catch(() => undefined);
    }
    return null;
  }
}

export async function runScan(
  state: AutoImportState
): Promise<{ state: AutoImportState; outcome: ScanOutcome }> {
  const outcome: ScanOutcome = {
    ok: true,
    imported: 0,
    matchedCalls: 0,
    settling: 0,
    unmatched: 0,
    tooShort: 0,
    noAudio: 0,
    renamed: 0,
    discovered: 0,
    error: null,
  };
  const folderUri = state.folderUri;
  if (!folderUri) {
    return { state, outcome: { ...outcome, ok: false, error: "No folder selected." } };
  }

  let audioUris: string[];
  try {
    audioUris = await listAudioFiles(folderUri);
  } catch {
    return {
      state: {
        ...state,
        lastScanAt: new Date().toISOString(),
        lastScanSummary: "Folder unreadable",
      },
      outcome: {
        ...outcome,
        ok: false,
        error:
          "The watched folder could not be read — access may have been revoked. Choose it again.",
      },
    };
  }

  const next: AutoImportState = {
    ...state,
    importedUris: { ...state.importedUris },
    probes: { ...state.probes },
    rejected: { ...state.rejected },
    skipped: { ...state.skipped },
    pendingCalls: [...state.pendingCalls],
  };

  // Forget bookkeeping for files that no longer exist (keeps the state small).
  const present = new Set(audioUris);
  for (const map of [next.importedUris, next.probes, next.rejected, next.skipped] as Record<
    string,
    unknown
  >[]) {
    for (const key of Object.keys(map)) {
      if (!present.has(key)) delete map[key];
    }
  }

  const fresh = audioUris
    // Skipped files stay skipped until the user acts on them, otherwise every
    // scan would re-probe the same personal calls forever.
    .filter((uri) => !next.importedUris[uri] && !next.rejected[uri] && !next.skipped[uri])
    .map((uri) => ({ uri, name: fileNameFromSafUri(uri) }))
    // Recorder filenames embed timestamps, so lexicographic ≈ chronological.
    .sort((a, b) => a.name.localeCompare(b.name));
  outcome.discovered = fresh.length;

  const nowMs = Date.now();
  for (const file of fresh) {
    // ── Settling check: never upload a file that is still being written ──
    const size = await sizeOf(file.uri);
    if (size === null || size === 0) {
      outcome.settling += 1;
      next.probes[file.uri] = { size: size ?? 0, seenAt: new Date(nowMs).toISOString() };
      continue;
    }
    const probe: FileProbe | undefined = next.probes[file.uri];
    const seenAt = probe ? Date.parse(probe.seenAt) : NaN;
    const stable =
      probe !== undefined &&
      probe.size === size &&
      Number.isFinite(seenAt) &&
      nowMs - seenAt >= SETTLE_MS;
    if (!stable) {
      // Size changed (or first sighting) — re-arm the timer and check again next scan.
      if (!probe || probe.size !== size) {
        next.probes[file.uri] = { size, seenAt: new Date(nowMs).toISOString() };
      }
      outcome.settling += 1;
      continue;
    }

    // ── Decide whether this is an interview at all ──
    const recordedAt = recordedAtFor(file.name, null);
    // Only a number match authorises an upload. Timing alone is a suggestion.
    const match = matchPendingCall(file.name, next.pendingCalls);
    const suggestion = match ? null : suggestPendingCall(next.pendingCalls, recordedAt);

    // Probed once per file and remembered on the skip entry, so the list can
    // show a duration and a re-scan never re-probes the same file.
    const durationSeconds = await probeDurationSeconds(file.uri);
    const skip = (reason: SkippedFile["reason"]): void => {
      next.skipped[file.uri] = {
        name: file.name,
        reason,
        durationSeconds,
        sizeBytes: size,
        seenAt: new Date(nowMs).toISOString(),
        suggestedCallId: suggestion?.id ?? null,
        suggestedCandidateName: suggestion?.candidateName ?? null,
        suggestedJobId: suggestion?.jobId ?? null,
      };
      delete next.probes[file.uri];
    };

    // A call recorder records every call, including personal ones. Nothing is
    // uploaded unless the dialled number is in the filename — a recording that
    // merely happened after a call was dialled is not evidence it IS that call.
    if (!match) {
      skip("unmatched");
      outcome.unmatched += 1;
      continue;
    }
    // A hang-up is not an interview. A null duration means "could not read",
    // never "zero" — those are uploaded rather than silently discarded.
    if (
      next.minDurationSeconds > 0 &&
      durationSeconds !== null &&
      durationSeconds < next.minDurationSeconds
    ) {
      skip("too_short");
      outcome.tooShort += 1;
      continue;
    }

    // ── Upload ──
    const when = recordedAtFor(file.name, match);
    const ext = extensionOf(file.name);
    const uploadName = buildCandidateFilename(match.candidateName, when, ext);
    const notes = `Auto-imported from watched folder • Called ${match.phoneNumber} • Original file: ${file.name}`;

    try {
      await api.uploadRecording(
        { uri: file.uri, name: uploadName, mimeType: mimeFromExtension(ext) },
        match.candidateName,
        notes,
        UPLOAD_TIMEOUT_MS,
        match.jobId
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The server decoded the file and found no sound in it. That is a
      // verdict about the recording, not a transport failure, so it belongs
      // in the visible skip list rather than the silent rejected ledger.
      if (err instanceof ApiRequestError && err.code === "NO_AUDIBLE_CONTENT") {
        skip("no_audio");
        outcome.noAudio += 1;
        continue;
      }
      if (isPermanentRejection(err)) {
        // Unsupported/rejected file — skip it so it can't block the queue.
        next.rejected[file.uri] = message.slice(0, 200);
        continue;
      }
      // Server unreachable / server error — stop and retry everything next scan.
      outcome.ok = false;
      outcome.error = message;
      break;
    }

    // Upload succeeded: the recording is safe on the server before we touch
    // anything on disk.
    next.importedUris[file.uri] = true;
    delete next.probes[file.uri];
    next.totalImported += 1;
    outcome.imported += 1;
    next.pendingCalls = next.pendingCalls.filter((c) => c.id !== match.id);
    outcome.matchedCalls += 1;

    // ── Optional: rename the file in the recorder's folder to match ──
    if (next.renameOnDisk) {
      const renamedUri = await renameInFolder(folderUri, file.uri, file.name, uploadName, size);
      if (renamedUri) {
        delete next.importedUris[file.uri]; // that URI no longer exists
        next.importedUris[renamedUri] = true;
        outcome.renamed += 1;
      }
    }
  }

  next.lastScanAt = new Date().toISOString();
  next.lastScanSummary = summarize(outcome);
  return { state: next, outcome };
}

/**
 * Upload a file the scanner deliberately held back, under a name the user
 * chose after listening to it.
 *
 * This is the escape hatch for every case automatic matching cannot cover: a
 * candidate who rings back from a different number, a call taken the next day,
 * a recorder that wrote a filename with no number in it. Naming the recording
 * IS the act of approving it — the app never infers approval from a filename
 * on its own.
 *
 * `renameLocal` also renames the file inside the recorder's folder, so the
 * recruiter's own folder stops showing an anonymous `phone_...` entry.
 */
export async function importSkippedFile(
  state: AutoImportState,
  uri: string,
  candidateName: string,
  jobId: string | null,
  renameLocal = false
): Promise<AutoImportState> {
  const entry = state.skipped[uri];
  if (!entry) throw new Error("That file is no longer in the skipped list.");

  const ext = extensionOf(entry.name);
  const when = timestampFromFilename(entry.name) ?? new Date(entry.seenAt);
  const trimmed = candidateName.trim();
  const name = trimmed ? buildCandidateFilename(trimmed, when, ext) : entry.name;

  await api.uploadRecording(
    { uri, name, mimeType: mimeFromExtension(ext) },
    trimmed || undefined,
    `Imported manually from the watched folder • Original file: ${entry.name}`,
    UPLOAD_TIMEOUT_MS,
    jobId
  );

  // Only after the upload succeeds is the local file touched, so a failed
  // rename can never cost a recording that was not safely on the server.
  let finalUri = uri;
  if (renameLocal && trimmed && state.folderUri) {
    const renamed = await renameInFolder(
      state.folderUri,
      uri,
      entry.name,
      name,
      entry.sizeBytes
    );
    if (renamed) finalUri = renamed;
  }

  const skipped = { ...state.skipped };
  delete skipped[uri];
  return {
    ...state,
    skipped,
    // Confirming a suggestion resolves that pending call. Left in place it
    // would keep suggesting itself for every later recording.
    pendingCalls: entry.suggestedCallId
      ? state.pendingCalls.filter((c) => c.id !== entry.suggestedCallId)
      : state.pendingCalls,
    // Key on the post-rename URI, or a rescan would see the new name as a new
    // file and hold it back all over again.
    importedUris: { ...state.importedUris, [finalUri]: true },
    totalImported: state.totalImported + 1,
  };
}

/**
 * Delete a held-back file from the recorder's folder for good. Only ever
 * called on explicit user action — the scanner itself never deletes anything.
 */
export async function deleteSkippedFile(
  state: AutoImportState,
  uri: string
): Promise<AutoImportState> {
  await FileSystem.StorageAccessFramework.deleteAsync(uri);
  const skipped = { ...state.skipped };
  delete skipped[uri];
  return { ...state, skipped };
}

function summarize(outcome: ScanOutcome): string {
  const parts: string[] = [];
  if (outcome.imported > 0) {
    parts.push(`imported ${outcome.imported}`);
    if (outcome.matchedCalls > 0) parts.push(`${outcome.matchedCalls} matched to a call`);
    if (outcome.renamed > 0) parts.push(`${outcome.renamed} renamed`);
  }
  if (outcome.settling > 0) parts.push(`${outcome.settling} still recording`);
  if (outcome.unmatched > 0) parts.push(`${outcome.unmatched} not from a dialled call`);
  if (outcome.tooShort > 0) parts.push(`${outcome.tooShort} too short`);
  if (outcome.noAudio > 0) parts.push(`${outcome.noAudio} with no sound`);
  if (outcome.error) parts.push(`failed: ${outcome.error.slice(0, 100)}`);
  return parts.length > 0 ? parts.join(", ") : "no new files";
}
