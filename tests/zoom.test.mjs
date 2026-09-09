import test from 'node:test';
import assert from 'node:assert/strict';
import { frontierAt } from '../src/tree.ts';
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
