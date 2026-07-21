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
import { buildChecklist } from '../src/server/services/document.service';
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
 * Builds a minimal but structurally valid single-page PDF containing known
 * text, with correctly computed xref offsets.
 *
 * Generated rather than read from disk so this check depends on no fixture and
 * never touches unrelated files on the machine running it.
 */
function buildMinimalPdf(sentence: string): Buffer {
  const contentStream = `BT /F1 12 Tf 72 700 Td (${sentence}) Tj ET`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

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
  const pdf = buildMinimalPdf(sentence);

  const result = await extractText({
    bytes: pdf,
    mimeType: 'application/pdf',
    originalName: 'synthetic.pdf',
  });

  check('PDF extraction recovers the embedded sentence', result.text.includes('Surface codes'), result.text.slice(0, 120));
  check('PDF extraction reports a page count', result.pageCount === 1, String(result.pageCount));

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

  async function sessionFor(userId: string): Promise<string> {
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

  const ownerCookie = await sessionFor(owner.id);
  const intruderCookie = await sessionFor(intruder.id);

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

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Researchio verification\n' + '='.repeat(40));

  await section('Text extraction and chunking', verifyTextPipeline);
  await section('Vector encoding and similarity', verifyVectorMath);
  await section('Password hashing', verifyPasswordHashing);
  await section('Completion checklist', verifyChecklist);
  await section('Document text extraction', verifyPdfExtraction);
  await section('Database integration', verifyDatabase);
  await section(`HTTP surface (${BASE_URL})`, verifyHttp);
  await section('Authenticated workspace', verifyAuthenticatedPages);

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
