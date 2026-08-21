import { RECORDING_STATUSES } from "@interview-evaluator/shared";
import { Router } from "express";
import multer from "multer";
import os from "os";
import path from "path";
import { z } from "zod";
import { removeRecordingFromDrive, syncRecordingToDrive } from "../google/driveSync";
import { asyncHandler } from "../lib/asyncHandler";
import { toRecordingDetailDto, toRecordingListItemDto } from "../lib/dto";
import { badRequest, conflict, notFound, unsupportedMedia } from "../lib/errors";
import { log } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { getDurationSeconds } from "../services/audio";
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
});

/** PATCH body — currently only the job link is mutable after import. */
const updateBodySchema = z.object({
  /** null detaches the job (reverting to generic, JD-less scoring). */
  jobId: z.string().uuid().nullable(),
});

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
    const storagePath = await storage.saveFromFile(req.file.path, originalFilename);
    const recording = await prisma.recording.create({
      data: {
        originalFilename,
        storagePath,
        mimeType: req.file.mimetype,
        candidateName: body.candidateName || null,
        notes: body.notes || null,
        jobId: body.jobId || null,
      },
      include: { evaluation: true, job: true },
    });
    res.status(201).json(toRecordingListItemDto(recording));
    syncRecordingToDrive(recording.id); // best-effort Drive mirror (no-op when unconfigured)

    // Duration probe runs in the background — metadata nicety, never blocks the import.
    void storage
      .getLocalPath(storagePath)
      .then((p) => getDurationSeconds(p))
      .then(async (durationSeconds) => {
        if (durationSeconds == null) return;
        await prisma.recording.update({ where: { id: recording.id }, data: { durationSeconds } });
        syncRecordingToDrive(recording.id); // refresh the sheet row with the duration
      })
      .catch((err) => log.warn("Duration probe failed:", err));
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

// PATCH /recordings/:id — attach/detach the job to screen against.
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
    if (
      isEvaluationInFlight(recording.id) ||
      recording.status === "TRANSCRIBING" ||
      recording.status === "SCORING"
    ) {
      // Swapping the JD mid-pipeline would produce a jd_match for a job the
      // recording is no longer linked to.
      throw conflict("An evaluation is running for this recording — wait for it to finish");
    }
    if (body.jobId) {
      const job = await prisma.job.findUnique({
        where: { id: body.jobId },
        select: { id: true },
      });
      if (!job) throw badRequest("Unknown jobId — the job may have been deleted.");
    }
    const updated = await prisma.recording.update({
      where: { id: recording.id },
      data: { jobId: body.jobId },
      include: { evaluation: true, transcript: true, job: true },
    });
    res.json(toRecordingDetailDto(updated));
    syncRecordingToDrive(updated.id); // reflect the new job in the sheet row
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
