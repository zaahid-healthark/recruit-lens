/**
 * Boot: theme, access key, shell, routes.
 */

import { h, mount } from "./dom.js";
import { clearKey, getKey, setUnauthorizedHandler } from "./api.js";
import { navigate, onBeforeRoute, refresh, route, setNotFound, start } from "./router.js";
import { mainEl, mountShell, setActionBar } from "./shell.js";
import { applyTheme } from "./theme.js";
import * as C from "./components.js";
import { renderGate } from "./views/key.js";
import { homeView } from "./views/home.js";
import { candidatesView } from "./views/candidates.js";
import { reportView } from "./views/report.js";
import { evaluateView } from "./views/evaluate.js";
import { jobDetailView, jobFormView, jobsView } from "./views/jobs.js";
import { costsView, instructionsView, settingsView } from "./views/settings.js";

applyTheme();
const root = document.getElementById("app");
let started = false;

const withMain = (view) => (ctx) => view({ ...ctx, main: mainEl() });

function registerRoutes() {
  route("/", withMain(homeView));
  route("/candidates", withMain(candidatesView));
  route("/candidates/:id", withMain(reportView));
  route("/evaluate", withMain(evaluateView));
  route("/jobs", withMain(jobsView));
  route("/jobs/new", withMain(jobFormView));
  route("/jobs/:id", withMain(jobDetailView));
  route("/jobs/:id/edit", withMain(jobFormView));
  route("/settings", withMain(settingsView));
  route("/settings/instructions", withMain(instructionsView));
  route("/settings/costs", withMain(costsView));
  route("/key", () => navigate("/", { replace: true }));
  setNotFound(() =>
    mount(
      mainEl(),
      C.topbar({ title: "Not found" }),
      h(
        "div",
        { class: "page page-mid" },
        h("div", { class: "card" }, C.emptyState({ icon: "help", title: "That page doesn't exist", text: "The link may be old, or the item may have been deleted.", action: C.btn({ label: "Go home", href: "#/", variant: "primary" }) }))
      )
    )
  );
  onBeforeRoute(() => {
    setActionBar(null);
    document.querySelectorAll(".menu").forEach((m) => m.remove());
    window.scrollTo(0, 0);
    mainEl()?.focus({ preventScroll: true });
  });
}

function boot() {
  if (!getKey()) {
    showGate();
    return;
  }
  mountShell(root);
  if (!started) {
    registerRoutes();
    started = true;
    start();
  } else {
    refresh();
  }
}

function showGate(message) {
  setActionBar(null);
  renderGate(root, {
    message,
    onSuccess: () => {
      if (location.hash === "#/key") history.replaceState(null, "", "#/");
      boot();
    },
  });
}

setUnauthorizedHandler(() => {
  clearKey();
  showGate("Your access key was rejected — it may have changed. Enter the current one.");
});

boot();
