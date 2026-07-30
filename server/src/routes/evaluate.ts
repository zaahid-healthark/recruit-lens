import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { getBulkStatus, startBulkEvaluation } from "../services/bulk";

export const evaluateRouter = Router();

// POST /evaluate/bulk — evaluate all UNEVALUATED recordings (no-op if already running)
evaluateRouter.post(
  "/bulk",
  asyncHandler(async (_req, res) => {
    res.status(202).json(await startBulkEvaluation());
  })
);

// GET /evaluate/bulk/status — poll bulk progress
evaluateRouter.get("/bulk/status", (_req, res) => {
  res.json(getBulkStatus());
});
