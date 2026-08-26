import fs from "fs";
import { env } from "../config/env";
import { log } from "../lib/logger";
import { cleanupNormalized, normalizeForTranscription } from "../services/audio";
import { getOpenAI } from "./openaiClient";

export interface TranscriptionResult {
  text: string;
  model: string;
  language: string | null;
}

interface DiarizedSegment {
  speaker?: string;
  text?: string;
}

/**
 * Ordered fallback chain: if the configured model is rejected (unknown ID, no
 * account access, bad params) we try progressively safer models instead of
 * failing the whole recording on a config detail.
 */
function candidateModels(preferred?: string): string[] {
  return [...new Set([preferred ?? env.transcribeModel, "gpt-4o-transcribe", "whisper-1"])];
}

async function transcribeWithModel(filePath: string, model: string): Promise<TranscriptionResult> {
  const openai = getOpenAI();
  const diarize = model.includes("diarize");
  // `diarized_json` / `chunking_strategy` are newer params than some SDK
  // typings — hence the loose param object + casts.
  const params: Record<string, unknown> = {
    file: fs.createReadStream(filePath),
    model,
    response_format: diarize ? "diarized_json" : "json",
  };
  // Required by gpt-4o-transcribe-diarize for audio longer than 30 seconds.
  if (diarize) params.chunking_strategy = "auto";

  const resp = (await openai.audio.transcriptions.create(params as any)) as any;

  let text: string;
  const segments: DiarizedSegment[] | undefined = Array.isArray(resp?.segments)
    ? resp.segments
    : undefined;
  if (segments && segments.length > 0 && segments.some((s) => s.speaker)) {
    text = segments
      .map((s) => `Speaker ${s.speaker ?? "?"}: ${(s.text ?? "").trim()}`)
      .join("\n");
  } else {
    text = typeof resp?.text === "string" ? resp.text : JSON.stringify(resp);
  }
  if (!text.trim()) throw new Error("Transcription returned empty text");

  return {
    text,
    model,
    language: typeof resp?.language === "string" ? resp.language : null,
  };
}

/**
 * Step A of the pipeline: audio file → (speaker-labelled) transcript text.
 *
 * `model` overrides the configured one. The screening gate uses it to run a
 * cheaper, non-diarizing model: it only has to tell a recruitment call from a
 * personal one, which does not need speaker labels, and transcription is by
 * far the largest cost in the pipeline.
 */
export async function transcribeAudio(
  filePath: string,
  model?: string
): Promise<TranscriptionResult> {
  const normalized = await normalizeForTranscription(filePath);
  try {
    let lastError: unknown = null;
    for (const candidate of candidateModels(model)) {
      try {
        return await transcribeWithModel(normalized.path, candidate);
      } catch (err) {
        lastError = err;
        const status = (err as { status?: number }).status;
        // Only fall through on "bad model / bad params / no access" style errors.
        if (status !== 400 && status !== 403 && status !== 404) throw err;
        log.warn(
          `Transcription with "${candidate}" was rejected (HTTP ${status}) — trying the next fallback model.`
        );
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Transcription failed for all candidate models");
  } finally {
    await cleanupNormalized(normalized);
  }
}
