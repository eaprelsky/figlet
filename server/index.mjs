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

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
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
    }),
  );
  app.get('/api/models', async (req, res) => res.json({ models: await models(key(req)) }));
  app.get('/api/search', async (req, res) => {
    if (typeof req.query.q !== 'string' || !req.query.q.trim() || req.query.q.length > 500)
      throw new AppError('Введите название книги или автора (до 500 символов).');
    res.json({ results: await searchSources(req.query.q.trim()) });
  });
  app.post('/api/import/url', async (req, res) => {
    if (typeof req.body.url !== 'string' || req.body.url.length > 4000)
      throw new AppError('Укажите URL книги.');
    res.json(await importUrl(req.body.url, req.body.title, req.body.author));
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
  for (const [route, handler] of Object.entries({ analyze, ask, discover })) {
    app.post(`/api/${route}`, aiLimit, async (req, res) =>
      res.json(await withAiBudget(() => handler(req.body, key(req)))),
    );
  }
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Такого API-метода нет.' }));
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  app.use((error, _req, res, _next) => {
    const known = error instanceof AppError;
    const oversized = error.code === 'LIMIT_FILE_SIZE' || error.type === 'entity.too.large';
    // Do not log request bodies, source documents, provider responses or credentials.
    if (!known && !oversized)
      console.error('Request failed:', error.name, error.code || 'unclassified');
    res
      .status(oversized ? 413 : known ? error.status : 500)
      .json({
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
