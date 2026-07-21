import 'dotenv/config';

import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';

/**
 * Development seed.
 *
 * Creates a demo account with one project and a realistic starting outline.
 *
 * Deliberately does NOT create fake papers or pre-written AI drafts: a seeded
 * paper with no file behind it and no embeddings cannot be searched, cited or
 * opened, which makes the app look functional while every feature that touches
 * it fails. Uploading a real PDF after signing in exercises the actual pipeline.
 *
 * Password hashing is duplicated here rather than imported from
 * `src/server/auth/password.ts` because that module is marked `server-only`,
 * which throws outside a Next.js runtime. The format is asserted by a check at
 * the end of this script so the two cannot silently diverge.
 */

const prisma = new PrismaClient();
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const COST = { N: 32_768, r: 8, p: 1 };
const MAX_MEMORY = 96 * 1024 * 1024;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64, { ...COST, maxmem: MAX_MEMORY });
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), derived.toString('base64')].join(
    '$',
  );
}

const DEMO_EMAIL = 'demo@researchio.local';
const DEMO_PASSWORD = 'research-demo-2026';

const SECTIONS = [
  'Abstract',
  'Introduction',
  'Literature Review',
  'Methodology',
  'Results',
  'Discussion',
  'Conclusion',
];

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // Idempotent: re-running updates the demo account rather than failing on the
  // unique email constraint.
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash },
    create: { email: DEMO_EMAIL, name: 'Demo Researcher', passwordHash },
  });

  const existing = await prisma.project.findFirst({
    where: { ownerId: user.id, name: 'Quantum Error Correction' },
    select: { id: true },
  });

  if (!existing) {
    await prisma.project.create({
      data: {
        ownerId: user.id,
        name: 'Quantum Error Correction',
        researchQuestion:
          'How effectively do topological surface codes mitigate correlated noise in superconducting qubit architectures?',
        document: {
          create: {
            type: 'Thesis',
            sections: {
              create: SECTIONS.map((title, position) => ({ title, position })),
            },
          },
        },
        notes: {
          create: [
            {
              content:
                'Surface code threshold is often quoted near 1%, but that figure assumes independent noise. Need to check what happens under correlated errors — this may be the gap the thesis addresses.',
            },
            {
              content:
                'Open question for the methodology section: what cryogenic setup details do reviewers expect to see reported for superconducting qubit measurements?',
            },
          ],
        },
        timelineEvents: {
          create: {
            type: 'PROJECT_CREATED',
            description: 'Created thesis project "Quantum Error Correction"',
          },
        },
      },
    });
  }

  // Guard against the hashing here drifting from the application's format.
  const [scheme, n, r, p, salt, key] = passwordHash.split('$');
  const valid =
    scheme === 'scrypt' &&
    Number(n) > 0 &&
    Number(r) > 0 &&
    Number(p) > 0 &&
    Buffer.from(salt, 'base64').length === 16 &&
    Buffer.from(key, 'base64').length === 64;

  if (!valid) {
    throw new Error('Seed produced a password hash the application cannot verify.');
  }

  console.log('Seed complete.');
  console.log(`  Email:    ${DEMO_EMAIL}`);
  console.log(`  Password: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
