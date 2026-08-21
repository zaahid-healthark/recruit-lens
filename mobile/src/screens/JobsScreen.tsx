import { Ionicons } from "@expo/vector-icons";
import type { JobDto } from "@interview-evaluator/shared";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { colors, scoreColor, shadow } from "../theme";
import { formatDate } from "../utils/format";

/**
 * Job description library. Write a JD once, then screen every candidate for
 * that opening against it — the alternative is re-pasting the same text per
 * candidate, which is what makes JD scoring impractical on a phone.
 */

/** Mirrors MIN_JD_CHARS in server/src/routes/jobs.ts. */
const MIN_JD_CHARS = 40;

interface EditorState {
  /** null = creating a new job. */
  job: JobDto | null;
  title: string;
  jdText: string;
}

export function JobsScreen(): React.JSX.Element {
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (isRefresh = false): Promise<void> => {
      if (isRefresh) setRefreshing(true);
      setError(null);
      try {
        setJobs(await api.listJobs(showArchived));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [showArchived]
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const handleSave = async (): Promise<void> => {
    if (!editor) return;
    setSaving(true);
    try {
      if (editor.job) {
        await api.updateJob(editor.job.id, {
          title: editor.title.trim(),
          jdText: editor.jdText.trim(),
        });
      } else {
        await api.createJob({ title: editor.title.trim(), jdText: editor.jdText.trim() });
      }
      setEditor(null);
      await load();
    } catch (err) {
      Alert.alert("Could not save", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveToggle = async (job: JobDto): Promise<void> => {
    try {
      await api.updateJob(job.id, { archived: !job.archived });
      await load();
    } catch (err) {
      Alert.alert("Could not update", err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = (job: JobDto): void => {
    Alert.alert(
      "Delete job description",
      job.recordingCount > 0
        ? `${job.recordingCount} recording${job.recordingCount === 1 ? "" : "s"} link to "${job.title}". They will be kept, but will no longer show a JD match. Archive instead to keep the link.`
        : `Delete "${job.title}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await api.deleteJob(job.id);
                await load();
              } catch (err) {
                Alert.alert("Could not delete", err instanceof Error ? err.message : String(err));
              }
            })();
          },
        },
      ]
    );
  };

  const canSave =
    editor !== null &&
    editor.title.trim().length > 0 &&
    editor.jdText.trim().length >= MIN_JD_CHARS &&
    !saving;

  const renderJob = ({ item }: { item: JobDto }): React.JSX.Element => (
    <Pressable
      style={[styles.card, item.archived && styles.cardArchived]}
      onPress={() => setEditor({ job: item, title: item.title, jdText: item.jdText })}
      onLongPress={() => handleDelete(item)}
    >
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardMeta}>
            {item.recordingCount} candidate{item.recordingCount === 1 ? "" : "s"} • added{" "}
            {formatDate(item.createdAt)}
            {item.archived ? " • archived" : ""}
          </Text>
        </View>
        {item.averageOverallScore !== null ? (
          <View style={[styles.avgBadge, { backgroundColor: scoreColor(item.averageOverallScore) }]}>
            <Text style={styles.avgScore}>{item.averageOverallScore}</Text>
            <Text style={styles.avgLabel}>avg</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.jdPreview} numberOfLines={2}>
        {item.jdText}
      </Text>
      <View style={styles.cardActions}>
        <Pressable
          style={styles.actionButton}
          onPress={() => void handleArchiveToggle(item)}
          hitSlop={6}
        >
          <Ionicons
            name={item.archived ? "arrow-up-circle-outline" : "archive-outline"}
            size={15}
            color={colors.primary}
          />
          <Text style={styles.actionLabel}>{item.archived ? "Unarchive" : "Archive"}</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={() => handleDelete(item)} hitSlop={6}>
          <Ionicons name="trash-outline" size={15} color={colors.danger} />
          <Text style={[styles.actionLabel, { color: colors.danger }]}>Delete</Text>
        </Pressable>
      </View>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {error ? (
        <Pressable style={styles.errorBanner} onPress={() => void load()}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(j) => j.id}
          renderItem={renderJob}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
          }
          ListHeaderComponent={
            <Pressable style={styles.archiveToggle} onPress={() => setShowArchived((v) => !v)}>
              <Ionicons
                name={showArchived ? "checkbox" : "square-outline"}
                size={16}
                color={colors.primary}
              />
              <Text style={styles.archiveToggleLabel}>Show archived</Text>
            </Pressable>
          }
          ListEmptyComponent={
            <EmptyState
              icon="briefcase-outline"
              title="No job descriptions yet"
              subtitle="Add one, then pick it when importing a recording — the AI will score each candidate requirement-by-requirement against it instead of against a generic idea of the role."
            />
          }
        />
      )}

      <Pressable
        style={styles.fab}
        onPress={() => setEditor({ job: null, title: "", jdText: "" })}
      >
        <Ionicons name="add" size={26} color="#FFFFFF" />
      </Pressable>

      <Modal
        visible={editor !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setEditor(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {editor?.job ? "Edit job description" : "New job description"}
              </Text>
              <Pressable hitSlop={10} onPress={() => setEditor(null)}>
                <Ionicons name="close" size={22} color={colors.subtext} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <TextInput
                style={styles.input}
                placeholder="Job title (e.g. Senior Data Engineer)"
                placeholderTextColor={colors.subtext}
                value={editor?.title ?? ""}
                onChangeText={(t) => setEditor((e) => (e ? { ...e, title: t } : e))}
                autoCapitalize="words"
                editable={!saving}
              />
              <TextInput
                style={[styles.input, styles.jdInput]}
                placeholder="Paste the full job description — requirements, skills, experience…"
                placeholderTextColor={colors.subtext}
                value={editor?.jdText ?? ""}
                onChangeText={(t) => setEditor((e) => (e ? { ...e, jdText: t } : e))}
                multiline
                textAlignVertical="top"
                editable={!saving}
              />
              {editor?.job && editor.job.recordingCount > 0 ? (
                <Text style={styles.warnHint}>
                  Editing this does not re-score the {editor.job.recordingCount} recording
                  {editor.job.recordingCount === 1 ? "" : "s"} already evaluated against it —
                  re-evaluate them individually to apply the change.
                </Text>
              ) : null}
              <Pressable
                style={[styles.primaryButton, !canSave && styles.buttonDisabled]}
                onPress={() => void handleSave()}
                disabled={!canSave}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryLabel}>Save</Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    padding: 16,
    paddingBottom: 90,
  },
  archiveToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingBottom: 12,
  },
  archiveToggleLabel: {
    fontSize: 12.5,
    color: colors.text,
    fontWeight: "600",
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 15,
    marginBottom: 12,
    ...shadow,
  },
  cardArchived: {
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
  },
  cardMeta: {
    fontSize: 12,
    color: colors.subtext,
    marginTop: 3,
  },
  avgBadge: {
    minWidth: 42,
    borderRadius: 9,
    paddingVertical: 4,
    paddingHorizontal: 7,
    alignItems: "center",
  },
  avgScore: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  avgLabel: {
    color: "#FFFFFF",
    fontSize: 8.5,
    fontWeight: "700",
    opacity: 0.9,
    marginTop: -1,
  },
  jdPreview: {
    fontSize: 12.5,
    color: colors.subtext,
    lineHeight: 18,
    marginTop: 9,
  },
  cardActions: {
    flexDirection: "row",
    gap: 16,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  actionLabel: {
    fontSize: 12.5,
    fontWeight: "700",
    color: colors.primary,
  },
  fab: {
    position: "absolute",
    right: 18,
    bottom: 22,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadow,
    elevation: 5,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  errorText: {
    flex: 1,
    fontSize: 12.5,
    color: colors.danger,
    lineHeight: 18,
  },
  retryText: {
    fontSize: 12.5,
    fontWeight: "800",
    color: colors.danger,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 18,
    maxHeight: "88%",
    ...shadow,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  sheetTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.background,
    marginBottom: 10,
  },
  jdInput: {
    minHeight: 190,
  },
  warnHint: {
    fontSize: 12,
    color: colors.warning,
    lineHeight: 17,
    marginBottom: 12,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    marginBottom: 6,
  },
  primaryLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
