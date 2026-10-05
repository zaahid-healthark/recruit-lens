/**
 * Candidates: every evaluated call, as a filterable table that becomes a list
 * of cards on a phone. Views, search and filters all live in the URL, so a
 * filtered list can be bookmarked or shared.
 */

import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { Recordings, getRecordings, serverIsOutdated } from "../api.js";
import { navigate, replaceQuery } from "../router.js";
import { setActive } from "../shell.js";
import * as C from "../components.js";
import * as F from "../format.js";

const VIEWS = [
  { id: "all", label: "All", test: () => true },
  { id: "attention", label: "Needs attention", test: F.needsAttention },
  { id: "fit", label: "Fit", test: (r) => F.decisionOf(r) === "advance" },
  { id: "consider", label: "Consider", test: (r) => F.decisionOf(r) === "borderline" },
  { id: "next", label: "Next round", test: (r) => !!r.shortlistedAt },
  { id: "rejected", label: "Rejected", test: (r) => !!r.rejectedAt },
  { id: "trash", label: "Trash", test: () => true },
];

const EMPTY = {
  all: { icon: "inbox", title: "No calls yet", text: "Upload a screening call and its report appears here." },
  attention: { icon: "checkCircle", title: "Nothing needs your attention", text: "Every evaluated candidate has a decision, and nothing has failed." },
  fit: { icon: "target", title: "No fits yet", text: "Candidates the gate sends to the next round appear here." },
  consider: { icon: "help", title: "Nothing to consider", text: "Candidates on the line between fit and not appear here." },
  next: { icon: "arrowUpRight", title: "No one in the next round yet", text: "Move a candidate to the next round from their report." },
  rejected: { icon: "xCircle", title: "No rejections", text: "Candidates you reject stay here, out of your way." },
  trash: { icon: "trash", title: "Trash is empty", text: "Candidates you move to the trash can be restored from here." },
};

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "score-desc", label: "Highest score" },
  { value: "score-asc", label: "Lowest score" },
  { value: "name", label: "Name A–Z" },
];

export async function candidatesView({ query, signal, main }) {
  const state = {
    view: VIEWS.some((v) => v.id === query.get("view")) ? query.get("view") : "all",
    q: query.get("q") ?? "",
    job: query.get("job") ?? "",
    from: query.get("from") ?? "",
    to: query.get("to") ?? "",
    sort: SORTS.some((s) => s.value === query.get("sort")) ? query.get("sort") : "newest",
    page: Math.max(1, Number(query.get("page")) || 1),
    per: [10, 25, 50].includes(Number(query.get("per"))) ? Number(query.get("per")) : 25,
  };
  setActive("candidates", state.view);

  const header = C.topbar({ title: "Candidates" });
  mount(main, header, h("div", { class: "page" }, h("div", { class: "stack gap-16" }, C.skelLine("30%", 22), C.skelTable(8, 6))));

  let live;
  let trash = null;
  try {
    live = await getRecordings({ signal });
    if (state.view === "trash") trash = await Recordings.list({ trashed: "true" }, { signal });
  } catch (err) {
    if (err?.name === "AbortError") return;
    mount(main, header, h("div", { class: "page" }, C.errorState(err, () => navigate(location.hash.slice(1) || "/candidates"))));
    return;
  }
  if (signal.aborted) return;

  const jobsInUse = [...new Map(live.filter((r) => r.job).map((r) => [r.job.id, r.job])).values()].sort((a, b) =>
    a.title.localeCompare(b.title)
  );

  // ── Controls ────────────────────────────────────────────────────────
  const counts = {};
  const viewEls = {};
  const viewsEl = h(
    "div",
    { class: "views", role: "tablist", "aria-label": "Candidate views" },
    VIEWS.map((v) => {
      counts[v.id] = h("span", { class: "view-count" }, v.id === "trash" ? "" : String(live.filter(v.test).length));
      if (v.id === "trash") counts[v.id].hidden = true;
      viewEls[v.id] = h(
        "button",
        {
          class: ["view-tab", state.view === v.id && "is-active"],
          type: "button",
          role: "tab",
          "aria-selected": String(state.view === v.id),
          onClick: () => switchView(v.id),
        },
        v.label,
        counts[v.id]
      );
      return viewEls[v.id];
    })
  );

  const searchInput = h("input", {
    class: "input",
    type: "search",
    placeholder: "Search name, phone, file or job",
    "aria-label": "Search candidates",
    value: state.q,
  });
  let searchTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = searchInput.value.trim();
      state.page = 1;
      update();
    }, 160);
  });

  const jobOptions = [{ value: "", label: "All jobs" }, ...jobsInUse.map((j) => ({ value: j.id, label: j.title })), { value: "none", label: "No job attached" }];
  const inlineJob = C.select({ label: "Job", value: state.job, options: jobOptions, onChange: (v) => setFilter({ job: v }) });
  const inlineFrom = h("input", { class: "input", type: "date", "aria-label": "From date", value: state.from, onChange: (e) => setFilter({ from: e.target.value }) });
  const inlineTo = h("input", { class: "input", type: "date", "aria-label": "To date", value: state.to, onChange: (e) => setFilter({ to: e.target.value }) });
  const inlineSort = C.select({ label: "Sort", value: state.sort, options: SORTS, onChange: (v) => setFilter({ sort: v }) });

  const filterBtn = C.btn({ label: "Filters", icon: "filter", cls: "filters-toggle", onClick: openSheet });
  const toolbar = h(
    "div",
    { class: "toolbar" },
    h("div", { class: "input-wrap search" }, icon("search"), searchInput),
    h("div", { class: "filters-inline" }, inlineJob, inlineFrom, inlineTo, inlineSort),
    filterBtn
  );
  const chipsEl = h("div", { class: "filter-chips" });
  const resultsEl = h("div");

  mount(
    main,
    header,
    h(
      "div",
      { class: "page" },
      h(
        "div",
        { class: "intro not-phone" },
        h("div", null, h("h2", { class: "h1" }, "Candidates"), h("p", null, "Every screened call, with the gate's decision and yours.")),
        C.btn({ label: "Evaluate a call", icon: "plus", variant: "primary", href: "#/evaluate" })
      ),
      serverIsOutdated(live) ? C.outdatedBanner() : null,
      viewsEl,
      toolbar,
      chipsEl,
      resultsEl
    )
  );

  if (state.view !== "trash") {
    Recordings.list({ trashed: "true" }, { signal })
      .then((t) => {
        trash = t;
        counts.trash.textContent = String(t.length);
        counts.trash.hidden = t.length === 0;
      })
      .catch(() => {});
  } else {
    counts.trash.textContent = String(trash.length);
    counts.trash.hidden = false;
  }
  update();

  // ── Behaviour ───────────────────────────────────────────────────────
  async function switchView(id) {
    state.view = id;
    state.page = 1;
    Object.entries(viewEls).forEach(([k, el]) => {
      el.classList.toggle("is-active", k === id);
      el.setAttribute("aria-selected", String(k === id));
    });
    setActive("candidates", id);
    if (id === "trash" && !trash) {
      mount(resultsEl, C.skelTable(5, 6));
      try {
        trash = await Recordings.list({ trashed: "true" }, { signal });
      } catch (err) {
        if (err?.name !== "AbortError") mount(resultsEl, C.errorState(err));
        return;
      }
    }
    update();
  }

  function setFilter(patch) {
    Object.assign(state, patch, { page: 1 });
    inlineJob.value = state.job;
    inlineFrom.value = state.from;
    inlineTo.value = state.to;
    inlineSort.value = state.sort;
    update();
  }

  function clearFilters() {
    searchInput.value = "";
    setFilter({ q: "", job: "", from: "", to: "", sort: "newest" });
  }

  function filtersActive() {
    return !!(state.job || state.from || state.to || state.sort !== "newest");
  }

  function openSheet() {
    let draft = { job: state.job, from: state.from, to: state.to, sort: state.sort };
    const d = C.dialog({
      title: "Filters",
      body: h(
        "div",
        { class: "stack gap-16" },
        C.field({ label: "Job", id: "f-job" }, C.select({ id: "f-job", value: draft.job, options: jobOptions, onChange: (v) => (draft.job = v) })),
        h(
          "div",
          { class: "field-row cols-2" },
          C.field({ label: "From", id: "f-from" }, h("input", { class: "input", id: "f-from", type: "date", value: draft.from, onChange: (e) => (draft.from = e.target.value) })),
          C.field({ label: "To", id: "f-to" }, h("input", { class: "input", id: "f-to", type: "date", value: draft.to, onChange: (e) => (draft.to = e.target.value) }))
        ),
        C.field({ label: "Sort by", id: "f-sort" }, C.select({ id: "f-sort", value: draft.sort, options: SORTS, onChange: (v) => (draft.sort = v) }))
      ),
      actions: [
        C.btn({
          label: "Clear filters",
          onClick: () => {
            d.close();
            clearFilters();
          },
        }),
        C.btn({
          label: "Show results",
          variant: "primary",
          onClick: () => {
            d.close();
            setFilter(draft);
          },
        }),
      ],
    });
  }

  function filtered() {
    const view = VIEWS.find((v) => v.id === state.view);
    let rows = state.view === "trash" ? trash ?? [] : live.filter(view.test);
    if (state.q) {
      const q = state.q.toLowerCase();
      rows = rows.filter((r) =>
        [r.candidateName, r.originalFilename, r.phoneNumber, r.job?.title, r.evaluationSummary?.roleDesignation].some(
          (v) => v && v.toLowerCase().includes(q)
        )
      );
    }
    if (state.job) rows = rows.filter((r) => (state.job === "none" ? !r.job : r.job?.id === state.job));
    if (state.from) {
      const from = new Date(state.from + "T00:00:00");
      rows = rows.filter((r) => new Date(r.importedAt) >= from);
    }
    if (state.to) {
      const to = new Date(state.to + "T23:59:59");
      rows = rows.filter((r) => new Date(r.importedAt) <= to);
    }
    const byDate = (a, b) => new Date(b.importedAt) - new Date(a.importedAt);
    const score = (r) => F.scoreOf(r) ?? -1;
    const sorters = {
      newest: byDate,
      oldest: (a, b) => -byDate(a, b),
      "score-desc": (a, b) => score(b) - score(a) || byDate(a, b),
      "score-asc": (a, b) => score(a) - score(b) || byDate(a, b),
      name: (a, b) => F.displayName(a).localeCompare(F.displayName(b)),
    };
    return [...rows].sort(sorters[state.sort]);
  }

  function renderChips() {
    const chips = [];
    const chip = (label, onRemove) =>
      h("span", { class: "fchip" }, label, h("button", { type: "button", "aria-label": `Remove ${label}`, onClick: onRemove }, icon("x")));
    if (state.job) chips.push(chip(state.job === "none" ? "No job attached" : `Job: ${jobsInUse.find((j) => j.id === state.job)?.title ?? "Unknown"}`, () => setFilter({ job: "" })));
    if (state.from) chips.push(chip(`From ${F.fmtDate(state.from + "T12:00:00")}`, () => setFilter({ from: "" })));
    if (state.to) chips.push(chip(`To ${F.fmtDate(state.to + "T12:00:00")}`, () => setFilter({ to: "" })));
    if (state.sort !== "newest") chips.push(chip(SORTS.find((s) => s.value === state.sort).label, () => setFilter({ sort: "newest" })));
    if (state.q) chips.push(chip(`“${state.q}”`, () => {
      searchInput.value = "";
      setFilter({ q: "" });
    }));
    if (chips.length) chips.push(C.btn({ label: "Clear filters", size: "sm", variant: "ghost", onClick: clearFilters }));
    mount(chipsEl, chips);
    chipsEl.hidden = chips.length === 0;
    filterBtn.classList.toggle("is-on", filtersActive());
    filterBtn.setAttribute("aria-pressed", String(filtersActive()));
  }

  function update() {
    replaceQuery({
      view: state.view === "all" ? "" : state.view,
      q: state.q,
      job: state.job,
      from: state.from,
      to: state.to,
      sort: state.sort === "newest" ? "" : state.sort,
      page: state.page > 1 ? state.page : "",
      per: state.per === 25 ? "" : state.per,
    });
    renderChips();
    const rows = filtered();
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / state.per));
    if (state.page > pages) state.page = pages;
    const pageRows = rows.slice((state.page - 1) * state.per, state.page * state.per);

    if (total === 0) {
      const anyFilter = state.q || filtersActive();
      const e = anyFilter
        ? { icon: "search", title: "No candidates match", text: "Try a different search, or clear the filters." }
        : EMPTY[state.view];
      mount(
        resultsEl,
        h(
          "div",
          { class: "card" },
          C.emptyState({
            ...e,
            action: anyFilter
              ? C.btn({ label: "Clear filters", onClick: clearFilters })
              : state.view === "all"
                ? C.btn({ label: "Evaluate a call", icon: "plus", variant: "primary", href: "#/evaluate" })
                : null,
          })
        )
      );
      return;
    }

    const table = C.dataTable({
      cls: "t-candidates",
      caption: "Candidates",
      columns: [
        { label: "Candidate", cls: "c-name" },
        { label: "Job", cls: "c-job" },
        { label: "Call date", cls: "tight c-date" },
        { label: "Length", cls: "tight num c-len" },
        { label: "Score", cls: "tight num c-score" },
        { label: "Decision", cls: "tight c-decision" },
        { label: "Status", cls: "tight c-status" },
        { label: "", cls: "c-sub" },
      ],
      rows: pageRows,
      onRowClick: (r) => navigate(`/candidates/${r.id}`),
      renderRow: (r) => {
        const decision = F.decisionOf(r);
        return [
          C.td(
            h("a", { href: `#/candidates/${r.id}`, style: { color: "inherit" } }, h("div", { class: "cand-name clamp-2", title: F.displayName(r) }, F.displayName(r))),
            "c-name"
          ),
          C.td(r.job ? h("div", { class: "clamp-2", title: r.job.title }, r.job.title) : h("span", { class: "faint" }, "No job"), "c-job"),
          C.td(h("span", { class: "num" }, F.fmtDate(r.importedAt)), "tight c-date"),
          C.td(F.fmtDuration(r.durationSeconds), "tight num c-len"),
          C.td(h("span", { class: "score-cell num" }, F.score10(F.scoreOf(r))), "tight num c-score"),
          C.td(decision ? C.decisionChip(decision, { short: true }) : C.statusPill(r), "tight c-decision"),
          C.td(decision ? C.statusPill(r) : h("span", { class: "faint" }, "—"), "tight c-status"),
          C.td(
            h(
              "div",
              { class: "cell-sub truncate" },
              [r.job?.title ?? "No job", F.fmtDateShort(r.importedAt), r.shortlistedAt ? "Next round" : r.rejectedAt ? "Rejected" : null].filter(Boolean).join(" · ")
            ),
            "c-sub"
          ),
        ];
      },
    });
    mount(
      resultsEl,
      h(
        "div",
        { class: "tbl-wrap" },
        table.el.firstChild,
        C.pager({
          total,
          page: state.page,
          per: state.per,
          onChange: ({ page, per }) => {
            state.page = page;
            state.per = per;
            update();
            resultsEl.scrollIntoView({ block: "start", behavior: "smooth" });
          },
        })
      )
    );
  }
}
