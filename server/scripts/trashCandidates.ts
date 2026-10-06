/**
 * Lists candidates, and moves the ones you name to the trash — the same soft
 * delete as "Move to trash" in the app, so every one stays restorable from
 * Candidates → Trash. Nothing is deleted.
 *
 *   npm run trash -w server                                       # list everyone not in the trash
 *   npm run trash -w server -- "Test Candidate" "Billu"           # show who would be trashed
 *   npm run trash -w server -- "Test Candidate" "Billu" --yes     # trash them
 *
 * A name matches the candidate's name exactly, ignoring case. When two
 * candidates share a name, use the 8-character id from the list instead.
 * Uses the server's own .env, so run it where the server runs.
 */

import "../src/config/env";
import { prisma } from "../src/lib/prisma";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--yes");
  const wanted = args.filter((a) => a !== "--yes").map((a) => a.trim()).filter(Boolean);

  const live = await prisma.recording.findMany({
    where: { trashedAt: null },
    orderBy: { importedAt: "desc" },
    select: { id: true, candidateName: true, originalFilename: true, importedAt: true, job: { select: { title: true } } },
  });
  const nameOf = (r: (typeof live)[number]) => r.candidateName?.trim() || r.originalFilename;
  const line = (r: (typeof live)[number]) =>
    `  ${r.id.slice(0, 8)}  ${nameOf(r).slice(0, 34).padEnd(34)}  ${(r.job?.title ?? "No job").slice(0, 38).padEnd(38)}  ${r.importedAt.toISOString().slice(0, 10)}`;

  if (!wanted.length) {
    console.log(`${live.length} candidates not in the trash:\n`);
    live.forEach((r) => console.log(line(r)));
    console.log(`\nTo trash some:  npm run trash -w server -- "First name" "Second name" --yes`);
    return;
  }

  const hit = (w: string, r: (typeof live)[number]) =>
    w.toLowerCase() === nameOf(r).toLowerCase() || r.id === w || (w.length >= 8 && r.id.startsWith(w));
  const matches = live.filter((r) => wanted.some((w) => hit(w, r)));
  const unmatched = wanted.filter((w) => !live.some((r) => hit(w, r)));

  if (unmatched.length) console.log(`No candidate called: ${unmatched.map((w) => `"${w}"`).join(", ")}\n`);
  if (!matches.length) {
    console.log("Nothing to trash. Run without names to see everyone.");
    return;
  }

  if (!apply) {
    console.log(`Would move ${matches.length} to the trash:\n`);
    matches.forEach((r) => console.log(line(r)));
    console.log("\nNothing changed yet. Run the same command again with --yes to do it.");
    return;
  }

  await prisma.recording.updateMany({ where: { id: { in: matches.map((r) => r.id) } }, data: { trashedAt: new Date() } });
  console.log(`Moved ${matches.length} to the trash:\n`);
  matches.forEach((r) => console.log(line(r)));
  console.log("\nRestore any of them from Candidates → Trash in the app.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
