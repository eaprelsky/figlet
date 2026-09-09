import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Bump when prompts, extraction, or response semantics change.
const VERSION = 'figlet-2026-09-shared-v1';
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export function cacheKey(kind, value) {
  return createHash('sha256')
    .update(JSON.stringify([VERSION, kind, canonical(value)]))
    .digest('hex');
}
export function createCache(filename = process.env.CACHE_DB || '.figlet-data/cache.sqlite') {
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS results (key TEXT PRIMARY KEY, value TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, document TEXT NOT NULL, search TEXT NOT NULL, created INTEGER NOT NULL);`);
  const pending = new Map();
  return {
    async remember(kind, input, generate) {
      const key = cacheKey(kind, input);
      const saved = db.prepare('SELECT value FROM results WHERE key=?').get(key);
      if (saved) return { value: JSON.parse(saved.value), cache: 'hit' };
      if (pending.has(key)) return { value: await pending.get(key), cache: 'shared' };
      const promise = Promise.resolve()
        .then(generate)
        .then((value) => {
          db.prepare('INSERT OR REPLACE INTO results VALUES (?,?,?)').run(
            key,
            JSON.stringify(value),
            Date.now(),
          );
          return value;
        });
      pending.set(key, promise);
      try {
        return { value: await promise, cache: 'miss' };
      } finally {
        pending.delete(key);
      }
    },
    saveBook(book) {
      const clean = { ...book, analyses: {}, answers: {}, currentNode: 'root' };
      db.prepare('INSERT OR IGNORE INTO books VALUES (?,?,?,?)').run(
        book.id,
        JSON.stringify(clean),
        `${book.title} ${book.author}`.toLowerCase(),
        Date.now(),
      );
    },
    book(id) {
      const row = db.prepare('SELECT document FROM books WHERE id=?').get(id);
      return row ? JSON.parse(row.document) : null;
    },
    library(query = '') {
      return db
        .prepare(
          'SELECT document FROM books WHERE instr(search, ?) > 0 ORDER BY created DESC LIMIT 100',
        )
        .all(query.toLowerCase())
        .map((row) => {
          const b = JSON.parse(row.document);
          return {
            id: b.id,
            title: b.title,
            author: b.author,
            sourceUrl: b.sourceUrl,
            paragraphs: b.paragraphs.length,
          };
        });
    },
    close() {
      db.close();
    },
  };
}
