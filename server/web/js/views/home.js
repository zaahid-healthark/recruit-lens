/**
 * Home: what the screening produced, then the to-do list for whoever acts on
 * it.
 *
 * Every number comes from the same candidate list the Candidates screen
 * shows, through the same decision the reports carry, so the dashboard can
 * never disagree with the list it summarises. The period and the department,
 * role and job filters narrow every card. "Needs your attention" ignores the
 * period: a candidate who has waited a fortnight matters whatever range is
 * selected.
 */

import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { Costs, getRecordings, serverIsOutdated } from "../api.js";
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

const GROUPS = [
  { value: "job", label: "Job" },
  { value: "dept", label: "Department" },
  { value: "role", label: "Role" },
];

const SORTS = [
  { value: "count", label: "Most candidates" },
  { value: "fit", label: "Highest fit rate" },
  { value: "moved", label: "Most moved on" },
];

/** Stands for "no value" in a filter: no job attached, or not classified yet. */
const NONE = "none";
const FILTER_KEYS = ["dept", "role", "job"];

// Department and role come from the evaluation's classification, so a call
// still being evaluated has neither yet. Role is the taxonomy's sub-category
// (Data Engineering, HEOR…): a fixed list, so it groups cleanly where the
// model's free-text job title would not.
const KEY_OF = {
  dept: (r) => r.evaluationSummary?.department?.trim() || null,
  role: (r) => r.evaluationSummary?.subCategory?.trim() || null,
  job: (r) => r.job?.id ?? null,
};

export async function homeView({ query, signal, main }) {
  setActive("home");
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

  const state = {
    range: RANGES.some((r) => r.value === query.get("range")) ? query.get("range") : "30",
    dept: query.get("dept") ?? "",
    role: query.get("role") ?? "",
    job: query.get("job") ?? "",
    group: GROUPS.some((g) => g.value === query.get("group")) ? query.get("group") : "job",
    sort: SORTS.some((s) => s.value === query.get("sort")) ? query.get("sort") : "count",
  };

  const jobTitles = new Map(all.filter((r) => r.job).map((r) => [r.job.id, r.job.title]));
  const labelFor = (key, value) =>
    value === NONE ? (key === "job" ? "No job attached" : "Not classified yet") : key === "job" ? jobTitles.get(value) ?? "Unknown job" : value;
  const matches = (r, key) => !state[key] || (KEY_OF[key](r) ?? NONE) === state[key];
  const inScope = (r) => FILTER_KEYS.every((k) => matches(r, k));
  const filtered = () => FILTER_KEYS.some((k) => state[k]);

  function setState(updates) {
    Object.assign(state, updates);
    // A role that does not exist in the newly chosen department would leave
    // every card empty for a reason nobody can see.
    if ("dept" in updates && state.role && !all.some((r) => matches(r, "dept") && matches(r, "role"))) state.role = "";
    replaceQuery({
      range: state.range === "30" ? "" : state.range,
      dept: state.dept,
      role: state.role,
      job: state.job,
      group: state.group === "job" ? "" : state.group,
      sort: state.sort === "count" ? "" : state.sort,
    });
    draw();
  }

  const periodText = h("p", { class: "num" });
  const filtersEl = h("div", { class: "dash-filters", role: "group", "aria-label": "Filter the dashboard" });
  const body = h("div");

  mount(main, header, h("div", { class: "page" }, h("div", { class: "intro" }, h("div", null, h("h2", { class: "h1" }, "Overview"), periodText)), filtersEl, body));
  draw();

  function drawFilters() {
    // Each list offers what exists under the other filters, so choosing a
    // department narrows the roles to that department's.
    const options = (key) => {
      const counts = new Map();
      for (const r of all) {
        if (!FILTER_KEYS.every((k) => k === key || matches(r, k))) continue;
        const v = KEY_OF[key](r) ?? NONE;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      if (state[key] && !counts.has(state[key])) counts.set(state[key], 0);
      return [...counts.entries()]
        .sort((a, b) => (a[0] === NONE) - (b[0] === NONE) || b[1] - a[1] || labelFor(key, a[0]).localeCompare(labelFor(key, b[0])))
        .map(([value]) => ({ value, label: labelFor(key, value) }));
    };
    mount(
      filtersEl,
      C.select({ label: "Period", cls: "dash-filter", value: state.range, options: RANGES, onChange: (v) => setState({ range: v }) }),
      C.select({ label: "Department", cls: "dash-filter", value: state.dept, options: [{ value: "", label: "All departments" }, ...options("dept")], onChange: (v) => setState({ dept: v }) }),
      C.select({ label: "Role", cls: "dash-filter", value: state.role, options: [{ value: "", label: "All roles" }, ...options("role")], onChange: (v) => setState({ role: v }) }),
      C.select({ label: "Job", cls: "dash-filter", value: state.job, options: [{ value: "", label: "All jobs" }, ...options("job")], onChange: (v) => setState({ job: v }) }),
      filtered() ? C.btn({ label: "Clear filters", size: "sm", variant: "ghost", icon: "x", onClick: () => setState({ dept: "", role: "", job: "" }) }) : null
    );
  }

  function draw() {
    drawFilters();
    const scoped = all.filter(inScope);
    const now = new Date();
    const since = state.range === "all" ? null : new Date(now.getTime() - Number(state.range) * 86400000);
    const inRange = since ? scoped.filter((r) => new Date(r.importedAt) >= since) : scoped;
    periodText.textContent =
      state.range === "all"
        ? `All ${F.plural(all.length, "call")} since ${F.fmtDate(all[all.length - 1].importedAt)}`
        : `${F.fmtDate(since.toISOString())} – ${F.fmtDate(now.toISOString())}`;

    if (!scoped.length) {
      mount(
        body,
        h(
          "div",
          { class: "card" },
          C.emptyState({
            icon: "filter",
            title: "No candidates match these filters",
            text: "Nobody screened so far fits this combination of department, role and job.",
            action: C.btn({ label: "Clear filters", onClick: () => setState({ dept: "", role: "", job: "" }) }),
          })
        )
      );
      return;
    }

    const evaluated = inRange.filter((r) => r.status === "EVALUATED" && r.evaluationSummary);
    const processing = inRange.filter(F.isProcessing).length;
    const failed = inRange.filter((r) => r.status === "FAILED").length;
    const fit = evaluated.filter((r) => r.evaluationSummary.decision === "advance").length;
    const shortlisted = inRange.filter((r) => r.shortlistedAt).length;
    const rejected = inRange.filter((r) => r.rejectedAt).length;
    const awaiting = scoped.filter(F.awaitingDecision).length;
    const attentionAll = scoped.filter(F.needsAttention);
    const empty = (text) => h("p", { class: "muted", style: { textAlign: "center", padding: "40px 0" } }, text);
    const gateOf = (r) => r.evaluationSummary?.decision;
    const cardHead = (title, meta, action) =>
      h("div", { class: "card-head" }, h("div", null, h("h3", { class: "card-title" }, title), h("div", { class: "card-meta" }, meta)), action ?? null);

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
        label: "Candidates screened",
        iconName: "users",
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

    // ── Pipeline — by job, department or role ─────────────────────────
    // Where everyone screened stands now. A person's decision outranks the
    // gate's, so a Fit you rejected counts as not progressing. Clicking a row
    // narrows the whole dashboard to it.
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
    const groups = new Map();
    for (const r of inRange) {
      const key = KEY_OF[state.group](r) ?? NONE;
      const g = groups.get(key) ?? { key, name: labelFor(state.group, key), dept: null, total: 0, screened: 0, fit: 0, next: 0, ready: 0, review: 0, out: 0, pending: 0 };
      g.total++;
      g[stageOf(r)]++;
      if (F.decisionOf(r)) {
        g.screened++;
        if (gateOf(r) === "advance") g.fit++;
      }
      g.dept ??= KEY_OF.dept(r);
      groups.set(key, g);
    }
    const fitRate = (g) => (g.screened ? g.fit / g.screened : -1);
    const SORTERS = {
      count: (a, b) => b.total - a.total || b.next - a.next || a.name.localeCompare(b.name),
      fit: (a, b) => fitRate(b) - fitRate(a) || b.total - a.total || a.name.localeCompare(b.name),
      moved: (a, b) => b.next - a.next || b.total - a.total || a.name.localeCompare(b.name),
    };
    // "Not classified yet" and "No job attached" are leftovers, not peers, so
    // they sit at the bottom whatever the order.
    const groupRows = [...groups.values()].sort((a, b) => (a.key === NONE) - (b.key === NONE) || SORTERS[state.sort](a, b));
    const shownGroups = groupRows.slice(0, 8);
    const maxGroup = Math.max(1, ...shownGroups.map((g) => g.total));
    // The figure on the right is whatever the list is sorted by; the other two
    // ride in the line under the name.
    const metric = {
      count: (g) => [h("b", null, String(g.total)), g.total === 1 ? " candidate" : " candidates"],
      fit: (g) => [h("b", null, g.screened ? F.pct(g.fit, g.screened) : "—"), " fit"],
      moved: (g) => [h("b", null, String(g.next)), " moved on"],
    };
    const subLine = (g) =>
      [
        state.group === "role" && g.dept ? g.dept : null,
        state.sort !== "count" ? F.plural(g.total, "candidate") : null,
        state.sort !== "fit" ? `${g.screened ? F.pct(g.fit, g.screened) : "—"} fit` : null,
        state.sort !== "moved" ? `${g.next} moved on` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    const groupNoun = { job: "job", dept: "department", role: "role" }[state.group];
    const pipelineCard = h(
      "div",
      { class: "card", style: { marginTop: "16px" } },
      cardHead(
        "Pipeline",
        `Where everyone screened stands now, by ${groupNoun}. Click a row to filter the dashboard.`,
        h(
          "div",
          { class: "card-tools" },
          C.seg({ label: "Group by", value: state.group, options: GROUPS, onChange: (v) => setState({ group: v }) }),
          C.select({ label: "Sort by", cls: "dash-filter", value: state.sort, options: SORTS, onChange: (v) => setState({ sort: v }) })
        )
      ),
      h(
        "div",
        { class: "card-pad" },
        groupRows.length
          ? [
              h(
                "div",
                { class: "pipe" },
                shownGroups.map((g) => {
                  const active = state[state.group] === g.key;
                  return h(
                    "button",
                    {
                      class: ["pipe-row", active && "is-active"],
                      type: "button",
                      "aria-pressed": String(active),
                      title: active ? "Show everyone again" : `Show only ${g.name}`,
                      onClick: () => setState({ [state.group]: active ? "" : g.key }),
                    },
                    h("div", { class: "pipe-label" }, h("div", { class: "cell-title truncate" }, g.name), h("div", { class: "cell-sub" }, subLine(g))),
                    G.scaledStack(STAGES.map((st) => ({ label: st.label, tone: st.tone, value: g[st.key] })), maxGroup),
                    h("div", { class: "pipe-count" }, metric[state.sort](g))
                  );
                })
              ),
              G.legend(STAGES),
              groupRows.length > shownGroups.length
                ? h("p", { class: "faint small mt-12" }, `Showing the top 8 of ${groupRows.length} ${groupNoun === "department" ? "departments" : groupNoun + "s"}. Narrow with the filters above to see the rest.`)
                : null,
            ]
          : empty("No calls in this period")
      )
    );

    // ── Screening outcomes ────────────────────────────────────────────
    // The split an executive asks for first: how many were a fit, how many
    // were not, and what was done about them.
    const DECISION_PARTS = [
      { decision: "advance", label: "Fit", tone: "fit", view: "fit" },
      { decision: "borderline", label: "Consider", tone: "consider", view: "consider" },
      { decision: "reject", label: "Do not proceed", tone: "reject", view: null },
      { decision: "insufficient_evidence", label: "Not enough evidence", tone: "neutral", view: null },
    ].map((d) => ({ ...d, value: evaluated.filter((r) => gateOf(r) === d.decision).length }));
    const HUMAN_PARTS = [
      { label: "Moved to next round", tone: "next", value: evaluated.filter((r) => r.shortlistedAt).length },
      { label: "Rejected", tone: "reject", value: evaluated.filter((r) => r.rejectedAt).length },
      { label: "Awaiting your decision", tone: "muted", value: evaluated.filter((r) => !r.shortlistedAt && !r.rejectedAt).length },
    ];
    const outcomesCard = h(
      "div",
      { class: "card" },
      cardHead("Screening outcomes", "What the AI decided, and what you did about it"),
      h(
        "div",
        { class: "card-pad" },
        evaluated.length
          ? [
              h(
                "div",
                { class: "outcome" },
                G.donut(DECISION_PARTS, { num: String(evaluated.length), sub: "screened" }),
                h(
                  "div",
                  { class: "outcome-legend" },
                  DECISION_PARTS.map((d) =>
                    h(
                      d.view ? "a" : "div",
                      { class: "outcome-row", href: d.view ? `#/candidates?view=${d.view}` : undefined },
                      h("span", { class: "outcome-label" }, h("span", { class: ["dot", `bg-${d.tone}`] }), d.label),
                      h("span", { class: "outcome-num num" }, h("b", null, String(d.value)), ` · ${F.pct(d.value, evaluated.length)}`)
                    )
                  )
                )
              ),
              h("div", { class: "outcome-human" }, h("div", { class: "fact-label" }, "What you decided"), G.scaledStack(HUMAN_PARTS, evaluated.length), G.legend(HUMAN_PARTS)),
            ]
          : empty("Nothing evaluated in this period")
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
      cardHead("Your decisions vs the AI", "What you did with each of the gate's calls"),
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

    // ── Speed and cost ────────────────────────────────────────────────
    // What one screened candidate takes, in time and money. Cost is read
    // from the tracing backend after the page draws, so a slow or missing
    // Langfuse never holds the dashboard up.
    const decideTimes = inRange
      .filter((r) => r.evaluationSummary && (r.shortlistedAt || r.rejectedAt))
      .map((r) => (new Date(r.shortlistedAt ?? r.rejectedAt) - new Date(r.evaluationSummary.createdAt)) / 60000)
      .filter((m) => m >= 0)
      .sort((a, b) => a - b);
    const decideMedian = decideTimes.length ? decideTimes[Math.floor(decideTimes.length / 2)] : null;
    const fact = (label, value, sub) => h("div", { class: "fact" }, h("div", { class: "fact-label" }, label), h("div", { class: "fact-value num" }, value), h("div", { class: "fact-sub" }, sub));
    const costFacts = h("div", { class: "facts" }, fact("Cost per screened call", "…", "AI transcription and scoring"), fact("Cost per candidate moved on", "…", "AI cost behind each one"));
    const speedCard = h(
      "div",
      { class: "card", style: { marginTop: "16px" } },
      cardHead("Speed and cost", "What a screened candidate takes, in time and money", C.btn({ label: "Costs", size: "sm", variant: "ghost", href: "#/settings/costs", icon: "arrowRight", iconAfter: true })),
      h(
        "div",
        { class: "card-pad" },
        evaluated.length
          ? h(
              "div",
              { class: "facts-pair" },
              h(
                "div",
                { class: "facts" },
                fact("Report ready", median !== null ? F.fmtMinutes(median) : "—", "median, after upload"),
                fact("Your decision", decideMedian !== null ? F.fmtMinutes(decideMedian) : "—", decideMedian !== null ? "median, after the report" : "no decisions yet")
              ),
              costFacts
            )
          : empty("Nothing evaluated in this period")
      )
    );
    if (evaluated.length) {
      Costs.get(100, { signal })
        .then((c) => {
          if (signal.aborted) return;
          if (!c.configured || c.error) {
            mount(costFacts, h("p", { class: "faint small", style: { gridColumn: "1 / -1", margin: "0" } }, c.configured ? "Costs could not be read from Langfuse just now." : "Connect Langfuse to see what each call costs."));
            return;
          }
          // Joined by recording, so a re-run's cost lands on the candidate it
          // was for: the true price of getting that report.
          const ids = new Set(evaluated.map((r) => r.id));
          const perCall = new Map();
          for (const x of c.calls) {
            if (x.recordingId && ids.has(x.recordingId) && x.cost > 0) perCall.set(x.recordingId, (perCall.get(x.recordingId) ?? 0) + x.cost);
          }
          const avg = perCall.size ? [...perCall.values()].reduce((sum, v) => sum + v, 0) / perCall.size : null;
          mount(
            costFacts,
            fact("Cost per screened call", avg !== null ? F.money(avg) : "—", avg !== null ? `across ${F.plural(perCall.size, "priced call")}` : "no priced calls in this period"),
            fact("Cost per candidate moved on", avg !== null && shortlisted ? F.money((avg * evaluated.length) / shortlisted) : "—", shortlisted ? "AI cost behind each one" : "no one moved on yet")
          );
        })
        .catch((err) => {
          if (err?.name === "AbortError" || signal.aborted) return;
          mount(costFacts, h("p", { class: "faint small", style: { gridColumn: "1 / -1", margin: "0" } }, "Costs could not be read just now."));
        });
    }

    // ── Needs your attention ──────────────────────────────────────────
    // Everything waiting on a person, in one place: how long reports have
    // sat undecided, and who, most urgent first.
    const DAY = 86400000;
    const waiting = scoped.filter(F.awaitingDecision);
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
    const failedCount = attentionAll.filter((r) => r.status === "FAILED").length;
    // Fits first — they are the ones another employer can take — then failed
    // evaluations, which block any decision, then the rest; within each, the
    // longest wait first.
    const URGENCY = { advance: 0, failed: 1, borderline: 2, reject: 3, insufficient_evidence: 4 };
    const urgencyOf = (r) => (r.status === "FAILED" ? URGENCY.failed : URGENCY[gateOf(r)] ?? 5);
    const todo = [...attentionAll].sort((a, b) => urgencyOf(a) - urgencyOf(b) || waitedDays(b) - waitedDays(a));
    const waitedText = (r) => {
      if (r.status === "FAILED") return "evaluation failed";
      const d = Math.floor(waitedDays(r));
      return d < 1 ? "waiting under a day" : `waiting ${F.plural(d, "day")}`;
    };
    const attentionCard = h(
      "div",
      { class: "card", style: { marginTop: "16px" } },
      cardHead(
        "Needs your attention",
        "Reports awaiting your decision, and evaluations that failed — from any period",
        attentionAll.length ? C.btn({ label: "Open list", size: "sm", variant: "ghost", href: "#/candidates?view=attention", icon: "arrowRight", iconAfter: true }) : null
      ),
      attentionAll.length
        ? h(
            "div",
            { class: "attn" },
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
              G.legend(WAIT_SEGMENTS)
            ),
            h(
              "div",
              { class: "attn-list" },
              h(
                "div",
                { class: "attn-list-head" },
                `${F.plural(waiting.length, "candidate")} awaiting your decision${failedCount ? ` · ${failedCount} failed` : ""} — most urgent first`
              ),
              todo.slice(0, 5).map((r) =>
                h(
                  "a",
                  { class: "att-item", href: `#/candidates/${r.id}` },
                  h("div", { style: { minWidth: "0" } }, h("div", { class: "cand-name truncate" }, F.displayName(r)), h("div", { class: "cell-sub truncate" }, [r.job?.title ?? "No job", waitedText(r)].join(" · "))),
                  h("div", { class: "row" }, F.decisionOf(r) ? [h("span", { class: "strong num not-phone" }, F.score10(F.scoreOf(r))), C.decisionChip(F.decisionOf(r), { short: true })] : C.statusPill(r))
                )
              )
            )
          )
        : h("p", { class: "muted card-pad", style: { margin: "0" } }, "Nothing needs your attention: every evaluated candidate has your decision.")
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
      cardHead("Recent calls", recent.length ? `Latest ${recent.length} in this period` : "", C.btn({ label: "View all", size: "sm", variant: "ghost", href: "#/candidates", icon: "arrowRight", iconAfter: true })),
      recent.length ? recentTable.el.firstChild : h("p", { class: "muted card-pad" }, "No calls in this period")
    );

    // Outcomes first — what the screening produced, where, how well, how fast
    // and at what cost — then the to-do list for whoever acts on it.
    mount(
      body,
      serverIsOutdated(all) ? C.outdatedBanner() : null,
      kpis,
      pipelineCard,
      h("div", { class: "dash-grid is-even" }, outcomesCard, agreeCard),
      speedCard,
      attentionCard,
      recentCard
    );
  }
}
