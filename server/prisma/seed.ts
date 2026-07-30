/**
 * Seed script:
 *  1. Mirrors the taxonomy config into the Department/SubCategory tables (idempotent).
 *  2. Inserts sample recordings (tiny generated WAV files) — two already
 *     EVALUATED with mock data, one UNEVALUATED — so the app shows data on
 *     first run and the whole flow can be clicked through immediately.
 *
 * Run with: npm run db:seed   (or: npm run seed -w server)
 */
import { Prisma, PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { mockEvaluation, mockTranscript } from "../src/ai/mock";
import { env } from "../src/config/env";
import { TAXONOMY } from "../src/config/taxonomy";

const prisma = new PrismaClient();

/** Minimal valid mono 16-bit PCM WAV of silence — a playable placeholder sample file. */
function makeSilentWav(seconds = 2, sampleRate = 8000): Buffer {
  const numSamples = seconds * sampleRate;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize); // samples default to 0 = silence
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

async function seedTaxonomy(): Promise<void> {
  for (const [name, subs] of Object.entries(TAXONOMY)) {
    const dept = await prisma.department.upsert({ where: { name }, create: { name }, update: {} });
    for (const sub of subs) {
      await prisma.subCategory.upsert({
        where: { departmentId_name: { departmentId: dept.id, name: sub } },
        create: { departmentId: dept.id, name: sub },
        update: {},
      });
    }
  }
  console.log(`Taxonomy seeded (${Object.keys(TAXONOMY).length} departments).`);
}

interface SampleSpec {
  filename: string;
  candidateName: string | null;
  durationSeconds: number;
  evaluated: boolean;
  department?: string;
  subCategory?: string;
  roleDesignation?: string;
}

const SAMPLES: SampleSpec[] = [
  {
    filename: "sample-data-engineer-interview.wav",
    candidateName: "Asha Verma",
    durationSeconds: 1845,
    evaluated: true,
    department: "IDT",
    subCategory: "Data Engineering",
    roleDesignation: "Senior Data Engineer",
  },
  {
    filename: "sample-talent-acquisition-interview.wav",
    candidateName: "Rohit Menon",
    durationSeconds: 2210,
    evaluated: true,
    department: "HR",
    subCategory: "Talent Acquisition",
    roleDesignation: "Talent Acquisition Specialist",
  },
  {
    filename: "sample-unevaluated-call.wav",
    candidateName: null,
    durationSeconds: 1320,
    evaluated: false,
  },
];

async function seedSamples(): Promise<void> {
  fs.mkdirSync(env.storageDir, { recursive: true });
  const wav = makeSilentWav();

  for (const sample of SAMPLES) {
    const existing = await prisma.recording.findFirst({
      where: { originalFilename: sample.filename },
    });
    if (existing) {
      console.log(`Sample "${sample.filename}" already present — skipping.`);
      continue;
    }

    const storagePath = `seed-${sample.filename}`;
    fs.writeFileSync(path.join(env.storageDir, storagePath), wav);

    const recording = await prisma.recording.create({
      data: {
        originalFilename: sample.filename,
        storagePath,
        mimeType: "audio/wav",
        durationSeconds: sample.durationSeconds,
        candidateName: sample.candidateName,
        notes: "Seeded sample recording",
        status: sample.evaluated ? "EVALUATED" : "UNEVALUATED",
      },
    });

    if (sample.evaluated) {
      const result = mockEvaluation(sample.filename, {
        department: sample.department,
        subCategory: sample.subCategory,
        roleDesignation: sample.roleDesignation,
      });
      await prisma.transcript.create({
        data: {
          recordingId: recording.id,
          text: mockTranscript(sample.filename, result.role_designation),
          model: "mock-transcriber",
          language: "en",
        },
      });
      await prisma.evaluation.create({
        data: {
          recordingId: recording.id,
          roleDesignation: result.role_designation,
          department: result.department,
          subCategory: result.sub_category,
          classificationConfidence: result.classification_confidence,
          classificationRationale: result.classification_rationale,
          overallScore: result.overall_score,
          overallSummary: result.overall_summary,
          categoriesJson: result.categories as unknown as Prisma.InputJsonValue,
          strengths: result.strengths,
          areasForImprovement: result.areas_for_improvement,
          recommendation: result.recommendation,
          model: "mock-evaluator",
        },
      });
    }
    console.log(`Seeded sample "${sample.filename}" (${sample.evaluated ? "evaluated" : "unevaluated"}).`);
  }
}

async function main(): Promise<void> {
  await seedTaxonomy();
  await seedSamples();
  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
