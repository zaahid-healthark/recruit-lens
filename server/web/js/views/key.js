/**
 * The access-key gate. The page itself holds no secrets: it asks for the
 * key, checks it against the server, and sends it on every request.
 */

import { h, mount } from "../dom.js";
import { icon } from "../icons.js";
import { api, setKey } from "../api.js";
import * as C from "../components.js";

/** Check a key by making one cheap authenticated request with it. */
async function verify(key) {
  await api("/jobs", { key });
}

function keyInput(id) {
  const input = h("input", {
    class: "input",
    id,
    type: "password",
    autocomplete: "current-password",
    spellcheck: "false",
    placeholder: "Paste your access key",
    autofocus: true,
  });
  const toggle = C.iconBtn({
    icon: "eye",
    label: "Show key",
    size: "sm",
    cls: "input-end",
    onClick: () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      toggle.replaceChildren(icon(show ? "eyeOff" : "eye"));
      toggle.setAttribute("aria-label", show ? "Hide key" : "Show key");
    },
  });
  return { input, wrap: h("div", { class: "input-wrap" }, icon("key"), input, toggle) };
}

/** Full-page gate, shown before the shell when no working key is stored. */
export function renderGate(root, { message, onSuccess }) {
  const { input, wrap } = keyInput("gate-key");
  const error = h("div", { class: "field-error", role: "alert", hidden: !message }, message ?? "");
  const submit = C.btn({ label: "Continue", variant: "primary", size: "lg", block: true, type: "submit" });
  const form = h(
    "form",
    {
      class: "stack gap-16",
      onSubmit: (e) => {
        e.preventDefault();
        const key = input.value.trim();
        if (!key) return;
        C.busy(submit, async () => {
          try {
            await verify(key);
            setKey(key);
            onSuccess();
          } catch (err) {
            error.textContent = err.status === 401 ? "That key wasn't accepted. Check it and try again." : err.message;
            error.hidden = false;
            input.select();
          }
        }, "Checking…");
      },
    },
    C.field({ label: "Access key", id: "gate-key" }, wrap),
    error,
    submit
  );
  mount(
    root,
    h(
      "div",
      { class: "gate" },
      h(
        "div",
        { class: "card gate-card" },
        h("span", { class: "brand-logo", role: "img", "aria-label": "Healthark" }),
        h("h1", { class: "h1" }, "RecruitLens"),
        h("p", { class: "muted mt-8", style: { marginBottom: "24px" } }, "Screening-call reports and decisions. Enter the access key your administrator gave you."),
        form,
        h("p", { class: "faint xsmall mt-16" }, "The key is stored on this device only.")
      )
    )
  );
  requestAnimationFrame(() => input.focus());
}

/** Replace the stored key from inside the app. */
export function changeKeyDialog() {
  const { input, wrap } = keyInput("new-key");
  const error = h("div", { class: "field-error", role: "alert", hidden: true });
  const save = C.btn({ label: "Save key", variant: "primary" });
  const d = C.dialog({
    title: "Change access key",
    body: h("div", { class: "stack gap-12" }, C.field({ label: "New access key", id: "new-key" }, wrap), error),
    actions: [C.btn({ label: "Cancel", onClick: () => d.close() }), save],
  });
  save.addEventListener("click", () =>
    C.busy(save, async () => {
      const key = input.value.trim();
      if (!key) return;
      try {
        await verify(key);
        setKey(key);
        d.close();
        C.toast("Access key updated", { tone: "fit" });
      } catch (err) {
        error.textContent = err.status === 401 ? "That key wasn't accepted." : err.message;
        error.hidden = false;
      }
    }, "Checking…")
  );
}
