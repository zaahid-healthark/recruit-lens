/**
 * Minimal DOM builders.
 *
 * Every string child becomes a text node, so anything the API returns — a
 * candidate's name, a transcript line, a job description — is rendered as
 * text and can never inject markup. The only raw markup in the app is the
 * static icon set, passed through `html`.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

function setProps(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class" || key === "className") {
      const cls = Array.isArray(value) ? value.filter(Boolean).join(" ") : value;
      if (cls) el.setAttribute("class", cls);
    } else if (key === "style" && typeof value === "object") {
      for (const [prop, v] of Object.entries(value)) {
        if (v === undefined || v === null) continue;
        if (prop.startsWith("--")) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    } else if (key === "dataset") {
      Object.assign(el.dataset, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "html") {
      el.innerHTML = value;
    } else if (key === "ref") {
      value(el);
    } else if (typeof value === "boolean") {
      if (key in el) el[key] = true;
      else el.setAttribute(key, "");
    } else if ((key === "value" || key === "checked") && key in el) {
      el[key] = value;
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

function isProps(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Node)
  );
}

/** Create an HTML element: h("div", { class: "card" }, "text", child). */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (isProps(props)) setProps(el, props);
  else children.unshift(props);
  appendChildren(el, children);
  return el;
}

/** Create an SVG element with the same calling convention. */
export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (isProps(props)) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") el.setAttribute("class", value);
      else if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else el.setAttribute(key, String(value));
    }
  } else children.unshift(props);
  appendChildren(el, children);
  return el;
}

/** Replace an element's contents. */
export function mount(el, ...children) {
  el.replaceChildren();
  appendChildren(el, children);
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Add a listener; returns the function that removes it. */
export function listen(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/** A DocumentFragment from children — for returning several nodes at once. */
export function frag(...children) {
  const f = document.createDocumentFragment();
  appendChildren(f, children);
  return f;
}
