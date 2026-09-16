/**
 * Checks the Costs read path against fixture observations, with Langfuse's
 * HTTP stubbed. No network, no keys, no database.
 *
 * Exists because the failure this guards against is invisible: when a stage
 * cannot be priced it renders as "—" or $0.00, which looks like a cheap step
 * rather than a broken read. Langfuse has no rate for the transcription model,
 * so its cost is derived here from the tokens it does record — and a silent
 * regression in that derivation would understate every evaluation.
 *
 *   npm run cost:check -w server
 */
process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
process.env.DATABASE_URL ||= "postgresql://x/y";
process.env.API_KEY ||= "test";

const at = new Date().toISOString();

const TRACES = [
  {
    id: "t1", timestamp: at, totalCost: 0.15, latency: 170, htmlPath: "/trace/t1",
    metadata: { recordingId: "r1", candidateName: "Test Candidate", audioMinutes: 4.18 },
  },
];

const OBS = [
  { traceId: "t1", name: "score", type: "GENERATION", model: "gpt-5.4",
    costDetails: { total: 0.07 }, usageDetails: { input: 10000, output: 900 } },
  { traceId: "t1", name: "score-repair", type: "GENERATION", model: "gpt-5.4",
    costDetails: { total: 0.08 }, usageDetails: { input: 11000, output: 950 } },
  // The case this all exists for: tokens recorded, no rate, Langfuse says zero.
  { traceId: "t1", name: "transcribe", type: "GENERATION", model: "gpt-4o-transcribe-diarize",
    costDetails: {}, calculatedTotalCost: 0, usageDetails: { input: 2500, output: 900 } },
  // Another application sharing the Langfuse project — must not leak in.
  { traceId: "other-app", name: "chat", type: "GENERATION", model: "gpt-5-nano",
    costDetails: { total: 0.9 }, usageDetails: { input: 5, output: 5 } },
];

let sawFromStartTime = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === "string" ? input : (input?.url ?? ""));
  const body = (d: unknown) =>
    new Response(JSON.stringify({ data: d, meta: {} }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  if (url.includes("/api/public/traces")) return body(TRACES);
  if (url.includes("/api/public/observations")) {
    if (url.includes("fromStartTime")) sawFromStartTime = true;
    const page = Number(new URL(url).searchParams.get("page") ?? "1");
    return body(page > 1 ? [] : OBS); // second page empty: exercises the pager
  }
  return realFetch(input, init);
}) as typeof fetch;

async function main(): Promise<void> {
  const { fetchCostTraces } = await import("../src/observability/langfuse");
  const c = await fetchCostTraces(50);

  const t = c.byStage.find((s) => s.name === "transcribe");
  const expected = (2500 / 1e6) * 2.5 + (900 / 1e6) * 10; // $0.01525

  const checks: Array<[string, boolean, unknown]> = [
    ["transcribe stage present", !!t, c.byStage.map((s) => s.name)],
    ["priced from tokens ($0.01525)", !!t && Math.abs(t.cost - expected) < 1e-9, t?.cost],
    ["marked as derived by us", t?.derived === true, t?.derived],
    ["not flagged unpriced", !t?.unpriced, t?.unpriced],
    ["tokens surfaced to the UI", t?.inputTokens === 2500 && t?.outputTokens === 900,
      [t?.inputTokens, t?.outputTokens]],
    ["other application excluded", !c.byStage.some((s) => s.name === "chat"),
      c.byStage.map((s) => s.name)],
    ["stage count is 3", c.byStage.length === 3, c.byStage.length],
    ["derived cost added to the call total",
      Math.abs((c.calls[0]?.cost ?? 0) - (0.15 + expected)) < 1e-9, c.calls[0]?.cost],
    ["stages Langfuse priced are left alone",
      c.byStage.find((s) => s.name === "score")?.cost === 0.07,
      c.byStage.find((s) => s.name === "score")?.cost],
    ["observation query bounded by fromStartTime", sawFromStartTime, sawFromStartTime],
    ["missingPricing not set", !c.missingPricing, c.missingPricing],
  ];

  let failed = 0;
  for (const [label, ok, got] of checks) {
    console.log((ok ? "PASS  " : "FAIL  ") + label + (ok ? "" : "  -> got " + JSON.stringify(got)));
    if (!ok) failed++;
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
}

void main();
