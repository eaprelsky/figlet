import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLocale, translateError } from '../server/i18n.mjs';
import { createApp } from '../server/index.mjs';
import { createCache } from '../server/cache.mjs';

test('locale detection prefers the figlet_lang cookie over Accept-Language', () => {
  assert.equal(detectLocale({ headers: { cookie: 'figlet_lang=en; other=1' } }), 'en');
  assert.equal(detectLocale({ headers: { cookie: 'figlet_lang=ru' } }), 'ru');
  assert.equal(detectLocale({ headers: { 'accept-language': 'en-US,en;q=0.9' } }), 'en');
  assert.equal(detectLocale({ headers: { 'accept-language': 'ru-RU,ru;q=0.9' } }), 'ru');
  assert.equal(detectLocale({ headers: {} }), 'ru');
});

test('known errors translate to English; unknown and dynamic ones fall back safely', () => {
  const locale = 'en';
  assert.equal(
    translateError('Выберите файл книги.', locale),
    'Choose a book file.',
  );
  assert.equal(translateError('Что-то совсем новое.', locale), 'Что-то совсем новое.');
  assert.equal(translateError('Выберите файл книги.', 'ru'), 'Выберите файл книги.');
  const quota = translateError(
    'На этой неделе вы уже разобрали 5 новых книг за счёт сервера.',
    locale,
  );
  assert.match(quota, /5 new books/);
});

test('API responds with localized errors for English readers', async (t) => {
  const cache = createCache(':memory:');
  const server = createApp({ cache }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    // Let undici return pooled sockets before closing the listener (Windows teardown race).
    await new Promise((resolve) => setTimeout(resolve, 250));
    await new Promise((resolve) => server.close(resolve));
    cache.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const en = await fetch(`${base}/api/library/nope`, { headers: { cookie: 'figlet_lang=en' } });
  assert.equal((await en.json()).error, 'The book has not been added to the shared library yet.');
  const ru = await fetch(`${base}/api/library/nope`);
  assert.equal((await ru.json()).error, 'Книга пока не добавлена в общую библиотеку.');
});

test('analyze requests carry the language into the cache key', async (t) => {
  const cache = createCache(':memory:');
  const calls = [];
  const server = createApp({
    cache,
    ai: {
      analyze: async (body, key, options = {}) => {
        calls.push(options.lang);
        return { summary: `Обзор ${options.lang}`, model: body.model };
      },
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    // Let undici return pooled sockets before closing the listener (Windows teardown race).
    await new Promise((resolve) => setTimeout(resolve, 250));
    await new Promise((resolve) => server.close(resolve));
    cache.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) =>
    fetch(`${base}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const payload = { model: 'deepseek-flash', paragraphs: ['Text'], children: [] };
  const first = await post({ ...payload, lang: 'ru' });
  assert.equal(first.headers.get('x-figlet-cache'), 'miss');
  const again = await post({ ...payload, lang: 'ru' });
  assert.equal(again.headers.get('x-figlet-cache'), 'hit');
  const english = await post({ ...payload, lang: 'en' });
  assert.equal(english.headers.get('x-figlet-cache'), 'miss');
  assert.equal((await english.json()).summary, 'Обзор en');
  assert.deepEqual(calls, ['ru', 'en']);
});
