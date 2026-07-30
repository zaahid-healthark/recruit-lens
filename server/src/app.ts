import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { apiKeyAuth } from "./middleware/apiKey";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { dashboardRouter } from "./routes/dashboard";
import { evaluateRouter } from "./routes/evaluate";
import { recordingsRouter } from "./routes/recordings";
import { taxonomyRouter } from "./routes/taxonomy";

export function createApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Unauthenticated health check — handy for connectivity debugging from the phone.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, mockAi: env.mockAi });
  });

  app.use(apiKeyAuth);
  app.use("/recordings", recordingsRouter);
  app.use("/evaluate", evaluateRouter);
  app.use("/dashboard", dashboardRouter);
  app.use("/taxonomy", taxonomyRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
