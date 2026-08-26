import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { JobDto } from "@interview-evaluator/shared";
import { useAutoImport } from "../autoimport/AutoImportContext";
import { JobPicker } from "../components/JobPicker";
import { colors, shadow } from "../theme";
import { formatDate } from "../utils/format";

/**
 * Manual outbound call.
 *
 * Most calls are dialled from the phone's own dialer and picked up by the
 * watched folder, which is why this is no longer a tab. It survives for the
 * case worth the extra taps: binding a candidate name and a JD to a call up
 * front, so the recording arrives already labelled instead of relying on the
 * server to work out who it was.
 *
 * Auto-import configuration lives in Settings; the files it holds back live
 * on the On this phone tab.
 */
export function DialerScreen(): React.JSX.Element {
  const {
    folderUri,
    pendingCalls,
    startCall,
    removePendingCall,
  } = useAutoImport();

  const [candidateName, setCandidateName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [job, setJob] = useState<JobDto | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleCall = async (): Promise<void> => {
    const ok = await startCall(
      candidateName,
      phoneNumber,
      job ? { id: job.id, title: job.title } : null
    );
    if (ok) {
      setCandidateName("");
      setPhoneNumber("");
      // The job deliberately persists — screening several candidates for one
      // role back-to-back is the common case.
      if (!folderUri) {
        Alert.alert(
          "Reminder",
          "No recordings folder is being watched yet. After the call, pick your recorder's folder below so the file is imported automatically."
        );
      }
    }
  };

  const handleRemovePending = (id: string, name: string): void => {
    Alert.alert("Remove pending call", `Stop waiting for a recording of the call with ${name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removePendingCall(id) },
    ]);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Call a candidate ── */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardIcon}>
            <Ionicons name="call-outline" size={18} color={colors.primary} />
          </View>
          <Text style={styles.cardTitle}>Call a candidate</Text>
        </View>
        <Text style={styles.cardHint}>
          Opens your phone&apos;s dialer. Record the call with your recorder app (e.g. Cube ACR) —
          the recording is then imported automatically and named after the candidate.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Candidate name"
          placeholderTextColor={colors.subtext}
          value={candidateName}
          onChangeText={setCandidateName}
          autoCapitalize="words"
        />
        <TextInput
          style={styles.input}
          placeholder="Phone number"
          placeholderTextColor={colors.subtext}
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          keyboardType="phone-pad"
        />
        <Pressable style={styles.jobRow} onPress={() => setPickerOpen(true)}>
          <Ionicons
            name={job ? "briefcase" : "briefcase-outline"}
            size={15}
            color={job ? colors.primary : colors.subtext}
          />
          <Text style={[styles.jobLabel, !job && styles.jobLabelEmpty]} numberOfLines={1}>
            {job ? job.title : "Screen against a job description (optional)"}
          </Text>
          <Ionicons name="chevron-forward" size={15} color={colors.subtext} />
        </Pressable>

        <Pressable style={styles.callButton} onPress={() => void handleCall()}>
          <Ionicons name="call" size={16} color="#FFFFFF" />
          <Text style={styles.callButtonLabel}>Open dialer &amp; call</Text>
        </Pressable>
      </View>

      {/* ── Pending calls ── */}
      {pendingCalls.length > 0 ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="hourglass-outline" size={18} color={colors.warning} />
            </View>
            <Text style={styles.cardTitle}>Waiting for recording ({pendingCalls.length})</Text>
          </View>
          <Text style={styles.cardHint}>
            When the recording of one of these calls appears in the watched folder, it is uploaded
            as &quot;candidate + date&quot; automatically.
          </Text>
          {pendingCalls.map((call) => (
            <View key={call.id} style={styles.pendingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingName}>{call.candidateName}</Text>
                <Text style={styles.pendingMeta}>
                  {call.phoneNumber} • called {formatDate(call.startedAt)}
                </Text>
                {call.jobTitle ? (
                  <Text style={styles.pendingJob} numberOfLines={1}>
                    <Ionicons name="briefcase" size={11} color={colors.primary} />{" "}
                    {call.jobTitle}
                  </Text>
                ) : null}
              </View>
              <Pressable
                hitSlop={8}
                onPress={() => handleRemovePending(call.id, call.candidateName)}
              >
                <Ionicons name="close-circle-outline" size={20} color={colors.subtext} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={styles.footnote}>
        In-app calling (without the phone dialer) is planned for a future release.
      </Text>


      <JobPicker
        visible={pickerOpen}
        selectedJobId={job?.id ?? null}
        onClose={() => setPickerOpen(false)}
        onSelect={(next) => {
          setJob(next);
          setPickerOpen(false);
        }}
      />
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
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    ...shadow,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  cardIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
  },
  cardHint: {
    fontSize: 12.5,
    color: colors.subtext,
    lineHeight: 18,
    marginBottom: 12,
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
  jobRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 10,
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
  pendingJob: {
    fontSize: 11.5,
    color: colors.primary,
    fontWeight: "600",
    marginTop: 3,
  },
  callButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 2,
  },
  callButtonLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  skippedRow: {
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  skippedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  skippedName: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
  },
  skippedMeta: {
    fontSize: 11.5,
    color: colors.subtext,
    marginTop: 2,
  },
  suggestion: {
    fontSize: 11.5,
    color: colors.warning,
    fontWeight: "600",
    marginTop: 2,
  },
  skippedActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pendingName: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  pendingMeta: {
    fontSize: 12,
    color: colors.subtext,
    marginTop: 2,
  },
  folderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
  },
  folderLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
  },
  statusLine: {
    fontSize: 12,
    color: colors.subtext,
    lineHeight: 17,
    marginBottom: 4,
  },
  settlingLine: {
    fontSize: 12,
    color: colors.warning,
    fontWeight: "600",
    lineHeight: 17,
    marginTop: 2,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  optionLabel: {
    flex: 1,
    fontSize: 12.5,
    color: colors.text,
    fontWeight: "600",
  },
  optionHint: {
    fontSize: 11.5,
    color: colors.subtext,
    lineHeight: 16,
    marginTop: 6,
  },
  chipRow: {
    flexDirection: "row",
    gap: 7,
    marginTop: 8,
  },
  chip: {
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 7,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.subtext,
  },
  chipLabelActive: {
    color: colors.primary,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
  },
  secondaryButtonLabel: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "700",
  },
  footnote: {
    fontSize: 11.5,
    color: colors.subtext,
    textAlign: "center",
    marginTop: 4,
  },
});
