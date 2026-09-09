import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../server/ai.mjs';

test('structural analysis requires a summary for every section', async (t) => {
  let children = [];
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: JSON.stringify({ summary: 'Обзор', children }) },
        },
      ],
    }),
  );
  const body = { paragraphs: ['Оригинальный текст'], children: [{ id: 'part', title: 'Раздел' }] };
  await assert.rejects(() => analyze(body, 'test-key'), /не завершила саммари/);
  children = [{ id: 'part', title: 'Раздел', summary: 'Смысл раздела' }];
  const result = await analyze(body, 'test-key');
  assert.equal(result.summary, 'Обзор');
  assert.equal(result.children[0].summary, 'Смысл раздела');
});
