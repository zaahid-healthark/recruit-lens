import { env } from "../config/env";
import { log } from "../lib/logger";
import {
  llmEvaluationSchema,
  normalizeLlmResult,
  ParsedLlmEvaluation,
} from "../schemas/evaluationSchema";
import { getOpenAI } from "./openaiClient";
import { buildScoringSystemPrompt, buildScoringUserPrompt } from "./prompts";

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

async function callChat(messages: ChatMessage[]): Promise<string> {
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
    try {
      const resp = (await openai.chat.completions.create(params as any)) as any;
      return resp?.choices?.[0]?.message?.content ?? "";
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

function parseAndValidate(content: string): ParsedLlmEvaluation {
  const json = JSON.parse(stripJsonFences(content)) as unknown;
  return llmEvaluationSchema.parse(normalizeLlmResult(json));
}

/**
 * Step B of the pipeline: transcript → validated scoring + classification.
 * On invalid JSON the model gets exactly ONE repair retry (with the validation
 * errors echoed back); after that the error propagates and the recording is
 * marked FAILED by the pipeline.
 */
export async function scoreTranscript(transcript: string): Promise<ScoringOutcome> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildScoringSystemPrompt() },
    { role: "user", content: buildScoringUserPrompt(transcript) },
  ];

  const first = await callChat(messages);
  try {
    return { result: parseAndValidate(first), model: env.evalModel };
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
    ]);
    return { result: parseAndValidate(repaired), model: env.evalModel };
  }
}
