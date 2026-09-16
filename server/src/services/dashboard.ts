import { DashboardStatsDto, MATRIX_CATEGORIES, SCORE_BANDS } from "@interview-evaluator/shared";
import { prisma } from "../lib/prisma";

/** "2026-08-26" in the server's local timezone. */
function localDayKey(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

const TOP_N = 8;

/** Aggregate stats for the Dashboard screen. Computed in JS — trivial at recruiter-library scale. */
export async function getDashboardStats(): Promise<DashboardStatsDto> {
  // Every figure below is "live recordings only": a trashed candidate is out
  // of the pipeline, so counting them would keep a filled role looking open.
  const live = { trashedAt: null } as const;
  const byStatus = await prisma.recording.groupBy({
    by: ["status"],
    where: live,
    _count: { _all: true },
  });
  const count = (s: string): number =>
    byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const totals = {
    recordings: byStatus.reduce((sum, b) => sum + b._count._all, 0),
    evaluated: count("EVALUATED"),
    unevaluated: count("UNEVALUATED"),
    inProgress: count("TRANSCRIBING") + count("SCORING"),
    failed: count("FAILED"),
  };

  const evaluations = await prisma.evaluation.findMany({
    where: { recording: live },
    select: {
      overallScore: true,
      department: true,
      subCategory: true,
      roleDesignation: true,
      categoriesJson: true,
    },
  });

  // Only evaluations that produced a score count toward the mean. A call too
  // thin to score is excluded rather than folded in as a zero — averaging in
  // "we don't know" would drag the whole library down.
  const overallScores = evaluations
    .map((e) => e.overallScore)
    .filter((s): s is number => typeof s === "number");
  const averageOverallScore = overallScores.length
    ? Math.round(overallScores.reduce((s, v) => s + v, 0) / overallScores.length)
    : null;

  // Average per matrix category (categoriesJson: [{ name, score, ... }])
  const catTotals = new Map<string, { sum: number; n: number }>();
  for (const e of evaluations) {
    if (!Array.isArray(e.categoriesJson)) continue;
    for (const c of e.categoriesJson as { name?: unknown; score?: unknown }[]) {
      if (typeof c?.name !== "string" || typeof c?.score !== "number") continue;
      const t = catTotals.get(c.name) ?? { sum: 0, n: 0 };
      t.sum += c.score;
      t.n += 1;
      catTotals.set(c.name, t);
    }
  }
  // null, not 0: a category no interview has tested yet has no average, and
  // charting it as zero would read as "everyone scores badly here".
  const categoryAverages = MATRIX_CATEGORIES.map((name) => {
    const t = catTotals.get(name);
    return { name: name as string, average: t && t.n > 0 ? Math.round(t.sum / t.n) : null };
  });

  // Distribution by department
  const deptCounts = new Map<string, number>();
  for (const e of evaluations) {
    deptCounts.set(e.department, (deptCounts.get(e.department) ?? 0) + 1);
  }
  const byDepartment = [...deptCounts.entries()]
    .map(([name, c]) => ({ name, count: c }))
    .sort((a, b) => b.count - a.count);

  // Distribution by sub-category (top N)
  const subCounts = new Map<string, { name: string; department: string; count: number }>();
  for (const e of evaluations) {
    const key = `${e.department}|${e.subCategory}`;
    const entry = subCounts.get(key) ?? { name: e.subCategory, department: e.department, count: 0 };
    entry.count += 1;
    subCounts.set(key, entry);
  }
  const bySubCategory = [...subCounts.values()].sort((a, b) => b.count - a.count).slice(0, TOP_N);

  // Distribution by detected role (top N, case-insensitive grouping)
  const roleCounts = new Map<string, { name: string; count: number }>();
  for (const e of evaluations) {
    const raw = e.roleDesignation.trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const entry = roleCounts.get(key) ?? { name: raw, count: 0 };
    entry.count += 1;
    roleCounts.set(key, entry);
  }
  const byRole = [...roleCounts.values()].sort((a, b) => b.count - a.count).slice(0, TOP_N);

  // Score histogram over the shared bands (0-20, 21-40, …). Built from the
  // filtered list: an unscored evaluation has no band, and `null >= 0` is true
  // in JS, so leaving them in would silently pile them into the bottom band.
  const scoreHistogram = SCORE_BANDS.map((band) => ({
    band: band.label,
    count: overallScores.filter((s) => s >= band.min && s <= band.max).length,
  }));

  // Candidate volume + mean score per job. Counts every linked recording
  // (so a job in progress still shows up) but averages only EVALUATED ones.
  const jobs = await prisma.job.findMany({
    select: {
      id: true,
      title: true,
      recordings: {
        where: live,
        select: { evaluation: { select: { overallScore: true } } },
      },
    },
  });
  const byJob = jobs
    .map((j) => {
      const scores = j.recordings
        .map((r) => r.evaluation?.overallScore)
        .filter((s): s is number => typeof s === "number");
      return {
        id: j.id,
        title: j.title,
        count: j.recordings.length,
        averageOverallScore: scores.length
          ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
          : null,
      };
    })
    .filter((j) => j.count > 0)
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, TOP_N);

  // Throughput over the recent window. Counted in local time so "today" means
  // what the recruiter's phone shows, and zero-filled so a quiet day reads as
  // a gap in the bar chart rather than vanishing from the axis.
  const DAYS = 14;
  const dayCounts = new Map<string, number>();
  const startOfWindow = new Date();
  startOfWindow.setHours(0, 0, 0, 0);
  startOfWindow.setDate(startOfWindow.getDate() - (DAYS - 1));
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(startOfWindow);
    d.setDate(d.getDate() + i);
    dayCounts.set(localDayKey(d), 0);
  }
  // Only the window is fetched, and only the one column needed to bucket it.
  const recent = await prisma.recording.findMany({
    where: { ...live, importedAt: { gte: startOfWindow } },
    select: { importedAt: true },
  });
  for (const r of recent) {
    const key = localDayKey(r.importedAt);
    if (dayCounts.has(key)) dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
  }
  const byDay = [...dayCounts.entries()].map(([date, count]) => ({ date, count }));

  return {
    totals,
    byDay,
    averageOverallScore,
    categoryAverages,
    byDepartment,
    bySubCategory,
    byRole,
    byJob,
    scoreHistogram,
  };
}
