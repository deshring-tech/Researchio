import 'dotenv/config';

/**
 * End-to-end verification.
 *
 * Exercises the real stack — the actual database, the actual services, the
 * actual HTTP routes — and asserts on outcomes. This is not a substitute for a
 * test suite, but it proves the critical paths work rather than merely
 * compiling.
 *
 * Run with:
 *   npm run verify:e2e            (dev server must be running for HTTP checks)
 *
 * `--conditions react-server` is required so imports of `server-only` resolve
 * to its no-op build instead of throwing outside a Next.js runtime.
 */

import { PrismaClient } from '@prisma/client';

import { chunkText, normalizeExtractedText } from '../src/lib/text/chunk';
import { decodeEmbedding, encodeEmbedding, normalize, similarity } from '../src/lib/vector';
import { hashPassword, verifyPassword } from '../src/server/auth/password';
import {
  acceptDraft,
  buildChecklist,
  discardDraft,
  updateSectionContent,
} from '../src/server/services/document.service';
import { resolveDatasourceUrl } from '../src/server/db/datasource';

const prisma = new PrismaClient({ datasourceUrl: resolveDatasourceUrl() });

const BASE_URL = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function section(name: string, body: () => Promise<void> | void): Promise<void> {
  console.log(`\n${name}`);
  try {
    await body();
  } catch (error) {
    failures.push(`${name} (threw)`);
    console.log(`  FAIL  ${name} threw:`, error);
  }
}

// ---------------------------------------------------------------------------

async function verifyTextPipeline(): Promise<void> {
  const messy = 'Quantum error correc-\ntion is hard.\nIt needs many qubits.\n\nA second paragraph.';
  const normalized = normalizeExtractedText(messy);

  check(
    'PDF hyphenation across line breaks is rejoined',
    normalized.includes('correction'),
    normalized,
  );
  check(
    'single newlines inside a sentence become spaces',
    normalized.includes('hard. It needs'),
    normalized,
  );

  const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about surface codes and noise thresholds in superconducting qubits.`).join(' ');
  const chunks = chunkText(long, { maxChars: 500, overlapChars: 100 });

  check('long text splits into multiple chunks', chunks.length > 1, `got ${chunks.length}`);
  check('no chunk greatly exceeds the limit', chunks.every((c) => c.length <= 620));
  check('chunks are non-empty', chunks.every((c) => c.trim().length > 0));

  const short = chunkText('One short note.');
  check('a single short note survives chunking', short.length === 1, JSON.stringify(short));

  check('empty input yields no chunks', chunkText('   ').length === 0);
}

function verifyVectorMath(): void {
  const raw = [3, 0, 4, 0];
  const encoded = encodeEmbedding(raw);

  check('embedding encodes to 4 bytes per float', encoded.byteLength === raw.length * 4);

  const decoded = decodeEmbedding(encoded);
  check('decoded vector keeps its dimension', decoded.length === raw.length);

  // Encoding normalizes, so [3,0,4,0] becomes [0.6,0,0.8,0].
  check(
    'stored vectors are L2-normalized',
    Math.abs(decoded[0] - 0.6) < 1e-6 && Math.abs(decoded[2] - 0.8) < 1e-6,
    `${decoded[0]}, ${decoded[2]}`,
  );

  const self = similarity(decoded, decoded);
  check('a vector is maximally similar to itself', Math.abs(self - 1) < 1e-6, String(self));

  const orthogonal = Float32Array.from(normalize([0, 1, 0, 0]));
  check(
    'orthogonal vectors score ~0',
    Math.abs(similarity(decoded, orthogonal)) < 1e-6,
  );

  check(
    'mismatched dimensions degrade to 0 rather than throwing',
    similarity(decoded, Float32Array.from([1, 0])) === 0,
  );

  // Simulate a Buffer whose byteOffset is not 4-aligned, which is how Node
  // pools small allocations. Constructing a Float32Array over it directly
  // would throw; decodeEmbedding must copy.
  const pool = new Uint8Array(encoded.byteLength + 3);
  pool.set(encoded, 3);
  const unaligned = pool.subarray(3);
  check(
    'unaligned buffers decode without throwing',
    decodeEmbedding(unaligned).length === raw.length,
  );
}

async function verifyPasswordHashing(): Promise<void> {
  const hash = await hashPassword('correct-horse-battery');

  check('hash uses the scrypt scheme', hash.startsWith('scrypt$'));
  check('correct password verifies', await verifyPassword('correct-horse-battery', hash));
  check('wrong password is rejected', !(await verifyPassword('wrong-password', hash)));
  check('malformed hash is rejected, not thrown', !(await verifyPassword('x', 'garbage')));

  const second = await hashPassword('correct-horse-battery');
  check('identical passwords produce different hashes (salted)', hash !== second);
}

function verifyChecklist(): void {
  const items = buildChecklist({
    sections: [
      { id: 'a', title: 'Introduction', userContent: null, status: 'incomplete', _citationCount: 0 },
      {
        id: 'b',
        title: 'Methods',
        userContent: 'x'.repeat(900),
        status: 'reviewing',
        _citationCount: 0,
      },
    ],
    paperCount: 0,
    noteCount: 0,
  });

  check('missing sources is reported', items.some((i) => i.id === 'no-sources'));
  check('empty section is reported', items.some((i) => i.id === 'empty-a'));
  check('substantial but uncited section is reported', items.some((i) => i.id === 'uncited-b'));
  check('errors sort before warnings', items[0].severity === 'error');

  const clean = buildChecklist({
    sections: [
      {
        id: 'a',
        title: 'Introduction',
        userContent: 'y'.repeat(900),
        status: 'approved',
        _citationCount: 3,
      },
    ],
    paperCount: 2,
    noteCount: 1,
  });
  check('a complete document reports nothing outstanding', clean.length === 0, JSON.stringify(clean));
}

async function verifyDatabase(): Promise<void> {
  const email = `verify-${Date.now()}@researchio.local`;

  const user = await prisma.user.create({
    data: { email, name: 'Verify Bot', passwordHash: await hashPassword('irrelevant-value-here') },
  });

  const project = await prisma.project.create({
    data: {
      ownerId: user.id,
      name: 'Verification Project',
      document: {
        create: { type: 'Thesis', sections: { create: [{ title: 'Abstract', position: 0 }] } },
      },
    },
    include: { document: { include: { sections: true } } },
  });

  check('project is created with its document scaffold', project.document !== null);
  check('default sections are created', (project.document?.sections.length ?? 0) === 1);

  const note = await prisma.note.create({
    data: { projectId: project.id, content: 'A verification note about surface codes.' },
  });

  // Write a chunk with a real embedding to prove the Bytes round-trip works
  // through the database, not just in memory.
  const vector = normalize([0.1, 0.9, 0.3, 0.2]);
  await prisma.chunk.create({
    data: {
      projectId: project.id,
      noteId: note.id,
      content: note.content,
      position: 0,
      embedding: encodeEmbedding(vector),
    },
  });

  const stored = await prisma.chunk.findFirst({
    where: { noteId: note.id },
    select: { embedding: true },
  });

  const roundTripped = stored?.embedding ? decodeEmbedding(stored.embedding) : null;
  check('embedding survives a database round trip', roundTripped?.length === 4);
  check(
    'round-tripped vector still matches itself',
    roundTripped ? Math.abs(similarity(roundTripped, roundTripped) - 1) < 1e-6 : false,
  );

  // Ownership isolation: another user's project must be invisible.
  const otherUser = await prisma.user.create({
    data: {
      email: `other-${Date.now()}@researchio.local`,
      name: 'Other',
      passwordHash: await hashPassword('irrelevant-value-here'),
    },
  });

  const visible = await prisma.project.findMany({ where: { ownerId: otherUser.id } });
  check('a second user sees none of the first user\'s projects', visible.length === 0);

  // Cascade: deleting the project must remove its chunks and notes.
  await prisma.project.delete({ where: { id: project.id } });

  const orphanChunks = await prisma.chunk.count({ where: { projectId: project.id } });
  const orphanNotes = await prisma.note.count({ where: { projectId: project.id } });
  check('deleting a project cascades to its chunks', orphanChunks === 0);
  check('deleting a project cascades to its notes', orphanNotes === 0);

  await prisma.user.deleteMany({ where: { id: { in: [user.id, otherUser.id] } } });
}

/**
 * Builds a minimal but structurally valid PDF with one line of known text per
 * page, with correctly computed xref offsets.
 *
 * Generated rather than read from disk so this check depends on no fixture and
 * never touches unrelated files on the machine running it.
 */
function buildPdf(pages: readonly string[]): Buffer {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  pages.forEach((text, index) => {
    const stream = `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + index * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

async function verifyPdfExtraction(): Promise<void> {
  const { extractText } = await import('../src/server/ingestion/extract');

  const sentence =
    'Surface codes suppress logical errors when the physical error rate stays below threshold.';
  const pdf = buildPdf([sentence]);

  const result = await extractText({
    bytes: pdf,
    mimeType: 'application/pdf',
    originalName: 'synthetic.pdf',
  });

  check('PDF extraction recovers the embedded sentence', result.text.includes('Surface codes'), result.text.slice(0, 120));
  check('PDF extraction reports a page count', result.pageCount === 1, String(result.pageCount));

  // Page tracking: each page must be locatable in the extracted text, which is
  // what lets a citation name the page its passage came from.
  const twoPages = await extractText({
    bytes: buildPdf([
      'Page one covers the surface code threshold.',
      'Page two reports the correlated noise results.',
    ]),
    mimeType: 'application/pdf',
    originalName: 'two-pages.pdf',
  });
  const secondPage = twoPages.pageStarts?.[1];

  check('a multi-page PDF reports every page', twoPages.pageCount === 2, String(twoPages.pageCount));
  check(
    'each page is located within the extracted text',
    twoPages.pageStarts?.length === 2 &&
      !!secondPage &&
      twoPages.text.slice(secondPage[1]).startsWith('Page two'),
    JSON.stringify(twoPages.pageStarts),
  );

  const text = await extractText({
    bytes: Buffer.from('A plain text source document about quantum error correction research.'),
    mimeType: 'text/plain',
    originalName: 'notes.txt',
  });
  check('plain text extraction works', text.text.startsWith('A plain text source'));

  // A document with no readable text must fail loudly, not index nothing.
  let rejected = false;
  try {
    await extractText({ bytes: Buffer.from('tiny'), mimeType: 'text/plain', originalName: 'x.txt' });
  } catch {
    rejected = true;
  }
  check('a document with no usable text is rejected', rejected);

  let unsupported = false;
  try {
    await extractText({
      bytes: Buffer.from('binary'),
      mimeType: 'image/png',
      originalName: 'scan.png',
    });
  } catch {
    unsupported = true;
  }
  check('an unsupported format is rejected', unsupported);
}

async function verifyHttp(): Promise<void> {
  let reachable = true;

  const root = await fetch(BASE_URL, { redirect: 'manual' }).catch(() => null);
  if (!root) {
    reachable = false;
    console.log('  SKIP  dev server not reachable at ' + BASE_URL);
    return;
  }

  check(
    'unauthenticated request to / is redirected to /login',
    root.status === 307 || root.status === 302,
    `status ${root.status}`,
  );
  check(
    'redirect target is the sign-in page',
    (root.headers.get('location') ?? '').includes('/login'),
  );

  const headers = await fetch(`${BASE_URL}/login`);
  check(
    'X-Content-Type-Options is set',
    headers.headers.get('x-content-type-options') === 'nosniff',
  );
  check('X-Frame-Options is set', headers.headers.get('x-frame-options') === 'DENY');
  check(
    'Referrer-Policy is set',
    headers.headers.get('referrer-policy') === 'strict-origin-when-cross-origin',
  );

  // Health probe. Orchestrators route traffic on this, so it must prove real
  // dependencies rather than merely that the process is listening.
  const health = await fetch(`${BASE_URL}/api/health`);
  const healthBody = (await health.json()) as {
    status?: string;
    checks?: { database?: { ok?: boolean }; uploads?: { ok?: boolean } };
  };

  check('health endpoint returns 200', health.status === 200, `status ${health.status}`);
  check('health reports ok', healthBody.status === 'ok', JSON.stringify(healthBody.status));
  check('health verifies the database', healthBody.checks?.database?.ok === true);
  check('health verifies the upload directory', healthBody.checks?.uploads?.ok === true);
  check(
    'health is never cached',
    (health.headers.get('cache-control') ?? '').includes('no-store'),
  );

  // Content-Security-Policy.
  const csp = headers.headers.get('content-security-policy') ?? '';
  check('a CSP is set', csp.length > 0);
  check('script-src carries a per-request nonce', /script-src[^;]*'nonce-[^']+'/.test(csp), csp.slice(0, 80));
  check("script-src uses strict-dynamic", csp.includes("'strict-dynamic'"));
  check("object-src is 'none'", csp.includes("object-src 'none'"));
  check("frame-ancestors is 'none'", csp.includes("frame-ancestors 'none'"));
  check("connect-src is confined to 'self'", csp.includes("connect-src 'self'"));
  check(
    'scripts may not run inline without a nonce',
    !/script-src[^;]*'unsafe-inline'/.test(csp),
  );

  const secondCsp = (await fetch(`${BASE_URL}/login`)).headers.get('content-security-policy') ?? '';
  const nonceOf = (value: string) => value.match(/'nonce-([^']+)'/)?.[1];
  check(
    'the nonce differs on every request',
    Boolean(nonceOf(csp)) && nonceOf(csp) !== nonceOf(secondCsp),
  );

  const chat = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: '00000000-0000-4000-8000-000000000000', message: 'hi' }),
  });
  check('unauthenticated chat request is rejected with 401', chat.status === 401, `status ${chat.status}`);

  const file = await fetch(
    `${BASE_URL}/api/papers/00000000-0000-4000-8000-000000000000/file`,
  );
  check('unauthenticated file request is rejected with 401', file.status === 401, `status ${file.status}`);

  if (reachable) {
    const traversal = await fetch(`${BASE_URL}/api/papers/..%2F..%2F.env/file`);
    check(
      'path traversal in a paper id does not return a file',
      traversal.status >= 400,
      `status ${traversal.status}`,
    );
  }
}

/**
 * Creates a live session for a user and returns it as a Cookie header value.
 *
 * A test harness over the server's own session format: only the token's hash is
 * stored, exactly as `createSession` does.
 */
async function sessionCookieFor(userId: string): Promise<string> {
  const { createHash, randomBytes } = await import('node:crypto');
  const token = randomBytes(32).toString('base64url');

  await prisma.session.create({
    data: {
      tokenHash: createHash('sha256').update(token).digest('hex'),
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });

  return `researchio_session=${token}`;
}

/**
 * Renders the authenticated workspace over real HTTP.
 *
 * A session row is created directly and its token sent as a cookie. This is a
 * test harness exercising the server's own session format — it proves the
 * authenticated render path, ownership scoping and export all work end to end.
 */
async function verifyAuthenticatedPages(): Promise<void> {
  const probe = await fetch(BASE_URL, { redirect: 'manual' }).catch(() => null);
  if (!probe) {
    console.log('  SKIP  dev server not reachable');
    return;
  }

  const { createHash, randomBytes } = await import('node:crypto');
  const passwordHash = await hashPassword('irrelevant-value-here');
  const stamp = Date.now();

  const owner = await prisma.user.create({
    data: { email: `owner-${stamp}@researchio.local`, name: 'Owner', passwordHash },
  });
  const intruder = await prisma.user.create({
    data: { email: `intruder-${stamp}@researchio.local`, name: 'Intruder', passwordHash },
  });

  const project = await prisma.project.create({
    data: {
      ownerId: owner.id,
      name: 'Zebrafish Regeneration Study',
      researchQuestion: 'How do zebrafish regenerate cardiac tissue?',
      document: {
        create: {
          type: 'Thesis',
          sections: {
            create: [
              { title: 'Abstract', position: 0 },
              { title: 'Methodology', position: 1, userContent: 'x'.repeat(600) },
            ],
          },
        },
      },
      notes: { create: [{ content: 'Cardiomyocyte proliferation peaks at day seven.' }] },
    },
  });

  const ownerCookie = await sessionCookieFor(owner.id);
  const intruderCookie = await sessionCookieFor(intruder.id);

  const get = (path: string, cookie: string) =>
    fetch(`${BASE_URL}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' });

  // Notebook
  const notebook = await get(`/p/${project.id}`, ownerCookie);
  const notebookHtml = await notebook.text();
  check('authenticated notebook renders 200', notebook.status === 200, `status ${notebook.status}`);
  check('notebook shows the project name', notebookHtml.includes('Zebrafish Regeneration Study'));
  check(
    'notebook renders the saved note',
    notebookHtml.includes('Cardiomyocyte proliferation peaks'),
  );
  check(
    'AI-disabled banner is shown when no key is configured',
    process.env.GEMINI_API_KEY
      ? true
      : notebookHtml.includes('AI features are switched off'),
  );

  // Living document
  const document = await get(`/p/${project.id}/document`, ownerCookie);
  const documentHtml = await document.text();
  check('document view renders 200', document.status === 200);
  check('document lists its sections', documentHtml.includes('Methodology'));
  check('document shows the document type', documentHtml.includes('Thesis'));

  const checklist = await get(`/p/${project.id}/document?tab=checklist`, ownerCookie);
  const checklistHtml = await checklist.text();
  check('checklist tab renders', checklist.status === 200);
  check(
    'checklist reports the missing-sources problem',
    checklistHtml.includes('No source documents'),
  );

  // Sources
  const papers = await get(`/p/${project.id}/papers`, ownerCookie);
  check('sources view renders 200', papers.status === 200);

  // Assistant. This route is the only way to reach the assistant below 1200px,
  // so it must render on its own rather than only inside the shell panel.
  const assistant = await get(`/p/${project.id}/assistant`, ownerCookie);
  const assistantHtml = await assistant.text();
  check('assistant route renders 200', assistant.status === 200, `status ${assistant.status}`);
  check(
    'assistant route contains the chat composer',
    assistantHtml.includes('Ask the research assistant'),
  );

  const stolenAssistant = await get(`/p/${project.id}/assistant`, intruderCookie);
  check(
    "another user cannot open someone else's assistant",
    stolenAssistant.status === 404,
    `status ${stolenAssistant.status}`,
  );

  // Settings
  const settings = await get(`/p/${project.id}/settings`, ownerCookie);
  const settingsHtml = await settings.text();
  check('settings view renders 200', settings.status === 200);
  check(
    'settings prefills the research question',
    settingsHtml.includes('How do zebrafish regenerate'),
  );

  // Export
  const exported = await get(`/api/projects/${project.id}/export`, ownerCookie);
  const markdown = await exported.text();
  check('export returns 200', exported.status === 200);
  check(
    'export is served as a markdown attachment',
    (exported.headers.get('content-disposition') ?? '').includes('.md'),
  );
  check('export contains the document heading', markdown.includes('# Zebrafish Regeneration Study'));
  check('export contains the research question', markdown.includes('How do zebrafish regenerate'));

  // Ownership isolation over HTTP.
  const stolen = await get(`/p/${project.id}`, intruderCookie);
  check(
    "another user's project returns 404, not its contents",
    stolen.status === 404,
    `status ${stolen.status}`,
  );

  const stolenExport = await get(`/api/projects/${project.id}/export`, intruderCookie);
  check(
    "another user cannot export someone else's document",
    stolenExport.status >= 400,
    `status ${stolenExport.status}`,
  );

  // An expired session must not authenticate.
  const expiredToken = randomBytes(32).toString('base64url');
  await prisma.session.create({
    data: {
      tokenHash: createHash('sha256').update(expiredToken).digest('hex'),
      userId: owner.id,
      expiresAt: new Date(Date.now() - 1_000),
    },
  });
  const expired = await get(`/p/${project.id}`, `researchio_session=${expiredToken}`);
  check(
    'an expired session is rejected',
    expired.status === 307 || expired.status === 302 || expired.status === 404,
    `status ${expired.status}`,
  );

  await prisma.user.deleteMany({ where: { id: { in: [owner.id, intruder.id] } } });
}

/**
 * Regression checks for defects found after the initial build.
 *
 * Each corresponds to a specific bug; a failure here means it has returned.
 */
async function verifyRegressions(): Promise<void> {
  const passwordHash = await hashPassword('irrelevant-value-here');
  const user = await prisma.user.create({
    data: { email: `regress-${Date.now()}@researchio.local`, name: 'Regress', passwordHash },
  });

  const project = await prisma.project.create({
    data: { ownerId: user.id, name: 'Regression Project' },
  });

  // --- Chat history returned the OLDEST messages, so a long conversation
  // --- froze on its opening exchanges.
  const { listMessages } = await import('../src/server/services/chat.service');

  for (let index = 0; index < 60; index += 1) {
    await prisma.chatMessage.create({
      data: {
        projectId: project.id,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `message-${index}`,
        // Explicit timestamps: rows created in the same millisecond would
        // otherwise have no deterministic order.
        createdAt: new Date(Date.now() + index * 1000),
      },
    });
  }

  const recent = await listMessages(project.id, 50);
  check('chat history returns the newest turns, not the oldest', recent.at(-1)?.content === 'message-59', recent.at(-1)?.content);
  check('chat history is ordered oldest-first for reading', recent[0].content === 'message-10', recent[0].content);
  check('chat history respects its limit', recent.length === 50, String(recent.length));

  // --- getProject loaded every note on every render.
  const { getProject, NOTE_PAGE_SIZE } = await import('../src/server/services/project.service');

  for (let index = 0; index < NOTE_PAGE_SIZE + 10; index += 1) {
    await prisma.note.create({
      data: { projectId: project.id, content: `note-${index}` },
    });
  }

  const firstPage = await getProject(project.id, user.id);
  check('notes are paginated by default', firstPage.notes.length === NOTE_PAGE_SIZE, String(firstPage.notes.length));
  check('the true note total is still reported', firstPage._count.notes === NOTE_PAGE_SIZE + 10, String(firstPage._count.notes));

  const widened = await getProject(project.id, user.id, { noteLimit: NOTE_PAGE_SIZE + 25 });
  check('requesting more notes returns more', widened.notes.length === NOTE_PAGE_SIZE + 10, String(widened.notes.length));

  // --- The draft rate limiter was defined but never consumed.
  const { RATE_LIMITS, consume } = await import('../src/server/security/rate-limit');

  const key = `draft:regression-${Date.now()}`;
  let allowed = 0;
  for (let attempt = 0; attempt < RATE_LIMITS.draft.limit + 5; attempt += 1) {
    if (consume(key, RATE_LIMITS.draft).ok) {
      allowed += 1;
    }
  }
  check('the draft limiter caps requests', allowed === RATE_LIMITS.draft.limit, String(allowed));

  const draftSource = await import('node:fs/promises').then((fs) =>
    fs.readFile('src/server/actions/document.actions.ts', 'utf8'),
  );
  check(
    'the draft action actually consumes the limiter',
    draftSource.includes('RATE_LIMITS.draft'),
  );

  // --- Session renewal updated the database but could not update the cookie,
  // --- so "sliding" expiry silently did nothing.
  const sessionSource = await import('node:fs/promises').then((fs) =>
    fs.readFile('src/server/auth/session.ts', 'utf8'),
  );
  check(
    'no unreachable session renewal remains',
    !sessionSource.includes('extendIfStale'),
  );

  await prisma.user.delete({ where: { id: user.id } });
}

/**
 * Account management: password change, session revocation and full deletion.
 *
 * Exercised through the services rather than the HTTP forms, because Server
 * Actions are invoked by a React-specific protocol rather than a plain POST.
 */
async function verifyAccountManagement(): Promise<void> {
  const { createHash, randomBytes } = await import('node:crypto');
  const {
    changePassword,
    deleteAccount,
    updateProfile,
    verifyCurrentPassword,
  } = await import('../src/server/services/auth.service');

  const stamp = Date.now();
  const original = 'original-password-value';

  const user = await prisma.user.create({
    data: {
      email: `account-${stamp}@researchio.local`,
      name: 'Account Test',
      passwordHash: await hashPassword(original),
    },
  });

  // A project with an indexed chunk, to prove deletion cascades properly.
  const project = await prisma.project.create({
    data: { ownerId: user.id, name: 'To Be Deleted' },
  });
  const note = await prisma.note.create({
    data: { projectId: project.id, content: 'A note that must not survive deletion.' },
  });
  await prisma.chunk.create({
    data: {
      projectId: project.id,
      noteId: note.id,
      content: note.content,
      position: 0,
      embedding: encodeEmbedding([0.1, 0.2, 0.3, 0.4]),
    },
  });

  // Two sessions, so revocation can be observed.
  const makeSession = async () => {
    const token = randomBytes(32).toString('base64url');
    await prisma.session.create({
      data: {
        tokenHash: createHash('sha256').update(token).digest('hex'),
        userId: user.id,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    return token;
  };

  await makeSession();
  await makeSession();

  check('sessions exist before a password change', (await prisma.session.count({ where: { userId: user.id } })) === 2);

  // --- Password change
  let rejected = false;
  try {
    await changePassword(user.id, {
      currentPassword: 'not-the-right-password',
      newPassword: 'a-brand-new-password',
    });
  } catch {
    rejected = true;
  }
  check('changing a password requires the current one', rejected);

  await changePassword(user.id, {
    currentPassword: original,
    newPassword: 'a-brand-new-password',
  });

  check('the new password now verifies', await verifyCurrentPassword(user.id, 'a-brand-new-password'));
  check('the old password no longer verifies', !(await verifyCurrentPassword(user.id, original)));

  // --- Profile
  await updateProfile(user.id, { name: 'Renamed', email: `renamed-${stamp}@researchio.local` });
  const renamed = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });
  check('profile updates persist', renamed?.name === 'Renamed');

  const other = await prisma.user.create({
    data: {
      email: `taken-${stamp}@researchio.local`,
      name: 'Taken',
      passwordHash: await hashPassword('irrelevant-value-here'),
    },
  });

  let conflicted = false;
  try {
    await updateProfile(user.id, { name: 'X', email: `taken-${stamp}@researchio.local` });
  } catch {
    conflicted = true;
  }
  check('an email already in use is rejected', conflicted);

  // --- Deletion
  const storageKeys = await deleteAccount(user.id);
  check('deletion returns storage keys for file cleanup', Array.isArray(storageKeys));

  const remainingUser = await prisma.user.findUnique({ where: { id: user.id } });
  check('the user row is gone', remainingUser === null);
  check('their projects are gone', (await prisma.project.count({ where: { id: project.id } })) === 0);
  check('their notes are gone', (await prisma.note.count({ where: { projectId: project.id } })) === 0);
  check('their indexed chunks are gone', (await prisma.chunk.count({ where: { projectId: project.id } })) === 0);
  check('their sessions are gone', (await prisma.session.count({ where: { userId: user.id } })) === 0);

  await prisma.user.delete({ where: { id: other.id } });
}

/**
 * Citation provenance: how citations render and export, and what discard,
 * accept and editing do to them.
 *
 * Drafting needs a live provider, so draft citation rows are inserted directly;
 * everything that happens to them afterwards is exercised for real. The earlier
 * implementation deleted every citation on a section when drafting or
 * discarding, stripping provenance from prose that had already been accepted.
 */
async function verifyCitationProvenance(): Promise<void> {
  const probe = await fetch(BASE_URL, { redirect: 'manual' }).catch(() => null);
  if (!probe) {
    console.log('  SKIP  dev server not reachable');
    return;
  }

  const owner = await prisma.user.create({
    data: {
      email: `citations-${Date.now()}@researchio.local`,
      name: 'Citations',
      passwordHash: await hashPassword('irrelevant-value-here'),
    },
  });

  try {
    const project = await prisma.project.create({
      data: {
        ownerId: owner.id,
        name: 'Cardiac Regeneration',
        document: {
          create: {
            type: 'Thesis',
            sections: {
              create: [
                {
                  title: 'Discussion',
                  position: 0,
                  status: 'drafting',
                  userContent:
                    'Cardiomyocytes proliferate after injury [S1]. Scar tissue resolves within weeks [S2]. A claim with no traceable source [S?].',
                  // Reuses accepted S1 and introduces pending S3 in one marker.
                  aiContent: 'Regeneration also depends on the epicardium [S1, S3].',
                },
              ],
            },
          },
        },
      },
      include: { document: { include: { sections: true } } },
    });

    const sectionId = project.document!.sections[0].id;

    const paper = await prisma.paper.create({
      data: {
        projectId: project.id,
        title: 'Heart Regeneration in Zebrafish',
        authors: 'Poss, K.',
        year: 2002,
        originalName: 'poss-2002.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        status: 'ready',
      },
    });

    const note = await prisma.note.create({
      data: { projectId: project.id, content: 'Scar resolved by day thirty in my imaging.' },
    });

    await prisma.citationLink.createMany({
      data: [
        {
          sectionId,
          paperId: paper.id,
          ordinal: 1,
          status: 'accepted',
          quote: 'Cardiomyocytes re-enter the cell cycle after amputation',
          pageStart: 3,
          pageEnd: 3,
        },
        {
          sectionId,
          noteId: note.id,
          ordinal: 2,
          status: 'accepted',
          quote: 'Scar resolved by day thirty in my imaging.',
        },
        {
          sectionId,
          paperId: paper.id,
          ordinal: 3,
          status: 'pending',
          quote: 'The epicardium activates organ-wide after injury',
          pageStart: 5,
          pageEnd: 6,
        },
      ],
    });

    const cookie = await sessionCookieFor(owner.id);
    const get = (path: string) =>
      fetch(`${BASE_URL}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' });

    // --- Rendering
    const documentHtml = await (await get(`/p/${project.id}/document`)).text();

    check(
      'a marker in accepted prose links to its source entry',
      documentHtml.includes(`href="#doc-${sectionId}-s1"`),
    );
    check(
      'the source entry carries the matching anchor',
      documentHtml.includes(`id="doc-${sectionId}-s1"`),
    );
    check(
      'a paper citation opens the original at its page',
      documentHtml.includes('Open at p. 3') &&
        documentHtml.includes(`/api/papers/${paper.id}/file#page=3`),
    );
    check(
      'grouped markers render each source as a link',
      documentHtml.includes(`href="#draft-${sectionId}-s1"`) &&
        documentHtml.includes(`href="#draft-${sectionId}-s3"`),
    );
    check(
      'a new draft source is listed with its page range',
      documentHtml.includes(`id="draft-${sectionId}-s3"`) && documentHtml.includes('Open at pp. 5–6'),
    );
    check(
      'a citation to no source is flagged rather than dropped',
      documentHtml.includes('Unresolved citation'),
    );

    const checklistHtml = await (await get(`/p/${project.id}/document?tab=checklist`)).text();
    check(
      'the checklist reports citations that point to no source',
      checklistHtml.includes('citations that point to no source'),
    );

    // A PDF indexed before page tracking offers a way to gain page numbers.
    const papersHtml = await (await get(`/p/${project.id}/papers`)).text();
    check(
      'a PDF without page tracking offers to add page numbers',
      papersHtml.includes('Add page numbers'),
    );

    // --- Export
    const markdown = await (await get(`/api/projects/${project.id}/export`)).text();

    check(
      'export turns markers into footnotes',
      markdown.includes('proliferate after injury [^1].') && !/\[S\d/.test(markdown),
    );
    check(
      'export footnotes name the page',
      markdown.includes('[^1]: Poss, K. (2002). *Heart Regeneration in Zebrafish*, p. 3.'),
    );
    check("export attributes a note as the researcher's own", markdown.includes("[^2]: Researcher's note."));
    check('export flags a citation to no source', markdown.includes('[citation needed]'));
    check('export leaves out the unreviewed draft', !markdown.includes('epicardium'));

    // --- Discard, accept, edit
    const citationState = async () =>
      (
        await prisma.citationLink.findMany({ where: { sectionId }, orderBy: { ordinal: 'asc' } })
      ).map((row) => `${row.ordinal}:${row.status}`);

    await discardDraft(owner.id, sectionId);
    check(
      'discarding a draft removes only its pending citations',
      (await citationState()).join(',') === '1:accepted,2:accepted',
      (await citationState()).join(','),
    );

    await prisma.section.update({
      where: { id: sectionId },
      data: { aiContent: 'The epicardium matters too [S3].', status: 'drafting' },
    });
    await prisma.citationLink.create({
      data: { sectionId, paperId: paper.id, ordinal: 3, status: 'pending', quote: 'Epicardium', pageStart: 5, pageEnd: 6 },
    });

    await acceptDraft(owner.id, sectionId);
    check(
      'accepting promotes the draft citations and keeps the existing ones',
      (await citationState()).join(',') === '1:accepted,2:accepted,3:accepted',
      (await citationState()).join(','),
    );

    const merged = await prisma.section.findUniqueOrThrow({
      where: { id: sectionId },
      select: { userContent: true },
    });
    check(
      'accepted prose keeps its original markers',
      (merged.userContent ?? '').startsWith('Cardiomyocytes proliferate after injury [S1].'),
    );

    await updateSectionContent(owner.id, {
      sectionId,
      userContent: 'Cardiomyocytes proliferate after injury [S1]. The epicardium matters too [S3].',
    });
    check(
      'removing a marker while editing prunes that citation',
      (await citationState()).join(',') === '1:accepted,3:accepted',
      (await citationState()).join(','),
    );

    await prisma.section.update({
      where: { id: sectionId },
      data: { aiContent: 'The epicardium again [S3].' },
    });
    await updateSectionContent(owner.id, {
      sectionId,
      userContent: 'Cardiomyocytes proliferate after injury [S1].',
    });
    check(
      'a citation still referenced by a pending draft survives an edit',
      (await citationState()).join(',') === '1:accepted,3:accepted',
      (await citationState()).join(','),
    );
  } finally {
    await prisma.user.delete({ where: { id: owner.id } });
  }
}

/**
 * Claim verification: deterministic verdicts, how stored reports render,
 * staleness, and the checklist.
 *
 * Model verdicts need a live provider, so a report carrying them is stored
 * directly; everything that needs no model runs for real.
 */
async function verifyClaimReports(): Promise<void> {
  const probe = await fetch(BASE_URL, { redirect: 'manual' }).catch(() => null);
  if (!probe) {
    console.log('  SKIP  dev server not reachable');
    return;
  }

  const { createHash } = await import('node:crypto');
  const { extractClaims } = await import('../src/lib/text/claims');
  const { checkClaimsNow } = await import('../src/server/services/verification.service');
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');

  const owner = await prisma.user.create({
    data: {
      email: `claims-${Date.now()}@researchio.local`,
      name: 'Claims',
      passwordHash: await hashPassword('irrelevant-value-here'),
    },
  });

  try {
    const deterministic =
      'Regeneration succeeded in 85 percent of animals. Adult mammalian hearts regenerate fully [S?].';
    const reviewed =
      'Cardiomyocytes re-enter the cell cycle after injury [S1]. The heart regrows completely within forty-eight hours [S1].';

    const project = await prisma.project.create({
      data: {
        ownerId: owner.id,
        name: 'Claim Checks',
        document: {
          create: {
            type: 'Thesis',
            sections: {
              create: [
                { title: 'Results', position: 0, userContent: deterministic },
                {
                  title: 'Discussion',
                  position: 1,
                  status: 'drafting',
                  userContent: reviewed,
                  aiContent: 'The epicardium activates across the whole organ [S1].',
                },
              ],
            },
          },
        },
      },
      include: { document: { include: { sections: { orderBy: { position: 'asc' } } } } },
    });

    const [results, discussion] = project.document!.sections;

    await prisma.citationLink.create({
      data: {
        sectionId: discussion.id,
        ordinal: 1,
        status: 'accepted',
        quote: 'Cardiomyocytes re-enter the cell cycle after amputation.',
        pageStart: 3,
        pageEnd: 3,
      },
    });

    // --- Deterministic verdicts need no model call
    const outcome = await checkClaimsNow(results.id, 'document');
    const stored = await prisma.claimReport.findUnique({
      where: { sectionId_target: { sectionId: results.id, target: 'document' } },
    });
    const verdicts = (JSON.parse(stored?.results ?? '[]') as Array<{ verdict: string }>).map(
      (result) => result.verdict,
    );

    check(
      'a check with nothing to ask the model makes no model call',
      outcome?.sentToModel === 0,
      JSON.stringify(outcome),
    );
    check('the claim check completes', stored?.status === 'complete', stored?.status);
    check('an uncited figure is flagged', verdicts.includes('uncited_figure'), verdicts.join(', '));
    check('a claim citing no source is flagged', verdicts.includes('unresolved'));
    check('a report records the text it describes', stored?.contentHash === sha(deterministic));

    // --- Stored model verdicts, and a stale report
    const [supported, overstated] = extractClaims(reviewed);

    await prisma.claimReport.createMany({
      data: [
        {
          sectionId: discussion.id,
          target: 'document',
          contentHash: sha(reviewed),
          status: 'complete',
          results: JSON.stringify([
            { start: supported.start, end: supported.end, ordinals: [1], verdict: 'supported', reason: 'Stated directly.', key: 'a' },
            {
              start: overstated.start,
              end: overstated.end,
              ordinals: [1],
              verdict: 'unsupported',
              reason: 'The passage gives no forty-eight hour timescale.',
              key: 'b',
            },
          ]),
        },
        {
          sectionId: discussion.id,
          target: 'draft',
          contentHash: sha('an earlier version of the draft'),
          status: 'complete',
          results: '[]',
        },
      ],
    });

    const cookie = await sessionCookieFor(owner.id);
    const get = (path: string) =>
      fetch(`${BASE_URL}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' });

    const html = await (await get(`/p/${project.id}/document`)).text();

    check('an unsupported claim is highlighted', html.includes('class="claim claim-unsupported"'));
    check("the checker's reason is shown", html.includes('The passage gives no forty-eight hour timescale.'));
    check('a supported claim is left unmarked', !html.includes('claim claim-supported'));
    check(
      'deterministic flags are highlighted',
      html.includes('class="claim claim-uncited_figure"') && html.includes('class="claim claim-unresolved"'),
    );
    check('the report summarises its verdicts', html.includes('2 claims checked'));
    check(
      'a report for text that has since changed says so',
      html.includes('The text has changed since its claims were checked.'),
    );

    const checklistHtml = await (await get(`/p/${project.id}/document?tab=checklist`)).text();
    check(
      'the checklist reports claims their sources do not support',
      checklistHtml.includes('has claims its sources do not support'),
    );
  } finally {
    await prisma.user.delete({ where: { id: owner.id } });
  }
}

/** The assistant must remain reachable when the side panel is hidden. */
async function verifyAssistantReachable(): Promise<void> {
  const fs = await import('node:fs/promises');

  const routeExists = await fs
    .access('src/app/p/[projectId]/assistant/page.tsx')
    .then(() => true)
    .catch(() => false);
  check('a dedicated assistant route exists', routeExists);

  const sidebar = await fs.readFile('src/components/workspace/Sidebar.tsx', 'utf8');
  check('the sidebar links to the assistant', sidebar.includes('/assistant'));

  const css = await fs.readFile('src/app/globals.css', 'utf8');
  check(
    'the assistant nav appears exactly when the panel is hidden',
    css.includes('.nav-when-panel-hidden'),
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Researchio verification\n' + '='.repeat(40));

  await section('Text extraction and chunking', verifyTextPipeline);
  await section('Vector encoding and similarity', verifyVectorMath);
  await section('Password hashing', verifyPasswordHashing);
  await section('Completion checklist', verifyChecklist);
  await section('Document text extraction', verifyPdfExtraction);
  await section('Database integration', verifyDatabase);
  await section('Regressions', verifyRegressions);
  await section('Account management', verifyAccountManagement);
  await section('Assistant reachability', verifyAssistantReachable);
  await section(`HTTP surface (${BASE_URL})`, verifyHttp);
  await section('Authenticated workspace', verifyAuthenticatedPages);
  await section('Citation provenance', verifyCitationProvenance);
  await section('Claim verification', verifyClaimReports);

  console.log('\n' + '='.repeat(40));
  console.log(`${passed} passed, ${failures.length} failed`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
