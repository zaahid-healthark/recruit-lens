-- AlterTable
ALTER TABLE "Recording" ADD COLUMN     "jobId" TEXT;

-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "jdMatchJson" JSONB;

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "jdText" TEXT NOT NULL,
    "department" TEXT,
    "subCategory" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_archived_createdAt_idx" ON "Job"("archived", "createdAt");

-- CreateIndex
CREATE INDEX "Recording_jobId_idx" ON "Recording"("jobId");

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

