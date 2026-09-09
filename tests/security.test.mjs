import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, validateUrl, retrySource, AppError } from '../server/network.mjs';
import { selectContext } from '../server/ai.mjs';
import { createApp } from '../server/index.mjs';

test('SSRF rejects private, local, link-local, mapped and reserved addresses', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '172.16.0.1',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '224.0.0.1',
    '192.0.2.1',
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('1.1.1.1'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});
test('transient source failures retry but rejected addresses do not', async () => {
  let attempts = 0;
  const result = await retrySource(async () => {
    if (++attempts < 3) throw new TypeError('fetch failed');
    return 'text';
  });
  assert.equal(result, 'text');
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(
    () =>
      retrySource(async () => {
        attempts++;
        throw new AppError('blocked');
      }),
    /blocked/,
  );
  assert.equal(attempts, 1);
});
test('URL validation rejects mixed public/private DNS records and credential URLs', async () => {
  const lookup = async () => [
    { address: '1.1.1.1', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ];
  await assert.rejects(() => validateUrl('https://example.org', lookup), /публичный/);
  for (const url of [
    'file:///etc/passwd',
    'https://user:pass@example.org',
    'http://example.org:8080',
  ])
    await assert.rejects(() => validateUrl(url, lookup), /публичные/);
});
test('large contexts are bounded, sampled visibly, and cover the document', () => {
  const data = selectContext(Array.from({ length: 1000 }, (_, i) => `${i}${'x'.repeat(2000)}`));
  assert.equal(data.coverage, 'sampled');
  assert.ok(data.paragraphs.reduce((n, p) => n + p.text.length, 0) <= 140000);
  assert.ok(data.paragraphs.at(-1).index > 950);
  assert.equal(selectContext(['Точный короткий текст']).coverage, 'full');
});
test('API exposes configuration without secrets, rejects cross-site use and invalid input', async (t) => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.equal(typeof config.sharedKey, 'boolean');
  assert.ok(!('key' in config));
  const cross = await fetch(`${base}/api/discover`, {
    method: 'POST',
    headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(cross.status, 403);
  const empty = await fetch(`${base}/api/search?q=`);
  assert.equal(empty.status, 400);
  const local = await fetch(`${base}/api/import/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1/' }),
  });
  assert.equal(local.status, 400);
  const form = new FormData();
  form.append(
    'file',
    new Blob([`# Книга\n\n${'Это настоящий текст для чтения. '.repeat(12)}`], {
      type: 'text/plain',
    }),
    'book.txt',
  );
  const imported = await fetch(`${base}/api/import/file`, { method: 'POST', body: form });
  assert.equal(imported.status, 200);
  const b = await imported.json();
  assert.ok(b.nodes.root);
  assert.ok(b.paragraphs.length);
});
