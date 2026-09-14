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

Restart the server, then confirm the provider is reachable:

```bash
npm run ai:check
```

Notes and documents saved beforehand are indexed automatically the next time you open the project — no migration needed.

> **Model names rot.** Google retires them, and some stay listed by the API while being closed to new accounts — `gemini-2.5-flash` and `text-embedding-004` both fail this way. A dead name errors only when called, so uploads appear to succeed while every document is silently left unindexed. `npm run ai:check` catches it in seconds; run it whenever you change a model.

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

Citations are built to be checked, not just displayed:

- **Page-level.** PDFs are extracted page by page, so every passage — and every citation to it — records the pages it came from. Clicking a marker jumps to its source entry, which quotes the passage and opens the original PDF at that page.
- **Stable.** A citation's number is fixed for the life of its section. Later drafts reuse it for the same passage and number new sources after it, and only an unreviewed draft's citations are ever replaced or discarded.
- **Honest.** A marker that points at no supplied source renders as `?` and appears on the completion checklist, rather than being quietly dropped.
- **Additive.** "Extend with AI" asks for new paragraphs only, and any paragraph that restates what the section already says is removed before it is shown, so accepting an extension cannot duplicate prose.
- **Exportable.** Markdown export turns markers into numbered footnotes with page references and a reference list, which Pandoc carries through to Word or LaTeX.

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
| `npm run test` | 159 unit tests over the pure modules |
| `npm run verify` | Typecheck, lint, unit tests, production build |
| `npm run verify:e2e` | 123 assertions against the real stack (server must be running) |
| `npm run ai:check` | Live provider check — confirms the configured models still exist |
| `npm run db:migrate` | Create and apply a migration after editing the schema |
| `npm run db:studio` | Browse the database |
| `npm run db:seed` | Re-seed the demo account |

---

## Deployment

Designed for a single node with a persistent volume — a VPS or any container host.

```bash
cp .env.example .env      # set GEMINI_API_KEY
docker compose up -d --build
```

That is the whole deployment. The image runs migrations on boot, serves on port 3000, and reports readiness at `/api/health`.

### The volume is the only thing that matters

All durable state lives in the `researchio-data` volume, mounted at `/data`:

- `/data/researchio.db` — the database
- `/data/uploads` — every uploaded source document

**Anything written outside that volume is lost on the next deploy.** `DATABASE_URL` and `UPLOAD_DIR` are set in the Dockerfile and deliberately not overridable from compose, so they cannot be pointed at container-local disk by accident.

Back up the volume, not the container:

```bash
docker compose exec app sh -c 'tar czf - /data' > researchio-backup.tar.gz
```

### Without Docker

```bash
npm ci && npm run build
npx prisma migrate deploy
NODE_ENV=production npm start
```

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Relative `file:` paths resolve against `prisma/`, matching the Prisma CLI |
| `GEMINI_API_KEY` | Omit to run with AI disabled |
| `UPLOAD_DIR` | **Must be on durable storage.** Uploads live here, not in the database |
| `SECURE_COOKIES` | `1` in production. Implied when `NODE_ENV=production` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error`. Defaults to `info` in production |

Put TLS in front of it — a reverse proxy (Caddy, nginx, Traefik) terminating HTTPS. Session cookies are `Secure` in production and will not be sent over plain HTTP.

### Operations

- **Health:** `GET /api/health` returns 200 only when the database and upload directory are both reachable. It is what the container healthcheck and any load balancer should poll.
- **Logs:** JSON, one object per line, in production. Credential-shaped fields are redacted before serialization.
- **Shutdown:** SIGTERM closes the database cleanly before exit, so a deploy cannot tear down SQLite mid-write. Compose allows 30 seconds.

### Switching to PostgreSQL

Change `provider` in `prisma/schema.prisma` to `postgresql`, set a `postgres://` URL, delete `prisma/migrations`, and run `npm run db:migrate`. No application code changes — the schema uses no SQLite-specific types. Uploads would still need object storage; `src/server/storage/files.ts` is the only module that touches the filesystem.

---

## Known limits

Stated plainly, because a tool that overstates itself is worse than one that does less.

- **Retrieval scans in memory.** Every embedded chunk in a project is scored per query. Fine into the low tens of thousands; past that, swap `retrieval.service.ts` for `sqlite-vec` or `pgvector`. Nothing else changes.
- **Ingestion is in-process.** No queue. A restart mid-analysis strands a document, which is repaired when the project is next opened. A multi-instance deployment needs a real queue.
- **Rate limiting is per-process.** Correct for one node; a shared store is required behind a load balancer.
- **Scanned PDFs are rejected, not OCR'd.** Image-only PDFs yield no text and are reported as such rather than silently indexed as empty.
- **Uploads accept PDF, plain text and Markdown only.** These are the formats the pipeline can genuinely read.
- **Sessions expire 30 days after sign-in and do not slide.** Renewal needs a cookie write, which is not permitted during render; see the note in `src/server/auth/session.ts`.
- **Papers are capped at 200 per project in the list view.** Notes paginate properly; papers do not yet.
- **PDFs indexed before page tracking have no page numbers** until re-processed with the "Add page numbers" action on the Sources page. Citations made before that keep their quote but name no page.
- **Restatement filtering is lexical.** It removes verbatim and near-verbatim repetition from extensions; a model that paraphrases the existing text freely can still slip past it.
- **No password reset.** There is no email delivery, so a forgotten password cannot be recovered — only changed while signed in. Adding it means introducing an email provider.
- **`style-src` permits `unsafe-inline`.** The UI uses React inline styles throughout and `next/font` injects an inline style element. `script-src` — the directive that actually stops injected code — remains strict and nonce-only.

---

## Verification

Two layers, deliberately.

`npm run test` — 159 Vitest unit tests over the pure modules: chunking and page mapping, citation parsing and renumbering, restatement detection, Markdown export, vector maths, checklist rules, password hashing, validation, datasource resolution. Fast, no I/O.

`npm run verify:e2e` — 123 assertions against the real database and a live server:

- PDF text extraction, from a PDF generated in-memory during the run
- Embedding round-trips through the database, including the unaligned-buffer case
- Cascade deletes for chunks and notes
- **Cross-account isolation** — a second user requesting another's project gets `404`, and cannot export it
- Account deletion purging projects, notes, chunks and sessions
- Expired sessions rejected, path traversal blocked, security headers present
- CSP carrying a fresh per-request nonce, with no `unsafe-inline` in `script-src`
- Health endpoint proving real database and filesystem reachability
- Citation markers rendering as links to quoted, page-referenced sources, and exporting as footnotes
- Discarding, accepting and editing a section leaving accepted provenance intact

If port 3000 is taken on your machine, run the server elsewhere and point the suite at it with `VERIFY_BASE_URL=http://localhost:4321`.

```bash
npm run dev            # in one terminal
npm run verify:e2e     # in another
```

It also carries regression checks for defects found after the first build — chat history returning the oldest turns, unpaginated note loading, an unwired rate limiter, and unreachable session renewal. A failure there means one has come back.

The live AI path is covered separately by `npm run ai:check`, which needs a key and is deliberately kept out of CI.
