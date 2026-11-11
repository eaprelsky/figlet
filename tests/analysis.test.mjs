import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../server/ai.mjs';

const reply = (content) =>
  Response.json({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
  });

// The last message holds the JSON payload; level calls carry paragraphs,
// children passes only the sections they must summarize.
const payload = (init) => JSON.parse(JSON.parse(init.body).messages.at(-1).content);

test('a missing section summary gets one retry, then degrades gracefully', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls++;
    const data = payload(init);
    return data.paragraphs
      ? reply({ summary: 'Обзор', children: [{ id: 'a', title: 'Есть', summary: 'Сводка a' }] })
      : reply({ children: [] }); // retry pass also comes back empty
  });
  const body = {
    paragraphs: ['Оригинальный текст'],
    children: [
      { id: 'a', title: 'Есть' },
      { id: 'part', title: 'Раздел' },
    ],
  };
  const result = await analyze(body, 'test-key');
  assert.equal(calls, 2); // level call + targeted retry
  assert.equal(result.summary, 'Обзор');
  assert.equal(result.children[0].summary, 'Сводка a');
  assert.equal(result.children[1].summary, '');
  assert.equal(result.children[1].title, 'Раздел'); // original title kept
});

test('the targeted retry fills the sections the first call missed', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls++;
    if (payload(init).paragraphs) return reply({ summary: 'Обзор', children: [] });
    return reply({
      children: [{ id: 'part', title: 'Раздел', summary: 'Смысл раздела', importance: 4 }],
    });
  });
  const result = await analyze(
    { paragraphs: ['Текст'], children: [{ id: 'part', title: 'Раздел' }] },
    'test-key',
  );
  assert.equal(calls, 2);
  assert.equal(result.children[0].summary, 'Смысл раздела');
  assert.equal(result.children[0].importance, 4);
});

test('wide levels summarize sections in bounded batches', async (t) => {
  const children = Array.from({ length: 30 }, (_, i) => ({
    id: `s${i}`,
    title: `Раздел ${i}`,
    start: i,
    end: i + 1,
    preview: 'Абзац',
  }));
  const asked = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const data = payload(init);
    if (data.paragraphs) return reply({ summary: 'Обзор' });
    asked.push(data.children.map((c) => c.id));
    return reply({
      children: data.children.map((c) => ({
        id: c.id,
        title: c.title,
        summary: `Сводка ${c.id}`,
        importance: 3,
      })),
    });
  });
  const result = await analyze({ paragraphs: ['Текст'], children }, 'test-key');
  assert.equal(result.summary, 'Обзор');
  assert.equal(result.children.length, 30);
  for (const child of result.children) assert.equal(child.summary, `Сводка ${child.id}`);
  // Every children pass stays within the batch bound and covers each id once.
  const flat = asked.flat();
  assert.equal(flat.length, 30);
  assert.equal(new Set(flat).size, 30);
  for (const batch of asked) assert.ok(batch.length <= 25);
});

test('a level where no section summary could be produced still fails loudly', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) =>
    payload(init).paragraphs ? reply({ summary: 'Обзор' }) : reply({ children: [] }),
  );
  const children = Array.from({ length: 26 }, (_, i) => ({
    id: `s${i}`,
    title: `Раздел ${i}`,
    start: i,
    end: i + 1,
    preview: 'Абзац',
  }));
  await assert.rejects(
    () => analyze({ paragraphs: ['Текст'], children }, 'test-key'),
    /не завершила саммари/,
  );
});
