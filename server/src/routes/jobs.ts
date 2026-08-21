import { OTHER_VALUE } from "@interview-evaluator/shared";
import { Router } from "express";
import { z } from "zod";
import { DEPARTMENT_NAMES, TAXONOMY } from "../config/taxonomy";
import { asyncHandler } from "../lib/asyncHandler";
import { toJobDto } from "../lib/dto";
import { badRequest, notFound } from "../lib/errors";
import { prisma } from "../lib/prisma";

/**
 * Job openings and their descriptions. A recording linked to a job is scored
 * against that JD requirement-by-requirement instead of against the model's
 * generic prior for the role — see server/src/ai/prompts.ts.
 */

/** Enough JD text to extract requirements from; below this it is a title, not a JD. */
const MIN_JD_CHARS = 40;

const taxonomyRefinement = (
  value: { department?: string | null; subCategory?: string | null },
  ctx: z.RefinementCtx
): void => {
  const { department, subCategory } = value;
  if (department && department !== OTHER_VALUE && !DEPARTMENT_NAMES.includes(department)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["department"],
      message: `department must be one of: ${[...DEPARTMENT_NAMES, OTHER_VALUE].join(", ")}`,
    });
    return;
  }
  if (!subCategory || subCategory === OTHER_VALUE) return;
  if (!department) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subCategory"],
      message: "subCategory requires a department",
    });
    return;
  }
  const validSubs = department === OTHER_VALUE ? [] : (TAXONOMY[department] ?? []);
  if (!validSubs.includes(subCategory)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subCategory"],
      message: `subCategory must be "${OTHER_VALUE}" or one of ${department}'s sub-categories`,
    });
  }
};

const createJobSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    jdText: z.string().trim().min(MIN_JD_CHARS, {
      message: `Paste the full job description (at least ${MIN_JD_CHARS} characters) — there is nothing to match against otherwise.`,
    }),
    department: z.string().trim().min(1).nullish(),
    subCategory: z.string().trim().min(1).nullish(),
  })
  .superRefine(taxonomyRefinement);

/** Every field optional; only what is sent gets changed. */
const updateJobSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    jdText: z.string().trim().min(MIN_JD_CHARS).optional(),
    department: z.string().trim().min(1).nullish(),
    subCategory: z.string().trim().min(1).nullish(),
    archived: z.boolean().optional(),
  })
  .superRefine(taxonomyRefinement);

const listQuerySchema = z.object({
  /** Archived jobs are hidden from the import picker by default. */
  includeArchived: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

/** recordingCount + averageOverallScore both come from this one include. */
const jobInclude = {
  recordings: { select: { evaluation: { select: { overallScore: true } } } },
} as const;

export const jobsRouter = Router();

// GET /jobs?includeArchived= — newest first
jobsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const jobs = await prisma.job.findMany({
      where: q.includeArchived ? {} : { archived: false },
      include: jobInclude,
      orderBy: { createdAt: "desc" },
    });
    res.json(jobs.map(toJobDto));
  })
);

// GET /jobs/:id
jobsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: jobInclude,
    });
    if (!job) throw notFound("Job not found");
    res.json(toJobDto(job));
  })
);

// POST /jobs
jobsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createJobSchema.parse(req.body ?? {});
    const job = await prisma.job.create({
      data: {
        title: body.title,
        jdText: body.jdText,
        department: body.department ?? null,
        subCategory: body.subCategory ?? null,
      },
      include: jobInclude,
    });
    res.status(201).json(toJobDto(job));
  })
);

// PATCH /jobs/:id — editing the JD does NOT re-score existing recordings;
// re-evaluate them explicitly to pick up the change.
jobsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = updateJobSchema.parse(req.body ?? {});
    const existing = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Job not found");
    if (Object.keys(body).length === 0) throw badRequest("No fields to update");

    const job = await prisma.job.update({
      where: { id: existing.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.jdText !== undefined ? { jdText: body.jdText } : {}),
        ...(body.department !== undefined ? { department: body.department ?? null } : {}),
        ...(body.subCategory !== undefined ? { subCategory: body.subCategory ?? null } : {}),
        ...(body.archived !== undefined ? { archived: body.archived } : {}),
      },
      include: jobInclude,
    });
    res.json(toJobDto(job));
  })
);

// DELETE /jobs/:id — hard delete. Linked recordings survive with jobId nulled
// (schema uses onDelete: SetNull), so evaluation history is never destroyed;
// archive instead (PATCH archived:true) to keep the link and hide the job.
jobsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const job = await prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job) throw notFound("Job not found");
    await prisma.job.delete({ where: { id: job.id } });
    res.status(204).send();
  })
);
