/**
 * Home: what happened in a period, and what needs a decision now.
 *
 * Every number is computed from the same candidate list the Candidates screen
 * shows, through the same decision the reports carry, so the dashboard can
 * never disagree with the list it summarises. The period changes everything
 * except "awaiting your decision", which is a to-do list, not a statistic.
 */

import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { getRecordings } from "../api.js";
import { navigate, replaceQuery } from "../router.js";
import { setActive } from "../shell.js";
import * as C from "../components.js";
import * as G from "../charts.js";
import * as F from "../format.js";

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export async function homeView({ query, signal, main }) {
  setActive("home");
  let range = RANGES.some((r) => r.value === query.get("range")) ? query.get("range") : "30";
  const header = C.topbar({ title: "Home" });

  mount(
    main,
    header,
    h(
      "div",
      { class: "page" },
      h("div", { class: "stack gap-16" }, C.skelLine("25%", 24), h("div", { class: "kpis" }, [0, 1, 2, 3].map(() => h("div", { class: "card kpi" }, C.skelLine("50%"), C.skelLine("30%", 28), C.skelLine("70%")))), C.skelBlock(220))
    )
  );

  let all;
  try {
    all = (await getRecordings({ signal })).filter((r) => !r.trashedAt);
  } catch (err) {
    if (err?.name === "AbortError") return;
    mount(main, header, h("div", { class: "page" }, C.errorState(err, () => navigate("/", { replace: true }))));
    return;
  }
  if (signal.aborted) return;

  if (all.length === 0) {
    mount(
      main,
      header,
      h(
        "div",
        { class: "page page-mid" },
        h(
          "div",
          { class: "card" },
          C.emptyState({
            icon: "mic",
            title: "Evaluate your first call",
            text: "Record the screening call on your phone, upload it here, and RecruitLens scores every answer and decides whether the candidate goes to a video screen.",
            action: C.btn({ label: "Evaluate a call", icon: "plus", variant: "primary", href: "#/evaluate" }),
          })
        )
      )
    );
    return;
  }

  const body = h("div");
  const rangeSelect = C.select({
    label: "Period",
    cls: "range-select",
    value: range,
    options: RANGES,
    onChange: (v) => {
      range = v;
      replaceQuery({ range: v === "30" ? "" : v });
      draw();
    },
  });
  const periodText = h("p", { class: "num" });

  mount(
    main,
    header,
    h(
      "div",
      { class: "page" },
      h("div", { class: "intro" }, h("div", null, h("h2", { class: "h1" }, "Overview"), periodText), rangeSelect),
      body
    )
  );
  draw();

  function draw() {
    const now = new Date();
    const since = range === "all" ? null : new Date(now.getTime() - Number(range) * 86400000);
    const inRange = since ? all.filter((r) => new Date(r.importedAt) >= since) : all;
    periodText.textContent =
      range === "all"
        ? `All ${F.plural(all.length, "call")} since ${F.fmtDate(all[all.length - 1].importedAt)}`
        : `${F.fmtDate(since.toISOString())} – ${F.fmtDate(now.toISOString())}`;

    const evaluated = inRange.filter((r) => r.status === "EVALUATED" && r.evaluationSummary);
    const processing = inRange.filter(F.isProcessing).length;
    const failed = inRange.filter((r) => r.status === "FAILED").length;
    const fit = evaluated.filter((r) => r.evaluationSummary.decision === "advance").length;
    const shortlisted = inRange.filter((r) => r.shortlistedAt).length;
    const rejected = inRange.filter((r) => r.rejectedAt).length;
    const awaiting = all.filter(F.awaitingDecision).length;
    const attentionAll = all.filter(F.needsAttention);

    const turnarounds = evaluated
      .map((r) => (new Date(r.evaluationSummary.createdAt) - new Date(r.importedAt)) / 60000)
      .filter((m) => m >= 0 && m < 7 * 24 * 60)
      .sort((a, b) => a - b);
    const median = turnarounds.length ? turnarounds[Math.floor(turnarounds.length / 2)] : null;

    const kpi = ({ label, iconName, value, caption, sub, href }) =>
      h(
        href ? "a" : "div",
        { class: "card kpi", href },
        h("span", { class: "kpi-label" }, icon(iconName), label),
        h("span", { class: "kpi-value" }, String(value)),
        sub ? h("span", { class: "kpi-sub" }, sub) : null,
        h("span", { class: "kpi-foot" }, caption)
      );

    const kpis = h(
      "div",
      { class: "kpis" },
      kpi({
        label: "Calls evaluated",
        iconName: "mic",
        value: evaluated.length,
        sub: [h("span", null, h("b", null, String(processing)), " processing"), h("span", null, h("b", null, String(failed)), " failed")],
        caption: "Uploaded and scored in this period",
        href: "#/candidates",
      }),
      kpi({
        label: "Fit for video screen",
        iconName: "target",
        value: fit,
        sub: [h("span", null, "Fit rate ", h("b", null, F.pct(fit, evaluated.length)))],
        caption: "Cleared the gate on their technical answers",
        href: "#/candidates?view=fit",
      }),
      kpi({
        label: "Moved to next round",
        iconName: "video",
        value: shortlisted,
        sub: [h("span", null, h("b", null, String(rejected)), " rejected")],
        caption: "Your decisions on calls in this period",
        href: "#/candidates?view=next",
      }),
      kpi({
        label: "Awaiting your decision",
        iconName: "hourglass",
        value: awaiting,
        sub: median !== null ? [h("span", null, "Reports in ", h("b", null, F.fmtMinutes(median)), " median")] : null,
        caption: "Evaluated, not yet advanced or rejected",
        href: "#/candidates?view=attention",
      })
    );

    // Calls over time
    const span = since ? Number(range) : Math.max(1, Math.ceil((now - new Date(all[all.length - 1].importedAt)) / 86400000));
    let grain = span <= 31 ? "day" : span <= 120 ? "week" : "month";
    const chartSlot = h("div");
    const drawChart = () => mount(chartSlot, G.columnChart(bucket(inRange, grain, since ?? new Date(all[all.length - 1].importedAt), now), { label: "Calls over time" }));
    const grainSeg = C.seg({
      label: "Group by",
      value: grain,
      options: [
        { value: "day", label: "Day" },
        { value: "week", label: "Week" },
        { value: "month", label: "Month" },
      ],
      onChange: (v) => {
        grain = v;
        drawChart();
      },
    });
    drawChart();
    const callsCard = h(
      "div",
      { class: "card" },
      h("div", { class: "card-head" }, h("div", null, h("h3", { class: "card-title" }, "Calls over time"), h("div", { class: "card-meta" }, F.plural(inRange.length, "call") + " uploaded")), grainSeg),
      h("div", { class: "card-pad" }, inRange.length ? chartSlot : h("p", { class: "muted", style: { textAlign: "center", padding: "48px 0" } }, "No calls in this period"))
    );

    // Decision mix
    const mix = Object.fromEntries(F.DECISION_ORDER.map((d) => [d, 0]));
    evaluated.forEach((r) => (mix[r.evaluationSummary.decision] = (mix[r.evaluationSummary.decision] ?? 0) + 1));
    const mixItems = F.DECISION_ORDER.map((d) => ({ tone: F.DECISION[d].tone, label: F.DECISION[d].short, value: mix[d] }));
    const mixCard = h(
      "div",
      { class: "card" },
      h("div", { class: "card-head" }, h("div", null, h("h3", { class: "card-title" }, "Decision mix"), h("div", { class: "card-meta" }, F.plural(evaluated.length, "evaluated call")))),
      h(
        "div",
        { class: "card-pad" },
        evaluated.length
          ? [
              G.stackBar(mixItems, { lg: true }),
              G.legend(mixItems),
              h(
                "div",
                { class: "stack gap-12 mt-24" },
                mixItems.map((it) =>
                  h(
                    "a",
                    {
                      class: "row row-between",
                      href: it.label === "Fit" ? "#/candidates?view=fit" : it.label === "Consider" ? "#/candidates?view=consider" : "#/candidates",
                      style: { color: "inherit" },
                    },
                    h("span", { class: "row" }, h("span", { class: ["dot", it.tone === "neutral" ? "is-neutral" : `bg-${it.tone}`] }), it.label),
                    h("span", { class: "num muted" }, `${it.value} · ${F.pct(it.value, evaluated.length)}`)
                  )
                )
              ),
            ]
          : h("p", { class: "muted", style: { textAlign: "center", padding: "40px 0" } }, "Nothing evaluated in this period")
      )
    );

    // By job
    const jobs = new Map();
    for (const r of inRange) {
      const key = r.job?.id ?? "none";
      const row = jobs.get(key) ?? { id: r.job?.id ?? null, title: r.job?.title ?? "No job attached", calls: 0, advance: 0, borderline: 0, reject: 0, next: 0, scores: [] };
      row.calls++;
      const d = F.decisionOf(r);
      if (d && d in row) row[d]++;
      if (r.shortlistedAt) row.next++;
      if (typeof F.scoreOf(r) === "number") row.scores.push(F.scoreOf(r));
      jobs.set(key, row);
    }
    const jobRows = [...jobs.values()].sort((a, b) => b.calls - a.calls || a.title.localeCompare(b.title));
    let jobPage = 1;
    const jobPer = 10;
    const jobSlot = h("div");
    const drawJobs = () => {
      const slice = jobRows.slice((jobPage - 1) * jobPer, jobPage * jobPer);
      const t = C.dataTable({
        cls: "t-jobs",
        reflow: false,
        caption: "By job",
        columns: [
          { label: "Job", cls: "c-name" },
          { label: "Calls", cls: "tight num" },
          { label: "Fit", cls: "tight num" },
          { label: "Consider", cls: "tight num" },
          { label: "Do not proceed", cls: "tight num" },
          { label: "Next round", cls: "tight num" },
          { label: "Average", cls: "tight num" },
        ],
        rows: slice,
        onRowClick: (j) => navigate(j.id ? `/jobs/${j.id}` : "/candidates?job=none"),
        renderRow: (j) => [
          C.td(h("span", { class: "cell-title" }, j.title), "c-name"),
          C.td(String(j.calls), "tight num"),
          C.td(C.countPill(j.advance, "fit"), "tight num"),
          C.td(C.countPill(j.borderline, "consider"), "tight num"),
          C.td(C.countPill(j.reject, "reject"), "tight num"),
          C.td(C.countPill(j.next, "next"), "tight num"),
          C.td(h("span", { class: "strong num" }, j.scores.length ? F.score10(Math.round(j.scores.reduce((s, v) => s + v, 0) / j.scores.length)) : "—"), "tight num"),
        ],
      });
      mount(
        jobSlot,
        t.el.firstChild,
        jobRows.length > jobPer
          ? C.pager({ total: jobRows.length, page: jobPage, per: jobPer, perOptions: [10], onChange: ({ page }) => ((jobPage = page), drawJobs()) })
          : null
      );
    };
    drawJobs();
    const jobsCard = h(
      "div",
      { class: "card section", style: { marginTop: "16px" } },
      h(
        "div",
        { class: "card-head" },
        h("div", null, h("h3", { class: "card-title" }, "By job"), h("div", { class: "card-meta" }, `${F.plural(jobRows.filter((j) => j.id).length, "job")} with calls in this period`)),
        C.btn({ label: "All jobs", size: "sm", variant: "ghost", href: "#/jobs", icon: "arrowRight", iconAfter: true })
      ),
      jobRows.length ? h("div", { class: "jobs-table" }, jobSlot) : h("p", { class: "muted card-pad" }, "No calls in this period")
    );

    // Recent calls
    const recent = inRange.slice(0, 8);
    const recentTable = C.dataTable({
      cls: "t-candidates",
      caption: "Recent calls",
      columns: [
        { label: "Candidate", cls: "c-name" },
        { label: "Job", cls: "c-job" },
        { label: "Date", cls: "tight c-date" },
        { label: "Length", cls: "tight num c-len" },
        { label: "Score", cls: "tight num c-score" },
        { label: "Decision", cls: "tight c-decision" },
        { label: "Status", cls: "tight c-status" },
        { label: "", cls: "c-sub" },
      ],
      rows: recent,
      onRowClick: (r) => navigate(`/candidates/${r.id}`),
      renderRow: (r) => {
        const d = F.decisionOf(r);
        return [
          C.td(h("a", { href: `#/candidates/${r.id}`, class: "cand-name", style: { color: "inherit" } }, F.displayName(r)), "c-name"),
          C.td(r.job ? r.job.title : h("span", { class: "faint" }, "No job"), "c-job"),
          C.td(F.fmtRelative(r.importedAt), "tight c-date"),
          C.td(F.fmtDuration(r.durationSeconds), "tight num c-len"),
          C.td(h("span", { class: "score-cell num" }, F.score10(F.scoreOf(r))), "tight num c-score"),
          C.td(d ? C.decisionChip(d, { short: true }) : C.statusPill(r), "tight c-decision"),
          C.td(d ? C.statusPill(r) : h("span", { class: "faint" }, "—"), "tight c-status"),
          C.td(h("div", { class: "cell-sub truncate" }, [r.job?.title ?? "No job", F.fmtRelative(r.importedAt)].join(" · ")), "c-sub"),
        ];
      },
    });
    const recentCard = h(
      "div",
      { class: "card", style: { marginTop: "16px" } },
      h(
        "div",
        { class: "card-head" },
        h("div", null, h("h3", { class: "card-title" }, "Recent calls"), h("div", { class: "card-meta" }, recent.length ? `Latest ${recent.length} in this period` : "")),
        C.btn({ label: "View all", size: "sm", variant: "ghost", href: "#/candidates", icon: "arrowRight", iconAfter: true })
      ),
      recent.length ? recentTable.el.firstChild : h("p", { class: "muted card-pad" }, "No calls in this period")
    );

    // Needs attention — a short to-do list, period-independent
    const attentionCard = attentionAll.length
      ? h(
          "div",
          { class: "card", style: { marginTop: "16px" } },
          h(
            "div",
            { class: "card-head" },
            h("div", null, h("h3", { class: "card-title" }, "Needs your attention"), h("div", { class: "card-meta" }, "Failed evaluations and candidates awaiting a decision")),
            C.btn({ label: "Open list", size: "sm", variant: "ghost", href: "#/candidates?view=attention", icon: "arrowRight", iconAfter: true })
          ),
          attentionAll.slice(0, 5).map((r) =>
            h(
              "a",
              { class: "att-item", href: `#/candidates/${r.id}` },
              h("div", { style: { minWidth: "0" } }, h("div", { class: "cand-name truncate" }, F.displayName(r)), h("div", { class: "cell-sub truncate" }, [r.job?.title ?? "No job", F.fmtRelative(r.importedAt)].join(" · "))),
              h("div", { class: "row" }, F.decisionOf(r) ? [h("span", { class: "strong num not-phone" }, F.score10(F.scoreOf(r))), C.decisionChip(F.decisionOf(r), { short: true })] : C.statusPill(r))
            )
          )
        )
      : null;

    // Funnel — strictly nested, so a pass-through can never exceed 100%
    const decided = evaluated.filter((r) => r.shortlistedAt || r.rejectedAt);
    const advanced = evaluated.filter((r) => r.shortlistedAt);
    const funnelCard = h(
      "div",
      { class: "card" },
      h("div", { class: "card-head" }, h("div", null, h("h3", { class: "card-title" }, "Hiring funnel"), h("div", { class: "card-meta" }, "From upload to the video screen"))),
      h(
        "div",
        { class: "card-pad" },
        inRange.length
          ? G.funnel([
              { label: "Calls uploaded", value: inRange.length },
              { label: "Evaluated", value: evaluated.length },
              { label: "Decision made", value: decided.length },
              { label: "Moved to next round", value: advanced.length },
            ])
          : h("p", { class: "muted", style: { textAlign: "center", padding: "40px 0" } }, "No calls in this period")
      )
    );

    // Score distribution — where scores land against the 6.0 and 7.5 lines
    const BANDS = [
      { label: "0–2.9", name: "Do not proceed", tone: "reject", min: 0, max: 29 },
      { label: "3–5.9", name: "Do not proceed", tone: "reject", min: 30, max: 59 },
      { label: "6–7.4", name: "Consider", tone: "consider", min: 60, max: 74 },
      { label: "7.5–8.4", name: "Fit", tone: "fit", min: 75, max: 84 },
      { label: "8.5–10", name: "Strong fit", tone: "strong", min: 85, max: 100 },
    ];
    const scored = evaluated.map((r) => r.evaluationSummary.overallScore).filter((s) => typeof s === "number");
    const unscored = evaluated.length - scored.length;
    const distCard = h(
      "div",
      { class: "card" },
      h("div", { class: "card-head" }, h("div", null, h("h3", { class: "card-title" }, "Score distribution"), h("div", { class: "card-meta" }, "Overall scores, out of 10"))),
      h(
        "div",
        { class: "card-pad" },
        scored.length
          ? [
              G.bandColumns(BANDS.map((b) => ({ ...b, value: scored.filter((s) => s >= b.min && s <= b.max).length }))),
              unscored ? h("p", { class: "faint small mt-12" }, `${F.plural(unscored, "call")} had too little evidence to score.`) : null,
            ]
          : h("p", { class: "muted", style: { textAlign: "center", padding: "40px 0" } }, "Nothing scored in this period")
      )
    );

    mount(
      body,
      kpis,
      attentionCard,
      h("div", { class: "dash-grid" }, callsCard, mixCard),
      h("div", { class: "dash-grid" }, funnelCard, distCard),
      jobsCard,
      recentCard
    );
  }
}

/** Group calls into day / week / month buckets across [from, to]. */
function bucket(rows, grain, from, to) {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const keyOf = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    if (grain === "week") x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    if (grain === "month") x.setDate(1);
    return x.getTime();
  };
  const labelOf = (t) => {
    const d = new Date(t);
    if (grain === "month") return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  };
  const buckets = new Map();
  const cursor = new Date(keyOf(start));
  const end = keyOf(to);
  let guard = 0;
  while (cursor.getTime() <= end && guard++ < 400) {
    buckets.set(cursor.getTime(), 0);
    if (grain === "day") cursor.setDate(cursor.getDate() + 1);
    else if (grain === "week") cursor.setDate(cursor.getDate() + 7);
    else cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const r of rows) {
    const k = keyOf(r.importedAt);
    if (buckets.has(k)) buckets.set(k, buckets.get(k) + 1);
  }
  return [...buckets.entries()].map(([t, value]) => ({
    label: labelOf(t),
    value,
    title: `${grain === "week" ? "Week of " : ""}${labelOf(t)}: ${F.plural(value, "call")}`,
  }));
}
