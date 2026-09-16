-- Reusable scoring steers. A recruiter settles on a few phrasings and reuses
-- them; retyping one from memory per candidate is how the basis for judging
-- two people supposedly screened the same way quietly diverges.
CREATE TABLE "InstructionPreset" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstructionPreset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InstructionPreset_label_idx" ON "InstructionPreset"("label");
