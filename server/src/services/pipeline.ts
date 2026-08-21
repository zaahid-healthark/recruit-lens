import { LlmEvaluationResult } from "@interview-evaluator/shared";
import { Prisma } from "@prisma/client";
import { mockEvaluation, mockTranscript } from "../ai/mock";
import { scoreTranscript } from "../ai/score";
import { transcribeAudio } from "../ai/transcribe";
import { env } from "../config/env";
import { syncRecordingToDrive } from "../google/driveSync";
import { log } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { storage } from "../storage";

/** Guards against double-running the pipeline for the same recording. */
const inFlight = new Set<string>();

export function isEvaluationInFlight(recordingId: string): boolean {
  return inFlight.has(recordingId);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Full evaluation pipeline for one recording:
 *   UNEVALUATED → TRANSCRIBING → SCORING → EVALUATED (or FAILED).
 *
 * Never throws — every outcome lands the recording in EVALUATED or FAILED with
 * an errorMessage (spec: recordings must never get stuck silently). Retrying a
 * FAILED recording reuses an existing transcript (re-scoring is the common fix
 * and transcription is the expensive step); delete + re-import for a full redo.
 */
export async function evaluateRecording(recordingId: string): Promise<void> {
  if (inFlight.has(recordingId)) return;
  inFlight.add(recordingId);
  try {
    const recording = await prisma.recording.findUnique({
      where: { id: recordingId },
      include: { transcript: true, job: true },
    });
    if (!recording) {
      log.warn(`evaluateRecording: recording ${recordingId} no longer exists — skipping.`);
      return;
    }

    // A job with an empty JD is treated as no job at all: there would be
    // nothing to match against, and a jd_match block built from whitespace
    // would read as "no requirements" rather than "not scored against a JD".
    const job =
      recording.job && recording.job.jdText.trim().length > 0
        ? {
            title: recording.job.title,
            jdText: recording.job.jdText,
            department: recording.job.department,
            subCategory: recording.job.subCategory,
          }
        : null;

    // ── Step A: transcription ────────────────────────────────────────────
    let transcriptText: string;
    if (recording.transcript) {
      transcriptText = recording.transcript.text;
      await prisma.recording.update({
        where: { id: recordingId },
        data: { errorMessage: null },
      });
    } else {
      await prisma.recording.update({
        where: { id: recordingId },
        data: { status: "TRANSCRIBING", errorMessage: null },
      });
      if (env.mockAi) {
        await sleep(800); // let the UI show the TRANSCRIBING state
        const mockRef = mockEvaluation(recording.originalFilename, { job });
        transcriptText = mockTranscript(recording.originalFilename, mockRef.role_designation);
        await prisma.transcript.create({
          data: {
            recordingId,
            text: transcriptText,
            model: "mock-transcriber",
            language: "en",
          },
        });
      } else {
        const localPath = await storage.getLocalPath(recording.storagePath);
        const t = await transcribeAudio(localPath);
        transcriptText = t.text;
        await prisma.transcript.create({
          data: { recordingId, text: t.text, model: t.model, language: t.language },
        });
      }
    }

    // ── Step B: scoring + classification ─────────────────────────────────
    await prisma.recording.update({ where: { id: recordingId }, data: { status: "SCORING" } });
    let result: LlmEvaluationResult;
    let model: string;
    if (env.mockAi) {
      await sleep(800);
      result = mockEvaluation(recording.originalFilename, { job });
      model = "mock-evaluator";
    } else {
      const outcome = await scoreTranscript(transcriptText, job);
      result = outcome.result;
      model = outcome.model;
    }

    const evaluationData = {
      roleDesignation: result.role_designation,
      department: result.department,
      subCategory: result.sub_category,
      classificationConfidence: result.classification_confidence,
      classificationRationale: result.classification_rationale,
      overallScore: result.overall_score,
      overallSummary: result.overall_summary,
      categoriesJson: result.categories as unknown as Prisma.InputJsonValue,
      strengths: result.strengths,
      areasForImprovement: result.areas_for_improvement,
      recommendation: result.recommendation,
      // Prisma requires DbNull (SQL NULL) rather than `null` for optional Json
      // columns — plain null is reserved for "JSON null" and is rejected here.
      jdMatchJson: result.jd_match
        ? ({
            fitScore: result.jd_match.fit_score,
            verdictSummary: result.jd_match.verdict_summary,
            requirements: result.jd_match.requirements,
          } as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      model,
    };
    await prisma.evaluation.upsert({
      where: { recordingId },
      create: { recordingId, ...evaluationData },
      update: evaluationData,
    });
    await prisma.recording.update({
      where: { id: recordingId },
      data: { status: "EVALUATED", errorMessage: null },
    });
    syncRecordingToDrive(recordingId); // mirror transcript + scores to Drive (best-effort)
    log.info(
      `Recording ${recordingId} evaluated: ${result.department} › ${result.sub_category}, ` +
        `role "${result.role_designation}", score ${result.overall_score}` +
        `${result.jd_match ? `, JD fit ${result.jd_match.fit_score} vs "${job?.title}"` : ""}.`
    );
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 800);
    log.error(`Evaluation failed for recording ${recordingId}:`, message);
    await prisma.recording
      .update({ where: { id: recordingId }, data: { status: "FAILED", errorMessage: message } })
      .catch((e) => log.error("Could not persist FAILED status:", e));
    syncRecordingToDrive(recordingId); // reflect the FAILED status + error in the sheet
  } finally {
    inFlight.delete(recordingId);
  }
}
