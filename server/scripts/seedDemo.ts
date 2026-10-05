/**
 * Adds four complete demo candidates — call recording, timed transcript, full
 * evaluation and the job each was screened for — stored exactly as a real
 * upload leaves them, so the app can be shown without real candidates' data.
 *
 *   npm run seed:demo -w server               # add them, or reset them to fresh dates
 *   npm run seed:demo -w server -- --remove   # take them out again
 *
 * Safe to rerun: the demo rows have fixed ids, so a rerun replaces them rather
 * than duplicating them, and nothing outside those rows is touched. Uses the
 * server's own .env (database and storage), so run it where the server runs.
 */

import { env } from "../src/config/env";
import fs from "fs";
import os from "os";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { storage } from "../src/storage";
import { buildDemo } from "./demo/build";

async function main(): Promise<void> {
  const remove = process.argv.includes("--remove");
  const { jobs, rows } = buildDemo(new Date());
  const recordingIds = rows.map((r) => r.recording.id);
  const jobIds = jobs.map((j) => j.id);

  // Clear any earlier run first, audio included, so a rerun is a clean reset.
  const earlier = await prisma.recording.findMany({ where: { id: { in: recordingIds } }, select: { storagePath: true } });
  for (const r of earlier) await storage.delete(r.storagePath);
  await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } }); // cascades transcript + evaluation

  if (remove) {
    // A real recording someone attached to a demo job keeps its data; the
    // relation is SetNull, so it simply loses the job link.
    const removedJobs = await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    console.log(`Removed ${earlier.length} demo candidates and ${removedJobs.count} demo jobs.`);
    return;
  }

  for (const job of jobs) {
    const { id, ...fields } = job;
    await prisma.job.upsert({
      where: { id },
      create: job,
      update: { title: fields.title, jdText: fields.jdText, department: fields.department, subCategory: fields.subCategory, archived: false },
    });
  }

  for (const { recording, transcript, columns, evaluation, audioPath, call } of rows) {
    // saveFromFile moves its input, so hand it a copy, never the committed file.
    const temp = path.join(os.tmpdir(), `recruitlens-demo-${recording.id}.mp3`);
    fs.copyFileSync(audioPath, temp);
    const storagePath = await storage.saveFromFile(temp, recording.originalFilename);

    await prisma.recording.create({
      data: {
        ...recording,
        storagePath,
        transcript: {
          create: {
            id: transcript.id,
            text: transcript.text,
            segmentsJson: transcript.segmentsJson as Prisma.InputJsonValue,
            model: transcript.model,
            language: transcript.language,
            createdAt: transcript.createdAt,
          },
        },
        evaluation: { create: { id: evaluation.id, createdAt: evaluation.createdAt, ...columns } },
      },
    });
    const outcome = recording.shortlistedAt ? "moved to next round" : recording.rejectedAt ? "rejected" : "awaiting your decision";
    const score = evaluation.overallScore === null ? "—" : (evaluation.overallScore / 10).toFixed(1);
    console.log(`  ${recording.candidateName} · ${call.job.title} · ${score} · ${outcome}`);
  }
  console.log(`Added ${rows.length} demo candidates and ${jobs.length} demo jobs. Audio stored under ${env.storageDir}.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
