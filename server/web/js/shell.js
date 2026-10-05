/**
 * The app shell: one navigation definition, three containers.
 *
 *   phone  (< 600 px)   bottom bar, Evaluate in the centre, plus a slide-out menu
 *   tablet (600–1023)   navigation rail
 *   laptop (>= 1024)    grouped sidebar
 *
 * The destinations are the same in all three, so moving between devices never
 * moves where anything lives — only the container changes. Below 1024 px the
 * laptop sidebar becomes the slide-out menu, so there is one menu to keep
 * right, not two.
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

const SUB_OPEN_KEY = "recruitlens.nav.candidatesOpen";
const readSubOpen = () => {
  try {
    return localStorage.getItem(SUB_OPEN_KEY) === "1";
  } catch {
    return false;
  }
};
const writeSubOpen = (open) => {
  try {
    localStorage.setItem(SUB_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* private browsing */
  }
};

let els = null;

export function mountShell(root) {
  const main = h("main", { class: "main", id: "main", tabindex: "-1" });
  const toasts = h("div", { class: "toasts", "aria-live": "polite" });
  setToastHost(toasts);

  const badges = {};
  const badge = (id) => (badges[id] = h("span", { class: "nav-badge", hidden: true }));

  const navLink = (id, label, href, iconName, extra) =>
    h("a", { class: "nav-item", href, dataset: { nav: id } }, icon(iconName), h("span", { class: "grow" }, label), extra ?? null);

  // Candidates: a link to All, with its views folded away until asked for.
  let subOpen = readSubOpen();
  const candidatesBadge = badge("candidates");
  const sub = h(
    "div",
    { class: "nav-sub", id: "nav-candidate-views", hidden: !subOpen },
    CANDIDATE_VIEWS.map((v) =>
      h(
        "a",
        { class: "nav-subitem", href: v.id === "all" ? "#/candidates" : `#/candidates?view=${v.id}`, dataset: { sub: v.id } },
        h("span", { class: "grow" }, v.label),
        v.badge ? badge(v.id) : null
      )
    )
  );
  const subToggle = h(
    "button",
    {
      class: "nav-toggle",
      type: "button",
      "aria-controls": "nav-candidate-views",
      "aria-expanded": String(subOpen),
      "aria-label": subOpen ? "Hide candidate views" : "Show candidate views",
      onClick: () => {
        subOpen = !subOpen;
        writeSubOpen(subOpen);
        sub.hidden = !subOpen;
        subToggle.setAttribute("aria-expanded", String(subOpen));
        subToggle.setAttribute("aria-label", subOpen ? "Hide candidate views" : "Show candidate views");
        updateBadges(lastList);
      },
    },
    icon("chevronDown")
  );

  const themeBtn = h("button", { class: "nav-toggle", type: "button", onClick: cycleTheme });

  const sidebar = h(
    "aside",
    { class: "sidebar", id: "sidebar", "aria-label": "Main" },
    h(
      "a",
      { class: "sidebar-brand", href: "#/", "aria-label": "RecruitLens home" },
      h("span", { class: "brand-logo", role: "img", "aria-label": "Healthark" }),
      h("span", { class: "brand-name" }, "RecruitLens")
    ),
    btn({ label: "Evaluate a call", icon: "plus", variant: "primary", href: "#/evaluate", block: true, cls: "sidebar-cta" }),
    h("div", { class: "nav-group-label" }, "Screening"),
    navLink("home", "Home", "#/", "home"),
    h("div", { class: "nav-row" }, navLink("candidates", "Candidates", "#/candidates", "users", candidatesBadge), subToggle),
    sub,
    navLink("jobs", "Jobs", "#/jobs", "briefcase"),
    h("div", { class: "nav-group-label" }, "Workspace"),
    navLink("instructions", "Saved instructions", "#/settings/instructions", "sliders"),
    navLink("costs", "Usage and costs", "#/settings/costs", "coins"),
    h("div", { class: "sidebar-foot" }, h("div", { class: "nav-row" }, navLink("settings", "Settings", "#/settings", "settings"), themeBtn))
  );

  const scrim = h("div", { class: "scrim", "aria-hidden": "true", onClick: closeDrawer });

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

  const app = h("div", { class: "app" }, sidebar, scrim, rail, main, bottombar, toasts);
  root.replaceChildren(app);
  els = { main, sidebar, rail, bottombar, badges, themeBtn };
  syncThemeButton();

  // Any link inside the menu closes it, so the page underneath is what shows.
  sidebar.addEventListener("click", (e) => {
    if (e.target.closest("a")) closeDrawer();
  });

  onRecordings(updateBadges);
  getRecordings().catch(() => {});
  return { main };
}

// ── Slide-out menu (phones) ──────────────────────────────────────────
let lastFocus = null;
let lastList = [];

function openDrawer() {
  if (!els || document.body.classList.contains("drawer-open")) return;
  lastFocus = document.activeElement;
  document.body.classList.add("drawer-open");
  document.body.style.overflow = "hidden";
  els.sidebar.setAttribute("role", "dialog");
  els.sidebar.setAttribute("aria-modal", "true");
  els.sidebar.scrollLeft = 0;
  requestAnimationFrame(() => els.sidebar.querySelector(".nav-item.is-active, .nav-item")?.focus({ preventScroll: true }));
}

export function closeDrawer() {
  if (!els || !document.body.classList.contains("drawer-open")) return;
  document.body.classList.remove("drawer-open");
  document.body.style.overflow = "";
  els.sidebar.removeAttribute("role");
  els.sidebar.removeAttribute("aria-modal");
  lastFocus?.focus?.({ preventScroll: true });
}

window.addEventListener("rl:drawer", openDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
});
// Growing past the drawer breakpoint while it is open would strand the scrim.
window.matchMedia("(min-width: 1024px)").addEventListener?.("change", (e) => {
  if (e.matches) closeDrawer();
});

function updateBadges(list) {
  if (!els) return;
  lastList = list;
  const live = list.filter((r) => !r.trashedAt);
  const attention = live.filter(needsAttention).length;
  const counts = {
    attention,
    next: live.filter((r) => r.shortlistedAt).length,
    // With the views folded away, the count that matters most rides on the
    // Candidates row instead of disappearing.
    candidates: els.sidebar.querySelector("#nav-candidate-views")?.hidden ? attention : 0,
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
  els.themeBtn.replaceChildren(icon(name));
  els.themeBtn.setAttribute("aria-label", `${label} — click to change`);
  els.themeBtn.title = label;
}
