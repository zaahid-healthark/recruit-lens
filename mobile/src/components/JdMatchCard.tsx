import { Ionicons } from "@expo/vector-icons";
import type { JdMatchDto, JdRequirementVerdict } from "@interview-evaluator/shared";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, scoreColor, shadow } from "../theme";

/**
 * Requirement-by-requirement JD coverage.
 *
 * "not_discussed" is presented as an interview gap rather than a candidate
 * weakness — it means the interviewer never probed it, which is actionable in a
 * different way (ask it in the next round) than an actual miss.
 */

const VERDICT_META: Record<
  JdRequirementVerdict,
  { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; bg: string }
> = {
  met: { label: "Met", icon: "checkmark-circle", color: colors.success, bg: colors.successSoft },
  partial: {
    label: "Partial",
    icon: "remove-circle",
    color: colors.warning,
    bg: colors.warningSoft,
  },
  missing: { label: "Not met", icon: "close-circle", color: colors.danger, bg: colors.dangerSoft },
  not_discussed: {
    label: "Not asked",
    icon: "help-circle",
    color: colors.subtext,
    bg: "#F3F4F6",
  },
};

/** Display order: what they have, what's shaky, what's missing, what was skipped. */
const VERDICT_ORDER: JdRequirementVerdict[] = ["met", "partial", "missing", "not_discussed"];

interface Props {
  jdMatch: JdMatchDto;
  jobTitle: string | null;
}

export function JdMatchCard({ jdMatch, jobTitle }: Props): React.JSX.Element {
  const counts = VERDICT_ORDER.map((v) => ({
    verdict: v,
    count: jdMatch.requirements.filter((r) => r.verdict === v).length,
  })).filter((c) => c.count > 0);

  const sorted = [...jdMatch.requirements].sort(
    (a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict)
  );
  const notAsked = jdMatch.requirements.filter((r) => r.verdict === "not_discussed").length;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="document-text-outline" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>JD match</Text>
          {jobTitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {jobTitle}
            </Text>
          ) : null}
        </View>
        <View style={[styles.fitBadge, { backgroundColor: scoreColor(jdMatch.fitScore) }]}>
          <Text style={styles.fitScore}>{jdMatch.fitScore}</Text>
          <Text style={styles.fitLabel}>fit</Text>
        </View>
      </View>

      <View style={styles.chipRow}>
        {counts.map(({ verdict, count }) => {
          const meta = VERDICT_META[verdict];
          return (
            <View key={verdict} style={[styles.chip, { backgroundColor: meta.bg }]}>
              <Ionicons name={meta.icon} size={13} color={meta.color} />
              <Text style={[styles.chipLabel, { color: meta.color }]}>
                {count} {meta.label.toLowerCase()}
              </Text>
            </View>
          );
        })}
      </View>

      {jdMatch.verdictSummary ? (
        <Text style={styles.summary}>{jdMatch.verdictSummary}</Text>
      ) : null}

      {notAsked > 0 ? (
        <View style={styles.callout}>
          <Ionicons name="information-circle-outline" size={15} color={colors.info} />
          <Text style={styles.calloutText}>
            {notAsked} requirement{notAsked === 1 ? "" : "s"} never came up in this interview —
            worth probing in the next round.
          </Text>
        </View>
      ) : null}

      {sorted.map((req, i) => {
        const meta = VERDICT_META[req.verdict];
        return (
          <View key={`${req.requirement}-${i}`} style={styles.reqRow}>
            <Ionicons name={meta.icon} size={16} color={meta.color} style={styles.reqIcon} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reqName}>{req.requirement}</Text>
              <Text style={[styles.reqVerdict, { color: meta.color }]}>{meta.label}</Text>
              {req.evidence ? <Text style={styles.reqEvidence}>{req.evidence}</Text> : null}
            </View>
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
    marginBottom: 12,
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
  fitBadge: {
    minWidth: 46,
    borderRadius: 10,
    paddingVertical: 5,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  fitScore: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  fitLabel: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
    opacity: 0.9,
    marginTop: -1,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 7,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  chipLabel: {
    fontSize: 11.5,
    fontWeight: "700",
  },
  summary: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 19,
    marginBottom: 10,
  },
  callout: {
    flexDirection: "row",
    gap: 7,
    backgroundColor: "#E0F2FE",
    borderRadius: 9,
    padding: 10,
    marginBottom: 12,
  },
  calloutText: {
    flex: 1,
    fontSize: 12,
    color: "#075985",
    lineHeight: 17,
  },
  reqRow: {
    flexDirection: "row",
    gap: 9,
    paddingTop: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: 11,
  },
  reqIcon: {
    marginTop: 1,
  },
  reqName: {
    fontSize: 13.5,
    fontWeight: "700",
    color: colors.text,
    lineHeight: 19,
  },
  reqVerdict: {
    fontSize: 11.5,
    fontWeight: "700",
    marginTop: 2,
  },
  reqEvidence: {
    fontSize: 12.5,
    color: colors.subtext,
    lineHeight: 18,
    marginTop: 4,
    fontStyle: "italic",
  },
});
