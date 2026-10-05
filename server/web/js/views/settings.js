/**
 * Settings, saved instructions, and usage and costs.
 */

import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { API_ROOT, Costs, Presets, clearKey, getKey, health } from "../api.js";
import { navigate } from "../router.js";
import { setActive, syncThemeButton } from "../shell.js";
import { applyTheme, getThemePref, setThemePref } from "../theme.js";
import * as C from "../components.js";
import * as F from "../format.js";
import { changeKeyDialog } from "./key.js";

const MAX_INSTRUCTIONS = 2000;

export async function settingsView({ signal, main }) {
  setActive("settings");
  const key = getKey();
  const serverStatus = h("span", { class: "faint" }, "Checking…");

  const row = (title, sub, control) =>
    h("div", { class: "setting-row" }, h("div", { class: "grow" }, h("div", { class: "strong" }, title), sub ? h("div", { class: "faint small mt-4" }, sub) : null), control);

  const card = (title, ...rows) => h("div", { class: "card" }, h("div", { class: "card-head" }, h("h2", { class: "card-title" }, title)), rows);

  mount(
    main,
    C.topbar({ title: "Settings" }),
    h(
      "div",
      { class: "page page-mid" },
      h("div", { class: "intro not-phone" }, h("div", null, h("h2", { class: "h1" }, "Settings"), h("p", null, "Access, appearance and the workspace's shared tools."))),
      h(
        "div",
        { class: "settings" },
        card(
          "Access",
          row(
            "Access key",
            key ? `Signed in with a key ending in ${key.slice(-4)}.` : "No key stored.",
            h("div", { class: "row" }, C.btn({ label: "Change key", icon: "key", size: "sm", onClick: () => changeKeyDialog() }))
          ),
          row(
            "Sign out of this device",
            "Removes the key from this browser. You'll need it again to get back in.",
            C.btn({
              label: "Sign out",
              icon: "logOut",
              size: "sm",
              variant: "danger",
              onClick: async () => {
                const ok = await C.confirm({ title: "Sign out?", text: "The access key is removed from this browser.", confirmLabel: "Sign out", tone: "danger" });
                if (!ok) return;
                clearKey();
                location.hash = "#/key";
                location.reload();
              },
            })
          )
        ),
        card(
          "Appearance",
          row(
            "Theme",
            "Light is the default. System follows your device.",
            C.seg({
              label: "Theme",
              value: getThemePref(),
              options: [
                { value: "light", label: "Light", icon: "sun" },
                { value: "dark", label: "Dark", icon: "moon" },
                { value: "system", label: "System", icon: "monitor" },
              ],
              onChange: (v) => {
                setThemePref(v);
                applyTheme();
                syncThemeButton();
              },
            })
          )
        ),
        card(
          "Workspace",
          h("a", { class: "setting-row", href: "#/settings/instructions", style: { color: "inherit", textDecoration: "none" } }, h("div", { class: "grow" }, h("div", { class: "strong" }, "Saved instructions"), h("div", { class: "faint small mt-4" }, "Reusable scoring steers to pick when evaluating a call.")), icon("chevronRight")),
          h("a", { class: "setting-row", href: "#/settings/costs", style: { color: "inherit", textDecoration: "none" } }, h("div", { class: "grow" }, h("div", { class: "strong" }, "Usage and costs"), h("div", { class: "faint small mt-4" }, "What each evaluation cost, traced per candidate.")), icon("chevronRight"))
        ),
        card("Server", row("API", h("span", { class: "mono" }, API_ROOT), serverStatus))
      )
    )
  );

  try {
    const hres = await health();
    if (signal.aborted) return;
    mount(serverStatus, h("span", { class: "row", style: { color: hres.mockAi ? "var(--consider)" : "var(--fit)" } }, h("span", { class: "dot" }), hres.mockAi ? "Connected · mock scoring (no real AI)" : "Connected · AI scoring live"));
  } catch {
    mount(serverStatus, h("span", { class: "row tone-reject" }, h("span", { class: "dot" }), "Unreachable"));
  }
}

// ── Saved instructions ───────────────────────────────────────────────
export async function instructionsView({ signal, main }) {
  setActive("instructions");
  const header = C.topbar({ title: "Saved instructions", back: "#/settings", crumbs: [{ label: "Settings", href: "#/settings" }, { label: "Saved instructions" }] });
  mount(main, header, h("div", { class: "page page-mid" }, C.skelBlock(260)));
  let presets;
  try {
    presets = await Presets.list({ signal });
  } catch (err) {
    if (err?.name === "AbortError") return;
    mount(main, header, h("div", { class: "page page-mid" }, C.errorState(err)));
    return;
  }
  if (signal.aborted) return;

  const listEl = h("div");
  mount(
    main,
    header,
    h(
      "div",
      { class: "page page-mid" },
      h(
        "div",
        { class: "intro" },
        h("div", null, h("h2", { class: "h1" }, "Saved instructions"), h("p", null, "Reusable steers for scoring. Picking one fills the instructions box — each evaluation keeps its own copy.")),
        C.btn({ label: "New instructions", icon: "plus", variant: "primary", onClick: () => editPreset() })
      ),
      listEl
    )
  );
  draw();

  function draw() {
    if (!presets.length) {
      mount(listEl, h("div", { class: "card" }, C.emptyState({ icon: "sliders", title: "No saved instructions", text: "Save a steer you use often — “focus on the technical questions”, “junior role” — and pick it when you evaluate.", action: C.btn({ label: "New instructions", icon: "plus", variant: "primary", onClick: () => editPreset() }) })));
      return;
    }
    mount(
      listEl,
      h(
        "div",
        { class: "card" },
        presets.map((p) =>
          h(
            "div",
            { class: "preset" },
            h("div", { class: "strong" }, p.label),
            h(
              "div",
              { class: "row" },
              C.iconBtn({ icon: "edit", label: `Edit ${p.label}`, size: "sm", onClick: () => editPreset(p) }),
              C.iconBtn({
                icon: "trash",
                label: `Delete ${p.label}`,
                size: "sm",
                onClick: async () => {
                  const ok = await C.confirm({ title: `Delete “${p.label}”?`, text: "Past evaluations keep the text they were scored with.", confirmLabel: "Delete", tone: "danger" });
                  if (!ok) return;
                  try {
                    await Presets.remove(p.id);
                    presets = presets.filter((x) => x.id !== p.id);
                    draw();
                    C.toast("Deleted");
                  } catch (err) {
                    C.toast(err.message, { tone: "reject" });
                  }
                },
              })
            ),
            h("div", { class: "preset-text" }, p.text)
          )
        )
      )
    );
  }

  function editPreset(p) {
    const label = h("input", { class: "input", id: "pr-label", maxlength: "80", value: p?.label ?? "", placeholder: "e.g. Technical focus" });
    const text = h("textarea", { class: "textarea", id: "pr-text", rows: "6", maxlength: String(MAX_INSTRUCTIONS), placeholder: "e.g. Focus on the technical questions asked in the call" });
    text.value = p?.text ?? "";
    const save = C.btn({ label: p ? "Save" : "Create", variant: "primary" });
    const d = C.dialog({
      title: p ? "Edit instructions" : "New instructions",
      wide: true,
      body: h("div", { class: "stack gap-16" }, C.field({ label: "Name", id: "pr-label" }, label), C.field({ label: "Instructions", id: "pr-text", hint: `Up to ${MAX_INSTRUCTIONS} characters. Steers emphasis; the evidence rules always apply.` }, text)),
      actions: [C.btn({ label: "Cancel", onClick: () => d.close() }), save],
    });
    save.addEventListener("click", () =>
      C.busy(save, async () => {
        const body = { label: label.value.trim(), text: text.value.trim() };
        if (!body.label || !body.text) return C.toast("Give it a name and some instructions", { tone: "reject" });
        try {
          const saved = p ? await Presets.update(p.id, body) : await Presets.create(body);
          presets = p ? presets.map((x) => (x.id === p.id ? saved : x)) : [saved, ...presets];
          d.close();
          draw();
          C.toast(p ? "Saved" : "Created", { tone: "fit" });
        } catch (err) {
          C.toast(err.message, { tone: "reject" });
        }
      })
    );
  }
}

// ── Usage and costs ──────────────────────────────────────────────────
export async function costsView({ signal, main }) {
  setActive("costs");
  const header = C.topbar({ title: "Usage and costs", back: "#/settings", crumbs: [{ label: "Settings", href: "#/settings" }, { label: "Usage and costs" }] });
  mount(main, header, h("div", { class: "page page-mid" }, h("div", { class: "stack gap-16" }, h("div", { class: "kpis" }, [0, 1].map(() => h("div", { class: "card kpi" }, C.skelLine("50%"), C.skelLine("30%", 28)))), C.skelBlock(160), C.skelTable(5, 4))));

  let c;
  try {
    c = await Costs.get(50, { signal });
  } catch (err) {
    if (err?.name === "AbortError") return;
    mount(main, header, h("div", { class: "page page-mid" }, C.errorState(err)));
    return;
  }
  if (signal.aborted) return;
  const page = (...children) => mount(main, header, h("div", { class: "page page-mid" }, h("div", { class: "intro" }, h("div", null, h("h2", { class: "h1" }, "Usage and costs"), h("p", null, "What each evaluation cost, priced from the traced model calls."))), children));

  if (!c.configured) {
    return page(
      h(
        "div",
        { class: "card card-pad stack gap-12" },
        h("h3", { class: "h3" }, "Cost tracing is off"),
        h("p", { class: "muted" }, "Add Langfuse keys to server/.env and restart the server; every evaluation from then on is priced here."),
        h("pre", { class: "quote mono", style: { fontStyle: "normal", whiteSpace: "pre-wrap" } }, 'LANGFUSE_PUBLIC_KEY="pk-lf-…"\nLANGFUSE_SECRET_KEY="sk-lf-…"\nLANGFUSE_BASE_URL="https://cloud.langfuse.com"'),
        C.note("info", "Only model names, token counts and timings are sent. Interview content stays on your server unless you turn it on explicitly.")
      )
    );
  }
  if (c.error) return page(C.banner({ icon: "alertTriangle", tone: "reject", text: `Couldn't read costs: ${c.error}` }), C.note("info", "Evaluations are unaffected — this screen only reads from the tracing backend."));
  if (!c.calls.length) return page(h("div", { class: "card" }, C.emptyState({ icon: "coins", title: "No traced evaluations yet", text: "Evaluate a call and its cost appears here." })));

  const kpis = h(
    "div",
    { class: "kpis", style: { gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" } },
    h("div", { class: "card kpi" }, h("span", { class: "kpi-label" }, icon("coins"), "Total"), h("span", { class: "kpi-value" }, F.money(c.totalCost)), h("span", { class: "kpi-sub" }, `last ${F.plural(c.calls.length, "evaluation")}`)),
    h("div", { class: "card kpi" }, h("span", { class: "kpi-label" }, icon("barChart"), "Average per call"), h("span", { class: "kpi-value" }, c.averageCost === null ? "—" : F.money(c.averageCost)))
  );

  const max = Math.max(...c.byStage.map((s) => s.cost), 0.0001);
  const stages = c.byStage.length
    ? h(
        "div",
        { class: "card", style: { marginTop: "16px" } },
        h("div", { class: "card-head" }, h("h3", { class: "card-title" }, "Where the money goes")),
        h(
          "div",
          { class: "card-pad stack gap-16" },
          c.byStage.map((s) =>
            h(
              "div",
              { class: "stack gap-4" },
              h("div", { class: "row row-between" }, h("span", { class: "strong" }, s.name), h("span", { class: "strong num" }, s.unpriced ? "—" : F.money(s.cost))),
              h("div", { class: "bar" }, h("div", { class: "bar-fill", style: { width: `${s.unpriced ? 0 : Math.max(2, (s.cost / max) * 100)}%` } })),
              h(
                "span",
                { class: "faint xsmall" },
                [F.plural(s.calls, "call"), s.inputTokens || s.outputTokens ? `${(s.inputTokens ?? 0).toLocaleString()} in → ${(s.outputTokens ?? 0).toLocaleString()} out tokens` : null, s.derived ? "priced from tokens here" : null].filter(Boolean).join(" · ")
              )
            )
          ),
          c.byStage.some((s) => s.unpriced) ? C.note("alertTriangle", `${c.byStage.filter((s) => s.unpriced).map((s) => s.name).join(", ")} couldn't be priced: no token counts were recorded for it.`) : null
        )
      )
    : null;

  const table = C.dataTable({
    cls: "t-costs",
    caption: "Cost per candidate",
    columns: [
      { label: "Candidate", cls: "c-name" },
      { label: "Job", cls: "c-job" },
      { label: "Date", cls: "tight c-date" },
      { label: "Audio", cls: "tight num c-len" },
      { label: "Cost", cls: "tight num c-cost" },
      { label: "", cls: "c-meta phone-meta" },
    ],
    rows: c.calls,
    onRowClick: (call) => call.recordingId && navigate(`/candidates/${call.recordingId}`),
    renderRow: (call) => [
      C.td(h("span", { class: "cell-title" }, call.candidateName || "Untitled recording"), "c-name"),
      C.td(call.jobTitle ?? h("span", { class: "faint" }, "—"), "c-job"),
      C.td(F.fmtDate(call.at), "tight c-date"),
      C.td(call.audioMinutes ? `${call.audioMinutes} min` : "—", "tight num c-len"),
      C.td(h("span", { class: "strong num" }, call.cost > 0 ? F.money(call.cost) : "—"), "tight num c-cost"),
      C.td(h("span", { class: "cell-sub" }, [call.jobTitle, F.fmtDate(call.at), call.audioMinutes ? `${call.audioMinutes} min audio` : null].filter(Boolean).join(" · ")), "c-meta phone-meta"),
    ],
  });

  page(kpis, stages, C.section({ title: "Per candidate" }, table.el));
}
