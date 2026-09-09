import test from 'node:test';
import assert from 'node:assert/strict';
import { initAnalytics } from '../src/analytics.ts';

test('Metrika records one initial visit and SPA transitions only on production host', (t) => {
  const scripts = [],
    listeners = {};
  const location = { hostname: 'localhost', href: 'http://localhost/' };
  const window = {
    addEventListener: (name, handler) => {
      listeners[name] = handler;
    },
  };
  globalThis.location = location;
  globalThis.window = window;
  globalThis.document = {
    title: 'Figlet',
    referrer: '',
    createElement: () => ({}),
    head: { appendChild: (s) => scripts.push(s) },
  };
  t.after(() => {
    delete globalThis.location;
    delete globalThis.window;
    delete globalThis.document;
  });
  initAnalytics();
  assert.equal(scripts.length, 0);
  location.hostname = 'figlet.eaprelsky.ru';
  location.href = 'https://figlet.eaprelsky.ru/';
  initAnalytics();
  initAnalytics();
  assert.equal(scripts.length, 1);
  assert.deepEqual(
    window.ym.a.map((a) => a[1]),
    ['init', 'hit'],
  );
  location.href += '#/book/example/root';
  listeners.hashchange();
  listeners.hashchange();
  assert.equal(window.ym.a.filter((a) => a[1] === 'hit').length, 2);
  assert.ok(window.ym.a.every((a) => a[0] === 112004441));
});
