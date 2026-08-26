import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAutoImport } from "../autoimport/AutoImportContext";
import type { SkipReason } from "../autoimport/store";
import { AudioPlayerBar } from "../components/AudioPlayerBar";
import { ImportSkippedModal } from "../components/ImportSkippedModal";
import { colors, shadow } from "../theme";
import { formatDate, formatDuration } from "../utils/format";

/**
 * Everything sitting in the watched folder that did NOT reach the server, and
 * why.
 *
 * This list used to be a card buried on the Dialer tab, which meant nobody
 * looked at it — and a recording nobody looks at is the same as a recording
 * that was lost. It is a tab now because it is where a recruiter goes to find
 * a call the automatic path did not catch.
 *
 * Server-rejected calls are excluded: those live on the Not useful screen,
 * so this list stays about work still to do.
 */

const REASON_LABEL: Record<SkipReason, string> = {
  unmatched: "Waiting for you",
  too_short: "Too short",
  no_audio: "No sound recorded",
  not_relevant: "Not an interview",
};

const REASON_HINT: Record<SkipReason, string> = {
  unmatched: "Not dialled from this app — send it if it was an interview.",
  too_short: "Shorter than the minimum in Settings.",
  no_audio: "The recorder saved an empty file — usually a permission that lapsed.",
  not_relevant: "The server judged this unrelated to recruitment.",
};

type FilterKey = "all" | SkipReason;

type SortKey = "newest" | "oldest" | "longest" | "shortest" | "name";

const SORTS: { key: SortKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "newest", label: "Newest", icon: "arrow-down" },
  { key: "oldest", label: "Oldest", icon: "arrow-up" },
  { key: "longest", label: "Longest", icon: "time-outline" },
  { key: "shortest", label: "Shortest", icon: "flash-outline" },
  { key: "name", label: "Name", icon: "text-outline" },
];

export function LocalAudioScreen(): React.JSX.Element {
  const navigation = useNavigation<{ navigate: (s: string) => void }>();
  const { folderUri, skipped, scanning, scanNow, importSkipped, deleteSkipped, lastScanSummary } =
    useAutoImport();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [namingUri, setNamingUri] = useState<string | null>(null);
  const [busyUri, setBusyUri] = useState<string | null>(null);

  // Rejected calls have their own screen; showing them here too would make this
  // list read as a backlog when most of it needs no action.
  const relevant = useMemo(() => skipped.filter((f) => f.reason !== "not_relevant"), [skipped]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: relevant.length };
    for (const f of relevant) c[f.reason] = (c[f.reason] ?? 0) + 1;
    return c;
  }, [relevant]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = relevant.filter(
      (f) =>
        (filter === "all" || f.reason === filter) &&
        (!q || f.name.toLowerCase().includes(q) || (f.suggestedCandidateName ?? "").toLowerCase().includes(q))
    );
    // Copy before sorting: relevant is derived from context state, and sorting
    // in place would mutate it.
    return [...matched].sort((a, b) => {
      switch (sort) {
        case "oldest":
          return a.seenAt.localeCompare(b.seenAt);
        case "longest":
          // Unreadable durations sink rather than sorting as zero-length, which
          // would push them to the top of "shortest" and bury real hang-ups.
          return (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1);
        case "shortest":
          return (a.durationSeconds ?? Infinity) - (b.durationSeconds ?? Infinity);
        case "name":
          return a.name.localeCompare(b.name, undefined, { numeric: true });
        default:
          return b.seenAt.localeCompare(a.seenAt);
      }
    });
  }, [relevant, filter, query, sort]);

  const filters: FilterKey[] = useMemo(
    () => ["all", ...(Object.keys(REASON_LABEL) as SkipReason[]).filter((r) => counts[r] > 0 && r !== "not_relevant")],
    [counts]
  );

  const runImport = async (input: {
    uri: string;
    candidateName: string;
    jobId: string | null;
    renameLocal: boolean;
  }): Promise<void> => {
    setBusyUri(input.uri);
    try {
      await importSkipped(input.uri, input.candidateName, input.jobId, input.renameLocal);
      setNamingUri(null);
    } catch (err) {
      Alert.alert("Could not send", err instanceof Error ? err.message : String(err));
    } finally {
      setBusyUri(null);
    }
  };

  const confirmDelete = (uri: string, name: string): void => {
    Alert.alert(
      "Delete from phone",
      `Permanently delete "${name}" from your recorder's folder? It was never sent, so this is the only copy.`,
      [
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
      ]
    );
  };

  if (!folderUri) {
    return (
      <View style={styles.empty}>
        <Ionicons name="folder-open-outline" size={40} color={colors.subtext} />
        <Text style={styles.emptyTitle}>No folder is being watched</Text>
        <Text style={styles.emptyText}>
          Choose the folder your call recorder saves to, and recordings will appear here
          automatically.
        </Text>
        <Pressable style={styles.primaryButton} onPress={() => navigation.navigate("Settings")}>
          <Ionicons name="settings-outline" size={16} color="#FFFFFF" />
          <Text style={styles.primaryLabel}>Open settings</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Ionicons name="search" size={15} color={colors.subtext} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by file or name"
            placeholderTextColor={colors.subtext}
            value={query}
            onChangeText={setQuery}
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.subtext} />
            </Pressable>
          ) : null}
        </View>
        <Pressable style={styles.syncButton} onPress={() => void scanNow()} disabled={scanning}>
          {scanning ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="refresh" size={17} color="#FFFFFF" />
          )}
        </Pressable>
      </View>

      {filters.length > 1 ? (
        <View style={styles.chipRow}>
          {filters.map((f) => {
            const active = filter === f;
            return (
              <Pressable
                key={f}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(f)}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {f === "all" ? "All" : REASON_LABEL[f]} ({counts[f] ?? 0})
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Hidden for a single item, where sorting is meaningless noise. */}
      {relevant.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sortRow}
        >
          {SORTS.map((o) => {
            const active = sort === o.key;
            return (
              <Pressable
                key={o.key}
                style={[styles.sortChip, active && styles.sortChipActive]}
                onPress={() => setSort(o.key)}
              >
                <Ionicons name={o.icon} size={12} color={active ? "#FFFFFF" : colors.subtext} />
                <Text style={[styles.sortLabel, active && styles.sortLabelActive]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <FlatList
        data={visible}
        keyExtractor={(item) => item.uri}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.rowTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.meta}>
                  {formatDuration(item.durationSeconds)} • {formatDate(item.seenAt)}
                </Text>
              </View>
              {busyUri === item.uri ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <View style={styles.actions}>
                  <Pressable
                    hitSlop={6}
                    onPress={() => setNamingUri(item.uri)}
                    accessibilityLabel="Name and send"
                  >
                    <Ionicons name="cloud-upload-outline" size={20} color={colors.primary} />
                  </Pressable>
                  <Pressable
                    hitSlop={6}
                    onPress={() => confirmDelete(item.uri, item.name)}
                    accessibilityLabel="Delete from phone"
                  >
                    <Ionicons name="trash-outline" size={20} color={colors.danger} />
                  </Pressable>
                </View>
              )}
            </View>

            <View style={styles.badgeRow}>
              <View style={styles.badge}>
                <Text style={styles.badgeLabel}>{REASON_LABEL[item.reason]}</Text>
              </View>
              {item.suggestedCandidateName ? (
                <Text style={styles.suggestion} numberOfLines={1}>
                  Possibly {item.suggestedCandidateName}
                </Text>
              ) : null}
            </View>
            <Text style={styles.reasonHint}>{REASON_HINT[item.reason]}</Text>

            <AudioPlayerBar
              source={item.uri}
              fallbackDurationSeconds={item.durationSeconds}
              compact
            />
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={40} color={colors.subtext} />
            <Text style={styles.emptyTitle}>
              {relevant.length === 0 ? "Nothing waiting" : "Nothing matches"}
            </Text>
            <Text style={styles.emptyText}>
              {relevant.length === 0
                ? `Every recording in the folder has been dealt with.${lastScanSummary ? ` Last check: ${lastScanSummary}.` : ""}`
                : "Try a different filter or clear the search."}
            </Text>
          </View>
        }
      />

      <ImportSkippedModal
        file={skipped.find((f) => f.uri === namingUri) ?? null}
        defaultJob={null}
        onCancel={() => setNamingUri(null)}
        onSubmit={runImport}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toolbar: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12 },
  search: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: { flex: 1, fontSize: 13.5, color: colors.text, padding: 0 },
  syncButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: 12, color: colors.text, fontWeight: "600" },
  chipLabelActive: { color: "#FFFFFF" },
  sortRow: { gap: 8, paddingHorizontal: 16, paddingTop: 10 },
  sortChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  sortLabel: { fontSize: 11.5, color: colors.subtext, fontWeight: "600" },
  sortLabelActive: { color: "#FFFFFF" },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 14, ...shadow },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { fontSize: 13.5, fontWeight: "700", color: colors.text },
  meta: { fontSize: 11.5, color: colors.subtext, marginTop: 2 },
  actions: { flexDirection: "row", alignItems: "center", gap: 16 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  badge: {
    backgroundColor: colors.background,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeLabel: { fontSize: 11, fontWeight: "700", color: colors.text },
  suggestion: { flex: 1, fontSize: 11.5, color: colors.warning, fontWeight: "600" },
  reasonHint: { fontSize: 11.5, color: colors.subtext, lineHeight: 16, marginTop: 6 },
  empty: { alignItems: "center", justifyContent: "center", padding: 32, gap: 10, flex: 1 },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: colors.text },
  emptyText: { fontSize: 12.5, color: colors.subtext, textAlign: "center", lineHeight: 18 },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
    marginTop: 6,
  },
  primaryLabel: { color: "#FFFFFF", fontSize: 13.5, fontWeight: "800" },
});
