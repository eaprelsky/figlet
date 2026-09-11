import test from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../server/cache.mjs';
import { createCatalog } from '../server/catalog.mjs';
import { createIndexer } from '../server/indexer.mjs';
import { makeBook } from '../server/books.mjs';

function fixture() {
  const blocks = [{ kind: 'heading', text: 'Глава I', level: 1 }];
  for (let c = 0; c < 3; c++) {
    if (c > 0) blocks.push({ kind: 'heading', text: `Глава ${c + 1}`, level: 1 });
    for (let i = 0; i < 12; i++)
      blocks.push({
        kind: 'paragraph',
        text: `Глава ${c + 1}, абзац ${i + 1}. Достаточно длинный точный текст для проверки порядка разбора.`,
      });
  }
  return makeBook({ title: 'Книга', author: 'Автор', blocks });
}

test('indexer analyses the whole book: current path first, then by importance', async () => {
  const cache = createCache(':memory:');
  const catalog = createCatalog(cache.raw);
  const book = fixture();
  catalog.register(book);
  const order = [];
  const indexer = createIndexer({
    cache,
    catalog,
    analyze: async (body) => {
      order.push(body.section);
      // Mark the first chapter's first child as the most important one.
      const important = body.children.find((c) => c.id.endsWith(':0-3'));
      return {
        summary: `Обзор ${body.section}`,
        ideas: [],
        importance: important ? 5 : 3,
        why: '',
        skip: '',
        children: body.children.map((c) => ({
          id: c.id,
          title: c.title,
          summary: 'Смысл.',
          importance: c.id === important?.id ? 5 : 2,
        })),
        model: 'test-model',
        createdAt: Date.now(),
        coverage: 'full',
      };
    },
    key: 'shared',
    model: 'test-model',
    budget: (action) => action(),
  });
  indexer.request(book.id, 'root', 'test-model');
  await new Promise((resolve) => setImmediate(resolve));
  // The async job runs in the background; give it a bounded number of turns.
  for (let i = 0; i < 200 && indexer.status(book.id).status === 'running'; i++)
    await new Promise((resolve) => setImmediate(resolve));
  const final = indexer.status(book.id);
  assert.equal(final.status, 'done');
  assert.equal(order[0], 'Книга'); // root map first
  const analyses = indexer.analyses(book.id, 'test-model');
  assert.ok(Object.keys(analyses).length >= 3);
  assert.ok(analyses.root);
  // Chapters enter by declared importance before document order.
  assert.ok(order.indexOf('Глава I') < order.indexOf('Глава 2'));
  assert.ok(order.indexOf('Глава 2') < order.indexOf('Глава 3'));
});

test('indexer pauses when the daily budget is exhausted and stores partial results', async () => {
  const cache = createCache(':memory:');
  const catalog = createCatalog(cache.raw);
  const book = fixture();
  catalog.register(book);
  let calls = 0;
  const indexer = createIndexer({
    cache,
    catalog,
    analyze: async (body) => {
      if (++calls > 2) {
        const error = new Error('Дневной лимит');
        error.status = 429;
        throw error;
      }
      return {
        summary: `Обзор ${body.section}`,
        ideas: [],
        importance: 3,
        why: '',
        skip: '',
        children: body.children.map((c) => ({
          id: c.id,
          title: c.title,
          summary: 'Смысл.',
          importance: 3,
        })),
        model: 'test-model',
        createdAt: Date.now(),
        coverage: 'full',
      };
    },
    key: 'shared',
    model: 'test-model',
    budget: (action) => action(),
  });
  indexer.request(book.id, 'root', 'test-model');
  for (let i = 0; i < 200 && indexer.status(book.id).status === 'running'; i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(indexer.status(book.id).status, 'paused');
  assert.equal(Object.keys(indexer.analyses(book.id, 'test-model')).length, 2);
  // A later request resumes the job; the budget is still empty so it stays paused.
  indexer.request(book.id, 'root', 'test-model');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(['running', 'paused'].includes(indexer.status(book.id).status), true);
});
