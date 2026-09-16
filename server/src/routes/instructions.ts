import { Router } from "express";
import { z } from "zod";
import { MAX_CUSTOM_INSTRUCTION_CHARS } from "../ai/prompts";
import { asyncHandler } from "../lib/asyncHandler";
import { toInstructionPresetDto } from "../lib/dto";
import { notFound } from "../lib/errors";
import { prisma } from "../lib/prisma";

/**
 * Saved scoring steers.
 *
 * A steer is free text the recruiter attaches to one evaluation ("junior role,
 * calibrate to 1-2 years"). Recruiters reuse a handful of phrasings, and
 * retyping one from memory per candidate is how two people supposedly screened
 * on the same basis end up judged differently. Saving them makes the basis
 * explicit and repeatable.
 *
 * These are templates only — nothing here changes how an existing evaluation
 * was scored, and applying one still just fills the box the user can edit.
 */

const bodySchema = z.object({
  label: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(MAX_CUSTOM_INSTRUCTION_CHARS),
});

/** Every field optional; only what is sent gets changed. */
const updateSchema = bodySchema.partial().refine((v) => Object.keys(v).length > 0, {
  message: "No fields to update",
});

export const instructionsRouter = Router();

// GET /instructions — newest first
instructionsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const presets = await prisma.instructionPreset.findMany({ orderBy: { createdAt: "desc" } });
    res.json(presets.map(toInstructionPresetDto));
  })
);

// POST /instructions
instructionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = bodySchema.parse(req.body ?? {});
    const preset = await prisma.instructionPreset.create({ data: body });
    res.status(201).json(toInstructionPresetDto(preset));
  })
);

// PATCH /instructions/:id
instructionsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body ?? {});
    const existing = await prisma.instructionPreset.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Saved instruction not found");
    const preset = await prisma.instructionPreset.update({
      where: { id: existing.id },
      data: body,
    });
    res.json(toInstructionPresetDto(preset));
  })
);

// DELETE /instructions/:id — removes the template only. Evaluations that used
// it keep their own copy of the text on the recording, so history is intact.
instructionsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.instructionPreset.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Saved instruction not found");
    await prisma.instructionPreset.delete({ where: { id: existing.id } });
    res.status(204).send();
  })
);
