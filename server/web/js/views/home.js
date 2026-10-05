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
import { getRecordings, serverIsOutdated } from "../api.js";
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
            text: "Record the screening call on your phone, upload it here, and RecruitLens scores every answer and decides whether the candidate goes to the next round.",
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

    const kpi = ({ label, iconName, value, sub, href }) =>
      h(
        href ? "a" : "div",
        { class: "card kpi", href },
        h("span", { class: "kpi-label" }, icon(iconName), label),
        h("span", { class: "kpi-value" }, String(value)),
        sub ? h("span", { class: "kpi-sub" }, sub) : null
      );

    const kpis = h(
      "div",
      { class: "kpis" },
      kpi({
        label: "Calls evaluated",
        iconName: "mic",
        value: evaluated.length,
        sub: [h("span", null, h("b", null, String(processing)), " processing"), h("span", null, h("b", null, String(failed)), " failed")],
        href: "#/candidates",
      }),
      kpi({
        label: "Fit for next round",
        iconName: "target",
        value: fit,
        sub: [h("span", null, "Fit rate ", h("b", null, F.pct(fit, evaluated.length)))],
        href: "#/candidates?view=fit",
      }),
      kpi({
        label: "Moved to next round",
        iconName: "arrowUpRight",
        value: shortlisted,
        sub: [h("span", null, h("b", null, String(rejected)), " rejected")],
        href: "#/candidates?view=next",
      }),
      kpi({
        label: "Awaiting your decision",
        iconName: "hourglass",
        value: awaiting,
        sub: median !== null ? [h("span", null, "Reports in ", h("b", null, F.fmtMinutes(median)), " median")] : null,
        href: "#/candidates?view=attention",
      })
    );

    const empty = (text) => h("p", { class: "muted", style: { textAlign: "center", padding: "40px 0" } }, text);
    const gateOf = (r) => r.evaluationSummary?.decision;

    // ── Needs your attention — a short to-do list, period-independent ──
    const attentionCard = h(
      "div",
      { class: "card" },
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
    );

    // ── Waiting on you — how long reports have sat undecided ──────────
    // Period-independent, like the list beside it: a Fit who has waited two
    // weeks matters whatever range is selected, and is the likeliest to have
    // gone elsewhere.
    const DAY = 86400000;
    const waiting = all.filter(F.awaitingDecision);
    const waitedDays = (r) => (now - new Date(r.evaluationSummary?.createdAt ?? r.importedAt)) / DAY;
    const AGES = [
      { label: "Under a day", from: 0, to: 1 },
      { label: "1–3 days", from: 1, to: 3 },
      { label: "3–7 days", from: 3, to: 7 },
      { label: "Over a week", from: 7, to: Infinity },
    ];
    const WAIT_SEGMENTS = [
      { decision: "advance", label: "Fit", tone: "fit" },
      { decision: "borderline", label: "Consider", tone: "consider" },
      { decision: "reject", label: "Do not proceed", tone: "reject" },
      { decision: "insufficient_evidence", label: "Not enough evidence", tone: "muted" },
    ];
    const ageRows = AGES.map((a) => {
      const rows = waiting.filter((r) => waitedDays(r) >= a.from && waitedDays(r) < a.to);
      return {
        ...a,
        total: rows.length,
        segments: WAIT_SEGMENTS.map((sg) => ({ label: sg.label, tone: sg.tone, value: rows.filter((r) => gateOf(r) === sg.decision).length })),
      };
    });
    const maxAge = Math.max(1, ...ageRows.map((a) => a.total));
    const staleFits = waiting.filter((r) => gateOf(r) === "advance" && waitedDays(r) >= 3).length;
    const decideTimes = inRange
      .filter((r) => r.evaluationSummary && (r.shortlistedAt || r.rejectedAt))
      .map((r) => (new Date(r.shortlistedAt ?? r.rejectedAt) - new Date(r.evaluationSummary.createdAt)) / 60000)
      .filter((m) => m >= 0)
      .sort((a, b) => a - b);
    const decideMedian = decideTimes.length ? decideTimes[Math.floor(decideTimes.length / 2)] : null;
    const waitingCard = h(
      "div",
      { class: "card" },
      h("div", { class: "card-head" }, h("div", null, h("h3", { class: "card-title" }, "Waiting on you"), h("div", { class: "card-meta" }, "How long reports have sat without your decision"))),
      h(
        "div",
        { class: "card-pad" },
        h(
          "div",
          { class: "stat-line" },
          h("span", { class: "stat-big num" }, String(staleFits)),
          h("span", { class: "muted" }, staleFits === 1 ? "Fit has waited more than 3 days" : "Fits have waited more than 3 days")
        ),
        h(
          "div",
          { class: "pipe" },
          ageRows.map((a) =>
            h(
              "a",
              { class: "pipe-row is-compact", href: "#/candidates?view=attention" },
              h("span", { class: "pipe-label" }, a.label),
              G.scaledStack(a.segments, maxAge),
              h("span", { class: "pipe-count" }, h("b", null, String(a.total)))
            )
          )
        ),
        G.legend(WAIT_SEGMENTS),
        decideMedian !== null ? h("p", { class: "faint small mt-12" }, `In this period you took a median of ${F.fmtMinutes(decideMedian)} to decide once a report was ready.`) : null
      )
    );

    // ── Pipeline by job ───────────────────────────────────────────────
    // Where everyone screened for a role stands now. A person's decision
    // outranks the gate's, so a Fit you rejected counts as not progressing.
    const STAGES = [
      { key: "next", label: "Next round", tone: "next" },
      { key: "ready", label: "Fit · awaiting you", tone: "fit" },
      { key: "review", label: "Consider · awaiting you", tone: "consider" },
      { key: "out", label: "Not progressing", tone: "reject" },
      { key: "pending", label: "No verdict yet", tone: "muted" },
    ];
    const stageOf = (r) => {
      if (r.shortlistedAt) return "next";
      if (r.rejectedAt) return "out";
      const d = F.decisionOf(r);
      return d === "advance" ? "ready" : d === "borderline" ? "review" : d === "reject" ? "out" : "pending";
    };
    const jobs = new Map();
    for (const r of inRange) {
      const key = r.job?.id ?? "none";
      const row = jobs.get(key) ?? { id: r.job?.id ?? null, title: r.job?.title ?? "No job attached", total: 0, asked: 0, answered: 0, next: 0, ready: 0, review: 0, out: 0, pending: 0 };
      row.total++;
      row[stageOf(r)]++;
      if (F.decisionOf(r)) {
        row.asked += r.evaluationSummary.technicalAsked ?? 0;
        row.answered += r.evaluationSummary.technicalAnswered ?? 0;
      }
      jobs.set(key, row);
    }
    const jobRows = [...jobs.values()].sort((a, b) => b.ready - a.ready || b.review - a.review || b.total - a.total || a.title.localeCompare(b.title));
    const shownJobs = jobRows.slice(0, 6);
    const maxJob = Math.max(1, ...shownJobs.map((j) => j.total));
    const pipelineCard = h(
      "div",
      { class: "card", style: { marginTop: "16px" } },
      h(
        "div",
        { class: "card-head" },
        h("div", null, h("h3", { class: "card-title" }, "Pipeline by job"), h("div", { class: "card-meta" }, "Where everyone screened for each role stands now")),
        C.btn({ label: "All jobs", size: "sm", variant: "ghost", href: "#/jobs", icon: "arrowRight", iconAfter: true })
      ),
      h(
        "div",
        { class: "card-pad" },
        jobRows.length
          ? [
              h(
                "div",
                { class: "pipe" },
                shownJobs.map((j) =>
                  h(
                    "a",
                    { class: "pipe-row", href: j.id ? `#/jobs/${j.id}` : "#/candidates?job=none" },
                    h(
                      "div",
                      { class: "pipe-label" },
                      h("div", { class: "cell-title truncate", title: j.title }, j.title),
                      h("div", { class: "cell-sub" }, `${F.plural(j.total, "candidate")} · ${j.asked ? `${F.pct(j.answered, j.asked)} of technical questions answered` : "no technical questions yet"}`)
                    ),
                    G.scaledStack(STAGES.map((st) => ({ label: st.label, tone: st.tone, value: j[st.key] })), maxJob),
                    h("div", { class: "pipe-count" }, j.ready ? [h("b", null, String(j.ready)), " ready"] : h("span", { class: "faint" }, "none ready"))
                  )
                )
              ),
              G.legend(STAGES),
              jobRows.length > shownJobs.length
                ? h("p", { class: "faint small mt-12" }, `The 6 roles with the most candidates ready are shown; ${F.plural(jobRows.length - shownJobs.length, "more role")} had calls in this period.`)
                : null,
            ]
          : empty("No calls in this period")
      )
    );

    // ── Your decisions vs the AI ──────────────────────────────────────
    // The gate advises and you decide. Setting the two side by side is how
    // you find out whether its Fit means what yours does.
    const OUTCOMES = [
      { key: "next", label: "Moved on" },
      { key: "rejected", label: "Rejected" },
      { key: "waiting", label: "Waiting" },
    ];
    const outcomeOf = (r) => (r.shortlistedAt ? "next" : r.rejectedAt ? "rejected" : "waiting");
    const matrix = Object.fromEntries(F.DECISION_ORDER.map((d) => [d, { next: 0, rejected: 0, waiting: 0 }]));
    for (const r of evaluated) {
      const cell = matrix[gateOf(r)];
      if (cell) cell[outcomeOf(r)]++;
    }
    const agreed = matrix.advance.next + matrix.reject.rejected;
    const overrode = matrix.advance.rejected + matrix.reject.next;
    const isOverride = (d, o) => (d === "advance" && o === "rejected") || (d === "reject" && o === "next");
    const agreeCard = h(
      "div",
      { class: "card" },
      h("div", { class: "card-head" }, h("div", null, h("h3", { class: "card-title" }, "Your decisions vs the AI"), h("div", { class: "card-meta" }, "What you did with each of the gate's calls"))),
      h(
        "div",
        { class: "card-pad" },
        evaluated.length
          ? [
              h(
                "div",
                { class: "stat-line" },
                h("span", { class: "stat-big num" }, agreed + overrode ? F.pct(agreed, agreed + overrode) : "—"),
                h("span", { class: "muted" }, agreed + overrode ? `agreement across ${F.plural(agreed + overrode, "clear-cut decision")}` : "No Fit or Do not proceed candidate decided yet")
              ),
              h(
                "table",
                { class: "agree" },
                h("caption", { class: "sr-only" }, "The AI's decision against yours"),
                h("thead", null, h("tr", null, h("th", { scope: "col" }, "AI said"), OUTCOMES.map((o) => h("th", { scope: "col", class: "num" }, o.label)))),
                h(
                  "tbody",
                  null,
                  F.DECISION_ORDER.map((d) =>
                    h(
                      "tr",
                      null,
                      h("th", { scope: "row" }, h("span", { class: ["vlabel", `tone-${F.DECISION[d].tone}`] }, h("span", { class: "dot" }), F.DECISION[d].short)),
                      OUTCOMES.map((o) => {
                        const n = matrix[d][o.key];
                        return h("td", { class: ["num", !n && "is-zero", n && isOverride(d, o.key) && "is-override"] }, h("span", null, String(n)));
                      })
                    )
                  )
                )
              ),
              h(
                "p",
                { class: "faint small mt-12" },
                overrode
                  ? `Highlighted: the ${F.plural(overrode, "time")} you overrode a clear call. Clear-cut means the AI said Fit or Do not proceed.`
                  : "Clear-cut means the AI said Fit or Do not proceed; Consider is yours to call."
              ),
            ]
          : empty("Nothing evaluated in this period")
      )
    );

    // ── Technical questions per call ──────────────────────────────────
    // The gate decides on the share of technical answers that landed, so
    // with one or two questions a single answer is the whole decision.
    const withQs = evaluated.filter((r) => typeof r.evaluationSummary.technicalAsked === "number");
    const asked = withQs.reduce((sum, r) => sum + r.evaluationSummary.technicalAsked, 0);
    const answered = withQs.reduce((sum, r) => sum + (r.evaluationSummary.technicalAnswered ?? 0), 0);
    const qBuckets = [0, 1, 2, 3, 4, 5].map((n) => {
      const calls = withQs.filter((r) => (n === 5 ? r.evaluationSummary.technicalAsked >= 5 : r.evaluationSummary.technicalAsked === n)).length;
      return { label: n === 5 ? "5+" : String(n), value: calls, muted: n < 3, title: `${n === 5 ? "5 or more" : n} technical ${n === 1 ? "question" : "questions"}: ${F.plural(calls, "call")}` };
    });
    const thin = qBuckets.slice(0, 3).reduce((sum, b) => sum + b.value, 0);
    const questionsCard = h(
      "div",
      { class: "card" },
      h("div", { class: "card-head" }, h("div", null, h("h3", { class: "card-title" }, "Technical questions per call"), h("div", { class: "card-meta" }, "How much evidence each decision rests on"))),
      h(
        "div",
        { class: "card-pad" },
        withQs.length
          ? [
              h(
                "div",
                { class: "stat-line" },
                h("span", { class: "stat-big num" }, asked ? F.pct(answered, asked) : "—"),
                h("span", { class: "muted" }, asked ? `of ${F.plural(asked, "technical question")} answered adequately or better` : "No technical questions asked yet")
              ),
              G.countColumns(qBuckets),
              h("div", { class: "faint xsmall", style: { textAlign: "center", marginTop: "6px" } }, "Technical questions asked in the call"),
              h(
                "p",
                { class: "faint small mt-12" },
                thin ? `${thin} of ${F.plural(withQs.length, "call")} asked fewer than 3 — with that few, one answer decides the outcome.` : "Every call asked at least 3 technical questions."
              ),
            ]
          : empty("Nothing evaluated in this period")
      )
    );

    // ── Recent calls ──────────────────────────────────────────────────
    const recent = inRange.slice(0, 3);
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
          C.td(h("a", { href: `#/candidates/${r.id}`, style: { color: "inherit" } }, h("div", { class: "cand-name clamp-2", title: F.displayName(r) }, F.displayName(r))), "c-name"),
          C.td(r.job ? h("div", { class: "clamp-2", title: r.job.title }, r.job.title) : h("span", { class: "faint" }, "No job"), "c-job"),
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

    mount(
      body,
      serverIsOutdated(all) ? C.outdatedBanner() : null,
      kpis,
      attentionAll.length ? h("div", { class: "dash-grid" }, attentionCard, waitingCard) : null,
      pipelineCard,
      h("div", { class: "dash-grid is-even" }, agreeCard, questionsCard),
      recentCard
    );
  }
}
