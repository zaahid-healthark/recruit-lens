import {
  EvaluationDto,
  JobRankingDto,
  RankedCandidateDto,
  toDisplayScore,
} from "@interview-evaluator/shared";
import { Evaluation, Job, Recording } from "@prisma/client";
import { toEvaluationDto } from "../lib/dto";
import { band, summariseGate } from "./gate";
import { notFound } from "../lib/errors";
import { prisma } from "../lib/prisma";

/**
 * Ranks a job's candidates against each other and says why.
 *
 * Every number and every sentence here is derived from evidence already stored
 * on the evaluation. Nothing asks a model to choose between two people: a
 * pipeline that approves and rejects candidates has to be able to answer "why
 * was she ranked above him?" with something that survives scrutiny, and
 * "she met seven of eight requirements to his four" does. Generated prose
 * about who felt stronger does not.
 *
 * Two rules keep the ranking honest, and both exist to stop a thin interview
 * masquerading as a weak candidate:
 *
 *   1. A candidate the interview never tested is SET ASIDE, not ranked last.
 *      Ranking them would put an unasked question on the candidate's record.
 *   2. When candidates were interviewed to very different depths, the ranking
 *      says so rather than presenting the order as settled.
 */

/** Below this many questions apart, two interviews are not really comparable. */
const UNEVEN_QUESTION_GAP = 3;
/** Deciding scores closer than this are a tie, whatever the sort order says. */
const TIE_MARGIN = 5;

interface Candidate extends RankedCandidateDto {
  /** Kept out of the DTO — only the ordering needs it. */
  _sortKey: number[];
}

function countRequirements(
  evaluation: EvaluationDto | null
): RankedCandidateDto["requirementCounts"] {
  const counts = { met: 0, partial: 0, missing: 0, notDiscussed: 0 };
  for (const r of evaluation?.jdMatch?.requirements ?? []) {
    if (r.verdict === "met") counts.met++;
    else if (r.verdict === "partial") counts.partial++;
    else if (r.verdict === "missing") counts.missing++;
    else counts.notDiscussed++;
  }
  return counts;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The case for where this candidate sits, in the evidence's own terms. */
function buildReasons(c: RankedCandidateDto, hasJd: boolean): string[] {
  const reasons: string[] = [];
  const req = c.requirementCounts;
  const totalRequirements = req.met + req.partial + req.missing + req.notDiscussed;

  // Led with, because it is what the gate decided on.
  if (c.technicalAsked > 0) {
    reasons.push(
      `Answered ${c.technicalAnswered} of ${plural(c.technicalAsked, "technical question")} ` +
        `adequately or better` +
        (c.technicalScore !== null ? `, scoring ${toDisplayScore(c.technicalScore)} across them` : "") +
        "."
    );
  } else if (c.questionsAsked > 0) {
    reasons.push(
      "The recruiter asked no technical questions, so this call could not test the thing " +
        "the screen exists to check. That is a gap in the interview, not in the candidate."
    );
  }

  if (hasJd && totalRequirements > 0) {
    const probed = req.met + req.partial + req.missing;
    reasons.push(
      `Met ${req.met} of ${totalRequirements} job requirements outright` +
        (req.partial > 0 ? `, ${req.partial} partially` : "") +
        (req.missing > 0 ? `, and fell short on ${plural(req.missing, "requirement")}` : "") +
        (req.notDiscussed > 0
          ? `. ${plural(req.notDiscussed, "requirement")} never came up in the interview` +
            `, so ${req.notDiscussed === 1 ? "it was" : "they were"} left out of the fit score`
          : "") +
        ".",
      );
    if (probed === 0) {
      reasons.push("The interview probed none of the job requirements directly.");
    }
  }

  if (c.behaviouralScore !== null) {
    reasons.push(`Behavioural and situational answers scored ${toDisplayScore(c.behaviouralScore!)}.`);
  }
  if (c.questionsAsked === 0) {
    reasons.push("The recruiter asked nothing substantive — no answers were graded.");
  }

  if (c.categoriesScored < 5) {
    reasons.push(
      `${5 - c.categoriesScored} of the 5 assessment areas were never tested, so ` +
        `${c.decision === "insufficient_evidence" ? "there is not enough on record to score this candidate" : "the score rests on the areas that were"}.`
    );
  }

  // The disagreement itself is the finding, and it is the one a recruiter most
  // wants flagged: a CV that fits the role but an interview that did not back
  // it up, or the reverse.
  if (hasJd && c.fitScore !== null && c.overallScore !== null && band(c.fitScore) !== band(c.overallScore)) {
    reasons.push(
      (c.fitScore > c.overallScore
        ? `Matches the role on paper (fit ${toDisplayScore(c.fitScore)}) more than the call itself ` +
          `showed (${toDisplayScore(c.overallScore)}).`
        : `Interviewed better overall (${toDisplayScore(c.overallScore)}) than this role's specific ` +
          `requirements were shown to be met (fit ${toDisplayScore(c.fitScore)}).`) +
        " Context for the next round, not part of this decision — a 15-20 minute screen " +
        "cannot probe a whole job description."
    );
  }

  if (c.decision === "reject") {
    reasons.push(
      "Not put forward because the transcript shows the candidate falling short on the " +
        "basics — not because the interview was short or because they did not go deep."
    );
  }
  if (c.decision === "insufficient_evidence") {
    reasons.push(
      "Set aside rather than ranked: this is a gap in the interview, not a mark against " +
        "the candidate. Re-interview before deciding."
    );
  }
  return reasons;
}

/** Why `a` placed above `b`, naming the largest real differences first. */
function explainAhead(a: RankedCandidateDto, b: RankedCandidateDto, hasJd: boolean): string {
  const label = b.candidateName || b.originalFilename;
  const diffs: string[] = [];

  if (
    (a.technicalAsked > 0 || b.technicalAsked > 0) &&
    a.technicalAnswered !== b.technicalAnswered
  ) {
    diffs.push(
      `answered ${a.technicalAnswered} of ${a.technicalAsked} technical questions to ` +
        `${b.technicalAnswered} of ${b.technicalAsked}`
    );
  }
  if (a.technicalScore !== null && b.technicalScore !== null && a.technicalScore !== b.technicalScore) {
    diffs.push(`technical answers ${toDisplayScore(a.technicalScore)} against ${toDisplayScore(b.technicalScore)}`);
  }
  if (hasJd && a.fitScore !== null && b.fitScore !== null && a.fitScore !== b.fitScore) {
    diffs.push(`JD fit ${toDisplayScore(a.fitScore)} against ${toDisplayScore(b.fitScore)}`);
  }
  if (a.requirementCounts.met !== b.requirementCounts.met) {
    diffs.push(`met ${a.requirementCounts.met} requirements to ${b.requirementCounts.met}`);
  }
  if (
    a.behaviouralScore !== null &&
    b.behaviouralScore !== null &&
    a.behaviouralScore !== b.behaviouralScore
  ) {
    diffs.push(`behavioural answers ${toDisplayScore(a.behaviouralScore)} against ${toDisplayScore(b.behaviouralScore)}`);
  }
  if (a.overallScore !== null && b.overallScore !== null && a.overallScore !== b.overallScore) {
    diffs.push(`overall ${toDisplayScore(a.overallScore)} against ${toDisplayScore(b.overallScore)}`);
  }

  // Comparing depth-of-answer scores across interviews of very different
  // lengths is not like-for-like, and the ranking should not pretend it is.
  const uneven =
    Math.abs(a.questionsAsked - b.questionsAsked) >= UNEVEN_QUESTION_GAP
      ? ` They were asked ${a.questionsAsked} questions to ${label}'s ${b.questionsAsked}, so this is not a like-for-like comparison.`
      : "";

  // Nothing measurable separates them. Presenting that as a ranking is how a
  // pipeline turns noise into a rejection.
  if (diffs.length === 0) {
    return `Nothing in the evidence separates them from ${label} — treat the order between them as arbitrary.${uneven}`;
  }

  // The deciding scores are level or near-level, so the placement rests
  // entirely on the tie-breaks. Say which, rather than implying a clear win.
  const gap =
    a.decidingScore !== null && b.decidingScore !== null
      ? Math.abs(a.decidingScore - b.decidingScore)
      : null;
  if (gap !== null && gap <= TIE_MARGIN) {
    const level =
      gap === 0
        ? `level with ${label} on the deciding score (${toDisplayScore(a.decidingScore!)} each)`
        : `within ${(gap / 10).toFixed(1)} of ${label} on the deciding score`;
    return `Ranked above ${label} only on the tie-breaks — ${level}, separated on ${diffs.join(", ")}.${uneven}`;
  }

  return `Ahead of ${label} on ${diffs.join(", ")}.${uneven}`;
}

function comparabilityNotes(
  ranked: RankedCandidateDto[],
  setAside: RankedCandidateDto[],
  hasJd: boolean
): string[] {
  const notes: string[] = [];

  if (!hasJd) {
    notes.push(
      "No job description is attached, so candidates are ranked on overall interview " +
        "performance rather than fit for this role. Attach a JD and re-evaluate for a " +
        "requirement-by-requirement comparison."
    );
  }

  const asked = ranked.map((c) => c.questionsAsked);
  if (asked.length > 1) {
    const min = Math.min(...asked);
    const max = Math.max(...asked);
    if (max - min >= UNEVEN_QUESTION_GAP) {
      notes.push(
        `These candidates were interviewed unevenly — between ${min} and ${max} questions ` +
          `were asked. The candidate asked more questions had more chances to show what they know, ` +
          `and more chances to get something wrong. Weigh the ranking accordingly.`
      );
    }
  }

  const noJdMatch = ranked.filter((c) => c.fitScore === null).length;
  if (hasJd && noJdMatch > 0) {
    notes.push(
      `${plural(noJdMatch, "candidate")} has no JD fit score, usually because the job was ` +
        `attached after the evaluation ran. Re-evaluate them to rank on the same basis as the rest.`
    );
  }

  if (setAside.length > 0) {
    notes.push(
      `${plural(setAside.length, "candidate")} could not be ranked: their interviews did not ` +
        `establish enough to judge. They are set aside, not rejected.`
    );
  }
  return notes;
}

export async function getJobRanking(jobId: string): Promise<JobRankingDto> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      recordings: {
        // Trashing a candidate has to remove them from the decision, not just
        // from the library — otherwise they keep appearing in a ranking that
        // someone hires from.
        where: { trashedAt: null },
        include: { evaluation: true },
        orderBy: { importedAt: "desc" },
      },
    },
  });
  if (!job) throw notFound("Job not found");
  return rankJob(job);
}

/**
 * The ranking itself, with no database access: a job and its (untrashed)
 * recordings in, the ordered ranking and its reasons out. Kept pure so it can
 * be exercised without Postgres — the UI preview server ranks its fixtures
 * through exactly this function.
 */
export function rankJob(
  job: Job & { recordings: (Recording & { evaluation: Evaluation | null })[] }
): JobRankingDto {
  const hasJd = job.jdText.trim().length > 0;

  const candidates: Candidate[] = job.recordings.map((r) => {
    const evaluation = r.evaluation ? toEvaluationDto(r.evaluation) : null;
    const qa = evaluation?.questionAssessment ?? null;
    const fitScore = evaluation?.jdMatch?.fitScore ?? null;
    const overallScore = evaluation?.overallScore ?? null;
    // The same rule every other screen uses, so the ranking can never disagree
    // with the report about the person it is ranking.
    const gate = evaluation
      ? summariseGate(evaluation, hasJd)
      : {
          decision: "insufficient_evidence" as const,
          decidingScore: null,
          technicalScore: null,
          technicalAsked: 0,
          technicalAnswered: 0,
          communicationScore: null,
        };
    const { decidingScore, technicalScore, technicalAsked, technicalAnswered } = gate;

    const base: RankedCandidateDto = {
      recordingId: r.id,
      candidateName: r.candidateName,
      originalFilename: r.originalFilename,
      rank: null,
      decision: gate.decision,
      decidingScore,
      overallScore,
      fitScore,
      technicalScore,
      behaviouralScore: qa?.behaviouralScore ?? null,
      requirementCounts: countRequirements(evaluation),
      questionsAsked: qa?.questions.length ?? 0,
      technicalAsked,
      technicalAnswered,
      categoriesScored: (evaluation?.categories ?? []).filter((c) => c.score !== null).length,
      reasons: [],
      aheadOfNext: null,
    };
    // A recording with no report yet is set aside for a reason that has
    // nothing to do with the interview — saying "re-interview" about a call
    // that is still transcribing, or one whose run failed, would be wrong.
    base.reasons = !evaluation && r.status === "FAILED"
      ? ["The evaluation failed. Re-run it from the report to rank this candidate."]
      : !evaluation && r.status !== "EVALUATED"
        ? ["Still being evaluated — ranked as soon as the report is ready."]
        : buildReasons(base, hasJd);
    return {
      ...base,
      // Descending on each: the deciding score, then how many technical
      // questions actually landed, then the rest a recruiter would reach for.
      _sortKey: [
        decidingScore ?? -1,
        technicalAnswered,
        technicalScore ?? -1,
        base.overallScore ?? -1,
        base.requirementCounts.met,
        base.behaviouralScore ?? -1,
      ],
    };
  });

  const setAside = candidates.filter((c) => c.decision === "insufficient_evidence");
  const ranked = candidates
    .filter((c) => c.decision !== "insufficient_evidence")
    .sort((a, b) => {
      for (let i = 0; i < a._sortKey.length; i++) {
        if (a._sortKey[i] !== b._sortKey[i]) return b._sortKey[i] - a._sortKey[i];
      }
      return (a.candidateName ?? a.originalFilename).localeCompare(
        b.candidateName ?? b.originalFilename
      );
    });

  ranked.forEach((c, i) => {
    c.rank = i + 1;
    const next = ranked[i + 1];
    c.aheadOfNext = next ? explainAhead(c, next, hasJd) : null;
  });

  const strip = ({ _sortKey, ...rest }: Candidate): RankedCandidateDto => rest;
  return {
    job: { id: job.id, title: job.title },
    hasJd,
    ranked: ranked.map(strip),
    setAside: setAside.map(strip),
    comparabilityNotes: comparabilityNotes(ranked, setAside, hasJd),
    generatedAt: new Date().toISOString(),
  };
}
