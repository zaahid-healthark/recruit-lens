import { Ionicons } from "@expo/vector-icons";
import type { TechnicalAnswerVerdict, TechnicalAssessmentDto } from "@interview-evaluator/shared";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, scoreColor, shadow } from "../theme";

/**
 * The technical questions the recruiter actually asked, graded one by one.
 *
 * Rendered only when questions were asked — a call that stayed logistical
 * shows no card at all, rather than an empty one implying the candidate
 * dodged something. Unlike the JD card there is no "not asked" state here:
 * every row exists because a question was put to the candidate.
 */

const VERDICT_META: Record<
  TechnicalAnswerVerdict,
  { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; bg: string }
> = {
  correct: {
    label: "Correct",
    icon: "checkmark-circle",
    color: colors.success,
    bg: colors.successSoft,
  },
  partially_correct: {
    label: "Partly correct",
    icon: "remove-circle",
    color: colors.warning,
    bg: colors.warningSoft,
  },
  incorrect: {
    label: "Incorrect",
    icon: "close-circle",
    color: colors.danger,
    bg: colors.dangerSoft,
  },
  not_answered: {
    label: "Could not answer",
    icon: "help-circle",
    color: colors.subtext,
    bg: "#F3F4F6",
  },
};

interface Props {
  assessment: TechnicalAssessmentDto;
}

export function TechnicalQaCard({ assessment }: Props): React.JSX.Element {
  const correct = assessment.questions.filter((q) => q.verdict === "correct").length;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="terminal-outline" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Technical questions</Text>
          <Text style={styles.subtitle}>
            {correct} of {assessment.questions.length} answered well
          </Text>
        </View>
        <View style={[styles.scoreBadge, { backgroundColor: scoreColor(assessment.score) }]}>
          <Text style={styles.scoreValue}>{assessment.score}</Text>
          <Text style={styles.scoreLabel}>tech</Text>
        </View>
      </View>

      {assessment.summary ? <Text style={styles.summary}>{assessment.summary}</Text> : null}

      {assessment.questions.map((q, i) => {
        const meta = VERDICT_META[q.verdict];
        return (
          <View key={`${q.question}-${i}`} style={styles.qRow}>
            <View style={styles.qHeader}>
              <Ionicons name={meta.icon} size={16} color={meta.color} style={{ marginTop: 1 }} />
              <Text style={styles.question}>{q.question}</Text>
            </View>
            <View style={styles.badgeRow}>
              <View style={[styles.verdictChip, { backgroundColor: meta.bg }]}>
                <Text style={[styles.verdictLabel, { color: meta.color }]}>{meta.label}</Text>
              </View>
              <Text style={[styles.qScore, { color: scoreColor(q.score) }]}>{q.score}/100</Text>
            </View>
            {q.answerSummary ? <Text style={styles.answer}>{q.answerSummary}</Text> : null}
            {q.evidence ? <Text style={styles.evidence}>{q.evidence}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    ...shadow,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.subtext,
    marginTop: 1,
  },
  scoreBadge: {
    minWidth: 46,
    borderRadius: 10,
    paddingVertical: 5,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  scoreValue: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  scoreLabel: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
    opacity: 0.9,
    marginTop: -1,
  },
  summary: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 19,
    marginBottom: 4,
  },
  qRow: {
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  qHeader: {
    flexDirection: "row",
    gap: 8,
  },
  question: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "700",
    color: colors.text,
    lineHeight: 19,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
    marginLeft: 24,
  },
  verdictChip: {
    borderRadius: 7,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  verdictLabel: {
    fontSize: 11.5,
    fontWeight: "700",
  },
  qScore: {
    fontSize: 11.5,
    fontWeight: "800",
  },
  answer: {
    fontSize: 12.5,
    color: colors.text,
    lineHeight: 18,
    marginTop: 6,
    marginLeft: 24,
  },
  evidence: {
    fontSize: 12.5,
    color: colors.subtext,
    lineHeight: 18,
    marginTop: 4,
    marginLeft: 24,
    fontStyle: "italic",
  },
});
