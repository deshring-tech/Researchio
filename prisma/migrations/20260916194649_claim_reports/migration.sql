-- CreateTable
CREATE TABLE "ClaimReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "statusMessage" TEXT,
    "results" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClaimReport_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaimReport_sectionId_target_key" ON "ClaimReport"("sectionId", "target");
