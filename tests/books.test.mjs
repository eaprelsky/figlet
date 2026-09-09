import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { htmlBlocks, makeBook, parseFile, textBlocks } from '../server/books.mjs';
import { expandNode, ancestors } from '../src/tree.ts';

const p =
  'Точный оригинальный абзац — с пунктуацией, кавычками «как в источнике» и достаточной длиной для проверки.';
test('chapter hierarchy retains consecutive parent and subsection headings', () => {
  const b = makeBook({
    title: 'Книга',
    blocks: [
      { kind: 'paragraph', text: p },
      { kind: 'heading', text: 'Глава I', level: 1 },
      { kind: 'heading', text: 'Тезис', level: 2 },
      { kind: 'paragraph', text: p },
      { kind: 'heading', text: 'Обоснование', level: 2 },
      { kind: 'paragraph', text: p },
      { kind: 'heading', text: 'Глава II', level: 1 },
      { kind: 'paragraph', text: p },
    ],
  });
  assert.deepEqual(
    b.nodes.root.children.map((id) => b.nodes[id].title),
    ['Вступление', 'Глава I', 'Глава II'],
  );
  const chapter = b.nodes[b.nodes.root.children[1]];
  assert.deepEqual(
    chapter.children.map((id) => b.nodes[id].title),
    ['Тезис', 'Обоснование'],
  );
  assert.equal(b.paragraphs[1], p);
  assert.equal(ancestors(b, chapter.children[0]).length, 3);
});
test('all original paragraphs remain reachable through lazy zoom without loss or duplication', () => {
  let b = makeBook({
    title: 'Без оглавления',
    blocks: Array.from({ length: 123 }, (_, i) => ({ kind: 'paragraph', text: `${i}: ${p}` })),
  });
  const leaves = [];
  function visit(id) {
    b = expandNode(b, id);
    const n = b.nodes[id];
    if (!n.children.length) leaves.push(...b.paragraphs.slice(n.start, n.end));
    else n.children.forEach(visit);
  }
  visit('root');
  assert.deepEqual(leaves, b.paragraphs);
  assert.equal(Object.keys(b.nodes).length < 250, true);
});
test('HTML strips controls and preserves text rather than producing model quotes', () => {
  const parsed = htmlBlocks(
    `<html><title>Книга</title><body><nav><p>Навигация</p></nav><article><h1>Заголовок</h1><p>${p}</p><blockquote><p>Цитата</p></blockquote><script>alert(1)</script></article></body></html>`,
  );
  assert.deepEqual(
    parsed.blocks.map((b) => b.text),
    ['Заголовок', p, 'Цитата'],
  );
});
test('FB2 preserves headings, author and exact paragraph text', async () => {
  const b = await parseFile(
    Buffer.from(
      `<FictionBook><description><title-info><book-title>Тест</book-title><author><first-name>Иван</first-name><last-name>Петров</last-name></author></title-info></description><body><section><title><p>Глава I</p></title><p>${p}</p><p>${p}</p></section></body></FictionBook>`,
    ),
    'test.fb2',
  );
  assert.equal(b.author, 'Иван Петров');
  assert.equal(b.title, 'Тест');
  assert.equal(b.blocks[0].kind, 'heading');
  assert.equal(b.blocks[1].text, p);
});
test('EPUB uses spine order, not ZIP filename order', async () => {
  const zip = zipSync({
    'META-INF/container.xml': strToU8(
      '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    ),
    'OPS/book.opf': strToU8(
      '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Книга EPUB</dc:title></metadata><manifest><item id="a" href="z.xhtml"/><item id="b" href="a.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
    ),
    'OPS/a.xhtml': strToU8(`<html><body><p>Вторая. ${p}</p></body></html>`),
    'OPS/z.xhtml': strToU8(`<html><body><p>Первая. ${p}</p></body></html>`),
  });
  const parsed = await parseFile(Buffer.from(zip), 'book.epub');
  assert.equal(parsed.title, 'Книга EPUB');
  assert.ok(parsed.blocks[0].text.startsWith('Первая.'));
  assert.ok(parsed.blocks[1].text.startsWith('Вторая.'));
});
test('plain markdown recognizes headings and deterministic content IDs', () => {
  const blocks = textBlocks(`# Тест\n\n${p}\n\n## Глава\n\n${p}`);
  const a = makeBook({ blocks });
  const b = makeBook({ blocks });
  assert.equal(a.id, b.id);
  assert.equal(a.paragraphs.length, 2);
  assert.equal(a.nodes.root.children.length, 1);
});
test('empty pages and corrupt archives fail explicitly', async () => {
  assert.throws(
    () => makeBook({ blocks: [{ kind: 'paragraph', text: 'Оглавление' }] }),
    /не найден текст/,
  );
  await assert.rejects(
    () => parseFile(Buffer.from('broken'), 'book.epub'),
    /Не удалось открыть EPUB/,
  );
});
