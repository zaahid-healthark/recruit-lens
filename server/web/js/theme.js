/**
 * Light, dark, or follow the device. Stored under the same key the previous
 * UI used, so a recruiter's choice survives the redesign. Light is the
 * default because that is what the team asked for.
 */

const THEME_STORAGE = "recruitlens.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePref() {
  try {
    const v = localStorage.getItem(THEME_STORAGE);
    return v === "dark" || v === "system" ? v : "light";
  } catch {
    return "light";
  }
}

export function setThemePref(pref) {
  try {
    localStorage.setItem(THEME_STORAGE, pref);
  } catch {
    /* private browsing */
  }
}

export function resolvedTheme() {
  const pref = getThemePref();
  return pref === "system" ? (media.matches ? "dark" : "light") : pref;
}

export function applyTheme() {
  document.documentElement.setAttribute("data-theme", resolvedTheme());
}

media.addEventListener?.("change", () => {
  if (getThemePref() === "system") applyTheme();
});
