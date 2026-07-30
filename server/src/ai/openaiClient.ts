import OpenAI from "openai";
import { env } from "../config/env";

let client: OpenAI | null = null;

/** Lazily create the OpenAI client — throws a clear error instead of failing obscurely. */
export function getOpenAI(): OpenAI {
  if (env.mockAi) {
    throw new Error("getOpenAI() must not be called in MOCK_AI mode");
  }
  if (!env.openaiApiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to server/.env, or set MOCK_AI=true to test without OpenAI."
    );
  }
  if (!client) client = new OpenAI({ apiKey: env.openaiApiKey });
  return client;
}
