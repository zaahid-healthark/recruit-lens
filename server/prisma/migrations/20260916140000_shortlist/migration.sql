-- Shortlisting: a human decision, taken after reading the report, that a
-- candidate is worth a next round. Deliberately separate from every score the
-- AI produces — the model advises, the recruiter decides.
ALTER TABLE "Recording" ADD COLUMN "shortlistedAt" TIMESTAMP(3);
-- Contact number, typed and saved by a person rather than inferred, because a
-- wrong number on a shortlist means calling the wrong candidate.
ALTER TABLE "Recording" ADD COLUMN "phoneNumber" TEXT;
CREATE INDEX "Recording_shortlistedAt_idx" ON "Recording"("shortlistedAt");
