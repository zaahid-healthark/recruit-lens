/**
 * The app shell: one navigation definition, three containers.
 *
 *   phone  (< 600 px)   bottom bar, Evaluate in the centre
 *   tablet (600–1023)   navigation rail
 *   laptop (>= 1024)    grouped sidebar with the candidate views listed
 *
 * The destinations are the same in all three, so moving between devices never
 * moves where anything lives — only the container changes.
 */

import { h } from "./dom.js";
import { icon } from "./icons.js";
import { btn, setToastHost } from "./components.js";
import { getRecordings, onRecordings } from "./api.js";
import { needsAttention } from "./format.js";
import { applyTheme, getThemePref, setThemePref } from "./theme.js";

export const CANDIDATE_VIEWS = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs attention", badge: true },
  { id: "fit", label: "Fit" },
  { id: "consider", label: "Consider" },
  { id: "next", label: "Next round", badge: true },
];

const PRIMARY = [
  { id: "home", label: "Home", href: "#/", icon: "home" },
  { id: "candidates", label: "Candidates", href: "#/candidates", icon: "users" },
  { id: "evaluate", label: "Evaluate", href: "#/evaluate", icon: "plus", primary: true },
  { id: "jobs", label: "Jobs", href: "#/jobs", icon: "briefcase" },
  { id: "settings", label: "Settings", href: "#/settings", icon: "settings" },
];

let els = null;

export function mountShell(root) {
  const main = h("main", { class: "main", id: "main", tabindex: "-1" });
  const toasts = h("div", { class: "toasts", "aria-live": "polite" });
  setToastHost(toasts);

  const badges = {};
  const badge = (id) => (badges[id] = h("span", { class: "nav-badge", hidden: true }));

  const navLink = (id, label, href, iconName) =>
    h("a", { class: "nav-item", href, dataset: { nav: id } }, icon(iconName), h("span", null, label));

  const themeBtn = h(
    "button",
    { class: "nav-item", type: "button", onClick: cycleTheme, dataset: { nav: "theme" } },
    icon("sun"),
    h("span", { class: "theme-label" }, "Theme")
  );

  const sidebar = h(
    "aside",
    { class: "sidebar", "aria-label": "Main" },
    h(
      "a",
      { class: "sidebar-brand", href: "#/", "aria-label": "RecruitLens home" },
      h("span", { class: "brand-logo", role: "img", "aria-label": "Healthark" }),
      h("span", { class: "brand-sep", "aria-hidden": "true" }),
      h("span", { class: "brand-name" }, "RecruitLens")
    ),
    btn({ label: "Evaluate a call", icon: "plus", variant: "primary", href: "#/evaluate", block: true, cls: "sidebar-cta" }),
    h("div", { class: "nav-group-label" }, "Screening"),
    navLink("home", "Home", "#/", "home"),
    navLink("candidates", "Candidates", "#/candidates", "users"),
    h(
      "div",
      { class: "nav-sub" },
      CANDIDATE_VIEWS.map((v) =>
        h(
          "a",
          { class: "nav-subitem", href: v.id === "all" ? "#/candidates" : `#/candidates?view=${v.id}`, dataset: { sub: v.id } },
          h("span", { class: "grow" }, v.label),
          v.badge ? badge(v.id) : null
        )
      )
    ),
    navLink("jobs", "Jobs", "#/jobs", "briefcase"),
    h("div", { class: "nav-group-label" }, "Workspace"),
    navLink("instructions", "Saved instructions", "#/settings/instructions", "sliders"),
    navLink("costs", "Usage and costs", "#/settings/costs", "coins"),
    h("div", { class: "sidebar-foot" }, navLink("settings", "Settings", "#/settings", "settings"), themeBtn)
  );

  const rail = h(
    "nav",
    { class: "rail", "aria-label": "Main" },
    PRIMARY.map((p) =>
      h(
        "a",
        { class: ["rail-item", p.primary && "is-primary"], href: p.href, dataset: { nav: p.id } },
        h("span", { class: "rail-icon" }, icon(p.icon)),
        h("span", { class: "rail-label" }, p.label)
      )
    )
  );

  const bottombar = h(
    "nav",
    { class: "bottombar", "aria-label": "Main" },
    PRIMARY.map((p) =>
      h(
        "a",
        { class: ["tab", p.primary && "is-primary"], href: p.href, dataset: { nav: p.id } },
        h("span", { class: "tab-icon" }, icon(p.icon)),
        h("span", { class: "tab-label" }, p.label)
      )
    )
  );

  const app = h("div", { class: "app" }, sidebar, rail, main, bottombar, toasts);
  root.replaceChildren(app);
  els = { main, sidebar, rail, bottombar, badges, themeBtn };
  syncThemeButton();

  onRecordings(updateBadges);
  getRecordings().catch(() => {});
  return { main };
}

function updateBadges(list) {
  if (!els) return;
  const live = list.filter((r) => !r.trashedAt);
  const counts = {
    attention: live.filter(needsAttention).length,
    next: live.filter((r) => r.shortlistedAt).length,
  };
  for (const [id, el] of Object.entries(els.badges)) {
    const n = counts[id] ?? 0;
    el.textContent = String(n);
    el.hidden = n === 0;
  }
}

/** Mark the current destination in every container. */
export function setActive(nav, sub) {
  if (!els) return;
  // Saved instructions and costs live under Settings on the rail and the
  // bottom bar, where there is no room to list them separately.
  const compact = nav === "instructions" || nav === "costs" ? "settings" : nav;
  for (const container of [els.sidebar, els.rail, els.bottombar]) {
    const target = container === els.sidebar ? nav : compact;
    container.querySelectorAll("[data-nav]").forEach((a) => {
      const on = a.dataset.nav === target;
      a.classList.toggle("is-active", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }
  els.sidebar.querySelectorAll("[data-sub]").forEach((a) => {
    a.classList.toggle("is-active", nav === "candidates" && a.dataset.sub === sub);
  });
}

/** The fixed action bar some screens show on phones in place of the tab bar. */
export function setActionBar(node) {
  document.querySelectorAll(".actionbar").forEach((n) => n.remove());
  document.body.classList.toggle("has-actionbar", !!node);
  if (node) document.body.append(node);
}

export function mainEl() {
  return els?.main;
}

function cycleTheme() {
  const order = ["light", "dark", "system"];
  const next = order[(order.indexOf(getThemePref()) + 1) % order.length];
  setThemePref(next);
  applyTheme();
  syncThemeButton();
}

export function syncThemeButton() {
  if (!els) return;
  const pref = getThemePref();
  const name = pref === "dark" ? "moon" : pref === "system" ? "monitor" : "sun";
  const label = pref === "dark" ? "Dark theme" : pref === "system" ? "System theme" : "Light theme";
  els.themeBtn.replaceChildren(icon(name), h("span", { class: "theme-label" }, label));
}
