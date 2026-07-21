# Researchio

A research workspace where your sources and notes continuously build a **cited, living document**.

Upload the papers your work rests on. They are parsed, split into passages and embedded. Write notes as you think. When you draft a section, the system retrieves the passages that actually bear on it, writes grounded prose with inline `[S1]` markers, and records exactly which passage supported which claim. Nothing is merged into your document without you accepting it.

---

## Quick start

Requires **Node.js 20.9+**.

```bash
npm install
cp .env.example .env      # then edit .env
npm run setup             # migrate, generate client, seed a demo account
npm run dev
```

Open <http://localhost:3000>.

`npm run setup` prints demo credentials you can sign in with, or create your own account at `/register`.

### Enabling AI

Everything except AI works without a key: accounts, projects, notes, uploads, text extraction, the document outline, the checklist and export.

For drafting, semantic search and the research assistant, add a [Google AI Studio key](https://aistudio.google.com/apikey) to `.env`:

```bash
GEMINI_API_KEY="your-key"
```

Restart the server. Notes and documents saved beforehand are indexed automatically the next time you open the project — no migration needed.

Without a key the app says so plainly in a banner and disables the affected controls. It never generates placeholder text and presents it as a result.

---

## How it works

```
Upload ──▶ extract text ──▶ chunk ──▶ embed ──▶ Chunk table
                                                    │
Note ─────▶ chunk ──▶ embed ───────────────────────▶┤
                                                    │
                                            ┌───────▼────────┐
                     question / section ───▶│   retrieval    │
                                            │ (cosine top-k) │
                                            └───────┬────────┘
                                                    │ passages
                                            ┌───────▼────────┐
                                            │  grounded LLM  │
                                            └───────┬────────┘
                                                    │
                                    answer + CitationLink rows
```

`CitationLink` is the point of the product. It ties a piece of drafted prose to the specific passage, paper and note that grounded it, and survives after the draft is accepted.

### Layout

| Path | Responsibility |
|---|---|
| `src/app` | Routes. Server Components for reads, Route Handlers for streaming and file serving |
| `src/server/actions` | Server Actions — the only mutation entry points |
| `src/server/services` | Business logic. Framework-free and independently testable |
| `src/server/ai` | The single boundary to the AI vendor, plus all prompts |
| `src/server/auth` | scrypt password hashing, DB-backed sessions |
| `src/server/storage` | Uploaded file I/O |
| `src/lib` | Pure helpers usable from both server and client |
| `src/components` | UI. Server Components by default; `'use client'` only where interaction demands it |

Two rules keep this honest:

- **Every project-scoped read and write passes `assertProjectAccess`.** One chokepoint, so authorization cannot be present in one handler and forgotten in another.
- **Services never import framework types.** They take plain arguments and return plain data, which is why `scripts/verify.ts` can drive them directly.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run verify` | Typecheck, lint, and production build |
| `npm run verify:e2e` | 63 assertions against the real stack (dev server must be running) |
| `npm run db:migrate` | Create and apply a migration after editing the schema |
| `npm run db:studio` | Browse the database |
| `npm run db:seed` | Re-seed the demo account |

---

## Deployment

The app is a standard Node server and runs anywhere Node does — a VPS, Fly, Railway, Render, or a container.

```bash
npm ci
npm run build
npx prisma migrate deploy
NODE_ENV=production npm start
```

Set in the environment:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Relative `file:` paths resolve against `prisma/`, matching the Prisma CLI |
| `GEMINI_API_KEY` | Omit to run with AI disabled |
| `UPLOAD_DIR` | **Must be a persistent volume.** Uploaded sources live here, not in the database |
| `SECURE_COOKIES` | `1` in production. Implied when `NODE_ENV=production` |

### Two things to get right

**Persistent storage.** SQLite and `UPLOAD_DIR` are both on disk. On a platform with an ephemeral filesystem (Vercel, and most default container setups) every deploy discards user data. Mount a volume, or move to PostgreSQL and object storage.

**Switching to PostgreSQL.** Change `provider` in `prisma/schema.prisma` to `postgresql`, set a `postgres://` URL, delete `prisma/migrations` and run `npm run db:migrate`. No application code changes — the schema uses no SQLite-specific types.

---

## Known limits

Stated plainly, because a tool that overstates itself is worse than one that does less.

- **Retrieval scans in memory.** Every embedded chunk in a project is scored per query. Fine into the low tens of thousands; past that, swap `retrieval.service.ts` for `sqlite-vec` or `pgvector`. Nothing else changes.
- **Ingestion is in-process.** No queue. A restart mid-analysis strands a document, which is repaired when the project is next opened. A multi-instance deployment needs a real queue.
- **Rate limiting is per-process.** Correct for one node; a shared store is required behind a load balancer.
- **Scanned PDFs are rejected, not OCR'd.** Image-only PDFs yield no text and are reported as such rather than silently indexed as empty.
- **Uploads accept PDF, plain text and Markdown only.** These are the formats the pipeline can genuinely read.
- **AI paths need a live key to exercise.** `verify:e2e` covers everything else; drafting, embedding and chat require a configured provider.

---

## Verification

`scripts/verify.ts` runs 63 assertions against the real database and a live server, including:

- PDF text extraction, from a PDF generated in-memory during the run
- Embedding round-trips through the database, including the unaligned-buffer case
- scrypt hashing, rejection of malformed hashes, salt uniqueness
- Cascade deletes for chunks and notes
- **Cross-account isolation** — a second user requesting another's project gets `404`, and cannot export it
- Expired sessions rejected, path traversal blocked, security headers present

```bash
npm run dev            # in one terminal
npm run verify:e2e     # in another
```
