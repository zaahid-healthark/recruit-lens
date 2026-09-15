-- Per-question grading is no longer technical-only: behavioural, situational,
-- experience and motivation answers are graded the same way, because a
-- recruiter judges a candidate on every answer, not just the technical ones.
--
-- The column is renamed rather than replaced so any rows written between the
-- two migrations keep their questions. Their entries simply lack a "kind",
-- which the DTO reader defaults to "technical" — the only kind that existed
-- when they were written.
ALTER TABLE "Evaluation" RENAME COLUMN "technicalAssessmentJson" TO "questionAssessmentJson";
