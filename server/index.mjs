import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './network.mjs';
import { importUrl, makeBook, parseFile, searchSources } from './books.mjs';
import {
  analyze,
  ask,
  discover,
  identify,
  defaultModel,
  models,
  providerName,
} from './ai.mjs';
import { withAiBudget } from './budget.mjs';
import { createCache } from './cache.mjs';
import { createCatalog } from './catalog.mjs';
import { createAuth } from './auth.mjs';
import { createBilling } from './billing.mjs';
import { createIndexer } from './indexer.mjs';

export function createApp({
  cache = createCache(),
  ai = { analyze, ask, discover, identify },
  loadBook = importUrl,
  fetchImpl = fetch,
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
  const catalog = createCatalog(cache.raw, {
    filesDir: cache.dir ? path.join(cache.dir, 'files') : null,
  });
  catalog.backfill();
  const auth = createAuth(cache.raw);
  const billing = createBilling(cache.raw, { fetchImpl });
  const personalConfig = (req) => {
    // A reader may bring their own gateway: own key, own provider, own model.
    const key = req.headers['x-deepseek-key'];
    const baseUrl = String(req.headers['x-ai-base-url'] || '').trim().slice(0, 400);
    const provider = String(req.headers['x-ai-provider'] || '').trim().toLowerCase();
    return {
      key: typeof key === 'string' ? key.slice(0, 500) : undefined,
      keyProvided: typeof key === 'string' && key.length > 0,
      baseUrl: baseUrl && /^https?:\/\//i.test(baseUrl) ? baseUrl : undefined,
      provider: ['openai', 'anthropic'].includes(provider) ? provider : undefined,
    };
  };
  const serverKey = () => process.env.DEEPSEEK_API_KEY;
  const aiKey = (config) => config.keyProvided ? config.key : serverKey();
  const indexer = createIndexer({
    cache,
    catalog,
    analyze: ai.analyze,
    key: serverKey(),
    budget: withAiBudget,
  });

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (
      req.method === 'POST' &&
      (req.headers['sec-fetch-site'] === 'cross-site' ||
        (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host))
    )
      return res.status(403).json({ error: 'Запрос разрешён только из Figlet.' });
    req.reader = auth.reader(req, res);
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
  const aiLimit = rateLimit({
    windowMs: 60 * 60000,
    limit: 40,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: 'Лимит — 40 новых разборов и вопросов в час. Сохранённые доступны без ограничений.',
    },
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Слишком много попыток входа. Подождите немного.' },
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 6 },
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: 'figlet' }));
  app.get('/api/config', (req, res) =>
    res.json({
      sharedKey: Boolean(process.env.DEEPSEEK_API_KEY),
      defaultModel,
      providerName,
      maxUploadMB: 10,
      sharedLibrary: true,
      freeBooksPerWeek: billing.freeBooks,
      subscription: {
        enabled: billing.configured,
        price: billing.price,
        days: billing.days,
      },
    }),
  );
  app.get('/api/quota', (req, res) =>
    res.json({
      reader: req.reader.user ? 'account' : 'device',
      used: billing.weekUsage(req.reader.id),
      limit: billing.freeBooks,
      subscription: billing.subscription(req.reader.id),
    }),
  );
  app.get('/api/models', async (req, res) => {
    const config = personalConfig(req);
    res.json({ models: await models(aiKey(config), config.baseUrl) });
  });

  // Accounts are optional: cookies carry everything, login only adds sync of subscription.
  app.post('/api/auth/register', authLimit, (req, res) => {
    const before = req.reader.id;
    const user = auth.register(req.body?.login, req.body?.password, req, res);
    auth.migrateReader(before, `user:${user.id}`);
    res.json({ user });
  });
  app.post('/api/auth/login', authLimit, (req, res) => {
    const before = req.reader.id;
    const user = auth.login(req.body?.login, req.body?.password, req, res);
    auth.migrateReader(before, `user:${user.id}`);
    res.json({ user });
  });
  app.post('/api/auth/logout', (req, res) => {
    auth.logout(req, res);
    res.json({ ok: true });
  });
  app.get('/api/auth/me', (req, res) =>
    res.json({
      user: req.reader.user,
      subscription: billing.subscription(req.reader.id),
      used: billing.weekUsage(req.reader.id),
      limit: billing.freeBooks,
    }),
  );

  app.post('/api/billing/checkout', async (req, res) => {
    const origin =
      req.headers.origin ||
      `${(req.headers['x-forwarded-proto'] || 'http').split(',')[0]}://${req.headers.host}`;
    res.json(await billing.createCheckout(req.reader.id, origin));
  });
  app.get('/api/billing/status', async (req, res) => {
    const paymentId = typeof req.query.payment_id === 'string' ? req.query.payment_id : '';
    res.json(await billing.confirmPayment(req.reader.id, paymentId));
  });
  // YooKassa server-to-server notification; the payment is re-fetched from the API anyway.
  app.post('/api/billing/notify', async (req, res) => {
    const paymentId = typeof req.body?.object?.id === 'string' ? req.body.object.id : '';
    const owner = billing.paymentOwner(paymentId);
    if (req.body?.event === 'payment.succeeded' && owner)
      await billing.confirmPayment(owner, paymentId);
    res.json({ ok: true });
  });

  app.get('/api/library', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 500).trim() : '';
    res.json({ books: catalog.library(query) });
  });
  app.get('/api/library/:id', (req, res) => {
    const book = catalog.book(req.params.id);
    if (!book) throw new AppError('Книга пока не добавлена в общую библиотеку.', 404);
    res.json(book);
  });
  app.post('/api/library/:id/rename', (req, res) => {
    const title = String(req.body?.title || '').trim();
    const author = String(req.body?.author ?? '').trim();
    if (!title || title.length > 300) throw new AppError('Укажите название (до 300 символов).');
    res.json(catalog.renameEdition(req.params.id, { title, author }));
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
        return book;
      },
    );
    const registered = catalog.register(result.value);
    res.set('X-Figlet-Cache', result.cache).json(registered.book);
  });
  app.post('/api/import/file', upload.single('file'), async (req, res) => {
    if (!req.file) throw new AppError('Выберите файл книги.');
    const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const parsed = await parseFile(req.file.buffer, filename, req.file.mimetype);
    const filenameTitle = filename
      .replace(/\.[^.]+$/, '')
      .replace(/[_]+/g, ' ')
      .trim();

    // Recognition: try the model first, fall back to the filename and ask the reader.
    let detection = null;
    const sample = parsed.blocks
      .filter((b) => b.kind === 'paragraph')
      .slice(0, 3)
      .map((b) => b.text)
      .join('\n\n');
    if (serverKey() && typeof ai.identify === 'function' && (!parsed.title || !parsed.author)) {
      try {
        detection = await withAiBudget(() =>
          ai.identify({ sample, filename: filenameTitle, hint: parsed.title }, serverKey()),
        );
      } catch {
        detection = null; // never block an upload on recognition
      }
    }
    const confident = detection && detection.confidence >= 0.8 && detection.title;
    const title =
      req.body.title || parsed.title || (confident ? detection.title : '') || filenameTitle;
    const author = parsed.author || (confident ? detection.author : '');
    const book = makeBook({
      ...parsed,
      title,
      author,
      sourceLabel: filename,
    });
    const registered = catalog.register(book, {
      file: { buffer: req.file.buffer, filename },
    });
    res.json({
      ...registered.book,
      suggestion:
        detection && !confident
          ? {
              title: detection.title || filenameTitle,
              author: detection.author || '',
              confidence: detection.confidence,
              reason: detection.reason,
              applied: false,
            }
          : null,
    });
  });

  // Whole-book indexing: reader's current section first, then by importance.
  app.post('/api/index', (req, res) => {
    const bookId = String(req.body?.bookId || '');
    if (!/^[a-f0-9]{24}$/.test(bookId)) throw new AppError('Укажите книгу для разбора.');
    const current = String(req.body?.current || 'root').slice(0, 150);
    const model = String(req.body?.model || defaultModel).slice(0, 120);
    res.json(indexer.request(bookId, current, model));
  });
  app.get('/api/index/:bookId', (req, res) => {
    if (!/^[a-f0-9]{24}$/.test(req.params.bookId)) throw new AppError('Некорректный идентификатор.');
    const model = String(req.query.model || defaultModel).slice(0, 120);
    res.json({
      ...indexer.status(req.params.bookId),
      analyses: indexer.analyses(req.params.bookId, model),
    });
  });

  app.get('/api/admin/works', (req, res) => {
    if (!req.reader.user?.isAdmin) throw new AppError('Только для администратора.', 403);
    res.json({ works: catalog.worksWithEditions() });
  });
  app.post('/api/admin/works/:id/rename', (req, res) => {
    if (!req.reader.user?.isAdmin) throw new AppError('Только для администратора.', 403);
    catalog.renameWork(
      req.params.id,
      String(req.body?.title || '').trim(),
      String(req.body?.author ?? '').trim(),
    );
    res.json({ ok: true });
  });
  app.post('/api/admin/editions/:id/verify', (req, res) => {
    if (!req.reader.user?.isAdmin) throw new AppError('Только для администратора.', 403);
    res.json(catalog.verify(req.params.id));
  });
  app.delete('/api/admin/works/:id', (req, res) => {
    if (!req.reader.user?.isAdmin) throw new AppError('Только для администратора.', 403);
    catalog.removeWork(req.params.id);
    res.json({ ok: true });
  });

  for (const [route, handler] of Object.entries(ai)) {
    if (route === 'identify') continue;
    app.post(`/api/${route}`, async (req, res) => {
      const config = personalConfig(req);
      const bookId =
        typeof req.body?.bookId === 'string' && /^[a-f0-9]{24}$/.test(req.body.bookId)
          ? req.body.bookId
          : '';
      const nodeId = typeof req.body?.nodeId === 'string' ? req.body.nodeId.slice(0, 150) : '';
      const model = String(req.body?.model || defaultModel).slice(0, 120);
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
        // Free tier: five new books a week on the shared key; own key or subscription is unlimited.
        let chargeBook = false;
        if (route === 'analyze' && bookId && !config.keyProvided) {
          const reader = req.reader.id;
          if (!billing.subscription(reader)) {
            if (!billing.hasCountedBook(reader, bookId)) {
              if (billing.weekUsage(reader) >= billing.freeBooks) {
                const error = new AppError(
                  `На этой неделе вы уже разобрали ${billing.freeBooks} новых книг за счёт сервера. Подключите свой ключ в настройках или оформите подписку — сохранённые книги продолжат работать.`,
                  402,
                );
                error.code = 'book-quota';
                throw error;
              }
              chargeBook = true;
            }
          }
        }
        const result = await withAiBudget(() =>
          handler(req.body, aiKey(config), { baseUrl: config.baseUrl, provider: config.provider }),
        );
        if (chargeBook) billing.chargeBook(req.reader.id, bookId);
        if (route === 'analyze' && bookId && nodeId)
          catalog.saveAnalysis(bookId, nodeId, model, result);
        return result;
      };
      if (route === 'ask') return res.json(await generate());
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
        { provider: config.baseUrl || process.env.AI_BASE_URL || 'https://api.deepseek.com', ...input },
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
      ...(known && error.code ? { code: error.code } : {}),
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
