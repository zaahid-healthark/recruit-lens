/**
 * Asserts the scoring prompt carries no bias about any role, field or answer.
 *
 * The prompt is where an evaluation can be quietly rigged. An example of a
 * "good answer" teaches the model what good answers sound like in ONE field,
 * and every candidate from another field is then measured against a bar nobody
 * set deliberately. Naming the company's industry does the same thing more
 * softly. Neither shows up as a failure — the scores just tilt, consistently,
 * for reasons no one can see in the output.
 *
 * So the rule is that the prompt may describe HOW to judge and never WHAT a
 * good answer contains. The role, the field and the subject matter all come
 * from the transcript at runtime.
 *
 * The classification block is the one deliberate exception: the taxonomy must
 * be listed for the report to be filed under a department. It is checked
 * separately, and the prompt fences it off from scoring in words.
 *
 *   npm run prompt:check -w server
 */
process.env.DATABASE_URL ||= "postgresql://x/y";
process.env.API_KEY ||= "test";

import { buildScoringSystemPrompt } from "../src/ai/prompts";

/** Terms that would tie the rubric to one field, industry, or toolset. */
const BANNED: Array<[string, RegExp]> = [
  ["specific tooling", /\b(airflow|kafka|spark|snowflake|bigquery|databricks|dbt|pyspark|kubernetes|terraform|pandas|numpy|tableau|power ?bi)\b/i],
  ["programming languages", /\b(python|javascript|typescript|golang|scala)\b/i],
  ["domain jargon", /\b(slowly changing dimension|scd type|dag\b|etl\b|data pipeline|materiali[sz]ed view|window function)\b/i],
  ["an industry", /\b(life[- ]sciences?|pharma\w*|biotech|healthcare|consulting (business|company|firm))\b/i],
  ["a named job family", /\b(data engineer|software engineer|epidemiolog\w+|biostatistic\w+|accountant|recruiter's field)\b/i],
];

/** The taxonomy is legitimate here and nowhere else. */
function splitOffClassification(prompt: string): { rubric: string; classification: string } {
  const marker = "CLASSIFICATION — FOR FILING ONLY";
  const i = prompt.indexOf(marker);
  if (i === -1) return { rubric: prompt, classification: "" };
  const end = prompt.indexOf("SCORING", i);
  return {
    rubric: prompt.slice(0, i) + prompt.slice(end === -1 ? prompt.length : end),
    classification: prompt.slice(i, end === -1 ? prompt.length : end),
  };
}

function report(label: string, ok: boolean, detail = ""): boolean {
  console.log((ok ? "PASS  " : "FAIL  ") + label + (ok || !detail ? "" : "  -> " + detail));
  return ok;
}

let failed = 0;
for (const withJob of [false, true]) {
  const prompt = buildScoringSystemPrompt(
    withJob
      ? { title: "", jdText: "REDACTED", department: null, subCategory: null }
      : null
  );
  const { rubric, classification } = splitOffClassification(prompt);
  const label = withJob ? "with a JD attached" : "no JD";
  console.log(`\n-- ${label} --`);

  for (const [what, re] of BANNED) {
    const hits = [...new Set((rubric.match(new RegExp(re.source, "gi")) ?? []).map((h) => h.toLowerCase()))];
    if (!report(`no ${what}`, hits.length === 0, hits.join(", "))) failed++;
  }

  // The taxonomy has to be present to classify, and fenced off from scoring.
  if (!withJob) {
    if (!report("taxonomy is present for classification", classification.length > 0)) failed++;
    if (
      !report(
        "taxonomy is fenced off from scoring",
        /must not touch a single score/i.test(classification) &&
          /never on which bucket/i.test(classification)
      )
    )
      failed++;
  }

  // The role has to come from the transcript, not from the prompt.
  if (!report("says the role is inferred, not assumed", /infer it from the interview itself/i.test(rubric)))
    failed++;
  if (
    !report(
      "says not to bring outside assumptions",
      /against nothing you brought with you/i.test(rubric)
    )
  )
    failed++;
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
