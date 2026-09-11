import { randomUUID } from 'node:crypto';
import { AppError } from './network.mjs';

const WEEK_MS = 7 * 86400000;
const API = 'https://api.yookassa.ru/v3';

// Anonymous readers are metered by device cookie, logged-in ones by account id.
export function createBilling(db, { fetchImpl = fetch } = {}) {
  const price = Number(process.env.SUBSCRIPTION_PRICE_RUB || 199);
  const days = Number(process.env.SUBSCRIPTION_DAYS || 30);
  const freeBooks = Number(process.env.FREE_BOOKS_PER_WEEK || 5);
  const shopId = process.env.YOOKASSA_SHOP_ID || '';
  const secretKey = process.env.YOOKASSA_SECRET_KEY || '';
  db.exec(`CREATE TABLE IF NOT EXISTS subscriptions (
    reader TEXT PRIMARY KEY, until INTEGER NOT NULL, source TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, reader TEXT NOT NULL, status TEXT NOT NULL,
    amount TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS free_usage (
    reader TEXT NOT NULL, book_id TEXT NOT NULL, created INTEGER NOT NULL,
    PRIMARY KEY (reader, book_id));`);

  const authHeader =
    shopId && secretKey ? `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}` : '';
  async function yookassa(path, options = {}) {
    const response = await fetchImpl(`${API}${path}`, {
      ...options,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        'Idempotence-Key': randomUUID(),
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new AppError('Платёжный сервис не ответил. Попробуйте ещё раз позже.', 502);
    return response.json();
  }

  return {
    price,
    days,
    freeBooks,
    configured: Boolean(authHeader),
    paymentOwner(paymentId) {
      const row = db.prepare('SELECT reader FROM payments WHERE id=?').get(paymentId);
      return row?.reader || null;
    },
    weekUsage(reader) {
      return (
        db
          .prepare('SELECT COUNT(DISTINCT book_id) AS n FROM free_usage WHERE reader=? AND created > ?')
          .get(reader, Date.now() - WEEK_MS).n || 0
      );
    },
    hasCountedBook(reader, bookId) {
      return Boolean(
        db.prepare('SELECT 1 FROM free_usage WHERE reader=? AND book_id=?').get(reader, bookId),
      );
    },
    chargeBook(reader, bookId) {
      db.prepare('INSERT OR IGNORE INTO free_usage VALUES (?,?,?)').run(reader, bookId, Date.now());
    },
    subscription(reader) {
      const row = db.prepare('SELECT until FROM subscriptions WHERE reader=?').get(reader);
      return row && row.until > Date.now()
        ? { until: row.until }
        : row
          ? { expired: row.until }
          : null;
    },
    activate(reader, source = 'payment') {
      const current = this.subscription(reader);
      const base = current?.until && current.until > Date.now() ? current.until : Date.now();
      const until = base + days * 86400000;
      db.prepare('INSERT OR REPLACE INTO subscriptions VALUES (?,?,?)').run(
        reader,
        until,
        source,
      );
      return { until };
    },
    async createCheckout(reader, origin) {
      if (!authHeader) throw new AppError('Оплата пока не настроена на сервере.', 503);
      const payment = await yookassa('/payments', {
        method: 'POST',
        body: JSON.stringify({
          amount: { value: price.toFixed(2), currency: 'RUB' },
          capture: true,
          confirmation: {
            type: 'redirect',
            return_url: `${origin || 'https://figlet.eaprelsky.ru'}/#/billing`,
          },
          description: `Figlet: разборы книг без ограничений, ${days} дней`,
          metadata: { reader },
        }),
      });
      db.prepare('INSERT OR REPLACE INTO payments VALUES (?,?,?,?,?)').run(
        payment.id,
        reader,
        payment.status,
        payment.amount?.value || price.toFixed(2),
        Date.now(),
      );
      return { paymentId: payment.id, confirmationUrl: payment.confirmation?.confirmation_url };
    },
    // Pull authoritative status from YooKassa, then grant days exactly once.
    async confirmPayment(reader, paymentId) {
      if (!authHeader) throw new AppError('Оплата пока не настроена на сервере.', 503);
      if (!/^[a-z0-9-]{10,64}$/i.test(paymentId || '')) throw new AppError('Неизвестный платёж.');
      const row = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
      if (!row || (row.reader !== reader && row.status !== 'succeeded'))
        throw new AppError('Платёж не найден для этого читателя.', 404);
      const payment = await yookassa(`/payments/${paymentId}`);
      const succeeded =
        payment.status === 'succeeded' && payment.metadata?.reader === row.reader;
      if (succeeded && row.status !== 'succeeded') {
        db.prepare('UPDATE payments SET status=? WHERE id=?').run('succeeded', paymentId);
        this.activate(row.reader);
      } else if (payment.status !== row.status) {
        db.prepare('UPDATE payments SET status=? WHERE id=?').run(payment.status, paymentId);
      }
      return {
        status: succeeded ? 'succeeded' : payment.status,
        subscription: this.subscription(row.reader),
      };
    },
  };
}
