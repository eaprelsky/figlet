import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanBlocks, makeBook, searchWeb, searchAllSources } from '../server/books.mjs';
import { findBookText } from '../server/finder.mjs';
import { createCache } from '../server/cache.mjs';
import { createApp } from '../server/index.mjs';

const paragraph = (i) =>
  `Абзац ${i}. Настоящий текст произведения, достаточно длинный для проверки чистки.`;
const htmlOf = (chunks) => ({ buffer: Buffer.concat(chunks), type: 'text/html', url: 'x' });

test('cleanBlocks drops separator runs and lone page numbers, keeps real text', () => {
  const { blocks, removed } = cleanBlocks([
    { kind: 'heading', text: 'Глава I', level: 1 },
    { kind: 'paragraph', text: '12' },
    { kind: 'paragraph', text: '***' },
    { kind: 'paragraph', text: '— — —' },
    { kind: 'paragraph', text: paragraph(1) },
    { kind: 'paragraph', text: '~ * ~' },
    { kind: 'paragraph', text: paragraph(2) },
  ]);
  assert.equal(removed, 4);
  assert.deepEqual(
    blocks.map((b) => b.text),
    ['Глава I', paragraph(1), paragraph(2)],
  );
  const book = makeBook({
    title: 'К',
    blocks: Array.from({ length: 12 }, (_, i) => ({ kind: 'paragraph', text: paragraph(i) })),
  });
  assert.equal(book.paragraphs.length, 12);
});

test('searchWeb parses results and filters junk domains', async () => {
  const ddg = Buffer.from(`<html><body>
    <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Flib.example.org%2Fbook">Книга полностью</a>
      <span class="result__snippet">Полный текст романа</span></div>
    <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.amazon.com%2Fx">Купить книгу</a></div>
    <div class="result"><a class="result__a" href="https://plain.example.net/text">Прямая ссылка</a></div>
  </body></html>`);
  const results = await searchWeb('тест', { fetchHtml: async () => htmlOf([ddg]) });
  assert.equal(results.length, 2);
  assert.ok(results[0].url.startsWith('https://lib.example.org'));
  assert.ok(results.some((r) => r.url.includes('plain.example.net')));
  assert.ok(!results.some((r) => r.url.includes('amazon')));
  // Aggregated search tolerates a failing provider.
  const merged = await searchAllSources('тест', { fetchHtml: async () => htmlOf([ddg]) });
  assert.ok(merged.length >= 2);
});

test('findBookText verifies candidates and imports the first good one', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'figlet-find-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cache = createCache(path.join(dir, 'cache.sqlite'));
  const text = Array.from({ length: 30 }, (_, i) => paragraph(i)).join('\n\n');
  const search = async () => [
    {
      title: 'Книга Автор',
      snippet: '',
      url: 'https://good.example.org/book.txt',
      source: 'good.example.org',
    },
    {
      title: 'Магазин',
      snippet: '',
      url: 'https://other.example.org/shop.txt',
      source: 'other.example.org',
    },
  ];
  const fetcher = async (url) =>
    String(url).includes('good.example.org')
      ? { buffer: Buffer.from(text), type: 'text/plain', url: String(url) }
      : { buffer: Buffer.from('мало текста'), type: 'text/plain', url: String(url) };
  const verdicts = [];
  const result = await findBookText(
    { title: 'Книга', author: 'Автор' },
    {
      ai: {
        verifyText: async (body) => {
          verdicts.push(body.title);
          return { verdict: 'ok', confidence: 0.9, reason: 'полный текст' };
        },
      },
      key: 'shared',
      cache,
      budget: (action) => action(),
      search,
      fetcher,
    },
  );
  assert.ok(result.book, 'agent must return the imported book');
  assert.equal(result.book.sourceUrl, 'https://good.example.org/book.txt');
  assert.deepEqual(verdicts, ['Книга']);
  // The verdict is cached: a second lookup skips the model entirely.
  const again = await findBookText(
    { title: 'Книга', author: 'Автор' },
    {
      ai: {
        verifyText: async () => {
          throw new Error('must not be called again');
        },
      },
      key: 'shared',
      cache,
      budget: (action) => action(),
      search,
      fetcher,
    },
  );
  assert.ok(again.book);
  cache.close();
});

test('findBookText falls back to candidates when the model rejects everything', async (t) => {
  const cache = createCache(':memory:');
  t.after(() => cache.close());
  const text = Array.from({ length: 30 }, (_, i) => paragraph(i)).join('\n\n');
  const search = async () => [
    { title: 'Книга', snippet: '', url: 'https://bad.example.org/1.txt', source: 'bad' },
  ];
  const fetcher = async (url) => ({ buffer: Buffer.from(text), type: 'text/plain', url });
  const result = await findBookText(
    { title: 'Книга', author: '' },
    {
      ai: { verifyText: async () => ({ verdict: 'reject', confidence: 0.9, reason: 'фрагмент' }) },
      key: 'shared',
      cache,
      budget: (action) => action(),
      search,
      fetcher,
    },
  );
  assert.ok(!result.book);
  assert.equal(result.candidates.length, 1);
});

test('admin can delete a whole work from the shared library via API', async (t) => {
  process.env.FIGLET_ADMIN_LOGINS = 'boss';
  const cache = createCache(':memory:');
  const server = createApp({ cache }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await new Promise((resolve) => server.close(resolve));
    cache.close();
    delete process.env.FIGLET_ADMIN_LOGINS;
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const register = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'boss', password: 'long-password-1' }),
  });
  const cookie = register.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const form = new FormData();
  form.append(
    'file',
    new Blob([Array.from({ length: 8 }, (_, i) => paragraph(i) + ' админ-тест').join('\n\n')], {
      type: 'text/plain',
    }),
    'admintest.txt',
  );
  await fetch(`${base}/api/import/file`, { method: 'POST', body: form });
  const library = await (await fetch(`${base}/api/library`)).json();
  const workId = library.books[0].workId;
  const editionId = library.books[0].id;
  const removed = await (
    await fetch(`${base}/api/admin/works/${workId}`, {
      method: 'DELETE',
      headers: { cookie },
    })
  ).json();
  assert.deepEqual(removed.editions, [editionId]);
  assert.equal((await (await fetch(`${base}/api/library`)).json()).books.length, 0);
  const reclean = await (
    await fetch(`${base}/api/admin/reclean`, { method: 'POST', headers: { cookie } })
  ).json();
  assert.equal(reclean.editions, 0);
});
