/**
 * Jobs: the roles candidates are screened against. Each job has its own
 * ranking — the only place comparing candidates is meaningful, because it is
 * the only place they were measured against the same description.
 */

import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { Jobs, Recordings, Taxonomy, getRecordings, invalidateRecordings } from "../api.js";
import { navigate, replaceQuery } from "../router.js";
import { setActive } from "../shell.js";
import * as C from "../components.js";
import * as G from "../charts.js";
import * as F from "../format.js";

const MIN_JD = 40;

// ── List ─────────────────────────────────────────────────────────────
const JOB_SORTS = [
  { value: "active", label: "Recently active" },
  { value: "candidates", label: "Most candidates" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "A–Z" },
];
/** The group for a job nobody has classified, and no candidate has either. */
const UNCLASSIFIED = "none";

export async function jobsView({ query, signal, main }) {
  setActive("jobs");
  const state = {
    archived: query.get("archived") === "1",
    dept: query.get("dept") ?? "",
    q: query.get("q") ?? "",
    sort: JOB_SORTS.some((s) => s.value === query.get("sort")) ? query.get("sort") : "active",
  };
  const header = C.topbar({ title: "Jobs", actions: [C.btn({ label: "New job", icon: "plus", variant: "primary", size: "sm", href: "#/jobs/new", cls: "phone-only" })] });
  mount(
    main,
    header,
    h("div", { class: "page" }, h("div", { class: "card job-group" }, [0, 1, 2, 3].map(() => h("div", { class: "job-row" }, h("div", { class: "stack gap-8" }, C.skelLine("55%", 16), C.skelLine("30%"))))))
  );

  let jobs;
  let recs = [];
  try {
    [jobs, recs] = await Promise.all([Jobs.list(true, { signal }), getRecordings({ signal }).catch(() => [])]);
  } catch (err) {
    if (err?.name === "AbortError") return;
    mount(main, header, h("div", { class: "page" }, C.errorState(err)));
    return;
  }
  if (signal.aborted) return;

  // What each job is, and when it last saw a call. A job saved without a
  // department takes the one its candidates were classified under, so older
  // jobs still land in the right group.
  const activity = new Map();
  for (const r of recs) {
    if (!r.job) continue;
    const a = activity.get(r.job.id) ?? { last: null, depts: new Map(), roles: new Map() };
    const at = new Date(r.importedAt);
    if (!a.last || at > a.last) a.last = at;
    const s = r.evaluationSummary;
    if (s?.department) a.depts.set(s.department, (a.depts.get(s.department) ?? 0) + 1);
    if (s?.subCategory) a.roles.set(s.subCategory, (a.roles.get(s.subCategory) ?? 0) + 1);
    activity.set(r.job.id, a);
  }
  const mostCommon = (counts) => [...(counts?.entries() ?? [])].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  const items = jobs.map((job) => {
    const a = activity.get(job.id);
    return { job, dept: job.department || mostCommon(a?.depts), role: job.subCategory || mostCommon(a?.roles), last: a?.last ?? null };
  });
  const deptKey = (it) => it.dept ?? UNCLASSIFIED;
  const deptLabel = (key) => (key === UNCLASSIFIED ? "Not classified" : key);
  const pool = () => items.filter((it) => it.job.archived === state.archived);
  // Departments with the most jobs first; the unclassified pile always last.
  const byWeight = (counts) => (a, b) => (a === UNCLASSIFIED) - (b === UNCLASSIFIED) || counts.get(b) - counts.get(a) || a.localeCompare(b);

  const sync = () =>
    replaceQuery({ archived: state.archived ? "1" : "", dept: state.dept, q: state.q.trim(), sort: state.sort === "active" ? "" : state.sort });
  const redraw = () => {
    sync();
    drawTabs();
    drawList();
  };

  const archivedCount = jobs.filter((j) => j.archived).length;
  const tabsEl = h("div", { class: "views", role: "tablist", "aria-label": "Departments" });
  const searchInput = h("input", {
    class: "input",
    type: "search",
    placeholder: "Search jobs",
    "aria-label": "Search jobs",
    value: state.q,
    onInput: (e) => {
      state.q = e.target.value;
      sync();
      drawList();
    },
  });
  const listEl = h("div");

  mount(
    main,
    header,
    h(
      "div",
      { class: "page" },
      h(
        "div",
        { class: "intro" },
        h("div", null, h("h2", { class: "h1" }, "Jobs"), h("p", null, "The roles candidates are scored against. Each one ranks its own candidates.")),
        h(
          "div",
          { class: "row" },
          archivedCount
            ? C.seg({
                label: "Show",
                value: state.archived ? "archived" : "active",
                options: [
                  { value: "active", label: "Active" },
                  { value: "archived", label: `Archived (${archivedCount})` },
                ],
                onChange: (v) => {
                  state.archived = v === "archived";
                  state.dept = "";
                  redraw();
                },
              })
            : null,
          C.btn({ label: "New job", icon: "plus", variant: "primary", href: "#/jobs/new", cls: "not-phone" })
        )
      ),
      tabsEl,
      h(
        "div",
        { class: "jobs-toolbar" },
        h("div", { class: "input-wrap grow" }, icon("search"), searchInput),
        C.select({ label: "Sort jobs", cls: "jobs-sort", value: state.sort, options: JOB_SORTS, onChange: (v) => ((state.sort = v), redraw()) })
      ),
      listEl
    )
  );
  drawTabs();
  drawList();

  function drawTabs() {
    const counts = new Map();
    for (const it of pool()) counts.set(deptKey(it), (counts.get(deptKey(it)) ?? 0) + 1);
    if (state.dept && !counts.has(state.dept)) state.dept = "";
    const keys = [...counts.keys()].sort(byWeight(counts));
    const tab = (key, label, n) =>
      h(
        "button",
        {
          class: ["view-tab", state.dept === key && "is-active"],
          type: "button",
          role: "tab",
          "aria-selected": String(state.dept === key),
          onClick: () => {
            state.dept = key;
            redraw();
          },
        },
        label,
        h("span", { class: "view-count" }, String(n))
      );
    mount(tabsEl, tab("", "All", pool().length), keys.map((k) => tab(k, deptLabel(k), counts.get(k))));
    // With one department the tabs would only repeat the group heading.
    tabsEl.hidden = keys.length < 2;
  }

  function drawList() {
    if (!pool().length) {
      mount(
        listEl,
        h(
          "div",
          { class: "card" },
          C.emptyState(
            state.archived
              ? { icon: "archive", title: "No archived jobs", text: "Jobs you archive are kept here with their candidates." }
              : {
                  icon: "briefcase",
                  title: "No jobs yet",
                  text: "Add a job description, then evaluate calls against it to rank candidates for the role.",
                  action: C.btn({ label: "New job", icon: "plus", variant: "primary", href: "#/jobs/new" }),
                }
          )
        )
      );
      return;
    }

    const q = state.q.trim().toLowerCase();
    const shown = pool().filter(
      (it) =>
        (!state.dept || deptKey(it) === state.dept) &&
        (!q || [it.job.title, it.role, it.dept].some((v) => v && v.toLowerCase().includes(q)))
    );
    if (!shown.length) {
      mount(
        listEl,
        h(
          "div",
          { class: "card" },
          C.emptyState({
            icon: "search",
            title: "No jobs match",
            text: "Try another search, or look in every department.",
            action: C.btn({
              label: "Clear search",
              onClick: () => {
                state.q = "";
                state.dept = "";
                searchInput.value = "";
                redraw();
              },
            }),
          })
        )
      );
      return;
    }

    const recency = (it) => (it.last ?? new Date(it.job.createdAt)).getTime();
    const SORTERS = {
      active: (a, b) => recency(b) - recency(a),
      candidates: (a, b) => b.job.recordingCount - a.job.recordingCount || recency(b) - recency(a),
      newest: (a, b) => new Date(b.job.createdAt) - new Date(a.job.createdAt),
      name: (a, b) => a.job.title.localeCompare(b.job.title),
    };
    const groups = new Map();
    for (const it of shown) {
      if (!groups.has(deptKey(it))) groups.set(deptKey(it), []);
      groups.get(deptKey(it)).push(it);
    }
    const sizes = new Map([...groups].map(([k, v]) => [k, v.length]));
    mount(
      listEl,
      [...groups.keys()].sort(byWeight(sizes)).map((key) =>
        h(
          "section",
          { class: "card job-group", "aria-label": deptLabel(key) },
          h("div", { class: "job-group-head" }, h("h3", null, deptLabel(key)), h("span", null, F.plural(groups.get(key).length, "job"))),
          groups.get(key).sort(SORTERS[state.sort]).map(jobRow)
        )
      )
    );
  }

  function jobRow(it) {
    const n = it.job.recordingCount;
    const when = it.last ? `last call ${F.fmtRelative(it.last.toISOString())}` : `added ${F.fmtDate(it.job.createdAt)}`;
    return h(
      "a",
      { class: "job-row", href: `#/jobs/${it.job.id}` },
      h("div", { class: "job-row-main" }, h("div", { class: "job-row-title" }, it.job.title), h("div", { class: "job-row-meta" }, [it.role, when].filter(Boolean).join(" · "))),
      h("div", { class: "job-row-count" }, h("b", null, String(n)), n === 1 ? " candidate" : " candidates"),
      icon("chevronRight", "job-chevron")
    );
  }
}

// ── Detail ───────────────────────────────────────────────────────────
export async function jobDetailView({ params, query, signal, main }) {
  setActive("jobs");
  const id = params.id;
  let tab = ["ranking", "description", "compare"].includes(query.get("tab")) ? query.get("tab") : "ranking";
  mount(
    main,
    C.topbar({ title: "Job", back: "#/jobs", crumbs: [{ label: "Jobs", href: "#/jobs" }, { label: "Loading…" }] }),
    h("div", { class: "page" }, h("div", { class: "stack gap-16" }, C.skelBlock(120), C.skelTable(5, 5)))
  );

  let job;
  let ranking;
  try {
    [job, ranking] = await Promise.all([Jobs.get(id, { signal }), Jobs.ranking(id, { signal })]);
  } catch (err) {
    if (err?.name === "AbortError") return;
    mount(main, C.topbar({ title: "Job", back: "#/jobs" }), h("div", { class: "page" }, C.errorState(err)));
    return;
  }
  if (signal.aborted) return;

  const ranked = ranking.ranked;
  const all = [...ranked, ...ranking.setAside];
  const fitCount = all.filter((c) => c.decision === "advance").length;

  const menu = () => [
    { label: "Edit job", icon: "edit", onClick: () => navigate(`/jobs/${id}/edit`) },
    {
      label: job.archived ? "Restore from archive" : "Archive",
      icon: "archive",
      onClick: async () => {
        try {
          await Jobs.update(id, { archived: !job.archived });
          C.toast(job.archived ? "Job restored" : "Job archived");
          navigate(job.archived ? `/jobs/${id}` : "/jobs");
        } catch (err) {
          C.toast(err.message, { tone: "reject" });
        }
      },
    },
    "sep",
    {
      label: "Delete job",
      icon: "trash",
      tone: "danger",
      onClick: async () => {
        const ok = await C.confirm({
          title: `Delete “${job.title}”?`,
          text: "Candidates screened against it are kept but lose the link to this job. This cannot be undone.",
          confirmLabel: "Delete job",
          tone: "danger",
        });
        if (!ok) return;
        try {
          await Jobs.remove(id);
          invalidateRecordings();
          navigate("/jobs");
          C.toast("Job deleted");
        } catch (err) {
          C.toast(err.message, { tone: "reject" });
        }
      },
    },
  ];

  const headerCard = h(
    "div",
    { class: "card card-pad" },
    job.archived ? C.banner({ icon: "archive", text: "This job is archived. Its candidates and ranking are kept." }) : null,
    h(
      "div",
      { class: "row row-between gap-16 row-wrap", style: { alignItems: "flex-start" } },
      h("div", { class: "stack gap-4", style: { minWidth: "0", flex: "1 1 320px" } }, h("h2", { class: "h1" }, job.title), h("p", { class: "muted" }, [job.department, job.subCategory].filter(Boolean).join(" › ") || "Not classified")),
      h("div", { class: "row" }, C.btn({ label: "Evaluate a call", icon: "plus", variant: "primary", href: `#/evaluate?job=${id}` }))
    ),
    h(
      "div",
      { class: "job-card-stats", style: { marginTop: "18px" } },
      h("div", null, h("div", { class: "stat-label" }, "Candidates"), h("div", { class: "stat-value" }, String(all.length))),
      h("div", null, h("div", { class: "stat-label" }, "Average"), h("div", { class: "stat-value" }, F.score10(job.averageOverallScore))),
      h("div", null, h("div", { class: "stat-label" }, "Fit"), h("div", { class: "stat-value" }, String(fitCount))),
      h("div", null, h("div", { class: "stat-label" }, "Ranked"), h("div", { class: "stat-value" }, String(ranked.length)))
    )
  );

  const tabEls = {};
  const tabsEl = h(
    "div",
    { class: "tabs", role: "tablist" },
    [
      ["ranking", "Ranking"],
      ["description", "Job description"],
      ["compare", "Compare"],
    ].map(([k, label]) => {
      tabEls[k] = h("button", { class: ["view-tab", tab === k && "is-active"], type: "button", role: "tab", "aria-selected": String(tab === k), onClick: () => switchTab(k) }, label);
      return tabEls[k];
    })
  );
  const body = h("div");

  mount(
    main,
    C.topbar({ title: job.title, back: "#/jobs", crumbs: [{ label: "Jobs", href: "#/jobs" }, { label: job.title }], actions: [C.moreMenu(menu, { bordered: false })] }),
    h("div", { class: "page" }, headerCard, h("div", { class: "mt-24" }, tabsEl), body)
  );
  switchTab(tab);

  function switchTab(k) {
    tab = k;
    replaceQuery({ tab: k === "ranking" ? "" : k });
    Object.entries(tabEls).forEach(([key, el]) => {
      el.classList.toggle("is-active", key === k);
      el.setAttribute("aria-selected", String(key === k));
    });
    if (k === "ranking") mount(body, rankingTab(ranking, id));
    else if (k === "description") mount(body, descriptionTab(job));
    else mount(body, compareTab(ranked, signal));
  }
}

function rankingTab(ranking, jobId) {
  if (!ranking.ranked.length && !ranking.setAside.length) {
    return h(
      "div",
      { class: "card" },
      C.emptyState({
        icon: "users",
        title: "No candidates for this job yet",
        text: "Evaluate a call against this job and the candidate is ranked here.",
        action: C.btn({ label: "Evaluate a call", icon: "plus", variant: "primary", href: `#/evaluate?job=${jobId}` }),
      })
    );
  }
  const notes = ranking.comparabilityNotes.length ? h("div", { class: "stack gap-8", style: { marginBottom: "16px" } }, ranking.comparabilityNotes.map((n) => C.note("info", n))) : null;

  const reasonsBlock = (c) =>
    h(
      "div",
      { class: "detail-grid" },
      c.aheadOfNext ? h("div", null, h("div", { class: "detail-label" }, "Why above the next"), h("p", null, c.aheadOfNext)) : null,
      c.reasons.length ? h("div", null, h("div", { class: "detail-label" }, "Why here"), h("ul", { class: "stack gap-4" }, c.reasons.map((r) => h("li", { class: "row", style: { alignItems: "flex-start" } }, h("span", { class: "faint" }, "•"), h("span", null, r))))) : null,
      h("div", null, C.btn({ label: "Open report", size: "sm", href: `#/candidates/${c.recordingId}`, icon: "arrowRight", iconAfter: true }))
    );

  const nameOf = (c) => c.candidateName?.trim() || F.stripExtension(c.originalFilename);
  const table = ranking.ranked.length
    ? C.dataTable({
        cls: "t-ranking",
        caption: "Ranking",
        columns: [
          { label: "#", cls: "tight c-rank" },
          { label: "Candidate", cls: "c-name" },
          { label: "Decision", cls: "tight c-decision" },
          { label: "Technical", cls: "tight num c-tech" },
          { label: "Requirements met", cls: "tight num c-req" },
          { label: "Score", cls: "tight num c-score" },
          { label: "", cls: "c-meta phone-meta" },
        ],
        rows: ranking.ranked,
        renderRow: (c) => {
          const req = c.requirementCounts;
          const reqTotal = req.met + req.partial + req.missing + req.notDiscussed;
          return [
            C.td(h("span", { class: "strong num" }, String(c.rank)), "tight c-rank"),
            C.td(h("span", { class: "cell-title" }, nameOf(c)), "c-name"),
            C.td(C.decisionChip(c.decision, { short: true }), "tight c-decision"),
            C.td(c.technicalAsked ? h("span", { class: `num tone-${F.rateTone(c.technicalAnswered, c.technicalAsked)} strong` }, `${c.technicalAnswered} of ${c.technicalAsked}`) : h("span", { class: "faint" }, "—"), "tight num c-tech"),
            C.td(reqTotal ? `${req.met} of ${reqTotal}` : h("span", { class: "faint" }, "—"), "tight num c-req"),
            C.td(h("span", { class: "score-cell num" }, F.score10(c.decidingScore)), "tight num c-score"),
            C.td(h("div", { class: "row row-wrap gap-12" }, C.decisionChip(c.decision, { short: true }), c.technicalAsked ? h("span", { class: "faint small" }, `${c.technicalAnswered} of ${c.technicalAsked} technical`) : null), "c-meta phone-meta"),
          ];
        },
        renderDetail: reasonsBlock,
      })
    : null;

  const setAside = ranking.setAside.length
    ? C.section(
        { title: "Set aside", meta: "Not enough evidence to rank — never a rejection" },
        h(
          "div",
          { class: "card" },
          ranking.setAside.map((c) =>
            h(
              "a",
              { class: "att-item", href: `#/candidates/${c.recordingId}` },
              h("div", { style: { minWidth: "0" } }, h("div", { class: "cand-name truncate" }, nameOf(c)), h("div", { class: "cell-sub" }, c.reasons[c.reasons.length - 1] ?? "")),
              C.decisionChip("insufficient_evidence", { short: true })
            )
          )
        )
      )
    : null;

  // Score spread — how many cleared the bar, at a glance
  const spreadPoints = [...ranking.ranked].map((c) => ({
    score: c.decidingScore,
    name: nameOf(c),
    tone: F.DECISION[c.decision]?.tone ?? "neutral",
    href: `#/candidates/${c.recordingId}`,
  }));
  const cleared = ranking.ranked.filter((c) => c.decision === "advance").length;
  const spread =
    ranking.ranked.length > 1
      ? h(
          "div",
          { class: "card card-pad", style: { marginBottom: "16px" } },
          h("div", { class: "row row-between", style: { marginBottom: "4px" } }, h("h3", { class: "card-title" }, "Score spread"), h("span", { class: "card-meta" }, `${cleared} of ${ranking.ranked.length} fit for the next round`)),
          G.scoreSpread(spreadPoints)
        )
      : null;

  return h("div", null, notes, spread, table ? table.el : null, setAside);
}

/** Turn a pasted JD into headings, paragraphs and lists. */
function formatJd(text) {
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(h("p", null, para.join(" ")));
    para = [];
  };
  const flushList = () => {
    if (list) out.push(list);
    list = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    const bullet = /^([-•*·▪●◦]|\d{1,2}[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      list ??= h("ul");
      list.append(h("li", null, bullet[2]));
      continue;
    }
    const heading = line.length <= 60 && (/:$/.test(line) || (/^[A-Z][A-Za-z &/,()-]+$/.test(line) && line.split(" ").length <= 6 && !/[.!?]$/.test(line)));
    if (heading) {
      flushPara();
      flushList();
      out.push(h("h4", null, line.replace(/:$/, "")));
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out;
}

function descriptionTab(job) {
  return h(
    "div",
    { class: "card card-pad" },
    h("div", { class: "row row-between", style: { marginBottom: "16px" } }, h("span", { class: "faint small" }, `Updated ${F.fmtDate(job.updatedAt)}`), C.btn({ label: "Edit", icon: "edit", size: "sm", href: `#/jobs/${job.id}/edit` })),
    h("div", { class: "jd-text" }, formatJd(job.jdText))
  );
}

function compareTab(ranked, signal) {
  if (ranked.length < 2) {
    return h("div", { class: "card" }, C.emptyState({ icon: "layers", title: "Two candidates needed", text: "Comparison opens once at least two candidates for this job have been ranked." }));
  }
  const picked = new Set(ranked.slice(0, 3).map((c) => c.recordingId));
  const cache = new Map();
  const picker = h("div", { class: "pick" });
  const cols = h("div");
  const nameOf = (c) => c.candidateName?.trim() || F.stripExtension(c.originalFilename);

  function renderPicker() {
    mount(
      picker,
      ranked.map((c) =>
        h(
          "button",
          {
            type: "button",
            class: ["pick-btn", picked.has(c.recordingId) && "is-on"],
            "aria-pressed": String(picked.has(c.recordingId)),
            onClick: () => {
              if (picked.has(c.recordingId)) picked.delete(c.recordingId);
              else if (picked.size < 3) picked.add(c.recordingId);
              else return C.toast("Compare up to three at a time");
              renderPicker();
              renderCols();
            },
          },
          picked.has(c.recordingId) ? icon("check") : h("span", { class: "num faint" }, `#${c.rank}`),
          nameOf(c)
        )
      )
    );
  }

  async function renderCols() {
    const chosen = ranked.filter((c) => picked.has(c.recordingId));
    if (!chosen.length) {
      mount(cols, h("p", { class: "muted" }, "Pick candidates above to compare them."));
      return;
    }
    mount(cols, h("div", { class: "compare" }, chosen.map(() => h("div", { class: "card card-pad" }, C.skelBlock(300)))));
    try {
      const details = await Promise.all(
        chosen.map(async (c) => {
          if (!cache.has(c.recordingId)) cache.set(c.recordingId, await Recordings.get(c.recordingId, { signal }));
          return [c, cache.get(c.recordingId)];
        })
      );
      mount(
        cols,
        h(
          "div",
          { class: "compare" },
          details.map(([c, rec]) => {
            const ev = rec.evaluation;
            const req = c.requirementCounts;
            const reqTotal = req.met + req.partial + req.missing + req.notDiscussed;
            return h(
              "div",
              { class: "card" },
              h(
                "div",
                { class: "card-pad row gap-16" },
                G.scoreRing(c.decidingScore, { size: 64 }),
                h("div", { style: { minWidth: "0" } }, h("a", { class: "cand-name truncate", href: `#/candidates/${c.recordingId}`, style: { display: "block" } }, nameOf(c)), h("div", { class: "faint small" }, `Rank #${c.rank}`), h("div", { class: "mt-8" }, C.decisionChip(c.decision, { short: true })))
              ),
              h("div", { class: "cmp-row" }, h("div", { class: "cmp-label" }, "Technical answers"), c.technicalAsked ? h("div", { class: "row gap-12" }, h("span", { class: `strong tone-${F.rateTone(c.technicalAnswered, c.technicalAsked)}` }, `${c.technicalAnswered} of ${c.technicalAsked}`), h("span", { class: "faint small" }, `score ${F.score10(c.technicalScore)}`)) : h("span", { class: "faint" }, "None asked")),
              h("div", { class: "cmp-row" }, h("div", { class: "cmp-label" }, "Skills"), ev ? G.miniBars(ev.categories) : h("span", { class: "faint" }, "—")),
              h("div", { class: "cmp-row" }, h("div", { class: "cmp-label" }, "Requirements met"), reqTotal ? [h("div", { class: "strong", style: { marginBottom: "8px" } }, `${req.met} of ${reqTotal}`), G.stackBar([{ value: req.met, tone: "fit", label: "Met" }, { value: req.partial, tone: "consider", label: "Partial" }, { value: req.missing, tone: "reject", label: "Not met" }, { value: req.notDiscussed, tone: "neutral", label: "Not discussed" }])] : h("span", { class: "faint" }, "No job description match")),
              h("div", { class: "cmp-row" }, h("div", { class: "cmp-label" }, "Top strength"), h("p", { class: "small" }, ev?.strengths?.[0] ?? "—")),
              h("div", { class: "cmp-row" }, h("div", { class: "cmp-label" }, "Gap to probe"), h("p", { class: "small" }, ev?.areasForImprovement?.[0] ?? "—"))
            );
          })
        )
      );
    } catch (err) {
      if (err?.name !== "AbortError") mount(cols, C.errorState(err));
    }
  }
  renderPicker();
  renderCols();
  return h("div", null, h("p", { class: "muted", style: { marginBottom: "12px" } }, "Pick up to three candidates to compare side by side."), picker, cols);
}

// ── Create / edit ────────────────────────────────────────────────────
export async function jobFormView({ params, signal, main }) {
  setActive("jobs");
  const editing = !!params.id;
  const title = editing ? "Edit job" : "New job";
  mount(main, C.topbar({ title, back: editing ? `#/jobs/${params.id}` : "#/jobs" }), h("div", { class: "page page-narrow" }, C.skelBlock(420)));

  let job = null;
  let taxonomy = { departments: [], fallback: "Other" };
  try {
    [job, taxonomy] = await Promise.all([editing ? Jobs.get(params.id, { signal }) : null, Taxonomy.get({ signal }).catch(() => taxonomy)]);
  } catch (err) {
    if (err?.name === "AbortError") return;
    mount(main, C.topbar({ title, back: "#/jobs" }), h("div", { class: "page page-narrow" }, C.errorState(err)));
    return;
  }
  if (signal.aborted) return;

  const titleInput = h("input", { class: "input", id: "jf-title", maxlength: "200", value: job?.title ?? "", placeholder: "e.g. Senior Data Engineer" });
  let department = job?.department ?? "";
  let subCategory = job?.subCategory ?? "";
  const subSlot = h("div");
  const deptOptions = [{ value: "", label: "Not set" }, ...taxonomy.departments.map((d) => ({ value: d.name, label: d.name })), { value: taxonomy.fallback, label: taxonomy.fallback }];
  const deptSelect = C.select({
    id: "jf-dept",
    value: department,
    options: deptOptions,
    onChange: (v) => {
      department = v;
      subCategory = "";
      renderSub();
    },
  });
  function renderSub() {
    const subs = taxonomy.departments.find((d) => d.name === department)?.subCategories ?? [];
    mount(
      subSlot,
      C.field(
        { label: "Sub-category", optional: true, id: "jf-sub" },
        C.select({
          id: "jf-sub",
          value: subCategory,
          options: [{ value: "", label: department ? "Not set" : "Choose a department first" }, ...subs.map((s) => ({ value: s, label: s })), ...(department ? [{ value: taxonomy.fallback, label: taxonomy.fallback }] : [])],
          onChange: (v) => (subCategory = v),
        })
      )
    );
    subSlot.querySelector("select").disabled = !department;
  }
  const jd = h("textarea", { class: "textarea", id: "jf-jd", rows: "14", placeholder: "Paste the full job description" });
  jd.value = job?.jdText ?? "";
  const count = h("div", { class: "counter" });
  const status = h("span", { class: "faint small" });
  const docInput = h("input", { type: "file", hidden: true, accept: ".pdf,.docx,.doc,.txt,.md" });
  const updateCount = () => {
    const n = jd.value.trim().length;
    count.textContent = n < MIN_JD ? `${n} / ${MIN_JD} characters minimum` : `${n} characters`;
    count.classList.toggle("is-over", n > 0 && n < MIN_JD);
  };
  jd.addEventListener("input", updateCount);
  docInput.addEventListener("change", async () => {
    const file = docInput.files?.[0];
    if (!file) return;
    status.textContent = `Reading ${file.name}…`;
    try {
      const out = await Jobs.extractText(file);
      jd.value = out.text;
      if (!titleInput.value.trim()) titleInput.value = file.name.replace(/\.[^.]+$/, "");
      status.textContent = `Loaded${out.pages ? ` ${F.plural(out.pages, "page")}` : ""} — check it before saving.`;
      updateCount();
    } catch (err) {
      status.textContent = err.message;
    } finally {
      docInput.value = "";
    }
  });
  updateCount();
  renderSub();

  const errorSlot = h("div");
  const save = C.btn({ label: editing ? "Save changes" : "Create job", variant: "primary" });
  save.addEventListener("click", () =>
    C.busy(save, async () => {
      mount(errorSlot);
      const body = { title: titleInput.value.trim(), jdText: jd.value.trim(), department: department || null, subCategory: subCategory || null };
      if (!body.title) return mount(errorSlot, C.banner({ icon: "alertTriangle", tone: "reject", text: "Give the job a title." }));
      if (body.jdText.length < MIN_JD) return mount(errorSlot, C.banner({ icon: "alertTriangle", tone: "reject", text: `Paste the full job description — at least ${MIN_JD} characters.` }));
      try {
        const saved = editing ? await Jobs.update(params.id, body) : await Jobs.create(body);
        C.toast(editing ? "Job saved" : "Job created", { tone: "fit" });
        navigate(`/jobs/${saved.id}`);
      } catch (err) {
        mount(errorSlot, C.banner({ icon: "alertTriangle", tone: "reject", text: err.message }));
      }
    }, editing ? "Saving…" : "Creating…")
  );

  mount(
    main,
    C.topbar({ title, back: editing ? `#/jobs/${params.id}` : "#/jobs", crumbs: [{ label: "Jobs", href: "#/jobs" }, ...(editing ? [{ label: job.title, href: `#/jobs/${params.id}` }] : []), { label: editing ? "Edit" : "New job" }] }),
    h(
      "div",
      { class: "page page-narrow" },
      h("div", { class: "intro not-phone" }, h("div", null, h("h2", { class: "h1" }, title), h("p", null, editing ? "Changes apply to new evaluations. Re-evaluate a candidate to score them against the new text." : "Candidates evaluated against this job are scored on its requirements and ranked together."))),
      h(
        "div",
        { class: "card card-pad stack gap-16" },
        C.field({ label: "Job title", id: "jf-title" }, titleInput),
        h("div", { class: "field-row cols-2" }, C.field({ label: "Department", optional: true, id: "jf-dept" }, deptSelect), subSlot),
        C.field({ label: "Job description", id: "jf-jd", counter: count }, h("div", { class: "stack" }, jd, h("div", { class: "row row-wrap" }, C.btn({ label: "Upload PDF or Word", icon: "fileText", size: "sm", onClick: () => docInput.click() }), status), docInput))
      ),
      h("div", { class: "mt-16" }, errorSlot),
      h("div", { class: "row mt-16", style: { justifyContent: "flex-end" } }, C.btn({ label: "Cancel", href: editing ? `#/jobs/${params.id}` : "#/jobs" }), save)
    )
  );
}
