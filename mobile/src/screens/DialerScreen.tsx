import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import type { JobDto } from "@interview-evaluator/shared";
import { api } from "../api/client";
import { useAutoImport } from "../autoimport/AutoImportContext";
import { AudioPlayerBar } from "../components/AudioPlayerBar";
import { JobPicker } from "../components/JobPicker";
import { formatSweepTime } from "../autoimport/store";
import { colors, shadow } from "../theme";
import { formatDate, formatDuration } from "../utils/format";

/**
 * ── DIALER + AUTO-IMPORT ─────────────────────────────────────────────────────
 *
 * Calling works through the phone's native dialer: enter candidate name +
 * number → a "pending call" is registered → the dialer opens pre-filled → the
 * recruiter presses the call button. A recorder app (e.g. Cube ACR) saves the
 * call audio into its folder; the watched-folder scanner below picks the file
 * up, matches it back to the pending call (via the number embedded in the
 * filename), renames it "<Candidate> <date>" and uploads it for evaluation.
 *
 * Still stubbed for a future release: true in-app calling via a CPaaS
 * provider (Exotel/Plivo click-to-call + webhook auto-import). The seam is
 * this same screen — replace startCall() with a POST /calls integration.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/** Preset times for the daily upload sweep. */
const SWEEP_TIMES: { label: string; hour: number }[] = [
  { label: "9 AM", hour: 9 },
  { label: "1 PM", hour: 13 },
  { label: "5 PM", hour: 17 },
  { label: "9 PM", hour: 21 },
];

export function DialerScreen(): React.JSX.Element {
  const {
    folderUri,
    folderLabel,
    enabled,
    scanning,
    pendingCalls,
    lastScanAt,
    lastScanSummary,
    totalImported,
    settlingCount,
    renameOnDisk,
    dailySweepHour,
    dailySweepMinute,
    pickFolder,
    setEnabled,
    setRenameOnDisk,
    setDailySweepTime,
    scanNow,
    startCall,
    removePendingCall,
    skipped,
    minDurationSeconds,
    setMinDurationSeconds,
    importSkipped,
    deleteSkipped,
  } = useAutoImport();

  const [candidateName, setCandidateName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [job, setJob] = useState<JobDto | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** URI currently being imported/deleted, so its row can show progress. */
  const [busyUri, setBusyUri] = useState<string | null>(null);

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

  const handleImportSkipped = (uri: string, name: string): void => {
    Alert.prompt
      ? Alert.prompt(
          "Import this recording",
          "Candidate name (optional) — leave blank to keep the original filename.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Import",
              onPress: (value?: string) => void runImport(uri, value ?? ""),
            },
          ],
          "plain-text"
        )
      : // Alert.prompt is iOS-only; on Android import under the existing name.
        Alert.alert("Import this recording", `Upload "${name}" for evaluation?`, [
          { text: "Cancel", style: "cancel" },
          { text: "Import", onPress: () => void runImport(uri, "") },
        ]);
  };

  const runImport = async (uri: string, name: string): Promise<void> => {
    setBusyUri(uri);
    try {
      await importSkipped(uri, name, job?.id ?? null);
    } catch (err) {
      Alert.alert("Import failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyUri(null);
    }
  };

  const handleDeleteSkipped = (uri: string, name: string): void => {
    Alert.alert("Delete recording", `Permanently delete "${name}" from the folder?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusyUri(uri);
            try {
              await deleteSkipped(uri);
            } catch (err) {
              Alert.alert("Delete failed", err instanceof Error ? err.message : String(err));
            } finally {
              setBusyUri(null);
            }
          })();
        },
      },
    ]);
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

      {/* ── Held back: recorded but deliberately not uploaded ── */}
      {skipped.length > 0 ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons name="filter-outline" size={18} color={colors.subtext} />
            </View>
            <Text style={styles.cardTitle}>Not uploaded ({skipped.length})</Text>
          </View>
          <Text style={styles.cardHint}>
            Recordings in the folder that were kept off the server — calls you did not dial
            from this app, and anything shorter than {minDurationSeconds}s. Play them to
            check, then import or delete.
          </Text>
          {skipped.map((file) => (
            <View key={file.uri} style={styles.skippedRow}>
              <View style={styles.skippedHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.skippedName} numberOfLines={1}>
                    {file.name}
                  </Text>
                  <Text style={styles.skippedMeta}>
                    {file.reason === "unmatched" ? "Not a dialled call" : "Too short"} •{" "}
                    {formatDuration(file.durationSeconds)} • {formatDate(file.seenAt)}
                  </Text>
                </View>
                {busyUri === file.uri ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <View style={styles.skippedActions}>
                    <Pressable
                      hitSlop={6}
                      onPress={() => handleImportSkipped(file.uri, file.name)}
                      accessibilityLabel="Import this recording"
                    >
                      <Ionicons name="cloud-upload-outline" size={19} color={colors.primary} />
                    </Pressable>
                    <Pressable
                      hitSlop={6}
                      onPress={() => handleDeleteSkipped(file.uri, file.name)}
                      accessibilityLabel="Delete this recording"
                    >
                      <Ionicons name="trash-outline" size={19} color={colors.danger} />
                    </Pressable>
                  </View>
                )}
              </View>
              <AudioPlayerBar
                source={file.uri}
                fallbackDurationSeconds={file.durationSeconds}
                compact
              />
            </View>
          ))}
        </View>
      ) : null}

      {/* ── Watched folder / auto-import ── */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardIcon}>
            <Ionicons name="folder-open-outline" size={18} color={colors.primary} />
          </View>
          <Text style={styles.cardTitle}>Auto-import folder</Text>
          {folderUri ? (
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor="#FFFFFF"
            />
          ) : null}
        </View>

        {folderUri ? (
          <View>
            <View style={styles.folderRow}>
              <Ionicons name="folder" size={15} color={colors.primary} />
              <Text style={styles.folderLabel} numberOfLines={1}>
                {folderLabel ?? "Selected folder"}
              </Text>
            </View>
            <Text style={styles.statusLine}>
              {enabled
                ? "Watching for new audio files — on open, on return to the app, and every minute."
                : "Watching is paused."}
            </Text>
            <Text style={styles.statusLine}>
              {lastScanAt
                ? `Last scan ${formatDate(lastScanAt)}: ${lastScanSummary ?? "—"}`
                : "Not scanned yet."}
              {totalImported > 0 ? ` • ${totalImported} imported so far` : ""}
            </Text>
            {settlingCount > 0 ? (
              <Text style={styles.settlingLine}>
                {settlingCount} file{settlingCount === 1 ? "" : "s"} still being recorded — will
                upload once the call ends.
              </Text>
            ) : null}

            <View style={styles.optionRow}>
              <Ionicons name="time-outline" size={16} color={colors.subtext} />
              <Text style={styles.optionLabel}>
                Daily sweep at {formatSweepTime(dailySweepHour, dailySweepMinute)}
              </Text>
            </View>
            <View style={styles.chipRow}>
              {SWEEP_TIMES.map((t) => {
                const active = dailySweepHour === t.hour && dailySweepMinute === 0;
                return (
                  <Pressable
                    key={t.hour}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setDailySweepTime(t.hour, 0)}
                  >
                    <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                      {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.optionRow}>
              <Ionicons name="pricetag-outline" size={16} color={colors.subtext} />
              <Text style={styles.optionLabel}>Rename the file in the folder too</Text>
              <Switch
                value={renameOnDisk}
                onValueChange={setRenameOnDisk}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor="#FFFFFF"
              />
            </View>
            <View style={styles.buttonRow}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => void scanNow()}
                disabled={scanning}
              >
                {scanning ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="refresh" size={15} color={colors.primary} />
                )}
                <Text style={styles.secondaryButtonLabel}>
                  {scanning ? "Scanning…" : "Scan now"}
                </Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => void pickFolder()}>
                <Ionicons name="swap-horizontal" size={15} color={colors.primary} />
                <Text style={styles.secondaryButtonLabel}>Change folder</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View>
            <Text style={styles.cardHint}>
              Choose the folder where your call recorder saves audio (for Cube ACR this is usually
              CubeCallRecorder/All). New recordings in it are uploaded to the server automatically —
              no share sheet needed.
            </Text>
            <Pressable style={styles.callButton} onPress={() => void pickFolder()}>
              <Ionicons name="folder-open" size={16} color="#FFFFFF" />
              <Text style={styles.callButtonLabel}>Choose folder to watch</Text>
            </Pressable>
          </View>
        )}
      </View>

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
