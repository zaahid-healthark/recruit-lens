import { RequestHandler } from "express";
import { env } from "../config/env";

/**
 * Simple shared-secret auth: every request (except /health, mounted before this)
 * must carry `x-api-key: <API_KEY>`.
 *
 * TODO(auth): this is the seam for real recruiter accounts later — replace with
 * JWT/OAuth middleware here and per-user data scoping in the routes.
 */
export const apiKeyAuth: RequestHandler = (req, res, next) => {
  const key = req.header("x-api-key");
  if (key && key === env.apiKey) {
    next();
    return;
  }
  res.status(401).json({
    error: { code: "UNAUTHORIZED", message: "Missing or invalid x-api-key header" },
  });
};
