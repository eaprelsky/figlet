import { test, expect, type Page } from '@playwright/test';
import { makeBook } from '../../server/books.mjs';

const paragraphs = Array.from(
  { length: 36 },
  (_, i) =>
    `Абзац ${i + 1}. Внимание позволяет увидеть связи между идеями. Это точный текст для проверки чтения, навигации и сохранения позиции.`,
);
const blocks: { kind: string; text: string; level?: number }[] = [];
for (let c = 0; c < 3; c++) {
  blocks.push({ kind: 'heading', text: `Глава ${c + 1}`, level: 1 });
  for (let i = c * 12; i < (c + 1) * 12; i++)
    blocks.push({ kind: 'paragraph', text: paragraphs[i] });
}
const fixture = makeBook({ title: 'Книга о внимании', author: 'Владимир Ленин', blocks });
async function setup(page: Page) {
  const calls = { analyze: 0, ask: 0 };
  await page.route('**/api/config', (r) =>
    r.fulfill({ json: { sharedKey: true, defaultModel: 'deepseek-v4-flash' } }),
  );
  await page.route('**/api/discover', (r) =>
    r.fulfill({
      json: {
        title: 'Карта идей',
        intro: 'Исследуем основные произведения автора.',
        works: [
          {
            title: fixture.title,
            author: fixture.author,
            reason: 'Главные идеи и их связь.',
            importance: 5,
            query: fixture.title,
          },
        ],
      },
    }),
  );
  await page.route('**/api/search?*', (r) =>
    r.fulfill({
      json: {
        results: [
          {
            title: fixture.title,
            url: 'https://example.org/book',
            snippet: 'Полный текст',
            source: 'Источник',
          },
        ],
      },
    }),
  );
  await page.route('**/api/import/url', (r) => r.fulfill({ json: fixture }));
  await page.route('**/api/analyze', (r) => {
    calls.analyze++;
    const body = r.request().postDataJSON();
    return r.fulfill({
      json: {
        summary: `Обзор: ${body.section}. В этой части раскрываются связи между идеями.`,
        ideas: ['Первая идея', 'Вторая идея'],
        importance: 5,
        why: 'Фундамент аргумента.',
        skip: 'Исторические подробности можно пропустить.',
        children: body.children.map((c: any) => ({
          id: c.id,
          title: c.title,
          summary: 'Смысл этого фрагмента.',
          importance: 4,
        })),
        model: body.model,
        coverage: 'full',
      },
    });
  });
  await page.route('**/api/ask', (r) => {
    calls.ask++;
    return r.fulfill({ json: { answer: 'Ответ опирается на оригинальный абзац [¶1].' } });
  });
  await page.goto('/');
  await page
    .getByRole('button')
    .filter({ has: page.locator('.catalog-cover') })
    .first()
    .click();
  await expect(page.locator('.author-page h1')).toHaveText('Владимир Ленин');
  return calls;
}
test('author is above book; zoom preserves anchor and paging stays on the chosen level', async ({
  page,
}) => {
  const calls = await setup(page);
  await page.getByRole('button', { name: 'Приблизить — открыть произведение' }).click();
  await expect(page.locator('.saved-mark')).toBeVisible();
  await expect(page.locator('.reading-title')).toHaveText(fixture.title);
  await expect(page.locator('.question-form')).toHaveCount(0);
  await page.getByRole('button', { name: 'Увеличить глубину — больше деталей' }).click();
  await expect(page.locator('.reading-title')).toHaveText('Глава 1');
  await page.getByRole('button', { name: 'Следующая страница этого уровня' }).click();
  await expect(page.locator('.reading-title')).toHaveText('Глава 2');
  await expect(page.locator('.saved-mark')).toBeVisible();
  await page.getByRole('button', { name: 'Уменьшить глубину — более общий обзор' }).click();
  await expect(page.locator('.reading-title')).toHaveText(fixture.title);
  const before = calls.analyze;
  await page.getByRole('button', { name: 'Увеличить глубину — больше деталей' }).click();
  await expect(page.locator('.reading-title')).toHaveText('Глава 2');
  await expect(page.locator('.saved-mark')).toBeVisible();
  expect(calls.analyze).toBe(before);
  await page.reload();
  await expect(page.locator('.reading-title')).toHaveText('Глава 2');
  await expect(page.locator('.saved-mark')).toBeVisible();
  expect(calls.analyze).toBe(before);
  await page.getByRole('button', { name: 'Уменьшить глубину — более общий обзор' }).click();
  await page.getByRole('button', { name: 'Уменьшить глубину — более общий обзор' }).click();
  await expect(page.locator('.author-page h1')).toHaveText('Владимир Ленин');
});
test('original text paginates; questions are optional and tied to the selected paragraph', async ({
  page,
}) => {
  const calls = await setup(page);
  await page.locator('.author-work').first().click();
  await expect(page.locator('.saved-mark')).toBeVisible();
  await page.getByRole('tab', { name: 'Оригинал' }).click();
  await expect(page.locator('.original-paragraph').first().locator('p')).toHaveText(paragraphs[0]);
  await expect(page.locator('.original-paragraph')).toHaveCount(6);
  await page
    .getByRole('navigation', { name: 'Страницы оригинала' })
    .getByRole('button', { name: 'Дальше' })
    .click();
  await expect(page.locator('.original-paragraph').first().locator('p')).toHaveText(paragraphs[6]);
  await page.getByRole('button', { name: 'Задать вопрос по абзацу 7', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.selected-quote blockquote')).toHaveText(paragraphs[6]);
  await page.getByLabel('Вопрос по разделу').fill('Что это значит?');
  await page.getByRole('button', { name: 'Задать вопрос', exact: true }).click();
  await expect(page.locator('.answer')).toContainText('Ответ опирается');
  expect(calls.ask).toBe(1);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.locator('.question-form')).toHaveCount(0);
});
test('mobile controls, dark theme, and author/map screens fit a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.author-work').first().click();
  await expect(page.locator('.saved-mark')).toBeVisible();
  await expect(page.locator('.semantic-dock')).toBeInViewport();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/reader-mobile-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Открыть библиотеку' }).click();
  await expect(page.getByRole('navigation', { name: 'Оглавление книги' })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть библиотеку' }).click();
  await expect(page.locator('.sidebar.is-open')).toHaveCount(0);
});

test('lazy fragments can be opened, paged across chapters, and restored', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setup(page);
  await page.locator('.author-work').first().click();
  await expect(page.locator('.saved-mark')).toBeVisible();
  await page.locator('.depth-row').first().click();
  await expect(page.locator('.reading-title')).toHaveText('Глава 1');
  await expect(page.locator('.saved-mark')).toBeVisible();
  await page.locator('.depth-row').first().click();
  await expect(page.locator('.reading-title')).toHaveText('Абзац 1.');
  for (const n of [4, 7, 10, 13]) {
    await page.getByRole('button', { name: 'Следующая страница этого уровня' }).click();
    await expect(page.locator('.reading-title')).toHaveText(`Абзац ${n}.`);
  }
  await page.getByRole('button', { name: 'Увеличить глубину — больше деталей' }).click();
  await page.getByRole('button', { name: 'Следующая страница этого уровня' }).click();
  await expect(page.locator('.reading-title')).toHaveText('Абзац 14.');
  await page.reload();
  await expect(page.locator('.reading-title')).toHaveText('Абзац 14.');
  await page.getByRole('tab', { name: 'Оригинал' }).click();
  await expect(page.locator('.original-paragraph p')).toHaveText(paragraphs[13]);
  expect(errors).toEqual([]);
});

test('duplicate chapter wrappers are skipped and old saved links still open', async ({ page }) => {
  await setup(page);
  const wrapped = makeBook({
    title: 'Повтор заголовка',
    author: fixture.author,
    blocks: [
      { kind: 'heading', text: 'Глава I', level: 1 },
      { kind: 'heading', text: 'Глава I — повтор', level: 2 },
      { kind: 'heading', text: 'Первый раздел', level: 3 },
      ...paragraphs.slice(0, 6).map((text) => ({ kind: 'paragraph', text })),
      { kind: 'heading', text: 'Второй раздел', level: 3 },
      ...paragraphs.slice(6, 12).map((text) => ({ kind: 'paragraph', text })),
      { kind: 'heading', text: 'Глава II', level: 1 },
      ...paragraphs.slice(12).map((text) => ({ kind: 'paragraph', text })),
    ],
  });
  await page.evaluate(async (book) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('figlet', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('books', 'readwrite');
      tx.objectStore('books').put(book);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, wrapped);
  await page.goto(`/#/book/${wrapped.id}/h1?level=2&at=0`);
  await page.reload();
  await expect(page.locator('.reading-title')).toHaveText('Глава I');
  await expect(page).toHaveURL(new RegExp('/h0\\?level=1&at=0$'));
  await page.getByRole('button', { name: 'Увеличить глубину — больше деталей' }).click();
  await expect(page.locator('.reading-title')).toHaveText('Первый раздел');
  await page.getByRole('button', { name: 'Следующая страница этого уровня' }).click();
  await expect(page.locator('.reading-title')).toHaveText('Второй раздел');
  await page.getByRole('button', { name: 'Увеличить глубину — больше деталей' }).click();
  await expect(page.locator('.reading-title')).toHaveText('Абзац 7.');
  await page.getByRole('button', { name: 'Уменьшить глубину — более общий обзор' }).click();
  await expect(page.locator('.reading-title')).toHaveText('Второй раздел');
});
