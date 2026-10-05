/**
 * Fixture data for the UI preview server, as real Prisma rows.
 *
 * Typed against the generated Prisma models and served through the real DTO
 * mappers, gate and ranking — so a preview exercises production code, and a
 * schema change that these rows no longer satisfy fails the typecheck instead
 * of drifting silently.
 *
 * The set covers every state the UI has to draw: fit, strong fit, consider,
 * do not proceed, not enough evidence, no technical questions asked, the
 * communication floor, failed, in progress, shortlisted, rejected, trashed,
 * a non-engineering role, and a recording with no name.
 */

import { Evaluation, InstructionPreset, Job, Prisma, Recording, Transcript } from "@prisma/client";

const DAY = 86_400_000;
export const ago = (days: number, hours = 0): Date => new Date(Date.now() - days * DAY - hours * 3_600_000);
const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Kind = "technical" | "behavioural" | "situational" | "experience" | "motivation";
type Verdict = "strong" | "adequate" | "weak" | "not_answered";
type Req = "met" | "partial" | "missing" | "not_discussed";
interface Q {
  kind: Kind;
  verdict: Verdict;
  score: number;
  question: string;
  answer: string;
  evidence: string;
}

// ── Jobs ─────────────────────────────────────────────────────────────
const SDE_JD = `Senior Data Engineer — Snowflake

About the role
You will own our analytics pipelines end to end, from ingestion to the warehouse models the commercial team reports from.

Responsibilities:
- Design and run batch and incremental pipelines on Snowflake
- Model historical data, including slowly changing dimensions
- Recover failed loads without duplicating data
- Orchestrate workflows with Airflow or an equivalent
- Explain trade-offs to non-technical stakeholders

Requirements:
- 5+ years building production data pipelines
- Strong SQL and Python; PySpark is a plus
- Hands-on Snowflake: sizing, scaling and cost control
- dbt or a similar transformation framework
- CI/CD for data pipelines`;

const CDM_JD = `Clinical Data Manager

Responsibilities:
- Own data management plans for phase II–III studies
- Design CRFs and edit checks with the study team
- Run data cleaning cycles and query management
- Prepare data for database lock

Requirements:
- 4+ years in clinical data management
- Working knowledge of CDISC (CDASH, SDTM)
- Experience with an EDC system such as Medidata Rave or Veeva
- Clear written communication with sites and sponsors`;

const BI_JD = `BI Analyst — Power BI

Responsibilities:
- Build and maintain Power BI dashboards for the commercial team
- Write DAX measures and model star schemas
- Translate business questions into metrics

Requirements:
- 3+ years in BI or analytics
- Strong DAX and data modelling
- SQL for data preparation`;

export const jobs: Job[] = [
  { id: uid(901), title: "Senior Data Engineer (Snowflake)", jdText: SDE_JD, department: "IDT", subCategory: "Data Engineering", archived: false, createdAt: ago(42), updatedAt: ago(14) },
  { id: uid(902), title: "Clinical Data Manager", jdText: CDM_JD, department: "RWE", subCategory: "RWE Analytics", archived: false, createdAt: ago(30), updatedAt: ago(30) },
  { id: uid(903), title: "BI Analyst (Power BI)", jdText: BI_JD, department: "IDT", subCategory: "BI & Visualization", archived: false, createdAt: ago(21), updatedAt: ago(21) },
  { id: uid(904), title: "Market Access Associate", jdText: "Market access associate supporting payer evidence dossiers and pricing submissions across three markets.", department: "Strategy Counselling", subCategory: "Market Access", archived: true, createdAt: ago(90), updatedAt: ago(60) },
];
const [SDE, CDM, BI] = jobs;

// ── Builders ─────────────────────────────────────────────────────────
const CATEGORY_NAMES = ["Communication Skills", "Technical Knowledge", "Problem Solving", "Cultural Fit", "Confidence & Clarity"];
const CATEGORY_TEXT: Record<string, { good: string; weak: string; next: string }> = {
  "Communication Skills": { good: "Understood throughout; answers went somewhere.", weak: "Hard to follow; answers circled without landing.", next: "Ask for a two-minute walkthrough of one project." },
  "Technical Knowledge": { good: "Correct on the technical questions asked.", weak: "Basics the role needs every day were wrong or missing.", next: "Probe depth on one topic in the video round." },
  "Problem Solving": { good: "Reasoned through the scenario in sensible steps.", weak: "Jumped to an answer without working through the problem.", next: "Give a short failure scenario to reason through." },
  "Cultural Fit": { good: "Described collaborating well under pressure.", weak: "Little sign of working with a team.", next: "Ask how they handle a disagreement." },
  "Confidence & Clarity": { good: "Steady and direct, without hedging.", weak: "Hesitant on things they claimed to know.", next: "No action." },
};

function evaluation(n: number, recordingId: string, s: {
  role: string;
  department: string;
  subCategory: string;
  overall: number | null;
  summary: string;
  coverage: string;
  categories: (number | null)[];
  questions: Q[] | null;
  technical: number | null;
  behavioural: number | null;
  qaSummary?: string;
  strengths: string[];
  gaps: string[];
  jd?: { fit: number | null; summary: string; reqs: [string, Req, string][] } | null;
  recommendation: string;
  createdAt: Date;
}): Evaluation {
  return {
    id: uid(n),
    recordingId,
    roleDesignation: s.role,
    department: s.department,
    subCategory: s.subCategory,
    classificationConfidence: "high",
    classificationRationale: `The questions and answers centre on ${s.subCategory.toLowerCase()} work for a ${s.role.toLowerCase()} role.`,
    overallScore: s.overall,
    overallSummary: s.summary,
    coverageNote: s.coverage,
    categoriesJson: CATEGORY_NAMES.map((name, i) => {
      const score = s.categories[i] ?? null;
      const t = CATEGORY_TEXT[name];
      return {
        name,
        score,
        summary: score === null ? "Not covered in this call." : score >= 60 ? t.good : t.weak,
        evidence: score === null ? "The interview never covered this." : score >= 60 ? "Answered the related questions directly and correctly." : "Struggled when the related question was put to them.",
        recommendation: t.next,
      };
    }) as unknown as Prisma.JsonValue,
    questionAssessmentJson: s.questions
      ? ({
          technicalScore: s.technical,
          behaviouralScore: s.behavioural,
          summary: s.qaSummary ?? "",
          questions: s.questions.map((q) => ({ question: q.question, kind: q.kind, answerSummary: q.answer, verdict: q.verdict, score: q.score, evidence: q.evidence })),
        } as unknown as Prisma.JsonValue)
      : null,
    strengths: s.strengths as unknown as Prisma.JsonValue,
    areasForImprovement: s.gaps as unknown as Prisma.JsonValue,
    jdMatchJson: s.jd
      ? ({ fitScore: s.jd.fit, verdictSummary: s.jd.summary, requirements: s.jd.reqs.map(([requirement, verdict, evidence]) => ({ requirement, verdict, evidence })) } as unknown as Prisma.JsonValue)
      : null,
    recommendation: s.recommendation,
    model: "gpt-5.4",
    createdAt: s.createdAt,
  };
}

function recording(n: number, r: Partial<Recording> & { originalFilename: string; importedAt: Date; status: Recording["status"] }): Recording {
  return {
    id: uid(n),
    storagePath: `preview-${n}.wav`,
    mimeType: "audio/mp4",
    durationSeconds: 1000,
    candidateName: null,
    notes: null,
    detectedRole: null,
    callSummary: null,
    autoImported: false,
    customInstructions: null,
    jobId: null,
    shortlistedAt: null,
    rejectedAt: null,
    phoneNumber: null,
    trashedAt: null,
    errorMessage: null,
    driveAudioFileId: null,
    driveTranscriptFileId: null,
    ...r,
  };
}

/** A diarized transcript with timings, built from the questions asked. */
function timedTranscript(n: number, recordingId: string, questions: Q[], createdAt: Date): Transcript {
  const segments: { speaker: string; start: number; end: number; text: string }[] = [];
  let t = 4;
  const say = (speaker: string, text: string, secs: number) => {
    segments.push({ speaker, start: t, end: t + secs, text });
    t += secs + 1.2;
  };
  say("A", "Hello?", 2);
  say("B", "Hi, this is Ananya from the talent team at Healthark. Is now still a good time for the screening call?", 6);
  say("A", "Yes, sure, please go ahead.", 3);
  say("B", "Great. Could you start with your current role and notice period?", 5);
  say("A", "I'm a data engineer with about six years' experience, mostly on Snowflake and Airflow. My notice period is sixty days, negotiable.", 14);
  for (const q of questions) {
    say("B", q.question, 7);
    say("A", q.evidence.replace(/ … /g, ", ").replace(/…/g, "") + ".", 52);
    say("B", "Okay, got it.", 2);
  }
  say("B", "That's all from my side. We'll come back to you after review. Any questions for me?", 7);
  say("A", "Just about the next steps — would the next round be a video call?", 5);
  say("B", "Yes, it would be a video interview with the hiring manager. Thanks for your time.", 6);
  return {
    id: uid(n),
    recordingId,
    text: segments.map((sg) => `Speaker ${sg.speaker}: ${sg.text}`).join("\n"),
    segmentsJson: segments as unknown as Prisma.JsonValue,
    model: "gpt-4o-transcribe-diarize",
    language: "en",
    createdAt,
  };
}

/** A plain transcript, as stored before timings were kept. */
function plainTranscript(n: number, recordingId: string, lines: [string, string][], createdAt: Date): Transcript {
  return {
    id: uid(n),
    recordingId,
    text: lines.map(([sp, text]) => `Speaker ${sp}: ${text}`).join("\n"),
    segmentsJson: null,
    model: "gpt-4o-transcribe-diarize",
    language: "en",
    createdAt,
  };
}

// ── Candidates ───────────────────────────────────────────────────────
export interface FixtureRow {
  rec: Recording;
  evaluation: Evaluation | null;
  transcript: Transcript | null;
}
export const rows: FixtureRow[] = [];

// 1. The reported call — three adequate technical answers, a clear fit.
{
  const id = uid(1);
  const imported = ago(2, 3);
  const questions: Q[] = [
    { kind: "technical", verdict: "adequate", score: 78, question: "How do you decide when to scale a Snowflake warehouse up versus out?", answer: "Up means a larger warehouse for heavier queries; out means a multi-cluster warehouse that adds clusters under concurrency and removes them as demand drops.", evidence: "scale up means medium to large, large to X large … add cluster when query start … remove when demand decreases" },
    { kind: "technical", verdict: "adequate", score: 80, question: "In your previous project, how did you handle historical data changes?", answer: "Type 2 slowly changing dimensions with start and end dates and a current flag, shown with a customer moving city.", evidence: "slowly changing dimensions … type two … maintain the start date and end date … current status" },
    { kind: "technical", verdict: "adequate", score: 76, question: "A pipeline fails mid-load. How do you restart without duplicating data?", answer: "Find the failed step, check source and schema, retry with backoff, restart from a checkpoint, then reconcile source and target counts.", evidence: "identify exactly which activity failed … exponential back off … restart from the checkpoint … validate source to target counts" },
    { kind: "behavioural", verdict: "adequate", score: 78, question: "Describe a disagreement with a teammate and how it was resolved.", answer: "Disagreed on a load schedule; compared both options on cost and agreed a trial week.", evidence: "we ran it both ways for a week and picked the cheaper one" },
    { kind: "experience", verdict: "adequate", score: 77, question: "Walk me through the project you are most proud of.", answer: "Moved a nightly batch to an incremental load and cut its run time.", evidence: "we moved it to incremental so it only picks the changed rows" },
    { kind: "motivation", verdict: "adequate", score: 76, question: "Why are you looking to move from your current role?", answer: "Wants larger-scale warehouse work than the current role offers.", evidence: "I want to work on bigger data volumes" },
  ];
  rows.push({
    rec: recording(1, { originalFilename: "Call recording 9000000000_20260928140212.m4a", importedAt: imported, status: "EVALUATED", candidateName: "Candidate A", durationSeconds: 1080, jobId: SDE.id, phoneNumber: "+91 90000 00000", customInstructions: "Just focus on technical questions asked in the call" }),
    evaluation: evaluation(101, id, {
      role: "Senior Data Engineer", department: "IDT", subCategory: "Data Engineering", overall: 76,
      summary: "Answered all three technical questions correctly and named the right concepts — multi-cluster scaling, Type 2 dimensions, checkpoint restart. Answers were general, as one minute per question allows.",
      coverage: "Covered warehouse scaling, historical data and failure recovery. Python, dbt and CI/CD were not discussed.",
      categories: [68, 78, 75, null, 70], questions, technical: 78, behavioural: 78,
      qaSummary: "Broadly correct on every technical question; general rather than deep.",
      strengths: ["Correct on every technical question asked", "Knows the standard pattern for historical data", "A sound recovery sequence for failed loads"],
      gaps: ["Answers stayed general — probe depth in the video round", "Python, dbt and CI/CD untested"],
      jd: { fit: 72, summary: "Meets the three requirements the call probed; three were never raised.", reqs: [["Warehouse sizing and scaling", "met", "Explained up versus out correctly."], ["Historical data handling", "met", "Described Type 2 dimensions with dates and a current flag."], ["Failure recovery without duplicate loads", "met", "Checkpoint restart plus reconciliation."], ["Workflow orchestration", "partial", "Mentioned retries, not scheduling or dependencies."], ["Python and PySpark", "not_discussed", "Never came up."], ["dbt", "not_discussed", "Never came up."], ["CI/CD for data pipelines", "not_discussed", "Never came up."]] },
      recommendation: "Hire — answered all three technical questions correctly", createdAt: new Date(imported.getTime() + 6 * 60_000),
    }),
    transcript: timedTranscript(201, id, questions, new Date(imported.getTime() + 4 * 60_000)),
  });
}

// 2. Strong fit, already moved to the next round.
{
  const id = uid(2);
  const imported = ago(5, 2);
  const questions: Q[] = [
    { kind: "technical", verdict: "strong", score: 90, question: "How would you control Snowflake costs for a team of fifty analysts?", answer: "Separate warehouses per workload, auto-suspend at sixty seconds, resource monitors with alerts, and query tagging to charge back.", evidence: "resource monitors at eighty percent … auto suspend sixty seconds … tag queries by team" },
    { kind: "technical", verdict: "strong", score: 88, question: "Explain how you would model a slowly changing customer address.", answer: "Type 2 with surrogate keys, effective dates and a current flag; merges via a staged diff.", evidence: "surrogate key … effective from, effective to … merge from a staged diff" },
    { kind: "technical", verdict: "adequate", score: 82, question: "How do you make a load idempotent?", answer: "Deterministic batch ids, delete-then-insert per partition, and a watermark table.", evidence: "delete the partition and insert … watermark table per source" },
    { kind: "situational", verdict: "strong", score: 86, question: "A stakeholder says the dashboard numbers are wrong an hour before a board meeting. What do you do?", answer: "Check freshness and row counts first, compare with the source, communicate a holding message, then fix.", evidence: "first freshness and counts … tell them what I know and when I'll know more" },
  ];
  rows.push({
    rec: recording(2, { originalFilename: "Rahul_Verma_screen.m4a", importedAt: imported, status: "EVALUATED", candidateName: "Rahul Verma", durationSeconds: 1210, jobId: SDE.id, phoneNumber: "+91 98200 11234", shortlistedAt: ago(4) }),
    evaluation: evaluation(102, id, {
      role: "Senior Data Engineer", department: "IDT", subCategory: "Data Engineering", overall: 87,
      summary: "Correct and specific on every technical question, with real numbers from their own work. Handled the stakeholder scenario calmly and in the right order.",
      coverage: "Covered cost control, modelling, idempotent loads and a stakeholder scenario. CI/CD was not discussed.",
      categories: [84, 88, 86, 80, 85], questions, technical: 87, behavioural: 86,
      strengths: ["Specific, correct cost-control practice", "Clear modelling of historical data", "Calm, ordered handling of a live incident"],
      gaps: ["CI/CD untested"],
      jd: { fit: 86, summary: "Meets five of seven requirements outright.", reqs: [["Warehouse sizing and scaling", "met", "Resource monitors and auto-suspend."], ["Historical data handling", "met", "Type 2 with surrogate keys."], ["Failure recovery without duplicate loads", "met", "Partition delete-then-insert with watermarks."], ["Workflow orchestration", "met", "Mentioned Airflow sensors and retries."], ["Python and PySpark", "partial", "Python yes; PySpark only mentioned."], ["dbt", "met", "Uses dbt incremental models."], ["CI/CD for data pipelines", "not_discussed", "Never came up."]] },
      recommendation: "Strong hire — specific and correct throughout", createdAt: new Date(imported.getTime() + 7 * 60_000),
    }),
    transcript: timedTranscript(202, id, questions, new Date(imported.getTime() + 5 * 60_000)),
  });
}

// 3. Consider — two of four technical answers landed.
{
  const id = uid(3);
  const imported = ago(1, 5);
  const questions: Q[] = [
    { kind: "technical", verdict: "adequate", score: 76, question: "What is the difference between a view and a materialised view?", answer: "A view runs the query each time; a materialised view stores the result and must be refreshed.", evidence: "view runs every time … materialised stores it but can be behind" },
    { kind: "technical", verdict: "weak", score: 48, question: "How would you get the latest record per customer in SQL?", answer: "Suggested GROUP BY with MAX on the date, then could not retrieve the other columns.", evidence: "group by customer and max date … then I would join, I think" },
    { kind: "technical", verdict: "adequate", score: 75, question: "What does Airflow do in your pipelines?", answer: "Schedules tasks, handles dependencies and retries failed tasks.", evidence: "it schedules and manages the dependencies … retries" },
    { kind: "technical", verdict: "weak", score: 44, question: "How would you size a Snowflake warehouse for a heavy nightly load?", answer: "Said to always use the largest size to be safe.", evidence: "I would just take the biggest one so it finishes" },
  ];
  rows.push({
    rec: recording(3, { originalFilename: "Sneha Iyer 01-10.m4a", importedAt: imported, status: "EVALUATED", candidateName: "Sneha Iyer", durationSeconds: 960, jobId: SDE.id }),
    evaluation: evaluation(103, id, {
      role: "Data Engineer", department: "IDT", subCategory: "Data Engineering", overall: 64,
      summary: "Knew the core concepts — views, orchestration — but two practical SQL and sizing answers were off. Worth a closer look rather than a straight advance.",
      coverage: "Covered SQL, Airflow and warehouse sizing. Historical data and failure recovery were not discussed.",
      categories: [72, 62, 58, null, 66], questions, technical: 61, behavioural: null,
      strengths: ["Correct on views and orchestration", "Clear, direct answers"],
      gaps: ["Latest-record-per-customer SQL pattern", "Warehouse sizing reasoning"],
      jd: { fit: 58, summary: "Partially meets the probed requirements; sizing was a gap.", reqs: [["Warehouse sizing and scaling", "missing", "Would always pick the largest size."], ["Strong SQL", "partial", "Views correct; window functions missing."], ["Workflow orchestration", "met", "Explained Airflow's role correctly."], ["Historical data handling", "not_discussed", "Never came up."]] },
      recommendation: "Maybe — half the basics landed", createdAt: new Date(imported.getTime() + 6 * 60_000),
    }),
    transcript: plainTranscript(203, id, [["A", "Hello?"], ["B", "Hi Sneha, this is Ananya from Healthark. Do you have fifteen minutes?"], ["A", "Yes."], ["B", "What is the difference between a view and a materialised view?"], ["A", "A view runs every time, the materialised one stores it but can be behind."], ["B", "How would you get the latest record per customer in SQL?"], ["A", "Group by customer and max date, then I would join, I think."]], new Date(imported.getTime() + 4 * 60_000)),
  });
}

// 4. Do not proceed — rejected by the recruiter.
{
  const id = uid(4);
  const imported = ago(9, 1);
  const questions: Q[] = [
    { kind: "technical", verdict: "weak", score: 40, question: "Explain a slowly changing dimension.", answer: "Described it as a table that is updated slowly.", evidence: "it is a dimension which changes slowly over time" },
    { kind: "technical", verdict: "not_answered", score: 15, question: "How do you prevent duplicates when a load is re-run?", answer: "Said they had not faced this.", evidence: "I haven't faced this in my project" },
    { kind: "technical", verdict: "weak", score: 45, question: "What is clustering in Snowflake?", answer: "Confused clustering keys with multi-cluster warehouses.", evidence: "clustering means more clusters for more users" },
    { kind: "technical", verdict: "adequate", score: 75, question: "What is the purpose of a staging layer?", answer: "Holds raw data before transformation so loads can be checked.", evidence: "raw data lands there first before we transform" },
  ];
  rows.push({
    rec: recording(4, { originalFilename: "arjun-mehta.m4a", importedAt: imported, status: "EVALUATED", candidateName: "Arjun Mehta", durationSeconds: 840, jobId: SDE.id, rejectedAt: ago(8) }),
    evaluation: evaluation(104, id, {
      role: "Data Engineer", department: "IDT", subCategory: "Data Engineering", overall: 44,
      summary: "Could explain a staging layer, but the core warehouse concepts the role relies on were wrong or unanswered.",
      coverage: "Covered modelling, idempotency, clustering and staging.",
      categories: [65, 42, 40, null, 55], questions, technical: 44, behavioural: null,
      strengths: ["Understands the role of a staging layer"],
      gaps: ["Slowly changing dimensions", "Idempotent loads", "Clustering keys versus multi-cluster warehouses"],
      jd: { fit: 38, summary: "Falls short on most probed requirements.", reqs: [["Historical data handling", "missing", "Could not explain SCDs."], ["Failure recovery without duplicate loads", "missing", "Had not faced it."], ["Warehouse sizing and scaling", "missing", "Confused clustering concepts."]] },
      recommendation: "No hire — core concepts wrong", createdAt: new Date(imported.getTime() + 5 * 60_000),
    }),
    transcript: plainTranscript(204, id, [["A", "Hello."], ["B", "Hi Arjun, Healthark talent team here. Explain a slowly changing dimension?"], ["A", "It is a dimension which changes slowly over time."]], new Date(imported.getTime() + 4 * 60_000)),
  });
}

// 5. Not enough evidence — a logistics-only call.
{
  const id = uid(5);
  const imported = ago(3, 6);
  rows.push({
    rec: recording(5, { originalFilename: "Kavya Nair quick call.m4a", importedAt: imported, status: "EVALUATED", candidateName: "Kavya Nair", durationSeconds: 310, jobId: CDM.id }),
    evaluation: evaluation(105, id, {
      role: "Clinical Data Manager", department: "RWE", subCategory: "RWE Analytics", overall: null,
      summary: "The call covered notice period, salary and availability only, so there is nothing to judge the candidate on.",
      coverage: "Only logistics were discussed — no questions about the work itself.",
      categories: [null, null, null, null, null], questions: null, technical: null, behavioural: null,
      strengths: [], gaps: ["Everything — the call asked nothing about the role"],
      jd: { fit: null, summary: "No requirement was probed.", reqs: [["Data management plans", "not_discussed", "Never came up."], ["CDISC knowledge", "not_discussed", "Never came up."], ["EDC experience", "not_discussed", "Never came up."]] },
      recommendation: "Insufficient evidence — re-interview", createdAt: new Date(imported.getTime() + 3 * 60_000),
    }),
    transcript: plainTranscript(205, id, [["A", "Hello?"], ["B", "Hi Kavya, just a quick call about your notice period and expected salary."], ["A", "Sure, it's thirty days."]], new Date(imported.getTime() + 2 * 60_000)),
  });
}

// 6. No technical questions asked, no job — decided on the call overall.
{
  const id = uid(6);
  const imported = ago(12, 2);
  const questions: Q[] = [
    { kind: "behavioural", verdict: "adequate", score: 78, question: "Tell me about a time you missed a deadline.", answer: "Flagged the risk early, re-scoped with the lead and delivered the core in time.", evidence: "I told my lead two days before and we cut the scope" },
    { kind: "experience", verdict: "strong", score: 86, question: "What did you own in your last role?", answer: "Owned the weekly commercial reporting end to end, including the refresh schedule.", evidence: "the whole weekly pack was mine, from the refresh to the review" },
    { kind: "motivation", verdict: "adequate", score: 76, question: "Why this role?", answer: "Wants to move closer to life-sciences data.", evidence: "I want to work with healthcare data" },
  ];
  rows.push({
    rec: recording(6, { originalFilename: "Vikram Singh.m4a", importedAt: imported, status: "EVALUATED", candidateName: "Vikram Singh", durationSeconds: 720, phoneNumber: "+91 99870 44512" }),
    evaluation: evaluation(106, id, {
      role: "Business Analyst", department: "IDT", subCategory: "BI & Visualization", overall: 78,
      summary: "Clear examples of ownership and handling a missed deadline. No technical questions were asked, so this rests on the call overall.",
      coverage: "Behavioural and experience questions only; no technical questions were asked.",
      categories: [80, null, 76, 78, 79], questions, technical: null, behavioural: 78,
      strengths: ["Owned a recurring report end to end", "Flags risk early"], gaps: ["Technical skills untested"],
      jd: null, recommendation: "Hire — strong behavioural evidence", createdAt: new Date(imported.getTime() + 5 * 60_000),
    }),
    transcript: plainTranscript(206, id, [["A", "Hello."], ["B", "Hi Vikram. Tell me about a time you missed a deadline."], ["A", "I told my lead two days before and we cut the scope."]], new Date(imported.getTime() + 3 * 60_000)),
  });
}

// 7. Failed.
rows.push({
  rec: recording(7, { originalFilename: "WhatsApp Audio 2026-10-03.opus", importedAt: ago(0, 9), status: "FAILED", candidateName: "Priya Raman", durationSeconds: 655, jobId: BI.id, errorMessage: "Transcription failed: the audio stream could not be decoded. Re-export the recording from the call app and upload it again." }),
  evaluation: null,
  transcript: null,
});

// 8. In progress.
rows.push({
  rec: recording(8, { originalFilename: "Imran Shaikh screening.m4a", importedAt: ago(0, 0.05), status: "TRANSCRIBING", candidateName: "Imran Shaikh", durationSeconds: 1140, jobId: SDE.id }),
  evaluation: null,
  transcript: null,
});

// 9. Strong fit for a non-engineering role.
{
  const id = uid(9);
  const imported = ago(6, 4);
  const questions: Q[] = [
    { kind: "technical", verdict: "strong", score: 90, question: "What goes into a data management plan?", answer: "Data flow, CRF completion guidelines, edit check specifications, query management and lock criteria.", evidence: "the DMP covers data flow, CCGs, edit checks, query process and lock criteria" },
    { kind: "technical", verdict: "adequate", score: 82, question: "How do CDASH and SDTM relate?", answer: "CDASH standardises collection on the CRF; SDTM standardises the tabulation submitted to regulators.", evidence: "CDASH is at collection, SDTM is what we submit" },
    { kind: "technical", verdict: "strong", score: 88, question: "How do you run a data cleaning cycle before lock?", answer: "Listings review, manual checks against the protocol, query resolution with sites, then a lock checklist.", evidence: "listings, then manual review, chase the queries, then the lock checklist" },
  ];
  rows.push({
    rec: recording(9, { originalFilename: "Neha Gupta CDM.m4a", importedAt: imported, status: "EVALUATED", candidateName: "Neha Gupta", durationSeconds: 1010, jobId: CDM.id, phoneNumber: "+91 97690 22871" }),
    evaluation: evaluation(109, id, {
      role: "Clinical Data Manager", department: "RWE", subCategory: "RWE Analytics", overall: 88,
      summary: "Precise on data management plans, CDISC standards and the cleaning cycle — exactly the basics this role needs.",
      coverage: "Covered DMPs, CDISC and data cleaning. EDC systems were not discussed.",
      categories: [86, 88, 84, null, 85], questions, technical: 87, behavioural: null,
      strengths: ["Complete picture of a data management plan", "Clear on CDASH versus SDTM", "Ordered cleaning cycle"],
      gaps: ["EDC system experience untested"],
      jd: { fit: 84, summary: "Meets three of four requirements; EDC experience was not raised.", reqs: [["Data management plans", "met", "Listed every core section."], ["CDISC knowledge", "met", "Explained CDASH and SDTM correctly."], ["Data cleaning and query management", "met", "Described the full cycle."], ["EDC experience", "not_discussed", "Never came up."]] },
      recommendation: "Strong hire", createdAt: new Date(imported.getTime() + 6 * 60_000),
    }),
    transcript: timedTranscript(209, id, questions, new Date(imported.getTime() + 4 * 60_000)),
  });
}

// 10. The communication floor — answered well, hard to follow.
{
  const id = uid(10);
  const imported = ago(15, 3);
  const questions: Q[] = [
    { kind: "technical", verdict: "adequate", score: 80, question: "How would you model sales targets against actuals in Power BI?", answer: "Separate fact tables sharing a date and product dimension, with DAX measures for variance.", evidence: "two facts, same date dimension … measure for variance" },
    { kind: "technical", verdict: "adequate", score: 78, question: "When would you use CALCULATE?", answer: "To change the filter context of a measure, for example year-to-date.", evidence: "calculate changes the filter … like YTD" },
    { kind: "technical", verdict: "adequate", score: 79, question: "How do you keep a dashboard fast?", answer: "Star schema, fewer visuals per page, and aggregations for large tables.", evidence: "star schema … less visuals … aggregation tables" },
  ];
  rows.push({
    rec: recording(10, { originalFilename: "Ankit Patel BI.m4a", importedAt: imported, status: "EVALUATED", candidateName: "Ankit Patel", durationSeconds: 890, jobId: BI.id }),
    evaluation: evaluation(110, id, {
      role: "BI Analyst", department: "IDT", subCategory: "BI & Visualization", overall: 74,
      summary: "Technically correct on modelling, DAX and performance, but answers were hard to follow and needed several repeats of the question.",
      coverage: "Covered modelling, DAX and performance.",
      categories: [30, 79, 72, null, 50], questions, technical: 79, behavioural: null,
      strengths: ["Correct DAX and modelling basics"], gaps: ["Clarity — answers repeatedly missed the question first time"],
      jd: { fit: 76, summary: "Meets the probed requirements.", reqs: [["DAX and data modelling", "met", "Correct on CALCULATE and star schemas."], ["Power BI dashboards", "met", "Sensible performance practice."], ["SQL for data preparation", "not_discussed", "Never came up."]] },
      recommendation: "Maybe — strong answers, unclear delivery", createdAt: new Date(imported.getTime() + 6 * 60_000),
    }),
    transcript: plainTranscript(210, id, [["A", "Yes hello."], ["B", "How would you model sales targets against actuals in Power BI?"], ["A", "Two facts, same date dimension, measure for variance."]], new Date(imported.getTime() + 4 * 60_000)),
  });
}

// 11. Weak, awaiting a decision.
{
  const id = uid(11);
  const imported = ago(18, 1);
  const questions: Q[] = [
    { kind: "technical", verdict: "weak", score: 42, question: "What is a star schema?", answer: "Described it as a schema with many tables.", evidence: "star schema has lot of tables connected" },
    { kind: "technical", verdict: "not_answered", score: 10, question: "What does a DAX measure do that a column does not?", answer: "Did not know.", evidence: "I am not sure about this one" },
    { kind: "technical", verdict: "weak", score: 50, question: "How do you refresh a dataset on a schedule?", answer: "Knew it was set in the service but not where or how.", evidence: "we set it in the service somewhere" },
  ];
  rows.push({
    rec: recording(11, { originalFilename: "Meera Pillai.m4a", importedAt: imported, status: "EVALUATED", candidateName: "Meera Pillai", durationSeconds: 700, jobId: BI.id }),
    evaluation: evaluation(111, id, {
      role: "BI Analyst", department: "IDT", subCategory: "BI & Visualization", overall: 41,
      summary: "Could not explain the modelling and DAX basics the role uses every day.",
      coverage: "Covered modelling, DAX and refresh.",
      categories: [62, 40, null, null, 48], questions, technical: 38, behavioural: null,
      strengths: [], gaps: ["Star schemas", "Measures versus columns", "Scheduled refresh"],
      jd: { fit: 35, summary: "Falls short on the probed requirements.", reqs: [["DAX and data modelling", "missing", "Could not explain measures."], ["Power BI dashboards", "partial", "Some awareness of the service."]] },
      recommendation: "No hire", createdAt: new Date(imported.getTime() + 5 * 60_000),
    }),
    transcript: null,
  });
}

// 12. In the trash.
rows.push({
  rec: recording(12, { originalFilename: "test upload do not use.m4a", importedAt: ago(25), status: "EVALUATED", candidateName: "Test upload", durationSeconds: 45, trashedAt: ago(24) }),
  evaluation: evaluation(112, uid(12), {
    role: "Unknown", department: "Other", subCategory: "Other", overall: null, summary: "Too short to evaluate.", coverage: "Nothing substantive.",
    categories: [null, null, null, null, null], questions: null, technical: null, behavioural: null, strengths: [], gaps: [], jd: null,
    recommendation: "Insufficient evidence", createdAt: ago(25),
  }),
  transcript: null,
});

// 13. A recent fit, awaiting a decision.
{
  const id = uid(13);
  const imported = ago(0, 4);
  const questions: Q[] = [
    { kind: "technical", verdict: "adequate", score: 77, question: "How do you test a dbt model?", answer: "Schema tests for not-null and uniqueness, plus a custom test on business rules.", evidence: "not null and unique tests … custom test for the business rule" },
    { kind: "technical", verdict: "strong", score: 86, question: "How do you load only changed rows from a source?", answer: "A watermark on updated-at, with a lookback window for late-arriving rows.", evidence: "watermark on updated at … two hour lookback for late rows" },
    { kind: "technical", verdict: "adequate", score: 76, question: "When would you choose PySpark over SQL?", answer: "For heavy row-level transformations or ML feature work SQL handles poorly.", evidence: "when it's row level heavy or for features" },
  ];
  rows.push({
    rec: recording(13, { originalFilename: "Rohan Das.m4a", importedAt: imported, status: "EVALUATED", candidateName: "Rohan Das", durationSeconds: 1150, jobId: SDE.id, phoneNumber: "+91 91234 56780" }),
    evaluation: evaluation(113, id, {
      role: "Data Engineer", department: "IDT", subCategory: "Data Engineering", overall: 80,
      summary: "Correct on testing, incremental loads and tool choice, with one specific, well-reasoned answer on late-arriving data.",
      coverage: "Covered dbt testing, incremental loads and PySpark. Snowflake sizing was not discussed.",
      categories: [76, 80, 78, 74, 77], questions, technical: 80, behavioural: null,
      strengths: ["Handles late-arriving data deliberately", "Tests models beyond the defaults"], gaps: ["Snowflake sizing untested"],
      jd: { fit: 78, summary: "Meets four of six requirements.", reqs: [["dbt", "met", "Schema and custom tests."], ["Failure recovery without duplicate loads", "met", "Watermarks with a lookback window."], ["Python and PySpark", "met", "Knows when to reach for PySpark."], ["Strong SQL", "partial", "Implied rather than shown."], ["Warehouse sizing and scaling", "not_discussed", "Never came up."], ["CI/CD for data pipelines", "not_discussed", "Never came up."]] },
      recommendation: "Hire", createdAt: new Date(imported.getTime() + 6 * 60_000),
    }),
    transcript: timedTranscript(213, id, questions, new Date(imported.getTime() + 4 * 60_000)),
  });
}

// 14. No name given — the file name stands in.
{
  const id = uid(14);
  const imported = ago(28, 2);
  const questions: Q[] = [
    { kind: "technical", verdict: "adequate", score: 76, question: "What is a primary key?", answer: "A column that uniquely identifies each row.", evidence: "it identifies each row uniquely" },
    { kind: "technical", verdict: "adequate", score: 75, question: "What is a join?", answer: "Combines rows from two tables on a matching column.", evidence: "joining two tables on a common column" },
  ];
  rows.push({
    rec: recording(14, { originalFilename: "Call recording 9812345678_20260907_101512.m4a", importedAt: imported, status: "EVALUATED", durationSeconds: 520, jobId: BI.id }),
    evaluation: evaluation(114, id, {
      role: "Junior Analyst", department: "IDT", subCategory: "BI & Visualization", overall: 75,
      summary: "Correct on the two basic SQL questions asked; a short call with little else.",
      coverage: "Only two technical questions were asked.",
      categories: [70, 75, null, null, 72], questions, technical: 75, behavioural: null,
      strengths: ["Basic SQL is sound"], gaps: ["Very little was tested"], jd: null,
      recommendation: "Hire — limited coverage", createdAt: new Date(imported.getTime() + 4 * 60_000),
    }),
    transcript: null,
  });
}

export const presets: InstructionPreset[] = [
  { id: uid(801), label: "Technical focus", text: "Just focus on technical questions asked in the call.", createdAt: ago(20), updatedAt: ago(20) },
  { id: uid(802), label: "Junior role", text: "This is a junior role — weigh fundamentals over depth, and do not expect production experience.", createdAt: ago(12), updatedAt: ago(12) },
];

/** A template for calls evaluated during a preview session. */
export function evaluationFor(recordingId: string, n: number): Evaluation {
  const template = rows[0].evaluation as Evaluation;
  return { ...template, id: uid(5000 + n), recordingId, createdAt: new Date() };
}
export const newId = (n: number): string => uid(6000 + n);
