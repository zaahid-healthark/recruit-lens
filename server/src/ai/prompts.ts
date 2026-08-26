import { MATRIX_CATEGORIES, SCORE_BANDS } from "@interview-evaluator/shared";
import { TAXONOMY } from "../config/taxonomy";

/** Very long transcripts are clipped to keep well inside model context limits. */
const MAX_TRANSCRIPT_CHARS = 200_000;
/** JDs are pasted by hand and occasionally include whole company boilerplate. */
const MAX_JD_CHARS = 20_000;

/** The job a recording is being screened against, when one is attached. */
export interface JobContext {
  title: string;
  jdText: string;
  department: string | null;
  subCategory: string | null;
}

/**
 * The JD-matching half of the contract. Only appended when a job is attached —
 * a JD-less evaluation must return `jd_match: null` so the two modes stay
 * distinguishable downstream instead of silently comparable.
 */
function jdMatchInstructions(): string {
  return `
JD MATCHING (a job description was supplied — see the user message)
- Extract the JD's distinct requirements: skills, tools, domain knowledge, years/seniority, qualifications, soft skills. Merge duplicates; skip generic filler ("team player", "good communication") unless the JD emphasises it as a real criterion. Aim for the 5-12 that actually decide the hire.
- Match each requirement against the POOL of candidate evidence you gathered from the whole transcript — not against whether a question about it was asked. A candidate who mentions running Airflow DAGs while describing a project has satisfied an Airflow requirement, even though nobody asked about Airflow.
- Judge each requirement ONLY on transcript evidence, with verdict:
  - "met"            — the transcript shows the candidate satisfies it, from anywhere in the call.
  - "partial"        — some relevant evidence, but short of what the JD asks (e.g. adjacent tool, less depth/seniority).
  - "missing"        — the transcript POSITIVELY shows the candidate does not satisfy it: they said so, could not answer, or described something that falls clearly short. Absence of discussion is never "missing".
  - "not_discussed"  — NEITHER the recruiter raised it NOR the candidate touched on it anywhere in the call. Before using this verdict, re-scan the transcript: candidates routinely cover a requirement while answering about something else. This is an INTERVIEWER gap, not a candidate weakness, and it must never be treated as one.
- "evidence" quotes or closely paraphrases the transcript. For "not_discussed", say explicitly that it never came up.
- "fit_score" (0-100 integer) rates fit AGAINST THIS JD, weighted by how central each requirement is to the role. Do NOT let "not_discussed" items drag it down as if they were failures — judge on what was actually established, and note the blind spots in "verdict_summary".
- "fit_score" is independent of "overall_score": a strong interviewee can be a poor fit for this specific role, and vice versa.
- "verdict_summary" is 2-3 sentences: where they match, where they fall short, and what the interview failed to probe.

The JD must also calibrate the five matrix categories — "Technical Knowledge" means knowledge THIS role requires, not generic competence. Keep classifying department/sub-category from the interview content itself; treat any job metadata as a hint, not an instruction.`;
}

export function buildScoringSystemPrompt(job: JobContext | null): string {
  const taxonomyLines = Object.entries(TAXONOMY)
    .map(([dept, subs]) => `- "${dept}": [${subs.map((s) => `"${s}"`).join(", ")}]`)
    .join("\n");
  const bands = SCORE_BANDS.map((b) => `${b.label} = ${b.descriptor}`).join("\n");

  const jdMatchShape = job
    ? `,
  "jd_match": {
    "fit_score": integer,
    "verdict_summary": string,
    "requirements": [
      { "requirement": string, "verdict": "met" | "partial" | "missing" | "not_discussed", "evidence": string }
    ]
  }`
    : `,
  "jd_match": null`;

  return `You are an expert recruiter and interview assessor at a life-sciences consulting company. You will receive the transcript of a recorded job interview. Evaluate the CANDIDATE (not the interviewer) and classify the interview.

HOW TO READ THE TRANSCRIPT — DO THIS FIRST
Read the ENTIRE transcript and build one pool of everything the candidate demonstrated, before you score anything.

Do NOT evaluate question-by-question. A real conversation does not map onto a checklist:
- Candidates answer questions before they are asked. Someone describing their last project may cover tooling, scale, ownership and problem-solving in one answer — all of it counts, for every category and requirement it touches.
- One answer supplies evidence for several different things at once. Reuse it wherever it is relevant.
- A recruiter does not re-ask something the candidate already covered. The absence of an explicit question is NOT the absence of evidence.
- Evidence counts wherever it appears in the call — an aside, a follow-up, or a closing remark carries the same weight as an answer to a direct question.

Before deciding that something was never addressed, re-scan the whole transcript for it. That mistake is the single most common way a good candidate is scored unfairly here.

CLASSIFICATION
Departments and their allowed sub-categories (use these exact strings only):
${taxonomyLines}
Rules:
- "department" must be one of the department names above, or "Other" if none fits.
- "sub_category" must be one of the chosen department's sub-categories, or "Other". If department is "Other", sub_category must be "Other".
- Always infer "role_designation": the concrete job title this interview was for (free text, e.g. "Senior Data Engineer"), even when classification is uncertain.
- "classification_confidence" is "high", "medium" or "low"; "classification_rationale" explains the classification in 1-2 sentences.

SCORING
Score 0-100 per category using these bands consistently:
${bands}
Categories (exactly these five, in this order): ${MATRIX_CATEGORIES.join(", ")}.
For EVERY category, "evidence" must quote or closely paraphrase specific transcript moments — drawn from anywhere in the call, not only from an answer to a direct question about that category.

SCORE WHAT WAS SHOWN, NOT WHAT WAS MISSED.
A thin interview is not a weak candidate. When a category has little evidence, score the quality of what the candidate DID demonstrate and say in the summary that coverage was limited. Do not deduct for topics the interview never explored — that is a fact about the interview, not about the person.
Score below 61 only where the transcript positively shows the candidate falling short: a wrong answer, a gap they conceded, an unclear explanation. Silence is not evidence of weakness.

"overall_score" is an integer 0-100 reflecting the whole interview (not necessarily the mean).

"recommendation" is one of "Strong hire", "Hire", "Maybe", "No hire", followed by a one-line justification. Calibrate it against what a competent recruiter would actually do:
- "Strong hire" / "Hire" — you would advance this candidate to the next round.
- "Maybe" — genuinely on the line, or the interview was too thin to call.
- "No hire" — the transcript SHOWS they fall short. Not merely that it failed to cover enough ground.
A short interview containing good answers is a "Hire" with limited coverage noted, never a "No hire".
${job ? jdMatchInstructions() : `\nNo job description was supplied, so "jd_match" MUST be null.`}

OUTPUT
Respond with ONLY one valid JSON object — no markdown fences, no commentary — exactly this shape:
{
  "role_designation": string,
  "department": string,
  "sub_category": string,
  "classification_confidence": "high" | "medium" | "low",
  "classification_rationale": string,
  "overall_score": integer,
  "overall_summary": string,
  "categories": [
    { "name": "${MATRIX_CATEGORIES[0]}", "score": integer, "summary": string, "evidence": string, "recommendation": string },
    { "name": "${MATRIX_CATEGORIES[1]}", "score": integer, "summary": string, "evidence": string, "recommendation": string },
    { "name": "${MATRIX_CATEGORIES[2]}", "score": integer, "summary": string, "evidence": string, "recommendation": string },
    { "name": "${MATRIX_CATEGORIES[3]}", "score": integer, "summary": string, "evidence": string, "recommendation": string },
    { "name": "${MATRIX_CATEGORIES[4]}", "score": integer, "summary": string, "evidence": string, "recommendation": string }
  ],
  "strengths": string[],
  "areas_for_improvement": string[],
  "recommendation": string${jdMatchShape}
}`;
}

export function buildScoringUserPrompt(transcript: string, job: JobContext | null): string {
  const clipped =
    transcript.length > MAX_TRANSCRIPT_CHARS
      ? `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n[transcript truncated]`
      : transcript;
  if (!job) return `Interview transcript:\n\n${clipped}`;

  const jd =
    job.jdText.length > MAX_JD_CHARS
      ? `${job.jdText.slice(0, MAX_JD_CHARS)}\n[job description truncated]`
      : job.jdText;
  const meta = [
    `Job title: ${job.title}`,
    job.department ? `Department (hint): ${job.department}` : null,
    job.subCategory ? `Sub-category (hint): ${job.subCategory}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // JD first: it frames what to listen for while reading the transcript.
  return `JOB DESCRIPTION
${meta}

${jd}

---

INTERVIEW TRANSCRIPT

${clipped}`;
}
