import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { createCache } from '../server/cache.mjs';

function start(t) {
  const cache = createCache(':memory:');
  const server = createApp({ cache }).listen(0, '127.0.0.1');
  return Promise.all([
    new Promise((resolve) => server.once('listening', resolve)),
  ]).then(() => {
    const base = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      cache.close();
    });
    return { base, cache };
  });
}
function jar() {
  const cookies = new Map();
  return {
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
    absorb: (res) => {
      for (const line of res.headers.getSetCookie?.() || []) {
        const [pair] = line.split(';');
        const eq = pair.indexOf('=');
        cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
    },
  };
}

test('registration hashes passwords, sessions persist and logout clears them', async (t) => {
  const { base, cache } = await start(t);
  const reader = jar();
  const registered = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'Reader', password: 'long-password-1' }),
  });
  reader.absorb(registered);
  assert.equal(registered.status, 200);
  const user = (await registered.json()).user;
  assert.equal(user.login, 'Reader');
  assert.equal(user.isAdmin, false);
  // Only scrypt hashes are stored, never the password itself.
  const row = cache.raw.prepare('SELECT password_hash, password_salt FROM users').get();
  assert.ok(!JSON.stringify(row).includes('long-password-1'));
  assert.equal(row.password_hash.length, 128);
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: reader.header() } });
  assert.equal((await me.json()).user?.login, 'Reader');
  await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'READER', password: 'wrong-password' }),
  }).then((r) => assert.equal(r.status, 401));
  const relogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'READER', password: 'long-password-1' }),
  });
  assert.equal(relogin.status, 200);
  const duplicate = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'reader', password: 'long-password-2' }),
  });
  assert.equal(duplicate.status, 409);
  const loggedOut = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie: reader.header() },
  });
  reader.absorb(loggedOut);
  const after = await fetch(`${base}/api/auth/me`, { headers: { cookie: reader.header() } });
  assert.equal((await after.json()).user, null);
  const short = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'x', password: 'short' }),
  });
  assert.equal(short.status, 400);
});

test('FIGLET_ADMIN_LOGINS promotes the named account to admin', async (t) => {
  const previous = process.env.FIGLET_ADMIN_LOGINS;
  process.env.FIGLET_ADMIN_LOGINS = 'boss';
  const { base } = await start(t);
  try {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'boss', password: 'long-password-1' }),
    });
    assert.equal((await res.json()).user.isAdmin, true);
    const admin = jar();
    admin.absorb(res);
    const works = await fetch(`${base}/api/admin/works`, { headers: { cookie: admin.header() } });
    assert.equal(works.status, 200);
    const forbidden = await fetch(`${base}/api/admin/works`);
    assert.equal(forbidden.status, 403);
  } finally {
    if (previous === undefined) delete process.env.FIGLET_ADMIN_LOGINS;
    else process.env.FIGLET_ADMIN_LOGINS = previous;
  }
});
