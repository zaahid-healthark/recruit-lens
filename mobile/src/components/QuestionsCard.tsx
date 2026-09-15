import { Ionicons } from "@expo/vector-icons";
import {
  ANSWER_VERDICT_LABELS,
  QUESTION_KIND_LABELS,
  type AnswerVerdict,
  type QuestionAssessmentDto,
} from "@interview-evaluator/shared";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, scoreColor, shadow } from "../theme";

/**
 * Every question the recruiter asked, graded one by one — technical,
 * behavioural, situational alike.
 *
 * Rendered only when questions were asked: a call that stayed logistical shows
 * no card at all, rather than an empty one implying the candidate dodged
 * something. Unlike the JD card there is no "not asked" state here — every row
 * exists because a question was actually put to the candidate.
 */

const VERDICT_META: Record<
  AnswerVerdict,
  { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string }
> = {
  strong: { icon: "checkmark-circle", color: colors.success, bg: colors.successSoft },
  adequate: { icon: "remove-circle", color: colors.warning, bg: colors.warningSoft },
  weak: { icon: "close-circle", color: colors.danger, bg: colors.dangerSoft },
  not_answered: { icon: "help-circle", color: colors.subtext, bg: "#F3F4F6" },
};

interface Props {
  assessment: QuestionAssessmentDto;
}

export function QuestionsCard({ assessment }: Props): React.JSX.Element {
  const strong = assessment.questions.filter((q) => q.verdict === "strong").length;
  const headline = assessment.technicalScore ?? assessment.behaviouralScore;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="help-circle-outline" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Questions asked</Text>
          <Text style={styles.subtitle}>
            {strong} of {assessment.questions.length} answered strongly
          </Text>
        </View>
        {headline !== null ? (
          <View style={[styles.scoreBadge, { backgroundColor: scoreColor(headline) }]}>
            <Text style={styles.scoreValue}>{headline}</Text>
            <Text style={styles.scoreLabel}>
              {assessment.technicalScore !== null ? "tech" : "behav"}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Both aggregates, when the recruiter covered both kinds — they bind
          different matrix categories, so one number cannot stand for both. */}
      {assessment.technicalScore !== null && assessment.behaviouralScore !== null ? (
        <View style={styles.splitRow}>
          <Text style={styles.splitItem}>
            Technical <Text style={styles.bold}>{assessment.technicalScore}</Text>
          </Text>
          <Text style={styles.splitItem}>
            Behavioural <Text style={styles.bold}>{assessment.behaviouralScore}</Text>
          </Text>
        </View>
      ) : null}

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
                <Text style={[styles.verdictLabel, { color: meta.color }]}>
                  {ANSWER_VERDICT_LABELS[q.verdict]}
                </Text>
              </View>
              <Text style={styles.kindLabel}>{QUESTION_KIND_LABELS[q.kind]}</Text>
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
  splitRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 8,
  },
  splitItem: {
    fontSize: 12,
    color: colors.subtext,
  },
  bold: {
    fontWeight: "800",
    color: colors.text,
  },
  kindLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.subtext,
    textTransform: "uppercase",
    letterSpacing: 0.3,
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
