/**
 * UI preview server — the real frontend over in-memory fixtures.
 *
 * Serves server/web exactly as the app does, and answers every API call the
 * UI makes from uiFixtures, through the real DTO mappers, gate and ranking.
 * No database, no OpenAI, no Langfuse: for designing and checking the UI on
 * any machine. Uploads and re-evaluations simulate the pipeline's progress.
 *
 *   npm run ui:preview -w server      → http://localhost:8091  (access key: preview)
 */
process.env.DATABASE_URL ||= "postgresql://preview/preview";
process.env.API_KEY ||= "preview";

import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import { CostsDto } from "@interview-evaluator/shared";
import { Evaluation, Job, Recording, Transcript } from "@prisma/client";
import { taxonomyDto } from "../src/config/taxonomy";
import { toInstructionPresetDto, toJobDto, toRecordingDetailDto, toRecordingListItemDto } from "../src/lib/dto";
import { rankJob } from "../src/services/ranking";
import * as fx from "./fixtures/uiFixtures";

const PORT = Number(process.env.UI_PREVIEW_PORT || 8091);
const KEY = "preview";

// ── State ────────────────────────────────────────────────────────────
const recordings = new Map<string, { rec: Recording; evaluation: Evaluation | null; transcript: Transcript | null }>(
  fx.rows.map((r) => [r.rec.id, { ...r }])
);
const jobs = new Map<string, Job>(fx.jobs.map((j) => [j.id, { ...j }]));
const presets = new Map(fx.presets.map((p) => [p.id, { ...p }]));
let counter = 0;

const withRelations = (id: string) => {
  const row = recordings.get(id);
  if (!row) return null;
  return { ...row.rec, evaluation: row.evaluation, transcript: row.transcript, job: row.rec.jobId ? jobs.get(row.rec.jobId) ?? null : null };
};
const jobWithCounts = (job: Job) => ({
  ...job,
  recordings: [...recordings.values()]
    .filter((r) => r.rec.jobId === job.id && !r.rec.trashedAt)
    .map((r) => ({ evaluation: r.evaluation ? { overallScore: r.evaluation.overallScore } : null })),
});

// A quiet two-minute tone, so the player and click-to-seek can be tried.
const AUDIO = (() => {
  const rate = 8000;
  const seconds = 120;
  const samples = rate * seconds;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const envelope = 0.5 + 0.5 * Math.sin((2 * Math.PI * i) / (rate * 3));
    buf.writeInt16LE(Math.round(900 * envelope * Math.sin((2 * Math.PI * 220 * i) / rate)), 44 + i * 2);
  }
  return buf;
})();

/** Walk a recording through the pipeline's states, as the real one would. */
function simulateEvaluation(id: string) {
  const row = recordings.get(id);
  if (!row) return;
  row.rec = { ...row.rec, status: "TRANSCRIBING", errorMessage: null };
  setTimeout(() => {
    const r = recordings.get(id);
    if (r) r.rec = { ...r.rec, status: "SCORING" };
  }, 4000);
  setTimeout(() => {
    const r = recordings.get(id);
    if (!r) return;
    r.evaluation = r.evaluation ? { ...r.evaluation, createdAt: new Date() } : fx.evaluationFor(id, ++counter);
    r.rec = { ...r.rec, status: "EVALUATED" };
  }, 9000);
}

// ── App ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
const webDir = path.resolve(__dirname, "..", "web");
app.get("/app", (req, res, next) => (req.originalUrl.split("?")[0].endsWith("/") ? next() : res.redirect("app/")));
app.use("/app", express.static(webDir, { redirect: false }));
app.get("/", (_req, res) => res.redirect("app/"));
app.get("/health", (_req, res) => res.json({ ok: true, mockAi: true }));

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.header("x-api-key") === KEY) return next();
  res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing or invalid x-api-key header" } });
});
const notFound = (res: Response, what: string) => res.status(404).json({ error: { code: "NOT_FOUND", message: `${what} not found` } });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

app.get("/recordings", (req, res) => {
  const q = req.query;
  const truthy = (v: unknown) => v === "true" || v === "1";
  const list = [...recordings.keys()]
    .map(withRelations)
    .filter((r): r is NonNullable<ReturnType<typeof withRelations>> => !!r)
    .filter((r) => (truthy(q.trashed) ? !!r.trashedAt : !r.trashedAt))
    .filter((r) => !truthy(q.shortlisted) || !!r.shortlistedAt)
    .filter((r) => !truthy(q.rejected) || !!r.rejectedAt)
    .filter((r) => !q.jobId || r.jobId === q.jobId)
    .sort((a, b) => b.importedAt.getTime() - a.importedAt.getTime());
  res.json(list.map(toRecordingListItemDto));
});

app.get("/recordings/:id", (req, res) => {
  const r = withRelations(req.params.id);
  if (!r) return notFound(res, "Recording");
  res.json(toRecordingDetailDto(r));
});

app.get("/recordings/:id/audio", (req, res) => {
  if (!recordings.has(req.params.id)) return notFound(res, "Recording");
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Content-Length", String(AUDIO.length));
  res.end(AUDIO);
});

app.post("/recordings", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: { code: "BAD_REQUEST", message: 'No file uploaded — send a "file" field.' } });
  const id = fx.newId(++counter);
  const rec: Recording = {
    id,
    originalFilename: Buffer.from(req.file.originalname, "latin1").toString("utf8"),
    storagePath: `${id}.audio`,
    mimeType: req.file.mimetype,
    durationSeconds: 600 + Math.round(Math.random() * 600),
    importedAt: new Date(),
    candidateName: req.body.candidateName || null,
    notes: null,
    detectedRole: null,
    callSummary: null,
    autoImported: false,
    customInstructions: req.body.customInstructions || null,
    jobId: req.body.jobId || null,
    shortlistedAt: null,
    rejectedAt: null,
    phoneNumber: null,
    trashedAt: null,
    status: "UNEVALUATED",
    errorMessage: null,
    driveAudioFileId: null,
    driveTranscriptFileId: null,
  };
  recordings.set(id, { rec, evaluation: null, transcript: null });
  res.status(201).json(toRecordingListItemDto({ ...rec, evaluation: null, job: rec.jobId ? jobs.get(rec.jobId) ?? null : null }));
});

app.patch("/recordings/:id", (req, res) => {
  const row = recordings.get(req.params.id);
  if (!row) return notFound(res, "Recording");
  const b = req.body ?? {};
  const rec = { ...row.rec };
  if (b.jobId !== undefined) rec.jobId = b.jobId || null;
  if (b.candidateName !== undefined) rec.candidateName = b.candidateName || null;
  if (b.phoneNumber !== undefined) rec.phoneNumber = b.phoneNumber || null;
  if (b.customInstructions !== undefined) rec.customInstructions = b.customInstructions || null;
  if (b.trashed !== undefined) rec.trashedAt = b.trashed ? new Date() : null;
  if (b.shortlisted !== undefined) {
    rec.shortlistedAt = b.shortlisted ? new Date() : null;
    if (b.shortlisted) rec.rejectedAt = null;
  }
  if (b.rejected !== undefined) {
    rec.rejectedAt = b.rejected ? new Date() : null;
    if (b.rejected) rec.shortlistedAt = null;
  }
  row.rec = rec;
  res.json(toRecordingDetailDto(withRelations(rec.id)!));
});

app.post("/recordings/:id/evaluate", (req, res) => {
  const row = recordings.get(req.params.id);
  if (!row) return notFound(res, "Recording");
  if (row.rec.status === "TRANSCRIBING" || row.rec.status === "SCORING") {
    return res.status(409).json({ error: { code: "CONFLICT", message: "An evaluation is already running for this recording" } });
  }
  simulateEvaluation(row.rec.id);
  res.status(202).json({ id: row.rec.id, message: "Evaluation started" });
});

app.delete("/recordings/:id", (req, res) => {
  if (!recordings.delete(req.params.id)) return notFound(res, "Recording");
  res.status(204).end();
});

app.get("/jobs", (req, res) => {
  const all = req.query.includeArchived === "true" || req.query.includeArchived === "1";
  res.json([...jobs.values()].filter((j) => all || !j.archived).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((j) => toJobDto(jobWithCounts(j))));
});
app.get("/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return notFound(res, "Job");
  res.json(toJobDto(jobWithCounts(job)));
});
app.get("/jobs/:id/ranking", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return notFound(res, "Job");
  const recs = [...recordings.values()]
    .filter((r) => r.rec.jobId === job.id && !r.rec.trashedAt)
    .sort((a, b) => b.rec.importedAt.getTime() - a.rec.importedAt.getTime())
    .map((r) => ({ ...r.rec, evaluation: r.evaluation }));
  res.json(rankJob({ ...job, recordings: recs }));
});
app.post("/jobs/extract-text", upload.single("file"), (req, res) => {
  res.json({ text: `Job description extracted from ${req.file?.originalname ?? "the document"}.\n\nResponsibilities:\n- Own the analytics pipelines end to end\n- Model historical data\n\nRequirements:\n- 4+ years building data pipelines\n- Strong SQL`, pages: 2, filename: req.file?.originalname ?? "document.pdf" });
});
app.post("/jobs", (req, res) => {
  const b = req.body ?? {};
  if (!b.title || !b.jdText || String(b.jdText).trim().length < 40) {
    return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Paste the full job description (at least 40 characters)." } });
  }
  const job: Job = { id: fx.newId(++counter), title: b.title, jdText: b.jdText, department: b.department ?? null, subCategory: b.subCategory ?? null, archived: false, createdAt: new Date(), updatedAt: new Date() };
  jobs.set(job.id, job);
  res.status(201).json(toJobDto(jobWithCounts(job)));
});
app.patch("/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return notFound(res, "Job");
  const b = req.body ?? {};
  const next: Job = {
    ...job,
    ...(b.title !== undefined ? { title: b.title } : {}),
    ...(b.jdText !== undefined ? { jdText: b.jdText } : {}),
    ...(b.department !== undefined ? { department: b.department ?? null } : {}),
    ...(b.subCategory !== undefined ? { subCategory: b.subCategory ?? null } : {}),
    ...(b.archived !== undefined ? { archived: b.archived } : {}),
    updatedAt: new Date(),
  };
  jobs.set(job.id, next);
  res.json(toJobDto(jobWithCounts(next)));
});
app.delete("/jobs/:id", (req, res) => {
  if (!jobs.delete(req.params.id)) return notFound(res, "Job");
  for (const r of recordings.values()) if (r.rec.jobId === req.params.id) r.rec = { ...r.rec, jobId: null };
  res.status(204).end();
});

app.get("/instructions", (_req, res) => res.json([...presets.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(toInstructionPresetDto)));
app.post("/instructions", (req, res) => {
  const p = { id: fx.newId(++counter), label: req.body.label, text: req.body.text, createdAt: new Date(), updatedAt: new Date() };
  presets.set(p.id, p);
  res.status(201).json(toInstructionPresetDto(p));
});
app.patch("/instructions/:id", (req, res) => {
  const p = presets.get(req.params.id);
  if (!p) return notFound(res, "Saved instruction");
  const next = { ...p, ...req.body, updatedAt: new Date() };
  presets.set(p.id, next);
  res.json(toInstructionPresetDto(next));
});
app.delete("/instructions/:id", (req, res) => {
  if (!presets.delete(req.params.id)) return notFound(res, "Saved instruction");
  res.status(204).end();
});

app.get("/taxonomy", (_req, res) => res.json(taxonomyDto()));

app.get("/costs", (_req, res) => {
  const evaluated = [...recordings.values()].filter((r) => r.evaluation && !r.rec.trashedAt);
  const calls = evaluated.map((r, i) => {
    const minutes = Math.round(((r.rec.durationSeconds ?? 600) / 60) * 100) / 100;
    return {
      traceId: `trace-${i}`,
      recordingId: r.rec.id,
      candidateName: r.rec.candidateName,
      jobTitle: r.rec.jobId ? jobs.get(r.rec.jobId)?.title ?? null : null,
      audioMinutes: minutes,
      cost: Math.round((0.11 + minutes * 0.0035 + (i % 3) * 0.02) * 10000) / 10000,
      latencySeconds: 90 + i * 7,
      at: (r.evaluation as Evaluation).createdAt.toISOString(),
      traceUrl: null,
    };
  });
  const totalCost = calls.reduce((s, c) => s + c.cost, 0);
  const body: CostsDto = {
    configured: true,
    calls,
    totalCost,
    averageCost: calls.length ? totalCost / calls.length : null,
    currency: "USD",
    byStage: [
      { name: "score", cost: totalCost * 0.52, calls: calls.length, inputTokens: 10400 * calls.length, outputTokens: 950 * calls.length },
      { name: "score-repair", cost: totalCost * 0.31, calls: Math.ceil(calls.length / 2), inputTokens: 11200 * Math.ceil(calls.length / 2), outputTokens: 980 * Math.ceil(calls.length / 2) },
      { name: "transcribe", cost: totalCost * 0.17, calls: calls.length, inputTokens: 9800 * calls.length, outputTokens: 3100 * calls.length, derived: true },
    ],
  };
  res.json(body);
});

app.listen(PORT, () => {
  console.log(`RecruitLens UI preview → http://localhost:${PORT}/app/   (access key: ${KEY})`);
});
