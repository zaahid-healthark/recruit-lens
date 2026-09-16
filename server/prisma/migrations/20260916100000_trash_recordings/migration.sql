-- Soft delete for recordings.
--
-- A hiring record should be removable from view without being destroyed: the
-- existing DELETE also drops the transcript, the scores and the audio, which
-- is the wrong tool for "this one was a wrong number" or "we filled the role".
-- Trashed recordings stay in the database and stay restorable, but drop out of
-- the library, the candidate ranking and the dashboard counts.
ALTER TABLE "Recording" ADD COLUMN "trashedAt" TIMESTAMP(3);
CREATE INDEX "Recording_trashedAt_idx" ON "Recording"("trashedAt");
