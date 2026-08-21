import { Ionicons } from "@expo/vector-icons";
import type { JobDto } from "@interview-evaluator/shared";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "../api/client";
import { colors, shadow } from "../theme";

/**
 * Job selector used at import time and on the recording detail screen.
 *
 * Also creates a job inline: pasting a JD here is no slower than a plain text
 * field would be, but the result is reusable for the next candidate — which is
 * the whole point of screening several people against one opening.
 */

/** Mirrors MIN_JD_CHARS in server/src/routes/jobs.ts — fail fast, before the request. */
const MIN_JD_CHARS = 40;

interface Props {
  visible: boolean;
  /** Currently linked job, so it can be shown as selected. */
  selectedJobId: string | null;
  onClose: () => void;
  onSelect: (job: JobDto | null) => void;
  /** Hide the "No job" row where detaching makes no sense. */
  allowNone?: boolean;
}

export function JobPicker({
  visible,
  selectedJobId,
  onClose,
  onSelect,
  allowNone = true,
}: Props): React.JSX.Element {
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [jdText, setJdText] = useState("");

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setJobs(await api.listJobs());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    setCreating(false);
    setTitle("");
    setJdText("");
    void load();
  }, [visible]);

  const handleCreate = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const job = await api.createJob({ title: title.trim(), jdText: jdText.trim() });
      onSelect(job);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const canCreate =
    title.trim().length > 0 && jdText.trim().length >= MIN_JD_CHARS && !saving;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {creating ? "New job description" : "Screen against"}
            </Text>
            <Pressable hitSlop={10} onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.subtext} />
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {creating ? (
            <ScrollView keyboardShouldPersistTaps="handled">
              <TextInput
                style={styles.input}
                placeholder="Job title (e.g. Senior Data Engineer)"
                placeholderTextColor={colors.subtext}
                value={title}
                onChangeText={setTitle}
                autoCapitalize="words"
                editable={!saving}
              />
              <TextInput
                style={[styles.input, styles.jdInput]}
                placeholder="Paste the full job description here — requirements, skills, experience…"
                placeholderTextColor={colors.subtext}
                value={jdText}
                onChangeText={setJdText}
                multiline
                textAlignVertical="top"
                editable={!saving}
              />
              <Text style={styles.hint}>
                {jdText.trim().length < MIN_JD_CHARS
                  ? `${MIN_JD_CHARS - jdText.trim().length} more characters needed — the AI extracts requirements from this text.`
                  : "The AI will score each candidate requirement-by-requirement against this."}
              </Text>
              <View style={styles.buttonRow}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => setCreating(false)}
                  disabled={saving}
                >
                  <Text style={styles.secondaryLabel}>Back</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryButton, !canCreate && styles.buttonDisabled]}
                  onPress={() => void handleCreate()}
                  disabled={!canCreate}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryLabel}>Save &amp; select</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          ) : (
            <ScrollView>
              <Pressable
                style={styles.createRow}
                onPress={() => {
                  setError(null);
                  setCreating(true);
                }}
              >
                <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                <Text style={styles.createLabel}>Paste a new job description</Text>
              </Pressable>

              {allowNone ? (
                <Pressable
                  style={styles.row}
                  onPress={() => {
                    onSelect(null);
                    onClose();
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>No job</Text>
                    <Text style={styles.rowMeta}>
                      Generic evaluation — no requirement-by-requirement matching
                    </Text>
                  </View>
                  {selectedJobId === null ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  ) : null}
                </Pressable>
              ) : null}

              {loading ? (
                <ActivityIndicator style={{ marginVertical: 24 }} color={colors.primary} />
              ) : jobs.length === 0 ? (
                <Text style={styles.emptyText}>
                  No job descriptions yet. Paste one above and it will be reusable for every
                  candidate you screen for that role.
                </Text>
              ) : (
                jobs.map((job) => (
                  <Pressable
                    key={job.id}
                    style={styles.row}
                    onPress={() => {
                      onSelect(job);
                      onClose();
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{job.title}</Text>
                      <Text style={styles.rowMeta}>
                        {job.recordingCount} candidate{job.recordingCount === 1 ? "" : "s"}
                        {job.averageOverallScore !== null
                          ? ` • avg ${job.averageOverallScore}`
                          : ""}
                      </Text>
                    </View>
                    {selectedJobId === job.id ? (
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                    ) : null}
                  </Pressable>
                ))
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    maxHeight: "85%",
    ...shadow,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  error: {
    fontSize: 12.5,
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    lineHeight: 18,
  },
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  createLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primary,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  rowMeta: {
    fontSize: 12,
    color: colors.subtext,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 13,
    color: colors.subtext,
    lineHeight: 19,
    paddingVertical: 20,
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
    minHeight: 170,
  },
  hint: {
    fontSize: 12,
    color: colors.subtext,
    lineHeight: 17,
    marginBottom: 12,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
  },
  primaryLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  secondaryButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 13,
  },
  secondaryLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
