import { CostsDto, EvaluationCostDto } from "@interview-evaluator/shared";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler";
import { log } from "../lib/logger";
import { fetchCostTraces } from "../observability/langfuse";

/**
 * What each evaluation actually cost, read back from Langfuse.
 *
 * The figures live there because that is where token usage is priced; this
 * endpoint exists so nobody has to leave the app and work out which trace
 * belongs to which candidate. Traces are keyed by recording id, so the join
 * back to a report is exact rather than by timestamp.
 *
 * Read-only and best-effort: Langfuse being unreachable makes this screen
 * unavailable, never an evaluation.
 */

const querySchema = z.object({
  /** How many recent evaluations to price. */
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const costsRouter = Router();

costsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);
    try {
      res.json(await fetchCostTraces(q.limit ?? 50));
    } catch (err) {
      // A failure here is a reporting failure. Say so plainly rather than
      // returning an empty list, which would read as "these calls were free".
      const message = err instanceof Error ? err.message : String(err);
      log.warn("Could not read costs from Langfuse:", message);
      const body: CostsDto = {
        configured: true,
        error: message.slice(0, 300),
        calls: [] as EvaluationCostDto[],
        totalCost: 0,
        averageCost: null,
        byStage: [],
        currency: "USD",
      };
      res.json(body);
    }
  })
);
