/**
 * Transcripts written to provoke the two ways interview scoring goes wrong:
 * a weak candidate waved through, and a strong one marked down.
 *
 * Each fixture states what a competent human recruiter would conclude, as
 * assertions the scorer must satisfy. They are deliberately unsubtle — if the
 * rubric cannot separate these, it certainly cannot separate real calls.
 */

export interface ScenarioExpectation {
  /** Inclusive bounds on overall_score; null means it must be withheld. */
  overallScore: { min: number; max: number } | "must-be-null";
  /** Substrings, any one of which may open the recommendation. */
  recommendationOneOf: string[];
  /** Whether questions were asked at all. */
  questionAssessment: "present" | "must-be-null";
  /** Inclusive bounds on the technical aggregate, when questions were asked. */
  technicalScore?: { min: number; max: number };
  /** Inclusive bounds on the Communication Skills category — the heaviest one. */
  communicationScore?: { min: number; max: number };
  /** Matrix categories that must come back null (the interview never tested them). */
  categoriesMustBeNull?: string[];
  /** Why a human recruiter reaches this verdict — printed on failure. */
  rationale: string;
}

export interface Scenario {
  name: string;
  /** The trap this fixture is built to catch. */
  trap: string;
  jd: { title: string; jdText: string } | null;
  transcript: string;
  expect: ScenarioExpectation;
}

const DATA_ENGINEER_JD = {
  title: "Senior Data Engineer",
  jdText: `We are hiring a Senior Data Engineer to own our analytics pipelines end to end.

Requirements:
- 5+ years building production data pipelines
- Hands-on Apache Airflow orchestration, including backfills and failure recovery
- Strong SQL and Python
- Experience with a cloud warehouse (Snowflake or BigQuery)
- Comfortable owning data quality, alerting and on-call rotation
- Able to explain technical trade-offs to non-technical stakeholders`,
};

export const SCENARIOS: Scenario[] = [
  {
    name: "non-native-but-clear",
    trap:
      "Marking down clear thinking because the English is not native. Broken grammar, " +
      "every answer precise and to the question asked.",
    jd: DATA_ENGINEER_JD,
    transcript: `Recruiter: Can you tell me about your experience with Airflow?
Candidate: Yes. Four year I am using. Currently forty DAG in production, I am owning all.

Recruiter: What happens when a DAG fails halfway through overnight?
Candidate: Depend which task. Our task is idempotent, so retry is safe — three retry, backoff. If still fail, pager to on-call person. But if the fail is upstream extract, retry is no use, so that one alert immediately, no retry. Then we clear task, backfill from last good watermark.

Recruiter: How do you approach data quality?
Candidate: Two level. First, row count and null check — this one block the DAG, nothing pass. Second, distribution check — this only warn, because sometime is false alarm. One time a payer change code set and count was looking fine, so now we check also distinct value of code column.

Recruiter: Have you had to explain this to non-technical stakeholders?
Candidate: Yes, actuary team, every month. Before I show pipeline diagram — no use, they don't care. Now I show one chart only: data freshness against their deadline. This one they understand, and they act on it.

Recruiter: What is your notice period?
Candidate: Two month.`,
    expect: {
      overallScore: { min: 68, max: 100 },
      recommendationOneOf: ["Strong hire", "Hire"],
      questionAssessment: "present",
      communicationScore: { min: 65, max: 100 },
      rationale:
        "The grammar is non-native throughout, and not one answer is unclear. Each has a " +
        "structure, answers what was asked, and names specifics — 40 DAGs, the retry exception " +
        "and why, a real data-quality incident, and a stakeholder habit they changed on purpose. " +
        "Nobody on that call had to ask them to repeat anything. This is good communication.",
    },
  },

  {
    name: "fluent-but-unclear",
    trap:
      "Mistaking native fluency for clear communication. Effortless English that never " +
      "lands a point, and a recruiter visibly struggling to follow.",
    jd: DATA_ENGINEER_JD,
    transcript: `Recruiter: Can you tell me about your experience with Airflow?
Candidate: Sure, so I mean, orchestration generally is something I've always found fascinating, right, because ultimately what you're doing is you're expressing dependencies, and dependencies are really the heart of any system, whether that's data or honestly anything else. I've worked in environments where that was handled in a variety of ways, some more elegant than others, and I think what I've taken from that is a real appreciation for the problem space as a whole.

Recruiter: Sorry — do you use Airflow day to day, yes or no?
Candidate: I'd say I'm very much in that world, absolutely. It's part of the broader ecosystem I operate in, and I'd characterise my relationship with it as hands-on in the sense that matters.

Recruiter: Okay. What happens when a DAG fails halfway through overnight?
Candidate: So this is where I think philosophy really matters, because failure is inevitable, and the question isn't really whether things break, it's how your organisation metabolises that. I've seen teams that panic and teams that don't, and the difference is almost never technical.

Recruiter: Right, but what do you actually do? Walk me through the steps.
Candidate: Well, you assess, you communicate, and you resolve. I'm a big believer in not over-engineering the response.

Recruiter: Can you give me a specific incident?
Candidate: There've been many, honestly. I think they blur together after a while, which is probably a good sign in its own way.

Recruiter: What's your notice period?
Candidate: Thirty days.`,
    expect: {
      overallScore: { min: 0, max: 60 },
      recommendationOneOf: ["No hire", "Maybe"],
      questionAssessment: "present",
      communicationScore: { min: 0, max: 55 },
      rationale:
        "The English is effortless and the candidate said nothing. The recruiter had to " +
        "re-ask three times — 'yes or no', 'what do you actually do', 'give me a specific " +
        "incident' — which is recorded evidence that the person on the call could not follow " +
        "the answers. Fluency is not clarity, and this is the failure mode the heaviest " +
        "category exists to catch.",
    },
  },

  {
    name: "fluent-but-empty",
    trap: "Score inflation. Confident, articulate, buzzword-dense, and says nothing checkable.",
    jd: DATA_ENGINEER_JD,
    transcript: `Recruiter: Thanks for making time. Tell me about your experience with data pipelines.
Candidate: Absolutely, and thank you for having me. So I'm extremely passionate about data engineering. I've worked across the full modern data stack, end to end, and I really believe in building scalable, robust, future-proof architectures. I'm very hands-on and I always deliver.

Recruiter: Can you tell me specifically about Airflow? Do you use it day to day?
Candidate: Yes, definitely, Airflow is absolutely core to what I do. I'm a huge advocate for orchestration best practices. I think the key is really having a solid DAG strategy and making sure everything is properly orchestrated at scale. I've driven a lot of value there.

Recruiter: What happens when a DAG fails halfway through overnight?
Candidate: Great question. So you really want to have proper monitoring and alerting in place. I'm a big believer in observability. You need the right tooling and the right processes, and honestly a lot of it comes down to team culture and ownership. I always make sure the team is aligned on that.

Recruiter: Sure, but concretely — a task fails at 2am. Walk me through what you do.
Candidate: Right, so it's about being proactive rather than reactive. I'd make sure we have the visibility we need, escalate appropriately, and drive it to resolution. I'm very good under pressure and stakeholders always know they can rely on me.

Recruiter: How big were the datasets you worked with?
Candidate: Oh, large scale. Really significant volumes. Big data, essentially. We were dealing with a lot of complexity.

Recruiter: And how do you approach data quality?
Candidate: Data quality is absolutely critical, it's something I'm hugely passionate about. You need to bake quality in from the start, shift left, and have a strong culture of ownership across the team. I've led a lot of initiatives in that space.

Recruiter: Okay. What's your notice period?
Candidate: Thirty days, and I'm very excited about this opportunity.`,
    expect: {
      overallScore: { min: 0, max: 60 },
      recommendationOneOf: ["No hire", "Maybe"],
      questionAssessment: "present",
      technicalScore: { min: 0, max: 50 },
      rationale:
        "Six substantive questions, not one concrete answer: no tool beyond the name Airflow, " +
        "no number, no failure they actually handled, and the 2am question was dodged twice. " +
        "A recruiter would not advance this candidate, however well they spoke.",
    },
  },

  {
    name: "terse-but-strong",
    trap: "Score deflation. Short, flat, hesitant delivery — and every answer is correct and specific.",
    jd: DATA_ENGINEER_JD,
    transcript: `Recruiter: Tell me about your experience with data pipelines.
Candidate: Six years. Last four at a health insurer, owning the claims pipeline. Airflow, Python, Snowflake.

Recruiter: Can you tell me specifically about Airflow? Do you use it day to day?
Candidate: Yes. About forty DAGs. I wrote the backfill tooling we use.

Recruiter: What happens when a DAG fails halfway through overnight?
Candidate: Depends where. Our tasks are idempotent, so mostly it just retries, three times with exponential backoff. If it's still failing it pages whoever is on call. Um... if it's the upstream extract that broke, retrying is pointless, so that one alerts immediately instead of retrying. We clear the task and backfill from the last good watermark.

Recruiter: How big were the datasets?
Candidate: The claims table is about 400 million rows, maybe 1.2 terabytes. Daily increment is around two million.

Recruiter: And how do you approach data quality?
Candidate: Row count and null checks on every load, those block the DAG. Then... slower stuff, distribution checks, those just warn. We had a case where a payer changed a code set silently and the counts looked fine, so now we assert on the distinct value set for the code columns too.

Recruiter: Have you explained this kind of thing to non-technical people?
Candidate: Yes. Monthly with the actuarial team. I stopped showing them pipeline diagrams, it didn't land. Now I show one chart of data freshness against their reporting deadline. That they act on.

Recruiter: What's your notice period?
Candidate: Two months, sorry.`,
    expect: {
      overallScore: { min: 70, max: 100 },
      recommendationOneOf: ["Strong hire", "Hire"],
      questionAssessment: "present",
      technicalScore: { min: 65, max: 100 },
      rationale:
        "Every answer is specific and checkable: 40 DAGs, idempotent retries with a reason for " +
        "the exception, 400M rows, a real data-quality incident and the fix it produced. " +
        "Terseness and a filler word are not weaknesses. This is a clear hire.",
    },
  },

  {
    name: "confidently-wrong",
    trap: "Assurance mistaken for competence. Fluent, decisive, and technically incorrect.",
    jd: DATA_ENGINEER_JD,
    transcript: `Recruiter: How would you speed up a slow join between two very large tables?
Candidate: Easy — I'd add an index on every column in both tables. More indexes always means faster queries, that's just how databases work. I do that as standard.

Recruiter: Any downside to indexing every column?
Candidate: No, none at all. Storage is cheap. I've never seen a case where more indexes hurt.

Recruiter: How do you handle a schema change from an upstream source?
Candidate: I just run SELECT star and let it flow through. That way the pipeline picks up whatever changes automatically and you never have to touch it again. Completely maintenance free.

Recruiter: What about column order changing, or a type changing?
Candidate: Doesn't matter, the warehouse sorts that out for you automatically. I've never had an issue.

Recruiter: How would you make a task in Airflow safe to re-run?
Candidate: Airflow handles that itself, you don't need to do anything. Every task is automatically idempotent out of the box, it's built in.

Recruiter: What's your notice period?
Candidate: I can start immediately.`,
    expect: {
      overallScore: { min: 0, max: 45 },
      recommendationOneOf: ["No hire"],
      questionAssessment: "present",
      technicalScore: { min: 0, max: 35 },
      rationale:
        "Five technical answers, four of them plainly wrong (indexes are free, SELECT * absorbs " +
        "schema drift, Airflow tasks are idempotent by default), each delivered with total " +
        "certainty and no hedging. Confidently wrong is worse than admitting uncertainty.",
    },
  },

  {
    name: "logistics-only",
    trap: "Scoring a candidate who was never actually asked anything.",
    jd: DATA_ENGINEER_JD,
    transcript: `Recruiter: Hi, is this a good time? I'm calling about the Senior Data Engineer role.
Candidate: Yes, now is fine.

Recruiter: Great. Are you still looking to move?
Candidate: I am, yes.

Recruiter: What's your notice period?
Candidate: Sixty days.

Recruiter: And what are you looking for compensation-wise?
Candidate: Somewhere around thirty-two lakhs, but I'm flexible for the right role.

Recruiter: Are you open to coming into the Bangalore office three days a week?
Candidate: That works for me, I'm based there already.

Recruiter: Perfect. I'll set up a technical round with the hiring manager and send over some times.
Candidate: Sounds good, thank you.`,
    expect: {
      overallScore: "must-be-null",
      recommendationOneOf: ["Insufficient evidence"],
      questionAssessment: "must-be-null",
      categoriesMustBeNull: ["Technical Knowledge", "Problem Solving"],
      rationale:
        "A scheduling call. Nothing about the candidate's capability was asked or offered, so " +
        "there is nothing to score. Any number here would be invented, and a low one would " +
        "libel a candidate who was never given a chance to say anything.",
    },
  },

  {
    name: "strong-behavioural-no-technical",
    trap: "Behavioural answers ignored, or a missing technical round treated as a failure.",
    jd: DATA_ENGINEER_JD,
    transcript: `Recruiter: Tell me about a time you disagreed with a teammate about an approach.
Candidate: We were rebuilding the ingestion layer and my lead wanted one big service, I wanted it split by source. We went back and forth for a week and it was stalling the project. So I asked if we could time-box it — I'd build my version for the two messiest sources in three days, he'd sketch his. Turned out his was simpler for the clean sources and mine was better for the messy ones, so we did both. He owned that call and I think it was the right one.

Recruiter: What's the biggest thing you've got wrong?
Candidate: I deleted a production table. Not dropped by accident — I wrote a migration that recreated it, and I ran it against prod thinking it was staging. We lost about four hours of claims data and I had to tell the actuarial lead myself. We restored from a snapshot. The real problem was that my prod and staging credentials had the same profile name locally, so I changed that the same afternoon, and then made the team do the same. Nobody's repeated it.

Recruiter: How do you handle it when priorities change mid-sprint?
Candidate: Depends who's asking and why. If it's a real incident, everything stops. If it's someone's new idea, I'll ask what it's displacing — usually that conversation resolves it without me having to say no.

Recruiter: What's your notice period?
Candidate: A month.`,
    expect: {
      overallScore: { min: 61, max: 100 },
      recommendationOneOf: ["Strong hire", "Hire", "Maybe"],
      questionAssessment: "present",
      categoriesMustBeNull: ["Technical Knowledge"],
      rationale:
        "Three behavioural answers, all with a real situation, their own actions and the outcome " +
        "— including owning a production incident. No technical question was asked, so Technical " +
        "Knowledge has nothing to score; that is an interviewer gap and must not become a penalty.",
    },
  },
];
