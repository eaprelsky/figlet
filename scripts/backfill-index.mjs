// One-off backfill: rerun the whole-book indexer for editions with missing
// analyses. Runs inside the figlet container next to the live server (same
// sqlite file, WAL); cached nodes are free, only the gaps hit the model.
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';

const base = 'file:///app/server/';
const { createCache } = await import(base + 'cache.mjs');
const { createCatalog } = await import(base + 'catalog.mjs');
const { createIndexer } = await import(base + 'indexer.mjs');
const { analyze } = await import(base + 'ai.mjs');
const { withAiBudget } = await import(base + 'budget.mjs');

if (!process.env.DEEPSEEK_API_KEY) {
  console.log('NO KEY: DEEPSEEK_API_KEY missing');
  process.exit(1);
}
const cache = createCache();
const catalog = createCatalog(cache.raw, { filesDir: path.join(cache.dir, 'files') });
const indexer = createIndexer({
  cache,
  catalog,
  analyze,
  key: process.env.DEEPSEEK_API_KEY,
  budget: withAiBudget,
});

// Complaint first, then zero-coverage books, then partially indexed ones.
const queue = [
  ['39aa995b2675b544337ac634', 'Счастливое старение'],
  ['ceb66b9c75370784195f6980', 'Государь (224 абз.)'],
  ['bbcd93570349c38223d559cf', 'Наедине с собой (552 абз.)'],
  ['7cd3c2f48311c950e49efca2', 'Обществознание ЕГЭ'],
  ['6a4a81a0ecccf32acf759c2f', 'Практический смысл'],
  ['df869b08d0d20120619345a1', 'Безумство храбрых'],
  ['fbd177762dfdae0af0ecba69', 'Империализм'],
  ['1d7edb723f9090c576eba210', 'Государство и революция'],
  ['cbbfae450a05b4c63d99e6b6', 'Война и мир'],
];

for (const [id, label] of queue) {
  const book = catalog.book(id);
  if (!book) {
    console.log(`SKIP ${label} ${id}: нет в каталоге`);
    continue;
  }
  console.log(`START ${label} (${id})`);
  indexer.request(id, 'root');
  for (;;) {
    await sleep(5000);
    const s = indexer.status(id);
    process.stdout.write(`\r  ${s.status} ${s.done}/${s.total}${s.failed ? ` failed:${s.failed}` : ''}${s.capped ? ' capped' : ''}    `);
    if (s.status !== 'running') break;
  }
  const s = indexer.status(id);
  console.log(`\nEND ${label}: ${s.status} done=${s.done} total=${s.total} failed=${s.failed || 0}${s.error ? ` error=${s.error}` : ''}`);
  if (s.status === 'paused') {
    console.log('Дневной лимит AI-запросов — останавливаюсь, остальное доберут читатели.');
    break;
  }
}
console.log('BACKFILL DONE');
process.exit(0);
