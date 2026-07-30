import { MATRIX_CATEGORIES, SCORE_BANDS } from "@interview-evaluator/shared";
import { TAXONOMY } from "../config/taxonomy";

/** Very long transcripts are clipped to keep well inside model context limits. */
const MAX_TRANSCRIPT_CHARS = 200_000;

export function buildScoringSystemPrompt(): string {
  const taxonomyLines = Object.entries(TAXONOMY)
    .map(([dept, subs]) => `- "${dept}": [${subs.map((s) => `"${s}"`).join(", ")}]`)
    .join("\n");
  const bands = SCORE_BANDS.map((b) => `${b.label} = ${b.descriptor}`).join("\n");

  return `You are an expert recruiter and interview assessor at a life-sciences consulting company. You will receive the transcript of a recorded job interview. Evaluate the CANDIDATE (not the interviewer) and classify the interview.

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
For EVERY category, "evidence" must quote or closely paraphrase specific transcript moments. If the transcript gives little signal for a category, score conservatively and state that evidence is limited.
"overall_score" is an integer 0-100 reflecting the whole interview (not necessarily the mean).
"recommendation" is one of "Strong hire", "Hire", "Maybe", "No hire", followed by a one-line justification.

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
  "recommendation": string
}`;
}

export function buildScoringUserPrompt(transcript: string): string {
  const clipped =
    transcript.length > MAX_TRANSCRIPT_CHARS
      ? `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n[transcript truncated]`
      : transcript;
  return `Interview transcript:\n\n${clipped}`;
}
