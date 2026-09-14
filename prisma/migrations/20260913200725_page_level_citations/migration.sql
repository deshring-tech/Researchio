-- AlterTable
ALTER TABLE "Chunk" ADD COLUMN "pageEnd" INTEGER;
ALTER TABLE "Chunk" ADD COLUMN "pageStart" INTEGER;

-- AlterTable
ALTER TABLE "Paper" ADD COLUMN "pageStarts" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CitationLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "chunkId" TEXT,
    "paperId" TEXT,
    "noteId" TEXT,
    "ordinal" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "quote" TEXT,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CitationLink_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CitationLink_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "Chunk" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CitationLink_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CitationLink_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CitationLink" ("chunkId", "createdAt", "id", "noteId", "paperId", "quote", "sectionId") SELECT "chunkId", "createdAt", "id", "noteId", "paperId", "quote", "sectionId" FROM "CitationLink" ORDER BY "CitationLink".rowid;
DROP TABLE "CitationLink";
ALTER TABLE "new_CitationLink" RENAME TO "CitationLink";
CREATE INDEX "CitationLink_sectionId_status_idx" ON "CitationLink"("sectionId", "status");

-- Backfill status. Under the previous drafting code a section's citation rows
-- always belonged to its most recent draft, and discarding a draft deleted
-- them, so rows on a section with no pending draft back accepted prose.
UPDATE "CitationLink" SET "status" = 'accepted'
WHERE "sectionId" IN (SELECT "id" FROM "Section" WHERE "aiContent" IS NULL);

-- Backfill ordinals. Rows were inserted in source order (S1, S2, ...) and the
-- ordered copy above preserves that order in rowid.
UPDATE "CitationLink" SET "ordinal" = (
    SELECT COUNT(*) FROM "CitationLink" AS "earlier"
    WHERE "earlier"."sectionId" = "CitationLink"."sectionId"
      AND "earlier".rowid <= "CitationLink".rowid
);
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
