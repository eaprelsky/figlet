import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './network.mjs';
import { importUrl, makeBook, parseFile, searchSources } from './books.mjs';
import { analyze, ask, discover, defaultModel, models, providerName } from './ai.mjs';
import { withAiBudget } from './budget.mjs';
import { createCache } from './cache.mjs';

export function createApp({
  cache = createCache(),
  ai = { analyze, ask, discover },
  loadBook = importUrl,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            'https://mc.yandex.ru',
            'https://mc.yandex.com',
            'https://yastatic.net',
          ],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https://mc.yandex.ru', 'https://mc.yandex.com'],
          connectSrc: ["'self'", 'https://mc.yandex.ru', 'https://mc.yandex.com'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (
      req.method === 'POST' &&
      (req.headers['sec-fetch-site'] === 'cross-site' ||
        (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host))
    )
      return res.status(403).json({ error: 'Запрос разрешён только из Figlet.' });
    next();
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60000,
      limit: 100,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Слишком много запросов. Попробуйте через несколько минут.' },
    }),
  );
  app.use(express.json({ limit: '8mb' }));
  const key = (req) => req.headers['x-deepseek-key'] || process.env.DEEPSEEK_API_KEY;
  const aiLimit = rateLimit({
    windowMs: 60 * 60000,
    limit: 40,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: 'Лимит — 40 новых разборов и вопросов в час. Сохранённые доступны без ограничений.',
    },
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 4 },
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: 'figlet' }));
  app.get('/api/config', (_req, res) =>
    res.json({
      sharedKey: Boolean(process.env.DEEPSEEK_API_KEY),
      defaultModel,
      providerName,
      maxUploadMB: 10,
      sharedLibrary: true,
    }),
  );
  app.get('/api/models', async (req, res) => res.json({ models: await models(key(req)) }));
  app.get('/api/library', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 500).trim() : '';
    res.json({ books: cache.library(query) });
  });
  app.get('/api/library/:id', (req, res) => {
    const book = cache.book(req.params.id);
    if (!book) throw new AppError('Книга пока не добавлена в общую библиотеку.', 404);
    res.json(book);
  });
  app.get('/api/search', async (req, res) => {
    if (typeof req.query.q !== 'string' || !req.query.q.trim() || req.query.q.length > 500)
      throw new AppError('Введите название книги или автора (до 500 символов).');
    res.json({ results: await searchSources(req.query.q.trim()) });
  });
  app.post('/api/import/url', async (req, res) => {
    if (typeof req.body.url !== 'string' || req.body.url.length > 4000)
      throw new AppError('Укажите URL книги.');
    const url = new URL(req.body.url);
    url.hash = '';
    const result = await cache.remember(
      'import',
      { url: url.href, title: req.body.title || '', author: req.body.author || '' },
      async () => {
        const book = await loadBook(url.href, req.body.title, req.body.author);
        cache.saveBook(book);
        return book;
      },
    );
    res.set('X-Figlet-Cache', result.cache).json(result.value);
  });
  app.post('/api/import/file', upload.single('file'), async (req, res) => {
    if (!req.file) throw new AppError('Выберите файл книги.');
    const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const parsed = await parseFile(req.file.buffer, filename, req.file.mimetype);
    res.json(
      makeBook({
        ...parsed,
        title: req.body.title || parsed.title || filename.replace(/\.[^.]+$/, ''),
        author: parsed.author || '',
        sourceLabel: filename,
      }),
    );
  });
  for (const [route, handler] of Object.entries(ai)) {
    app.post(`/api/${route}`, async (req, res) => {
      const generate = async () => {
        // Charge only the request that actually invokes the model, not cache hits or waiters.
        await new Promise((resolve, reject) => {
          const finished = () => reject(new AppError('Лимит новых разборов исчерпан.', 429));
          res.once('finish', finished);
          aiLimit(req, res, (error) => {
            res.off('finish', finished);
            error ? reject(error) : resolve();
          });
        });
        return withAiBudget(() => handler(req.body, key(req)));
      };
      if (route === 'ask') return res.json(await generate());
      const { model = defaultModel } = req.body;
      const input =
        route === 'analyze'
          ? {
              model,
              title: req.body.title,
              author: req.body.author,
              section: req.body.section,
              paragraphs: req.body.paragraphs,
              children: req.body.children,
            }
          : {
              model,
              query: String(req.body.query || '')
                .trim()
                .toLowerCase(),
            };
      const result = await cache.remember(
        route,
        { provider: process.env.AI_BASE_URL || 'https://api.deepseek.com', ...input },
        generate,
      );
      res.set('X-Figlet-Cache', result.cache).json(result.value);
    });
  }
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Такого API-метода нет.' }));
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    const known = error instanceof AppError;
    const oversized = error.code === 'LIMIT_FILE_SIZE' || error.type === 'entity.too.large';
    // Do not log request bodies, source documents, provider responses or credentials.
    if (!known && !oversized)
      console.error('Request failed:', error.name, error.code || 'unclassified');
    res.status(oversized ? 413 : known ? error.status : 500).json({
      error: oversized
        ? 'Файл слишком большой. Максимум — 10 МБ.'
        : known
          ? error.message
          : 'Не удалось обработать запрос. Попробуйте другой файл, ссылку или повторите позже.',
    });
  });
  return app;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3400);
  createApp().listen(port, process.env.HOST || '127.0.0.1', () =>
    console.log(`Figlet listening on ${port}`),
  );
}
