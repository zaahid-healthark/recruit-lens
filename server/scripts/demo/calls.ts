/**
 * Four demo screening calls — the scripts, the jobs they were screened for,
 * and the evaluation each one earns under the current rubric.
 *
 * Written to look like Healthark's own pipeline: one role in each of four
 * departments, and one candidate in each of the outcomes the dashboard has to
 * show — moved to the next round, a Fit still waiting on you, a Consider, and
 * a rejection. Every evaluation obeys the scoring contract (verdict ranges,
 * category bindings, the gate), and build.ts refuses to load one that does
 * not, so the number on a demo report always means the decision beside it.
 *
 * The people are fictional. Phone numbers are deliberately left empty.
 */

import type { CandidateDecision, LlmEvaluationResult } from "@interview-evaluator/shared";

export type Voice = "Microsoft Zira Desktop" | "Microsoft David Desktop";

export interface DemoSpeaker {
  name: string;
  voice: Voice;
  /** SAPI speaking rate, -10 to 10. */
  rate: number;
}

export interface DemoJob {
  id: string;
  title: string;
  department: string;
  subCategory: string;
  jdText: string;
  createdDaysAgo: number;
}

export interface DemoCall {
  /** File stem under audio/. */
  key: string;
  recordingId: string;
  transcriptId: string;
  evaluationId: string;
  job: DemoJob;
  recruiter: DemoSpeaker;
  candidate: DemoSpeaker;
  imported: { daysAgo: number; hour: number; minute: number };
  minutesToReport: number;
  /** What the recruiter did after reading the report; null while it waits. */
  outcome: { kind: "next" | "rejected"; hoursAfterReport: number } | null;
  /** Asserted against the real gate when the demo loads. */
  expectedDecision: CandidateDecision;
  notes: string | null;
  /** The call, line by line, recruiter first. */
  turns: { who: "recruiter" | "candidate"; text: string }[];
  /** Exactly what the scoring model would return (snake_case). */
  evaluation: LlmEvaluationResult;
}

const id = (n: number): string => `de700000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ZIRA: Voice = "Microsoft Zira Desktop";
const DAVID: Voice = "Microsoft David Desktop";

// ── Jobs ─────────────────────────────────────────────────────────────

const AZURE_DE: DemoJob = {
  id: id(101),
  title: "Azure Data Engineer – Claims & EHR Pipelines",
  department: "IDT",
  subCategory: "Data Engineering",
  createdDaysAgo: 24,
  jdText: `Azure Data Engineer – Claims & EHR Pipelines
Team: Insights, Data & Technology (IDT)
Location: Pune or Gurugram, hybrid
Experience: 4–7 years

About the role
You will build and run the pipelines that turn raw pharmacy claims, medical claims and EHR extracts into analysis-ready datasets for our real-world evidence and commercial analytics teams.

What you will do
- Design incremental ingestion in Azure Data Factory with watermarking, retries and idempotent reruns.
- Build PySpark transformations on Databricks and keep them fast as volumes grow: skew, partitioning, file compaction.
- Model curated layers in Delta Lake, including MERGE-based upserts and SCD Type 2 dimensions.
- Apply PHI governance: Unity Catalog access control, column masking and de-identification in line with HIPAA and DPDP requirements.
- Ship pipeline changes through CI/CD in Azure DevOps.

What you bring
- 4+ years of data engineering, at least 2 on Azure and Databricks.
- Hands-on experience with healthcare claims or EHR data.
- Strong SQL, Python and PySpark.
- Nice to have: OMOP CDM, dbt, Great Expectations.`,
};

const RWE_BIOSTAT: DemoJob = {
  id: id(102),
  title: "Senior Biostatistician – Real-World Evidence (Oncology)",
  department: "RWE",
  subCategory: "Biostatistics",
  createdDaysAgo: 19,
  jdText: `Senior Biostatistician – Real-World Evidence (Oncology)
Practice: Real-World Evidence (RWE)
Location: Bengaluru, or remote within India
Experience: 5–8 years

About the role
You will lead the statistical design and analysis of retrospective studies on EHR-derived and registry data for oncology and rare-disease clients, from protocol to final report.

What you will do
- Write statistical analysis plans and own the analyses end to end.
- Control confounding with propensity score methods: matching, IPTW, overlap weights.
- Analyse time-to-event outcomes with Kaplan-Meier and Cox models, including their diagnostics.
- Recognise and design out the biases specific to real-world data, including immortal time, selection and information bias.
- Handle missing data with principled methods such as multiple imputation.
- Present results to client medical affairs and HEOR teams.

What you bring
- MSc or PhD in Biostatistics or Statistics; 5+ years, 2+ in RWE.
- Oncology real-world data experience: EHR-derived data, registries.
- Strong SAS and R.
- Nice to have: target trial emulation, external control arms.`,
};

const MARKET_ACCESS: DemoJob = {
  id: id(103),
  title: "Market Access Consultant – Oncology Launches",
  department: "Strategy Counselling",
  subCategory: "Market Access",
  createdDaysAgo: 28,
  jdText: `Market Access Consultant – Oncology Launches
Practice: Strategy Counselling
Location: Gurugram, hybrid
Experience: 3–6 years

About the role
You will help pharma and biotech clients secure access for new oncology therapies across the US and Europe: shaping the value story, preparing for HTA reviews, and advising on pricing and launch sequencing.

What you will do
- Plan HTA submissions and anticipate evidence requirements for NICE, G-BA and HAS.
- Interpret health-economic outputs — ICER, QALY, budget impact — and turn them into payer arguments.
- Build global value dossiers and payer value messages with medical and HEOR teams.
- Advise on European pricing dynamics, including international reference pricing and launch sequencing.
- Own client-ready storylines and slide decks.

What you bring
- 3+ years in market access, pricing or HEOR consulting, or in a pharma access team.
- Oncology launch experience.
- Working knowledge of health economics.
- Nice to have: US payer research, IRA price-negotiation impact assessments.`,
};

const FPA: DemoJob = {
  id: id(104),
  title: "FP&A Analyst – Pharma Commercial Forecasting",
  department: "Finance",
  subCategory: "FP&A",
  createdDaysAgo: 16,
  jdText: `FP&A Analyst – Pharma Commercial Forecasting
Team: Finance
Location: Gurugram
Experience: 2–5 years

About the role
You will own the revenue forecast and monthly performance reporting for the commercial brands we support, working with brand, sales and supply-chain teams.

What you will do
- Build patient-based and driver-based forecasts for in-market and pre-launch brands.
- Model gross-to-net: trade discounts, rebates, chargebacks and returns, with monthly accruals and true-ups.
- Explain performance against plan with price, volume and mix variance for the monthly business review.
- Run the annual operating plan with brand and sales leads.
- Present drivers and risks clearly to non-finance stakeholders.

What you bring
- 2+ years in FP&A, ideally in pharma or healthcare.
- Advanced Excel modelling; Power BI or Anaplan is a plus.
- CA, CFA or MBA (Finance) preferred.`,
};

export const DEMO_JOBS: DemoJob[] = [AZURE_DE, RWE_BIOSTAT, MARKET_ACCESS, FPA];

// ── Calls ────────────────────────────────────────────────────────────

const siddharth: DemoCall = {
  key: "siddharth-menon",
  recordingId: id(201),
  transcriptId: id(301),
  evaluationId: id(401),
  job: AZURE_DE,
  recruiter: { name: "Ananya", voice: ZIRA, rate: 0 },
  candidate: { name: "Siddharth Menon", voice: DAVID, rate: 0 },
  imported: { daysAgo: 7, hour: 11, minute: 42 },
  minutesToReport: 5,
  outcome: { kind: "next", hoursAfterReport: 20 },
  expectedDecision: "advance",
  notes: "Referred by Nikhil from IDT. Can join in 30 days if his manager releases him early.",
  turns: [
    { who: "recruiter", text: "Hi, am I speaking with Siddharth Menon?" },
    { who: "candidate", text: "Yes, speaking. Hi." },
    {
      who: "recruiter",
      text: "Hi Siddharth, this is Ananya from the talent acquisition team at Healthark. You applied for the Azure Data Engineer role on our claims and EHR pipelines team. Is this a good time for a fifteen minute screening call?",
    },
    { who: "candidate", text: "Yes, absolutely. Please go ahead." },
    { who: "recruiter", text: "Great. Could you quickly walk me through your current role?" },
    {
      who: "candidate",
      text: "Sure. I'm a data engineer at a health tech analytics company in Pune, with about five years of experience. For the last two years I've been building ingestion pipelines for pharmacy and medical claims on Azure. Data Factory for orchestration, Databricks with PySpark for the transformations, and Delta Lake as the storage layer. We process roughly forty million claim lines a month.",
    },
    { who: "recruiter", text: "That's helpful. And what are your notice period and expected compensation?" },
    {
      who: "candidate",
      text: "My notice period is sixty days, but my manager has agreed to release me in thirty. My current CTC is twenty one lakhs, and I'm expecting around twenty eight.",
    },
    {
      who: "recruiter",
      text: "Noted. Our engineering team has shared a few technical questions. First one. Claims often arrive late, or get adjusted after they're paid. How would you handle late arriving or corrected claims in a Delta table?",
    },
    {
      who: "candidate",
      text: "I'd land the raw files in a bronze layer as they are, then use a Delta MERGE on the claim ID and line number into silver. Adjustments come with a version number or an adjudication date, so the MERGE only updates when the incoming record is newer. For the patient and provider dimensions I keep SCD Type 2, with effective from and effective to dates, so historical reports don't change when an address changes.",
    },
    {
      who: "recruiter",
      text: "So, MERGE on the business key, and only take the newer version. Got it. Second question. How do you design incremental loads in Data Factory, and what happens when a run fails halfway?",
    },
    {
      who: "candidate",
      text: "I use a watermark table. Each source has a last loaded timestamp, the copy activity filters on modified date greater than the watermark, and the watermark only moves after the downstream notebook succeeds. So if a run fails halfway, the watermark hasn't moved, and the rerun picks up the same window. Because the load itself is a MERGE, rerunning it is idempotent, and we don't get duplicates.",
    },
    {
      who: "recruiter",
      text: "Okay. Third one. A Databricks job that used to take twenty minutes now takes two hours. Where do you look first?",
    },
    {
      who: "candidate",
      text: "First the Spark UI, to find the slow stage. Usually it's data skew, one payer or one large provider with far more rows than the rest, so a few tasks run forever. I'd check the partition sizes, salt the skewed key, or turn on adaptive query execution with skew join handling. I'd also check for small files. Running OPTIMIZE with Z ORDER on the columns we filter by, like service date, helps a lot.",
    },
    { who: "recruiter", text: "Sorry, come again, the last part?" },
    {
      who: "candidate",
      text: "OPTIMIZE with Z ORDER on service date. It compacts the small files and clusters the data, so queries can skip files.",
    },
    {
      who: "recruiter",
      text: "Got it, thanks. Last one. This data includes PHI. How do you control access to it on the platform?",
    },
    {
      who: "candidate",
      text: "We keep direct identifiers in a separate restricted schema, and analysts only see tokenized patient IDs. Access goes through Unity Catalog groups, with column masking on fields like date of birth and ZIP code. Secrets live in Key Vault, never in notebooks. I haven't written the de-identification rules myself, our compliance team owns those, but I implemented the masking.",
    },
    {
      who: "recruiter",
      text: "That covers everything from my side. The hiring manager will review the report, and if it's a fit we'll schedule the technical round. Do you have any questions for me?",
    },
    { who: "candidate", text: "Just one. Is the team working more on claims or on EHR data right now?" },
    {
      who: "recruiter",
      text: "Mostly claims this quarter, with an EHR integration starting next quarter. Thanks for your time, Siddharth.",
    },
    { who: "candidate", text: "Thank you, Ananya. Have a good day." },
  ],
  evaluation: {
    role_designation: "Azure Data Engineer",
    department: "IDT",
    sub_category: "Data Engineering",
    classification_confidence: "high",
    classification_rationale:
      "Azure Data Factory, Databricks and Delta Lake pipeline work on healthcare claims places this squarely in IDT's Data Engineering sub-category.",
    overall_score: 84,
    overall_summary:
      "Answered every technical question correctly and specifically: MERGE on the claim key with a version check for corrected claims, watermark-gated Data Factory loads that rerun idempotently, and a methodical Spark UI, skew, then small-files diagnosis. PHI handling was sound on access control and masking; de-identification is owned by his compliance team.",
    coverage_note:
      "Covered claims ingestion, incremental loading, Databricks performance and PHI access control. CI/CD, SQL depth and EHR-specific modelling were not discussed.",
    categories: [
      {
        name: "Communication Skills",
        score: 82,
        summary: "Clear and structured; every answer went straight to the mechanism.",
        evidence: "Restated the OPTIMIZE and Z-ORDER point concisely when asked to repeat it over a patchy line.",
        recommendation: "No follow-up needed on communication.",
      },
      {
        name: "Technical Knowledge",
        score: 85,
        summary: "Correct on all four technical questions, three with real specifics.",
        evidence: "Delta MERGE on claim ID and line taking only newer versions; watermark advanced only after the downstream notebook succeeds; skew salting, AQE skew joins and Z-ORDER on service date.",
        recommendation: "In the technical round, probe CI/CD in Azure DevOps and EHR data modelling.",
      },
      {
        name: "Problem Solving",
        score: 84,
        summary: "Diagnosed the slow-job scenario in a sensible order rather than guessing.",
        evidence: "Started from the Spark UI to find the slow stage, then checked skew, then small files.",
        recommendation: "Give a live debugging scenario in the next round.",
      },
      {
        name: "Cultural Fit",
        score: null,
        summary: "Not covered in this call.",
        evidence: "No questions about teamwork, values or working style came up.",
        recommendation: "Cover collaboration with analysts and compliance in the next round.",
      },
      {
        name: "Confidence & Clarity",
        score: 83,
        summary: "Confident without overclaiming.",
        evidence: "Said plainly that compliance owns the de-identification rules and that he implemented the masking.",
        recommendation: "None.",
      },
    ],
    question_assessment: {
      questions: [
        {
          question: "Walk me through your current role.",
          kind: "experience",
          answer_summary: "Five years; two building Azure claims pipelines with Data Factory, Databricks and Delta Lake at about forty million claim lines a month.",
          verdict: "adequate",
          score: 82,
          evidence: "Data Factory for orchestration, Databricks with PySpark for the transformations, and Delta Lake as the storage layer.",
        },
        {
          question: "How would you handle late-arriving or corrected claims in a Delta table?",
          kind: "technical",
          answer_summary: "Bronze landing, then a Delta MERGE on claim ID and line that only applies newer versions; SCD Type 2 for patient and provider dimensions.",
          verdict: "strong",
          score: 88,
          evidence: "The MERGE only updates when the incoming record is newer.",
        },
        {
          question: "How do you design incremental loads in Data Factory, and what happens when a run fails halfway?",
          kind: "technical",
          answer_summary: "A watermark table filtered on modified date, advanced only after downstream success, so reruns pick up the same window idempotently.",
          verdict: "strong",
          score: 86,
          evidence: "The watermark only moves after the downstream notebook succeeds.",
        },
        {
          question: "A Databricks job went from twenty minutes to two hours. Where do you look first?",
          kind: "technical",
          answer_summary: "Spark UI to find the slow stage, then skew (salting, AQE skew joins), then small files (OPTIMIZE with Z-ORDER).",
          verdict: "strong",
          score: 87,
          evidence: "Usually it's data skew, one payer or one large provider with far more rows than the rest.",
        },
        {
          question: "This data includes PHI. How do you control access to it on the platform?",
          kind: "technical",
          answer_summary: "Restricted identifier schema, tokenized IDs, Unity Catalog groups with column masking, secrets in Key Vault; de-identification owned by compliance.",
          verdict: "adequate",
          score: 79,
          evidence: "I haven't written the de-identification rules myself, our compliance team owns those, but I implemented the masking.",
        },
      ],
      technical_score: 85,
      behavioural_score: null,
      summary: "Four of four technical answers landed: three strong, one adequate.",
    },
    strengths: [
      "Corrected claims handled with a MERGE on claim ID and line that only applies newer versions",
      "Idempotent reruns: the watermark advances only after downstream success",
      "Systematic performance diagnosis: skew salting, AQE skew joins, OPTIMIZE with Z-ORDER",
    ],
    areas_for_improvement: [
      "Has implemented masking but not de-identification rules; probe Safe Harbor versus expert determination",
      "CI/CD for pipelines in Azure DevOps was not covered",
      "No evidence yet on EHR data modelling, such as OMOP",
    ],
    recommendation:
      "Hire — answered all four technical questions correctly, with specifics on MERGE-based upserts, watermark recovery and skew; worth the next round.",
    jd_match: {
      fit_score: 84,
      verdict_summary:
        "Strong match on Data Factory, Databricks and Delta Lake, with directly relevant claims experience. PHI governance is partial: masking yes, de-identification no. CI/CD and SQL depth were not probed.",
      requirements: [
        { requirement: "Incremental ingestion in Azure Data Factory with watermarking and idempotent reruns", verdict: "met", evidence: "Watermark advanced only after downstream success; MERGE makes reruns idempotent." },
        { requirement: "PySpark on Databricks, including performance tuning", verdict: "met", evidence: "Spark UI, skew salting, AQE skew joins, OPTIMIZE with Z-ORDER." },
        { requirement: "Delta Lake modelling with MERGE upserts and SCD Type 2", verdict: "met", evidence: "MERGE on claim ID and line; SCD Type 2 for patient and provider dimensions." },
        { requirement: "Hands-on healthcare claims or EHR data", verdict: "met", evidence: "Two years of pharmacy and medical claims pipelines at about forty million lines a month." },
        { requirement: "PHI governance: access control, masking, de-identification", verdict: "partial", evidence: "Unity Catalog groups and column masking implemented; de-identification rules owned by compliance." },
        { requirement: "CI/CD for pipelines in Azure DevOps", verdict: "not_discussed", evidence: "Never came up in the call." },
        { requirement: "Strong SQL", verdict: "not_discussed", evidence: "No SQL question was asked." },
      ],
    },
  },
};

const kavitha: DemoCall = {
  key: "kavitha-raghunathan",
  recordingId: id(202),
  transcriptId: id(302),
  evaluationId: id(402),
  job: RWE_BIOSTAT,
  recruiter: { name: "Karthik", voice: DAVID, rate: 0 },
  candidate: { name: "Kavitha Raghunathan", voice: ZIRA, rate: -1 },
  imported: { daysAgo: 2, hour: 15, minute: 8 },
  minutesToReport: 6,
  outcome: null,
  expectedDecision: "borderline",
  notes: "Ninety-day notice, may negotiate to sixty. Prefers remote.",
  turns: [
    { who: "recruiter", text: "Hello, is this Kavitha Raghunathan?" },
    { who: "candidate", text: "Yes, this is Kavitha." },
    {
      who: "recruiter",
      text: "Hi Kavitha, Karthik here, from Healthark's talent team. I'm calling about the Senior Biostatistician role in our real world evidence practice. Do you have about fifteen minutes now?",
    },
    { who: "candidate", text: "Yes, I do. Please go ahead." },
    { who: "recruiter", text: "Thanks. Could you tell me briefly about your current work?" },
    {
      who: "candidate",
      text: "I'm a biostatistician at a CRO in Bengaluru, with six years of experience. For the last three years I've worked on oncology real world studies, mostly on EHR derived data for non small cell lung cancer and multiple myeloma. I write the statistical analysis plans, program in SAS and R, and present the results to our sponsors' medical affairs teams.",
    },
    { who: "recruiter", text: "And your notice period?" },
    { who: "candidate", text: "Ninety days, unfortunately. I can try to negotiate it down to sixty." },
    {
      who: "recruiter",
      text: "Okay, noted. The practice lead has shared four technical questions. First. When would you use propensity score matching, versus inverse probability of treatment weighting?",
    },
    {
      who: "candidate",
      text: "Both balance the confounders between treatment groups. Matching is intuitive and easy to explain, but you lose the unmatched patients, so the sample shrinks, and you're estimating the effect in the treated. IPTW keeps everyone and estimates the average treatment effect in the whole population, but extreme weights can make it unstable, so I check the weight distribution and trim or stabilize them. Either way, I check balance with standardized mean differences under point one.",
    },
    { who: "recruiter", text: "Got it. Second. What is immortal time bias, and how would you avoid it in an EHR cohort?" },
    {
      who: "candidate",
      text: "Immortal time bias is when patients are lost to follow up before the study ends, so their outcomes are missing. I would handle it by censoring at the last visit, and maybe a sensitivity analysis excluding patients with short follow up.",
    },
    {
      who: "recruiter",
      text: "Okay, so censoring at the last visit. Third. You have overall survival for two treatment groups. How do you compare them, and how do you check that a Cox model is appropriate?",
    },
    {
      who: "candidate",
      text: "I'd start with Kaplan Meier curves and a log rank test, then a Cox model adjusted for the confounders. For the proportional hazards assumption I'd look at Schoenfeld residuals and log minus log plots. If the hazards cross, I'd consider time varying coefficients, or restricted mean survival time.",
    },
    {
      who: "recruiter",
      text: "Great. And the last one. About thirty percent of baseline ECOG scores are missing. What would you do?",
    },
    {
      who: "candidate",
      text: "I would probably use multiple imputation, or just add a missing category. It depends on the data. We usually go with what the sponsor prefers.",
    },
    { who: "recruiter", text: "Could you say a bit more about when multiple imputation is appropriate?" },
    { who: "candidate", text: "When the data is missing at random, I think. Honestly, I'd need to look at the dataset first." },
    {
      who: "recruiter",
      text: "Understood. That's all the questions from my end. The practice lead will review your profile, and we'll get back to you within the week. Anything you'd like to ask?",
    },
    { who: "candidate", text: "Is the role mostly oncology?" },
    {
      who: "recruiter",
      text: "Oncology is about half the portfolio, the rest is immunology and rare diseases. Thanks a lot, Kavitha.",
    },
    { who: "candidate", text: "Thank you, Karthik. Bye." },
  ],
  evaluation: {
    role_designation: "Senior Biostatistician (Real-World Evidence)",
    department: "RWE",
    sub_category: "Biostatistics",
    classification_confidence: "high",
    classification_rationale:
      "Propensity methods, survival analysis and missing-data handling on oncology real-world data are core Biostatistics work in the RWE practice.",
    overall_score: 66,
    overall_summary:
      "Strong on confounding control and survival analysis: she weighed matching against IPTW with balance diagnostics, and named Schoenfeld residuals and RMST for non-proportional hazards. Two of four answers missed: immortal time bias was confused with loss to follow-up, and the missing-ECOG answer did not get past 'it depends'.",
    coverage_note:
      "Covered propensity methods, immortal time bias, time-to-event analysis and missing data. SAS and R programming depth and SAP writing were not tested.",
    categories: [
      {
        name: "Communication Skills",
        score: 80,
        summary: "Explained the methods she knew clearly and in plain terms.",
        evidence: "Laid out the matching versus IPTW trade-off in a few sentences a client could follow.",
        recommendation: "None.",
      },
      {
        name: "Technical Knowledge",
        score: 65,
        summary: "Two answers solid, two wrong or vague.",
        evidence: "Correct on propensity methods and proportional-hazards diagnostics; described immortal time bias as loss to follow-up; unsure when multiple imputation applies.",
        recommendation: "Re-test real-world-data bias and missing-data methods with a worked cohort example.",
      },
      {
        name: "Problem Solving",
        score: 62,
        summary: "Strong where the method was familiar; fell back on the sponsor's preference elsewhere.",
        evidence: "On missing ECOG: 'We usually go with what the sponsor prefers.'",
        recommendation: "Give an open-ended study-design problem in the next round.",
      },
      {
        name: "Cultural Fit",
        score: null,
        summary: "Not covered in this call.",
        evidence: "No questions about teamwork or working style came up.",
        recommendation: "Cover client-facing work and collaboration with HEOR in the next round.",
      },
      {
        name: "Confidence & Clarity",
        score: 66,
        summary: "Confident on familiar ground; hesitant on the last two questions.",
        evidence: "'Honestly, I'd need to look at the dataset first.'",
        recommendation: "None beyond the technical follow-ups.",
      },
    ],
    question_assessment: {
      questions: [
        {
          question: "Tell me briefly about your current work.",
          kind: "experience",
          answer_summary: "Six years at a CRO; three on oncology real-world studies (NSCLC, multiple myeloma) on EHR-derived data, writing SAPs and presenting to sponsors.",
          verdict: "adequate",
          score: 82,
          evidence: "I write the statistical analysis plans, program in SAS and R, and present the results to our sponsors' medical affairs teams.",
        },
        {
          question: "When would you use propensity score matching versus IPTW?",
          kind: "technical",
          answer_summary: "Matching estimates the effect in the treated and drops unmatched patients; IPTW keeps everyone for the ATE but needs weight checks; balance via SMD under 0.1.",
          verdict: "strong",
          score: 86,
          evidence: "Extreme weights can make it unstable, so I check the weight distribution and trim or stabilize them.",
        },
        {
          question: "What is immortal time bias, and how would you avoid it in an EHR cohort?",
          kind: "technical",
          answer_summary: "Described it as loss to follow-up and proposed censoring at the last visit — a different problem. Did not mention aligning time zero with treatment start.",
          verdict: "weak",
          score: 42,
          evidence: "Immortal time bias is when patients are lost to follow up before the study ends.",
        },
        {
          question: "How do you compare overall survival between two groups, and check that a Cox model is appropriate?",
          kind: "technical",
          answer_summary: "Kaplan-Meier and log-rank, adjusted Cox model; Schoenfeld residuals and log-minus-log plots; time-varying coefficients or RMST if hazards cross.",
          verdict: "adequate",
          score: 83,
          evidence: "If the hazards cross, I'd consider time varying coefficients, or restricted mean survival time.",
        },
        {
          question: "About thirty percent of baseline ECOG scores are missing. What would you do?",
          kind: "technical",
          answer_summary: "Multiple imputation or a missing-indicator category, deferring to the sponsor; unsure of when imputation is appropriate beyond 'missing at random, I think'.",
          verdict: "weak",
          score: 48,
          evidence: "When the data is missing at random, I think. Honestly, I'd need to look at the dataset first.",
        },
      ],
      technical_score: 65,
      behavioural_score: null,
      summary: "Two of four technical answers landed: propensity methods and survival analysis were solid; immortal time bias and missing data were not.",
    },
    strengths: [
      "Clear matching versus IPTW trade-off, including weight trimming and SMD balance checks",
      "Knows the proportional-hazards diagnostics and the alternatives when hazards cross",
      "Directly relevant oncology real-world data background (NSCLC, multiple myeloma)",
    ],
    areas_for_improvement: [
      "Defined immortal time bias as loss to follow-up — a core RWE design concept worth re-testing",
      "Unsure when multiple imputation applies, and offered a missing-indicator category",
      "Ninety-day notice period",
    ],
    recommendation:
      "Maybe — solid on propensity methods and survival analysis, but the immortal-time-bias answer described loss to follow-up and the missing-data answer stayed vague.",
    jd_match: {
      fit_score: 63,
      verdict_summary:
        "Matches the role on propensity methods, survival analysis and oncology real-world data. Falls short on real-world-data bias and is unclear on missing-data methods. Programming depth and SAP writing were not probed.",
      requirements: [
        { requirement: "Propensity score methods: matching, IPTW, overlap weights", verdict: "met", evidence: "Explained the estimand difference, weight trimming and SMD balance checks." },
        { requirement: "Time-to-event analysis with Kaplan-Meier, Cox and diagnostics", verdict: "met", evidence: "Schoenfeld residuals, log-minus-log plots, RMST when hazards cross." },
        { requirement: "Designing out real-world-data biases, including immortal time", verdict: "missing", evidence: "Defined immortal time bias as loss to follow-up." },
        { requirement: "Missing-data methods such as multiple imputation", verdict: "partial", evidence: "Named multiple imputation and MAR, but could not say when it applies." },
        { requirement: "Oncology real-world data experience", verdict: "met", evidence: "Three years on EHR-derived NSCLC and multiple myeloma studies." },
        { requirement: "Strong SAS and R", verdict: "partial", evidence: "Says she programs in both daily; no programming question was asked." },
        { requirement: "Presenting results to medical affairs and HEOR teams", verdict: "met", evidence: "Presents results to sponsors' medical affairs teams." },
      ],
    },
  },
};

const arjun: DemoCall = {
  key: "arjun-malhotra",
  recordingId: id(203),
  transcriptId: id(303),
  evaluationId: id(403),
  job: MARKET_ACCESS,
  recruiter: { name: "Ananya", voice: ZIRA, rate: 0 },
  candidate: { name: "Arjun Malhotra", voice: DAVID, rate: 1 },
  imported: { daysAgo: 9, hour: 12, minute: 26 },
  minutesToReport: 6,
  outcome: { kind: "rejected", hoursAfterReport: 26 },
  expectedDecision: "reject",
  notes: "Applied through LinkedIn. Currently at a commercial strategy boutique.",
  turns: [
    { who: "recruiter", text: "Hi, is this Arjun Malhotra?" },
    { who: "candidate", text: "Yes, hi." },
    {
      who: "recruiter",
      text: "Hi Arjun, this is Ananya from Healthark's talent acquisition team. I'm calling about the Market Access Consultant role in our strategy counselling practice. Is now a good time?",
    },
    { who: "candidate", text: "Sure, I have time." },
    { who: "recruiter", text: "Great. Tell me a bit about your background." },
    {
      who: "candidate",
      text: "I have about four years of experience. I started in pharma sales with a mid sized company, then moved to a consulting firm two years ago, where I work on commercial strategy projects. Recently I supported a launch readiness project for a biosimilar, mainly on the forecasting and the slides.",
    },
    { who: "recruiter", text: "And your current notice period?" },
    { who: "candidate", text: "Thirty days." },
    {
      who: "recruiter",
      text: "Perfect. The practice has shared a few technical questions. First. What does an HTA body like NICE assess when it reviews a new oncology drug?",
    },
    {
      who: "candidate",
      text: "They mainly look at whether the drug is safe, and whether the price is fair compared to other countries. And they check if doctors will actually use it.",
    },
    { who: "recruiter", text: "Okay. Second. Can you explain what an ICER is, and how it's used?" },
    { who: "candidate", text: "ICER. I've heard the term, it's a cost metric. I don't remember the exact formula, honestly." },
    { who: "recruiter", text: "No problem. Third. What goes into a global value dossier?" },
    {
      who: "candidate",
      text: "A value dossier has the disease background and burden of illness, the clinical trial results, the economic case, like budget impact and cost effectiveness, and the key value messages for payers. Each country team then adapts it for their local submission.",
    },
    {
      who: "recruiter",
      text: "Got it. Last one. How does international reference pricing affect the launch sequence in Europe?",
    },
    { who: "candidate", text: "I'm not sure about that one. I think companies launch everywhere at the same time, if they can?" },
    {
      who: "recruiter",
      text: "Okay, thanks. Just to confirm, for the dossier you said disease burden, clinical evidence, the economic case and payer messages, right?",
    },
    { who: "candidate", text: "Yes, exactly." },
    {
      who: "recruiter",
      text: "Alright, that's all from me today. We'll share the feedback once the practice lead has reviewed the call. Any questions?",
    },
    { who: "candidate", text: "No, I'm good. Thank you." },
    { who: "recruiter", text: "Thanks, Arjun. Have a nice day." },
  ],
  evaluation: {
    role_designation: "Market Access Consultant",
    department: "Strategy Counselling",
    sub_category: "Market Access",
    classification_confidence: "high",
    classification_rationale:
      "HTA, health economics, value dossiers and European pricing are Market Access topics within the Strategy Counselling practice.",
    overall_score: 43,
    overall_summary:
      "Only one of four technical answers landed: a correct outline of a global value dossier. HTA assessment was described as a safety and price comparison rather than clinical benefit and cost-effectiveness, ICER could not be explained, and the reference-pricing answer was a guess.",
    coverage_note:
      "Covered HTA, health economics, value dossiers and European pricing. US payer access and client storylining were not tested.",
    categories: [
      {
        name: "Communication Skills",
        score: 70,
        summary: "Easy to follow and polite; answers were short.",
        evidence: "Gave the dossier structure in one clear sentence and confirmed it when the recruiter read it back.",
        recommendation: "None.",
      },
      {
        name: "Technical Knowledge",
        score: 41,
        summary: "One answer correct; the health-economics and pricing basics the role needs were missing.",
        evidence: "Could not explain ICER; described HTA as a price comparison; guessed that companies launch everywhere at once.",
        recommendation: "Not a fit for this role as scoped; a junior analyst role could be considered.",
      },
      {
        name: "Problem Solving",
        score: 45,
        summary: "Guessed rather than reasoning from what he knew.",
        evidence: "'I think companies launch everywhere at the same time, if they can?'",
        recommendation: "None.",
      },
      {
        name: "Cultural Fit",
        score: null,
        summary: "Not covered in this call.",
        evidence: "No questions about teamwork or working style came up.",
        recommendation: "None.",
      },
      {
        name: "Confidence & Clarity",
        score: 52,
        summary: "Candid about gaps, but hedged on most technical answers.",
        evidence: "'I've heard the term, it's a cost metric. I don't remember the exact formula, honestly.'",
        recommendation: "None.",
      },
    ],
    question_assessment: {
      questions: [
        {
          question: "Tell me a bit about your background.",
          kind: "experience",
          answer_summary: "Four years: pharma sales, then two years of commercial strategy consulting, including a biosimilar launch-readiness project on forecasting and slides.",
          verdict: "adequate",
          score: 76,
          evidence: "Recently I supported a launch readiness project for a biosimilar, mainly on the forecasting and the slides.",
        },
        {
          question: "What does an HTA body like NICE assess when it reviews a new oncology drug?",
          kind: "technical",
          answer_summary: "Safety, price fairness against other countries, and physician uptake — missing clinical benefit and cost-effectiveness.",
          verdict: "weak",
          score: 50,
          evidence: "They mainly look at whether the drug is safe, and whether the price is fair compared to other countries.",
        },
        {
          question: "Can you explain what an ICER is and how it's used?",
          kind: "technical",
          answer_summary: "Recognised the term as a cost metric but could not explain it.",
          verdict: "not_answered",
          score: 15,
          evidence: "I don't remember the exact formula, honestly.",
        },
        {
          question: "What goes into a global value dossier?",
          kind: "technical",
          answer_summary: "Burden of illness, clinical evidence, the economic case and payer value messages, adapted by country teams.",
          verdict: "adequate",
          score: 78,
          evidence: "Each country team then adapts it for their local submission.",
        },
        {
          question: "How does international reference pricing affect the launch sequence in Europe?",
          kind: "technical",
          answer_summary: "Said he was not sure and guessed at simultaneous launches — the opposite of the usual sequencing logic.",
          verdict: "not_answered",
          score: 20,
          evidence: "I'm not sure about that one.",
        },
      ],
      technical_score: 41,
      behavioural_score: null,
      summary: "One of four technical answers landed (the value dossier); ICER and reference pricing were not answered.",
    },
    strengths: [
      "Correct structure for a global value dossier",
      "Some launch exposure from a biosimilar launch-readiness project",
      "Candid when he did not know an answer",
    ],
    areas_for_improvement: [
      "Could not explain ICER — basic health-economics literacy for this role",
      "Described HTA as a price comparison, missing clinical benefit and cost-effectiveness",
      "No working knowledge of international reference pricing or launch sequencing",
    ],
    recommendation:
      "No hire — could not explain ICER or how reference pricing shapes European launch order, and described HTA as a price comparison; only the value-dossier answer landed.",
    jd_match: {
      fit_score: 32,
      verdict_summary:
        "Falls short of the role's core: HTA evidence requirements, health economics and European pricing were all missing. The value-dossier answer and some launch exposure are the only matches. Client storylining was not probed.",
      requirements: [
        { requirement: "HTA submissions and evidence requirements for NICE, G-BA and HAS", verdict: "missing", evidence: "Described HTA as a safety and price comparison." },
        { requirement: "Health economics: ICER, QALY, budget impact", verdict: "missing", evidence: "Could not explain ICER." },
        { requirement: "Global value dossiers and payer value messages", verdict: "met", evidence: "Correct dossier structure, adapted by country teams." },
        { requirement: "European pricing: international reference pricing and launch sequencing", verdict: "missing", evidence: "Did not know; guessed at simultaneous launches." },
        { requirement: "Oncology launch experience", verdict: "partial", evidence: "Biosimilar launch-readiness work, not oncology." },
        { requirement: "Client-ready storylines and slide decks", verdict: "not_discussed", evidence: "Mentioned working on slides; never explored." },
      ],
    },
  },
};

const ishita: DemoCall = {
  key: "ishita-banerjee",
  recordingId: id(204),
  transcriptId: id(304),
  evaluationId: id(404),
  job: FPA,
  recruiter: { name: "Karthik", voice: DAVID, rate: 0 },
  candidate: { name: "Ishita Banerjee", voice: ZIRA, rate: 1 },
  imported: { daysAgo: 4, hour: 10, minute: 15 },
  minutesToReport: 7,
  outcome: null,
  expectedDecision: "advance",
  notes: "Open to relocating to Gurugram. Expects about 15 LPA.",
  turns: [
    { who: "recruiter", text: "Hi, am I speaking with Ishita Banerjee?" },
    { who: "candidate", text: "Yes, this is Ishita." },
    {
      who: "recruiter",
      text: "Hi Ishita, this is Karthik from the talent team at Healthark. I'm calling about the FP and A analyst role on our finance team, supporting commercial forecasting. Is this a good time?",
    },
    { who: "candidate", text: "Yes, perfect timing." },
    { who: "recruiter", text: "Great. Could you walk me through your current role?" },
    {
      who: "candidate",
      text: "I'm an FP and A analyst at an Indian pharma company in Kolkata, three and a half years in. I own the monthly forecast for our oncology and critical care brands, prepare the variance pack for the monthly business review, and work closely with the brand and sales teams on the annual operating plan.",
    },
    { who: "recruiter", text: "Thanks. Notice period and expectations?" },
    { who: "candidate", text: "My notice period is sixty days, and I'm looking for around fifteen lakhs. I'm at twelve right now." },
    {
      who: "recruiter",
      text: "Noted. The finance lead has shared a few technical questions. First. How would you build a revenue forecast for a brand that hasn't launched yet?",
    },
    {
      who: "candidate",
      text: "I'd build it patient based. Start with the prevalence of the condition, apply the diagnosed and treated rates to get the eligible patients, then our expected peak share with a monthly uptake curve. Then multiply by days of therapy, compliance and the net price. I keep every driver as an input, so the brand team can run scenarios, like a later launch or a lower share.",
    },
    {
      who: "recruiter",
      text: "Okay, so prevalence down to treated patients, then share and price. Second. What goes into a gross to net bridge?",
    },
    {
      who: "candidate",
      text: "Gross sales at list price, minus trade discounts to distributors, government and institutional rebates, chargebacks, returns, and any patient support or free goods. The gap can be large in institutional channels, so we accrue the rebates monthly, and true them up when the actual claims come in.",
    },
    { who: "recruiter", text: "Got it. Third. Sales came in below plan last month. How do you explain the variance?" },
    {
      who: "candidate",
      text: "I split it into price, volume and mix. Volume is the difference in units at plan price, price is the actual units times the change in net price, and mix is the shift between packs or brands. Then I go to the sales team for the reasons behind the volume part, like a stock out at a distributor, or a competitor launch.",
    },
    {
      who: "recruiter",
      text: "Good. One more, a situation. Tell me about a time your forecast was badly off. What did you do?",
    },
    {
      who: "candidate",
      text: "Last year our critical care brand was forecast flat, but a competitor had a supply problem and our demand jumped forty percent for two months. I flagged it in the first week from the secondary sales data, re-forecast the quarter with the supply chain team so we could secure extra production, and in the review I separated the one time gain from the base trend, so the next year's plan didn't overshoot.",
    },
    {
      who: "recruiter",
      text: "That's really helpful. That's everything from my side. Our finance lead will review the call and we'll be in touch. Any questions?",
    },
    { who: "candidate", text: "What planning tool does the team use?" },
    {
      who: "recruiter",
      text: "Mostly Excel models today, with Anaplan being rolled out next year. Thanks, Ishita.",
    },
    { who: "candidate", text: "Thank you, Karthik. Bye." },
  ],
  evaluation: {
    role_designation: "FP&A Analyst",
    department: "Finance",
    sub_category: "FP&A",
    classification_confidence: "high",
    classification_rationale:
      "Brand revenue forecasting, gross-to-net and variance analysis for monthly business reviews are FP&A work in the Finance department.",
    overall_score: 82,
    overall_summary:
      "Answered all three technical questions correctly: a patient-based forecast built from prevalence through net price with scenario inputs, a complete gross-to-net bridge with monthly accruals and true-ups, and price, volume and mix variance. Her forecast-miss example — spotting a competitor stock-out early and keeping the one-off out of next year's plan — showed good commercial judgement.",
    coverage_note:
      "Covered forecasting, gross-to-net, variance analysis and one behavioural question. Modelling tools — Excel depth, Power BI, Anaplan — were not tested.",
    categories: [
      {
        name: "Communication Skills",
        score: 84,
        summary: "Structured, plain-language answers a brand team could follow.",
        evidence: "Walked the forecast from prevalence to net price in one pass, naming each driver.",
        recommendation: "None.",
      },
      {
        name: "Technical Knowledge",
        score: 83,
        summary: "Correct on forecasting, gross-to-net and variance analysis.",
        evidence: "Patient-based funnel with scenario inputs; rebates accrued monthly and trued up; price, volume and mix split.",
        recommendation: "Confirm the price-effect calculation with a worked example in the next round.",
      },
      {
        name: "Problem Solving",
        score: 84,
        summary: "Caught a demand shift early and acted on it across teams.",
        evidence: "Flagged the spike from secondary sales in week one and re-forecast with supply chain.",
        recommendation: "None.",
      },
      {
        name: "Cultural Fit",
        score: 80,
        summary: "Works across brand, sales and supply chain; thinks about the next plan, not just this month.",
        evidence: "Separated the one-time gain from the base trend so next year's plan did not overshoot.",
        recommendation: "None.",
      },
      {
        name: "Confidence & Clarity",
        score: 83,
        summary: "Direct and confident, with concrete examples.",
        evidence: "Gave a specific forecast-miss story with numbers and actions.",
        recommendation: "None.",
      },
    ],
    question_assessment: {
      questions: [
        {
          question: "Could you walk me through your current role?",
          kind: "experience",
          answer_summary: "Three and a half years in FP&A at a pharma company: monthly brand forecasts, the MBR variance pack, and the annual operating plan.",
          verdict: "adequate",
          score: 80,
          evidence: "I own the monthly forecast for our oncology and critical care brands.",
        },
        {
          question: "How would you build a revenue forecast for a brand that hasn't launched yet?",
          kind: "technical",
          answer_summary: "Patient-based: prevalence, diagnosed and treated rates, peak share with an uptake curve, then days of therapy, compliance and net price, all as scenario inputs.",
          verdict: "strong",
          score: 88,
          evidence: "I keep every driver as an input, so the brand team can run scenarios.",
        },
        {
          question: "What goes into a gross-to-net bridge?",
          kind: "technical",
          answer_summary: "Trade discounts, rebates, chargebacks, returns and patient support, with monthly accruals trued up against actual claims.",
          verdict: "adequate",
          score: 83,
          evidence: "We accrue the rebates monthly, and true them up when the actual claims come in.",
        },
        {
          question: "Sales came in below plan last month. How do you explain the variance?",
          kind: "technical",
          answer_summary: "Price, volume and mix split, then the sales team for the reasons behind the volume gap.",
          verdict: "adequate",
          score: 79,
          evidence: "I split it into price, volume and mix.",
        },
        {
          question: "Tell me about a time your forecast was badly off. What did you do?",
          kind: "behavioural",
          answer_summary: "A competitor supply problem lifted demand forty percent; she flagged it in week one, re-forecast with supply chain, and kept the one-off out of next year's plan.",
          verdict: "strong",
          score: 86,
          evidence: "I separated the one time gain from the base trend, so the next year's plan didn't overshoot.",
        },
      ],
      technical_score: 83,
      behavioural_score: 86,
      summary: "Three of three technical answers landed, plus a strong behavioural example.",
    },
    strengths: [
      "Patient-based forecast logic with every driver kept as a scenario input",
      "Gross-to-net bridge including accruals and true-ups against actual claims",
      "Spotted a demand spike early and kept a one-off out of next year's plan",
    ],
    areas_for_improvement: [
      "Price effect described loosely; confirm the price, volume and mix calculation with a worked example",
      "Tooling not covered: Excel modelling depth, Power BI, Anaplan",
      "Sixty-day notice period",
    ],
    recommendation:
      "Hire — patient-based forecasting, gross-to-net and variance analysis were all correct, and the forecast-miss story showed sound judgement; worth the next round.",
    jd_match: {
      fit_score: 84,
      verdict_summary:
        "Strong match on forecasting, gross-to-net, variance analysis and working with commercial teams. Modelling tools were not probed.",
      requirements: [
        { requirement: "Patient-based and driver-based forecasting", verdict: "met", evidence: "Prevalence-to-net-price funnel with scenario inputs." },
        { requirement: "Gross-to-net modelling with accruals and true-ups", verdict: "met", evidence: "Named the deductions and the monthly accrual and true-up cycle." },
        { requirement: "Price, volume and mix variance for the monthly business review", verdict: "met", evidence: "Splits variance into price, volume and mix and owns the MBR variance pack." },
        { requirement: "Annual operating plan with brand and sales leads", verdict: "met", evidence: "Works with brand and sales teams on the annual operating plan." },
        { requirement: "Presenting drivers and risks to non-finance stakeholders", verdict: "met", evidence: "Separated a one-off gain from the base trend in the review." },
        { requirement: "Advanced Excel; Power BI or Anaplan a plus", verdict: "not_discussed", evidence: "Tooling never came up; she asked about it at the end." },
      ],
    },
  },
};

export const DEMO_CALLS: DemoCall[] = [siddharth, kavitha, arjun, ishita];
