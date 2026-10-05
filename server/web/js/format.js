/**
 * The scoring vocabulary, mirrored from shared/src/evaluation.ts and api.ts.
 *
 * Scores are stored 0–100 and always SHOWN out of 10 with one decimal, and
 * the band a score sits in IS the decision a recruiter acts on. Keep these
 * numbers in step with DECISION_THRESHOLDS and VERDICT_SCORE_RANGES; they are
 * duplicated here only because the browser cannot import TypeScript.
 */

export const THRESHOLDS = { strong: 85, fit: 75, consider: 60 };

/** 76 → "7.6". Null and undefined → "—". */
export function score10(value) {
  return typeof value === "number" && Number.isFinite(value) ? (value / 10).toFixed(1) : "—";
}

/** Which band a 0–100 score falls in: strong | fit | consider | reject. */
export function bandOf(value) {
  if (typeof value !== "number") return null;
  if (value >= THRESHOLDS.strong) return "strong";
  if (value >= THRESHOLDS.fit) return "fit";
  if (value >= THRESHOLDS.consider) return "consider";
  return "reject";
}

export const BAND_LABEL = {
  strong: "Strong fit",
  fit: "Fit",
  consider: "Consider",
  reject: "Do not proceed",
};

/** The gate's decision — the one verdict the UI shows. */
export const DECISION = {
  advance: { label: "Fit · video screen", short: "Fit", tone: "fit" },
  borderline: { label: "Consider", short: "Consider", tone: "consider" },
  reject: { label: "Do not proceed", short: "Do not proceed", tone: "reject" },
  insufficient_evidence: { label: "Not enough evidence", short: "Not enough evidence", tone: "neutral" },
};
export const DECISION_ORDER = ["advance", "borderline", "reject", "insufficient_evidence"];

export const VERDICT = {
  strong: { label: "Strong", tone: "strong" },
  adequate: { label: "Adequate", tone: "fit" },
  weak: { label: "Weak", tone: "consider" },
  not_answered: { label: "Could not answer", tone: "reject" },
};

export const KIND = {
  technical: "Technical",
  behavioural: "Behavioural",
  situational: "Situational",
  experience: "Experience",
  motivation: "Motivation",
};

export const REQUIREMENT = {
  met: { label: "Met", tone: "fit" },
  partial: { label: "Partially met", tone: "consider" },
  missing: { label: "Not met", tone: "reject" },
  not_discussed: { label: "Not discussed", tone: "neutral" },
};

export const STATUS = {
  UNEVALUATED: "Queued",
  TRANSCRIBING: "Transcribing",
  SCORING: "Scoring",
  EVALUATED: "Evaluated",
  FAILED: "Failed",
};

export const isProcessing = (r) =>
  r.status === "UNEVALUATED" || r.status === "TRANSCRIBING" || r.status === "SCORING";

/** The decision for a list row, or null while it has no evaluation. */
export const decisionOf = (r) =>
  r.status === "EVALUATED" && r.evaluationSummary ? r.evaluationSummary.decision : null;

export const scoreOf = (r) => r.evaluationSummary?.overallScore ?? null;

/** Evaluated and still waiting for a human to advance or reject. */
export const awaitingDecision = (r) =>
  r.status === "EVALUATED" && !r.shortlistedAt && !r.rejectedAt;

export const needsAttention = (r) => r.status === "FAILED" || awaitingDecision(r);

/** A row's human label: the name if one was given, else the file name. */
export const displayName = (r) => r.candidateName?.trim() || stripExtension(r.originalFilename);

export function stripExtension(name) {
  return String(name || "Untitled recording").replace(/\.[a-z0-9]{2,5}$/i, "");
}

// ── Dates and durations ──────────────────────────────────────────────
const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const dateShortFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

export const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const fmtDateShort = (iso) => (iso ? dateShortFmt.format(new Date(iso)) : "—");
export const fmtDateTime = (iso) =>
  iso ? `${dateFmt.format(new Date(iso))}, ${timeFmt.format(new Date(iso))}` : "—";

export function fmtRelative(iso) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} d ago`;
  return fmtDate(iso);
}

/** 1080 → "18 min"; 45 → "45 s"; 3900 → "1 h 5 min". */
export function fmtDuration(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** 472.3 → "7:52". */
export function fmtClock(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, "0");
  if (m < 60) return `${m}:${sec}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${sec}`;
}

export function fmtMinutes(minutes) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) return "—";
  if (minutes < 1) return "under a minute";
  if (minutes < 90) return `${Math.round(minutes)} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}

export function fmtBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const money = (n) =>
  typeof n === "number" ? "$" + (n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2)) : "—";

export const pct = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

export const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;

/** A phone number in a call-recorder file name, if there is one. */
export function phoneFromFilename(name) {
  const runs = String(name || "").match(/\+?\d{10,13}/g) || [];
  for (const run of runs) {
    // 20260916104444 and friends are timestamps, not phone numbers.
    if (/^(19|20)\d{6}/.test(run.replace("+", ""))) continue;
    return run;
  }
  return "";
}

/** The answer-rate bar the gate applies (TECHNICAL_PASS_RATE). */
export const TECHNICAL_PASS_RATE = 0.6;
export const TECHNICAL_BORDERLINE_RATE = 0.34;

/** Tone for an answered-adequately rate, matching the gate's own cut-offs. */
export function rateTone(answered, asked) {
  if (!asked) return "neutral";
  const rate = answered / asked;
  if (rate >= TECHNICAL_PASS_RATE) return "fit";
  if (rate >= TECHNICAL_BORDERLINE_RATE) return "consider";
  return "reject";
}

/** Local date key "2026-10-05" for bucketing. */
export function dayKey(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
