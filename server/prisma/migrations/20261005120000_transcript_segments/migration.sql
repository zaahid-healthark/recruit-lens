-- Timed diarized turns, so the report can play audio from any transcript line.
ALTER TABLE "Transcript" ADD COLUMN "segmentsJson" JSONB;
