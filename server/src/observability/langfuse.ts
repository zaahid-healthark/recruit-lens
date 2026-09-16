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

/** Records one model call against a trace. Safe to call with a null trace. */
export function recordGeneration(trace: EvaluationTrace, gen: GenerationInput): void {
  if (!trace) return;
  try {
    const capture = env.langfuseCaptureContent;
    trace.generation({
      name: gen.name,
      model: gen.model,
      startTime: gen.startedAt,
      endTime: new Date(),
      usageDetails: toUsageDetails(gen.usage),
      input: capture ? gen.input : undefined,
      output: capture ? gen.output : undefined,
      metadata: {
        ...gen.metadata,
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

  const calls: EvaluationCostDto[] = rows.map((t) => {
    const meta = (t.metadata ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    return {
      traceId: String(t.id ?? ""),
      recordingId: typeof meta.recordingId === "string" ? meta.recordingId : (t.sessionId ?? null),
      candidateName: typeof meta.candidateName === "string" ? meta.candidateName : null,
      jobTitle: typeof meta.jobTitle === "string" ? meta.jobTitle : null,
      audioMinutes: num(meta.audioMinutes),
      cost: num(t.totalCost) ?? 0,
      latencySeconds: num(t.latency),
      at: String(t.timestamp ?? new Date().toISOString()),
      traceUrl: typeof t.htmlPath === "string" ? env.langfuseBaseUrl + t.htmlPath : null,
    };
  });

  // The stage split is the number worth knowing — it says whether
  // transcription really is the larger half, which decides what is worth
  // optimising. Observations are fetched separately; traces carry only ids.
  const byStage: CostStageDto[] = [];
  try {
    const obs = await lf.fetchObservations({ type: "GENERATION", limit: Math.min(limit * 3, 100) });
    const totals = new Map<string, { cost: number; calls: number }>();
    for (const o of (obs?.data ?? []) as Array<Record<string, any>>) {
      const name = typeof o.name === "string" ? o.name : "other";
      const cost = typeof o.calculatedTotalCost === "number" ? o.calculatedTotalCost : 0;
      const entry = totals.get(name) ?? { cost: 0, calls: 0 };
      entry.cost += cost;
      entry.calls += 1;
      totals.set(name, entry);
    }
    for (const [name, v] of totals) byStage.push({ name, cost: v.cost, calls: v.calls });
    byStage.sort((a, b) => b.cost - a.cost);
  } catch (err) {
    log.warn("Could not read the per-stage cost split — showing totals only.", err);
  }

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
