-- A score is a claim about the candidate, so it now requires evidence.
-- "The interview never tested this" is recorded as NULL rather than as a
-- fabricated mid-range number, which is what made thin calls read as
-- mediocre candidates.

-- Overall score is null when too few categories could be scored at all.
ALTER TABLE "Evaluation" ALTER COLUMN "overallScore" DROP NOT NULL;

-- What the interview did and did not cover — the caveat on every score.
ALTER TABLE "Evaluation" ADD COLUMN "coverageNote" TEXT;

-- Technical questions the recruiter actually asked, with the candidate's
-- answer graded one by one. NULL when none were asked.
ALTER TABLE "Evaluation" ADD COLUMN "technicalAssessmentJson" JSONB;
