import "dotenv/config";
import path from "path";

/** Parse a boolean-ish env var ("1", "true", "yes", "on" → true). */
function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function floatEnv(value: string | undefined, fallback: number): number {
  const n = value ? parseFloat(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function intEnv(value: string | undefined, fallback: number): number {
  const n = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  port: intEnv(process.env.PORT, 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  /** Shared secret the mobile app must send in the `x-api-key` header. */
  apiKey: process.env.API_KEY ?? "dev-secret-change-me",
  /** When true, the AI pipeline returns canned results and never calls OpenAI (zero cost). */
  mockAi: boolEnv(process.env.MOCK_AI, true),
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  /**
   * Model IDs are centralized here and overridable via env.
   * Transcription: gpt-4o-transcribe-diarize (speaker-labelled, /v1/audio/transcriptions).
   * Evaluation: gpt-5.4 — any chat-completions model works; parameters adapt per family.
   */
  transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-transcribe-diarize",
  evalModel: process.env.OPENAI_EVAL_MODEL ?? "gpt-5.4",
  /**
   * Model for the auto-upload screening gate (is this a recruitment call?).
   * A cheap yes/no on a 3-minute transcript — point it at a smaller model to
   * cut cost without touching evaluation quality.
   */
  screeningModel: process.env.OPENAI_SCREENING_MODEL ?? process.env.OPENAI_EVAL_MODEL ?? "gpt-5.4",
  /**
   * Transcription model for the screening clip only. Defaults to the mini
   * model at roughly half the price: the gate only decides whether a call is
   * recruitment work, which needs neither speaker labels nor the accuracy the
   * evaluation transcript depends on. Full transcription still uses
   * OPENAI_TRANSCRIBE_MODEL.
   */
  screeningTranscribeModel:
    process.env.OPENAI_SCREENING_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe",
  /**
   * Seconds of audio the screening verdict is based on. Whether a call is a
   * job discussion is clear within the first minute or so, and this is billed
   * per minute of audio, so it is the main lever on screening cost.
   */
  screeningSeconds: intEnv(process.env.SCREENING_SECONDS, 90),
  /**
   * Seconds skipped before the screening clip starts. A call recorder begins
   * capturing at dial, so a recording opens with ringing or a caller tune —
   * often a song — before anyone speaks. Transcribing that wastes money and
   * can make a real interview look like it is about something else. Pulled
   * back automatically when the recording is too short to skip this much.
   */
  screeningSkipSeconds: intEnv(process.env.SCREENING_SKIP_SECONDS, 30),
  /** Reject auto-uploaded calls the screening gate judges unrelated to hiring. */
  screenAutoUploads: boolEnv(process.env.SCREEN_AUTO_UPLOADS, true),
  /** Local uploads directory for LocalDiskStorage. */
  storageDir: path.resolve(process.env.STORAGE_DIR ?? "./uploads"),
  /**
   * Google Drive mirror (optional). When BOTH are present, every recording is
   * mirrored to Drive: audio + transcript files and a row in an "Evaluations"
   * Google Sheet, all inside the given folder. Leave unset to disable.
   */
  googleCredentialsPath: path.resolve(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "./google-credentials.json"
  ),
  googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID ?? "",
  /**
   * Uploads whose peak volume is below this (dBFS) are rejected as having no
   * audible content. Speech peaks far higher; digital silence reports -91.
   * Set REJECT_SILENT_UPLOADS=false to accept them anyway.
   */
  silenceThresholdDb: floatEnv(process.env.SILENCE_THRESHOLD_DB, -45),
  rejectSilentUploads: boolEnv(process.env.REJECT_SILENT_UPLOADS, true),
  /**
   * Langfuse tracing (optional). With both keys present every evaluation is
   * traced with its model calls and token usage, which is what turns "roughly
   * 20-40 cents a call" into a measured figure per candidate. Leave unset to
   * disable entirely — nothing is sent and nothing is imported at runtime.
   */
  langfusePublicKey: process.env.LANGFUSE_PUBLIC_KEY ?? "",
  langfuseSecretKey: process.env.LANGFUSE_SECRET_KEY ?? "",
  langfuseBaseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
  /**
   * Send prompts and completions too, not just usage numbers.
   *
   * Off by default on purpose: a transcript is a recording of a real person
   * answering questions about their career, and cost tracing needs model names
   * and token counts, not what they said. Turn it on deliberately, and only
   * when debugging the prompts is worth sending interview content to a
   * third-party service.
   */
  langfuseCaptureContent: boolEnv(process.env.LANGFUSE_CAPTURE_CONTENT, false),
  /**
   * USD per minute of audio, used to price transcription in the cost view.
   *
   * Deliberately NOT defaulted. Langfuse has no price for the transcription
   * models, so without this they report as $0.00 — and a made-up default
   * would replace "we cannot see this cost" with a confident wrong number,
   * which is worse. Set it from the rate on your own OpenAI bill.
   */
  transcribeUsdPerMinute: floatEnv(process.env.OPENAI_TRANSCRIBE_USD_PER_MINUTE, 0),
  /** Parallelism of the bulk evaluation queue (1 = strictly sequential). */
  bulkConcurrency: Math.max(1, intEnv(process.env.BULK_CONCURRENCY, 1)),
} as const;
