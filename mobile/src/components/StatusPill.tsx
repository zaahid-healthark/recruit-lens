import type { RecordingStatus } from "@interview-evaluator/shared";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { statusMeta } from "../theme";

/** Small status chip; shows a spinner while the pipeline is running. */
export function StatusPill({ status }: { status: RecordingStatus }): React.JSX.Element {
  const meta = statusMeta[status];
  const busy = status === "TRANSCRIBING" || status === "SCORING";
  return (
    <View style={[styles.pill, { backgroundColor: meta.bg }]}>
      {busy ? <ActivityIndicator size={10} color={meta.color} style={styles.spinner} /> : null}
      <Text style={[styles.label, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  spinner: {
    marginRight: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
  },
});
