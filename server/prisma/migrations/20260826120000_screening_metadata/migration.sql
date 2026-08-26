-- AlterTable
ALTER TABLE "Recording" ADD COLUMN     "autoImported" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "callSummary" TEXT,
ADD COLUMN     "detectedRole" TEXT;

