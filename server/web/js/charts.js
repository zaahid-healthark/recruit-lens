/**
 * Charts, drawn by hand. Each one also states its values as text, so nothing
 * depends on reading a colour or a length alone.
 *
 * Colour rule: data ink is neutral; green / amber / red appear only where a
 * mark IS a verdict or a decision (a question's dot, a requirement segment,
 * the score ring's band).
 */

import { h, s } from "./dom.js";
import { bandOf, rateTone, score10, THRESHOLDS, VERDICT } from "./format.js";

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** A progress ring with a centred number. */
export function ring({ fraction, size = 112, stroke = 10, tone = "neutral", num, sub, dashed, label }) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const numSize = Math.round(size * (sub ? 0.27 : 0.3));
  const subSize = Math.max(10, Math.round(size * 0.1));
  const offset = circ * (1 - clamp01(fraction ?? 0));
  return s(
    "svg",
    { class: "ring", width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: "img", "aria-label": label },
    s("circle", { cx: c, cy: c, r, fill: "none", "stroke-width": stroke, class: dashed ? "ring-dashed" : "ring-track" }),
    dashed
      ? null
      : s("circle", {
          cx: c,
          cy: c,
          r,
          fill: "none",
          "stroke-width": stroke,
          "stroke-linecap": "round",
          "stroke-dasharray": circ.toFixed(2),
          "stroke-dashoffset": offset.toFixed(2),
          transform: `rotate(-90 ${c} ${c})`,
          class: `ring-value s-${tone}`,
        }),
    s(
      "text",
      { x: c, y: sub ? c + numSize * 0.18 : c + numSize * 0.35, "text-anchor": "middle", class: "ring-num", "font-size": numSize },
      num
    ),
    sub
      ? s("text", { x: c, y: c + numSize * 0.18 + subSize + 6, "text-anchor": "middle", class: "ring-sub", "font-size": subSize }, sub)
      : null
  );
}

/** The overall score out of 10, coloured by the band it falls in. */
export function scoreRing(score, { size = 112, stroke } = {}) {
  const band = bandOf(score);
  if (band === null) {
    return ring({ size, stroke: stroke ?? Math.round(size / 11), dashed: true, num: "—", sub: "not scored", label: "Not scored" });
  }
  return ring({
    size,
    stroke: stroke ?? Math.round(size / 11),
    fraction: score / 100,
    tone: band,
    num: score10(score),
    sub: "out of 10",
    label: `Score ${score10(score)} out of 10`,
  });
}

/** Technical questions answered adequately or better, out of those asked. */
export function answeredRing(answered, asked, { size = 92 } = {}) {
  return ring({
    size,
    stroke: Math.round(size / 10),
    fraction: asked ? answered / asked : 0,
    tone: rateTone(answered, asked),
    num: `${answered}/${asked}`,
    sub: "answered",
    label: `${answered} of ${asked} technical questions answered adequately or better`,
  });
}

/** Position of a 0–100 score on a 0–100% track. */
const pos = (score) => `${clamp01(score / 100) * 100}%`;

/** Reference lines at the consider and fit cut-offs. */
function refLines() {
  return [
    h("span", { class: "strip-ref", style: { left: pos(THRESHOLDS.consider) }, "aria-hidden": "true" }),
    h("span", { class: "strip-ref", style: { left: pos(THRESHOLDS.fit) }, "aria-hidden": "true" }),
  ];
}

export function scaleAxis(cls = "strip-axis") {
  return h(
    "div",
    { class: cls, "aria-hidden": "true" },
    h("span", { style: { left: "0%" } }, "0"),
    h("span", { style: { left: pos(THRESHOLDS.consider) } }, "6.0"),
    h("span", { style: { left: pos(THRESHOLDS.fit) } }, "7.5"),
    h("span", { style: { left: "100%" } }, "10")
  );
}

/**
 * One row per question: a dot on a 0–10 track, coloured by its verdict, with
 * the consider and fit lines drawn through every row.
 */
export function questionStrip(questions, { onSelect } = {}) {
  const rows = questions.map((q, i) => {
    const v = VERDICT[q.verdict] ?? VERDICT.not_answered;
    const inner = [
      h("span", { class: "strip-q" }, `Q${i + 1}`),
      h("span", { class: "strip-label truncate", title: q.question }, q.question),
      h(
        "span",
        { class: "strip-track" },
        refLines(),
        h("span", { class: `strip-dot bg-${v.tone}`, style: { left: pos(q.score) } })
      ),
      h("span", { class: `strip-val tone-${v.tone}` }, score10(q.score)),
    ];
    return onSelect
      ? h(
          "button",
          { class: "strip-row", type: "button", onClick: () => onSelect(i), "aria-label": `Question ${i + 1}: ${v.label}, ${score10(q.score)}` },
          inner
        )
      : h("div", { class: "strip-row" }, inner);
  });
  return h(
    "div",
    { class: "strip" },
    rows,
    h(
      "div",
      { class: "strip-row", "aria-hidden": "true", style: { padding: "0" } },
      h("span"),
      h("span"),
      scaleAxis(),
      h("span")
    )
  );
}

/** A neutral bar for a 0–100 score, ticked at 6.0 and 7.5. Null reads "not assessed". */
export function scoreBar(score, { sm } = {}) {
  if (typeof score !== "number") {
    return h("div", { class: ["bar", "is-empty", sm && "sm"], role: "img", "aria-label": "Not assessed" });
  }
  return h(
    "div",
    { class: ["bar", sm && "sm"], role: "img", "aria-label": `${score10(score)} out of 10` },
    h("div", { class: "bar-fill", style: { width: pos(score) } }),
    h("span", { class: "bar-tick", style: { left: pos(THRESHOLDS.consider) } }),
    h("span", { class: "bar-tick", style: { left: pos(THRESHOLDS.fit) } })
  );
}

/** Compact skill bars for the at-a-glance tile. */
export function miniBars(categories) {
  return h(
    "div",
    { class: "mini-bars" },
    categories.map((c) =>
      h(
        "div",
        { class: "mini-bar-row" },
        h("span", { class: "mb-name truncate" }, c.name),
        typeof c.score === "number"
          ? h("span", { class: "mb-val" }, score10(c.score))
          : h("span", { class: "mb-val is-na" }, "Not assessed"),
        scoreBar(c.score, { sm: true })
      )
    ),
    scaleAxis("bar-axis")
  );
}

/**
 * Segments of one whole, side by side. A segment with tone "neutral" is drawn
 * dashed: it is a gap (not discussed, not assessed), not a result.
 */
export function stackBar(segments, { lg, label } = {}) {
  const total = segments.reduce((sum, seg) => sum + seg.value, 0);
  return h(
    "div",
    { class: ["stackbar", lg && "lg"], role: "img", "aria-label": label ?? segments.map((seg) => `${seg.label} ${seg.value}`).join(", ") },
    total === 0
      ? h("div", { class: "stackbar-seg is-neutral", style: { flex: "1" } })
      : segments
          .filter((seg) => seg.value > 0)
          .map((seg) =>
            h("div", {
              class: ["stackbar-seg", seg.tone === "neutral" ? "is-neutral" : `bg-${seg.tone}`],
              style: { flex: String(seg.value) },
              title: `${seg.label}: ${seg.value}`,
            })
          )
  );
}

export function legend(items) {
  return h(
    "div",
    { class: "legend" },
    items.map((it) =>
      h(
        "span",
        { class: "legend-item" },
        h("span", { class: ["dot", it.tone === "neutral" ? "is-neutral" : `bg-${it.tone}`] }),
        it.label,
        it.value !== undefined ? h("b", null, String(it.value)) : null
      )
    )
  );
}

/**
 * A hiring funnel: each stage as wide as its count against the first, with
 * the share that carried on from the stage before. Neutral ink — stages are
 * not verdicts.
 */
export function funnel(stages) {
  const first = Math.max(1, stages[0]?.value ?? 0);
  return h(
    "div",
    { class: "funnel", role: "img", "aria-label": stages.map((st) => `${st.label}: ${st.value}`).join(", ") },
    stages.map((st, i) => {
      const prev = i > 0 ? stages[i - 1].value : null;
      return h(
        "div",
        { class: "funnel-row" },
        h("span", { class: "funnel-label" }, st.label),
        h("span", { class: "funnel-bar" }, h("span", { class: "funnel-fill", style: { width: `${st.value ? Math.max(2, (st.value / first) * 100) : 0}%` } })),
        h("span", { class: "funnel-count" }, String(st.value)),
        h("span", { class: "funnel-rate" }, prev === null ? "" : prev ? `${Math.round((st.value / prev) * 100)}% carried on` : "—")
      );
    })
  );
}

/** Columns per score band, coloured by the decision each band means. */
export function bandColumns(bands) {
  const max = Math.max(1, ...bands.map((b) => b.value));
  return h(
    "div",
    { role: "img", "aria-label": bands.map((b) => `${b.label}: ${b.value}`).join(", ") },
    h(
      "div",
      { class: "dist" },
      bands.map((b) =>
        h(
          "div",
          { class: "dist-col", title: `${b.label} · ${b.name}: ${b.value}` },
          h("span", { class: "dist-val" }, String(b.value)),
          h("span", { class: `dist-bar bg-${b.tone}`, style: { height: `${b.value ? Math.max(3, (b.value / max) * 100) : 0}%`, opacity: b.value ? "1" : "0" } })
        )
      )
    ),
    h(
      "div",
      { class: "dist-axis", "aria-hidden": "true" },
      bands.map((b) => h("span", null, h("span", { class: "num" }, b.label), h("br"), h("span", { class: `tone-${b.tone}` }, b.name)))
    )
  );
}

/**
 * Every candidate as a dot on one 0–10 line, coloured by their decision, with
 * the consider and fit lines through it. Close scores are staggered so no dot
 * hides another.
 */
export function scoreSpread(points) {
  const placed = [];
  const lanes = [];
  [...points]
    .filter((p) => typeof p.score === "number")
    .sort((a, b) => a.score - b.score)
    .forEach((p) => {
      let lane = 0;
      while (lanes[lane] !== undefined && p.score - lanes[lane] < 3) lane++;
      lanes[lane] = p.score;
      placed.push({ ...p, lane: Math.min(lane, 3) });
    });
  return h(
    "div",
    { class: "spread", role: "img", "aria-label": placed.map((p) => `${p.name}: ${score10(p.score)}`).join(", ") },
    h(
      "div",
      { class: "spread-track" },
      refLines(),
      placed.map((p) =>
        h("a", {
          class: `spread-dot bg-${p.tone}`,
          href: p.href,
          title: `${p.name} · ${score10(p.score)}`,
          "aria-label": `${p.name}, ${score10(p.score)}`,
          style: { left: pos(p.score), top: `${22 + p.lane * 16}px` },
        })
      )
    ),
    scaleAxis()
  );
}

/** Columns for counts over time. buckets: [{ label, value, title }]. */
export function columnChart(buckets, { height = 148, label } = {}) {
  const max = Math.max(1, ...buckets.map((b) => b.value));
  const n = buckets.length;
  const tickIdx = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  return h(
    "div",
    { role: "img", "aria-label": label ?? buckets.map((b) => `${b.label}: ${b.value}`).join(", ") },
    h(
      "div",
      { class: "cols", style: { height: `${height}px` } },
      buckets.map((b) =>
        h(
          "div",
          { class: "col", title: b.title ?? `${b.label}: ${b.value}` },
          h("div", { class: ["col-bar", b.value === 0 && "is-zero"], style: { height: `${b.value ? Math.max(4, (b.value / max) * 100) : 2}%` } })
        )
      )
    ),
    h(
      "div",
      { class: "col-axis", "aria-hidden": "true" },
      tickIdx.map((i) => h("span", null, buckets[i]?.label ?? ""))
    )
  );
}
