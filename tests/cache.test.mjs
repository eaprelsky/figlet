import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCache } from '../server/cache.mjs';
import { createApp } from '../server/index.mjs';
import { makeBook } from '../server/books.mjs';

test('cache coalesces concurrent generation, persists across restart, and retries failures', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'figlet-cache-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let cache = createCache(path.join(dir, 'cache.sqlite'));
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const generate = async () => {
    calls++;
    await gate;
    return { summary: 'Готовый разбор' };
  };
  const a = cache.remember('analysis', { model: 'a', text: 'original' }, generate);
  const b = cache.remember('analysis', { text: 'original', model: 'a' }, generate);
  release();
  assert.deepEqual(
    (await Promise.all([a, b])).map((r) => r.cache),
    ['miss', 'shared'],
  );
  assert.equal(calls, 1);
  cache.close();
  cache = createCache(path.join(dir, 'cache.sqlite'));
  assert.equal(
    (await cache.remember('analysis', { model: 'a', text: 'original' }, generate)).cache,
    'hit',
  );
  assert.equal(calls, 1);
  await assert.rejects(
    cache.remember('failure', {}, () => {
      throw Error('temporary');
    }),
    /temporary/,
  );
  assert.equal((await cache.remember('failure', {}, () => 'retried')).value, 'retried');
  cache.close();
});

test('API shares originals and analyses, isolates model/text, and serves hits after generation quota', async (t) => {
  const cache = createCache(':memory:');
  let calls = 0,
    imports = 0;
  const book = makeBook({
    title: 'Общая книга',
    author: 'Автор',
    sourceUrl: 'https://example.org/book',
    blocks: [{ kind: 'paragraph', text: 'Точный исходный текст книги. '.repeat(10) }],
  });
  const server = createApp({
    cache,
    loadBook: async () => {
      imports++;
      return book;
    },
    ai: {
      analyze: async (body) => {
        calls++;
        return { summary: `Обзор ${body.paragraphs[0]}`, model: body.model };
      },
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    cache.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, key = 'first-reader') =>
    fetch(`${base}/api/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-deepseek-key': key },
      body: JSON.stringify(body),
    });
  const payload = { model: 'deepseek-v4-flash', paragraphs: ['Original'], children: [] };
  assert.equal((await post('analyze', payload)).headers.get('x-figlet-cache'), 'miss');
  assert.equal(
    (await post('analyze', payload, 'another-reader')).headers.get('x-figlet-cache'),
    'hit',
  );
  assert.equal(calls, 1);
  assert.equal(
    (await post('analyze', { ...payload, model: 'deepseek-v4-pro' })).headers.get('x-figlet-cache'),
    'miss',
  );
  assert.equal(
    (await post('analyze', { ...payload, paragraphs: ['Changed'] })).headers.get('x-figlet-cache'),
    'miss',
  );
  for (let i = 3; i < 40; i++)
    assert.equal((await post('analyze', { ...payload, paragraphs: [`Text ${i}`] })).status, 200);
  assert.equal((await post('analyze', { ...payload, paragraphs: ['Over quota'] })).status, 429);
  assert.equal((await post('analyze', payload)).status, 200);
  assert.equal(calls, 40);
  const source = { url: book.sourceUrl };
  await post('import/url', source);
  assert.equal((await post('import/url', source)).headers.get('x-figlet-cache'), 'hit');
  assert.equal(imports, 1);
  const library = await (
    await fetch(`${base}/api/library?q=${encodeURIComponent('Общая')}`)
  ).json();
  assert.equal(library.books[0].id, book.id);
  assert.equal(
    (await (await fetch(`${base}/api/library/${book.id}`)).json()).paragraphs[0],
    book.paragraphs[0],
  );
  const form = new FormData();
  form.append('file', new Blob(['Личный текст. '.repeat(25)]), 'private.txt');
  assert.equal(
    (await fetch(`${base}/api/import/file`, { method: 'POST', body: form })).status,
    200,
  );
  assert.equal((await (await fetch(`${base}/api/library`)).json()).books.length, 1);
});
