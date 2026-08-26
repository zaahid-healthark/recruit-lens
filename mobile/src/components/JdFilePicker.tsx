import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import React, { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../api/client";
import { colors } from "../theme";

/**
 * Load a job description from a file instead of typing it.
 *
 * Typing a JD on a phone keyboard is the worst part of setting up a job, and
 * the recruiter already has the document. The extracted text lands in the
 * editor rather than being saved directly: extraction is good but not perfect,
 * and a JD drives every requirement verdict, so it gets a human read first.
 */

const ACCEPTED = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];

export function JdFilePicker({
  onExtracted,
  disabled = false,
}: {
  /** Called with the extracted text, for the caller to put in its editor. */
  onExtracted: (text: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);

  const pick = async (): Promise<void> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ACCEPTED,
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      setBusy(true);
      const { text } = await api.extractJobText({
        uri: asset.uri,
        name: asset.name || "job-description.pdf",
        mimeType: asset.mimeType || "application/pdf",
      });
      if (!text.trim()) {
        Alert.alert(
          "Nothing to read",
          "No text could be found in that file. Paste the description instead."
        );
        return;
      }
      onExtracted(text);
    } catch (err) {
      // The server's messages already say what to do about it (scanned page,
      // wrong format, old .doc), so pass them through unchanged.
      Alert.alert("Could not read that file", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Pressable
        style={[styles.button, (busy || disabled) && styles.buttonDisabled]}
        onPress={() => void pick()}
        disabled={busy || disabled}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons name="document-attach-outline" size={16} color={colors.primary} />
        )}
        <Text style={styles.label}>
          {busy ? "Reading the document…" : "Load from PDF or Word file"}
        </Text>
      </Pressable>
      <Text style={styles.hint}>
        PDF, DOCX or text. The text appears below so you can check it before saving.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
  },
  buttonDisabled: { opacity: 0.5 },
  label: { color: colors.primary, fontSize: 13.5, fontWeight: "700" },
  hint: {
    fontSize: 11,
    color: colors.subtext,
    lineHeight: 15,
    marginTop: 6,
    textAlign: "center",
  },
});
