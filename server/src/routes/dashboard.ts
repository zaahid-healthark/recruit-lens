import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { getDashboardStats } from "../services/dashboard";

export const dashboardRouter = Router();

// GET /dashboard/stats — aggregates for the Dashboard screen
dashboardRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    res.json(await getDashboardStats());
  })
);
