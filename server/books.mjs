import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { unzipSync } from 'fflate';
import { AppError, fetchPublic } from './network.mjs';

// Large novels (War and Peace ~3.2M, the Synodal Bible ~4.1M) must fit whole.
const MAX_CHARACTERS = 5000000;
const clean = (text) =>
  text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
// Technical separators that carry no meaning: *** / —— / ~~~ runs, lone page
// numbers, page markers. They pollute both reading and AI context.
const SEPARATOR_RE = /^[\p{P}\p{S}\s~*=—–-]{1,24}$/u;
const PAGE_NUMBER_RE = /^[st]?[.\s]?\d{1,4}[st]?[.\s]?$/i;
export function cleanBlocks(blocks) {
  let removed = 0;
  const kept = blocks.filter((block) => {
    if (block.kind !== 'paragraph') return true;
    const text = clean(block.text);
    if (SEPARATOR_RE.test(text) || PAGE_NUMBER_RE.test(text)) {
      removed++;
      return false;
    }
    return true;
  });
  return { blocks: kept, removed };
}
const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 24);
export function textBlocks(text) {
  const lines = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  return lines
    .flatMap((line) => {
      const parts = line.split('\n');
      return parts.length > 1 && parts.some((p) => /^#{1,6}\s/.test(p)) ? parts : [line];
    })
    .map((line) => {
      const text = clean(line);
      const heading = /^(#{1,6})\s+(.+)$/.exec(text);
      const chapter =
        /^(глава|часть|раздел|chapter|part|book)\s+[\divxlc]+(?:[.\s:—-]|$)/i.test(text) &&
        text.length < 180;
      return {
        kind: heading || chapter ? 'heading' : 'paragraph',
        text: heading ? heading[2] : text,
        level: heading ? heading[1].length : 2,
      };
    })
    .filter((b) => b.text);
}
export function htmlBlocks(html, { xml = false } = {}) {
  const $ = load(html, { xmlMode: xml });
  const title = clean($('title').first().text());
  $(
    'script,style,noscript,nav,header,footer,aside,form,button,svg,.mw-editsection,.toc,#toc,.noprint,.ws-noexport,.sistersitebox,.ambox,.navbox,.licenseContainer,.mw-indicators,.header-container,.ws-header,.printfooter,.catlinks,.mw-empty-elt',
  ).remove();
  const content = $('.mw-parser-output').first().length
    ? $('.mw-parser-output').first()
    : $('article').first().length
      ? $('article').first()
      : $('main').first().length
        ? $('main').first()
        : $('body').length
          ? $('body')
          : $.root();
  const blocks = [];
  content.find('h1,h2,h3,h4,h5,h6,p,blockquote,li,pre').each((_, el) => {
    if ($(el).parents('p,blockquote,li,pre').length) return;
    const text = clean($(el).text());
    if (!text || /^\[?(править|edit)\]?$/i.test(text)) return;
    blocks.push({
      kind: /^h\d$/.test(el.tagName) ? 'heading' : 'paragraph',
      text,
      level: Number(el.tagName[1]) || 2,
    });
  });
  return { title, blocks: blocks.length ? blocks : textBlocks(content.text()) };
}
export function makeBook({
  blocks,
  title = 'Без названия',
  author = '',
  sourceUrl = '',
  sourceLabel = '',
  warnings = [],
}) {
  const { blocks: cleanedBlocks, removed } = cleanBlocks(blocks);
  if (removed > 5) warnings.push(`Удалены технические разделители разметки: ${removed} абзацев.`);
  blocks = cleanedBlocks;
  const paragraphs = [];
  const headings = [];
  let chars = 0;
  for (const block of blocks) {
    if (chars + block.text.length > MAX_CHARACTERS) {
      warnings.push('Текст превышает лимит 5 млн символов. Загружена только начальная часть.');
      break;
    }
    chars += block.text.length;
    if (block.kind === 'heading')
      headings.push({ title: block.text, level: block.level || 2, start: paragraphs.length });
    else paragraphs.push(block.text);
  }
  if (paragraphs.join('').length < 120)
    throw new AppError(
      'На странице не найден текст книги. Укажите прямую ссылку на текст или загрузите файл.',
      422,
    );
  const id = digest(paragraphs.join('\n\n'));
  const nodes = {
    root: { id: 'root', title, start: 0, end: paragraphs.length, parent: null, children: [] },
  };
  const stack = [{ id: 'root', level: 0 }];
  // Repeated headings at the same position are usually title-page/navigation wrappers.
  const useful = headings.filter(
    (h, i) =>
      h.start < paragraphs.length &&
      (i === headings.length - 1 ||
        headings[i + 1].start !== h.start ||
        headings[i + 1].level > h.level),
  );
  useful.forEach((h, i) => {
    while (stack.length > 1 && stack.at(-1).level >= h.level) stack.pop();
    const parent = stack.at(-1).id;
    const nodeId = `h${i}`;
    const next = useful.slice(i + 1).find((n) => n.level <= h.level);
    nodes[nodeId] = {
      id: nodeId,
      title: h.title,
      start: h.start,
      end: next?.start ?? paragraphs.length,
      parent,
      children: [],
    };
    nodes[parent].children.push(nodeId);
    stack.push({ id: nodeId, level: h.level });
  });
  // Preserve preambles at every level; every paragraph remains reachable.
  for (const node of Object.values(nodes)) {
    if (node.children.length && nodes[node.children[0]].start > node.start) {
      const childId = `${node.id}-intro`;
      nodes[childId] = {
        id: childId,
        title: 'Вступление',
        start: node.start,
        end: nodes[node.children[0]].start,
        parent: node.id,
        children: [],
      };
      node.children.unshift(childId);
    }
  }
  return {
    id,
    title: title.slice(0, 300),
    author: author.slice(0, 180),
    sourceUrl,
    sourceLabel,
    warnings: [...new Set(warnings)],
    paragraphs,
    nodes,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    currentNode: 'root',
    analyses: {},
    answers: {},
  };
}
export async function parseFile(buffer, filename, type = '') {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf') || type.includes('application/pdf')) {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      if (result.text.replace(/\s/g, '').length < 120)
        throw new AppError(
          'В PDF нет текстового слоя. Распознайте скан (OCR) или загрузите EPUB, FB2 либо TXT.',
          422,
        );
      return {
        blocks: textBlocks(result.text),
        warnings: [
          'Текст извлечён из PDF: переносы и порядок колонок могут отличаться от печатной страницы.',
        ],
      };
    } finally {
      await parser.destroy();
    }
  }
  if (lower.endsWith('.epub') || type.includes('epub')) {
    let total = 0,
      count = 0;
    let files;
    try {
      files = unzipSync(buffer, {
        filter: (entry) => {
          if (++count > 1500 || entry.originalSize > 12 * 1024 * 1024)
            throw new AppError('EPUB слишком большой после распаковки.');
          if (!/\.(x?html?|opf|xml)$/i.test(entry.name)) return false;
          total += entry.originalSize;
          if (total > 32 * 1024 * 1024)
            throw new AppError('EPUB слишком большой после распаковки.');
          return true;
        },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Не удалось открыть EPUB. Проверьте файл.');
    }
    const decode = (name) => new TextDecoder().decode(files[name] || new Uint8Array());
    const container = load(decode('META-INF/container.xml'), { xmlMode: true });
    const opfPath =
      container('rootfile').attr('full-path') || Object.keys(files).find((k) => k.endsWith('.opf'));
    if (!opfPath) throw new AppError('В EPUB не найдено оглавление.');
    const opf = load(decode(opfPath), { xmlMode: true });
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const items = new Map();
    opf('manifest item').each((_, el) => items.set(opf(el).attr('id'), opf(el).attr('href')));
    const blocks = [];
    opf('spine itemref').each((_, el) => {
      const href = items.get(opf(el).attr('idref'));
      if (!href) return;
      const path = decodeURIComponent(
        new URL(href, `https://epub.invalid/${base}`).pathname.slice(1),
      );
      blocks.push(...htmlBlocks(decode(path)).blocks);
    });
    return {
      title: opf('dc\\:title').first().text(),
      author: opf('dc\\:creator').first().text(),
      blocks,
    };
  }
  const encodingMatch =
    /(?:charset=["']?|encoding=["'])([\w-]+)/i.exec(buffer.subarray(0, 1500).toString()) ||
    /charset=([\w-]+)/i.exec(type);
  let text;
  try {
    text = new TextDecoder(encodingMatch?.[1] || 'utf-8').decode(buffer);
  } catch {
    text = buffer.toString('utf8');
  }
  if (lower.endsWith('.fb2') || /<FictionBook[\s>]/i.test(text)) {
    const $ = load(text, { xmlMode: true });
    const title = $('title-info book-title').first().text();
    const author = $('title-info author')
      .first()
      .children()
      .map((_, e) => $(e).text())
      .get()
      .join(' ');
    const blocks = [];
    $('body')
      .not('[name="notes"]')
      .find('title,p,subtitle')
      .each((_, el) => {
        if ($(el).parents('title').length) return;
        const text = clean($(el).text());
        if (text)
          blocks.push({
            kind: ['title', 'subtitle'].includes(el.tagName) ? 'heading' : 'paragraph',
            text,
            level: Math.min($(el).parents('section').length + 1, 6),
          });
      });
    return { title, author, blocks };
  }
  if (
    /\.html?$/.test(lower) ||
    type.includes('text/html') ||
    /<(?:!doctype|html|body)\b/i.test(text)
  )
    return htmlBlocks(text);
  if (!/\.(txt|md|markdown|text)$/i.test(lower) && !type.startsWith('text/'))
    throw new AppError('Поддерживаются TXT, Markdown, HTML, FB2, EPUB и PDF.');
  return { blocks: textBlocks(text) };
}

export async function importUrl(url, title, author) {
  const result = await fetchPublic(url);
  const address = new URL(result.url);
  let parsed;
  if (
    /^(ru|en)\.wikisource\.org$/.test(address.hostname) &&
    address.pathname.startsWith('/wiki/')
  ) {
    parsed = await importWikisource(result);
  } else parsed = await parseFile(result.buffer, address.pathname, result.type);
  return makeBook({
    ...parsed,
    title: title || parsed.title || new URL(result.url).hostname,
    author: author || parsed.author || '',
    sourceUrl: result.url,
    sourceLabel: new URL(result.url).hostname,
  });
}

async function importWikisource(result) {
  const address = new URL(result.url);
  const page = decodeURIComponent(address.pathname.slice(6)).replace(/_/g, ' ');
  const $ = load(result.buffer.toString('utf8'));
  const urls = new Map();
  $('.mw-parser-output a[href]').each((_, element) => {
    const href = $(element).attr('href');
    try {
      const link = new URL(href, address);
      const target = decodeURIComponent(link.pathname.slice(6)).replace(/_/g, ' ');
      if (
        link.origin === address.origin &&
        link.pathname.startsWith('/wiki/') &&
        target.startsWith(`${page}/`) &&
        !link.search &&
        !/\/[^/]+\//.test(target.slice(page.length + 1))
      ) {
        const label = link.hash
          ? target.slice(page.length + 1)
          : clean($(element).text()) || target.slice(page.length + 1);
        link.hash = '';
        if (!urls.has(link.href)) urls.set(link.href, label);
      }
    } catch {
      /* Not a document URL. */
    }
  });
  const base = htmlBlocks(result.buffer.toString('utf8'));
  if (!urls.size)
    return {
      ...base,
      title: page,
      warnings: [
        'Загружена одна страница Викитеки. Полноту произведения можно проверить по ссылке на источник.',
      ],
    };
  const blocks = [];
  const warnings = [];
  const pages = [...urls.entries()].slice(0, 40);
  if (urls.size > pages.length)
    warnings.push(
      `В книге ${urls.size} страниц; загружены первые 40. Добавьте остальные отдельно.`,
    );
  // Small batches avoid overloading the source; preserve the source table-of-contents order.
  for (let i = 0; i < pages.length; i += 2) {
    const parts = await Promise.allSettled(
      pages.slice(i, i + 2).map(async ([url, title]) => {
        const content = await fetchPublic(url);
        const part = htmlBlocks(content.buffer.toString('utf8'));
        if (
          part.blocks.filter((b) => b.kind === 'paragraph').reduce((n, b) => n + b.text.length, 0) <
          100
        )
          throw new Error('No body');
        return [
          { kind: 'heading', text: title, level: 1 },
          ...part.blocks.map((b) => ({ ...b, level: Math.max(2, b.level) })),
        ];
      }),
    );
    parts.forEach((part, j) => {
      if (part.status === 'fulfilled') blocks.push(...part.value);
      else warnings.push(`Не удалось загрузить раздел «${pages[i + j][1]}». Книга неполная.`);
    });
  }
  if (!blocks.length)
    throw new AppError(
      'Не удалось загрузить страницы книги. Попробуйте EPUB или ссылку на отдельную главу.',
      422,
    );
  return { title: page, blocks, warnings };
}

export async function searchSources(query) {
  const language = /[а-яё]/i.test(query) ? 'ru' : 'en';
  const base = `https://${language}.wikisource.org`;
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srnamespace: '0',
    srlimit: '10',
    format: 'json',
    utf8: '1',
  });
  const { buffer } = await fetchPublic(`${base}/w/api.php?${params}`, { maxBytes: 1000000 });
  const data = JSON.parse(buffer.toString('utf8'));
  if (data.error)
    throw new AppError('Викитека временно не отвечает. Попробуйте ссылку или файл.', 502);
  return (data.query?.search || []).map((row) => ({
    title: row.title,
    snippet: load(row.snippet).text(),
    url: `${base}/wiki/${encodeURIComponent(row.title.replace(/ /g, '_'))}`,
    source: language === 'ru' ? 'Викитека' : 'Wikisource',
    pageId: row.pageid,
  }));
}

// Aggregators, shops and socials never host readable public-domain texts.
const WEB_JUNK = /(^|\.)(wikipedia\.org|amazon\.|ozon\.|wildberries\.|avito\.|livelib\.|goodreads\.|facebook\.com|vk\.com|youtube\.com|instagram\.com|twitter\.com|x\.com|pinterest\.|oz\.by|labirint\.|book24\.|readrate\.|fantlab\.ru|otzovik\.|irecommend\.|dic\.academic|academic\.ru|slovarozhegova|wiktionary\.org|wikiquote\.org|wikibooks\.org)/i;
export async function searchWeb(query, { language = 'ru', fetchHtml = fetchPublic } = {}) {
  // Best-effort keyless web search; the agent verifier decides what is usable.
  const { buffer } = await fetchHtml(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { maxBytes: 1500000 },
  );
  const $ = load(buffer.toString('utf8'));
  const results = [];
  $('.result__a').each((_, el) => {
    const href = $(el).attr('href');
    const snippet = $(el).closest('.result').find('.result__snippet').text();
    try {
      const target = new URL(href, 'https://duckduckgo.com');
      const real = target.searchParams.get('uddg') || (target.host.endsWith('duckduckgo.com') ? null : target.href);
      if (!real) return;
      const url = new URL(real);
      if (!['http:', 'https:'].includes(url.protocol) || WEB_JUNK.test(url.hostname)) return;
      results.push({
        title: clean($(el).text()),
        snippet: clean(snippet),
        url: url.href,
        source: url.hostname.replace(/^www\./, ''),
      });
    } catch {
      /* not a document URL */
    }
  });
  return results
    .filter((r) => r.title && !/duckduckgo/i.test(r.source))
    .slice(0, 12);
}

export async function searchAllSources(query, { fetchHtml } = {}) {
  const language = /[а-яё]/i.test(query) ? 'ru' : 'en';
  const [wikisource, web] = await Promise.allSettled([
    searchSources(query),
    searchWeb(`${query} ${language === 'ru' ? 'полный текст читать' : 'full text read'}`, {
      language,
      fetchHtml,
    }),
  ]);
  const seen = new Set();
  const merged = [];
  for (const list of [wikisource, web])
    if (list.status === 'fulfilled')
      for (const result of list.value) {
        if (seen.has(result.url)) continue;
        seen.add(result.url);
        merged.push(result);
      }
  if (!merged.length && wikisource.status === 'rejected' && web.status === 'rejected')
    throw new AppError('Поиск временно недоступен. Попробуйте ещё раз или добавьте ссылку.', 502);
  return merged;
}
