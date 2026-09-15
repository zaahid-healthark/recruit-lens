/**
 * Runs the scoring rubric against fixture transcripts and checks the verdicts
 * a human recruiter would reach.
 *
 *   npm run score:check -w server                 # every scenario
 *   npm run score:check -w server -- terse        # just the ones matching
 *
 * Needs MOCK_AI=false and a real OPENAI_API_KEY — the point is to test the
 * model's judgement, which canned output cannot stand in for. Costs a few
 * cents per run: no audio is transcribed, only the scoring call is made.
 *
 * Two kinds of check run against every scenario:
 *   - EXPECTATIONS, per fixture: would a recruiter reach this verdict?
 *   - INVARIANTS, universal: is the report internally consistent — do the
 *     matrix scores actually follow the answers that were graded?
 */
import {
  BEHAVIOURAL_CATEGORIES,
  MIN_SCORED_CATEGORIES_FOR_OVERALL,
  PRIMARY_CATEGORY,
  TECHNICAL_CATEGORY,
} from "@interview-evaluator/shared";
import { ANSWER_CONSISTENCY_TOLERANCE } from "../src/ai/prompts";
import { scoreTranscript } from "../src/ai/score";
import { env } from "../src/config/env";
import type { ParsedLlmEvaluation } from "../src/schemas/evaluationSchema";
import { SCENARIOS, type Scenario } from "./fixtures/scoringScenarios";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const OFF = "\x1b[0m";

interface Failure {
  scenario: string;
  check: string;
  detail: string;
}

const failures: Failure[] = [];

function check(scenario: string, name: string, ok: boolean, detail: string): void {
  console.log(`   ${ok ? GREEN + "PASS" : RED + "FAIL"}${OFF}  ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures.push({ scenario, check: name, detail });
}

function categoryScore(result: ParsedLlmEvaluation, name: string): number | null {
  return result.categories.find((c) => c.name === name)?.score ?? null;
}

/** Per-fixture: the verdict a competent recruiter would reach. */
function checkExpectations(s: Scenario, result: ParsedLlmEvaluation): void {
  const e = s.expect;

  if (e.overallScore === "must-be-null") {
    check(
      s.name,
      "overall score withheld",
      result.overall_score === null,
      `got ${result.overall_score}, expected null`
    );
  } else {
    const got = result.overall_score;
    check(
      s.name,
      `overall score in ${e.overallScore.min}-${e.overallScore.max}`,
      got !== null && got >= e.overallScore.min && got <= e.overallScore.max,
      `got ${got === null ? "null" : got}`
    );
  }

  check(
    s.name,
    `recommendation is one of ${e.recommendationOneOf.join(" / ")}`,
    e.recommendationOneOf.some((r) =>
      result.recommendation.trim().toLowerCase().startsWith(r.toLowerCase())
    ),
    `got "${result.recommendation.slice(0, 90)}"`
  );

  const qa = result.question_assessment;
  if (e.questionAssessment === "must-be-null") {
    check(
      s.name,
      "no questions graded (none were substantive)",
      qa === null,
      `graded ${qa?.questions.length ?? 0} questions`
    );
  } else {
    check(s.name, "questions were graded", qa !== null, "question_assessment came back null");
  }

  if (e.technicalScore && qa) {
    const got = qa.technical_score;
    check(
      s.name,
      `technical answers score ${e.technicalScore.min}-${e.technicalScore.max}`,
      got !== null && got >= e.technicalScore.min && got <= e.technicalScore.max,
      `got ${got === null ? "null" : got}`
    );
  }

  if (e.communicationScore) {
    const got = categoryScore(result, PRIMARY_CATEGORY);
    check(
      s.name,
      `"${PRIMARY_CATEGORY}" scores ${e.communicationScore.min}-${e.communicationScore.max}`,
      got !== null && got >= e.communicationScore.min && got <= e.communicationScore.max,
      `got ${got === null ? "null" : got}`
    );
  }

  for (const name of e.categoriesMustBeNull ?? []) {
    check(
      s.name,
      `"${name}" left unscored`,
      categoryScore(result, name) === null,
      `got ${categoryScore(result, name)} — the interview never tested this`
    );
  }
}

/** Universal: the report must not contradict itself, whatever the scores are. */
function checkInvariants(s: Scenario, result: ParsedLlmEvaluation): void {
  const scored = result.categories.filter((c) => c.score !== null).length;

  if (scored < MIN_SCORED_CATEGORIES_FOR_OVERALL) {
    check(
      s.name,
      `overall withheld below ${MIN_SCORED_CATEGORIES_FOR_OVERALL} scored categories`,
      result.overall_score === null,
      `${scored} scored but overall is ${result.overall_score}`
    );
  }

  const qa = result.question_assessment;
  if (qa) {
    const bind = (categoryName: string, answerScore: number, label: string): void => {
      const cat = categoryScore(result, categoryName);
      check(
        s.name,
        `"${categoryName}" follows the ${label} answers`,
        cat !== null && Math.abs(cat - answerScore) <= ANSWER_CONSISTENCY_TOLERANCE,
        `category ${cat}, answers ${answerScore} (tolerance ${ANSWER_CONSISTENCY_TOLERANCE})`
      );
    };
    if (qa.technical_score !== null) bind(TECHNICAL_CATEGORY, qa.technical_score, "technical");
    if (qa.behavioural_score !== null) {
      for (const name of BEHAVIOURAL_CATEGORIES) bind(name, qa.behavioural_score, "behavioural");
    }

    // Every graded answer must quote the candidate. An answer with no evidence
    // is an opinion, and opinions are what we are trying to eliminate.
    const noEvidence = qa.questions.filter((q) => !q.evidence.trim()).length;
    check(s.name, "every graded answer cites evidence", noEvidence === 0, `${noEvidence} without`);
  }

  const scoredNoEvidence = result.categories.filter(
    (c) => c.score !== null && !c.evidence.trim()
  ).length;
  check(
    s.name,
    "every scored category cites evidence",
    scoredNoEvidence === 0,
    `${scoredNoEvidence} scored without evidence`
  );

  if (result.jd_match) {
    const probed = result.jd_match.requirements.some((r) => r.verdict !== "not_discussed");
    if (!probed) {
      check(
        s.name,
        "fit score withheld when nothing was probed",
        result.jd_match.fit_score === null,
        `got ${result.jd_match.fit_score}`
      );
    }
  }
}

async function main(): Promise<void> {
  if (env.mockAi) {
    console.error(
      `${RED}MOCK_AI is on.${OFF} This harness tests the model's judgement, which canned\n` +
        `output cannot stand in for. Set MOCK_AI=false and OPENAI_API_KEY in server/.env.`
    );
    process.exit(2);
  }
  if (!env.openaiApiKey) {
    console.error(`${RED}OPENAI_API_KEY is empty.${OFF} Set it in server/.env.`);
    process.exit(2);
  }

  const filter = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const chosen = filter.length
    ? SCENARIOS.filter((s) => filter.some((f) => s.name.includes(f)))
    : SCENARIOS;
  if (!chosen.length) {
    console.error(`No scenario matches ${filter.join(", ")}.`);
    process.exit(2);
  }

  console.log(`\nScoring ${chosen.length} scenario(s) with ${BOLD}${env.evalModel}${OFF}\n`);

  for (const s of chosen) {
    console.log(`${BOLD}${s.name}${OFF}`);
    console.log(`   ${DIM}trap: ${s.trap}${OFF}`);
    let result: ParsedLlmEvaluation;
    try {
      const outcome = await scoreTranscript(
        s.transcript,
        s.jd ? { ...s.jd, department: null, subCategory: null } : null
      );
      result = outcome.result;
    } catch (err) {
      check(s.name, "scoring completed", false, err instanceof Error ? err.message : String(err));
      console.log("");
      continue;
    }

    const qa = result.question_assessment;
    console.log(
      `   ${DIM}→ overall ${result.overall_score ?? "null"}, ` +
        `${result.categories.filter((c) => c.score !== null).length}/5 scored, ` +
        `${qa ? `${qa.questions.length} questions (tech ${qa.technical_score ?? "–"}, behav ${qa.behavioural_score ?? "–"})` : "no questions graded"}` +
        `${result.jd_match ? `, fit ${result.jd_match.fit_score ?? "null"}` : ""}${OFF}`
    );
    console.log(`   ${DIM}→ "${result.recommendation.slice(0, 100)}"${OFF}`);

    checkExpectations(s, result);
    checkInvariants(s, result);
    if (failures.some((f) => f.scenario === s.name)) {
      console.log(`   ${DIM}a recruiter would say: ${s.expect.rationale}${OFF}`);
    }
    console.log("");
  }

  if (!failures.length) {
    console.log(`${GREEN}${BOLD}All scenarios scored the way a recruiter would.${OFF}\n`);
    return;
  }
  console.log(`${RED}${BOLD}${failures.length} check(s) failed:${OFF}`);
  for (const f of failures) console.log(`  ${f.scenario} › ${f.check} — ${f.detail}`);
  console.log(
    `\n${DIM}These are judgement calls, not crashes. Re-run before changing anything —\n` +
      `models vary between runs. A check that fails consistently means the rubric in\n` +
      `server/src/ai/prompts.ts needs the fix, not the fixture.${OFF}\n`
  );
  process.exit(1);
}

void main();
