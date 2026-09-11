import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { makeBook } from './books.mjs';
import { AppError } from './network.mjs';

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const sha = (s) => createHash('sha256').update(s).digest('hex');
const digest24 = (s) => sha(s).slice(0, 24);

// Fingerprints survive pdf markup noise: normalised letters-only text at even positions,
// so page numbers and footnote digits do not split identical paragraphs apart.
const matchKey = (text) => norm(text).replace(/[^\p{L}]/gu, '').slice(0, 400);
function fingerprint(paragraphs, count = 10) {
  const meaningful = paragraphs.filter((p) => norm(p).length >= 24);
  const source = meaningful.length >= count ? meaningful : paragraphs;
  if (!source.length) return [];
  return Array.from({ length: count }, (_, i) =>
    digest24(matchKey(source[Math.floor((i * source.length) / count)])),
  );
}
function similarity(a, b) {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  return a.filter((x) => set.has(x)).length / a.length;
}
// Heuristic cleanliness of one paragraph copy: page numbers, digit noise, broken hyphens.
function paragraphQuality(text) {
  const t = norm(text).replace(/\s+/g, '');
  if (!t) return -1;
  if (/^\d{1,4}$/.test(t)) return 0; // lone page number
  const letters = (t.match(/\p{L}/gu) || []).length / t.length;
  const digits = (t.match(/\d/g) || []).length / t.length;
  let score = 2 + letters - digits * 4;
  if (/[\p{L}-]$/u.test(text.trim())) score -= 0.5; // hard hyphenation carry-over
  if (t.length < 40) score -= 1;
  return score;
}
function editionQuality(book) {
  const paragraphs = book.paragraphs;
  if (!paragraphs.length) return { quality: 1, notes: ['пустой текст'] };
  const scores = paragraphs.map(paragraphQuality);
  const junk = scores.filter((s) => s < 1).length / paragraphs.length;
  const letters = paragraphs.join('').replace(/[^\p{L}]/gu, '').length;
  let quality = 5 - Math.round(junk * 6);
  const notes = [];
  if (junk > 0.15) notes.push(`${Math.round(junk * 100)}% подозрительных абзацев`);
  if (!book.nodes.root.children.length) notes.push('нет оглавления');
  const headings = Object.keys(book.nodes).length - 1;
  if (paragraphs.length > 50 && headings < 3) {
    quality -= 1;
    notes.push('мало заголовков для такого объёма');
  }
  if (letters < 5000) quality = Math.min(quality, 4);
  return { quality: Math.max(1, Math.min(5, quality)), notes, letters, junk };
}
function blocksFromBook(book) {
  const depth = new Map([['root', 0]]);
  const stack = ['root'];
  while (stack.length) {
    const id = stack.pop();
    for (const child of book.nodes[id].children) {
      depth.set(child, depth.get(id) + 1);
      stack.push(child);
    }
  }
  const starts = Object.values(book.nodes)
    .filter((n) => n.id !== 'root' && n.title !== 'Вступление')
    .sort((a, b) => a.start - b.start || depth.get(b.id) - depth.get(a.id));
  const headingAt = new Map();
  for (const node of starts) if (!headingAt.has(node.start)) headingAt.set(node.start, node);
  const blocks = [];
  const paragraphBlock = new Map();
  for (let i = 0; i < book.paragraphs.length; i++) {
    const heading = headingAt.get(i);
    if (heading) blocks.push({ kind: 'heading', text: heading.title, level: depth.get(heading.id) });
    paragraphBlock.set(i, blocks.length);
    blocks.push({ kind: 'paragraph', text: book.paragraphs[i] });
  }
  return { blocks, paragraphBlock };
}
// Union of paragraphs across editions of one work, anchored on normalised hashes.
// Runs present only in the lesser edition are spliced in before the next shared anchor.
function mergeEditions(base, other) {
  const baseHashes = base.paragraphs.map((p) => digest24(matchKey(p)));
  const baseSet = new Set(baseHashes);
  const { blocks, paragraphBlock } = blocksFromBook(base);
  const otherHashes = other.paragraphs.map((p) => digest24(matchKey(p)));
  const insertions = new Map(); // base paragraph index -> blocks to insert before it
  let run = [];
  const flush = (anchorIndex) => {
    if (!run.length) return;
    if (anchorIndex == null) {
      // Trailing tail: append only when the base clearly ends earlier.
      const tailLetters = run.join('').replace(/[^\p{L}]/gu, '').length;
      if (tailLetters > 500) insertions.set(base.paragraphs.length, [...run]);
    } else {
      insertions.set(anchorIndex, [...run]);
    }
    run = [];
  };
  for (let i = 0; i < otherHashes.length; i++) {
    const hash = otherHashes[i];
    if (baseSet.has(hash)) {
      flush(null);
      continue;
    }
    const text = other.paragraphs[i];
    // A junk paragraph already poisoned the base edition with its own junk copy.
    if (paragraphQuality(text) < 1 && base.paragraphs.length > 20) continue;
    run.push(text);
    const next = otherHashes[i + 1];
    if (next != null && baseSet.has(next)) {
      const anchor = baseHashes.indexOf(next);
      if (anchor >= 0) flush(anchor);
    }
  }
  flush(null);
  if (!insertions.size) return null;
  // Heading blocks precede their first paragraph; rebuild order by scanning blocks.
  const ordered = [];
  let cursor = 0;
  for (let i = 0; i < base.paragraphs.length; i++) {
    const blockIndex = paragraphBlock.get(i);
    while (cursor < blockIndex) ordered.push(blocks[cursor++]);
    for (const extra of insertions.get(i) || []) ordered.push({ kind: 'paragraph', text: extra });
    ordered.push(blocks[blockIndex]);
    cursor = blockIndex + 1;
  }
  while (cursor < blocks.length) ordered.push(blocks[cursor++]);
  for (const extra of insertions.get(base.paragraphs.length) || [])
    ordered.push({ kind: 'paragraph', text: extra });
  return ordered;
}

export function createCatalog(db, { filesDir = null } = {}) {
  // The books table is normally created by createCache; keep it idempotent for standalone use.
  db.exec(`CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY, document TEXT NOT NULL, search TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS works (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL,
    created INTEGER NOT NULL, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS edition_files (
    sha256 TEXT PRIMARY KEY, edition_id TEXT NOT NULL, filename TEXT NOT NULL,
    size INTEGER NOT NULL, format TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS book_analyses (
    edition_id TEXT NOT NULL, node_id TEXT NOT NULL, model TEXT NOT NULL,
    value TEXT NOT NULL, updated INTEGER NOT NULL,
    PRIMARY KEY (edition_id, node_id, model));`);
  const columns = db.prepare('PRAGMA table_info(books)').all().map((c) => c.name);
  const add = (name, type) => {
    if (!columns.includes(name)) db.exec(`ALTER TABLE books ADD COLUMN ${name} ${type}`);
  };
  add('work_id', 'TEXT');
  add('quality', 'INTEGER');
  add('verified', 'INTEGER');
  add('notes', 'TEXT');
  if (filesDir) mkdirSync(filesDir, { recursive: true });
  const loadBook = (id) => {
    const row = db.prepare('SELECT document FROM books WHERE id=?').get(id);
    return row ? JSON.parse(row.document) : null;
  };
  const saveBookRow = (book, extra = {}) => {
    const clean = { ...book, analyses: {}, answers: {}, currentNode: 'root' };
    db.prepare('INSERT OR IGNORE INTO books (id, document, search, created) VALUES (?,?,?,?)').run(
      book.id,
      JSON.stringify(clean),
      `${book.title} ${book.author}`.toLowerCase(),
      Date.now(),
    );
    db.prepare(
      'UPDATE books SET document=?, search=?, work_id=?, quality=?, verified=?, notes=? WHERE id=?',
    ).run(
      JSON.stringify(clean),
      `${book.title} ${book.author}`.toLowerCase(),
      extra.work_id || null,
      extra.quality || null,
      extra.verified || null,
      extra.notes || null,
      book.id,
    );
    return clean;
  };

  return {
    db,
    saveFile(editionId, buffer, filename) {
      if (!filesDir || !Buffer.isBuffer(buffer) || !buffer.length) return null;
      const sha256 = sha(buffer);
      const record = {
        sha256,
        edition_id: editionId,
        filename: String(filename || 'book').slice(0, 300),
        size: buffer.length,
        format: path.extname(String(filename || '')).replace('.', '').toLowerCase() || 'bin',
        created: Date.now(),
      };
      const target = path.join(filesDir, `${sha256}.bin`);
      if (!existsSync(target)) writeFileSync(target, buffer);
      db.prepare('INSERT OR REPLACE INTO edition_files VALUES (?,?,?,?,?,?)').run(
        record.sha256,
        record.edition_id,
        record.filename,
        record.size,
        record.format,
        record.created,
      );
      return record;
    },
    // Central entry point for every stored book (URL import or file upload).
    register(book, { file = null } = {}) {
      const fp = fingerprint(book.paragraphs);
      const existing = db.prepare('SELECT id, document FROM books WHERE id=?').get(book.id);
      if (existing) {
        const prior = JSON.parse(existing.document);
        const keep = {
          ...prior,
          title: prior.title || book.title,
          author: prior.author || book.author,
          sourceUrl: prior.sourceUrl || book.sourceUrl,
          sourceLabel: prior.sourceLabel || book.sourceLabel,
          warnings: [...new Set([...(prior.warnings || []), ...(book.warnings || [])])],
        };
        const workId =
          db.prepare('SELECT work_id FROM books WHERE id=?').get(book.id)?.work_id ||
          this.ensureWork(book.title, book.author);
        db.prepare('UPDATE books SET work_id=? WHERE id=?').run(workId, book.id);
        this.renameWork(workId, keep.title, keep.author);
        if (file) this.saveFile(book.id, file.buffer, file.filename);
        return { book: keep, workId, edition: 'existing' };
      }
      // Match by fingerprint first: same text in a different wrapper is the same work.
      let workId = null;
      if (fp.length) {
        const rows = db
          .prepare('SELECT id, document FROM books WHERE work_id IS NOT NULL')
          .all();
        for (const row of rows) {
          const other = JSON.parse(row.document);
          if (similarity(fp, fingerprint(other.paragraphs)) >= 0.5) {
            workId = row.work_id;
            break;
          }
        }
      }
      if (!workId) workId = this.ensureWork(book.title, book.author);
      const { quality, notes } = editionQuality(book);
      saveBookRow(book, { work_id: workId, quality, verified: quality >= 3 ? 1 : 0, notes: JSON.stringify(notes) });
      if (file) this.saveFile(book.id, file.buffer, file.filename);
      const merged = this.enrichWork(workId);
      return { book: merged || book, workId, edition: 'new', merged };
    },
    ensureWork(title, author) {
      const id = digest24(`work|${norm(title)}|${norm(author)}`);
      db.prepare('INSERT OR IGNORE INTO works VALUES (?,?,?,?,?)').run(
        id,
        title.slice(0, 300),
        author.slice(0, 180),
        Date.now(),
        Date.now(),
      );
      return id;
    },
    renameWork(workId, title, author) {
      const work = db.prepare('SELECT * FROM works WHERE id=?').get(workId);
      if (!work) return;
      db.prepare('UPDATE works SET title=?, author=?, updated=? WHERE id=?').run(
        (title || work.title).slice(0, 300),
        (author ?? work.author).slice(0, 180),
        Date.now(),
        workId,
      );
      for (const row of db.prepare('SELECT id, document FROM books WHERE work_id=?').all(workId)) {
        const book = JSON.parse(row.document);
        db.prepare('UPDATE books SET document=?, search=? WHERE id=?').run(
          JSON.stringify({
            ...book,
            title: title || book.title,
            author: author ?? book.author,
          }),
          `${title || book.title} ${author ?? book.author}`.toLowerCase(),
          row.id,
        );
      }
    },
    renameEdition(editionId, { title, author }) {
      const row = db.prepare('SELECT work_id FROM books WHERE id=?').get(editionId);
      if (!row) throw new AppError('Книга не найдена в каталоге.', 404);
      const workId = row.work_id || this.ensureWork(title, author);
      this.renameWork(workId, title, author);
      db.prepare('UPDATE books SET work_id=? WHERE id=?').run(workId, editionId);
      return { title, author, workId };
    },
    // If editions of one work differ only by noise, splice the missing runs together.
    enrichWork(workId) {
      const editions = db
        .prepare('SELECT id, document, quality FROM books WHERE work_id=?')
        .all(workId)
        .map((row) => ({ ...row, book: JSON.parse(row.document) }))
        .sort((a, b) => {
          const letters = (x) => x.book.paragraphs.join('').replace(/[^\p{L}]/gu, '').length;
          return letters(b) - letters(a) || (b.quality || 3) - (a.quality || 3);
        });
      if (editions.length < 2) return null;
      const base = editions[0];
      for (const other of editions.slice(1)) {
        const shared = similarity(
          fingerprint(base.book.paragraphs),
          fingerprint(other.book.paragraphs),
        );
        if (shared < 0.3) continue; // a genuinely different text, not another edition
        const blocks = mergeEditions(base.book, other.book);
        if (!blocks) continue;
        const merged = makeBook({
          blocks,
          title: base.book.title,
          author: base.book.author,
          sourceUrl: base.book.sourceUrl || other.book.sourceUrl,
          sourceLabel: base.book.sourceLabel || other.book.sourceLabel,
          warnings: [...new Set([...(base.book.warnings || []), 'Текст объединён из нескольких редакций источника.'])],
        });
        if (merged.id === base.book.id || db.prepare('SELECT 1 FROM books WHERE id=?').get(merged.id))
          continue;
        const { quality, notes } = editionQuality(merged);
        saveBookRow(merged, { work_id: workId, quality, verified: quality >= 3 ? 1 : 0, notes: JSON.stringify(notes) });
        return merged;
      }
      return null;
    },
    verify(editionId) {
      const book = loadBook(editionId);
      if (!book) throw new AppError('Книга не найдена в каталоге.', 404);
      const { quality, notes } = editionQuality(book);
      db.prepare('UPDATE books SET quality=?, verified=?, notes=? WHERE id=?').run(
        quality,
        quality >= 3 ? 1 : 0,
        JSON.stringify(notes),
        editionId,
      );
      return { quality, verified: quality >= 3, notes };
    },
    book: loadBook,
    bestEdition(workId) {
      const rows = db
        .prepare('SELECT id, document, quality FROM books WHERE work_id=?')
        .all(workId)
        .map((row) => ({ ...row, book: JSON.parse(row.document) }))
        .sort(
          (a, b) =>
            (b.quality || 3) - (a.quality || 3) ||
            b.book.paragraphs.length - a.book.paragraphs.length,
        );
      return rows[0] || null;
    },
    library(query = '') {
      const works = db.prepare('SELECT * FROM works ORDER BY updated DESC LIMIT 300').all();
      return works.flatMap((work) => {
        const best = this.bestEdition(work.id);
        if (!best) return [];
        const document = JSON.parse(
          db.prepare('SELECT document FROM books WHERE id=?').get(best.id).document,
        );
        if (query && !`${work.title} ${work.author}`.toLowerCase().includes(query.toLowerCase()))
          return [];
        const editions = db.prepare('SELECT COUNT(*) AS n FROM books WHERE work_id=?').get(work.id).n;
        return [
          {
            id: best.id,
            workId: work.id,
            title: work.title,
            author: work.author,
            sourceUrl: document.sourceUrl,
            paragraphs: document.paragraphs.length,
            editions,
          },
        ];
      });
    },
    worksWithEditions() {
      return db
        .prepare('SELECT * FROM works ORDER BY updated DESC LIMIT 1000')
        .all()
        .map((work) => {
          const editions = db
            .prepare(
              'SELECT id, quality, verified, notes, created FROM books WHERE work_id=? ORDER BY created',
            )
            .all(work.id);
          const files = db
            .prepare('SELECT filename, size, format FROM edition_files WHERE edition_id=?')
            .all(editions[0]?.id || '');
          return { ...work, editions, files };
        });
    },
    removeWork(workId) {
      const editions = db.prepare('SELECT id FROM books WHERE work_id=?').all(workId);
      for (const { id } of editions) {
        db.prepare('DELETE FROM book_analyses WHERE edition_id=?').run(id);
        db.prepare('DELETE FROM edition_files WHERE edition_id=?').run(id);
      }
      db.prepare('DELETE FROM books WHERE work_id=?').run(workId);
      db.prepare('DELETE FROM works WHERE id=?').run(workId);
    },
    // One edition; the work follows when nothing else references it.
    removeEdition(editionId) {
      const row = db.prepare('SELECT id, work_id FROM books WHERE id=?').get(editionId);
      if (!row) return null;
      db.prepare('DELETE FROM book_analyses WHERE edition_id=?').run(editionId);
      db.prepare('DELETE FROM edition_files WHERE edition_id=?').run(editionId);
      db.prepare('DELETE FROM books WHERE id=?').run(editionId);
      let removedWork = false;
      if (row.work_id && !db.prepare('SELECT 1 FROM books WHERE work_id=? LIMIT 1').get(row.work_id)) {
        db.prepare('DELETE FROM works WHERE id=?').run(row.work_id);
        removedWork = true;
      }
      return { removedWork };
    },
    saveAnalysis(editionId, nodeId, model, value) {
      if (!/^[a-f0-9]{24}$/.test(editionId) || !nodeId || typeof nodeId !== 'string') return;
      db.prepare('INSERT OR REPLACE INTO book_analyses VALUES (?,?,?,?,?)').run(
        editionId,
        nodeId.slice(0, 150),
        String(model || '').slice(0, 100),
        JSON.stringify(value),
        Date.now(),
      );
    },
    analyses(editionId, model) {
      return db
        .prepare('SELECT node_id, value FROM book_analyses WHERE edition_id=? AND model=?')
        .all(editionId, String(model || ''))
        .reduce((map, row) => {
          try {
            map[row.node_id] = JSON.parse(row.value);
          } catch {
            /* skip corrupt row */
          }
          return map;
        }, {});
    },
    backfill() {
      const orphans = db.prepare('SELECT id FROM books WHERE work_id IS NULL').all();
      for (const { id } of orphans) {
        const book = loadBook(id);
        if (!book) continue;
        const workId = this.ensureWork(book.title, book.author);
        const { quality, notes } = editionQuality(book);
        db.prepare('UPDATE books SET work_id=?, quality=?, verified=?, notes=? WHERE id=?').run(
          workId,
          quality,
          quality >= 3 ? 1 : 0,
          JSON.stringify(notes),
          id,
        );
      }
    },
  };
}
