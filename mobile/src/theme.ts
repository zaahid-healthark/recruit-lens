import type { RecordingStatus } from "@interview-evaluator/shared";

export const colors = {
  background: "#F4F5FA",
  card: "#FFFFFF",
  border: "#E5E7EB",
  text: "#111827",
  subtext: "#6B7280",
  primary: "#4F46E5",
  primarySoft: "#EEF2FF",
  success: "#16A34A",
  successSoft: "#DCFCE7",
  warning: "#D97706",
  warningSoft: "#FEF3C7",
  danger: "#DC2626",
  dangerSoft: "#FEE2E2",
  info: "#0284C7",
  /** Categorical palette for charts. */
  chartPalette: ["#4F46E5", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#14B8A6", "#F97316"],
};

/** Score → band color (matches the 5 scoring bands). */
export function scoreColor(score: number): string {
  if (score >= 81) return "#16A34A";
  if (score >= 61) return "#65A30D";
  if (score >= 41) return "#D97706";
  if (score >= 21) return "#EA580C";
  return "#DC2626";
}

export const statusMeta: Record<RecordingStatus, { label: string; color: string; bg: string }> = {
  UNEVALUATED: { label: "Unevaluated", color: "#6B7280", bg: "#F3F4F6" },
  TRANSCRIBING: { label: "Transcribing…", color: "#0284C7", bg: "#E0F2FE" },
  SCORING: { label: "Scoring…", color: "#7C3AED", bg: "#EDE9FE" },
  EVALUATED: { label: "Evaluated", color: "#16A34A", bg: "#DCFCE7" },
  FAILED: { label: "Failed", color: "#DC2626", bg: "#FEE2E2" },
};

export const shadow = {
  shadowColor: "#000",
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const;
