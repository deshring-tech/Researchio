-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "researchQuestion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LivingDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LivingDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "userContent" TEXT,
    "aiContent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'incomplete',
    "draftedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Section_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "LivingDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Note_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Paper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT,
    "year" INTEGER,
    "storageKey" TEXT,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "statusMessage" TEXT,
    "extractedText" TEXT,
    "pageCount" INTEGER,
    "plainSummary" TEXT,
    "techSummary" TEXT,
    "keyFindings" TEXT,
    "methodology" TEXT,
    "limitations" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Paper_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "paperId" TEXT,
    "noteId" TEXT,
    "content" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "embedding" BLOB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Chunk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Chunk_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Chunk_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CitationLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "chunkId" TEXT,
    "paperId" TEXT,
    "noteId" TEXT,
    "quote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CitationLink_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CitationLink_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "Chunk" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CitationLink_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CitationLink_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TimelineEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Project_ownerId_updatedAt_idx" ON "Project"("ownerId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LivingDocument_projectId_key" ON "LivingDocument"("projectId");

-- CreateIndex
CREATE INDEX "Section_documentId_position_idx" ON "Section"("documentId", "position");

-- CreateIndex
CREATE INDEX "Note_projectId_createdAt_idx" ON "Note"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Paper_projectId_createdAt_idx" ON "Paper"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Paper_status_idx" ON "Paper"("status");

-- CreateIndex
CREATE INDEX "Chunk_projectId_idx" ON "Chunk"("projectId");

-- CreateIndex
CREATE INDEX "Chunk_paperId_idx" ON "Chunk"("paperId");

-- CreateIndex
CREATE INDEX "Chunk_noteId_idx" ON "Chunk"("noteId");

-- CreateIndex
CREATE INDEX "CitationLink_sectionId_idx" ON "CitationLink"("sectionId");

-- CreateIndex
CREATE INDEX "ChatMessage_projectId_createdAt_idx" ON "ChatMessage"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "TimelineEvent_projectId_createdAt_idx" ON "TimelineEvent"("projectId", "createdAt");
