import { env } from "../config/env";
import { log } from "../lib/logger";
import {
  applyScoringGuards,
  llmEvaluationSchemaFor,
  normalizeLlmResult,
  ParsedLlmEvaluation,
} from "../schemas/evaluationSchema";
import {
  EvaluationTrace,
  recordGeneration,
  STAGE_SCORE,
  STAGE_SCORE_REPAIR,
} from "../observability/langfuse";
import { getOpenAI } from "./openaiClient";
import { buildScoringSystemPrompt, buildScoringUserPrompt, JobContext } from "./prompts";

export interface ScoringOutcome {
  result: ParsedLlmEvaluation;
  model: string;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * GPT-5-family and o-series reasoning models only accept the default
 * temperature; older chat models honor the spec's temperature 0.2.
 */
function supportsCustomTemperature(model: string): boolean {
  return !/^(gpt-5|o\d)/i.test(model);
}

function stripJsonFences(content: string): string {
  const trimmed = content.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1] : trimmed;
}

async function callChat(
  messages: ChatMessage[],
  trace: EvaluationTrace,
  name: string
): Promise<string> {
  const openai = getOpenAI();
  const params: Record<string, unknown> = {
    model: env.evalModel,
    messages,
    response_format: { type: "json_object" },
  };
  if (supportsCustomTemperature(env.evalModel)) params.temperature = 0.2;

  // Defensive: if the chosen model rejects a parameter, strip it and retry
  // instead of failing the recording over an API-surface difference.
  for (let attempt = 0; ; attempt++) {
    const startedAt = new Date();
    try {
      const resp = (await openai.chat.completions.create(params as any)) as any;
      const content = resp?.choices?.[0]?.message?.content ?? "";
      // The repair retry is recorded separately, so a run that needed one is
      // visibly more expensive than one that did not.
      recordGeneration(trace, {
        name,
        model: env.evalModel,
        usage: resp?.usage,
        startedAt,
        input: messages,
        output: content,
        metadata: { attempt },
      });
      return content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 2 && /temperature/i.test(msg) && "temperature" in params) {
        delete params.temperature;
        log.warn("Model rejected temperature — retrying without it.");
        continue;
      }
      if (attempt < 2 && /response_format/i.test(msg) && "response_format" in params) {
        delete params.response_format;
        log.warn("Model rejected response_format — retrying without it (prompt still demands JSON).");
        continue;
      }
      throw err;
    }
  }
}

function parseAndValidate(content: string, hasJob: boolean): ParsedLlmEvaluation {
  const json = JSON.parse(stripJsonFences(content)) as unknown;
  const parsed = llmEvaluationSchemaFor(hasJob).parse(normalizeLlmResult(json));
  // The prompt states the withholding rules; this enforces them. A model that
  // scores an untested category anyway must not reach the report.
  return applyScoringGuards(parsed);
}

/**
 * Step B of the pipeline: transcript → validated scoring + classification.
 * When `job` is supplied the model also scores JD fit requirement-by-requirement.
 * On invalid JSON the model gets exactly ONE repair retry (with the validation
 * errors echoed back); after that the error propagates and the recording is
 * marked FAILED by the pipeline.
 */
export async function scoreTranscript(
  transcript: string,
  job: JobContext | null = null,
  customInstructions: string | null = null,
  trace: EvaluationTrace = null
): Promise<ScoringOutcome> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildScoringSystemPrompt(job) },
    { role: "user", content: buildScoringUserPrompt(transcript, job, customInstructions) },
  ];

  const first = await callChat(messages, trace, STAGE_SCORE);
  try {
    return { result: parseAndValidate(first, job !== null), model: env.evalModel };
  } catch (err) {
    const issues = err instanceof Error ? err.message : String(err);
    log.warn("Evaluation JSON failed validation — one repair retry.", issues.slice(0, 300));
    const repaired = await callChat([
      ...messages,
      { role: "assistant", content: first || "(empty response)" },
      {
        role: "user",
        content: `Your previous response was not valid. Validation errors:\n${issues.slice(0, 2000)}\n\nRespond again with ONLY the corrected JSON object.`,
      },
      // Recorded under its own name so a run that needed a repair is visibly
      // more expensive in the trace than one that got it right first time.
    ], trace, STAGE_SCORE_REPAIR);
    return { result: parseAndValidate(repaired, job !== null), model: env.evalModel };
  }
}
