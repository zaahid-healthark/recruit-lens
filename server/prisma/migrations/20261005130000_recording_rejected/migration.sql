-- A recruiter's "do not proceed" decision, kept as an outcome rather than a deletion.
ALTER TABLE "Recording" ADD COLUMN "rejectedAt" TIMESTAMP(3);
CREATE INDEX "Recording_rejectedAt_idx" ON "Recording"("rejectedAt");
