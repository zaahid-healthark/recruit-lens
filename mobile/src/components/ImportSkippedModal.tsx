import { Ionicons } from "@expo/vector-icons";
import type { JobDto } from "@interview-evaluator/shared";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { AudioPlayerBar } from "./AudioPlayerBar";
import { JobPicker } from "./JobPicker";
import { colors, shadow } from "../theme";
import { formatDuration } from "../utils/format";

/**
 * Name and send one held-back recording.
 *
 * Exists because naming a recording is how the user approves it: the scanner
 * only auto-uploads calls whose dialled number is in the filename, so a
 * candidate who rings back from a different number — or the next day — always
 * lands here. The player is embedded on purpose; the point is to listen first
 * and name it from what was actually said, rather than guess from a filename.
 *
 * Replaces an Alert.prompt flow that silently did nothing useful on Android,
 * where Alert.prompt does not exist.
 */
export interface SkippedFileSummary {
  uri: string;
  name: string;
  durationSeconds: number | null;
  suggestedCandidateName: string | null;
  suggestedJobId: string | null;
}

export function ImportSkippedModal({
  file,
  defaultJob,
  onCancel,
  onSubmit,
}: {
  /** null closes the modal. */
  file: SkippedFileSummary | null;
  /** Job currently selected on the call form, offered as the starting point. */
  defaultJob: JobDto | null;
  onCancel: () => void;
  onSubmit: (input: {
    uri: string;
    candidateName: string;
    jobId: string | null;
    renameLocal: boolean;
  }) => Promise<void>;
}): React.JSX.Element {
  const [candidateName, setCandidateName] = useState("");
  const [job, setJob] = useState<JobDto | null>(null);
  const [renameLocal, setRenameLocal] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset per file so a previous entry's name is never reused by accident.
  useEffect(() => {
    if (!file) return;
    setCandidateName(file.suggestedCandidateName ?? "");
    setJob(defaultJob);
    setRenameLocal(true);
    setBusy(false);
  }, [file, defaultJob]);

  const submit = async (): Promise<void> => {
    if (!file || busy) return;
    setBusy(true);
    try {
      await onSubmit({
        uri: file.uri,
        candidateName,
        jobId: job?.id ?? null,
        renameLocal,
      });
    } finally {
      setBusy(false);
    }
  };

  const named = candidateName.trim().length > 0;

  return (
    <Modal visible={file !== null} transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Send this recording</Text>
            <Text style={styles.fileName} numberOfLines={2}>
              {file?.name} · {formatDuration(file?.durationSeconds ?? null)}
            </Text>

            {file ? (
              <View style={styles.playerWrap}>
                <AudioPlayerBar
                  source={file.uri}
                  fallbackDurationSeconds={file.durationSeconds}
                  compact
                />
              </View>
            ) : null}

            {file?.suggestedCandidateName ? (
              <Text style={styles.suggestion}>
                Timing suggests {file.suggestedCandidateName}, but the number is not in the
                filename — check before sending.
              </Text>
            ) : null}

            <Text style={styles.label}>Candidate name</Text>
            <TextInput
              style={styles.input}
              value={candidateName}
              onChangeText={setCandidateName}
              placeholder="Who is this interview with?"
              placeholderTextColor={colors.subtext}
              autoCapitalize="words"
              editable={!busy}
            />

            <Pressable
              style={styles.jobRow}
              onPress={() => setPickerOpen(true)}
              disabled={busy}
            >
              <Ionicons
                name={job ? "briefcase" : "briefcase-outline"}
                size={15}
                color={job ? colors.primary : colors.subtext}
              />
              <Text style={[styles.jobLabel, !job && styles.jobLabelEmpty]} numberOfLines={1}>
                {job ? job.title : "Score against a job description (optional)"}
              </Text>
              <Ionicons name="chevron-forward" size={15} color={colors.subtext} />
            </Pressable>

            <View style={styles.optionRow}>
              <Ionicons name="pricetag-outline" size={16} color={colors.subtext} />
              <Text style={styles.optionLabel}>Rename the file on this phone too</Text>
              <Switch
                value={renameLocal}
                onValueChange={setRenameLocal}
                disabled={busy || !named}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor="#FFFFFF"
              />
            </View>
            <Text style={styles.hint}>
              {named
                ? "The recorder's own copy is renamed to match, so the folder stops showing an unnamed entry."
                : "Add a name to rename the file. Without one it is sent under its original filename."}
            </Text>

            <View style={styles.buttons}>
              <Pressable style={styles.secondary} onPress={onCancel} disabled={busy}>
                <Text style={styles.secondaryLabel}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.primary} onPress={() => void submit()} disabled={busy}>
                {busy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryLabel}>Send</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      <JobPicker
        visible={pickerOpen}
        selectedJobId={job?.id ?? null}
        onClose={() => setPickerOpen(false)}
        onSelect={(next) => {
          setJob(next);
          setPickerOpen(false);
        }}
      />
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
    maxHeight: "88%",
    ...shadow,
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  fileName: {
    fontSize: 12,
    color: colors.subtext,
    marginTop: 4,
  },
  playerWrap: {
    marginTop: 10,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  suggestion: {
    fontSize: 12,
    color: colors.warning,
    fontWeight: "600",
    lineHeight: 17,
    marginTop: 10,
  },
  label: {
    fontSize: 11.5,
    fontWeight: "700",
    color: colors.subtext,
    marginTop: 16,
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: 0.4,
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
  },
  jobRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginTop: 10,
  },
  jobLabel: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "600",
    color: colors.text,
  },
  jobLabelEmpty: {
    fontWeight: "400",
    color: colors.subtext,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  optionLabel: {
    flex: 1,
    fontSize: 12.5,
    color: colors.text,
    fontWeight: "600",
  },
  hint: {
    fontSize: 11.5,
    color: colors.subtext,
    lineHeight: 16,
    marginTop: 6,
  },
  buttons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
    marginBottom: 6,
  },
  secondary: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
  },
  secondaryLabel: {
    color: colors.text,
    fontSize: 13.5,
    fontWeight: "700",
  },
  primary: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
  },
  primaryLabel: {
    color: "#FFFFFF",
    fontSize: 13.5,
    fontWeight: "800",
  },
});
