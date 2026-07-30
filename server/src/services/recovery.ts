import { log } from "../lib/logger";
import { prisma } from "../lib/prisma";

/**
 * Startup safety net: any recording left mid-pipeline (TRANSCRIBING/SCORING)
 * by a crash or restart is reset to UNEVALUATED so nothing is ever stuck in a
 * transient state. The next single or bulk evaluation simply picks it up again.
 */
export async function recoverStuckRecordings(): Promise<void> {
  const result = await prisma.recording.updateMany({
    where: { status: { in: ["TRANSCRIBING", "SCORING"] } },
    data: {
      status: "UNEVALUATED",
      errorMessage: "Evaluation was interrupted by a server restart — run it again.",
    },
  });
  if (result.count > 0) {
    log.warn(`Recovered ${result.count} recording(s) that were stuck mid-pipeline.`);
  }
}
