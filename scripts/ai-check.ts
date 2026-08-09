import 'dotenv/config';

/**
 * Live AI provider check.
 *
 * Separate from `scripts/verify.ts` because it requires a configured
 * GEMINI_API_KEY and spends real quota, so it must never gate CI.
 *
 * It exists because model names are retired without warning, and a dead name
 * fails only at call time: uploads appear to succeed while every document is
 * silently left unindexed. This catches that in seconds.
 *
 * Run with:
 *   npm run ai:check
 */

import { aiEnabled, embedTexts, generateText } from '../src/server/ai/provider';
import { decodeEmbedding, encodeEmbedding, normalize, similarity } from '../src/lib/vector';
import { env } from '../src/server/config/env';

let failures = 0;

function check(name: string, condition: boolean, detail?: string): void {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) {
    failures += 1;
  }
}

async function main(): Promise<void> {
  console.log('Live AI provider check\n' + '='.repeat(40));

  if (!aiEnabled()) {
    console.log('\nGEMINI_API_KEY is not set. Nothing to check.');
    console.log('Add it to .env or your environment, then re-run.');
    return;
  }

  console.log(`  text model:      ${env.ai.textModel}`);
  console.log(`  embedding model: ${env.ai.embeddingModel}\n`);

  // --- Embeddings -----------------------------------------------------------
  const passages = [
    'Surface codes suppress logical errors below the fault-tolerance threshold.',
    'Zebrafish regenerate cardiac tissue through cardiomyocyte proliferation.',
    'Quantum error correction requires many physical qubits per logical qubit.',
  ];

  const startedAt = Date.now();
  const vectors = await embedTexts(passages);
  const elapsed = Date.now() - startedAt;

  check(
    'embedding model responds',
    vectors.length === passages.length,
    `${vectors.length}/${passages.length} vectors in ${elapsed}ms`,
  );
  check('vectors have a usable dimension', vectors[0].length > 0, `dim=${vectors[0].length}`);

  // Round-trip through the exact storage encoding used by the indexer.
  const stored = vectors.map((vector) => decodeEmbedding(encodeEmbedding(vector)));

  // Semantic sanity. If two passages on the same topic do not score higher than
  // two on unrelated topics, retrieval is meaningless no matter what the API
  // returned — this catches a model that responds but embeds nonsense.
  const related = similarity(stored[0], stored[2]);
  const unrelated = similarity(stored[0], stored[1]);

  check(
    'related passages outrank unrelated ones',
    related > unrelated,
    `related=${related.toFixed(4)} vs unrelated=${unrelated.toFixed(4)}`,
  );

  // Mirror the query path in retrieval.service.
  const [queryVector] = await embedTexts(['How do surface codes handle errors?']);
  const query = Float32Array.from(normalize(queryVector));

  const ranked = stored
    .map((vector, index) => ({ index, score: similarity(query, vector) }))
    .sort((a, b) => b.score - a.score);

  console.log('\n  ranking for "How do surface codes handle errors?"');
  for (const { index, score } of ranked) {
    console.log(`    ${score.toFixed(4)}  ${passages[index].slice(0, 58)}…`);
  }
  console.log();

  check(
    'a topically correct passage ranks first',
    ranked[0].index === 0 || ranked[0].index === 2,
    `winner was passage ${ranked[0].index}`,
  );

  // --- Generation -----------------------------------------------------------
  const generationStartedAt = Date.now();
  const reply = await generateText('Reply with exactly the word: OPERATIONAL. Nothing else.', {
    temperature: 0,
  });

  check(
    'text model responds',
    reply.toUpperCase().includes('OPERATIONAL'),
    `"${reply.trim().slice(0, 40)}" in ${Date.now() - generationStartedAt}ms`,
  );

  console.log('\n' + '='.repeat(40));
  console.log(failures === 0 ? 'All live AI checks passed.' : `${failures} check(s) failed.`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFAILED: ${message}`);

  const cause = (error as { cause?: unknown }).cause;
  if (cause) {
    console.error(`cause: ${String(cause).slice(0, 400)}`);
  }

  console.error(
    '\nIf this reports a 404 for a model, the name has been retired. List valid models with:\n' +
      '  https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY',
  );

  process.exitCode = 1;
});
