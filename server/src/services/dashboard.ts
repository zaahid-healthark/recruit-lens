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
  const byStatus = await prisma.recording.groupBy({ by: ["status"], _count: { _all: true } });
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
    select: {
      overallScore: true,
      department: true,
      subCategory: true,
      roleDesignation: true,
      categoriesJson: true,
    },
  });

  const averageOverallScore = evaluations.length
    ? Math.round(evaluations.reduce((s, e) => s + e.overallScore, 0) / evaluations.length)
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
  const categoryAverages = MATRIX_CATEGORIES.map((name) => {
    const t = catTotals.get(name);
    return { name: name as string, average: t && t.n > 0 ? Math.round(t.sum / t.n) : 0 };
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

  // Score histogram over the shared bands (0-20, 21-40, …)
  const scoreHistogram = SCORE_BANDS.map((band) => ({
    band: band.label,
    count: evaluations.filter((e) => e.overallScore >= band.min && e.overallScore <= band.max)
      .length,
  }));

  // Candidate volume + mean score per job. Counts every linked recording
  // (so a job in progress still shows up) but averages only EVALUATED ones.
  const jobs = await prisma.job.findMany({
    select: {
      id: true,
      title: true,
      recordings: { select: { evaluation: { select: { overallScore: true } } } },
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
    where: { importedAt: { gte: startOfWindow } },
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
