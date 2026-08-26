import fs from "fs/promises";
import { env } from "../config/env";
import { log } from "../lib/logger";
import { clipWindow, screeningStartSeconds } from "../services/audio";
import { getOpenAI } from "./openaiClient";
import { transcribeAudio } from "./transcribe";

/**
 * Gate for auto-uploaded recordings.
 *
 * Recruiters dial from the phone's own dialer, so the app cannot know which
 * calls are interviews — it sends everything long enough to plausibly be one.
 * Deciding here means a personal call is never stored, never evaluated, and
 * never appears in the library.
 *
 * Only the opening minutes are transcribed. Who is calling and about what role
 * is established immediately, so transcribing a full 25-minute call to answer
 * a yes/no question would cost roughly ten times as much and add nothing. The
 * accepted recording is transcribed in full later, at evaluation time.
 */

/** How much of the call the verdict is based on. */
const SCREENING_SECONDS = 180;

export interface ScreeningVerdict {
  /** False means: do not store this recording at all. */
  isScreeningCall: boolean;
  /** One line the user sees on the Not-useful page explaining the call. */
  reason: string;
  /** The interviewee — never the recruiter. Null when it never came up. */
  candidateName: string | null;
  /** Role discussed, free text, e.g. "Senior Data Engineer". */
  detectedRole: string | null;
  /** 1-2 sentences, so a row is readable without opening the transcript. */
  summary: string | null;
}

/** Let a recording through rather than discard it on our own failure. */
const INCONCLUSIVE: ScreeningVerdict = {
  isScreeningCall: true,
  reason: "Could not screen this recording automatically — kept for review.",
  candidateName: null,
  detectedRole: null,
  summary: null,
};

function buildPrompt(): string {
  return `You are triaging recordings from a recruiter's phone. The recorder captures EVERY call, so most of what you see may be ordinary personal conversation. You will receive the opening minutes of one call.

Decide whether this is RECRUITMENT WORK: a job screening or interview call, or a recruiter discussing a candidate's application, availability, experience, notice period, compensation or an offer.

Answer false for anything else — personal calls, family, friends, delivery and customer-service calls, sales calls TO the recruiter, wrong numbers, automated messages.

This clip starts partway into the recording and may open mid-sentence — that is normal, not a sign of anything. It may also contain ringing, hold music or song lyrics from a caller tune before the call connects. IGNORE all of that: it is the phone network, not the conversation. Never treat music or lyrics as the subject of the call.

Judge only what the audio shows. Calls open with greetings and small talk; do not treat the first few sentences as the whole call. If the exchange is clearly heading into a role discussion, answer true.

If the clip contains no real conversation at all — only ringing, music, or silence — answer TRUE. That means the call could not be judged, and a human should see it rather than have it discarded.

When it IS recruitment work, also extract:
- "candidate_name": the person being ASSESSED, not the recruiter. The recruiter is the one asking questions and describing the role; the candidate is the one answering about their own experience. If you cannot tell them apart, or no name is spoken, use null — a wrong name is worse than none.
- "detected_role": the job discussed, free text (e.g. "Senior Data Engineer"), or null.
- "summary": 1-2 plain sentences on what the call covers.

When it is NOT recruitment work, set those three to null and keep "reason" short and non-specific — say only that it is a personal or unrelated call. Do NOT describe the private content of the conversation.

Respond with ONLY this JSON object, no markdown fences:
{
  "is_screening_call": boolean,
  "reason": string,
  "candidate_name": string | null,
  "detected_role": string | null,
  "summary": string | null
}`;
}

/** Exported for tests: the fail-safe behaviour here is what protects a real interview from being discarded on a malformed verdict. */
export function parseVerdict(raw: string): ScreeningVerdict {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const parsed = JSON.parse(fence ? fence[1] : trimmed) as Record<string, unknown>;

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, 500) : null;

  return {
    // Anything other than an explicit false keeps the recording: a malformed
    // verdict must not silently discard a real interview.
    isScreeningCall: parsed.is_screening_call !== false,
    reason: str(parsed.reason) ?? "No reason given.",
    candidateName: str(parsed.candidate_name),
    detectedRole: str(parsed.detected_role),
    summary: str(parsed.summary),
  };
}

/**
 * Transcribe the opening of a recording and decide whether to keep it.
 * Never throws — any failure yields INCONCLUSIVE, which keeps the recording.
 */
export async function screenRecording(
  filePath: string,
  durationSeconds: number | null = null
): Promise<ScreeningVerdict> {
  let clipPath: string | null = null;
  try {
    const start = screeningStartSeconds(
      env.screeningSkipSeconds,
      env.screeningSeconds,
      durationSeconds
    );
    clipPath = await clipWindow(filePath, start, env.screeningSeconds);
    if (!clipPath) return INCONCLUSIVE;

    // Cheaper, non-diarizing model on purpose — see env.screeningTranscribeModel.
    const { text } = await transcribeAudio(clipPath, env.screeningTranscribeModel);
    if (!text.trim()) return INCONCLUSIVE;

    const openai = getOpenAI();
    const params: Record<string, unknown> = {
      model: env.screeningModel,
      messages: [
        { role: "system", content: buildPrompt() },
        { role: "user", content: `Opening of the call:\n\n${text.slice(0, 30_000)}` },
      ],
      response_format: { type: "json_object" },
    };

    let content: string;
    try {
      const resp = (await openai.chat.completions.create(params as any)) as any;
      content = resp?.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      // Some model families reject response_format; the prompt demands JSON anyway.
      if (/response_format/i.test(err instanceof Error ? err.message : String(err))) {
        delete params.response_format;
        const resp = (await openai.chat.completions.create(params as any)) as any;
        content = resp?.choices?.[0]?.message?.content ?? "";
      } else {
        throw err;
      }
    }

    const verdict = parseVerdict(content);
    log.info(
      `Screening verdict: ${verdict.isScreeningCall ? "KEEP" : "REJECT"} — ${verdict.reason}` +
        (verdict.candidateName ? ` (candidate: ${verdict.candidateName})` : "")
    );
    return verdict;
  } catch (err) {
    log.warn("Screening failed — keeping the recording for review.", err);
    return INCONCLUSIVE;
  } finally {
    if (clipPath) await fs.unlink(clipPath).catch(() => undefined);
  }
}
