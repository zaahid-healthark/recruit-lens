import cors from "cors";
import express from "express";
import path from "path";
import { env } from "./config/env";
import { apiKeyAuth } from "./middleware/apiKey";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { dashboardRouter } from "./routes/dashboard";
import { evaluateRouter } from "./routes/evaluate";
import { jobsRouter } from "./routes/jobs";
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

  /**
   * Browser client, served by this same process so there is no second thing to
   * deploy. Mounted before the API-key gate on purpose: the page holds no
   * secrets, it asks the user for the key and then sends it on every request
   * exactly as the mobile app does.
   *
   * In production nginx proxies /interview/api/ here with a trailing slash, so
   * this lands at https://<host>/interview/api/app/. The page derives the API
   * root from its own URL rather than having one baked in, which is what keeps
   * that prefix from needing to be configured anywhere.
   */
  const webDir = path.resolve(__dirname, "..", "web");
  // Every redirect here is RELATIVE on purpose. Behind the path prefix an
  // absolute "/app/" resolves against the domain root, lands outside the
  // proxied location block and 404s — the same trailing-slash trap the nginx
  // config documents. express.static's own directory redirect is absolute,
  // hence redirect:false and the explicit handler below.
  // Express matches "/app" and "/app/" with the same route, so the
  // already-canonical form has to fall through to the static mount instead of
  // redirecting to itself forever.
  app.get("/app", (req, res, next) => {
    if (req.originalUrl.split("?")[0].endsWith("/")) {
      next();
      return;
    }
    res.redirect("app/");
  });
  app.use("/app", express.static(webDir, { redirect: false }));
  app.get("/", (_req, res) => res.redirect("app/"));

  app.use(apiKeyAuth);
  app.use("/recordings", recordingsRouter);
  app.use("/jobs", jobsRouter);
  app.use("/evaluate", evaluateRouter);
  app.use("/dashboard", dashboardRouter);
  app.use("/taxonomy", taxonomyRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
