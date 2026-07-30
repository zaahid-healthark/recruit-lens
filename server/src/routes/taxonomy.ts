import { Router } from "express";
import { taxonomyDto } from "../config/taxonomy";

export const taxonomyRouter = Router();

// GET /taxonomy — current departments/sub-categories (drives the app's filters).
// Served straight from the config file (the single source of truth); the DB
// mirror exists for relational reporting and is refreshed by the seed script.
taxonomyRouter.get("/", (_req, res) => {
  res.json(taxonomyDto());
});
