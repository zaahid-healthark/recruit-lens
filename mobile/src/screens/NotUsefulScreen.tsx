import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAutoImport } from "../autoimport/AutoImportContext";
import { AudioPlayerBar } from "../components/AudioPlayerBar";
import { ImportSkippedModal } from "../components/ImportSkippedModal";
import { colors, shadow } from "../theme";
import { formatDate, formatDuration } from "../utils/format";

/**
 * Calls the server listened to and judged unrelated to recruitment.
 *
 * Nothing here was stored server-side — the audio was decided on and discarded
 * before it became a recording, so the only copy is still on this phone. That
 * is why this screen exists rather than the app deleting silently: the verdict
 * is a model's judgement, and a recruiter has to be able to see what it turned
 * away and overrule it.
 */

export function NotUsefulScreen(): React.JSX.Element {
  const { skipped, importSkipped, deleteSkipped } = useAutoImport();
  const [query, setQuery] = useState("");
  const [namingUri, setNamingUri] = useState<string | null>(null);
  const [busyUri, setBusyUri] = useState<string | null>(null);

  const rejected = useMemo(() => skipped.filter((f) => f.reason === "not_relevant"), [skipped]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rejected;
    return rejected.filter(
      (f) => f.name.toLowerCase().includes(q) || (f.serverReason ?? "").toLowerCase().includes(q)
    );
  }, [rejected, query]);

  const runImport = async (input: {
    uri: string;
    candidateName: string;
    jobId: string | null;
    renameLocal: boolean;
  }): Promise<void> => {
    setBusyUri(input.uri);
    try {
      // Sending from here is an explicit human override, so it goes up named
      // and unscreened — the gate has already had its say and been overruled.
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
      `Permanently delete "${name}"? It was never sent to the server, so this is the only copy.`,
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

  return (
    <View style={styles.container}>
      {rejected.length > 0 ? (
        <>
          <Text style={styles.blurb}>
            These calls were listened to and judged not to be recruitment work, so nothing was
            stored on the server. If one of them was an interview, send it — that overrides the
            check.
          </Text>
          <View style={styles.search}>
            <Ionicons name="search" size={15} color={colors.subtext} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search"
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
        </>
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
                    accessibilityLabel="Send anyway"
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

            {item.serverReason ? <Text style={styles.reason}>{item.serverReason}</Text> : null}

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
              {rejected.length === 0 ? "Nothing turned away" : "Nothing matches"}
            </Text>
            <Text style={styles.emptyText}>
              {rejected.length === 0
                ? "Personal and unrelated calls will collect here instead of reaching the server."
                : "Try a different search."}
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
  blurb: {
    fontSize: 12.5,
    color: colors.subtext,
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    marginHorizontal: 16,
    marginTop: 12,
  },
  searchInput: { flex: 1, fontSize: 13.5, color: colors.text, padding: 0 },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 14, ...shadow },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { fontSize: 13.5, fontWeight: "700", color: colors.text },
  meta: { fontSize: 11.5, color: colors.subtext, marginTop: 2 },
  actions: { flexDirection: "row", alignItems: "center", gap: 16 },
  reason: { fontSize: 12, color: colors.subtext, lineHeight: 17, marginTop: 8, fontStyle: "italic" },
  empty: { alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: colors.text },
  emptyText: { fontSize: 12.5, color: colors.subtext, textAlign: "center", lineHeight: 18 },
});
