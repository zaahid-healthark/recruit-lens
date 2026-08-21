import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { JobDto } from "@interview-evaluator/shared";
import { api, ApiRequestError, UploadFileInput } from "../api/client";
import { colors } from "../theme";
import { middleTruncate } from "../utils/format";
import { JobPicker } from "./JobPicker";

interface Props {
  visible: boolean;
  files: UploadFileInput[];
  onClose: () => void;
  onImported: () => void;
}

/**
 * Confirm sheet shown when audio is shared into the app: optional candidate
 * name + notes, then upload to POST /recordings. Multiple shared files are
 * uploaded sequentially with the same candidate/notes applied to each.
 */
export function ImportModal({ visible, files, onClose, onImported }: Props): React.JSX.Element {
  const [candidateName, setCandidateName] = useState("");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [job, setJob] = useState<JobDto | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const reset = (): void => {
    setCandidateName("");
    setNotes("");
    setUploading(false);
    setProgress("");
    setJob(null);
  };

  const handleImport = async (): Promise<void> => {
    setUploading(true);
    let uploaded = 0;
    try {
      for (const file of files) {
        setProgress(files.length > 1 ? `Uploading ${uploaded + 1} of ${files.length}…` : "Uploading…");
        await api.uploadRecording(
          file,
          candidateName.trim() || undefined,
          notes.trim() || undefined,
          undefined,
          job?.id ?? null
        );
        uploaded += 1;
      }
      reset();
      onImported();
      Alert.alert("Imported", `${uploaded} recording${uploaded === 1 ? "" : "s"} added to Unevaluated.`);
    } catch (err) {
      setUploading(false);
      setProgress("");
      const message = err instanceof ApiRequestError ? err.message : String(err);
      Alert.alert(
        "Import failed",
        uploaded > 0 ? `${uploaded} of ${files.length} uploaded before the error:\n${message}` : message
      );
      if (uploaded > 0) onImported(); // partial success — refresh what did land
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View style={styles.headerIcon}>
              <Ionicons name="cloud-upload-outline" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Add to Interview Evaluator</Text>
              <Text style={styles.subtitle}>
                {files.length === 1
                  ? "1 audio file"
                  : `${files.length} audio files (details apply to all)`}
              </Text>
            </View>
          </View>

          {files.slice(0, 3).map((f) => (
            <View key={f.uri} style={styles.fileRow}>
              <Ionicons name="musical-notes-outline" size={16} color={colors.subtext} />
              <Text style={styles.fileName} numberOfLines={1}>
                {middleTruncate(f.name, 40)}
              </Text>
            </View>
          ))}
          {files.length > 3 ? (
            <Text style={styles.moreFiles}>+ {files.length - 3} more</Text>
          ) : null}

          <TextInput
            style={styles.input}
            placeholder="Candidate name (optional)"
            placeholderTextColor={colors.subtext}
            value={candidateName}
            onChangeText={setCandidateName}
            editable={!uploading}
          />
          <TextInput
            style={[styles.input, styles.notesInput]}
            placeholder="Notes (optional)"
            placeholderTextColor={colors.subtext}
            value={notes}
            onChangeText={setNotes}
            multiline
            editable={!uploading}
          />

          {/* Attaching a job makes the AI score against its JD requirement-by-requirement. */}
          <Pressable
            style={styles.jobRow}
            onPress={() => setPickerOpen(true)}
            disabled={uploading}
          >
            <Ionicons
              name={job ? "briefcase" : "briefcase-outline"}
              size={17}
              color={job ? colors.primary : colors.subtext}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.jobLabel, !job && styles.jobLabelEmpty]} numberOfLines={1}>
                {job ? job.title : "Screen against a job description"}
              </Text>
              <Text style={styles.jobHint}>
                {job
                  ? "Scored requirement-by-requirement against this JD"
                  : "Optional — without one, scoring is generic"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={colors.subtext} />
          </Pressable>

          <View style={styles.buttonRow}>
            <Pressable
              style={[styles.button, styles.cancelButton]}
              onPress={onClose}
              disabled={uploading}
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.importButton, uploading && styles.buttonDisabled]}
              onPress={handleImport}
              disabled={uploading}
            >
              {uploading ? (
                <View style={styles.uploadingRow}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.importLabel}> {progress}</Text>
                </View>
              ) : (
                <Text style={styles.importLabel}>Import</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <JobPicker
        visible={pickerOpen}
        selectedJobId={job?.id ?? null}
        onClose={() => setPickerOpen(false)}
        onSelect={setJob}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.subtext,
    marginTop: 2,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
  },
  fileName: {
    flex: 1,
    fontSize: 12,
    color: colors.text,
  },
  moreFiles: {
    fontSize: 12,
    color: colors.subtext,
    marginBottom: 6,
    marginLeft: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    marginTop: 10,
    backgroundColor: "#FAFAFC",
  },
  notesInput: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  jobRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: colors.background,
    marginTop: 10,
  },
  jobLabel: {
    fontSize: 13.5,
    fontWeight: "700",
    color: colors.text,
  },
  jobLabelEmpty: {
    fontWeight: "600",
    color: colors.subtext,
  },
  jobHint: {
    fontSize: 11.5,
    color: colors.subtext,
    marginTop: 2,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  button: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButton: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.subtext,
  },
  importButton: {
    backgroundColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  importLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  uploadingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
});
