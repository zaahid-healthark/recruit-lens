import { BulkStatusDto } from "@interview-evaluator/shared";
import { env } from "../config/env";
import { log } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { evaluateRecording } from "./pipeline";

const idleStatus = (): BulkStatusDto => ({
  running: false,
  total: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  currentRecordingId: null,
  startedAt: null,
  finishedAt: null,
});

/** In-memory job state — polled by the app via GET /evaluate/bulk/status. */
let status: BulkStatusDto = idleStatus();

export function getBulkStatus(): BulkStatusDto {
  return { ...status };
}

/**
 * Evaluate every UNEVALUATED recording (oldest first).
 *
 * - Safe to re-trigger: while a run is active this returns the current status
 *   without starting a second run, and each item is re-checked right before
 *   processing so anything evaluated in the meantime is skipped.
 * - Resumable: after a crash/restart the recovery hook resets in-flight rows
 *   to UNEVALUATED, so simply triggering bulk again picks them up.
 */
export async function startBulkEvaluation(): Promise<BulkStatusDto> {
  if (status.running) return getBulkStatus();

  const pending = await prisma.recording.findMany({
    where: { status: "UNEVALUATED" },
    orderBy: { importedAt: "asc" },
    select: { id: true },
  });

  status = {
    ...idleStatus(),
    running: pending.length > 0,
    total: pending.length,
    startedAt: new Date().toISOString(),
  };
  if (pending.length === 0) {
    status.finishedAt = new Date().toISOString();
    return getBulkStatus();
  }

  // Fire and forget — progress is observed by polling getBulkStatus().
  void runQueue(pending.map((p) => p.id)).catch((err) => {
    log.error("Bulk queue crashed unexpectedly:", err);
    status.running = false;
    status.finishedAt = new Date().toISOString();
  });
  return getBulkStatus();
}

async function runQueue(ids: string[]): Promise<void> {
  const queue = [...ids];
  const workerCount = Math.min(env.bulkConcurrency, queue.length);
  log.info(`Bulk evaluation started: ${queue.length} recording(s), concurrency ${workerCount}.`);
  await Promise.all(Array.from({ length: workerCount }, () => worker(queue)));
  status.running = false;
  status.currentRecordingId = null;
  status.finishedAt = new Date().toISOString();
  log.info(
    `Bulk evaluation finished: ${status.succeeded} succeeded, ${status.failed} failed, ${status.total} total.`
  );
}

async function worker(queue: string[]): Promise<void> {
  for (;;) {
    const id = queue.shift();
    if (!id) return;

    const current = await prisma.recording.findUnique({ where: { id }, select: { status: true } });
    if (!current) {
      status.processed += 1; // deleted while queued
      continue;
    }
    if (current.status !== "UNEVALUATED") {
      // Already handled elsewhere (e.g. a single evaluate ran meanwhile) — count, don't redo.
      status.processed += 1;
      if (current.status === "EVALUATED") status.succeeded += 1;
      continue;
    }

    status.currentRecordingId = id;
    await evaluateRecording(id); // never throws
    const after = await prisma.recording.findUnique({ where: { id }, select: { status: true } });
    status.processed += 1;
    if (after?.status === "EVALUATED") status.succeeded += 1;
    else status.failed += 1;
  }
}
