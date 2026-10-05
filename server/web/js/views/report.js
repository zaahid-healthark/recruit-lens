/**
 * The candidate report — the screen the whole product exists for.
 *
 * Read top to bottom it answers, in order: who is this, what is the decision,
 * why (in one paragraph), what the evidence looks like at a glance, and then
 * every answer, skill, strength, gap and requirement in full, with the call
 * itself at the bottom as the proof.
 *
 * There is exactly one verdict on the page: the gate's decision. The model's
 * own recommendation text is never shown beside it, because two verdicts that
 * can disagree are worse than one.
 */

import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { Jobs, Presets, Recordings, fetchAudioUrl, invalidateRecordings } from "../api.js";
import { navigate, refresh } from "../router.js";
import { setActive, setActionBar } from "../shell.js";
import * as C from "../components.js";
import * as G from "../charts.js";
import * as F from "../format.js";

export async function reportView({ params, signal, main }) {
  setActive("candidates");
  const id = params.id;

  mount(
    main,
    C.topbar({ title: "Candidate", back: "#/candidates", crumbs: [{ label: "Candidates", href: "#/candidates" }, { label: "Loading…" }] }),
    h("div", { class: "page" }, skeleton())
  );

  let rec;
  try {
    rec = await Recordings.get(id, { signal });
  } catch (err) {
    if (err?.name === "AbortError") return;
    mount(
      main,
      C.topbar({ title: "Candidate", back: "#/candidates", crumbs: [{ label: "Candidates", href: "#/candidates" }, { label: "Not found" }] }),
      h("div", { class: "page" }, C.errorState(err, () => refresh()))
    );
    return;
  }
  if (signal.aborted) return;
  draw(main, rec, signal);
}

function skeleton() {
  return h(
    "div",
    { class: "stack gap-16" },
    h(
      "div",
      { class: "card card-pad row gap-24" },
      h("span", { class: "skel", style: { width: "112px", height: "112px", borderRadius: "50%", flex: "none" } }),
      h("div", { class: "stack gap-12 grow" }, C.skelLine("40%", 22), C.skelLine("60%"), C.skelLine("30%"), C.skelLine("80%"))
    ),
    h("div", { class: "quick" }, ["q-tech", "q-answers", "q-skills", "q-fit"].map((c) => h("div", { class: `card tile ${c} q-half` }, C.skelLine("40%", 14), h("div", { class: "mt-16" }, C.skelBlock(110))))),
    h("div", { class: "section" }, C.skelTable(5, 5))
  );
}

/** Pick the right state for this recording and render it. */
function draw(main, rec, signal) {
  if (F.isProcessing(rec)) return drawProgress(main, rec, signal);
  if (rec.status === "FAILED" || !rec.evaluation) return drawFailed(main, rec, signal);
  return drawReport(main, rec, signal);
}

const crumbsFor = (rec) => [{ label: "Candidates", href: "#/candidates" }, { label: F.displayName(rec) }];

// ── Actions ──────────────────────────────────────────────────────────
async function patch(main, rec, signal, body, { message, undo, tone = "fit", leave } = {}) {
  try {
    const updated = await Recordings.update(rec.id, body);
    invalidateRecordings();
    if (leave) navigate(leave);
    else draw(main, updated, signal);
    if (message) {
      C.toast(message, {
        tone,
        actionLabel: undo ? "Undo" : undefined,
        onAction: undo
          ? async () => {
              const back = await Recordings.update(rec.id, undo);
              invalidateRecordings();
              if (leave) navigate(`/candidates/${rec.id}`);
              else draw(main, back, signal);
            }
          : undefined,
      });
    }
  } catch (err) {
    C.toast(err.message, { tone: "reject" });
  }
}

function decisionActions(main, rec, signal, { phone } = {}) {
  if (rec.trashedAt) {
    return [
      C.btn({
        label: "Delete forever",
        icon: "trash",
        variant: "danger",
        onClick: () => deleteForever(rec),
      }),
      C.btn({
        label: "Restore",
        icon: "undo",
        variant: "primary",
        onClick: () => patch(main, rec, signal, { trashed: false }, { message: "Restored from trash" }),
      }),
    ];
  }
  if (rec.shortlistedAt) {
    return [
      h("span", { class: "pill pill-lg is-next" }, icon("video"), "Moved to the video screen"),
      C.btn({
        label: "Undo",
        variant: "ghost",
        onClick: () => patch(main, rec, signal, { shortlisted: false }, { message: "Removed from the next round", tone: undefined }),
      }),
    ];
  }
  if (rec.rejectedAt) {
    return [
      h("span", { class: "pill pill-lg" }, icon("xCircle"), "Rejected"),
      C.btn({
        label: "Undo",
        variant: "ghost",
        onClick: () => patch(main, rec, signal, { rejected: false }, { message: "Rejection withdrawn", tone: undefined }),
      }),
    ];
  }
  return [
    C.btn({
      label: "Reject",
      icon: phone ? undefined : "xCircle",
      onClick: () =>
        patch(main, rec, signal, { rejected: true }, { message: `${F.displayName(rec)} rejected`, undo: { rejected: false }, tone: undefined }),
    }),
    C.btn({
      label: "Move to video screen",
      icon: "video",
      variant: "primary",
      onClick: () =>
        patch(main, rec, signal, { shortlisted: true }, { message: "Moved to the video screen", undo: { shortlisted: false } }),
    }),
  ];
}

async function deleteForever(rec) {
  const ok = await C.confirm({
    title: "Delete this candidate forever?",
    text: "The recording, transcript and report are removed permanently. This cannot be undone.",
    confirmLabel: "Delete forever",
    tone: "danger",
  });
  if (!ok) return;
  try {
    await Recordings.remove(rec.id);
    invalidateRecordings();
    navigate("/candidates?view=trash");
    C.toast("Deleted permanently");
  } catch (err) {
    C.toast(err.message, { tone: "reject" });
  }
}

function overflowItems(main, rec, signal) {
  return [
    { label: "Re-evaluate…", icon: "rotate", onClick: () => reevaluateDialog(rec) },
    { label: "Edit name and phone…", icon: "edit", onClick: () => editDetailsDialog(main, rec, signal) },
    { label: "Copy link", icon: "link", onClick: () => C.copyText(location.href, "Link copied") },
    { label: "Export PDF", icon: "printer", onClick: () => window.print() },
    "sep",
    rec.trashedAt
      ? { label: "Restore from trash", icon: "undo", onClick: () => patch(main, rec, signal, { trashed: false }, { message: "Restored from trash" }) }
      : {
          label: "Move to trash",
          icon: "trash",
          tone: "danger",
          onClick: () =>
            patch(main, rec, signal, { trashed: true }, { message: "Moved to trash", undo: { trashed: false }, tone: undefined, leave: "/candidates" }),
        },
  ];
}

async function reevaluateDialog(rec) {
  let jobs = [];
  let presets = [];
  try {
    [jobs, presets] = await Promise.all([Jobs.list(false), Presets.list()]);
  } catch (err) {
    C.toast(err.message, { tone: "reject" });
    return;
  }
  if (rec.job && !jobs.some((j) => j.id === rec.job.id)) jobs.unshift({ id: rec.job.id, title: rec.job.title + " (archived)" });

  let jobId = rec.job?.id ?? "";
  const instructions = h("textarea", { class: "textarea", id: "re-instr", rows: "4", maxlength: "2000", placeholder: "Optional — e.g. focus on the technical answers" });
  instructions.value = rec.customInstructions ?? "";
  const presetPick = presets.length
    ? C.select({
        label: "Use saved instructions",
        value: "",
        options: [{ value: "", label: "Use saved instructions…" }, ...presets.map((p) => ({ value: p.id, label: p.label }))],
        onChange: (v) => {
          const p = presets.find((x) => x.id === v);
          if (p) instructions.value = p.text;
        },
      })
    : null;

  const start = C.btn({ label: "Re-evaluate", icon: "rotate", variant: "primary" });
  const d = C.dialog({
    title: "Re-evaluate this call",
    body: h(
      "div",
      { class: "stack gap-16" },
      h("p", null, "The stored transcript is reused, so only the scoring runs again — usually about a minute."),
      C.field(
        { label: "Score against", id: "re-job" },
        C.select({
          id: "re-job",
          value: jobId,
          options: [{ value: "", label: "No job — score without a job description" }, ...jobs.map((j) => ({ value: j.id, label: j.title }))],
          onChange: (v) => (jobId = v),
        })
      ),
      C.field({ label: "Scoring instructions", optional: true, id: "re-instr" }, h("div", { class: "stack" }, presetPick, instructions))
    ),
    actions: [C.btn({ label: "Cancel", onClick: () => d.close() }), start],
  });
  start.addEventListener("click", () =>
    C.busy(start, async () => {
      try {
        const body = {};
        if ((rec.job?.id ?? "") !== jobId) body.jobId = jobId || null;
        const text = instructions.value.trim();
        if ((rec.customInstructions ?? "") !== text) body.customInstructions = text || null;
        if (Object.keys(body).length) await Recordings.update(rec.id, body);
        await Recordings.evaluate(rec.id);
        invalidateRecordings();
        d.close();
        refresh();
      } catch (err) {
        C.toast(err.message, { tone: "reject" });
      }
    }, "Starting…")
  );
}

function editDetailsDialog(main, rec, signal) {
  const name = h("input", { class: "input", id: "ed-name", value: rec.candidateName ?? "", maxlength: "200", autocomplete: "off" });
  const phone = h("input", {
    class: "input",
    id: "ed-phone",
    type: "tel",
    inputmode: "tel",
    value: rec.phoneNumber ?? F.phoneFromFilename(rec.originalFilename),
    maxlength: "40",
    autocomplete: "off",
  });
  const save = C.btn({ label: "Save", variant: "primary" });
  const d = C.dialog({
    title: "Name and phone",
    body: h(
      "div",
      { class: "stack gap-16" },
      C.field({ label: "Candidate name", id: "ed-name" }, name),
      C.field({ label: "Phone number", id: "ed-phone", hint: rec.phoneNumber ? null : "Suggested from the file name — check it before saving." }, phone)
    ),
    actions: [C.btn({ label: "Cancel", onClick: () => d.close() }), save],
  });
  save.addEventListener("click", () =>
    C.busy(save, async () => {
      await patch(main, rec, signal, { candidateName: name.value.trim() || null, phoneNumber: phone.value.trim() || null }, { message: "Details saved" });
      d.close();
    })
  );
}

// ── Report ───────────────────────────────────────────────────────────
function reasonFor(sum) {
  const { decision, technicalAsked: n, technicalAnswered: a, technicalScore, overallScore } = sum;
  if (decision === "insufficient_evidence") return "The call didn't cover enough to judge. Re-interview before deciding.";
  if (n > 0) {
    if (decision === "advance") return `Decided by the technical answers: ${a} of ${n} answered adequately or better.`;
    if (decision === "borderline") {
      if (a / n >= F.TECHNICAL_PASS_RATE && (technicalScore ?? 0) >= F.THRESHOLDS.fit) {
        return `Answered ${a} of ${n} technical questions well, but was hard to follow on the call — worth a human look.`;
      }
      return `${a} of ${n} technical answers landed; some of the basics wobbled.`;
    }
    return `Answered ${a} of ${n} technical questions adequately — below the bar for a video screen.`;
  }
  return `No technical questions were asked, so this is decided on the call overall (${F.score10(overallScore)}).`;
}

function drawReport(main, rec, signal) {
  const ev = rec.evaluation;
  const sum = rec.evaluationSummary;
  const qa = ev.questionAssessment;
  const jd = ev.jdMatch;

  let questionsTable = null;
  const focusQuestion = (i) => {
    const row = document.getElementById(`q-${i + 1}`);
    questionsTable?.open(i);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    row?.focus({ preventScroll: true });
  };

  // Hero
  const jobLink = rec.job ? h("a", { class: "mi", href: `#/jobs/${rec.job.id}` }, icon("briefcase"), h("span", { class: "truncate" }, rec.job.title)) : null;
  const heroEl = h(
    "div",
    { class: "card hero" },
    h("div", { class: "hero-score" }, G.scoreRing(ev.overallScore, { size: 112 })),
    h(
      "div",
      { class: "hero-top" },
      h(
        "div",
        { class: "stack gap-4", style: { minWidth: "0" } },
        h("h1", { class: "hero-name" }, F.displayName(rec)),
        h(
          "div",
          { class: "hero-sub" },
          ev.roleDesignation ? h("span", { class: "mi" }, icon("user"), ev.roleDesignation) : null,
          jobLink
        )
      ),
      h("div", { class: "hero-actions" }, decisionActions(main, rec, signal))
    ),
    h(
      "div",
      { class: "hero-meta" },
      h("span", { class: "mi" }, icon("calendar"), F.fmtDateTime(rec.importedAt)),
      h("span", { class: "mi" }, icon("clock"), F.fmtDuration(rec.durationSeconds)),
      rec.phoneNumber
        ? h("a", { class: "mi", href: `tel:${rec.phoneNumber.replace(/[^\d+]/g, "")}` }, icon("phone"), rec.phoneNumber)
        : h("button", { class: "mi link-btn", type: "button", onClick: () => editDetailsDialog(main, rec, signal) }, icon("phone"), "Add phone")
    ),
    h("div", { class: "hero-decision" }, C.decisionChip(sum.decision, { lg: true }), h("span", { class: "hero-reason" }, reasonFor(sum))),
    h(
      "div",
      { class: "hero-summary" },
      h("p", { class: "verdict" }, ev.overallSummary || "No summary was written for this call."),
      h(
        "div",
        { class: "notes" },
        ev.coverageNote ? C.note("info", ev.coverageNote) : null,
        rec.customInstructions ? C.note("sliders", h("span", null, h("b", null, "Scored with your instructions: "), `“${rec.customInstructions}”`)) : null
      )
    )
  );

  // At a glance
  const verdictCounts = (qa?.questions ?? []).reduce((m, q) => ((m[q.verdict] = (m[q.verdict] ?? 0) + 1), m), {});
  const techTile = h(
    "div",
    { class: "card tile q-tech q-half" },
    h("div", { class: "tile-head" }, h("h3", { class: "tile-title" }, "Technical answers"), h("span", { class: "tile-meta" }, "The deciding evidence")),
    sum.technicalAsked > 0
      ? h(
          "div",
          { class: "ring-row" },
          G.answeredRing(sum.technicalAnswered, sum.technicalAsked, { size: 92 }),
          h(
            "div",
            { class: "stack gap-4" },
            h("div", { class: "row gap-12", style: { alignItems: "baseline" } }, h("span", { class: "big-num" }, F.score10(sum.technicalScore)), h("span", { class: "faint small" }, "technical score")),
            sum.technicalScore !== null
              ? h("span", { class: `vlabel tone-${F.bandOf(sum.technicalScore)}` }, h("span", { class: "dot" }), F.BAND_LABEL[F.bandOf(sum.technicalScore)])
              : null,
            h("span", { class: "faint xsmall" }, `${sum.technicalAnswered} of ${sum.technicalAsked} adequate or better · 60% needed`)
          )
        )
      : h("div", { class: "tile-empty" }, "The recruiter asked no technical questions — a gap in the call, not in the candidate.")
  );
  const answersTile = h(
    "div",
    { class: "card tile q-answers q-half" },
    h(
      "div",
      { class: "tile-head" },
      h("h3", { class: "tile-title" }, "Answers by question"),
      h("span", { class: "tile-meta" }, qa ? F.plural(qa.questions.length, "question") + " asked" : "")
    ),
    qa
      ? [
          G.questionStrip(qa.questions, { onSelect: focusQuestion }),
          G.legend(
            Object.entries(F.VERDICT)
              .filter(([k]) => verdictCounts[k])
              .map(([k, v]) => ({ tone: v.tone, label: v.label, value: verdictCounts[k] }))
          ),
        ]
      : h("div", { class: "tile-empty" }, "The recruiter asked no substantive questions on this call.")
  );
  const assessed = ev.categories.filter((c) => typeof c.score === "number").length;
  const skillsTile = h(
    "div",
    { class: "card tile q-skills q-half" },
    h("div", { class: "tile-head" }, h("h3", { class: "tile-title" }, "Skills"), h("span", { class: "tile-meta" }, `${assessed} of ${ev.categories.length} assessed`)),
    G.miniBars(ev.categories)
  );
  const reqCounts = { met: 0, partial: 0, missing: 0, not_discussed: 0 };
  (jd?.requirements ?? []).forEach((r) => (reqCounts[r.verdict] = (reqCounts[r.verdict] ?? 0) + 1));
  const fitTile = h(
    "div",
    { class: "card tile q-fit q-half" },
    h(
      "div",
      { class: "tile-head" },
      h("h3", { class: "tile-title" }, "Job fit"),
      h("span", { class: "tile-meta" }, jd ? `${reqCounts.met} of ${jd.requirements.length} requirements met` : "")
    ),
    jd
      ? [
          h(
            "div",
            { class: "row gap-12", style: { alignItems: "baseline", marginBottom: "14px" } },
            h("span", { class: "big-num" }, F.score10(jd.fitScore)),
            h("span", { class: "faint small" }, jd.fitScore === null ? "no requirement was probed" : "fit score")
          ),
          G.stackBar(
            [
              { value: reqCounts.met, tone: "fit", label: "Met" },
              { value: reqCounts.partial, tone: "consider", label: "Partially met" },
              { value: reqCounts.missing, tone: "reject", label: "Not met" },
              { value: reqCounts.not_discussed, tone: "neutral", label: "Not discussed" },
            ],
            { lg: true }
          ),
          G.legend([
            { tone: "fit", label: "Met", value: reqCounts.met },
            { tone: "consider", label: "Partially met", value: reqCounts.partial },
            { tone: "reject", label: "Not met", value: reqCounts.missing },
            { tone: "neutral", label: "Not discussed", value: reqCounts.not_discussed },
          ]),
        ]
      : h(
          "div",
          { class: "tile-empty" },
          h(
            "div",
            { class: "stack", style: { alignItems: "center" } },
            h("span", null, "No job description was attached, so fit wasn't scored."),
            C.btn({ label: "Attach a job and re-evaluate", size: "sm", onClick: () => reevaluateDialog(rec) })
          )
        )
  );

  // Every question asked
  let questionsSection;
  if (qa) {
    const table = C.dataTable({
      cls: "t-questions",
      caption: "Every question asked",
      columns: [
        { label: "#", cls: "tight c-idx" },
        { label: "Question", cls: "c-q" },
        { label: "Kind", cls: "tight c-kind" },
        { label: "Verdict", cls: "tight c-verdict" },
        { label: "Score", cls: "tight num c-score" },
      ],
      rows: qa.questions,
      rowId: (_, i) => `q-${i + 1}`,
      renderRow: (q, i) => [
        C.td(h("span", { class: "idx" }, String(i + 1)), "tight c-idx"),
        C.td(h("span", { class: "cell-title" }, q.question), "c-q"),
        C.td(h("span", { class: "kind" }, F.KIND[q.kind] ?? q.kind), "tight c-kind"),
        C.td(h("div", { class: "row gap-12" }, C.verdictLabel(q.verdict), h("span", { class: "kind phone-only" }, F.KIND[q.kind] ?? "")), "tight c-verdict"),
        C.td(h("span", { class: "score-cell num" }, F.score10(q.score)), "tight num c-score"),
      ],
      renderDetail: (q) =>
        h(
          "div",
          { class: "detail-grid" },
          h("div", null, h("div", { class: "detail-label" }, "What they said"), h("p", null, q.answerSummary || "—")),
          q.evidence ? h("div", null, h("div", { class: "detail-label" }, "In their words"), C.quote(q.evidence)) : null
        ),
    });
    questionsTable = table;
    const techCount = qa.questions.filter((q) => q.kind === "technical").length;
    questionsSection = C.section(
      { title: "Every question asked", meta: `${qa.questions.length} asked${techCount ? ` · ${techCount} technical` : ""}` },
      qa.summary ? h("p", { class: "muted", style: { marginBottom: "12px" } }, qa.summary) : null,
      table.el
    );
  } else {
    questionsSection = C.section(
      { title: "Every question asked" },
      h("div", { class: "card" }, C.emptyState({ icon: "listChecks", title: "No substantive questions", text: "The recruiter asked only logistical questions, so there were no answers to grade." }))
    );
  }

  // Skills
  const skillsTable = C.dataTable({
    cls: "t-skills",
    caption: "Skills",
    columns: [
      { label: "Skill", cls: "c-name" },
      { label: "Score on a 0–10 scale · ticks at 6.0 and 7.5", cls: "c-bar" },
      { label: "Score", cls: "tight num c-score" },
    ],
    rows: ev.categories,
    renderRow: (c) => [
      C.td(h("span", { class: "cell-title" }, c.name), "c-name"),
      C.td(G.scoreBar(c.score), "c-bar"),
      C.td(
        typeof c.score === "number" ? h("span", { class: "score-cell num" }, F.score10(c.score)) : h("span", { class: "faint small" }, "Not assessed"),
        "tight num c-score"
      ),
    ],
    renderDetail: (c) =>
      h(
        "div",
        { class: "detail-grid" },
        c.summary ? h("div", null, h("div", { class: "detail-label" }, "Summary"), h("p", null, c.summary)) : null,
        c.evidence ? h("div", null, h("div", { class: "detail-label" }, typeof c.score === "number" ? "Evidence" : "Why not assessed"), C.quote(c.evidence)) : null,
        c.recommendation ? h("div", null, h("div", { class: "detail-label" }, "For the next round"), h("p", null, c.recommendation)) : null
      ),
  });

  // Strengths and gaps
  const pcCard = (title, iconName, tone, items, emptyText) =>
    h(
      "div",
      { class: "card" },
      h("div", { class: "pc-head" }, h("span", { class: `tone-${tone}` }, icon(iconName)), h("h3", { class: "h3 grow" }, title), h("span", { class: "faint small" }, String(items.length))),
      items.length
        ? h("ol", { class: "pc-list" }, items.map((t, i) => h("li", null, h("span", { class: "idx" }, String(i + 1)), h("span", null, t))))
        : h("p", { class: "muted", style: { padding: "16px 18px" } }, emptyText)
    );

  // Job requirements
  let reqSection = null;
  if (jd) {
    const reqTable = C.dataTable({
      cls: "t-reqs",
      caption: "Job requirements",
      columns: [
        { label: "Requirement", cls: "c-name" },
        { label: "Verdict", cls: "tight c-verdict" },
        { label: "Evidence", cls: "c-ev" },
      ],
      rows: jd.requirements,
      renderRow: (r) => [
        C.td(h("span", { class: "cell-title" }, r.requirement), "c-name"),
        C.td(C.requirementLabel(r.verdict), "tight c-verdict"),
        C.td(h("span", { class: "muted small" }, r.evidence || "—"), "c-ev"),
      ],
    });
    reqSection = C.section(
      { title: "Job requirements", meta: rec.job ? rec.job.title : null },
      jd.verdictSummary ? h("p", { class: "muted", style: { marginBottom: "12px" } }, jd.verdictSummary) : null,
      reqTable.el
    );
  }

  const page = h(
    "div",
    { class: "page report" },
    !("decision" in sum) ? C.outdatedBanner() : null,
    rec.trashedAt
      ? C.banner({ icon: "trash", text: "This candidate is in the trash. Restore them to use the report in rankings and lists.", actions: [] })
      : null,
    heroEl,
    C.section({ title: "At a glance", cls: "glance" }, h("div", { class: "quick", style: { marginTop: "0" } }, techTile, answersTile, skillsTile, fitTile)),
    questionsSection,
    C.section({ title: "Skills", meta: `${assessed} of ${ev.categories.length} assessed` }, skillsTable.el),
    C.section(
      { title: "Strengths and gaps" },
      h(
        "div",
        { class: "pros-cons" },
        pcCard("Strengths", "checkCircle", "fit", ev.strengths, "None noted."),
        pcCard("Gaps to probe", "alertCircle", "consider", ev.areasForImprovement, "None noted.")
      )
    ),
    reqSection,
    C.section({ title: "Recording and transcript" }, recordingCard(rec, signal)),
    C.section({ title: "Details" }, detailsCard(rec)),
    h("div", { style: { height: "24px" } })
  );

  mount(
    main,
    C.topbar({
      title: F.displayName(rec),
      back: "#/candidates",
      crumbs: crumbsFor(rec),
      actions: [
        C.iconBtn({ icon: "printer", label: "Export PDF", onClick: () => window.print(), cls: "laptop-only" }),
        C.moreMenu(() => overflowItems(main, rec, signal), { bordered: false }),
      ],
    }),
    page
  );

  // The decision stays one thumb away on phones.
  setActionBar(h("div", { class: "actionbar" }, decisionActions(main, rec, signal, { phone: true })));
}

// ── Recording + transcript ───────────────────────────────────────────
function parseTranscript(t) {
  if (!t) return [];
  if (Array.isArray(t.segments) && t.segments.length) return t.segments.map((s) => ({ ...s }));
  const lines = t.text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const m = /^Speaker\s+([^:]{1,20}):\s*(.*)$/i.exec(line);
    if (m) out.push({ speaker: m[1].trim(), text: m[2], start: null, end: null });
    else if (out.length && !/^Speaker/i.test(line)) out[out.length - 1].text += " " + line;
    else out.push({ speaker: "", text: line, start: null, end: null });
  }
  return out;
}

/** Who is the recruiter? The speaker who asks the most questions, usually. */
function speakerNames(segments, swapped) {
  const speakers = [...new Set(segments.map((s) => s.speaker).filter(Boolean))];
  if (speakers.length !== 2) return (sp) => (sp ? `Speaker ${sp}` : "");
  const questions = (sp) => segments.filter((s) => s.speaker === sp).reduce((n, s) => n + (s.text.match(/\?/g)?.length ?? 0), 0);
  let [recruiter, candidate] = questions(speakers[0]) >= questions(speakers[1]) ? speakers : [speakers[1], speakers[0]];
  if (swapped) [recruiter, candidate] = [candidate, recruiter];
  return (sp) => (sp === recruiter ? "Recruiter" : sp === candidate ? "Candidate" : `Speaker ${sp}`);
}

function recordingCard(rec, signal) {
  const segments = parseTranscript(rec.transcript);
  const timed = segments.some((s) => typeof s.start === "number");
  let swapped = false;
  let audio = null;
  let audioUrl = null;
  let query = "";

  signal.addEventListener("abort", () => {
    audio?.pause();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  });

  const playerSlot = h("div", { class: "player" });
  const loadBtn = C.btn({ label: "Load recording", icon: "play", size: "sm" });
  mount(
    playerSlot,
    loadBtn,
    h("span", { class: "faint small grow truncate", title: rec.originalFilename }, `${F.fmtDuration(rec.durationSeconds)} · ${rec.originalFilename}`)
  );

  async function ensureAudio() {
    if (audio) return audio;
    await C.busy(loadBtn, async () => {
      try {
        audioUrl = await fetchAudioUrl(rec.id, signal);
        audio = h("audio", { controls: true, preload: "metadata", src: audioUrl });
        audio.addEventListener("timeupdate", markCurrent);
        mount(playerSlot, audio);
      } catch (err) {
        if (err?.name !== "AbortError") C.toast(err.message, { tone: "reject" });
      }
    }, "Loading…");
    return audio;
  }
  loadBtn.addEventListener("click", () => ensureAudio().then((a) => a?.play()));

  const list = h("div", { class: "transcript", role: "list" });
  const counter = h("span", { class: "faint small" });

  function render() {
    const name = speakerNames(segments, swapped);
    const q = query.toLowerCase();
    let matches = 0;
    const rows = segments
      .map((seg, i) => ({ seg, i }))
      .filter(({ seg }) => !q || seg.text.toLowerCase().includes(q))
      .map(({ seg, i }) => {
        if (q) matches++;
        const label = name(seg.speaker);
        const textNode = q ? highlight(seg.text, q) : seg.text;
        const inner = [
          h("span", { class: "tline-meta" }, h("span", { class: "tline-time" }, timed ? F.fmtClock(seg.start) : ""), h("span", { class: ["tline-speaker", label === "Candidate" && "is-candidate"] }, label)),
          h("span", { class: "tline-text" }, textNode),
        ];
        return typeof seg.start === "number"
          ? h("button", { class: "tline", type: "button", role: "listitem", dataset: { i: String(i) }, onClick: () => seek(seg.start) }, inner)
          : h("div", { class: "tline", role: "listitem", dataset: { i: String(i) } }, inner);
      });
    mount(list, rows.length ? rows : h("p", { class: "muted", style: { padding: "16px" } }, q ? "No line matches that search." : "No transcript was stored for this call."));
    counter.textContent = q ? F.plural(matches, "match", "matches") : timed ? "Click a line to play from it" : "";
  }

  async function seek(t) {
    const a = await ensureAudio();
    if (!a) return;
    a.currentTime = Math.max(0, t - 0.4);
    a.play();
  }

  function markCurrent() {
    if (!audio || !timed) return;
    const t = audio.currentTime;
    let current = -1;
    segments.forEach((s, i) => {
      if (typeof s.start === "number" && s.start <= t) current = i;
    });
    list.querySelectorAll(".tline.is-current").forEach((n) => n.classList.remove("is-current"));
    const el = list.querySelector(`.tline[data-i="${current}"]`);
    if (el) el.classList.add("is-current");
  }

  const search = h("input", {
    class: "input",
    type: "search",
    placeholder: "Search the transcript",
    "aria-label": "Search the transcript",
    onInput: (e) => {
      query = e.target.value.trim();
      render();
    },
  });
  render();

  const speakersKnown = new Set(segments.map((s) => s.speaker).filter(Boolean)).size === 2;
  return h(
    "div",
    { class: "card" },
    playerSlot,
    segments.length
      ? h(
          "div",
          { class: "transcript-tools" },
          h("div", { class: "input-wrap grow", style: { maxWidth: "360px" } }, icon("search"), search),
          counter,
          speakersKnown
            ? C.btn({
                label: "Swap speakers",
                icon: "refresh",
                size: "sm",
                variant: "ghost",
                onClick: () => {
                  swapped = !swapped;
                  render();
                },
              })
            : null
        )
      : null,
    list
  );
}

function highlight(text, q) {
  const out = [];
  const lower = text.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(q, i);
    if (at < 0) {
      out.push(text.slice(i));
      break;
    }
    if (at > i) out.push(text.slice(i, at));
    out.push(h("mark", null, text.slice(at, at + q.length)));
    i = at + q.length;
  }
  return out;
}

function detailsCard(rec) {
  const ev = rec.evaluation;
  const row = (k, v) => [h("dt", null, k), h("dd", null, v ?? "—")];
  return h(
    "div",
    { class: "card card-pad" },
    h(
      "dl",
      { class: "kv" },
      row("Candidate", rec.candidateName || "—"),
      row("Phone", rec.phoneNumber || "—"),
      row("Job", rec.job ? h("a", { href: `#/jobs/${rec.job.id}` }, rec.job.title) : "None — scored without a job description"),
      row("Recording", rec.originalFilename),
      row("Call length", F.fmtDuration(rec.durationSeconds)),
      row("Uploaded", F.fmtDateTime(rec.importedAt)),
      row("Evaluated", ev ? F.fmtDateTime(ev.createdAt) : "—"),
      row("Classified as", ev ? `${ev.department} › ${ev.subCategory} (${ev.classificationConfidence} confidence)` : "—"),
      row("Why", ev?.classificationRationale || "—"),
      row("Scoring instructions", rec.customInstructions || "None"),
      row("Scored by", ev?.model || "—")
    )
  );
}

// ── In progress ──────────────────────────────────────────────────────
const STEP_ORDER = ["UPLOADED", "TRANSCRIBING", "SCORING", "DONE"];

function drawProgress(main, rec, signal) {
  setActionBar(null);
  // Index of the step in progress: queued and transcribing both sit on step 1.
  const reached = rec.status === "SCORING" ? 2 : 1;
  const steps = [
    { title: "Uploaded", sub: rec.originalFilename },
    { title: "Transcribing the call", sub: "The slow step — a long call takes a few minutes." },
    { title: "Scoring the answers", sub: "Grading every question the recruiter asked." },
    { title: "Report ready", sub: "Opens here automatically." },
  ];
  const started = Date.now();
  const elapsed = h("span", { class: "faint small num" }, "");
  const startSlot = h("div");

  const stepEls = steps.map((s, i) => {
    const done = i < reached;
    const activeStep = i === reached;
    return h(
      "div",
      { class: ["step", done && "is-done", activeStep && "is-active"] },
      h("span", { class: "step-dot" }, done ? icon("check") : activeStep ? C.spinner() : h("span", null, String(i + 1))),
      h("div", null, h("div", { class: "step-title" }, s.title), h("div", { class: "step-sub" }, i === 1 && rec.status === "UNEVALUATED" ? "Waiting to start…" : s.sub))
    );
  });

  mount(
    main,
    C.topbar({ title: F.displayName(rec), back: "#/candidates", crumbs: crumbsFor(rec) }),
    h(
      "div",
      { class: "page page-narrow" },
      h(
        "div",
        { class: "card progress-card" },
        h("div", { class: "row", style: { justifyContent: "center" } }, C.spinner("lg")),
        h("h2", { class: "h2 mt-16" }, `Evaluating ${F.displayName(rec)}`),
        h("p", { class: "muted mt-8" }, "You can leave this page — the report will be waiting under Candidates."),
        h("div", { class: "steps" }, stepEls),
        h("div", { class: "row", style: { justifyContent: "center" } }, elapsed),
        startSlot
      )
    )
  );

  const tick = setInterval(() => {
    const secs = Math.round((Date.now() - started) / 1000);
    elapsed.textContent = `Watching for ${secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${secs % 60} s`}`;
    // A recording left queued usually means the start request never landed.
    if (rec.status === "UNEVALUATED" && secs === 15 && !startSlot.firstChild) {
      const b = C.btn({ label: "Start evaluation", icon: "play", variant: "primary" });
      b.addEventListener("click", () =>
        C.busy(b, async () => {
          try {
            await Recordings.evaluate(rec.id);
            invalidateRecordings();
          } catch (err) {
            C.toast(err.message, { tone: "reject" });
          }
        })
      );
      mount(startSlot, h("div", { class: "mt-16" }, h("p", { class: "faint small" }, "Still queued — start it manually if it doesn't move."), h("div", { class: "mt-8" }, b)));
    }
  }, 1000);

  const poll = setInterval(async () => {
    try {
      const next = await Recordings.get(rec.id, { signal });
      if (next.status !== rec.status) {
        clearInterval(poll);
        clearInterval(tick);
        invalidateRecordings();
        if (next.status === "EVALUATED") C.toast("Report ready", { tone: "fit" });
        draw(main, next, signal);
      }
    } catch (err) {
      if (err?.name === "AbortError") clearInterval(poll);
    }
  }, 2500);
  signal.addEventListener("abort", () => {
    clearInterval(poll);
    clearInterval(tick);
  });
}

// ── Failed ───────────────────────────────────────────────────────────
function drawFailed(main, rec, signal) {
  setActionBar(null);
  const retry = C.btn({ label: "Try again", icon: "rotate", variant: "primary" });
  retry.addEventListener("click", () =>
    C.busy(retry, async () => {
      try {
        await Recordings.evaluate(rec.id);
        invalidateRecordings();
        refresh();
      } catch (err) {
        C.toast(err.message, { tone: "reject" });
      }
    }, "Starting…")
  );
  mount(
    main,
    C.topbar({
      title: F.displayName(rec),
      back: "#/candidates",
      crumbs: crumbsFor(rec),
      actions: [C.moreMenu(() => overflowItems(main, rec, signal), { bordered: false })],
    }),
    h(
      "div",
      { class: "page page-narrow" },
      rec.trashedAt ? C.banner({ icon: "trash", text: "This candidate is in the trash." }) : null,
      h(
        "div",
        { class: "card" },
        C.emptyState({
          icon: "alertTriangle",
          title: "This evaluation failed",
          text: rec.errorMessage || "The server didn't say why.",
          action: h("div", { class: "row row-wrap", style: { justifyContent: "center" } }, retry, C.btn({ label: "Change job or instructions…", onClick: () => reevaluateDialog(rec) })),
        })
      ),
      C.section({ title: "Details" }, detailsCard(rec))
    )
  );
}
