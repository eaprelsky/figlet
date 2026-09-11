import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCatalog } from '../server/catalog.mjs';
import { makeBook } from '../server/books.mjs';

const paragraph = (i, extra = '') =>
  `Абзац ${i}. Точный исходный текст этой редакции сохраняется полностью.${extra}`;
function book(paragraphs, { title = 'Книга', author = 'Автор' } = {}) {
  return makeBook({
    title,
    author,
    blocks: [
      { kind: 'heading', text: 'Глава I', level: 1 },
      ...paragraphs.map((text) => ({ kind: 'paragraph', text })),
    ],
  });
}

test('same text re-registered is one edition; explicit rename changes metadata', () => {
  const catalog = createCatalog(new DatabaseSync(':memory:'));
  const first = catalog.register(book([paragraph(1), paragraph(2)]));
  assert.equal(first.edition, 'new');
  // A re-upload must not clobber a good title with a filename-derived one.
  const again = catalog.register(
    book([paragraph(1), paragraph(2)], { title: 'Книга (переиздание)' }),
  );
  assert.equal(again.edition, 'existing');
  assert.equal(again.book.id, first.book.id);
  assert.equal(again.book.title, 'Книга');
  catalog.renameEdition(again.book.id, { title: 'Книга (переиздание)', author: 'Автор' });
  assert.equal(catalog.library()[0].title, 'Книга (переиздание)');
  const library = catalog.library();
  assert.equal(library.length, 1);
  assert.equal(library[0].editions, 1);
});

test('pdf-noise edition of the same work merges into the fuller text', () => {
  const catalog = createCatalog(new DatabaseSync(':memory:'));
  // Clean edition misses two paragraphs that the noisy copy still contains.
  const clean = book(
    Array.from({ length: 14 }, (_, i) => paragraph(i + 1)).filter((_, i) => i !== 5 && i !== 9),
  );
  const noisy = book(
    Array.from({ length: 14 }, (_, i) => paragraph(i + 1, i % 4 === 0 ? ' 12' : '')),
  );
  catalog.register(clean);
  const merged = catalog.register(noisy);
  // A merged edition must exist and contain every paragraph of both editions.
  const ids = new Set([
    ...Object.values(catalog.db.prepare('SELECT id FROM books').all()),
  ]);
  const all = [...ids].map(({ id }) => catalog.book(id));
  const richest = all.sort((a, b) => b.paragraphs.length - a.paragraphs.length)[0];
  assert.equal(richest.paragraphs.length, 14);
  for (const edition of all)
    for (const text of edition.paragraphs.filter((t) => !/\s12$/.test(t)))
      assert.ok(
        richest.paragraphs.some((p) => p.replace(/\s+12$/, '') === text.replace(/\s+12$/, '')),
      );
  assert.ok(merged.workId);
});

test('rename updates the work, its editions and the library listing', () => {
  const catalog = createCatalog(new DatabaseSync(':memory:'));
  const { workId } = catalog.register(
    book([paragraph(1), paragraph(2)], { title: 'старое имя', author: '' }),
  );
  catalog.renameEdition(
    catalog.library()[0].id,
    { title: 'Точное название', author: 'Автор Книги' },
  );
  assert.equal(catalog.library()[0].title, 'Точное название');
  const work = catalog.db.prepare('SELECT * FROM works WHERE id=?').get(workId);
  assert.equal(work.author, 'Автор Книги');
  assert.equal(catalog.book(catalog.library()[0].id).author, 'Автор Книги');
});

test('verification agent scores quality and flags junk editions', () => {
  const catalog = createCatalog(new DatabaseSync(':memory:'));
  const good = catalog.register(
    book(Array.from({ length: 20 }, (_, i) => paragraph(i + 1))),
  );
  const junk = makeBook({
    title: 'Скан',
    author: 'Автор',
    blocks: Array.from({ length: 40 }, (_, i) => ({
      kind: 'paragraph',
      // Pure page numbers no longer reach the agent: cleanBlocks drops them.
      // This junk survives cleaning but stays digit-heavy and fragmented.
      text: i % 2 ? `${i} ${i + 1} ${i + 2} п1 ${i}` : `${i} слово слово слово ${i} ${i + 1}`,
    })),
  });
  catalog.register(junk);
  const verdictGood = catalog.verify(good.book.id);
  const verdictJunk = catalog.verify(junk.id);
  assert.ok(verdictGood.quality > verdictJunk.quality);
  assert.ok(verdictJunk.notes.length > 0);
  assert.equal(verdictGood.verified, true);
});

test('original files are stored once by content hash', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'figlet-files-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const catalog = createCatalog(new DatabaseSync(':memory:'), { filesDir: dir });
  const edition = book([paragraph(1), paragraph(2)]);
  catalog.register(edition, { file: { buffer: Buffer.from('binary-original'), filename: 'a.epub' } });
  catalog.register(edition, { file: { buffer: Buffer.from('binary-original'), filename: 'b.epub' } });
  const rows = catalog.db.prepare('SELECT * FROM edition_files').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].size, 15);
});

test('backfill assigns legacy books to works', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE books (id TEXT PRIMARY KEY, document TEXT NOT NULL, search TEXT NOT NULL, created INTEGER NOT NULL)',
  );
  const legacy = book([paragraph(1), paragraph(2)], { title: 'Старая книга', author: 'Классик' });
  db.prepare('INSERT INTO books VALUES (?,?,?,?)').run(
    legacy.id,
    JSON.stringify(legacy),
    'x',
    Date.now(),
  );
  const catalog = createCatalog(db);
  catalog.backfill();
  assert.equal(catalog.library().length, 1);
  assert.equal(catalog.library()[0].author, 'Классик');
});
