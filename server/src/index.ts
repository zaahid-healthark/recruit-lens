import { createApp } from "./app";
import { env } from "./config/env";
import { log } from "./lib/logger";
import { flushLangfuse } from "./observability/langfuse";
import { recoverStuckRecordings } from "./services/recovery";

async function main(): Promise<void> {
  if (!env.databaseUrl) {
    log.error(
      "DATABASE_URL is not set. Copy server/.env.example to server/.env (and start Postgres with `npm run db:up`)."
    );
    process.exit(1);
  }
  if (!env.mockAi && !env.openaiApiKey) {
    log.warn("MOCK_AI=false but OPENAI_API_KEY is empty — evaluations will fail until it is set.");
  }

  await recoverStuckRecordings();

  const app = createApp();
  app.listen(env.port, () => {
    log.info(`Interview Evaluator API listening on http://localhost:${env.port}`);
    log.info(
      env.mockAi
        ? "Mode: MOCK_AI — canned transcripts/evaluations, zero OpenAI cost."
        : `Mode: real AI — transcribe=${env.transcribeModel}, eval=${env.evalModel}.`
    );
  });
}

// Langfuse batches in the background, so a plain kill would drop whatever has
// not been sent. Both signals get the same short grace period.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void flushLangfuse().finally(() => process.exit(0));
  });
}

void main();
