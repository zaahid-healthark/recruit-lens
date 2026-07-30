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
});

const listQuerySchema = z.object({
  status: z.enum(RECORDING_STATUSES).optional(),
  department: z.string().optional(),
  subCategory: z.string().optional(),
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
    const storagePath = await storage.saveFromFile(req.file.path, originalFilename);
    const recording = await prisma.recording.create({
      data: {
        originalFilename,
        storagePath,
        mimeType: req.file.mimetype,
        candidateName: body.candidateName || null,
        notes: body.notes || null,
      },
      include: { evaluation: true },
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
      where: { ...(q.status ? { status: q.status } : {}), ...evaluationFilter },
      include: { evaluation: true },
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
      include: { evaluation: true, transcript: true },
    });
    if (!recording) throw notFound("Recording not found");
    res.json(toRecordingDetailDto(recording));
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
