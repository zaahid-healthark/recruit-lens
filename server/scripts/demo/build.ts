/**
 * Turns the demo calls into the exact rows a real upload leaves behind —
 * recording, timed transcript, evaluation, job — dated relative to now.
 *
 * Shared by the seed (which writes them to the database) and the UI preview
 * (which serves them), so what you check locally is what gets seeded. Every
 * evaluation goes through the same validation as a model response, and a
 * demo whose score band and gate decision disagree is refused outright.
 */

import fs from "fs";
import path from "path";
import { Evaluation, Job, Prisma, Recording, Transcript } from "@prisma/client";
import { toEvaluationDto } from "../../src/lib/dto";
import { applyScoringGuards, llmEvaluationSchemaFor, normalizeLlmResult } from "../../src/schemas/evaluationSchema";
import { evaluationColumns } from "../../src/services/evaluationColumns";
import { band, summariseGate } from "../../src/services/gate";
import { DEMO_CALLS, DEMO_JOBS, DemoCall } from "./calls";

export const DEMO_AUDIO_DIR = path.join(__dirname, "audio");
export const DEMO_TRANSCRIPT_MODEL = "Demo data (synthesised voices)";
export const DEMO_EVALUATION_MODEL = "Demo data";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface DemoRow {
  call: DemoCall;
  recording: Recording;
  transcript: Transcript;
  evaluation: Evaluation;
  /** What to write — the same mapping the pipeline uses for a real evaluation. */
  columns: ReturnType<typeof evaluationColumns>;
  audioPath: string;
}

export interface DemoSet {
  jobs: Job[];
  rows: DemoRow[];
}

interface Timings {
  durationSeconds: number;
  segments: { speaker: string; start: number; end: number; text: string }[];
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Named the way Android call recorders name files: "Call recording <name>_yyMMdd_HHmmss". */
const recorderStamp = (d: Date) =>
  `${pad(d.getFullYear() % 100)}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

function daysAgoAt(now: Date, daysAgo: number, hour: number, minute: number): Date {
  const d = new Date(now.getTime() - daysAgo * DAY);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function buildDemo(now = new Date()): DemoSet {
  const jobs: Job[] = DEMO_JOBS.map((j) => {
    const created = new Date(now.getTime() - j.createdDaysAgo * DAY);
    return { id: j.id, title: j.title, jdText: j.jdText, department: j.department, subCategory: j.subCategory, archived: false, createdAt: created, updatedAt: created };
  });
  return { jobs, rows: DEMO_CALLS.map((call) => buildRow(call, now)) };
}

function buildRow(call: DemoCall, now: Date): DemoRow {
  const audioPath = path.join(DEMO_AUDIO_DIR, `${call.key}.mp3`);
  const timingsPath = path.join(DEMO_AUDIO_DIR, `${call.key}.json`);
  if (!fs.existsSync(audioPath) || !fs.existsSync(timingsPath)) {
    throw new Error(`Demo audio for ${call.key} is missing. Run "npm run demo:audio -w server" on Windows.`);
  }
  const timings = JSON.parse(fs.readFileSync(timingsPath, "utf8")) as Timings;
  if (timings.segments.length !== call.turns.length || timings.segments.some((s, i) => s.text !== call.turns[i].text)) {
    throw new Error(`Demo audio for ${call.key} no longer matches calls.ts. Run "npm run demo:audio -w server" on Windows.`);
  }

  // Validated exactly as a model response is: the schema, then the guards.
  const parsed = applyScoringGuards(llmEvaluationSchemaFor(true).parse(normalizeLlmResult(structuredClone(call.evaluation))));
  // A guard that had to step in means the demo script is wrong, not that the
  // report should quietly differ from what calls.ts says.
  if (
    parsed.overall_score !== call.evaluation.overall_score ||
    parsed.question_assessment?.technical_score !== call.evaluation.question_assessment?.technical_score
  ) {
    throw new Error(`Demo ${call.key}: the scoring guards changed its scores — fix the numbers in calls.ts.`);
  }

  const importedAt = daysAgoAt(now, call.imported.daysAgo, call.imported.hour, call.imported.minute);
  const reportAt = new Date(importedAt.getTime() + call.minutesToReport * MINUTE);
  const decidedAt = call.outcome ? new Date(reportAt.getTime() + call.outcome.hoursAfterReport * HOUR) : null;

  const columns = evaluationColumns(parsed, DEMO_EVALUATION_MODEL);
  const asRead = (v: unknown): Prisma.JsonValue | null => (v === Prisma.DbNull ? null : (v as Prisma.JsonValue));
  const evaluation: Evaluation = {
    id: call.evaluationId,
    recordingId: call.recordingId,
    roleDesignation: columns.roleDesignation,
    department: columns.department,
    subCategory: columns.subCategory,
    classificationConfidence: columns.classificationConfidence,
    classificationRationale: columns.classificationRationale,
    overallScore: columns.overallScore,
    overallSummary: columns.overallSummary,
    coverageNote: columns.coverageNote,
    categoriesJson: asRead(columns.categoriesJson) ?? [],
    questionAssessmentJson: asRead(columns.questionAssessmentJson),
    strengths: columns.strengths,
    areasForImprovement: columns.areasForImprovement,
    jdMatchJson: asRead(columns.jdMatchJson),
    recommendation: columns.recommendation,
    model: columns.model,
    createdAt: reportAt,
  };

  // The number on the report must be the decision beside it.
  const decision = summariseGate(toEvaluationDto(evaluation)).decision;
  const scoreBand = parsed.overall_score === null ? null : band(parsed.overall_score);
  if (decision !== call.expectedDecision || scoreBand !== call.expectedDecision) {
    throw new Error(`Demo ${call.key}: the gate says ${decision} and the score says ${scoreBand}, but calls.ts expects ${call.expectedDecision}.`);
  }

  const recording: Recording = {
    id: call.recordingId,
    originalFilename: `Call recording ${call.candidate.name}_${recorderStamp(importedAt)}.mp3`,
    storagePath: `${call.key}.mp3`,
    mimeType: "audio/mpeg",
    durationSeconds: Math.round(timings.durationSeconds),
    importedAt,
    candidateName: call.candidate.name,
    notes: call.notes,
    detectedRole: null,
    callSummary: null,
    autoImported: false,
    customInstructions: null,
    jobId: call.job.id,
    shortlistedAt: call.outcome?.kind === "next" ? decidedAt : null,
    rejectedAt: call.outcome?.kind === "rejected" ? decidedAt : null,
    phoneNumber: null,
    trashedAt: null,
    status: "EVALUATED",
    errorMessage: null,
    driveAudioFileId: null,
    driveTranscriptFileId: null,
  };

  const transcript: Transcript = {
    id: call.transcriptId,
    recordingId: call.recordingId,
    text: timings.segments.map((s) => `Speaker ${s.speaker}: ${s.text}`).join("\n"),
    segmentsJson: timings.segments as unknown as Prisma.JsonValue,
    model: DEMO_TRANSCRIPT_MODEL,
    language: "en",
    createdAt: new Date(importedAt.getTime() + 2 * MINUTE),
  };

  return { call, recording, transcript, evaluation, columns, audioPath };
}
