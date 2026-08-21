import type { DashboardStatsDto } from "@interview-evaluator/shared";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { api, ApiRequestError } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { HorizontalBars, VerticalBarChart } from "../components/charts";
import { useRefresh } from "../context/RefreshContext";
import { colors, scoreColor, shadow } from "../theme";

interface StatCardProps {
  label: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

function StatCard({ label, value, icon, color }: StatCardProps): React.JSX.Element {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: `${color}1A` }]}>
        <Ionicons name={icon} size={17} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function DashboardScreen(): React.JSX.Element {
  const { version } = useRefresh();
  const [stats, setStats] = useState<DashboardStatsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setStats(await api.getDashboardStats());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : String(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, version])
  );

  const onRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!stats) {
    return (
      <View style={styles.center}>
        {error ? (
          <EmptyState icon="cloud-offline-outline" title="Can't reach the server" subtitle={error} />
        ) : (
          <ActivityIndicator size="large" color={colors.primary} />
        )}
      </View>
    );
  }

  const palette = colors.chartPalette;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={colors.primary}
        />
      }
    >
      {/* ── Totals ── */}
      <View style={styles.statGrid}>
        <StatCard label="Total recordings" value={stats.totals.recordings} icon="albums-outline" color={colors.primary} />
        <StatCard label="Evaluated" value={stats.totals.evaluated} icon="checkmark-done-outline" color={colors.success} />
        <StatCard label="Unevaluated" value={stats.totals.unevaluated + stats.totals.inProgress} icon="hourglass-outline" color={colors.warning} />
        <StatCard label="Failed" value={stats.totals.failed} icon="alert-circle-outline" color={colors.danger} />
      </View>

      {/* ── Average overall score ── */}
      <View style={[styles.sectionCard, styles.avgCard]}>
        <View>
          <Text style={styles.avgLabel}>Average overall score</Text>
          <Text style={styles.avgHint}>across {stats.totals.evaluated} evaluated interview{stats.totals.evaluated === 1 ? "" : "s"}</Text>
        </View>
        <Text
          style={[
            styles.avgValue,
            { color: stats.averageOverallScore != null ? scoreColor(stats.averageOverallScore) : colors.subtext },
          ]}
        >
          {stats.averageOverallScore ?? "—"}
        </Text>
      </View>

      {stats.totals.evaluated === 0 ? (
        <EmptyState
          icon="stats-chart-outline"
          title="No evaluations yet"
          subtitle="Evaluate recordings to populate the dashboard."
        />
      ) : (
        <>
          <Section title="Score distribution">
            <VerticalBarChart
              data={stats.scoreHistogram.map((b) => ({
                label: b.band,
                value: b.count,
                color: colors.primary,
              }))}
            />
          </Section>

          <Section title="By department">
            <HorizontalBars
              data={stats.byDepartment.map((d, i) => ({
                label: d.name,
                value: d.count,
                color: palette[i % palette.length],
              }))}
            />
          </Section>

          <Section title="Average score per category">
            <HorizontalBars
              maxValue={100}
              data={stats.categoryAverages.map((c) => ({
                label: c.name,
                value: c.average,
                color: scoreColor(c.average),
              }))}
            />
          </Section>

          <Section title="Top sub-categories">
            <HorizontalBars
              data={stats.bySubCategory.map((s, i) => ({
                label: s.name,
                value: s.count,
                color: palette[i % palette.length],
              }))}
            />
          </Section>

          <Section title="Top roles / designations">
            <HorizontalBars
              data={stats.byRole.map((r, i) => ({
                label: r.name,
                value: r.count,
                color: palette[i % palette.length],
              }))}
            />
          </Section>

          {/* Only meaningful once jobs exist; hidden entirely otherwise. */}
          {stats.byJob.length > 0 ? (
            <Section title="Candidates per job">
              <HorizontalBars
                data={stats.byJob.map((j, i) => ({
                  label:
                    j.averageOverallScore !== null
                      ? `${j.title} (avg ${j.averageOverallScore})`
                      : j.title,
                  value: j.count,
                  color: palette[i % palette.length],
                }))}
              />
            </Section>
          ) : null}
        </>
      )}
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
    paddingBottom: 32,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statCard: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    ...shadow,
  },
  statIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
  },
  statLabel: {
    fontSize: 11,
    color: colors.subtext,
    marginTop: 2,
  },
  sectionCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
    ...shadow,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.text,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 12,
  },
  avgCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  avgLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  avgHint: {
    fontSize: 11,
    color: colors.subtext,
    marginTop: 2,
  },
  avgValue: {
    fontSize: 34,
    fontWeight: "800",
  },
});
