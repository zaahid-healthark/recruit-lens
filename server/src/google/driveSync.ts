import { MATRIX_CATEGORIES } from "@interview-evaluator/shared";
import type { Evaluation, Recording, Transcript } from "@prisma/client";
import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { log } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { storage } from "../storage";
import { getGoogleClients, isDriveConfigured, noteDriveDisabled } from "./driveClient";

/**
 * Google Drive mirror — keeps a human-browsable copy of everything inside the
 * shared Drive folder (GOOGLE_DRIVE_FOLDER_ID):
 *
 *   <root folder>/
 *   ├── Recordings/        one audio file per recording
 *   ├── Transcripts/       one .txt per transcript
 *   └── Evaluations        Google Sheet — one row per recording, all scores
 *
 * Postgres remains the app's source of truth; this mirror is strictly
 * best-effort: every entry point catches and logs its own errors, so a Drive
 * hiccup can never fail an import or an evaluation.
 */

const SHEET_NAME = "Evaluations";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

const HEADERS = [
  "Recording ID",
  "Imported At",
  "Candidate",
  "Filename",
  "Duration (s)",
  "Status",
  "Role / Designation",
  "Department",
  "Sub-category",
  "Confidence",
  "Overall Score",
  ...MATRIX_CATEGORIES.map((c) => `${c} Score`),
  "Recommendation",
  "Strengths",
  "Areas for Improvement",
  "Overall Summary",
  "Audio (Drive)",
  "Transcript (Drive)",
  "Error",
  "Notes",
] as const;

/** Column letter of the last column (A..Z is enough for our 24 columns). */
const LAST_COL = String.fromCharCode("A".charCodeAt(0) + HEADERS.length - 1);

interface DriveStructure {
  recordingsFolderId: string;
  transcriptsFolderId: string;
  spreadsheetId: string;
}

let structurePromise: Promise<DriveStructure> | null = null;
/** Serializes all sync work — avoids sheet-append races during bulk runs. */
let queue: Promise<unknown> = Promise.resolve();

function escapeQuery(name: string): string {
  return name.replace(/'/g, "\\'");
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function findChild(parentId: string, name: string, mimeType: string): Promise<string | null> {
  const { drive } = getGoogleClients();
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escapeQuery(name)}' and mimeType = '${mimeType}' and trashed = false`,
    fields: "files(id)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0]?.id ?? null;
}

async function ensureChild(parentId: string, name: string, mimeType: string): Promise<string> {
  const existing = await findChild(parentId, name, mimeType);
  if (existing) return existing;
  const { drive } = getGoogleClients();
  const created = await drive.files.create({
    requestBody: { name, mimeType, parents: [parentId] },
    fields: "id",
    supportsAllDrives: true,
  });
  log.info(`Drive mirror: created "${name}" in the shared folder.`);
  return created.data.id as string;
}

async function ensureHeaders(spreadsheetId: string): Promise<void> {
  const { sheets } = getGoogleClients();
  const head = await sheets.spreadsheets.values.get({ spreadsheetId, range: `A1:${LAST_COL}1` });
  if (!head.data.values || head.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `A1:${LAST_COL}1`,
      valueInputOption: "RAW",
      requestBody: { values: [[...HEADERS]] },
    });
  }
}

/** Find-or-create the folder/sheet structure inside the shared root folder (cached). */
function ensureStructure(): Promise<DriveStructure> {
  if (!structurePromise) {
    structurePromise = (async () => {
      const root = env.googleDriveFolderId;
      const [recordingsFolderId, transcriptsFolderId, spreadsheetId] = await Promise.all([
        ensureChild(root, "Recordings", FOLDER_MIME),
        ensureChild(root, "Transcripts", FOLDER_MIME),
        ensureChild(root, SHEET_NAME, SPREADSHEET_MIME),
      ]);
      await ensureHeaders(spreadsheetId);
      return { recordingsFolderId, transcriptsFolderId, spreadsheetId };
    })();
    // A transient failure must not poison the cache forever.
    structurePromise.catch(() => {
      structurePromise = null;
    });
  }
  return structurePromise;
}

type FullRecording = Recording & { transcript: Transcript | null; evaluation: Evaluation | null };

async function uploadAudioIfNeeded(recording: FullRecording, structure: DriveStructure): Promise<string | null> {
  if (recording.driveAudioFileId) return recording.driveAudioFileId;
  const localPath = await storage.getLocalPath(recording.storagePath);
  if (!fs.existsSync(localPath)) return null;
  const { drive } = getGoogleClients();
  const created = await drive.files.create({
    requestBody: { name: recording.originalFilename, parents: [structure.recordingsFolderId] },
    media: { mimeType: recording.mimeType || "audio/mpeg", body: fs.createReadStream(localPath) },
    fields: "id",
    supportsAllDrives: true,
  });
  const fileId = created.data.id as string;
  await prisma.recording.update({
    where: { id: recording.id },
    data: { driveAudioFileId: fileId },
  });
  return fileId;
}

async function uploadTranscriptIfNeeded(recording: FullRecording, structure: DriveStructure): Promise<string | null> {
  if (!recording.transcript) return recording.driveTranscriptFileId;
  const { drive } = getGoogleClients();
  const base = path.parse(recording.originalFilename).name;
  const name = `${recording.candidateName ? `${recording.candidateName} - ` : ""}${base}.transcript.txt`;
  if (recording.driveTranscriptFileId) {
    // Transcript can change on a full re-run — keep the Drive copy current.
    await drive.files.update({
      fileId: recording.driveTranscriptFileId,
      media: { mimeType: "text/plain", body: recording.transcript.text },
      supportsAllDrives: true,
    });
    return recording.driveTranscriptFileId;
  }
  const created = await drive.files.create({
    requestBody: { name, parents: [structure.transcriptsFolderId], mimeType: "text/plain" },
    media: { mimeType: "text/plain", body: recording.transcript.text },
    fields: "id",
    supportsAllDrives: true,
  });
  const fileId = created.data.id as string;
  await prisma.recording.update({
    where: { id: recording.id },
    data: { driveTranscriptFileId: fileId },
  });
  return fileId;
}

function categoryScore(evaluation: Evaluation | null, name: string): number | string {
  if (!evaluation || !Array.isArray(evaluation.categoriesJson)) return "";
  const cat = (evaluation.categoriesJson as { name?: unknown; score?: unknown }[]).find(
    (c) => c?.name === name
  );
  return typeof cat?.score === "number" ? cat.score : "";
}

function strArr(value: unknown): string {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string").join("; ") : "";
}

function driveLink(fileId: string | null): string {
  return fileId ? `https://drive.google.com/file/d/${fileId}/view` : "";
}

function buildRow(rec: FullRecording, audioId: string | null, transcriptId: string | null): (string | number)[] {
  const e = rec.evaluation;
  return [
    rec.id,
    fmtDate(rec.importedAt),
    rec.candidateName ?? "",
    rec.originalFilename,
    rec.durationSeconds ?? "",
    rec.status,
    e?.roleDesignation ?? "",
    e?.department ?? "",
    e?.subCategory ?? "",
    e?.classificationConfidence ?? "",
    e?.overallScore ?? "",
    ...MATRIX_CATEGORIES.map((c) => categoryScore(e, c)),
    e?.recommendation ?? "",
    strArr(e?.strengths),
    strArr(e?.areasForImprovement),
    e?.overallSummary ?? "",
    driveLink(audioId),
    driveLink(transcriptId),
    rec.errorMessage ?? "",
    rec.notes ?? "",
  ];
}

/** Row number (1-based) of the recording in the sheet, or null. */
async function findRowNumber(spreadsheetId: string, recordingId: string): Promise<number | null> {
  const { sheets } = getGoogleClients();
  const col = await sheets.spreadsheets.values.get({ spreadsheetId, range: "A:A" });
  const rows = col.data.values ?? [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]?.[0] === recordingId) return i + 1;
  }
  return null;
}

async function upsertRow(spreadsheetId: string, recordingId: string, row: (string | number)[]): Promise<void> {
  const { sheets } = getGoogleClients();
  const rowNumber = await findRowNumber(spreadsheetId, recordingId);
  if (rowNumber) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `A${rowNumber}:${LAST_COL}${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `A1:${LAST_COL}1`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  }
}

/**
 * Mirror one recording to Drive: audio file, transcript file, and its sheet
 * row. Idempotent — call it after any state change; it re-reads the DB and
 * pushes whatever exists. Never throws.
 */
export function syncRecordingToDrive(recordingId: string): void {
  if (!isDriveConfigured()) {
    noteDriveDisabled();
    return;
  }
  queue = queue.then(async () => {
    try {
      const recording = await prisma.recording.findUnique({
        where: { id: recordingId },
        include: { transcript: true, evaluation: true },
      });
      if (!recording) return;
      const structure = await ensureStructure();
      const audioId = await uploadAudioIfNeeded(recording, structure).catch((err) => {
        log.warn("Drive mirror: audio upload failed:", err instanceof Error ? err.message : err);
        return recording.driveAudioFileId;
      });
      const transcriptId = await uploadTranscriptIfNeeded(recording, structure).catch((err) => {
        log.warn("Drive mirror: transcript upload failed:", err instanceof Error ? err.message : err);
        return recording.driveTranscriptFileId;
      });
      await upsertRow(structure.spreadsheetId, recording.id, buildRow(recording, audioId, transcriptId));
    } catch (err) {
      log.warn("Drive mirror: sync failed:", err instanceof Error ? err.message : err);
    }
  });
}

/** Remove a deleted recording's Drive files and sheet row. Never throws. */
export function removeRecordingFromDrive(recording: {
  id: string;
  driveAudioFileId: string | null;
  driveTranscriptFileId: string | null;
}): void {
  if (!isDriveConfigured()) return;
  queue = queue.then(async () => {
    try {
      const { drive, sheets } = getGoogleClients();
      for (const fileId of [recording.driveAudioFileId, recording.driveTranscriptFileId]) {
        if (!fileId) continue;
        await drive.files.delete({ fileId, supportsAllDrives: true }).catch(() => undefined);
      }
      const structure = await ensureStructure();
      const rowNumber = await findRowNumber(structure.spreadsheetId, recording.id);
      if (rowNumber) {
        const meta = await sheets.spreadsheets.get({ spreadsheetId: structure.spreadsheetId });
        const sheetId = meta.data.sheets?.[0]?.properties?.sheetId ?? 0;
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: structure.spreadsheetId,
          requestBody: {
            requests: [
              {
                deleteDimension: {
                  range: {
                    sheetId,
                    dimension: "ROWS",
                    startIndex: rowNumber - 1,
                    endIndex: rowNumber,
                  },
                },
              },
            ],
          },
        });
      }
    } catch (err) {
      log.warn("Drive mirror: delete sync failed:", err instanceof Error ? err.message : err);
    }
  });
}

/** Wait for all queued mirror work to settle (used by the backfill script). */
export function flushDriveQueue(): Promise<unknown> {
  return queue;
}
