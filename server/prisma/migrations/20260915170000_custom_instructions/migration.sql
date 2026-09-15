-- A per-recording steer the recruiter types when starting an evaluation, e.g.
-- "weigh SQL depth heavily" or "this is a junior role, calibrate accordingly".
-- Directs what the scorer pays attention to; it cannot relax the evidence
-- rules, which stay in the system prompt where user text cannot reach them.
ALTER TABLE "Recording" ADD COLUMN "customInstructions" TEXT;
