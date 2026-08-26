import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useAutoImport } from "../autoimport/AutoImportContext";
import { formatSweepTime } from "../autoimport/store";
import { colors, shadow } from "../theme";
import { formatDate } from "../utils/format";

/**
 * Everything that configures auto-import, in one place.
 *
 * These controls used to sit on the Dialer tab underneath the call form, where
 * they crowded out the thing that tab is for. Recruiters set them once and
 * rarely touch them again, so they belong behind the menu, not in a tab.
 */

/**
 * Minimum call length worth sending. A screening call that ends in under a
 * minute and a half never got going — wrong number, voicemail, or a
 * reschedule. "Off" sends everything, for when the threshold gets in the way.
 */
const MIN_DURATIONS: { label: string; seconds: number }[] = [
  { label: "Off", seconds: 0 },
  { label: "30s", seconds: 30 },
  { label: "90s", seconds: 90 },
  { label: "3 min", seconds: 180 },
];

const SWEEP_TIMES: { label: string; hour: number }[] = [
  { label: "9 AM", hour: 9 },
  { label: "1 PM", hour: 13 },
  { label: "5 PM", hour: 17 },
  { label: "9 PM", hour: 21 },
];

export function SettingsScreen(): React.JSX.Element {
  const {
    folderUri,
    folderLabel,
    enabled,
    scanning,
    lastScanAt,
    lastScanSummary,
    totalImported,
    renameOnDisk,
    dailySweepHour,
    dailySweepMinute,
    minDurationSeconds,
    autoSendAll,
    autoSendRenamed,
    pickFolder,
    setEnabled,
    setRenameOnDisk,
    setDailySweepTime,
    setMinDurationSeconds,
    setAutoSendAll,
    setAutoSendRenamed,
    scanNow,
  } = useAutoImport();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ── Watched folder ── */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardIcon}>
            <Ionicons name="folder-open-outline" size={18} color={colors.primary} />
          </View>
          <Text style={styles.cardTitle}>Recordings folder</Text>
        </View>

        {folderUri ? (
          <>
            <Text style={styles.folder} numberOfLines={2}>
              {folderLabel ?? folderUri}
            </Text>
            <View style={styles.optionRow}>
              <Ionicons name="sync-outline" size={16} color={colors.subtext} />
              <Text style={styles.optionLabel}>Watch this folder</Text>
              <Switch
                value={enabled}
                onValueChange={setEnabled}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor="#FFFFFF"
              />
            </View>
            <Text style={styles.meta}>
              {totalImported} sent so far
              {lastScanAt ? ` • last checked ${formatDate(lastScanAt)}` : ""}
              {lastScanSummary ? ` • ${lastScanSummary}` : ""}
            </Text>
            <View style={styles.buttonRow}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => void scanNow()}
                disabled={scanning}
              >
                {scanning ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <>
                    <Ionicons name="refresh" size={15} color={colors.primary} />
                    <Text style={styles.secondaryLabel}>Check now</Text>
                  </>
                )}
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => void pickFolder()}>
                <Ionicons name="swap-horizontal" size={15} color={colors.primary} />
                <Text style={styles.secondaryLabel}>Change</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.cardHint}>
              Pick the folder your call recorder saves to — for Cube ACR that is
              CubeCallRecorder/All. Android grants access to that one folder only, and remembers
              it across restarts.
            </Text>
            <Pressable style={styles.primaryButton} onPress={() => void pickFolder()}>
              <Ionicons name="folder-open" size={16} color="#FFFFFF" />
              <Text style={styles.primaryLabel}>Choose folder</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* ── What gets sent ── */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardIcon}>
            <Ionicons name="cloud-upload-outline" size={18} color={colors.primary} />
          </View>
          <Text style={styles.cardTitle}>What gets sent</Text>
        </View>

        <View style={styles.optionRow}>
          <Ionicons name="send-outline" size={16} color={colors.subtext} />
          <Text style={styles.optionLabel}>Send calls automatically</Text>
          <Switch
            value={autoSendAll}
            onValueChange={setAutoSendAll}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor="#FFFFFF"
          />
        </View>
        <Text style={styles.hint}>
          {autoSendAll
            ? "Every recording longer than the minimum is sent. The server listens to the opening minutes and keeps only recruitment calls — anything else is rejected before it is stored, and appears under Not useful."
            : "Only calls you dial from this app, or files you rename yourself, are sent. Everything else waits on the On this phone tab for you to send by hand."}
        </Text>

        <View style={styles.optionRow}>
          <Ionicons name="cut-outline" size={16} color={colors.subtext} />
          <Text style={styles.optionLabel}>
            {minDurationSeconds > 0
              ? `Skip calls under ${minDurationSeconds}s`
              : "Send calls of any length"}
          </Text>
        </View>
        <View style={styles.chipRow}>
          {MIN_DURATIONS.map((d) => {
            const active = minDurationSeconds === d.seconds;
            return (
              <Pressable
                key={d.seconds}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setMinDurationSeconds(d.seconds)}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{d.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.optionRow}>
          <Ionicons name="create-outline" size={16} color={colors.subtext} />
          <Text style={styles.optionLabel}>Send recordings you have renamed</Text>
          <Switch
            value={autoSendRenamed}
            onValueChange={setAutoSendRenamed}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor="#FFFFFF"
          />
        </View>
        <Text style={styles.hint}>
          Your recorder writes names like phone_9876543210_20260820_125753. Renaming a file to the
          candidate&apos;s name marks it as an interview and sends it on the next check.
        </Text>

        <View style={styles.optionRow}>
          <Ionicons name="pricetag-outline" size={16} color={colors.subtext} />
          <Text style={styles.optionLabel}>Rename the file on this phone too</Text>
          <Switch
            value={renameOnDisk}
            onValueChange={setRenameOnDisk}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor="#FFFFFF"
          />
        </View>
      </View>

      {/* ── Daily catch-up ── */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardIcon}>
            <Ionicons name="time-outline" size={18} color={colors.primary} />
          </View>
          <Text style={styles.cardTitle}>Daily catch-up</Text>
        </View>
        <Text style={styles.cardHint}>
          Once a day from {formatSweepTime(dailySweepHour, dailySweepMinute)}, anything the server
          turned away for a temporary reason is retried. If the app is closed at that time it
          catches up the next time you open it.
        </Text>
        <View style={styles.chipRow}>
          {SWEEP_TIMES.map((t) => {
            const active = dailySweepHour === t.hour && dailySweepMinute === 0;
            return (
              <Pressable
                key={t.hour}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setDailySweepTime(t.hour, 0)}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Text style={styles.footnote}>
        Recordings stay on this phone whatever happens here — sending a copy to the server never
        deletes the original.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, ...shadow },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  cardIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  cardTitle: { fontSize: 15, fontWeight: "800", color: colors.text },
  cardHint: { fontSize: 12.5, color: colors.subtext, lineHeight: 18, marginBottom: 12 },
  folder: { fontSize: 12.5, color: colors.text, fontWeight: "600", marginBottom: 6 },
  meta: { fontSize: 11.5, color: colors.subtext, marginTop: 8 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  optionLabel: { flex: 1, fontSize: 13, color: colors.text, fontWeight: "600" },
  hint: { fontSize: 11.5, color: colors.subtext, lineHeight: 16, marginTop: 6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: 12.5, color: colors.text, fontWeight: "600" },
  chipLabelActive: { color: "#FFFFFF" },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
  },
  primaryLabel: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  secondaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 11,
  },
  secondaryLabel: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  footnote: { fontSize: 11.5, color: colors.subtext, textAlign: "center", lineHeight: 16 },
});
