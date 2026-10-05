/**
 * API client.
 *
 * The page is served at <root>/app/, and the API lives at <root> — whatever
 * nginx mounts it under ("/interview/api" in production, nothing on a bare
 * localhost). Deriving the root from the page's own URL means one build works
 * behind any prefix and no URL is ever baked in.
 *
 * Storage keys are unchanged from the previous UI, so nobody has to re-enter
 * their access key after this redesign.
 */

export const API_ROOT = (() => {
  const path = location.pathname.replace(/\/index\.html$/, "").replace(/\/app\/?$/, "");
  return location.origin + path;
})();

const KEY_STORAGE = "recruitlens.apiKey";

export function getKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || "";
  } catch {
    return "";
  }
}
export function setKey(key) {
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    /* private browsing — the key lives for this page only */
  }
  sessionKey = key;
}
export function clearKey() {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* ignore */
  }
  sessionKey = "";
}
let sessionKey = getKey();
const currentKey = () => sessionKey || getKey();

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Called when the server rejects the key, so the app can show the key screen. */
let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function parseError(res) {
  let message = `Request failed (${res.status})`;
  let code;
  try {
    const body = await res.json();
    if (body?.error?.message) message = body.error.message;
    code = body?.error?.code;
    if (Array.isArray(body?.error?.issues) && body.error.issues[0]?.message) {
      message = body.error.issues[0].message;
    }
  } catch {
    /* not JSON */
  }
  return new ApiError(message, res.status, code);
}

/**
 * fetch() with the key, JSON in and out, and readable errors.
 * `json` sends a JSON body; `body` sends anything else (FormData).
 */
export async function api(path, { method = "GET", json, body, signal, key } = {}) {
  const headers = { "x-api-key": key ?? currentKey() };
  if (json !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(API_ROOT + path, {
      method,
      headers,
      body: json !== undefined ? JSON.stringify(json) : body,
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0, "NETWORK");
  }
  if (res.status === 401) {
    if (key === undefined) onUnauthorized();
    throw await parseError(res);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Multipart upload with progress. fetch() cannot report upload progress, and
 * a long call recording takes long enough that a silent wait reads as frozen.
 */
export function upload(path, form, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", API_ROOT + path);
    xhr.setRequestHeader("x-api-key", currentKey());
    xhr.responseType = "text";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        /* not JSON */
      }
      if (xhr.status === 401) onUnauthorized();
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else {
        reject(
          new ApiError(body?.error?.message || `Upload failed (${xhr.status})`, xhr.status, body?.error?.code)
        );
      }
    };
    xhr.onerror = () =>
      reject(new ApiError("The upload was interrupted. Check your connection and try again.", 0, "NETWORK"));
    if (signal) {
      signal.addEventListener("abort", () => {
        xhr.abort();
        reject(new DOMException("Aborted", "AbortError"));
      });
    }
    xhr.send(form);
  });
}

/**
 * The audio endpoint needs the key as a header, which an <audio src> cannot
 * send — so the file is fetched once and played from a local object URL.
 */
export async function fetchAudioUrl(id, signal) {
  const res = await fetch(`${API_ROOT}/recordings/${encodeURIComponent(id)}/audio`, {
    headers: { "x-api-key": currentKey() },
    signal,
  });
  if (!res.ok) throw await parseError(res);
  return URL.createObjectURL(await res.blob());
}

export async function health() {
  const res = await fetch(API_ROOT + "/health");
  if (!res.ok) throw new ApiError("Server unavailable", res.status);
  return res.json();
}

const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const Recordings = {
  list: (params, opts) => api(`/recordings${qs(params)}`, opts),
  get: (id, opts) => api(`/recordings/${encodeURIComponent(id)}`, opts),
  update: (id, patch) => api(`/recordings/${encodeURIComponent(id)}`, { method: "PATCH", json: patch }),
  evaluate: (id) => api(`/recordings/${encodeURIComponent(id)}/evaluate`, { method: "POST" }),
  remove: (id) => api(`/recordings/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const Jobs = {
  list: (includeArchived = false, opts) => api(`/jobs${qs({ includeArchived: includeArchived || "" })}`, opts),
  get: (id, opts) => api(`/jobs/${encodeURIComponent(id)}`, opts),
  ranking: (id, opts) => api(`/jobs/${encodeURIComponent(id)}/ranking`, opts),
  create: (body) => api("/jobs", { method: "POST", json: body }),
  update: (id, body) => api(`/jobs/${encodeURIComponent(id)}`, { method: "PATCH", json: body }),
  remove: (id) => api(`/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
  extractText: (file) => {
    const form = new FormData();
    form.append("file", file);
    return api("/jobs/extract-text", { method: "POST", body: form });
  },
};

export const Presets = {
  list: (opts) => api("/instructions", opts),
  create: (body) => api("/instructions", { method: "POST", json: body }),
  update: (id, body) => api(`/instructions/${encodeURIComponent(id)}`, { method: "PATCH", json: body }),
  remove: (id) => api(`/instructions/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const Costs = { get: (limit, opts) => api(`/costs${qs({ limit })}`, opts) };
export const Taxonomy = { get: (opts) => api("/taxonomy", opts) };

/**
 * True when the page is newer than the server answering it: evaluated rows
 * arrive without the gate's decision, which the API has returned since this
 * UI shipped. Static files update the moment code is pulled, the API only on
 * restart — so this is what a pulled-but-not-restarted server looks like.
 */
export function serverIsOutdated(rows) {
  return rows.some((r) => r.status === "EVALUATED" && r.evaluationSummary && !("decision" in r.evaluationSummary));
}

// ── A short-lived cache of the candidate list ────────────────────────
// Home, Candidates, Jobs and the nav badges all read the same list; one fetch
// serves them for a few seconds, and any change invalidates it.
let listCache = null;
const LIST_TTL = 15_000;

export async function getRecordings({ force = false, signal } = {}) {
  if (!force && listCache && Date.now() - listCache.at < LIST_TTL) return listCache.data;
  const data = await Recordings.list(undefined, { signal });
  listCache = { at: Date.now(), data };
  listeners.forEach((fn) => fn(data));
  return data;
}
export function invalidateRecordings() {
  listCache = null;
}
const listeners = new Set();
export function onRecordings(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
