import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { createCache } from '../server/cache.mjs';
import { makeBook } from '../server/books.mjs';

const paragraph = (i) => `Абзац ${i}. Точный исходный текст для подсчёта бесплатных книг.`;
function book(n, tag) {
  return makeBook({
    title: `Книга ${tag}`,
    author: 'Автор',
    blocks: Array.from({ length: n }, (_, i) => ({
      kind: 'paragraph',
      text: `${paragraph(i)} ${tag}`,
    })),
  });
}

function start(t, { ai } = {}) {
  process.env.FREE_BOOKS_PER_WEEK = '5';
  const cache = createCache(':memory:');
  const server = createApp({
    cache,
    ai: ai || {
      analyze: async (body) => ({ summary: `Обзор ${body.section}`, model: body.model }),
    },
  }).listen(0, '127.0.0.1');
  return new Promise((resolve) => server.once('listening', resolve)).then(() => {
    const base = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      cache.close();
    });
  const cookies = new Map();
  const client = {
    async post(route, body) {
      const res = await fetch(`${base}/api/${route}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        },
        body: JSON.stringify(body),
      });
      for (const line of res.headers.getSetCookie?.() || []) {
        const [pair] = line.split(';');
        const eq = pair.indexOf('=');
        cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
      return { status: res.status, data: await res.json() };
    },
    raw: base,
    cookies,
  };
  return client;
  });
}

test('five free new books a week on the shared key, then a coded 402; cache hits stay free', async (t) => {
  const client = await start(t);
  const analyze = (i) =>
    client.post('analyze', {
      model: 'deepseek-flash',
      bookId: book(3, i).id,
      nodeId: 'root',
      title: `Книга ${i}`,
      section: 'Вся книга',
      paragraphs: [`Текст ${i}`],
      children: [],
    });
  for (let i = 1; i <= 5; i++) assert.equal((await analyze(i)).status, 200);
  // Re-analysing an already counted book does not consume another slot.
  assert.equal((await analyze(1)).status, 200);
  const sixth = await analyze(6);
  assert.equal(sixth.status, 402);
  assert.equal(sixth.data.code, 'book-quota');
  const quota = await (await fetch(`${client.raw}/api/quota`, { headers: { cookie: [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } })).json();
  assert.equal(quota.used, 5);
  assert.equal(quota.limit, 5);
});

test('a personal key bypasses the free-book quota', async (t) => {
  const client = await start(t);
  for (let i = 1; i <= 5; i++)
    await client.post('analyze', {
      model: 'deepseek-flash',
      bookId: book(3, i).id,
      nodeId: 'root',
      title: `Книга ${i}`,
      section: 'Вся книга',
      paragraphs: [`Текст ${i}`],
      children: [],
    });
  const own = await client.post('analyze', {
    model: 'deepseek-flash',
    bookId: book(3, 6).id,
    nodeId: 'root',
    title: 'Книга 6',
    section: 'Вся книга',
    paragraphs: ['Текст 6'],
    children: [],
  });
  assert.equal(own.status, 402); // free week exhausted without a personal key
  // With a personal key header the request is free of server metering.
  const personal = await fetch(`${client.raw}/api/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      'x-deepseek-key': 'sk-own-key',
    },
    body: JSON.stringify({
      model: 'deepseek-flash',
      bookId: book(3, 7).id,
      nodeId: 'root',
      title: 'Книга 7',
      section: 'Вся книга',
      paragraphs: ['Текст 7'],
      children: [],
    }),
  });
  assert.equal(personal.status, 200);
});

test('an activated subscription lifts the quota and follows login', async (t) => {
  let payments = {};
  const yookassa = async (url, options = {}) => {
    let payload;
    if (url.endsWith('/payments') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      const id = `pay-${String(Object.keys(payments).length + 1).padStart(8, '0')}`;
      payments[id] = { metadata: body.metadata, status: 'pending' };
      payload = { id, status: 'pending', confirmation: { confirmation_url: 'https://pay.example/x' } };
    } else payload = payments[url.split('/').pop()];
    return { ok: true, json: async () => payload };
  };
  const cache = createCache(':memory:');
  process.env.FREE_BOOKS_PER_WEEK = '5';
  process.env.YOOKASSA_SHOP_ID = '1460922';
  process.env.YOOKASSA_SECRET_KEY = 'test-secret';
  const server = createApp({
    cache,
    ai: { analyze: async (body) => ({ summary: 'Обзор', model: body.model }) },
    fetchImpl: yookassa,
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    cache.close();
    delete process.env.YOOKASSA_SHOP_ID;
    delete process.env.YOOKASSA_SECRET_KEY;
  });
  const cookies = new Map();
  const absorb = (res) => {
    for (const line of res.headers.getSetCookie?.() || []) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  };
  const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const post = (route, body) =>
    fetch(`${base}/api/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader() },
      body: JSON.stringify(body),
    }).then(async (res) => {
      absorb(res);
      return { status: res.status, data: await res.json() };
    });

  const checkout = await post('billing/checkout', {});
  assert.ok(checkout.data.confirmationUrl.startsWith('https://pay.example'));
  const paymentId = checkout.data.paymentId;
  // Reader exhausted the free week and is blocked...
  for (let i = 1; i <= 5; i++)
    await post('analyze', {
      model: 'deepseek-flash',
      bookId: book(3, i).id,
      nodeId: 'root',
      title: `Книга ${i}`,
      section: 'Вся книга',
      paragraphs: [`Текст ${i}`],
      children: [],
    });
  const blocked = await post('analyze', {
    model: 'deepseek-flash',
    bookId: book(3, 6).id,
    nodeId: 'root',
    title: 'Книга 6',
    section: 'Вся книга',
    paragraphs: ['Текст 6'],
    children: [],
  });
  assert.equal(blocked.status, 402);
  // ...pays, the provider confirms via the notification webhook...
  payments[paymentId].status = 'succeeded';
  const notify = await fetch(`${base}/api/billing/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'payment.succeeded', object: { id: paymentId } }),
  });
  assert.equal(notify.status, 200);
  // ...and the same request now passes, on any book.
  const allowed = await post('analyze', {
    model: 'deepseek-flash',
    bookId: book(3, 6).id,
    nodeId: 'root',
    title: 'Книга 6',
    section: 'Вся книга',
    paragraphs: ['Текст 6'],
    children: [],
  });
  assert.equal(allowed.status, 200);
  const quota = await (await fetch(`${base}/api/quota`, { headers: { cookie: cookieHeader() } })).json();
  assert.ok(quota.subscription?.until > Date.now());
  // Logging in moves the anonymous subscription onto the account.
  const login = await post('auth/login', { login: 'reader', password: 'wrong-password' });
  assert.equal(login.status, 401); // account does not exist yet: register instead
  const register = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: cookieHeader() },
    body: JSON.stringify({ login: 'reader', password: 'long-password-1' }),
  });
  absorb(register);
  const me = await (await fetch(`${base}/api/auth/me`, { headers: { cookie: cookieHeader() } })).json();
  assert.equal(me.user?.login, 'reader');
  assert.ok(me.subscription?.until > Date.now());
});
