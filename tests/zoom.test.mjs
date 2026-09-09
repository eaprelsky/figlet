import test from 'node:test';
import assert from 'node:assert/strict';
import { frontierAt, normalizeBook, resolveNodeId } from '../src/tree.ts';
import { makeBook } from '../server/books.mjs';

test('every semantic level partitions the entire original exactly once', () => {
  let book = makeBook({
    title: 'Книга',
    blocks: Array.from({ length: 117 }, (_, i) => ({
      kind: 'paragraph',
      text: `Абзац ${i}. Содержание оригинала сохраняется без потерь и дублирования.`,
    })),
  });
  for (let depth = 0; depth <= 6; depth++) {
    const result = frontierAt(book, depth);
    book = result.book;
    const indices = result.pages.flatMap((id) =>
      Array.from(
        { length: book.nodes[id].end - book.nodes[id].start },
        (_, i) => book.nodes[id].start + i,
      ),
    );
    assert.deepEqual(
      indices,
      Array.from({ length: 117 }, (_, i) => i),
    );
    const anchor = 83;
    assert.equal(
      result.pages.filter((id) => book.nodes[id].start <= anchor && book.nodes[id].end > anchor)
        .length,
      1,
    );
  }
});

test('normalization keeps source, cached summaries, questions and old node aliases', () => {
  const original = makeBook({
    title: 'Книга',
    blocks: [
      { kind: 'heading', text: 'Название', level: 1 },
      { kind: 'heading', text: 'Повтор', level: 2 },
      { kind: 'heading', text: 'Первая часть', level: 3 },
      {
        kind: 'paragraph',
        text: 'Первый абзац с точным исходным текстом, который должен остаться без изменений.',
      },
      { kind: 'heading', text: 'Вторая часть', level: 3 },
      {
        kind: 'paragraph',
        text: 'Второй абзац с точным исходным текстом, который должен остаться без изменений.',
      },
    ],
  });
  original.currentNode = 'h1';
  original.analyses.h1 = { summary: 'Сохранённый разбор', children: [] };
  original.answers.h1 = [{ question: 'Вопрос', answer: 'Ответ' }];
  const book = normalizeBook(original);
  assert.equal(resolveNodeId(book, 'h1'), 'root');
  assert.equal(book.currentNode, 'root');
  assert.equal(book.analyses.root.summary, 'Сохранённый разбор');
  assert.deepEqual(book.answers.root, original.answers.h1);
  assert.deepEqual(book.paragraphs, original.paragraphs);
  assert.ok(original.nodes.h1);
  assert.equal(normalizeBook(book), book);
  const frontier = frontierAt(book, 1);
  assert.deepEqual(
    frontier.pages.map((id) => book.nodes[id].start),
    [0, 1],
  );
  assert.ok(frontier.pages.every((id) => book.nodes[id].parent === 'root'));
});
