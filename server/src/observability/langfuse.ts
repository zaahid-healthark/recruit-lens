import { CostStageDto, CostsDto, EvaluationCostDto } from "@interview-evaluator/shared";
import { Langfuse } from "langfuse";
import { env } from "../config/env";
import { log } from "../lib/logger";

/**
 * Cost and latency tracing for the AI pipeline.
 *
 * Two properties this module must never violate:
 *
 *   1. It cannot break an evaluation. Tracing is bookkeeping about the work,
 *      not part of it, so every call here swallows its own errors. An
 *      unreachable Langfuse, a bad key or a network stall must cost a
 *      candidate nothing.
 *   2. It does not ship interview content by default. Transcripts are a
 *      recording of a real person answering questions about their career, and
 *      cost tracing needs model names and token counts, not what they said.
 *      LANGFUSE_CAPTURE_CONTENT=true opts in when someone wants to debug the
 *      prompts themselves.
 */

let client: Langfuse | null = null;
let initialised = false;

function getClient(): Langfuse | null {
  if (initialised) return client;
  initialised = true;
  if (!env.langfusePublicKey || !env.langfuseSecretKey) return null;
  try {
    client = new Langfuse({
      publicKey: env.langfusePublicKey,
      secretKey: env.langfuseSecretKey,
      baseUrl: env.langfuseBaseUrl,
    });
    log.info(
      `Langfuse tracing on (${env.langfuseBaseUrl})` +
        `${env.langfuseCaptureContent ? " — capturing prompt content" : " — metadata and usage only"}.`
    );
  } catch (err) {
    log.warn("Langfuse could not start — continuing without tracing.", err);
    client = null;
  }
  return client;
}

/**
 * Every generation name this app records.
 *
 * One source of truth because the Costs screen queries Langfuse BY these
 * names: a stage recorded under a name missing here is invisible in the cost
 * split rather than wrong, which is the harder kind of bug to notice. Adding
 * a stage means adding it here too.
 */
export const STAGE_TRANSCRIBE = "transcribe";
export const STAGE_SCORE = "score";
export const STAGE_SCORE_REPAIR = "score-repair";
export const GENERATION_STAGES = [STAGE_TRANSCRIBE, STAGE_SCORE, STAGE_SCORE_REPAIR];

/** Opaque handle; null whenever tracing is off, so callers need no branching. */
export type EvaluationTrace = ReturnType<Langfuse["trace"]> | null;

export interface TraceInput {
  recordingId: string;
  candidateName?: string | null;
  jobTitle?: string | null;
  filename: string;
  durationSeconds?: number | null;
}

/**
 * One trace per evaluation, so a call's total cost is the sum of its children
 * rather than something to reassemble from a usage dashboard by timestamp.
 */
export function startEvaluationTrace(input: TraceInput): EvaluationTrace {
  const lf = getClient();
  if (!lf) return null;
  try {
    return lf.trace({
      name: "evaluate-recording",
      // The recording id is the join key back to this app's own records.
      sessionId: input.recordingId,
      metadata: {
        recordingId: input.recordingId,
        candidateName: input.candidateName ?? undefined,
        jobTitle: input.jobTitle ?? undefined,
        filename: input.filename,
        audioSeconds: input.durationSeconds ?? undefined,
        audioMinutes:
          typeof input.durationSeconds === "number"
            ? Math.round((input.durationSeconds / 60) * 100) / 100
            : undefined,
      },
      tags: ["evaluation"],
    });
  } catch (err) {
    log.warn("Langfuse trace could not be created — continuing.", err);
    return null;
  }
}

export interface GenerationInput {
  name: string;
  model: string;
  /** Audio length, recorded as context — pricing comes from tokens. */
  audioSeconds?: number | null;
  /** Raw `usage` from the OpenAI response, whatever shape that model returns. */
  usage?: unknown;
  /** Only sent when LANGFUSE_CAPTURE_CONTENT is on. */
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  startedAt: Date;
}

/**
 * Normalise the several shapes OpenAI reports usage in.
 *
 * Chat completions return prompt/completion tokens; the audio models return
 * input/output tokens, and some return seconds instead. Langfuse prices from
 * whatever keys it recognises, so the job here is to pass them through under
 * names it knows rather than to invent a total.
 */
function toUsageDetails(usage: unknown): Record<string, number> | undefined {
  if (typeof usage !== "object" || usage === null) return undefined;
  const u = usage as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;

  const details: Record<string, number> = {};
  const input = num(u.prompt_tokens) ?? num(u.input_tokens);
  const output = num(u.completion_tokens) ?? num(u.output_tokens);
  const total = num(u.total_tokens);
  if (input !== undefined) details.input = input;
  if (output !== undefined) details.output = output;
  if (total !== undefined) details.total = total;

  // Cached prompt tokens are billed differently; naming them lets Langfuse
  // price them at the cached rate instead of the full one.
  const cached = (u.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens;
  if (num(cached) !== undefined) details.cache_read_input_tokens = num(cached) as number;

  // Audio models sometimes report duration rather than tokens.
  const seconds = num(u.seconds) ?? num(u.duration);
  if (seconds !== undefined) details.seconds = seconds;

  return Object.keys(details).length > 0 ? details : undefined;
}

/**
 * Cost for models Langfuse cannot price itself.
 *
 * gpt-4o-transcribe-diarize has no entry in Langfuse's model table, so it
 * reports as unpriced — and it is usually the larger half of the bill. It IS
 * token-priced and the API returns the counts, so the cost is derived from
 * them rather than estimated from audio length, which would be a second
 * approximation on top of a rate that might itself be wrong.
 *
 * Returns undefined for anything Langfuse already prices, so its own figures
 * are never overridden by ours.
 */
/**
 * Cost for models Langfuse has no rate for.
 *
 * gpt-4o-transcribe-diarize is absent from Langfuse's model table, so it
 * prices at zero — which reads as free for what is usually the larger half of
 * the bill. It IS token-priced and the tokens are recorded, so the cost is
 * derived from them.
 *
 * Returns null for anything else, so Langfuse's own figures are never
 * overridden by ours.
 */
function priceTokens(model: string, input: number, output: number): number | null {
  if (!model.includes("transcribe")) return null;
  if (input === 0 && output === 0) return null;
  const total =
    (input / 1_000_000) * env.transcribeUsdPer1mInput +
    (output / 1_000_000) * env.transcribeUsdPer1mOutput;
  return total > 0 ? total : null;
}

let warnedNoTranscribeTokens = false;

function priceFromTokens(
  model: string,
  usage: Record<string, number> | undefined,
  rawUsage: unknown
): { total: number } | undefined {
  if (!model.includes("transcribe")) return undefined;
  const input = usage?.input ?? 0;
  const output = usage?.output ?? 0;
  const total = priceTokens(model, input, output);

  if (total === null) {
    // Pricing depends on the API reporting token counts. If it stops doing so
    // the stage silently reverts to unpriced, which looks identical to free —
    // so say once, in the server log, what actually came back.
    if (!warnedNoTranscribeTokens) {
      warnedNoTranscribeTokens = true;
      const keys =
        typeof rawUsage === "object" && rawUsage !== null
          ? Object.keys(rawUsage as Record<string, unknown>).join(", ")
          : String(rawUsage);
      log.warn(
        `Transcription (${model}) returned no token counts, so it cannot be priced ` +
          `(usage keys: ${keys || "none"}). The Costs screen will show it as unpriced.`
      );
    }
    return undefined;
  }
  log.info(
    `Transcription priced from tokens: ${input} in + ${output} out = $${total.toFixed(4)}.`
  );
  return { total };
}

/** Records one model call against a trace. Safe to call with a null trace. */
export function recordGeneration(trace: EvaluationTrace, gen: GenerationInput): void {
  if (!trace) return;
  try {
    const capture = env.langfuseCaptureContent;
    const usageDetails = toUsageDetails(gen.usage);
    const costDetails = priceFromTokens(gen.model, usageDetails, gen.usage);
    trace.generation({
      name: gen.name,
      model: gen.model,
      startTime: gen.startedAt,
      endTime: new Date(),
      usageDetails,
      costDetails,
      input: capture ? gen.input : undefined,
      output: capture ? gen.output : undefined,
      metadata: {
        ...gen.metadata,
        ...(gen.audioSeconds ? { audioSeconds: gen.audioSeconds } : {}),
        // Say plainly why input/output are absent, so an empty generation in
        // the UI does not read as a failed capture.
        ...(capture ? {} : { contentCapture: "disabled (LANGFUSE_CAPTURE_CONTENT)" }),
      },
    });
  } catch (err) {
    log.warn("Langfuse generation could not be recorded — continuing.", err);
  }
}

/** Marks a trace as failed, so a FAILED recording is visible in the cost view. */
export function recordTraceError(trace: EvaluationTrace, message: string): void {
  if (!trace) return;
  try {
    trace.update({ metadata: { status: "FAILED", error: message.slice(0, 500) } });
  } catch {
    /* tracing must never mask the real failure */
  }
}

/**
 * Langfuse batches in the background; a short-lived process can exit before a
 * batch leaves. Called on shutdown and after each evaluation so a trace is
 * never lost to a restart.
 */
export async function flushLangfuse(): Promise<void> {
  if (!client) return;
  try {
    await client.flushAsync();
  } catch (err) {
    log.warn("Langfuse flush failed — traces for this run may be incomplete.", err);
  }
}

/**
 * Read back what recent evaluations cost.
 *
 * Read-only and best-effort: this powers a reporting screen, so Langfuse being
 * unreachable makes that screen unavailable, never an evaluation. Traces are
 * keyed by recording id, which is what lets a cost sit next to the candidate
 * it belongs to instead of being matched up by timestamp.
 */
export async function fetchCostTraces(limit: number): Promise<CostsDto> {
  const lf = getClient();
  if (!lf) {
    return {
      configured: false,
      calls: [],
      totalCost: 0,
      averageCost: null,
      byStage: [],
      currency: "USD",
    };
  }

  const traces = await lf.fetchTraces({ name: "evaluate-recording", limit });
  const rows = (traces?.data ?? []) as Array<Record<string, any>>;

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  // Observations are read BEFORE the per-call figures are assembled, because a
  // stage Langfuse cannot price is costed from its tokens here and that has to
  // be added to the trace total. Traces carry only ids and a total; the tokens
  // live on the observations.
  const traceIds = new Set(rows.map((t) => String(t.id ?? "")).filter(Boolean));
  const byStage: CostStageDto[] = [];
  const derivedPerTrace = new Map<string, number>();
  try {
    // Scoped to THIS app's traces. A Langfuse project is often shared, and an
    // unfiltered query returns every generation in it — which showed other
    // applications' models sitting in this app's cost breakdown.
    //
    // Bounded by the oldest trace being shown, and asked for BY NAME.
    //
    // An unfiltered query returns every generation in the project, and a
    // project shared with a busy application holds thousands — so this used to
    // page through hundreds of rows to keep three, which is both slow and
    // liable to crowd ours out of the newest page entirely. Langfuse can
    // filter by name server-side, so only this app's stages come back.
    const oldest = rows
      .map((t) => Date.parse(String(t.timestamp ?? "")))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b)[0];
    const fromStartTime = Number.isFinite(oldest)
      ? new Date(oldest - 60_000).toISOString() // a minute of slack for clock skew
      : undefined;

    // One request per stage, in parallel: three small responses beat one large
    // one, and the screen waits on the slowest rather than the sum.
    const pages = await Promise.all(
      GENERATION_STAGES.map(async (stage) => {
        const obs = await lf.fetchObservations({
          type: "GENERATION",
          name: stage,
          limit: Math.min(Math.max(limit, 1) * 2, 100),
          ...(fromStartTime ? { fromStartTime } : {}),
        } as Parameters<typeof lf.fetchObservations>[0]);
        return (obs?.data ?? []) as Array<Record<string, any>>;
      })
    );
    const observations = pages.flat();

    const totals = new Map<
      string,
      { cost: number; calls: number; unpriced: number; input: number; output: number; derived: boolean }
    >();
    for (const o of observations) {
      const traceId = typeof o.traceId === "string" ? o.traceId : "";
      if (!traceIds.has(traceId)) continue;
      const name = typeof o.name === "string" ? o.name : "other";
      const model = String(o.model ?? "");

      // usageDetails/costDetails are the live fields; usage and
      // calculatedTotalCost are deprecated and are not populated on every
      // ingestion path — reading only those is what made transcription look
      // unpriced even though the tokens were there all along.
      const usage = (o.usageDetails ?? {}) as Record<string, number>;
      const costs = (o.costDetails ?? {}) as Record<string, number>;
      const input = num(usage.input) ?? num(o.promptTokens) ?? 0;
      const output = num(usage.output) ?? num(o.completionTokens) ?? 0;
      let cost = num(costs.total) ?? num(o.calculatedTotalCost) ?? 0;

      let derived = false;
      if (cost === 0) {
        const own = priceTokens(model, input, output);
        if (own !== null) {
          cost = own;
          derived = true;
          derivedPerTrace.set(traceId, (derivedPerTrace.get(traceId) ?? 0) + own);
        }
      }

      const entry =
        totals.get(name) ?? { cost: 0, calls: 0, unpriced: 0, input: 0, output: 0, derived: false };
      entry.cost += cost;
      entry.calls += 1;
      entry.input += input;
      entry.output += output;
      if (cost === 0) entry.unpriced += 1;
      if (derived) entry.derived = true;
      totals.set(name, entry);
    }
    for (const [name, v] of totals) {
      // A stage with calls but no cost is UNPRICED, not free. Saying so is the
      // difference between "transcription is cheap" and "we cannot see what
      // transcription costs", which are opposite conclusions.
      byStage.push({
        name,
        cost: v.cost,
        calls: v.calls,
        unpriced: v.unpriced === v.calls,
        inputTokens: v.input || undefined,
        outputTokens: v.output || undefined,
        derived: v.derived || undefined,
      });
    }
    byStage.sort((a, b) => b.cost - a.cost);
  } catch (err) {
    log.warn("Could not read the per-stage cost split — showing totals only.", err);
  }

  const calls: EvaluationCostDto[] = rows.map((t) => {
    const meta = (t.metadata ?? {}) as Record<string, unknown>;
    const traceId = String(t.id ?? "");
    return {
      traceId,
      recordingId: typeof meta.recordingId === "string" ? meta.recordingId : (t.sessionId ?? null),
      candidateName: typeof meta.candidateName === "string" ? meta.candidateName : null,
      jobTitle: typeof meta.jobTitle === "string" ? meta.jobTitle : null,
      audioMinutes: num(meta.audioMinutes),
      // Langfuse's total plus whatever it could not price itself. Additive
      // rather than a recomputed sum, because the observation page is capped
      // and summing a partial set would silently undercount.
      cost: (num(t.totalCost) ?? 0) + (derivedPerTrace.get(traceId) ?? 0),
      latencySeconds: num(t.latency),
      at: String(t.timestamp ?? new Date().toISOString()),
      traceUrl: typeof t.htmlPath === "string" ? env.langfuseBaseUrl + t.htmlPath : null,
    };
  });

  const totalCost = calls.reduce((sum, c) => sum + c.cost, 0);
  const priced = calls.filter((c) => c.cost > 0);
  return {
    configured: true,
    calls,
    totalCost,
    // An average over rows that all priced at zero would read as "free"
    // rather than "unpriced", so it is withheld instead.
    averageCost: priced.length ? totalCost / priced.length : null,
    byStage,
    currency: "USD",
    missingPricing: calls.length > 0 && priced.length === 0,
  };
}
