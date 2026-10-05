/**
 * The component kit. Everything visual is built from these, so the rules in
 * styles.css (colour only for meaning, no stripes, one accent) hold by
 * construction rather than by each screen remembering them.
 */

import { h, listen } from "./dom.js";
import { icon } from "./icons.js";
import { DECISION, REQUIREMENT, STATUS, VERDICT, isProcessing } from "./format.js";

// ── Buttons ──────────────────────────────────────────────────────────
export function btn({
  label,
  icon: iconName,
  variant = "secondary",
  size,
  onClick,
  href,
  disabled,
  type = "button",
  title,
  block,
  cls,
  iconAfter,
}) {
  const classes = ["btn", `btn-${variant}`, size && `btn-${size}`, block && "btn-block", cls];
  const content = [iconName && !iconAfter ? icon(iconName) : null, label, iconAfter ? icon(iconName) : null];
  if (href) {
    return h("a", { class: classes, href, title, "aria-disabled": disabled ? "true" : undefined }, content);
  }
  return h("button", { class: classes, type, onClick, disabled: !!disabled, title }, content);
}

export function iconBtn({ icon: iconName, label, onClick, bordered, size, cls, href }) {
  const classes = ["icon-btn", bordered && "bordered", size, cls];
  if (href) return h("a", { class: classes, href, "aria-label": label, title: label }, icon(iconName));
  return h(
    "button",
    { class: classes, type: "button", "aria-label": label, title: label, onClick },
    icon(iconName)
  );
}

/** Put a button into a busy state while `work` runs; restores it after. */
export async function busy(button, work, busyLabel) {
  const prev = [...button.childNodes];
  button.disabled = true;
  button.replaceChildren(spinner(), busyLabel ?? "");
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.replaceChildren(...prev);
  }
}

export const spinner = (cls = "") => h("span", { class: ["spinner", cls], "aria-hidden": "true" });

// ── Chips and labels ─────────────────────────────────────────────────
export function decisionChip(decision, { lg, short } = {}) {
  const d = DECISION[decision] ?? DECISION.insufficient_evidence;
  return h(
    "span",
    { class: ["chip", lg && "chip-lg", `tone-${d.tone}`] },
    h("span", { class: "dot" }),
    short ? d.short : d.label
  );
}

export function verdictLabel(verdict) {
  const v = VERDICT[verdict] ?? VERDICT.not_answered;
  return h("span", { class: ["vlabel", `tone-${v.tone}`] }, h("span", { class: "dot" }), v.label);
}

export function requirementLabel(verdict) {
  const v = REQUIREMENT[verdict] ?? REQUIREMENT.not_discussed;
  return h("span", { class: ["vlabel", `tone-${v.tone}`] }, h("span", { class: "dot" }), v.label);
}

/** A neutral pill for a recording's state or the human decision on it. */
export function statusPill(r) {
  if (r.trashedAt) return h("span", { class: "pill" }, icon("trash"), "In trash");
  if (isProcessing(r)) {
    return h("span", { class: "pill is-processing" }, spinner(), STATUS[r.status]);
  }
  if (r.status === "FAILED") return h("span", { class: "pill is-failed" }, icon("alertCircle"), "Failed");
  if (r.shortlistedAt) return h("span", { class: "pill is-next" }, icon("video"), "Next round");
  if (r.rejectedAt) return h("span", { class: "pill" }, icon("xCircle"), "Rejected");
  return h("span", { class: "faint small" }, "Awaiting decision");
}

export function countPill(n, tone) {
  return h("span", { class: ["count", n ? `tone-${tone}` : "is-zero"] }, String(n));
}

// ── Structure ────────────────────────────────────────────────────────
/** The sticky top bar: back arrow, breadcrumbs (laptop) / title (phone), actions. */
export function topbar({ title, crumbs, back, actions = [] }) {
  document.title = title ? `${title} · RecruitLens` : "RecruitLens";
  return h(
    "header",
    { class: "topbar" },
    back ? iconBtn({ icon: "arrowLeft", label: "Back", href: back }) : null,
    crumbs?.length
      ? h(
          "nav",
          { class: "crumbs", "aria-label": "Breadcrumb" },
          crumbs.flatMap((c, i) => [
            i > 0 ? h("span", { class: "crumb-sep", "aria-hidden": "true" }, "/") : null,
            c.href && i < crumbs.length - 1
              ? h("a", { class: "crumb", href: c.href }, c.label)
              : h("span", { class: "crumb", "aria-current": "page" }, c.label),
          ])
        )
      : null,
    h("h1", { class: ["topbar-title", !back && "has-pad"] }, title),
    h("div", { class: "topbar-actions" }, actions)
  );
}

export function section({ title, meta, actions, id, cls }, ...children) {
  return h(
    "section",
    { class: ["section", cls], id },
    h(
      "div",
      { class: "section-head" },
      h("h2", { class: "section-title" }, title),
      meta || actions ? h("div", { class: "row gap-12" }, meta ? h("span", { class: "section-meta" }, meta) : null, actions) : null
    ),
    children
  );
}

export function emptyState({ icon: iconName = "inbox", title, text, action }) {
  return h(
    "div",
    { class: "empty" },
    h("div", { class: "empty-icon" }, icon(iconName)),
    h("div", { class: "empty-title" }, title),
    text ? h("p", { class: "empty-text" }, text) : null,
    action ?? null
  );
}

export function errorState(err, retry) {
  return h(
    "div",
    { class: "card" },
    emptyState({
      icon: "alertTriangle",
      title: err?.status === 404 ? "Not found" : "Something went wrong",
      text: err?.message || "The request failed.",
      action: retry ? btn({ label: "Try again", icon: "refresh", onClick: retry }) : null,
    })
  );
}

export function banner({ icon: iconName = "info", tone, text, actions = [] }) {
  return h(
    "div",
    { class: ["banner", tone && `tone-${tone}`], role: "status" },
    icon(iconName),
    h("div", { class: "grow" }, text),
    h("div", { class: "row" }, actions)
  );
}

export function note(iconName, ...content) {
  return h("p", { class: "note" }, icon(iconName), h("span", null, content));
}

export function quote(text) {
  return h("blockquote", { class: "quote" }, icon("quote"), h("span", null, text));
}

// ── Skeletons ────────────────────────────────────────────────────────
export const skelLine = (width = "100%", height = 12) =>
  h("span", { class: "skel skel-line", style: { width, height: `${height}px` } });

export const skelBlock = (height = 120) =>
  h("span", { class: "skel skel-block", style: { height: `${height}px` } });

export function skelTable(rows = 5, cols = 4) {
  return h(
    "div",
    { class: "tbl-wrap" },
    h(
      "table",
      { class: "tbl" },
      h("thead", null, h("tr", null, Array.from({ length: cols }, () => h("th", null, skelLine("60%", 10))))),
      h(
        "tbody",
        null,
        Array.from({ length: rows }, () =>
          h(
            "tr",
            null,
            Array.from({ length: cols }, (_, c) => h("td", null, skelLine(c === 1 ? "80%" : "50%")))
          )
        )
      )
    )
  );
}

// ── Form controls ────────────────────────────────────────────────────
export function field({ label, hint, optional, error, id, counter }, control) {
  return h(
    "div",
    { class: "field" },
    label
      ? h("label", { class: "field-label", for: id }, label, optional ? h("span", { class: "opt" }, " (optional)") : null)
      : null,
    control,
    counter ?? null,
    hint ? h("div", { class: "field-hint" }, hint) : null,
    error ? h("div", { class: "field-error", role: "alert" }, error) : null
  );
}

export function select({ id, value, options, onChange, cls, label }) {
  const el = h(
    "select",
    { class: ["select", cls], id, "aria-label": label, onChange: (e) => onChange?.(e.target.value, e) },
    options.map((o) =>
      h("option", { value: o.value, selected: String(o.value) === String(value ?? "") }, o.label)
    )
  );
  return el;
}

/** A segmented control: seg({ options, value, onChange }). */
export function seg({ options, value, onChange, block, label }) {
  const root = h("div", { class: ["seg", block && "block"], role: "radiogroup", "aria-label": label });
  const render = (current) => {
    root.replaceChildren(
      ...options.map((o) =>
        h(
          "button",
          {
            type: "button",
            class: ["seg-btn", String(o.value) === String(current) && "is-active"],
            role: "radio",
            "aria-checked": String(String(o.value) === String(current)),
            onClick: () => {
              render(o.value);
              onChange?.(o.value);
            },
          },
          o.icon ? icon(o.icon) : null,
          o.label
        )
      )
    );
  };
  render(value);
  return root;
}

// ── Tables ───────────────────────────────────────────────────────────
export const td = (content, cls, attrs = {}) => h("td", { class: cls, ...attrs }, content);

/**
 * A data table whose rows either open a detail row (renderDetail) or navigate
 * (onRowClick). `cls` names the table type, which styles.css uses to reflow
 * the row on phones.
 */
export function dataTable({ cls, columns, rows, renderRow, renderDetail, onRowClick, rowId, openIndex = -1, caption, reflow = true }) {
  const tbody = h("tbody");
  const rowEls = [];
  const detailEls = [];

  const toggle = (i, force) => {
    const tr = rowEls[i];
    const detail = detailEls[i];
    if (!tr || !detail) return;
    const open = force ?? detail.hidden;
    detail.hidden = !open;
    tr.classList.toggle("is-open", open);
    tr.setAttribute("aria-expanded", String(open));
    tr.querySelector(".expand")?.setAttribute("aria-expanded", String(open));
  };

  rows.forEach((item, i) => {
    const cells = renderRow(item, i);
    const expandable = !!renderDetail;
    const tr = h(
      "tr",
      {
        class: [(expandable || onRowClick) && "is-clickable"],
        id: rowId ? rowId(item, i) : undefined,
        tabindex: expandable || onRowClick ? "0" : undefined,
        "aria-expanded": expandable ? "false" : undefined,
      },
      cells,
      expandable
        ? td(
            h(
              "button",
              { class: "expand", type: "button", "aria-label": "Show details", "aria-expanded": "false", tabindex: "-1" },
              icon("chevronDown")
            ),
            "tight c-x"
          )
        : null
    );
    const activate = (e) => {
      if (e.target.closest("a, button:not(.expand), input, select, textarea")) return;
      if (expandable) toggle(i);
      else onRowClick?.(item, e);
    };
    tr.addEventListener("click", activate);
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        if (e.target !== tr) return;
        e.preventDefault();
        activate(e);
      }
    });
    rowEls.push(tr);
    tbody.append(tr);
    if (expandable) {
      const colspan = columns.length + 1;
      const detail = h("tr", { class: "tbl-detail", hidden: true }, h("td", { colspan }, renderDetail(item, i)));
      detailEls.push(detail);
      tbody.append(detail);
    }
  });

  const table = h(
    "table",
    { class: ["tbl", reflow && "reflow", cls] },
    caption ? h("caption", { class: "sr-only" }, caption) : null,
    h(
      "thead",
      null,
      h(
        "tr",
        null,
        columns.map((c) => h("th", { class: c.cls, scope: "col", ...(c.attrs || {}) }, c.label)),
        renderDetail ? h("th", { class: "tight c-x" }, h("span", { class: "sr-only" }, "Details")) : null
      )
    ),
    tbody
  );
  if (openIndex >= 0) toggle(openIndex, true);
  return { el: h("div", { class: "tbl-wrap" }, h("div", { class: "tbl-scroll" }, table)), open: (i) => toggle(i, true), rows: rowEls };
}

/** "1–25 of 63", rows-per-page, previous / next. */
export function pager({ total, page, per, onChange, perOptions = [10, 25, 50] }) {
  const pages = Math.max(1, Math.ceil(total / per));
  const from = total === 0 ? 0 : (page - 1) * per + 1;
  const to = Math.min(total, page * per);
  return h(
    "div",
    { class: "pager" },
    h("span", { class: "num" }, `${from}–${to} of ${total}`),
    h(
      "div",
      { class: "pager-controls" },
      h("span", { class: "not-phone" }, "Show"),
      select({
        label: "Rows per page",
        value: per,
        options: perOptions.map((n) => ({ value: n, label: String(n) })),
        onChange: (v) => onChange({ page: 1, per: Number(v) }),
      }),
      h("span", { class: "not-phone" }, "per page"),
      btn({
        label: "Previous",
        icon: "chevronLeft",
        size: "sm",
        variant: "ghost",
        disabled: page <= 1,
        onClick: () => onChange({ page: page - 1, per }),
      }),
      h("span", { class: "pager-page" }, String(page)),
      btn({
        label: "Next",
        icon: "chevronRight",
        iconAfter: true,
        size: "sm",
        variant: "ghost",
        disabled: page >= pages,
        onClick: () => onChange({ page: page + 1, per }),
      })
    )
  );
}

// ── Overlays ─────────────────────────────────────────────────────────
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog. On phones it becomes a bottom sheet. Traps focus, closes on
 * Escape and on a click outside, and returns focus where it came from.
 */
export function dialog({ title, body, actions = [], wide, sheet = true, onClose, label }) {
  const opener = document.activeElement;
  const titleId = "dlg-" + Math.random().toString(36).slice(2, 8);
  let closed = false;
  const panel = h(
    "div",
    { class: ["dialog", wide && "wide"], role: "dialog", "aria-modal": "true", "aria-labelledby": title ? titleId : undefined, "aria-label": title ? undefined : label },
    h(
      "div",
      { class: "dialog-head" },
      h("h2", { class: "dialog-title", id: titleId }, title),
      iconBtn({ icon: "x", label: "Close", onClick: () => close() })
    ),
    h("div", { class: "dialog-body" }, body),
    actions.length ? h("div", { class: "dialog-foot" }, actions) : null
  );
  const overlay = h("div", { class: ["overlay", sheet && "is-sheet"] }, panel);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  const offKey = listen(document, "keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      const nodes = [...panel.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  function close(result) {
    if (closed) return;
    closed = true;
    offKey();
    overlay.remove();
    document.body.style.overflow = "";
    opener?.focus?.();
    onClose?.(result);
  }
  document.body.append(overlay);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => {
    const target = panel.querySelector("[autofocus]") || panel.querySelector(".dialog-body " + FOCUSABLE) || panel.querySelector(FOCUSABLE);
    target?.focus();
  });
  return { el: panel, close };
}

/** Ask before something that cannot be undone. Resolves true or false. */
export function confirm({ title, text, confirmLabel = "Confirm", tone, cancelLabel = "Cancel" }) {
  return new Promise((resolve) => {
    let answer = false;
    const d = dialog({
      title,
      body: h("p", null, text),
      sheet: true,
      onClose: () => resolve(answer),
      actions: [
        btn({ label: cancelLabel, onClick: () => d.close() }),
        btn({
          label: confirmLabel,
          variant: tone === "danger" ? "danger-solid" : "primary",
          onClick: () => {
            answer = true;
            d.close();
          },
        }),
      ],
    });
  });
}

/** A popover menu anchored to a button. items: [{ label, icon, onClick, tone } | "sep"]. */
export function openMenu(anchor, items) {
  document.querySelectorAll(".menu").forEach((m) => m.remove());
  const menu = h(
    "div",
    { class: "menu", role: "menu" },
    items.map((it) =>
      it === "sep"
        ? h("div", { class: "menu-sep", role: "separator" })
        : h(
            "button",
            {
              type: "button",
              role: "menuitem",
              class: ["menu-item", it.tone === "danger" && "tone-danger"],
              disabled: !!it.disabled,
              onClick: () => {
                close();
                it.onClick?.();
              },
            },
            it.icon ? icon(it.icon) : null,
            it.label
          )
    )
  );
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = Math.min(window.innerWidth - mw - 8, Math.max(8, r.right - mw));
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  anchor.setAttribute("aria-expanded", "true");
  const offDown = listen(document, "mousedown", (e) => {
    if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close();
  });
  const offKey = listen(document, "keydown", (e) => {
    const nodes = [...menu.querySelectorAll(".menu-item:not([disabled])")];
    const i = nodes.indexOf(document.activeElement);
    if (e.key === "Escape") {
      close();
      anchor.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      nodes[(i + 1) % nodes.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      nodes[(i - 1 + nodes.length) % nodes.length]?.focus();
    }
  });
  const offScroll = listen(window, "scroll", () => close(), { capture: true, passive: true });
  function close() {
    menu.remove();
    offDown();
    offKey();
    offScroll();
    anchor.setAttribute("aria-expanded", "false");
  }
  menu.querySelector(".menu-item")?.focus();
  return close;
}

/** A "⋯" button that opens a menu built at click time. */
export function moreMenu(getItems, { label = "More actions", bordered = true } = {}) {
  const b = iconBtn({ icon: "more", label, bordered });
  b.setAttribute("aria-haspopup", "menu");
  b.setAttribute("aria-expanded", "false");
  b.addEventListener("click", () => openMenu(b, getItems()));
  return b;
}

// ── Toasts ───────────────────────────────────────────────────────────
let toastHost = null;
export function setToastHost(el) {
  toastHost = el;
}

/** A short confirmation, optionally with an action such as Undo. */
export function toast(message, { tone, actionLabel, onAction, duration = 5200 } = {}) {
  if (!toastHost) return;
  const iconName = tone === "reject" ? "alertCircle" : tone === "fit" ? "checkCircle" : "info";
  const el = h(
    "div",
    { class: "toast", role: "status" },
    h("span", { class: tone ? `tone-${tone}` : "" }, icon(iconName)),
    h("span", { class: "grow" }, message),
    actionLabel
      ? h(
          "button",
          {
            class: "toast-action",
            type: "button",
            onClick: () => {
              dismiss();
              onAction?.();
            },
          },
          actionLabel
        )
      : null
  );
  const timer = setTimeout(dismiss, duration);
  function dismiss() {
    clearTimeout(timer);
    el.remove();
  }
  toastHost.append(el);
  return dismiss;
}

/** Copy text; toasts the outcome. */
export async function copyText(text, done = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(done, { tone: "fit" });
  } catch {
    toast("Couldn't copy — select and copy it manually.", { tone: "reject" });
  }
}
