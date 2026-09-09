import { useState, useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Download,
  FileText,
  Layers,
  Library,
  Link as LinkIcon,
  LoaderCircle,
  Menu,
  MessageCircle,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  ancestors,
  expandNode,
  frontierAt,
  normalizeBook,
  resolveNodeId,
  readingMinutes,
  type Book,
  type Analysis,
} from './tree';
import { storage, getCookie, setCookie, validBook } from './storage';

type Source = { title: string; url: string; snippet: string; source: string };
type Work = { title: string; author: string; reason: string; importance: number; query: string };
type Route = { title: string; intro: string; works: Work[] };
type Author = Route & { id: string; name: string; currentWork?: string };
type Config = { sharedKey: boolean; defaultModel: string; providerName?: string };
const starters = [
  {
    author: 'Владимир Ленин',
    title: 'Как устроена власть?',
    subtitle: 'Государство, революция и общество',
    query:
      'Что самое важное читать у Ленина, чтобы понять его вклад? Без второстепенных переписок и локальной полемики.',
    letter: 'Л',
    color: 'indigo',
  },
  {
    author: 'Марк Аврелий',
    title: 'На что мы можем влиять?',
    subtitle: 'Стоицизм и внутренняя свобода',
    query: 'Марк Аврелий. Наедине с собой: главные идеи и с чего начать чтение.',
    letter: 'М',
    color: 'green',
  },
  {
    author: 'Никколо Макиавелли',
    title: 'Почему власть держится?',
    subtitle: 'Политика без иллюзий',
    query: 'Что читать у Макиавелли? Хочу понять его главные идеи и вклад.',
    letter: 'М',
    color: 'rose',
  },
];
function readRoute() {
  const [pathname, search] = location.hash.slice(2).split('?');
  const [kind, bookId, nodeId] = pathname.split('/');
  if (kind === 'author')
    return {
      bookId: '',
      nodeId: '',
      level: -1,
      anchor: 0,
      authorId: decodeURIComponent(bookId || ''),
    };
  return kind === 'book'
    ? {
        authorId: '',
        anchor: Number(new URLSearchParams(search).get('at') || 0),
        bookId: decodeURIComponent(bookId || ''),
        nodeId: decodeURIComponent(nodeId || 'root'),
        level: Math.max(0, Math.min(12, Number(new URLSearchParams(search).get('level') || 0))),
      }
    : null;
}
function safeLink(url: string) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
function Rating({ value }: { value: number }) {
  return (
    <span
      className="rating"
      title={`Важность ${value} из 5 — оценка модели`}
      aria-label={`Важность ${value} из 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={n <= value ? 'filled' : ''} />
      ))}
    </span>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);
  const booksRef = useRef<Book[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<Config>({
    sharedKey: false,
    defaultModel: 'deepseek-v4-flash',
  });
  const [model, setModel] = useState(decodeURIComponent(getCookie('figlet_model') || ''));
  const [key, setKey] = useState(() => sessionStorage.getItem('figlet_key') || '');
  const [rememberKey, setRememberKey] = useState(!!sessionStorage.getItem('figlet_key'));
  const [theme, setTheme] = useState(decodeURIComponent(getCookie('figlet_theme') || 'system'));
  const [route, setRoute] = useState(readRoute);
  const [sidebar, setSidebar] = useState(false);
  const [modal, setModal] = useState<'settings' | 'import' | 'about' | 'question' | 'find' | null>(
    null,
  );
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'guide' | 'text'>('guide');
  const [guide, setGuide] = useState<Route | null>(null);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [sourceQuery, setSourceQuery] = useState('');
  const [url, setUrl] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [importAuthor, setImportAuthor] = useState('');
  const [view, setView] = useState<'summary' | 'original'>('summary');
  const [question, setQuestion] = useState('');
  const [quote, setQuote] = useState('');
  const [importantOnly, setImportantOnly] = useState(false);
  const [originalPage, setOriginalPage] = useState(0);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fontSize, setFontSize] = useState(Number(getCookie('figlet_font') || 18));
  const attempts = useRef(new Set<string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const originalRef = useRef<HTMLDivElement>(null);
  const activeAuthor = authors.find((a) => a.id === route?.authorId);
  const active = books.find((b) => b.id === route?.bookId);
  const parentAuthor = authors.find(
    (a) => a.id === active?.authorId || (active?.author && a.name === active.author),
  );
  const node = active?.nodes[route?.nodeId || 'root'];
  const selectedModel = model || config.defaultModel;
  const rawAnalysis = active?.analyses[node?.id || 'root'];
  const analysis = rawAnalysis?.model === selectedModel ? rawAnalysis : undefined;
  const canAnalyze = config.sharedKey || !!key;

  function updateBook(id: string, transform: (book: Book) => Book) {
    const old = booksRef.current.find((b) => b.id === id);
    if (!old) return;
    const updated = transform(old);
    booksRef.current = booksRef.current.map((b) => (b.id === id ? updated : b));
    setBooks(booksRef.current);
    void storage
      .save(updated)
      .catch(() =>
        setError(
          'Не удалось сохранить книгу в браузере. Освободите место или экспортируйте библиотеку.',
        ),
      );
  }
  async function addBook(book: Book) {
    if (booksRef.current.some((b) => b.id === book.id)) {
      navigate(
        book.id,
        booksRef.current.find((b) => b.id === book.id)!.currentNode,
        booksRef.current.find((b) => b.id === book.id)!.currentLevel,
      );
      setNotice('Эта книга уже есть в библиотеке. Открыта сохранённая версия.');
      return;
    }
    const expanded = expandNode(normalizeBook(book), 'root');
    await storage.save(expanded);
    booksRef.current = [expanded, ...booksRef.current];
    setBooks(booksRef.current);
    navigate(expanded.id, 'root');
    setModal(null);
    setSources(null);
    setUrl('');
    setImportTitle('');
    setImportAuthor('');
  }
  function navigate(
    bookId?: string,
    nodeId = 'root',
    requestedLevel?: number,
    keepView = false,
    requestedAnchor?: number,
  ) {
    let level = requestedLevel || 0;
    let anchor = requestedAnchor || 0;
    if (bookId)
      updateBook(bookId, (b) => {
        level = requestedLevel ?? Math.max(0, ancestors(b, nodeId).length - 1);
        const expanded = frontierAt(b, level).book;
        anchor = requestedAnchor ?? expanded.nodes[nodeId].start;
        return {
          ...expandNode(expanded, nodeId),
          currentNode: nodeId,
          currentLevel: level,
          currentAnchor: anchor,
          updatedAt: Date.now(),
        };
      });
    location.hash = bookId
      ? `/book/${encodeURIComponent(bookId)}/${encodeURIComponent(nodeId)}?level=${level}&at=${anchor}`
      : '/';
    setSidebar(false);
    setQuote('');
    setQuestion('');
    setImportantOnly(false);
    setOriginalPage(0);
    if (!keepView) setView('summary');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function navigateAuthor(author: Author) {
    location.hash = `/author/${encodeURIComponent(author.id)}`;
    setSidebar(false);
    setModal(null);
    setSources(null);
    setGuide(null);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  async function rememberAuthor(data: Route, requestedName?: string) {
    const name = requestedName || data.works[0]?.author || data.title;
    const author: Author = { ...data, name, id: name.trim().toLowerCase().replace(/\s+/g, '-') };
    await storage.saveAuthor(author);
    setAuthors((current) => [...current.filter((a) => a.id !== author.id), author]);
    navigateAuthor(author);
  }
  async function openAuthor(name: string) {
    const cached = authors.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (cached) {
      navigateAuthor(cached);
      return;
    }
    if (!canAnalyze) {
      setModal('settings');
      setNotice('Подключите DeepSeek для карты автора.');
      return;
    }
    await run('Собираю карту автора и его произведений…', async () => {
      const data = await api('discover', {
        query: `${name}: главные идеи, вклад и наиболее важные произведения. Дай маршрут от фундаментальных работ к дополнительным.`,
      });
      await rememberAuthor(data, name);
    });
  }
  function zoom(delta: number) {
    if (!active || !node) return;
    if ((route?.level || 0) === 0 && delta < 0) {
      if (parentAuthor) navigateAuthor(parentAuthor);
      else if (active.author) void openAuthor(active.author);
      return;
    }
    const level = Math.max(0, Math.min(12, (route?.level || 0) + delta));
    const anchor =
      view === 'original' && originalPage > 0
        ? node.start + originalPage * 6
        : (route?.anchor ?? node.start);
    const frontier = frontierAt(active, level);
    const target =
      frontier.pages.find(
        (id) => frontier.book.nodes[id].start <= anchor && frontier.book.nodes[id].end > anchor,
      ) || frontier.pages[0];
    updateBook(active.id, (b) => ({ ...b, nodes: frontier.book.nodes }));
    navigate(active.id, target, level, true, anchor);
  }
  async function api(path: string, body?: unknown): Promise<any> {
    const headers: Record<string, string> = {};
    if (key) headers['x-deepseek-key'] = key;
    const isForm = body instanceof FormData;
    if (body && !isForm) headers['Content-Type'] = 'application/json';
    const result = await fetch(`/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body
        ? isForm
          ? (body as FormData)
          : JSON.stringify({ ...(body as object), model: selectedModel })
        : undefined,
      signal: AbortSignal.timeout(125000),
    });
    let data;
    try {
      data = await result.json();
    } catch {
      throw new Error('Сервер не ответил. Проверьте подключение и повторите запрос.');
    }
    if (!result.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
    return data;
  }
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    setError('');
    setNotice('');
    setBusy(label);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выполнить действие.');
    } finally {
      setBusy('');
    }
  }
  useEffect(() => {
    storage
      .authors()
      .then((items) =>
        setAuthors(
          items.filter(
            (a: Author) =>
              typeof a.id === 'string' && typeof a.name === 'string' && Array.isArray(a.works),
          ),
        ),
      )
      .catch(() => {});
    storage
      .books()
      .then((items) => {
        const safe = items.filter(validBook).map((b) => {
          const normalized = normalizeBook(b);
          return expandNode(normalized, normalized.currentNode || 'root');
        });
        booksRef.current = safe;
        setBooks(safe);
        setLoaded(true);
      })
      .catch(() => {
        setLoaded(true);
        setError(
          'Хранилище браузера недоступно. Разрешите локальное хранение данных для библиотеки.',
        );
      });
    fetch('/api/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch(() =>
        setError('Нет соединения с сервером. Сохранённые книги можно продолжать читать.'),
      );
    const change = () => {
      setRoute(readRoute());
      setQuote('');
      setQuestion('');
      setImportantOnly(false);
      setOriginalPage(0);
    };
    addEventListener('hashchange', change);
    return () => removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    if (!active || !route?.nodeId) return;
    const id = resolveNodeId(active, route.nodeId);
    if (!active.nodes[id]) return;
    if (id !== route.nodeId || !frontierAt(active, route.level).pages.includes(id)) {
      const level = Math.max(0, ancestors(active, id).length - 1);
      const hash = `/book/${encodeURIComponent(active.id)}/${encodeURIComponent(id)}?level=${level}&at=${route.anchor}`;
      history.replaceState(null, '', `#${hash}`);
      setRoute(readRoute());
    }
  }, [active, route]);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme);
    apply();
    setCookie('figlet_theme', theme);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    if (model) setCookie('figlet_model', model);
  }, [model]);
  useEffect(() => {
    if (rememberKey && key) sessionStorage.setItem('figlet_key', key);
    else sessionStorage.removeItem('figlet_key');
  }, [key, rememberKey]);
  useEffect(() => {
    setCookie('figlet_font', String(fontSize));
  }, [fontSize]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  async function analyzeNode(book: Book, nodeId: string) {
    const expanded = expandNode(book, nodeId);
    const section = expanded.nodes[nodeId];
    updateBook(book.id, (b) => expandNode(b, nodeId));
    const result: Analysis = await api('analyze', {
      title: book.title,
      author: book.author,
      section: section.title,
      paragraphs: book.paragraphs.slice(section.start, section.end),
      children: section.children.map((id) => {
        const child = expanded.nodes[id];
        return {
          id,
          title: child.title,
          start: child.start - section.start,
          end: child.end - section.start,
          preview: book.paragraphs
            .slice(child.start, Math.min(child.start + 3, child.end))
            .join('\n')
            .slice(0, 1600),
        };
      }),
    });
    updateBook(book.id, (b) => ({ ...b, analyses: { ...b.analyses, [nodeId]: result } }));
  }
  useEffect(() => {
    if (!active || !node || !canAnalyze || analysis || busy || view !== 'summary') return;
    const id = `${active.id}:${node.id}:${selectedModel}`;
    if (attempts.current.has(id)) return;
    attempts.current.add(id);
    void run('Читаю раздел и собираю карту идей…', () => analyzeNode(active, node.id));
  }, [active?.id, node?.id, canAnalyze, selectedModel, analysis, busy, view]);

  async function findText(text: string, work?: Work) {
    setSourceQuery(text);
    const data = await api(`search?q=${encodeURIComponent(text)}`);
    setSources(data.results);
    if (work) {
      setImportTitle(work.title);
    }
  }
  async function search(text = query) {
    if (!text.trim()) return;
    navigate();
    setSources(null);
    setGuide(null);
    await run(
      searchMode === 'guide' && canAnalyze
        ? 'Составляю маршрут чтения…'
        : 'Ищу текст в открытой библиотеке…',
      async () => {
        if (searchMode === 'guide' && canAnalyze) {
          const cacheKey = `${selectedModel}:${text.trim().toLowerCase()}`;
          const cached = await storage.route(cacheKey);
          const data = cached || (await api('discover', { query: text }));
          await rememberAuthor(data);
          if (!cached) await storage.saveRoute(cacheKey, data);
        } else await findText(text);
      },
    );
  }
  async function openWork(work: Work, owner: Author | undefined = activeAuthor) {
    if (owner) {
      const updated = { ...owner, currentWork: work.title };
      setAuthors((current) => current.map((a) => (a.id === owner.id ? updated : a)));
      void storage.saveAuthor(updated).catch(() => {});
    }
    const existing = booksRef.current.find(
      (b) =>
        b.title.toLowerCase() === work.title.toLowerCase() &&
        b.author.toLowerCase() === work.author.toLowerCase(),
    );
    if (existing) {
      navigate(existing.id, 'root', 0);
      return;
    }
    await run('Ищу полный текст книги…', async () => {
      const data = await api(`search?q=${encodeURIComponent(work.title)}`);
      setSourceQuery(work.title);
      setSources(data.results);
      setImportTitle(work.title);
      const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const candidates: Source[] = data.results.filter(
        (s: Source) =>
          normalize(s.title).startsWith(normalize(work.title)) && !s.title.includes('/'),
      );
      const surname = normalize(work.author.trim().split(/\s+/).at(-1) || '');
      const exact =
        candidates.find((s) => surname && normalize(s.title).includes(surname)) ||
        (candidates.length === 1 && normalize(candidates[0].title) === normalize(work.title)
          ? candidates[0]
          : undefined);
      if (exact) {
        try {
          const book = await api('import/url', {
            url: exact.url,
            title: work.title,
            author: work.author,
          });
          await addBook({ ...book, authorId: owner?.id });
        } catch (error) {
          setImportTitle(work.title);
          setImportAuthor(work.author);
          setModal('import');
          throw error;
        }
      } else {
        navigate();
      }
    });
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Файл слишком большой. Максимум — 10 МБ.');
      return;
    }
    await run('Извлекаю текст и оглавление…', async () => {
      const data = new FormData();
      data.append('file', file);
      if (importTitle) data.append('title', importTitle);
      const book = await api('import/file', data);
      await addBook({
        ...book,
        author: importAuthor || activeAuthor?.name || book.author,
        authorId: activeAuthor?.id,
      });
    });
  }
  async function submitQuestion(e: FormEvent) {
    e.preventDefault();
    if (!active || !node || !question.trim()) return;
    const q = question.trim();
    const selected = quote;
    if ((active.answers[node.id] || []).some((a) => a.question === q && a.quote === selected)) {
      setNotice('Ответ на этот вопрос уже сохранён ниже.');
      setQuestion('');
      return;
    }
    await run('Ищу ответ в тексте…', async () => {
      const data = await api('ask', {
        title: active.title,
        paragraphs: active.paragraphs.slice(node.start, node.end),
        question: q,
        quote: selected,
      });
      updateBook(active.id, (b) => ({
        ...b,
        answers: {
          ...b.answers,
          [node.id]: [
            ...(b.answers[node.id] || []),
            { question: q, answer: data.answer, quote: selected },
          ],
        },
      }));
      setQuestion('');
      setQuote('');
    });
  }
  function selectQuote() {
    const selection = window.getSelection();
    if (
      selection &&
      selection.rangeCount &&
      originalRef.current?.contains(selection.anchorNode) &&
      originalRef.current?.contains(selection.focusNode)
    ) {
      const text = selection.toString().trim();
      if (text && text.length <= 12000 && active?.paragraphs.some((p) => p.includes(text)))
        setQuote(text);
    }
  }
  const path = active && node ? ancestors(active, node.id) : [];
  const semanticLevel = route?.level || 0;
  const levelPages = active ? frontierAt(active, semanticLevel).pages : [];
  const bookPeers = semanticLevel === 0 && parentAuthor ? parentAuthor.works : null;
  const pageIndex = bookPeers
    ? bookPeers.findIndex((w) => w.title === active?.title)
    : node
      ? levelPages.indexOf(node.id)
      : -1;
  const pageCount = bookPeers ? bookPeers.length : levelPages.length;
  function turnPage(delta: number) {
    if (!active) return;
    if (bookPeers) void openWork(bookPeers[pageIndex + delta], parentAuthor);
    else navigate(active.id, levelPages[pageIndex + delta], semanticLevel, true);
  }
  const levelLabel =
    semanticLevel === 0
      ? 'Вся книга'
      : node && node.end - node.start === 1
        ? 'Абзацы'
        : ['Вся книга', 'Главы', 'Разделы', 'Фрагменты'][semanticLevel] || 'Малые фрагменты';
  const originalPages = node ? Math.ceil((node.end - node.start) / 6) : 1;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        К содержанию
      </a>
      <header className="topbar">
        <div className="brand-group">
          <button
            className="icon-button mobile-menu"
            aria-label="Открыть библиотеку"
            onClick={() => setSidebar(true)}
          >
            <Menu size={21} />
          </button>
          <a href="#/" className="brand" onClick={() => navigate()}>
            figlet<span className="brand-dot">.</span>
          </a>
          <span className="brand-note">читать вглубь</span>
        </div>
        <div className="top-actions">
          <span className="local-indicator">
            <span />
            Ваша личная библиотека
          </span>
          <button
            className="icon-button"
            aria-label="Переключить тему"
            title="Переключить тему"
            onClick={() =>
              setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
            }
          >
            {theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          <button
            className="icon-button"
            aria-label="Настройки"
            title="Настройки"
            onClick={() => setModal('settings')}
          >
            <Settings size={20} />
          </button>
        </div>
      </header>
      {sidebar && (
        <button
          className="sidebar-backdrop"
          aria-label="Закрыть библиотеку"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={`sidebar ${sidebar ? 'is-open' : ''}`}>
        <button className={`nav-item ${!active ? 'selected' : ''}`} onClick={() => navigate()}>
          <Search size={18} />
          Найти книгу
        </button>
        {authors.length > 0 && (
          <nav className="author-nav" aria-label="Мои авторы">
            {authors.map((a) => (
              <button
                key={a.id}
                className={activeAuthor?.id === a.id || parentAuthor?.id === a.id ? 'current' : ''}
                onClick={() => navigateAuthor(a)}
              >
                <span>
                  {a.name
                    .split(' ')
                    .map((s) => s[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                {a.name}
              </button>
            ))}
          </nav>
        )}
        <div className="library-label">
          <span>Мои книги</span>
          <span>{books.length}</span>
        </div>
        <nav aria-label="Библиотека">
          {[...books]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((b) => (
              <button
                className={`library-book ${active?.id === b.id ? 'selected' : ''}`}
                key={b.id}
                onClick={() =>
                  navigate(b.id, b.currentNode, b.currentLevel, false, b.currentAnchor)
                }
              >
                <BookOpen size={17} />
                <span>
                  <strong>{b.title}</strong>
                  <small>{b.author || b.sourceLabel}</small>
                </span>
              </button>
            ))}
        </nav>
        {!books.length && (
          <p className="sidebar-empty">
            Здесь появятся книги,
            <br />к которым захочется вернуться.
          </p>
        )}
        <button
          className="add-book"
          onClick={() => {
            setImportTitle('');
            setModal('import');
            setSidebar(false);
          }}
        >
          <Plus size={17} />
          Добавить свою книгу
        </button>
        {active && (
          <nav className="book-outline" aria-label="Оглавление книги">
            <p>Оглавление</p>
            {active.nodes.root.children.map((id, i) => (
              <button
                key={id}
                className={path.some((n) => n.id === id) ? 'current' : ''}
                onClick={() => navigate(active.id, id, 1)}
              >
                <span>{i + 1}</span>
                {active.nodes[id].title}
              </button>
            ))}
          </nav>
        )}
        <div className="sidebar-bottom">
          <p>
            <Layers size={15} />
            Разборы сохраняются
            <br />
            <span>на этом устройстве</span>
          </p>
          <button onClick={() => setModal('about')}>
            <CircleHelp size={16} />
            Как читать в Figlet
          </button>
          <a href="https://github.com/eaprelsky/figlet" target="_blank" rel="noreferrer">
            Открытый исходный код
            <ArrowUp size={13} className="diagonal" />
          </a>
        </div>
      </aside>
      <main id="main" className={active || activeAuthor ? 'main reader-main' : 'main'}>
        {error && (
          <div className="alert error" role="alert">
            <span>{error}</span>
            <button className="icon-button" aria-label="Скрыть ошибку" onClick={() => setError('')}>
              <X size={17} />
            </button>
          </div>
        )}
        {notice && (
          <div className="alert notice" role="status">
            <Check size={17} />
            {notice}
          </div>
        )}
        {busy && (
          <div className="loading-strip" role="status">
            <LoaderCircle className="spin" size={17} />
            {busy}
          </div>
        )}
        {!loaded ? (
          <div className="empty-state">
            <LoaderCircle className="spin" />
            Открываю библиотеку…
          </div>
        ) : route && !active && !activeAuthor ? (
          <div className="empty-state">
            <BookOpen size={36} />
            <h1>Этой книги нет на устройстве</h1>
            <p>
              Библиотека хранится в вашем браузере. Импортируйте книгу или откройте Figlet на
              прежнем устройстве.
            </p>
            <button className="primary" onClick={() => navigate()}>
              Найти книгу
            </button>
          </div>
        ) : activeAuthor ? (
          <>
            <nav className="breadcrumbs" aria-label="Путь к автору">
              <button onClick={() => navigate()}>
                <Library size={16} />
              </button>
              <ChevronRight size={14} />
              <span>{activeAuthor.name}</span>
            </nav>
            <article className="reading-area author-page">
              <div className="semantic-location">
                <span>Автор</span>
                <span>{activeAuthor.works.length} произведений на карте</span>
              </div>
              <h1 className="reading-title">{activeAuthor.name}</h1>
              <p className="author-intro">{activeAuthor.intro}</p>
              <p className="subtle-note">
                Карта по знаниям модели. Разбор произведений строится по загруженному оригиналу.
              </p>
              <section className="author-works">
                <div className="section-heading">
                  <h2>Карта произведений</h2>
                  <span>В рекомендуемом порядке чтения</span>
                </div>
                {activeAuthor.works.map((work, i) => (
                  <button
                    className={`author-work ${activeAuthor.currentWork === work.title ? 'current-work' : ''}`}
                    key={`${work.title}-${i}`}
                    disabled={!!busy}
                    onClick={() => void openWork(work, activeAuthor)}
                  >
                    <span className="work-number">{i + 1}</span>
                    <div>
                      <h3>{work.title}</h3>
                      <p>{work.reason}</p>
                      <div className="depth-meta">
                        <Rating value={work.importance} />
                        <span>
                          {books.some((b) => b.title === work.title)
                            ? 'В вашей библиотеке'
                            : 'Открыть книгу'}
                        </span>
                      </div>
                    </div>
                    <ChevronRight size={18} />
                  </button>
                ))}
              </section>
              <div className="author-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    setImportTitle('');
                    setModal('import');
                  }}
                >
                  <Plus size={16} />
                  Добавить произведение
                </button>
              </div>
            </article>
            <nav className="semantic-dock" aria-label="Масштаб и страницы автора">
              <button
                className="page-step"
                aria-label="Предыдущий автор"
                disabled={authors.indexOf(activeAuthor) <= 0}
                onClick={() => navigateAuthor(authors[authors.indexOf(activeAuthor) - 1])}
              >
                <ArrowLeft size={20} />
                <span>Назад</span>
              </button>
              <div className="zoom-control">
                <button aria-label="Самый общий уровень — автор" disabled>
                  −
                </button>
                <div>
                  <strong>Автор</strong>
                  <span>
                    {authors.indexOf(activeAuthor) + 1} / {authors.length}
                  </span>
                </div>
                <button
                  aria-label="Приблизить — открыть произведение"
                  disabled={!!busy || !activeAuthor.works.length}
                  onClick={() =>
                    void openWork(
                      activeAuthor.works.find((w) => w.title === activeAuthor.currentWork) ||
                        activeAuthor.works[0],
                      activeAuthor,
                    )
                  }
                >
                  +
                </button>
              </div>
              <button
                className="page-step"
                aria-label="Следующий автор"
                disabled={authors.indexOf(activeAuthor) >= authors.length - 1}
                onClick={() => navigateAuthor(authors[authors.indexOf(activeAuthor) + 1])}
              >
                <span>Дальше</span>
                <ArrowRight size={20} />
              </button>
            </nav>
          </>
        ) : !active ? (
          <>
            <section className="library-home">
              <div className="library-home-title">
                <div>
                  <h1>Авторы и идеи</h1>
                  <p>От наследия автора — к одной важной мысли.</p>
                </div>
                <button className="primary" onClick={() => setModal('find')}>
                  <Plus size={17} />
                  Найти книгу
                </button>
              </div>
              <div className="scale-introduction">
                <div className="scale-caption">
                  <Layers size={17} />
                  <span>Выбирайте глубину чтения</span>
                </div>
                <div className="scale-preview">
                  <span className="scale-author">Автор</span>
                  <ChevronRight size={15} />
                  <span className="scale-book">Книги</span>
                  <ChevronRight size={15} />
                  <span className="scale-chapter">Главы</span>
                  <ChevronRight size={15} />
                  <span className="scale-fragment">Фрагменты</span>
                  <ChevronRight size={15} />
                  <span className="scale-paragraph">Абзацы</span>
                </div>
                <p>
                  «+» — больше деталей. «−» — шире картина.
                  <br />
                  Листайте книгу на выбранном уровне.
                </p>
              </div>
              {authors.length > 0 && (
                <div className="saved-authors">
                  {authors.map((a) => (
                    <button key={a.id} onClick={() => navigateAuthor(a)}>
                      <span>
                        {a.name
                          .split(' ')
                          .map((s) => s[0])
                          .slice(0, 2)
                          .join('')}
                      </span>
                      <div>
                        <strong>{a.name}</strong>
                        <small>{a.works.length} произведений</small>
                      </div>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </div>
              )}
              {books.length > 0 && (
                <div className="your-shelf">
                  {[...books]
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .map((b) => (
                      <button
                        className="shelf-book"
                        key={b.id}
                        onClick={() =>
                          navigate(b.id, b.currentNode, b.currentLevel, false, b.currentAnchor)
                        }
                      >
                        <span className="shelf-cover">
                          <span>{b.author || 'Книга'}</span>
                          <strong>{b.title}</strong>
                          <BookOpen size={24} />
                        </span>
                        <span className="shelf-detail">
                          <strong>{b.title}</strong>
                          <span>
                            {b.nodes[b.currentNode]?.title === b.title
                              ? 'Общая картина'
                              : b.nodes[b.currentNode]?.title}
                          </span>
                          <small>{Object.keys(b.analyses).length} разборов сохранено</small>
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </section>
            {guide && (
              <section className="results-section">
                <div className="section-heading">
                  <h2>{guide.title}</h2>
                  <span>Маршрут чтения</span>
                </div>
                <p className="route-intro">{guide.intro}</p>
                <p className="subtle-note">
                  Ориентировка по знаниям модели. Точный разбор появится после загрузки текста.
                </p>
                <div className="work-list">
                  {guide.works.map((work, i) => (
                    <button
                      className="work-row"
                      key={`${work.title}-${i}`}
                      disabled={!!busy}
                      onClick={() => void openWork(work)}
                    >
                      <span className="work-number">{i + 1}</span>
                      <div>
                        <div className="work-title">
                          <h3>{work.title}</h3>
                          <Rating value={work.importance} />
                        </div>
                        <small>{work.author}</small>
                        <p>{work.reason}</p>
                        <span className="text-action">
                          Найти и открыть текст <ChevronRight size={14} />
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {sources && (
              <section className="results-section">
                <div className="section-heading">
                  <h2>Тексты по запросу «{sourceQuery}»</h2>
                  <span>{sources.length} найдено</span>
                </div>
                {sources.length ? (
                  <div className="source-list">
                    {sources.map((s) => (
                      <button
                        className="source-row"
                        disabled={!!busy}
                        key={s.url}
                        onClick={() =>
                          void run('Загружаю текст книги…', async () =>
                            addBook(await api('import/url', { url: s.url, title: s.title })),
                          )
                        }
                      >
                        <FileText size={19} />
                        <div>
                          <h3>{s.title}</h3>
                          <p>{s.snippet}</p>
                          <small>{s.source}</small>
                        </div>
                        <ArrowDown size={18} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="not-found">
                    <h3>Открытый текст не найден</h3>
                    <p>
                      Попробуйте точное название. Если у вас есть книга, добавьте ссылку на текст
                      или файл.
                    </p>
                    <button className="secondary" onClick={() => setModal('import')}>
                      <Plus size={16} />
                      Добавить книгу
                    </button>
                  </div>
                )}
                <p className="subtle-note">
                  Поиск по Викитеке. Другие источники можно добавить по ссылке.
                </p>
              </section>
            )}
            {!guide && !sources && (
              <section className="starter-section book-catalog">
                <div className="section-heading">
                  <h2>{authors.length ? 'Другие авторы' : 'Начните с автора'}</h2>
                  <button className="text-button" onClick={() => setModal('find')}>
                    Найти автора
                  </button>
                </div>
                <div className="catalog-books">
                  {[
                    {
                      title: 'Государство и революция',
                      author: 'Владимир Ленин',
                      theme: 'Власть и устройство общества',
                      color: 'indigo',
                      query: 'Государство и революция',
                    },
                    {
                      title: 'Наедине с собой',
                      author: 'Марк Аврелий',
                      theme: 'Стоицизм и внутренняя свобода',
                      color: 'green',
                      query: 'Наедине с собой',
                    },
                    {
                      title: 'Государь',
                      author: 'Никколо Макиавелли',
                      theme: 'Природа политической власти',
                      color: 'rose',
                      query: 'Государь Макиавелли',
                    },
                  ].map((b) => (
                    <button
                      className={`catalog-book ${b.color}`}
                      key={b.title}
                      disabled={!!busy}
                      onClick={() => void openAuthor(b.author)}
                    >
                      <span className="catalog-cover">
                        <small>{b.title}</small>
                        <strong>{b.author}</strong>
                        <span className="cover-rule" />
                        <BookOpen size={21} />
                      </span>
                      <span className="catalog-theme">{b.theme}</span>
                      <span className="catalog-open">
                        Карта автора <ChevronRight size={13} />
                      </span>
                    </button>
                  ))}
                </div>
                <div className="own-book-row">
                  <span>Своя книга?</span>
                  <button
                    onClick={() => {
                      setImportTitle('');
                      setModal('import');
                    }}
                  >
                    <LinkIcon size={14} />
                    Добавить по ссылке
                  </button>
                  <button
                    onClick={() => {
                      setImportTitle('');
                      fileInput.current?.click();
                    }}
                  >
                    <Upload size={14} />
                    Загрузить файл
                  </button>
                </div>
              </section>
            )}
            <footer className="home-footer">
              <span>Книга — это пространство для мысли.</span>
              <span>Двигайтесь в любом направлении.</span>
            </footer>
          </>
        ) : node ? (
          <>
            <nav className="breadcrumbs" aria-label="Путь в книге">
              <button onClick={() => navigate()} aria-label="Библиотека">
                <Library size={16} />
              </button>
              {active.author && (
                <span>
                  <ChevronRight size={14} />
                  <button
                    onClick={() =>
                      parentAuthor ? navigateAuthor(parentAuthor) : void openAuthor(active.author)
                    }
                  >
                    {active.author}
                  </button>
                </span>
              )}
              {path.map((n, i) => (
                <span key={n.id}>
                  <ChevronRight size={14} />
                  <button
                    aria-current={i === path.length - 1 ? 'page' : undefined}
                    onClick={() => navigate(active.id, n.id)}
                  >
                    {i === 0
                      ? active.title
                      : active.analyses[n.parent || '']?.children.find((c) => c.id === n.id)
                          ?.title || n.title}
                  </button>
                </span>
              ))}
            </nav>
            <article className="reading-area">
              <div className="semantic-location">
                <span>{levelLabel}</span>
                <span>
                  Страница {pageIndex + 1} из {pageCount} на этом уровне
                </span>
              </div>
              <div className="book-context">
                {active.author || 'Ваша книга'}
                <span>{node.id === 'root' ? 'Общая картина' : `Глубина ${path.length - 1}`}</span>
              </div>
              <h1 className="reading-title">
                {node.id !== 'root'
                  ? active.analyses[node.parent || '']?.children.find((c) => c.id === node.id)
                      ?.title || node.title
                  : active.title}
              </h1>
              <div className="reading-meta">
                <span>
                  {readingMinutes(active.paragraphs.slice(node.start, node.end))} мин оригинала
                </span>
                <span>{node.end - node.start} абзацев</span>
                {analysis && (
                  <span className="saved-mark">
                    <Check size={13} />
                    Разбор сохранён
                  </span>
                )}
              </div>
              {active.warnings.map((w) => (
                <p key={w} className="source-warning">
                  {w}
                </p>
              ))}
              <div className="reading-toolbar">
                <div className="view-tabs" role="tablist" aria-label="Режим чтения">
                  <button
                    role="tab"
                    aria-selected={view === 'summary'}
                    className={view === 'summary' ? 'active' : ''}
                    onClick={() => setView('summary')}
                  >
                    <Layers size={16} />
                    Карта идей
                  </button>
                  <button
                    role="tab"
                    aria-selected={view === 'original'}
                    className={view === 'original' ? 'active' : ''}
                    onClick={() => setView('original')}
                  >
                    <FileText size={16} />
                    Оригинал
                  </button>
                </div>
                {view === 'summary' && analysis ? (
                  <Rating value={analysis.importance} />
                ) : view === 'original' ? (
                  <div className="font-controls">
                    <button
                      aria-label="Уменьшить шрифт"
                      disabled={fontSize <= 15}
                      onClick={() => setFontSize((s) => s - 1)}
                    >
                      А−
                    </button>
                    <button
                      aria-label="Увеличить шрифт"
                      disabled={fontSize >= 25}
                      onClick={() => setFontSize((s) => s + 1)}
                    >
                      А+
                    </button>
                  </div>
                ) : null}
                <button
                  className="ask-tool"
                  aria-label="Спросить о фрагменте"
                  onClick={() => setModal('question')}
                >
                  <MessageCircle size={15} />
                  <span>Спросить</span>
                </button>
              </div>
              {view === 'summary' ? (
                <>
                  {analysis ? (
                    <section className="analysis-content compact-analysis">
                      <div className="summary-text">
                        <p>{analysis.summary.split('\n').filter(Boolean)[0]}</p>
                      </div>
                      <details className="analysis-details">
                        <summary>Идеи, вклад и рекомендации к чтению</summary>
                        <div className="summary-text">
                          {analysis.summary
                            .split('\n')
                            .filter(Boolean)
                            .slice(1)
                            .map((p, i) => (
                              <p key={i}>{p}</p>
                            ))}
                        </div>
                        {analysis.ideas.length > 0 && (
                          <div className="key-ideas">
                            <h2>Что здесь главное</h2>
                            <ul>
                              {analysis.ideas.map((idea, i) => (
                                <li key={i}>{idea}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="reading-advice">
                          <div>
                            <h3>Зачем читать</h3>
                            <p>{analysis.why}</p>
                          </div>
                          {analysis.skip && (
                            <div>
                              <h3>Что можно пропустить</h3>
                              <p>{analysis.skip}</p>
                            </div>
                          )}
                        </div>
                      </details>
                      {analysis.coverage === 'sampled' && (
                        <p className="subtle-note">
                          Обзор большого раздела построен по выборке. Приблизьте текст для
                          подробного разбора.
                        </p>
                      )}
                    </section>
                  ) : (
                    <section className="unanalyzed">
                      <Layers size={25} />
                      <h2>{busy ? 'От текста к карте идей' : 'Увидеть общую картину'}</h2>
                      <p>
                        {busy
                          ? 'Разбор этого уровня появится здесь. Оригинал уже можно читать.'
                          : canAnalyze
                            ? 'Разбор создаётся при первом открытии и остаётся в вашей библиотеке.'
                            : 'Подключите DeepSeek, чтобы увидеть главные идеи и важность фрагментов.'}
                      </p>
                      <button
                        className="secondary"
                        disabled={!!busy}
                        onClick={() =>
                          canAnalyze
                            ? void run('Собираю карту идей…', () => analyzeNode(active, node.id))
                            : setModal('settings')
                        }
                      >
                        {canAnalyze ? 'Разобрать этот раздел' : 'Подключить DeepSeek'}
                      </button>
                    </section>
                  )}
                  {node.children.length > 0 && (
                    <section className="section-map">
                      <div className="section-heading">
                        <h2>{semanticLevel === 0 ? 'Карта книги' : 'Внутри этого фрагмента'}</h2>
                        {analysis && (
                          <button
                            className={`filter-button ${importantOnly ? 'active' : ''}`}
                            onClick={() => setImportantOnly(!importantOnly)}
                          >
                            {importantOnly && <Check size={13} />}Только главное
                          </button>
                        )}
                      </div>
                      <div className="depth-list">
                        {node.children
                          .filter(
                            (id) =>
                              !importantOnly ||
                              (analysis?.children.find((c) => c.id === id)?.importance || 0) >= 4,
                          )
                          .map((id, i) => {
                            const child = active.nodes[id];
                            const info = analysis?.children.find((c) => c.id === id);
                            return (
                              <button
                                key={id}
                                className="depth-row"
                                onClick={() => navigate(active.id, id)}
                              >
                                <span className="depth-index">
                                  {String(i + 1).padStart(2, '0')}
                                </span>
                                <div>
                                  <h3>{info?.title || child.title}</h3>
                                  {info?.summary && <p>{info.summary}</p>}
                                  <div className="depth-meta">
                                    <span>
                                      {readingMinutes(
                                        active.paragraphs.slice(child.start, child.end),
                                      )}{' '}
                                      мин
                                    </span>
                                    {info && <Rating value={info.importance} />}{' '}
                                    {active.analyses[id] && <Check size={12} />}
                                  </div>
                                </div>
                                <ChevronRight size={18} />
                              </button>
                            );
                          })}
                      </div>
                      {importantOnly &&
                        !node.children.some(
                          (id) =>
                            (analysis?.children.find((c) => c.id === id)?.importance || 0) >= 4,
                        ) && (
                          <p className="subtle-note">
                            На этом уровне нет фрагментов с важностью 4–5.{' '}
                            <button onClick={() => setImportantOnly(false)}>Показать все</button>
                          </p>
                        )}
                    </section>
                  )}
                  {node.end - node.start === 1 && (
                    <div className="leaf-note">
                      <Check size={16} />
                      Вы дошли до одного абзаца.{' '}
                      <button onClick={() => setView('original')}>Прочитать оригинал</button>
                    </div>
                  )}
                </>
              ) : (
                <section className="original-section">
                  <p className="original-hint">
                    Текст из источника, без пересказа. Выделите фразу, чтобы спросить о ней.
                  </p>
                  <div
                    className="original-text"
                    ref={originalRef}
                    style={{ fontSize }}
                    onMouseUp={selectQuote}
                    onTouchEnd={selectQuote}
                  >
                    {active.paragraphs
                      .slice(
                        node.start + originalPage * 6,
                        Math.min(node.start + (originalPage + 1) * 6, node.end),
                      )
                      .map((p, i) => (
                        <div
                          className="original-paragraph"
                          key={i}
                          id={`paragraph-${originalPage * 6 + i + 1}`}
                        >
                          <span className="paragraph-number">{originalPage * 6 + i + 1}</span>
                          <p>{p}</p>
                          <button
                            className="paragraph-question"
                            aria-label={`Задать вопрос по абзацу ${originalPage * 6 + i + 1}`}
                            onClick={() => {
                              setQuote(p.slice(0, 12000));
                              setModal('question');
                            }}
                          >
                            <MessageCircle size={15} />
                          </button>
                        </div>
                      ))}
                  </div>
                  {originalPages > 1 && (
                    <nav className="original-pagination" aria-label="Страницы оригинала">
                      <button
                        disabled={originalPage === 0}
                        onClick={() => {
                          setOriginalPage((p) => p - 1);
                          originalRef.current?.scrollIntoView({ block: 'start' });
                        }}
                      >
                        <ArrowLeft size={16} />
                        Назад
                      </button>
                      <span>
                        {originalPage + 1} / {originalPages}
                      </span>
                      <button
                        disabled={originalPage >= originalPages - 1}
                        onClick={() => {
                          setOriginalPage((p) => p + 1);
                          originalRef.current?.scrollIntoView({ block: 'start' });
                        }}
                      >
                        Дальше
                        <ArrowRight size={16} />
                      </button>
                    </nav>
                  )}
                  {quote && (
                    <div className="quote-action">
                      <span>Выбран фрагмент</span>
                      <button onClick={() => setModal('question')}>
                        <MessageCircle size={14} />
                        Спросить
                      </button>
                      <button aria-label="Убрать выделение" onClick={() => setQuote('')}>
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </section>
              )}
              <div className="source-credit">
                <FileText size={14} />
                <span>
                  Источник:{' '}
                  {safeLink(active.sourceUrl) ? (
                    <a href={safeLink(active.sourceUrl)} target="_blank" rel="noreferrer">
                      {active.sourceLabel || 'Открыть оригинал'}
                    </a>
                  ) : (
                    active.sourceLabel || 'загруженный файл'
                  )}
                  . Оценки и интерпретации AI могут быть неточны.
                </span>
              </div>
            </article>
            <nav className="semantic-dock" aria-label="Масштаб и страницы книги">
              <button
                className="page-step"
                aria-label="Предыдущая страница этого уровня"
                disabled={pageIndex <= 0}
                onClick={() => turnPage(-1)}
              >
                <ArrowLeft size={20} />
                <span>Назад</span>
              </button>
              <div className="zoom-control">
                <button
                  aria-label="Уменьшить глубину — более общий обзор"
                  title="Более общий обзор"
                  disabled={semanticLevel === 0 && !active.author}
                  onClick={() => zoom(-1)}
                >
                  −
                </button>
                <div>
                  <strong>{levelLabel}</strong>
                  <span>
                    {pageIndex + 1} / {pageCount}
                  </span>
                </div>
                <button
                  aria-label="Увеличить глубину — больше деталей"
                  title="Больше деталей"
                  disabled={node.end - node.start <= 1 || semanticLevel >= 12}
                  onClick={() => zoom(1)}
                >
                  +
                </button>
              </div>
              <button
                className="page-step"
                aria-label="Следующая страница этого уровня"
                disabled={pageIndex < 0 || pageIndex >= pageCount - 1}
                onClick={() => turnPage(1)}
              >
                <span>Дальше</span>
                <ArrowRight size={20} />
              </button>
            </nav>
          </>
        ) : (
          <div className="empty-state">
            <h1>Раздел не найден</h1>
            <button className="primary" onClick={() => navigate(active.id)}>
              К началу книги
            </button>
          </div>
        )}
      </main>
      <input
        className="hidden-input"
        ref={fileInput}
        type="file"
        accept=".txt,.md,.html,.htm,.epub,.fb2,.pdf"
        onChange={(e) => {
          void importFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        className="hidden-input"
        ref={restoreInput}
        type="file"
        accept=".json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          void run('Восстанавливаю библиотеку…', async () => {
            if (file.size > 50 * 1024 * 1024) throw new Error('Архив библиотеки превышает 50 МБ.');
            const data = JSON.parse(await file.text());
            if (data.version !== 1 || !Array.isArray(data.books) || !data.books.every(validBook))
              throw new Error('Это не архив библиотеки Figlet или он повреждён.');
            for (const b of data.books as Book[]) {
              if (!booksRef.current.some((x) => x.id === b.id)) {
                const normalized = normalizeBook(b);
                await storage.save(normalized);
                booksRef.current = [...booksRef.current, normalized];
              }
            }
            if (Array.isArray(data.authors)) {
              const restored = data.authors.filter(
                (a: Author) =>
                  typeof a.id === 'string' && typeof a.name === 'string' && Array.isArray(a.works),
              );
              for (const a of restored) await storage.saveAuthor(a);
              setAuthors((current) => [
                ...current.filter((a) => !restored.some((r: Author) => r.id === a.id)),
                ...restored,
              ]);
            }
            setBooks(booksRef.current);
            setNotice('Библиотека восстановлена.');
          });
        }}
      />
      {modal === 'find' && (
        <Modal title="Найти книгу" onClose={() => setModal(null)}>
          <p className="modal-copy">
            Найдите текст по названию или выберите автора, чтобы увидеть карту его произведений.
          </p>
          <form
            className="find-form"
            onSubmit={(e) => {
              e.preventDefault();
              setModal(null);
              void search();
            }}
          >
            <label className="field">
              Автор, название или интересующая тема
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ленин, Государь, стоицизм…"
                maxLength={500}
                autoFocus
              />
            </label>
            <div className="theme-options">
              <button
                type="button"
                className={searchMode === 'guide' ? 'selected' : ''}
                onClick={() => setSearchMode('guide')}
              >
                Карта произведений
              </button>
              <button
                type="button"
                className={searchMode === 'text' ? 'selected' : ''}
                onClick={() => setSearchMode('text')}
              >
                Точный текст
              </button>
            </div>
            <button className="primary full" disabled={!!busy || !query.trim()}>
              <Search size={16} />
              Найти
            </button>
          </form>
          <button className="text-button" onClick={() => setModal('import')}>
            У меня есть ссылка или файл
          </button>
        </Modal>
      )}
      {modal === 'import' && (
        <Modal title="Добавить книгу" onClose={() => setModal(null)}>
          <p className="modal-copy">
            Ссылка на страницу с полным текстом или файл с вашего устройства.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run('Загружаю и разбираю текст…', async () => {
                const book = await api('import/url', {
                  url,
                  title: importTitle,
                  author: importAuthor || activeAuthor?.name,
                });
                await addBook({ ...book, authorId: activeAuthor?.id });
              });
            }}
          >
            <label className="field">
              Ссылка на текст
              <input
                type="url"
                placeholder="https://…"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label className="field">
              Название <span>необязательно</span>
              <input
                value={importTitle}
                onChange={(e) => setImportTitle(e.target.value)}
                placeholder="Название книги"
                maxLength={300}
              />
            </label>
            <label className="field">
              Автор <span>необязательно</span>
              <input
                value={importAuthor || activeAuthor?.name || ''}
                onChange={(e) => setImportAuthor(e.target.value)}
                placeholder="Имя автора"
                maxLength={180}
              />
            </label>
            <button className="primary full" disabled={!!busy || !url.trim()}>
              <LinkIcon size={16} />
              Загрузить по ссылке
            </button>
          </form>
          <div className="or-divider">или</div>
          <button
            className="upload-area"
            disabled={!!busy}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void importFile(e.dataTransfer.files[0]);
            }}
          >
            <Upload size={25} />
            <strong>Выбрать файл</strong>
            <span>EPUB, FB2, PDF, TXT, Markdown, HTML · до 10 МБ</span>
          </button>
          <p className="subtle-note">
            Добавляйте тексты, которые можете законно читать. PDF-сканам требуется распознавание.
            Книга сохраняется только в вашем браузере.
          </p>
          {busy && (
            <p role="status" className="modal-copy">
              {busy}
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
      {modal === 'settings' && (
        <Modal title="Настройки" onClose={() => setModal(null)}>
          <section className="settings-section">
            <h3>Оформление</h3>
            <div className="theme-options">
              {[
                ['light', 'Светлая'],
                ['dark', 'Тёмная'],
                ['system', 'Как в системе'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={theme === value ? 'selected' : ''}
                  onClick={() => setTheme(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section className="settings-section">
            <h3>DeepSeek</h3>
            <p className="modal-copy">
              {config.sharedKey
                ? 'Подключён серверный ключ. Можно читать и задавать вопросы сразу.'
                : 'Добавьте личный ключ для разборов и вопросов по тексту.'}
            </p>
            <label className="field">
              {config.sharedKey ? 'Личный ключ (необязательно)' : 'API-ключ'}
              <input
                type="password"
                autoComplete="off"
                placeholder="sk-…"
                value={key}
                onChange={(e) => setKey(e.target.value.trim())}
              />
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={rememberKey}
                onChange={(e) => setRememberKey(e.target.checked)}
              />
              Помнить личный ключ до закрытия вкладки
            </label>
            <label className="field">
              Модель
              <input
                value={selectedModel}
                onChange={(e) => setModel(e.target.value)}
                list="deepseek-models"
                maxLength={100}
              />
              <datalist id="deepseek-models">
                {[...new Set([config.defaultModel, ...availableModels])].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() =>
                void run('Проверяю доступные модели…', async () => {
                  const data = await api('models');
                  setAvailableModels(data.models);
                  setNotice('Список моделей обновлён.');
                })
              }
            >
              Получить доступные модели
            </button>
            <p className="subtle-note">
              Текст текущего раздела отправляется DeepSeek для разбора. Ключ передаётся через сервер
              по HTTPS и не включается в архив библиотеки.
            </p>
          </section>
          <section className="settings-section">
            <h3>Ваша библиотека</h3>
            <p className="modal-copy">
              {books.length} книг на этом устройстве. Очистка данных сайта удалит книги и разборы.
              Экспортируйте библиотеку для переноса.
            </p>
            <div className="settings-actions">
              <button
                className="secondary"
                disabled={!books.length}
                onClick={() => {
                  const blob = new Blob([JSON.stringify({ version: 1, books, authors })], {
                    type: 'application/json',
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `figlet-library-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <Download size={16} />
                Экспорт
              </button>
              <button className="secondary" onClick={() => restoreInput.current?.click()}>
                <Upload size={16} />
                Импорт
              </button>
            </div>
            {active && (
              <button
                className="delete-book"
                onClick={() =>
                  void run('Удаляю книгу с устройства…', async () => {
                    await storage.remove(active.id);
                    booksRef.current = booksRef.current.filter((b) => b.id !== active.id);
                    setBooks(booksRef.current);
                    navigate();
                    setModal(null);
                    setNotice('Книга удалена из библиотеки этого устройства.');
                  })
                }
              >
                <Trash2 size={15} />
                Удалить «{active.title}»
              </button>
            )}
          </section>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary full" onClick={() => setModal(null)}>
            Готово
          </button>
        </Modal>
      )}
      {modal === 'question' && active && node && (
        <Modal title="Вопрос к фрагменту" onClose={() => setModal(null)}>
          <p className="question-context">{node.title}</p>
          <section className="question-section">
            {quote && (
              <div className="selected-quote">
                <blockquote>
                  {quote.slice(0, 450)}
                  {quote.length > 450 ? '…' : ''}
                </blockquote>
                <button
                  className="icon-button"
                  aria-label="Убрать выделение"
                  onClick={() => setQuote('')}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <form className="question-form" onSubmit={submitQuestion}>
              <label htmlFor="question-input" className="sr-only">
                Вопрос по разделу
              </label>
              <textarea
                id="question-input"
                placeholder={
                  quote ? 'Что хотите понять в этой фразе?' : 'Почему автор так считает?'
                }
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={2}
                maxLength={2000}
              />
              <button
                className="search-submit"
                aria-label="Задать вопрос"
                disabled={!!busy || !question.trim() || !canAnalyze}
              >
                <ArrowUp size={18} />
              </button>
            </form>
            <p className="subtle-note">
              {quote
                ? 'Ответ будет учитывать выделенный фрагмент.'
                : 'Вопрос относится к текущему разделу.'}{' '}
              {!canAnalyze && (
                <button onClick={() => setModal('settings')}>Подключить DeepSeek</button>
              )}
            </p>
            {(active.answers[node.id] || []).map((a, i) => (
              <div className="answer" key={i}>
                <h3>{a.question}</h3>
                {a.quote && (
                  <blockquote>
                    {a.quote.slice(0, 250)}
                    {a.quote.length > 250 ? '…' : ''}
                  </blockquote>
                )}
                {a.answer
                  .split('\n')
                  .filter(Boolean)
                  .map((p, j) => (
                    <p key={j}>{p}</p>
                  ))}
              </div>
            ))}
          </section>
          {busy && (
            <p className="modal-copy" role="status">
              {busy}
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
      {modal === 'about' && (
        <Modal title="Читайте в своём масштабе" onClose={() => setModal(null)}>
          <div className="about-content">
            <p>Figlet помогает найти в книге то, что важно именно вам.</p>
            <ol>
              <li>
                <strong>Выберите направление.</strong> Спросите об авторе или найдите конкретную
                книгу.
              </li>
              <li>
                <strong>Посмотрите на общую картину.</strong> Узнайте главную мысль и роль каждого
                раздела.
              </li>
              <li>
                <strong>Углубляйтесь.</strong> Открывайте интересные разделы, пока не дойдёте до
                отдельного абзаца.
              </li>
              <li>
                <strong>Сверяйтесь с текстом.</strong> Переключитесь на оригинал, выделите фразу и
                задайте вопрос.
              </li>
            </ol>
            <p>
              Разбор появляется при первом открытии уровня и сохраняется. Путь сверху и кнопки снизу
              помогают двигаться в любую сторону.
            </p>
            <p className="subtle-note">
              Важность — субъективная оценка модели. Проверяйте спорные выводы по оригиналу.
              Библиотека хранится в браузере; экспорт позволяет перенести её на другое устройство.
            </p>
          </div>
          <button className="primary full" onClick={() => setModal(null)}>
            Начать читать
          </button>
        </Modal>
      )}
    </div>
  );
}
