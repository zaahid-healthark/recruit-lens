import { RECORDING_STATUSES } from "@interview-evaluator/shared";
import { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { Router } from "express";
import fssync from "fs";
import fs from "fs/promises";
import multer from "multer";
import os from "os";
import path from "path";
import { z } from "zod";
import { removeRecordingFromDrive, syncRecordingToDrive } from "../google/driveSync";
import { asyncHandler } from "../lib/asyncHandler";
import { toRecordingDetailDto, toRecordingListItemDto } from "../lib/dto";
import {
  badRequest,
  conflict,
  noAudibleContent,
  notFound,
  notScreeningCall,
  unsupportedMedia,
} from "../lib/errors";
import { log } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { screenRecording } from "../ai/screening";
import { analyzeAudio, ensureSeekableAudio } from "../services/audio";
import { evaluateRecording, isEvaluationInFlight } from "../services/pipeline";
import { storage } from "../storage";

/** Known audio extensions — call recorders are wildly inconsistent with MIME types. */
const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".m4a", ".aac", ".amr", ".awb", ".wav", ".ogg", ".oga", ".opus",
  ".3gp", ".3gpp", ".flac", ".wma", ".mp4", ".caf", ".aiff",
]);
/** Non-audio/* MIME types that are still legitimately audio (or containers of it). */
const EXTRA_MIME_ALLOWLIST = new Set([
  "application/ogg",
  "video/3gpp",
  "video/mp4",
  "application/octet-stream",
]);

const upload = multer({
  // Multer creates this temp dir itself; files are moved into storage right after.
  dest: path.join(os.tmpdir(), "interview-evaluator-incoming"),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok =
      file.mimetype.startsWith("audio/") ||
      AUDIO_EXTENSIONS.has(ext) ||
      EXTRA_MIME_ALLOWLIST.has(file.mimetype);
    if (ok) cb(null, true);
    else {
      cb(
        unsupportedMedia(
          `Unsupported file type "${file.mimetype}" (${file.originalname}) — share an audio file.`
        )
      );
    }
  },
});

const importBodySchema = z.object({
  candidateName: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  /** Job to screen this candidate against; its JD drives the scoring. */
  jobId: z.string().uuid().optional(),
  /**
   * Sent by the watched-folder scanner for a call nobody confirmed was an
   * interview. Only these run the screening gate — a share-sheet import or a
   * manual send is already a human saying "this one counts".
   */
  autoImported: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((v) => v === true || v === "true"),
});

/**
 * PATCH body. Every field is optional — only what is sent gets changed, so a
 * rename cannot accidentally clear the job link (and vice versa). Sending an
 * explicit null clears a nullable field.
 */
const updateBodySchema = z
  .object({
    /** null detaches the job (reverting to generic, JD-less scoring). */
    jobId: z.string().uuid().nullable().optional(),
    /** null clears the name; the AI never sees it, it is a human label. */
    candidateName: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    /** Display filename. The stored file's key is untouched — this is a label. */
    originalFilename: z.string().trim().min(1).max(300).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

const listQuerySchema = z.object({
  status: z.enum(RECORDING_STATUSES).optional(),
  department: z.string().optional(),
  subCategory: z.string().optional(),
  jobId: z.string().uuid().optional(),
});

export const recordingsRouter = Router();

// POST /recordings — multipart import: field "file" + optional candidateName/notes
recordingsRouter.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw badRequest('No file uploaded — send multipart/form-data with a "file" field.');
    }
    const body = importBodySchema.parse(req.body ?? {});
    // Multer decodes originalname as latin1 — recover UTF-8 for non-ASCII filenames.
    const originalFilename = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    // Reject an unknown jobId before the file is stored, so a bad request
    // cannot leave an orphaned upload behind.
    if (body.jobId) {
      const job = await prisma.job.findUnique({ where: { id: body.jobId }, select: { id: true } });
      if (!job) throw badRequest("Unknown jobId — the job may have been deleted.");
    }
    // Decode BEFORE storing: a recorder that lost its permission mid-session
    // still writes a full-length file containing no audio, and nothing but a
    // decode can tell that from a real interview. Rejecting here means such a
    // file never becomes a row, never reaches the evaluation queue, and never
    // costs an OpenAI call. This also yields the duration, so the old
    // background probe is no longer needed.
    const analysis = await analyzeAudio(req.file.path, env.silenceThresholdDb);
    if (env.rejectSilentUploads && analysis.isSilent) {
      await fs.unlink(req.file.path).catch(() => undefined);
      log.info(
        `Rejected "${originalFilename}": no audible content ` +
          `(peak ${analysis.maxVolumeDb} dB < ${env.silenceThresholdDb} dB).`
      );
      throw noAudibleContent(
        "This recording contains no audible sound — the recorder captured an empty file."
      );
    }

    // Screening gate. Recruiters dial from the phone's own dialer, so the app
    // cannot tell an interview from a personal call and sends everything long
    // enough to be one. Deciding here — before anything is stored — is what
    // keeps a private call from ever entering the library.
    let verdict = null as Awaited<ReturnType<typeof screenRecording>> | null;
    if (body.autoImported && env.screenAutoUploads && !env.mockAi) {
      verdict = await screenRecording(req.file.path);
      if (!verdict.isScreeningCall) {
        await fs.unlink(req.file.path).catch(() => undefined);
        log.info(`Rejected "${originalFilename}" as not a recruitment call: ${verdict.reason}`);
        throw notScreeningCall(verdict.reason);
      }
    }

    const storagePath = await storage.saveFromFile(req.file.path, originalFilename);
    const recording = await prisma.recording.create({
      data: {
        originalFilename,
        storagePath,
        mimeType: req.file.mimetype,
        durationSeconds: analysis.durationSeconds,
        // A name typed by a human always wins over one heard by the model.
        candidateName: body.candidateName || verdict?.candidateName || null,
        notes: body.notes || null,
        detectedRole: verdict?.detectedRole ?? null,
        callSummary: verdict?.summary ?? null,
        autoImported: body.autoImported ?? false,
        jobId: body.jobId || null,
      },
      include: { evaluation: true, job: true },
    });
    res.status(201).json(toRecordingListItemDto(recording));
    syncRecordingToDrive(recording.id); // best-effort Drive mirror (no-op when unconfigured)

    // Warm the seekable copy now, in the background, rather than on the first
    // tap of play. Converting a 25-minute AMR takes long enough that doing it
    // on demand made the player give up and report the recording as
    // unavailable — the "calls over 5 minutes will not play" symptom.
    void storage
      .getLocalPath(storagePath)
      .then((local) => ensureSeekableAudio(local))
      .catch((err) => log.warn("Could not pre-build the playable copy:", err));
  })
);

// GET /recordings?status=&department=&subCategory= — newest first
recordingsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const evaluationFilter =
      q.department || q.subCategory
        ? {
            evaluation: {
              is: {
                ...(q.department ? { department: q.department } : {}),
                ...(q.subCategory ? { subCategory: q.subCategory } : {}),
              },
            },
          }
        : {};
    const recordings = await prisma.recording.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.jobId ? { jobId: q.jobId } : {}),
        ...evaluationFilter,
      },
      include: { evaluation: true, job: true },
      orderBy: { importedAt: "desc" },
    });
    res.json(recordings.map(toRecordingListItemDto));
  })
);

// GET /recordings/:id — full detail incl. transcript + evaluation
recordingsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const recording = await prisma.recording.findUnique({
      where: { id: req.params.id },
      include: { evaluation: true, transcript: true, job: true },
    });
    if (!recording) throw notFound("Recording not found");
    res.json(toRecordingDetailDto(recording));
  })
);

/** Extension → MIME, for when the stored mimeType is a useless octet-stream. */
const MIME_BY_EXT: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".amr": "audio/amr",
  ".awb": "audio/amr-wb",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".3gp": "video/3gpp",
  ".3gpp": "video/3gpp",
  ".flac": "audio/flac",
  ".wma": "audio/x-ms-wma",
  ".mp4": "video/mp4",
  ".caf": "audio/x-caf",
  ".aiff": "audio/aiff",
};

// GET /recordings/:id/audio — stream the stored audio for in-app playback.
// Supports Range requests so the player can seek instead of buffering the
// whole file. NOTE: on hosts without a persistent disk (Render's free tier)
// the file can legitimately be gone while the DB row survives — that is a 404,
// not a server error, and the app tells the user the audio expired.
recordingsRouter.get(
  "/:id/audio",
  asyncHandler(async (req, res) => {
    const recording = await prisma.recording.findUnique({
      where: { id: req.params.id },
      select: { storagePath: true, mimeType: true, originalFilename: true },
    });
    if (!recording) throw notFound("Recording not found");

    const storedPath = await storage.getLocalPath(recording.storagePath);
    if (!fssync.existsSync(storedPath)) {
      throw notFound(
        "The audio file is no longer stored on the server. Transcript and scores are unaffected."
      );
    }

    // Call recorders write AMR, which Android's player cannot seek within —
    // scrubbing snaps back to zero. Serve a seekable transcode instead.
    const playable = await ensureSeekableAudio(storedPath);
    const localPath = playable.path;
    let size: number;
    try {
      size = fssync.statSync(localPath).size;
    } catch {
      throw notFound(
        "The audio file is no longer stored on the server. Transcript and scores are unaffected."
      );
    }

    const ext = path.extname(recording.originalFilename).toLowerCase();
    const contentType =
      playable.contentType ??
      (recording.mimeType && recording.mimeType !== "application/octet-stream"
        ? recording.mimeType
        : (MIME_BY_EXT[ext] ?? "application/octet-stream"));

    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=3600");

    // "bytes=START-END", either end optional.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range) {
      const start = range[1] ? parseInt(range[1], 10) : 0;
      const end = range[2] ? parseInt(range[2], 10) : size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        res.setHeader("Content-Range", `bytes */${size}`);
        res.status(416).end();
        return;
      }
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", String(end - start + 1));
      fssync.createReadStream(localPath, { start, end }).pipe(res);
      return;
    }

    res.setHeader("Content-Length", String(size));
    fssync.createReadStream(localPath).pipe(res);
  })
);

// PATCH /recordings/:id — edit the human-facing labels (candidate name, notes,
// display filename) and/or attach/detach the job to screen against.
// Existing scores are NOT recomputed: the caller re-evaluates explicitly, which
// reuses the stored transcript and so costs only the scoring call.
recordingsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = updateBodySchema.parse(req.body ?? {});
    const recording = await prisma.recording.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true },
    });
    if (!recording) throw notFound("Recording not found");

    // Only the job link is pipeline-sensitive: swapping the JD mid-run would
    // produce a jd_match for a job the recording is no longer linked to.
    // Renaming is inert, so it stays allowed while an evaluation is running.
    const changesJob = body.jobId !== undefined;
    if (
      changesJob &&
      (isEvaluationInFlight(recording.id) ||
        recording.status === "TRANSCRIBING" ||
        recording.status === "SCORING")
    ) {
      throw conflict("An evaluation is running for this recording — wait for it to finish");
    }
    if (body.jobId) {
      const job = await prisma.job.findUnique({
        where: { id: body.jobId },
        select: { id: true },
      });
      if (!job) throw badRequest("Unknown jobId — the job may have been deleted.");
    }

    // Build the patch from present keys only, so omitting a field leaves it
    // untouched while an explicit null clears it.
    const data: Prisma.RecordingUpdateInput = {};
    if (changesJob) {
      data.job = body.jobId ? { connect: { id: body.jobId } } : { disconnect: true };
    }
    if (body.candidateName !== undefined) data.candidateName = body.candidateName || null;
    if (body.notes !== undefined) data.notes = body.notes || null;
    if (body.originalFilename !== undefined) data.originalFilename = body.originalFilename;

    const updated = await prisma.recording.update({
      where: { id: recording.id },
      data,
      include: { evaluation: true, transcript: true, job: true },
    });
    res.json(toRecordingDetailDto(updated));
    syncRecordingToDrive(updated.id); // reflect the new labels/job in the sheet row
  })
);

// POST /recordings/:id/evaluate — start the async pipeline (also used for retry / re-evaluate)
recordingsRouter.post(
  "/:id/evaluate",
  asyncHandler(async (req, res) => {
    const recording = await prisma.recording.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true },
    });
    if (!recording) throw notFound("Recording not found");
    if (
      isEvaluationInFlight(recording.id) ||
      recording.status === "TRANSCRIBING" ||
      recording.status === "SCORING"
    ) {
      throw conflict("An evaluation is already running for this recording");
    }
    void evaluateRecording(recording.id); // pipeline never throws; progress is polled via status
    res.status(202).json({ id: recording.id, message: "Evaluation started" });
  })
);

// DELETE /recordings/:id — recording + transcript + evaluation + stored file
recordingsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const recording = await prisma.recording.findUnique({ where: { id: req.params.id } });
    if (!recording) throw notFound("Recording not found");
    await storage
      .delete(recording.storagePath)
      .catch((err) => log.warn("Could not delete stored file:", err));
    await prisma.recording.delete({ where: { id: recording.id } }); // cascades transcript + evaluation
    removeRecordingFromDrive(recording); // best-effort Drive mirror cleanup
    res.status(204).send();
  })
);
