/**
 * Hash router. The hash keeps every screen linkable and makes the browser's
 * back button work, without needing the server to know any client routes —
 * which matters behind a path prefix.
 *
 * Each navigation gets an AbortSignal that fires when the user leaves, so a
 * screen's fetches and polling stop with it.
 */

const routes = [];
let active = null;
let notFound = null;

export function route(pattern, handler) {
  const keys = [];
  const source = pattern
    .replace(/\//g, "\\/")
    .replace(/:(\w+)/g, (_, key) => {
      keys.push(key);
      return "([^/]+)";
    });
  routes.push({ regex: new RegExp(`^${source}\\/?$`), keys, handler });
}

export function setNotFound(handler) {
  notFound = handler;
}

export function parseHash() {
  const raw = decodeURI(location.hash.replace(/^#/, "")) || "/";
  const [path, search = ""] = raw.split("?");
  return { path: path || "/", query: new URLSearchParams(search) };
}

/** Go to a route: navigate("/candidates/abc"). */
export function navigate(to, { replace = false } = {}) {
  const hash = "#" + to;
  if (location.hash === hash) {
    dispatch();
    return;
  }
  if (replace) {
    history.replaceState(null, "", hash);
    dispatch();
  } else {
    location.hash = to;
  }
}

/**
 * Rewrite the query string without re-rendering — for filters, tabs and
 * pagination that the screen has already applied itself.
 */
export function replaceQuery(updates) {
  const { path, query } = parseHash();
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined || v === null || v === "" || v === false) query.delete(k);
    else query.set(k, String(v));
  }
  const search = query.toString();
  history.replaceState(null, "", "#" + path + (search ? "?" + search : ""));
}

export function href(path, query) {
  const search = query ? new URLSearchParams(query).toString() : "";
  return "#" + path + (search ? "?" + search : "");
}

let beforeEach = () => {};
export function onBeforeRoute(fn) {
  beforeEach = fn;
}

async function dispatch() {
  active?.abort();
  const controller = new AbortController();
  active = controller;
  const { path, query } = parseHash();
  beforeEach({ path, query });
  for (const r of routes) {
    const m = r.regex.exec(path);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    try {
      await r.handler({ path, params, query, signal: controller.signal });
    } catch (err) {
      if (err?.name !== "AbortError") console.error(err);
    }
    return;
  }
  notFound?.({ path, query, signal: controller.signal });
}

export function start() {
  window.addEventListener("hashchange", dispatch);
  dispatch();
}

export function refresh() {
  dispatch();
}
