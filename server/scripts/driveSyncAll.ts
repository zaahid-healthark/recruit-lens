/**
 * One-shot backfill: mirrors EVERY existing recording (audio, transcript,
 * evaluation row) to the configured Google Drive folder. Safe to re-run —
 * files already mirrored are skipped, sheet rows are upserted in place.
 *
 * Run with: npm run drive:sync -w server   (after configuring the mirror)
 */
import { syncRecordingToDrive, flushDriveQueue } from "../src/google/driveSync";
import { isDriveConfigured } from "../src/google/driveClient";
import { prisma } from "../src/lib/prisma";

async function main(): Promise<void> {
  if (!isDriveConfigured()) {
    console.error(
      "Drive mirror is not configured. Set GOOGLE_DRIVE_FOLDER_ID in server/.env and place the " +
        "service-account key at server/google-credentials.json first (see README)."
    );
    process.exitCode = 1;
    return;
  }
  const recordings = await prisma.recording.findMany({
    orderBy: { importedAt: "asc" },
    select: { id: true, originalFilename: true },
  });
  console.log(`Mirroring ${recordings.length} recording(s) to Google Drive…`);
  for (const [i, rec] of recordings.entries()) {
    syncRecordingToDrive(rec.id);
    await flushDriveQueue(); // sequential — keeps output readable and avoids rate limits
    console.log(`  [${i + 1}/${recordings.length}] ${rec.originalFilename}`);
  }
  console.log("Done. Check the Recordings/, Transcripts/ folders and the Evaluations sheet.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
