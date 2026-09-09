import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function isPublicAddress(address) {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export async function validateUrl(input, lookup = dns.lookup) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new AppError('Укажите полный URL, начиная с https://.');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  ) {
    throw new AppError(
      'Поддерживаются только публичные HTTP- и HTTPS-адреса на стандартных портах.',
    );
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new AppError('Не удалось найти сайт по этому адресу.');
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new AppError('Адрес должен вести на публичный сайт.');
  }
  return { url, addresses };
}

export async function retrySource(action) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof AppError && !error.retryable) throw error;
      if (attempt === 2) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          'Источник прервал соединение. Попробуйте ещё раз или добавьте файл книги.',
          502,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
}
export async function fetchPublic(input, options = {}) {
  return retrySource(() => fetchPublicOnce(input, options));
}
async function fetchPublicOnce(input, { maxBytes = 10 * 1024 * 1024, redirects = 4 } = {}) {
  const { url, addresses } = await validateUrl(input);
  addresses.sort((a, b) => a.family - b.family);
  // Pin the connection to the addresses just validated (including across redirects).
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        const chosen =
          addresses.find((a) => !options.family || a.family === options.family) || addresses[0];
        callback(null, options.all ? addresses : chosen.address, chosen.family);
      },
    },
  });
  try {
    const response = await fetch(url, {
      dispatcher,
      redirect: 'manual',
      signal: AbortSignal.timeout(25000),
      headers: {
        'User-Agent': 'Figlet/0.1 (open-source reader; https://github.com/eaprelsky/figlet)',
        Accept:
          'text/html,text/plain,application/json,application/pdf,application/epub+zip;q=0.9,*/*;q=0.5',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects <= 0)
        throw new AppError('Слишком много перенаправлений на сайте.');
      return await fetchPublic(new URL(location, url).href, { maxBytes, redirects: redirects - 1 });
    }
    if (!response.ok) {
      await response.body?.cancel();
      const error = new AppError(
        `Источник вернул HTTP ${response.status}. Попробуйте другую ссылку или загрузите файл.`,
        422,
      );
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw new AppError('Файл слишком большой. Максимум — 10 МБ.');
    }
    let length = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > maxBytes) throw new AppError('Файл слишком большой. Максимум — 10 МБ.');
      chunks.push(chunk);
    }
    return {
      buffer: Buffer.concat(chunks),
      type: response.headers.get('content-type') || '',
      url: url.href,
    };
  } finally {
    await dispatcher.close();
  }
}
