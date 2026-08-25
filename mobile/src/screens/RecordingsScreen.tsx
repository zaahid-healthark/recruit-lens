import type {
  BulkStatusDto,
  RecordingListItemDto,
  TaxonomyDto,
} from "@interview-evaluator/shared";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as DocumentPicker from "expo-document-picker";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { api, ApiRequestError, UploadFileInput } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { FilterChips } from "../components/FilterChips";
import { ImportModal } from "../components/ImportModal";
import { ScoreBadge } from "../components/ScoreBadge";
import { SegmentedControl } from "../components/SegmentedControl";
import { StatusPill } from "../components/StatusPill";
import { useRefresh } from "../context/RefreshContext";
import { useInterval } from "../hooks/useInterval";
import type { RecordingsStackParamList } from "../navigation/RootNavigator";
import { colors, shadow } from "../theme";
import { extensionFromMime, formatDate, formatDuration, middleTruncate } from "../utils/format";

type Nav = NativeStackNavigationProp<RecordingsStackParamList, "RecordingsList">;

const POLL_MS = 2500;

export function RecordingsScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const { version, bump } = useRefresh();

  const [recordings, setRecordings] = useState<RecordingListItemDto[] | null>(null);
  const [bulk, setBulk] = useState<BulkStatusDto | null>(null);
  const [taxonomy, setTaxonomy] = useState<TaxonomyDto | null>(null);
  const [tab, setTab] = useState(0); // 0 = Unevaluated, 1 = Evaluated
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState<string | null>(null);
  const [subFilter, setSubFilter] = useState<string | null>(null);
  const [pickedFiles, setPickedFiles] = useState<UploadFileInput[]>([]);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [recs, bulkStatus] = await Promise.all([api.listRecordings(), api.getBulkStatus()]);
      setRecordings(recs);
      setBulk(bulkStatus);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiRequestError ? err.message : String(err));
    }
  }, []);

  // Refetch whenever the screen gains focus or an import/delete happened elsewhere.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, version])
  );

  useEffect(() => {
    api
      .getTaxonomy()
      .then(setTaxonomy)
      .catch(() => undefined); // filters degrade gracefully without taxonomy
  }, []);

  // Poll while anything is being evaluated (single or bulk).
  const anyInFlight =
    (recordings ?? []).some((r) => r.status === "TRANSCRIBING" || r.status === "SCORING") ||
    bulk?.running === true;
  useInterval(() => void load(), anyInFlight ? POLL_MS : null);

  const onRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const pending = useMemo(
    () => (recordings ?? []).filter((r) => r.status !== "EVALUATED"),
    [recordings]
  );
  const evaluated = useMemo(
    () =>
      (recordings ?? []).filter(
        (r) =>
          r.status === "EVALUATED" &&
          (!deptFilter || r.evaluationSummary?.department === deptFilter) &&
          (!subFilter || r.evaluationSummary?.subCategory === subFilter)
      ),
    [recordings, deptFilter, subFilter]
  );

  // Manual upload path (complements the Android share-sheet import):
  // native file picker → same ImportModal confirm sheet → POST /recordings.
  const handlePickFiles = useCallback(async (): Promise<void> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["audio/*", "application/ogg", "video/3gpp"],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      setPickedFiles(
        result.assets.map((asset, i) => ({
          uri: asset.uri,
          name: asset.name || `recording-${i + 1}${extensionFromMime(asset.mimeType)}`,
          mimeType: asset.mimeType || "audio/mpeg",
        }))
      );
    } catch (err) {
      Alert.alert("Could not open file picker", err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Upload icon in the navigation header — reachable from both tabs.
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => void handlePickFiles()} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="cloud-upload-outline" size={23} color={colors.primary} />
        </Pressable>
      ),
    });
  }, [navigation, handlePickFiles]);

  const handleEvaluate = useCallback(
    async (id: string): Promise<void> => {
      try {
        await api.evaluateRecording(id);
        // Optimistic status so the row shows a spinner before the next poll.
        setRecordings((prev) =>
          (prev ?? []).map((r) => (r.id === id ? { ...r, status: "TRANSCRIBING" } : r))
        );
      } catch (err) {
        Alert.alert("Could not start evaluation", err instanceof Error ? err.message : String(err));
      }
    },
    []
  );

  const handleEvaluateAll = useCallback((): void => {
    const count = pending.filter((r) => r.status === "UNEVALUATED").length;
    if (count === 0) {
      Alert.alert("Nothing to evaluate", "There are no unevaluated recordings.");
      return;
    }
    Alert.alert("Evaluate all", `Evaluate ${count} recording${count === 1 ? "" : "s"} now?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Evaluate",
        onPress: () => {
          api
            .startBulkEvaluation()
            .then((status) => {
              setBulk(status);
              void load();
            })
            .catch((err) =>
              Alert.alert("Bulk evaluation failed to start", err instanceof Error ? err.message : String(err))
            );
        },
      },
    ]);
  }, [pending, load]);

  const handleDelete = useCallback(
    (recording: RecordingListItemDto): void => {
      Alert.alert(
        "Delete recording",
        `Delete "${middleTruncate(recording.originalFilename, 40)}" and its evaluation?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              api
                .deleteRecording(recording.id)
                .then(() => {
                  bump();
                  void load();
                })
                .catch((err) =>
                  Alert.alert("Delete failed", err instanceof Error ? err.message : String(err))
                );
            },
          },
        ]
      );
    },
    [bump, load]
  );

  const subOptions = useMemo(() => {
    if (!deptFilter) return [];
    if (deptFilter === "Other") return [];
    const dept = taxonomy?.departments.find((d) => d.name === deptFilter);
    return dept ? [...dept.subCategories, "Other"] : [];
  }, [taxonomy, deptFilter]);

  const renderPendingRow = ({ item }: { item: RecordingListItemDto }): React.JSX.Element => {
    const busy = item.status === "TRANSCRIBING" || item.status === "SCORING";
    return (
      <Pressable
        style={styles.card}
        onLongPress={() => handleDelete(item)}
        onPress={() => navigation.navigate("RecordingDetail", { id: item.id })}
      >
        <View style={styles.rowTop}>
          <View style={styles.fileIcon}>
            <Ionicons name="musical-notes-outline" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fileName} numberOfLines={1}>
              {middleTruncate(item.originalFilename)}
            </Text>
            <Text style={styles.meta}>
              {formatDate(item.importedAt)} • {formatDuration(item.durationSeconds)}
              {item.candidateName ? ` • ${item.candidateName}` : ""}
            </Text>
            <View style={{ marginTop: 6 }}>
              <StatusPill status={item.status} />
            </View>
          </View>
          <View style={styles.rowAction}>
            {busy ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Pressable
                style={[styles.evalButton, item.status === "FAILED" && styles.retryButton]}
                onPress={() => void handleEvaluate(item.id)}
              >
                <Ionicons
                  name={item.status === "FAILED" ? "refresh" : "sparkles-outline"}
                  size={14}
                  color="#FFFFFF"
                />
                <Text style={styles.evalButtonLabel}>
                  {item.status === "FAILED" ? "Retry" : "Evaluate"}
                </Text>
              </Pressable>
            )}
            {/* Long-press works too, but a mistaken upload needs an obvious way out. */}
            <Pressable
              hitSlop={8}
              onPress={() => handleDelete(item)}
              accessibilityLabel="Remove from server"
            >
              <Ionicons name="trash-outline" size={18} color={colors.subtext} />
            </Pressable>
          </View>
        </View>
        {item.status === "FAILED" && item.errorMessage ? (
          <Text style={styles.errorText} numberOfLines={2}>
            {item.errorMessage}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  const renderEvaluatedRow = ({ item }: { item: RecordingListItemDto }): React.JSX.Element => {
    const summary = item.evaluationSummary;
    return (
      <Pressable
        style={styles.card}
        onPress={() => navigation.navigate("RecordingDetail", { id: item.id })}
        onLongPress={() => handleDelete(item)}
      >
        <View style={styles.rowTop}>
          {summary ? <ScoreBadge score={summary.overallScore} /> : null}
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.roleText} numberOfLines={1}>
              {summary?.roleDesignation ?? "Unknown role"}
            </Text>
            <Text style={styles.classificationText} numberOfLines={1}>
              {summary ? `${summary.department} › ${summary.subCategory}` : ""}
            </Text>
            {item.job ? (
              <View style={styles.jobTag}>
                <Ionicons name="briefcase" size={10} color={colors.primary} />
                <Text style={styles.jobTagLabel} numberOfLines={1}>
                  {item.job.title}
                </Text>
              </View>
            ) : null}
            <Text style={styles.meta} numberOfLines={1}>
              {item.candidateName ? `${item.candidateName} • ` : ""}
              {middleTruncate(item.originalFilename, 24)} • {formatDate(item.importedAt)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.subtext} />
        </View>
      </Pressable>
    );
  };

  const bulkBanner =
    bulk?.running === true ? (
      <View style={[styles.card, styles.bulkCard]}>
        <View style={styles.bulkHeader}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.bulkTitle}>
            Evaluating… {bulk.processed} of {bulk.total} done
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${bulk.total > 0 ? (bulk.processed / bulk.total) * 100 : 0}%` },
            ]}
          />
        </View>
        {bulk.failed > 0 ? (
          <Text style={styles.bulkFailedText}>{bulk.failed} failed so far</Text>
        ) : null}
      </View>
    ) : null;

  const listHeader =
    tab === 0 ? (
      <View>
        {bulkBanner}
        {!bulk?.running && pending.some((r) => r.status === "UNEVALUATED") ? (
          <Pressable style={styles.evaluateAllButton} onPress={handleEvaluateAll}>
            <Ionicons name="sparkles" size={16} color="#FFFFFF" />
            <Text style={styles.evaluateAllLabel}>
              Evaluate all ({pending.filter((r) => r.status === "UNEVALUATED").length})
            </Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.uploadButton} onPress={() => void handlePickFiles()}>
          <Ionicons name="folder-open-outline" size={15} color={colors.primary} />
          <Text style={styles.uploadButtonLabel}>Upload a recording from this device</Text>
        </Pressable>
      </View>
    ) : (
      <View style={styles.filters}>
        <FilterChips
          options={[...(taxonomy?.departments.map((d) => d.name) ?? []), "Other"]}
          selected={deptFilter}
          onSelect={(value) => {
            setDeptFilter(value);
            setSubFilter(null);
          }}
        />
        {subOptions.length > 0 ? (
          <View style={{ marginTop: 8 }}>
            <FilterChips options={subOptions} selected={subFilter} onSelect={setSubFilter} />
          </View>
        ) : null}
      </View>
    );

  const data = tab === 0 ? pending : evaluated;

  return (
    <View style={styles.container}>
      <View style={styles.segmentWrap}>
        <SegmentedControl
          options={[`Unevaluated (${pending.length})`, `Evaluated (${evaluated.length})`]}
          selectedIndex={tab}
          onChange={setTab}
        />
      </View>

      {loadError && recordings === null ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Can't reach the server"
          subtitle={loadError}
        />
      ) : recordings === null ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          renderItem={tab === 0 ? renderPendingRow : renderEvaluatedRow}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            tab === 0 ? (
              <EmptyState
                icon="share-social-outline"
                title="No recordings waiting"
                subtitle="Share a call recording into this app from the Android share sheet, or use “Upload a recording” above to pick a file from this device."
              />
            ) : (
              <EmptyState
                icon="ribbon-outline"
                title="No evaluations yet"
                subtitle={
                  deptFilter || subFilter
                    ? "Nothing matches the current filters."
                    : "Evaluate a recording from the Unevaluated tab to see results here."
                }
              />
            )
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={colors.primary}
            />
          }
        />
      )}
      <ImportModal
        visible={pickedFiles.length > 0}
        files={pickedFiles}
        onClose={() => setPickedFiles([])}
        onImported={() => {
          setPickedFiles([]);
          setTab(0); // uploads land in Unevaluated — show them
          bump();
          void load();
        }}
      />
      {loadError && recordings !== null ? (
        <View style={styles.errorBanner}>
          <Ionicons name="warning-outline" size={14} color="#FFFFFF" />
          <Text style={styles.errorBannerText} numberOfLines={1}>
            {loadError}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  segmentWrap: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    padding: 16,
    paddingTop: 4,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    ...shadow,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  fileIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  fileName: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  meta: {
    fontSize: 12,
    color: colors.subtext,
    marginTop: 2,
  },
  rowAction: {
    marginLeft: 10,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 84,
    gap: 10,
  },
  evalButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.primary,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  retryButton: {
    backgroundColor: colors.danger,
  },
  evalButtonLabel: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  errorText: {
    marginTop: 8,
    fontSize: 12,
    color: colors.danger,
    lineHeight: 16,
  },
  roleText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  jobTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: colors.primarySoft,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
    maxWidth: "100%",
  },
  jobTagLabel: {
    flexShrink: 1,
    fontSize: 10.5,
    fontWeight: "700",
    color: colors.primary,
  },
  classificationText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.primary,
    marginTop: 2,
  },
  bulkCard: {
    backgroundColor: colors.primarySoft,
  },
  bulkHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bulkTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.primary,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(79, 70, 229, 0.18)",
    marginTop: 10,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  bulkFailedText: {
    marginTop: 6,
    fontSize: 12,
    color: colors.danger,
    fontWeight: "600",
  },
  evaluateAllButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    marginBottom: 12,
  },
  evaluateAllLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  uploadButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 12,
  },
  uploadButtonLabel: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "700",
  },
  filters: {
    marginBottom: 12,
  },
  errorBanner: {
    position: "absolute",
    bottom: 12,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.danger,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorBannerText: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
});
