import type { RecordingDetailDto } from "@interview-evaluator/shared";
import { Ionicons } from "@expo/vector-icons";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { api } from "../api/client";
import { ScoreBadge } from "../components/ScoreBadge";
import { StatusPill } from "../components/StatusPill";
import { useRefresh } from "../context/RefreshContext";
import { useInterval } from "../hooks/useInterval";
import type { RecordingsStackParamList } from "../navigation/RootNavigator";
import { colors, scoreColor, shadow } from "../theme";
import { formatDate, formatDuration } from "../utils/format";

type DetailRoute = RouteProp<RecordingsStackParamList, "RecordingDetail">;
type Nav = NativeStackNavigationProp<RecordingsStackParamList, "RecordingDetail">;

const CONFIDENCE_COLORS: Record<string, string> = {
  high: colors.success,
  medium: colors.warning,
  low: colors.danger,
};

export function RecordingDetailScreen(): React.JSX.Element {
  const route = useRoute<DetailRoute>();
  const navigation = useNavigation<Nav>();
  const { bump } = useRefresh();
  const { id } = route.params;

  const [recording, setRecording] = useState<RecordingDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setRecording(await api.getRecording(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const busy = recording?.status === "TRANSCRIBING" || recording?.status === "SCORING";
  useInterval(() => void load(), busy ? 2500 : null);

  const handleEvaluate = async (): Promise<void> => {
    try {
      await api.evaluateRecording(id);
      setRecording((prev) => (prev ? { ...prev, status: "TRANSCRIBING" } : prev));
    } catch (err) {
      Alert.alert("Could not start evaluation", err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = (): void => {
    Alert.alert("Delete recording", "Delete this recording and all its data?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          api
            .deleteRecording(id)
            .then(() => {
              bump();
              navigation.goBack();
            })
            .catch((err) =>
              Alert.alert("Delete failed", err instanceof Error ? err.message : String(err))
            );
        },
      },
    ]);
  };

  if (!recording) {
    return (
      <View style={styles.center}>
        {error ? (
          <>
            <Ionicons name="cloud-offline-outline" size={36} color={colors.subtext} />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.primaryButton} onPress={() => void load()}>
              <Text style={styles.primaryButtonLabel}>Retry</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator size="large" color={colors.primary} />
        )}
      </View>
    );
  }

  const evaluation = recording.evaluation;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ── File header ── */}
      <View style={styles.card}>
        <Text style={styles.fileName}>{recording.originalFilename}</Text>
        <Text style={styles.meta}>
          {recording.candidateName ? `${recording.candidateName} • ` : ""}
          {formatDate(recording.importedAt)} • {formatDuration(recording.durationSeconds)}
        </Text>
        {recording.notes ? <Text style={styles.notes}>“{recording.notes}”</Text> : null}
        <View style={{ marginTop: 8 }}>
          <StatusPill status={recording.status} />
        </View>
      </View>

      {/* ── Not evaluated yet: status + action ── */}
      {!evaluation ? (
        <View style={[styles.card, styles.centerCard]}>
          {busy ? (
            <>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.busyText}>
                {recording.status === "TRANSCRIBING"
                  ? "Transcribing the audio…"
                  : "Scoring the interview…"}
              </Text>
            </>
          ) : (
            <>
              {recording.status === "FAILED" && recording.errorMessage ? (
                <View style={styles.failBox}>
                  <Ionicons name="alert-circle" size={18} color={colors.danger} />
                  <Text style={styles.failText}>{recording.errorMessage}</Text>
                </View>
              ) : null}
              <Pressable style={styles.primaryButton} onPress={() => void handleEvaluate()}>
                <Ionicons
                  name={recording.status === "FAILED" ? "refresh" : "sparkles"}
                  size={16}
                  color="#FFFFFF"
                />
                <Text style={styles.primaryButtonLabel}>
                  {recording.status === "FAILED" ? "Retry evaluation" : "Evaluate now"}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      ) : (
        <>
          {/* ── Overall result ── */}
          <View style={[styles.card, styles.overallCard]}>
            <ScoreBadge score={evaluation.overallScore} size="large" />
            <Text style={styles.recommendation}>{evaluation.recommendation}</Text>
            <Text style={styles.overallSummary}>{evaluation.overallSummary}</Text>
          </View>

          {/* ── Classification ── */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Classification</Text>
            <View style={styles.classRow}>
              <Ionicons name="briefcase-outline" size={16} color={colors.primary} />
              <Text style={styles.classValue}>{evaluation.roleDesignation}</Text>
            </View>
            <View style={styles.classRow}>
              <Ionicons name="git-branch-outline" size={16} color={colors.primary} />
              <Text style={styles.classValue}>
                {evaluation.department} › {evaluation.subCategory}
              </Text>
            </View>
            <View style={styles.classRow}>
              <View
                style={[
                  styles.confidenceDot,
                  {
                    backgroundColor:
                      CONFIDENCE_COLORS[evaluation.classificationConfidence] ?? colors.subtext,
                  },
                ]}
              />
              <Text style={styles.confidenceLabel}>
                {evaluation.classificationConfidence} confidence
              </Text>
            </View>
            {evaluation.classificationRationale ? (
              <Text style={styles.rationale}>{evaluation.classificationRationale}</Text>
            ) : null}
          </View>

          {/* ── Category breakdown ── */}
          <Text style={styles.groupHeading}>Scoring matrix</Text>
          {evaluation.categories.map((category) => (
            <View key={category.name} style={styles.card}>
              <View style={styles.categoryHeader}>
                <Text style={styles.categoryName}>{category.name}</Text>
                <View
                  style={[styles.categoryScore, { backgroundColor: scoreColor(category.score) }]}
                >
                  <Text style={styles.categoryScoreText}>{category.score}</Text>
                </View>
              </View>
              <Text style={styles.categorySummary}>{category.summary}</Text>
              {category.evidence ? (
                <View style={styles.evidenceBox}>
                  <Text style={styles.evidenceLabel}>Evidence</Text>
                  <Text style={styles.evidenceText}>{category.evidence}</Text>
                </View>
              ) : null}
              {category.recommendation ? (
                <Text style={styles.categoryRecommendation}>
                  <Text style={styles.bold}>Recommendation: </Text>
                  {category.recommendation}
                </Text>
              ) : null}
            </View>
          ))}

          {/* ── Strengths / improvements ── */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Strengths</Text>
            {evaluation.strengths.map((s, i) => (
              <View key={i} style={styles.bulletRow}>
                <Ionicons name="checkmark-circle" size={15} color={colors.success} />
                <Text style={styles.bulletText}>{s}</Text>
              </View>
            ))}
            <Text style={[styles.sectionTitle, { marginTop: 14 }]}>Areas for improvement</Text>
            {evaluation.areasForImprovement.map((s, i) => (
              <View key={i} style={styles.bulletRow}>
                <Ionicons name="alert-circle" size={15} color={colors.warning} />
                <Text style={styles.bulletText}>{s}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* ── Transcript (collapsible) ── */}
      {recording.transcript ? (
        <View style={styles.card}>
          <Pressable style={styles.transcriptHeader} onPress={() => setTranscriptOpen((o) => !o)}>
            <Text style={styles.sectionTitle}>Transcript</Text>
            <Ionicons
              name={transcriptOpen ? "chevron-up" : "chevron-down"}
              size={18}
              color={colors.subtext}
            />
          </Pressable>
          {transcriptOpen ? (
            <Text selectable style={styles.transcriptText}>
              {recording.transcript.text}
            </Text>
          ) : (
            <Text style={styles.meta}>Tap to expand ({recording.transcript.model})</Text>
          )}
        </View>
      ) : null}

      {/* ── Danger zone ── */}
      <Pressable style={styles.deleteButton} onPress={handleDelete}>
        <Ionicons name="trash-outline" size={15} color={colors.danger} />
        <Text style={styles.deleteLabel}>Delete recording</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: colors.background,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    ...shadow,
  },
  centerCard: {
    alignItems: "center",
    paddingVertical: 28,
  },
  fileName: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
  },
  meta: {
    fontSize: 12,
    color: colors.subtext,
    marginTop: 4,
  },
  notes: {
    fontSize: 13,
    color: colors.text,
    fontStyle: "italic",
    marginTop: 6,
  },
  busyText: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: "600",
    color: colors.subtext,
  },
  failBox: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.dangerSoft,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  failText: {
    flex: 1,
    fontSize: 12,
    color: colors.danger,
    lineHeight: 17,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 12,
  },
  primaryButtonLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  overallCard: {
    alignItems: "center",
    paddingVertical: 24,
  },
  recommendation: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  overallSummary: {
    marginTop: 8,
    fontSize: 13,
    color: colors.subtext,
    textAlign: "center",
    lineHeight: 19,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.text,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  groupHeading: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.subtext,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 8,
    marginTop: 4,
    marginLeft: 4,
  },
  classRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  classValue: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    flex: 1,
  },
  confidenceDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginHorizontal: 3,
  },
  confidenceLabel: {
    fontSize: 13,
    color: colors.subtext,
    textTransform: "capitalize",
  },
  rationale: {
    fontSize: 12,
    color: colors.subtext,
    marginTop: 4,
    lineHeight: 17,
  },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  categoryName: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
    flex: 1,
  },
  categoryScore: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryScoreText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  categorySummary: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 19,
  },
  evidenceBox: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  evidenceLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.subtext,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  evidenceText: {
    fontSize: 12,
    fontStyle: "italic",
    color: colors.text,
    lineHeight: 17,
  },
  categoryRecommendation: {
    fontSize: 12,
    color: colors.subtext,
    marginTop: 8,
    lineHeight: 17,
  },
  bold: {
    fontWeight: "700",
    color: colors.text,
  },
  bulletRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 6,
    alignItems: "flex-start",
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  transcriptHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  transcriptText: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 19,
    color: colors.text,
    fontFamily: Platform.OS === "android" ? "monospace" : "Menlo",
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    marginTop: 4,
  },
  deleteLabel: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700",
  },
  errorText: {
    marginTop: 10,
    fontSize: 13,
    color: colors.subtext,
    textAlign: "center",
  },
});
