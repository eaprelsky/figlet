import { fetchPublic } from './network.mjs';
import { makeBook, parseFile, searchAllSources } from './books.mjs';

const MAX_CANDIDATES = Number(process.env.FIND_MAX_CANDIDATES || 3);
const MIN_LETTERS = Number(process.env.FIND_MIN_LETTERS || 1500);
const normalize = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
// Public text hosts get a small boost over generic pages.
const TRUSTED_HOSTS = /wikisource\.org|gutenberg\.org|proza\.ru|lib\.ru/i;

function scoreCandidate(result, { title, author }) {
  const key = normalize(title);
  const surname = normalize(String(author || '').trim().split(/\s+/).at(-1) || '');
  const haystack = normalize(`${result.title} ${result.url}`);
  let score = 0;
  if (normalize(result.title).includes(key)) score += 3;
  if (haystack.includes(key)) score += 1;
  if (surname && haystack.includes(surname)) score += 1;
  if (TRUSTED_HOSTS.test(result.url)) score += 2;
  return score;
}

function sampleOf(paragraphs) {
  const text = paragraphs.join('\n\n');
  const middle = Math.floor(text.length / 2);
  return [
    `=== НАЧАЛО ===\n${text.slice(0, 4000)}`,
    `=== СЕРЕДИНА ===\n${text.slice(middle, middle + 3000)}`,
    `=== КОНЕЦ ===\n${text.slice(-3000)}`,
  ].join('\n\n');
}

// Agentic text lookup: web-wide search, deterministic screening, AI verification,
// first good candidate wins. Falls back to a manual candidate list.
export async function findBookText(
  { title, author = '' },
  { ai, key, cache, budget, baseUrl, provider, search = searchAllSources, fetcher = fetchPublic },
) {
  const query = `${title} ${author}`.trim();
  const results = await search(query);
  const ranked = results
    .map((result) => ({ result, score: scoreCandidate(result, { title, author }) }))
    .filter(({ score }) => score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map(({ result }) => result);
  const attempts = ranked.length ? ranked : results.slice(0, MAX_CANDIDATES);
  const rejected = [];
  for (const candidate of attempts) {
    let parsed;
    try {
      const fetched = await fetcher(candidate.url);
      parsed = await parseFile(fetched.buffer, new URL(fetched.url).pathname, fetched.type);
    } catch {
      rejected.push({ url: candidate.url, reason: 'source unavailable' });
      continue;
    }
    const paragraphs = parsed.blocks.filter((b) => b.kind === 'paragraph').map((b) => b.text);
    const letters = paragraphs.join('').replace(/[^\p{L}]/gu, '').length;
    if (letters < MIN_LETTERS) {
      rejected.push({ url: candidate.url, reason: 'too little text' });
      continue;
    }
    const book = makeBook({
      ...parsed,
      title,
      author,
      sourceUrl: candidate.url,
      sourceLabel: new URL(candidate.url).hostname,
    });
    // The verdict is cached per URL, so popular sources verify once for everyone.
    const verdict = await cache.remember(
      'verify',
      { url: candidate.url, title, author },
      () =>
        budget(() =>
          ai.verifyText(
            {
              title,
              author,
              sample: sampleOf(book.paragraphs),
              stats: {
                paragraphs: book.paragraphs.length,
                letters,
                headings: Object.keys(book.nodes).length - 1,
                warnings: book.warnings,
              },
            },
            key,
            { baseUrl, provider },
          ),
        ),
    );
    if (verdict.value.verdict !== 'reject' && (verdict.value.confidence ?? 1) >= 0.6)
      return { book, checked: attempts.length, rejected };
    rejected.push({ url: candidate.url, reason: verdict.value.reason || 'rejected by model' });
  }
  return { candidates: (attempts.length ? attempts : results).slice(0, 10), rejected };
}
