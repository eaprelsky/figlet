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
  CreditCard,
  Download,
  FileText,
  Layers,
  Library,
  Link as LinkIcon,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  Upload,
  User,
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
import { readLang, setLang, t, type Lang } from './i18n';

type Source = { title: string; url: string; snippet: string; source: string };
type Work = { title: string; author: string; reason: string; importance: number; query: string };
type Route = { title: string; intro: string; works: Work[] };
type Author = Route & { id: string; name: string; currentWork?: string };
type Account = { login: string; isAdmin?: boolean };
type Subscription = { until?: number; expired?: number };
type Quota = {
  used: number;
  limit: number;
  subscription: Subscription | null;
};
type Config = {
  sharedKey: boolean;
  defaultModel: string;
  providerName?: string;
  sharedLibrary?: boolean;
  freeBooksPerWeek?: number;
  subscription?: { enabled: boolean; price: number; days: number };
};
type Suggestion = {
  title: string;
  author: string;
  confidence: number;
  reason?: string;
  applied?: boolean;
};
type BookMetaDraft = {
  bookId: string;
  title: string;
  author: string;
  suggestion?: Suggestion | null;
  replace?: Book | null;
};
type LibraryBook = {
  id: string;
  title: string;
  author: string;
  sourceUrl: string;
  paragraphs: number;
  editions?: number;
};
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
  if (kind === 'billing')
    return {
      authorId: '',
      bookId: '',
      nodeId: '',
      level: 0,
      anchor: 0,
      payment: new URLSearchParams(search).get('payment') || '',
      billing: true,
    };
  if (kind === 'author')
    return {
      bookId: '',
      nodeId: '',
      level: -1,
      anchor: 0,
      payment: '',
      authorId: decodeURIComponent(bookId || ''),
    };
  return kind === 'book'
    ? {
        authorId: '',
        anchor: Number(new URLSearchParams(search).get('at') || 0),
        bookId: decodeURIComponent(bookId || ''),
        nodeId: decodeURIComponent(nodeId || 'root'),
        level: Math.max(0, Math.min(12, Number(new URLSearchParams(search).get('level') || 0))),
        payment: '',
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
      title={`${t('Важность')} ${value} ${t('из 5 — оценка модели')}`}
      aria-label={`${t('Важность')} ${value} ${t('из 5 — оценка модели')}`}
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
        <button className="icon-button" aria-label={t("Закрыть")} onClick={onClose}>
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
    defaultModel: 'deepseek-flash',
  });
  const [model, setModel] = useState(decodeURIComponent(getCookie('figlet_model') || ''));
  const [key, setKey] = useState(() => sessionStorage.getItem('figlet_key') || '');
  const [rememberKey, setRememberKey] = useState(!!sessionStorage.getItem('figlet_key'));
  const [theme, setTheme] = useState(decodeURIComponent(getCookie('figlet_theme') || 'system'));
  const [lang, setLangState] = useState<Lang>(readLang);
  // Module-level t() must reflect the new locale in this very render, not in an effect.
  setLang(lang);
  const [route, setRoute] = useState(readRoute);
  const [sidebar, setSidebar] = useState(false);
  const [modal, setModal] = useState<
    | 'settings'
    | 'import'
    | 'about'
    | 'question'
    | 'find'
    | 'account'
    | 'bookMeta'
    | 'deleteBook'
    | null
  >(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [authLogin, setAuthLogin] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [aiProvider, setAiProvider] = useState<'openai' | 'anthropic' | ''>(
    (sessionStorage.getItem('figlet_provider') as 'openai' | 'anthropic' | null) || '',
  );
  const [aiBaseUrl, setAiBaseUrl] = useState(sessionStorage.getItem('figlet_baseurl') || '');
  const [bookMeta, setBookMeta] = useState<BookMetaDraft | null>(null);
  const [metaFile, setMetaFile] = useState<File | null>(null);
  const [indexProgress, setIndexProgress] = useState<
    { status: string; done: number; total: number; error?: string } | null
  >(null);
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
  const libraryAttempts = useRef(new Set<string>());
  const [sharedBooks, setSharedBooks] = useState<LibraryBook[]>([]);
  const [libraryLoading, setLibraryLoading] = useState('');
  const [analysisFailures, setAnalysisFailures] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const metaInput = useRef<HTMLInputElement>(null);
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
  const analysisKey = `${active?.id}:${node?.id}:${selectedModel}`;
  const analysisFailure = analysisFailures[analysisKey];
  const parentAnalysis = active?.analyses[node?.parent || ''];
  const inheritedSummary =
    parentAnalysis?.model === selectedModel
      ? parentAnalysis.children.find((child) => child.id === node?.id)?.summary
      : undefined;
  const mapComplete =
    analysis &&
    node?.children.every((id) =>
      analysis.children.some((child) => child.id === id && child.summary.trim()),
    );
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
          t("Не удалось сохранить книгу в браузере. Освободите место или экспортируйте библиотеку."),
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
      setNotice(t("Эта книга уже есть в библиотеке. Открыта сохранённая версия."));
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
    // Build the whole-book map in the background: current view first, then by importance.
    requestIndex(expanded.id, 'root');
  }
  function requestIndex(bookId: string, current: string) {
    void api('index', { bookId, current }).catch(() => {});
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
      setNotice(t("Подключите DeepSeek для карты автора."));
      return;
    }
    await run(t("Собираю карту автора и его произведений…"), async () => {
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
    if (aiProvider && aiBaseUrl) {
      headers['x-ai-provider'] = aiProvider;
      headers['x-ai-base-url'] = aiBaseUrl;
    }
    const isForm = body instanceof FormData;
    if (body && !isForm) headers['Content-Type'] = 'application/json';
    const result = await fetch(`/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body
        ? isForm
          ? (body as FormData)
          : JSON.stringify({ lang, ...(body as object), model: selectedModel })
        : undefined,
      signal: AbortSignal.timeout(125000),
    });
    let data;
    try {
      data = await result.json();
    } catch {
      throw new Error(t('Сервер не ответил. Проверьте подключение и повторите запрос.'));
    }
    if (!result.ok) {
      if (result.status === 402 && data?.code === 'book-quota') {
        setModal('settings');
        void refreshQuota();
      }
      throw new Error(data.error || t('Не удалось выполнить запрос.'));
    }
    return data;
  }
  function refreshQuota() {
    return fetch('/api/quota')
      .then((r) => r.json())
      .then(setQuota)
      .catch(() => {});
  }
  async function del(path: string) {
    const result = await fetch(`/api/${path}`, {
      method: 'DELETE',
      headers: key ? { 'x-deepseek-key': key } : undefined,
    });
    if (!result.ok) {
      const data = await result.json().catch(() => ({}));
      throw new Error(data.error || t('Не удалось выполнить запрос.'));
    }
    return result.json().catch(() => ({}));
  }
  async function subscribe() {
    await run(t("Создаю платёж…"), async () => {
      const data = await api('billing/checkout');
      if (!data.confirmationUrl) throw new Error(t('Не удалось создать платёж.'));
      sessionStorage.setItem('figlet_payment', data.paymentId);
      location.href = data.confirmationUrl;
    });
  }
  // Confirm recognised metadata, rename a book, or re-import a file under a new name.
  async function saveBookMeta() {
    if (!bookMeta) return;
    const { bookId, title, author, replace } = bookMeta;
    await run(t("Сохраняю название и автора…"), async () => {
      if (metaFile) {
        const data = new FormData();
        data.append('file', metaFile);
        data.append('title', title);
        if (author) data.append('author', author);
        const book: Book = await api('import/file', data);
        await addBook({ ...book, title, author, authorId: activeAuthor?.id });
        if (book.id !== bookId && booksRef.current.some((b) => b.id === bookId)) {
          await storage.remove(bookId);
          booksRef.current = booksRef.current.filter((b) => b.id !== bookId);
          setBooks(booksRef.current);
        }
      } else if (replace) {
        await api(`library/${encodeURIComponent(bookId)}/rename`, { title, author });
        await addBook({ ...replace, title, author, authorId: activeAuthor?.id });
      } else {
        await api(`library/${encodeURIComponent(bookId)}/rename`, { title, author });
        updateBook(bookId, (b) => ({ ...b, title, author, updatedAt: Date.now() }));
      }
      setBookMeta(null);
      setMetaFile(null);
      setModal(null);
      setNotice(t("Название и автор сохранены."));
    });
  }
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    setError('');
    setNotice('');
    setBusy(label);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Не удалось выполнить действие.'));
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
          t("Хранилище браузера недоступно. Разрешите локальное хранение данных для библиотеки."),
        );
      });
    fetch('/api/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch(() =>
        setError(t("Нет соединения с сервером. Сохранённые книги можно продолжать читать.")),
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
  // Language: cookie for the server (errors, AI answers), <html lang> for the browser.
  function changeLang(next: Lang) {
    setLangState(next);
  }
  useEffect(() => {
    setCookie('figlet_lang', lang);
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    if (rememberKey && key) sessionStorage.setItem('figlet_key', key);
    else sessionStorage.removeItem('figlet_key');
  }, [key, rememberKey]);
  useEffect(() => {
    if (aiProvider) sessionStorage.setItem('figlet_provider', aiProvider);
    else sessionStorage.removeItem('figlet_provider');
  }, [aiProvider]);
  useEffect(() => {
    if (aiBaseUrl) sessionStorage.setItem('figlet_baseurl', aiBaseUrl);
    else sessionStorage.removeItem('figlet_baseurl');
  }, [aiBaseUrl]);
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
      bookId: book.id,
      nodeId,
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
  async function loadAnalysis(book: Book, nodeId: string) {
    const id = `${book.id}:${nodeId}:${selectedModel}`;
    setAnalysisFailures((current) => ({ ...current, [id]: '' }));
    await run(t("Читаю раздел и собираю карту идей…"), async () => {
      try {
        await analyzeNode(book, nodeId);
      } catch (e) {
        setAnalysisFailures((current) => ({
          ...current,
          [id]: e instanceof Error ? e.message : t('Не удалось загрузить разбор.'),
        }));
        throw e;
      }
    });
  }
  useEffect(() => {
    if (!active || !node || !canAnalyze || mapComplete || busy || view !== 'summary') return;
    const id = `${active.id}:${node.id}:${selectedModel}`;
    if (attempts.current.has(id)) return;
    attempts.current.add(id);
    void loadAnalysis(active, node.id);
  }, [active?.id, node?.id, canAnalyze, selectedModel, mapComplete, busy, view]);
  // Whole-book map: poll the background indexer and merge whatever is ready.
  useEffect(() => {
    setIndexProgress(null);
    if (!active) return;
    let stopped = false;
    let lastStatus = '';
    const poll = async () => {
      if (stopped || document.hidden) return;
      try {
        const data = await api(`index/${active.id}?model=${encodeURIComponent(selectedModel)}`);
        if (stopped) return;
        lastStatus = data.status;
        setIndexProgress(data);
        const remote = data.analyses || {};
        updateBook(active.id, (b) => {
          let changed = false;
          const analyses = { ...b.analyses };
          for (const [nodeId, value] of Object.entries<any>(remote)) {
            if (
              value &&
              (!analyses[nodeId] || (analyses[nodeId].createdAt || 0) < (value.createdAt || 0))
            ) {
              analyses[nodeId] = value;
              changed = true;
            }
          }
          return changed ? { ...b, analyses } : b;
        });
      } catch {
        /* offline or old server: lazy analysis still works */
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (['done', 'failed', 'idle'].includes(lastStatus)) return;
      void poll();
    }, 5000);
    const onVisible = () => {
      if (!document.hidden && !['done', 'failed', 'idle'].includes(lastStatus)) void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active?.id, selectedModel]);
  useEffect(() => {
    if (!active || !node) return;
    // Idle/paused jobs get a nudge pointing at what the reader opened right now.
    if (indexProgress && !['idle', 'paused', 'failed'].includes(indexProgress.status)) return;
    requestIndex(active.id, node.id);
  }, [active?.id, node?.id, indexProgress?.status]);
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        setAccount(data.user || null);
        setQuota({
          used: data.used,
          limit: data.limit,
          subscription: data.subscription || null,
        });
      })
      .catch(() => {});
  }, []);
  // Returning from the payment page: confirm and show the subscription state.
  useEffect(() => {
    if (!route?.payment && location.hash.slice(0, 9) !== '#/billing') return;
    const paymentId =
      route?.payment || sessionStorage.getItem('figlet_payment') || '';
    if (!paymentId) return;
    let stopped = false;
    const confirm = async (attempt: number) => {
      try {
        const data = await api(`billing/status?payment_id=${encodeURIComponent(paymentId)}`);
        if (stopped) return;
        if (data.status === 'succeeded') {
          sessionStorage.removeItem('figlet_payment');
          setNotice(t("Подписка активна. Спасибо!"));
          void refreshQuota();
          navigate();
          return;
        }
        if (attempt < 5) setTimeout(() => void confirm(attempt + 1), 2500);
        else {
          setNotice(
            data.status === 'pending'
              ? t('Платёж ещё подтверждается. Обновите страницу через минуту.')
              : t('Платёж не завершён. Попробуйте ещё раз.'),
          );
          navigate();
        }
      } catch {
        if (attempt < 2) setTimeout(() => void confirm(attempt + 1), 2500);
        else {
          navigate();
        }
      }
    };
    void confirm(0);
    return () => {
      stopped = true;
    };
  }, [route?.payment]);
  useEffect(() => {
    if (config.sharedLibrary)
      void api('library')
        .then((data) => setSharedBooks(data.books))
        .catch(() => {});
  }, [config.sharedLibrary]);
  useEffect(() => {
    if (!loaded || !config.sharedLibrary || !route?.bookId) return;
    const id = route.bookId;
    if (libraryAttempts.current.has(id)) return;
    libraryAttempts.current.add(id);
    if (!active) {
      setLibraryLoading(id);
      void api(`library/${encodeURIComponent(id)}`)
        .then(async (book) => {
          const normalized = frontierAt(normalizeBook(book), route.level).book;
          const restoredId = resolveNodeId(normalized, route.nodeId);
          if (normalized.nodes[restoredId]) {
            normalized.currentNode = restoredId;
            normalized.currentLevel = route.level;
            normalized.currentAnchor = route.anchor;
          }
          await storage.save(normalized);
          booksRef.current = [...booksRef.current.filter((b) => b.id !== id), normalized];
          setBooks(booksRef.current);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLibraryLoading(''));
    } else if (active.sourceUrl) {
      // Re-fetch public originals rather than trusting client-supplied library documents.
      void api(`library/${encodeURIComponent(id)}`)
        .catch(() =>
          api('import/url', { url: active.sourceUrl, title: active.title, author: active.author }),
        )
        .then(() => api('library'))
        .then((data) => setSharedBooks(data.books))
        .catch(() => {});
    }
  }, [loaded, config.sharedLibrary, route?.bookId, active?.id]);

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
        ? t('Составляю маршрут чтения…')
        : t('Ищу текст в открытой библиотеке…'),
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
    await run(t("Ищу полный текст книги…"), async () => {
      if (config.sharedLibrary) {
        const library = await api(`library?q=${encodeURIComponent(work.title)}`);
        const saved = library.books.find(
          (b: LibraryBook) =>
            b.title.toLowerCase() === work.title.toLowerCase() &&
            b.author.toLowerCase() === work.author.toLowerCase(),
        );
        if (saved) {
          await addBook({ ...(await api(`library/${saved.id}`)), authorId: owner?.id });
          return;
        }
      }
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
      setError(t("Файл слишком большой. Максимум — 10 МБ."));
      return;
    }
    await run(t("Извлекаю текст и определяю книгу…"), async () => {
      const data = new FormData();
      data.append('file', file);
      if (importTitle) data.append('title', importTitle);
      const book = (await api('import/file', data)) as Book & { suggestion?: Suggestion | null };
      // Unrecognised books ask the reader before entering the catalog under a filename.
      if (book.suggestion && !book.suggestion.applied) {
        setBookMeta({
          bookId: book.id,
          title: book.suggestion.title || book.title,
          author: book.suggestion.author || importAuthor || activeAuthor?.name || book.author,
          suggestion: book.suggestion,
          replace: book,
        });
        setModal('bookMeta');
        return;
      }
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
      setNotice(t("Ответ на этот вопрос уже сохранён ниже."));
      setQuestion('');
      return;
    }
    await run(t("Ищу ответ в тексте…"), async () => {
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
      ? t('Вся книга')
      : node && node.end - node.start === 1
        ? t('Абзацы')
        : [t('Вся книга'), t('Главы'), t('Разделы'), t('Фрагменты')][semanticLevel] || t('Малые фрагменты');
  const originalPages = node ? Math.ceil((node.end - node.start) / 6) : 1;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">{t("К содержанию")}</a>
      <header className="topbar">
        <div className="brand-group">
          <button
            className="icon-button mobile-menu"
            aria-label={t("Открыть библиотеку")}
            onClick={() => setSidebar(true)}
          >
            <Menu size={21} />
          </button>
          <a href="#/" className="brand" onClick={() => navigate()}>
            figlet<span className="brand-dot">.</span>
          </a>
          <span className="brand-note">{t("читать вглубь")}</span>
        </div>
        <div className="top-actions">
          <span className="local-indicator">
            <span />{t("Ваша личная библиотека")}</span>
          <button
            className="icon-button account-chip"
            aria-label={account ? `${t('Аккаунт')}: ${account.login}` : t('Войти в аккаунт')}
            title={account ? account.login : t('Войти (необязательно)')}
            onClick={() => {
              setAuthTab('login');
              setModal('account');
            }}
          >
            <User size={19} />
            {account && <span className="account-name">{account.login}</span>}
          </button>
          <button
            className="icon-button"
            aria-label={t("Переключить тему")}
            title={t("Переключить тему")}
            onClick={() =>
              setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
            }
          >
            {theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          <button
            className="icon-button"
            aria-label={t("Настройки")}
            title={t("Настройки")}
            onClick={() => {
              void refreshQuota();
              setModal('settings');
            }}
          >
            <Settings size={20} />
          </button>
        </div>
      </header>
      {sidebar && (
        <button
          className="sidebar-backdrop"
          aria-label={t("Закрыть библиотеку")}
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={`sidebar ${sidebar ? 'is-open' : ''}`}>
        <button className={`nav-item ${!active ? 'selected' : ''}`} onClick={() => navigate()}>
          <Search size={18} />{t("Найти книгу")}</button>
        {authors.length > 0 && (
          <nav className="author-nav" aria-label={t("Мои авторы")}>
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
          <span>{t("Мои книги")}</span>
          <span>{books.length}</span>
        </div>
        <nav aria-label={t("Библиотека")}>
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
          <p className="sidebar-empty">{t("Здесь появятся книги,")}<br />{t("к которым захочется вернуться.")}</p>
        )}
        <button
          className="add-book"
          onClick={() => {
            setImportTitle('');
            setModal('import');
            setSidebar(false);
          }}
        >
          <Plus size={17} />{t("Добавить свою книгу")}</button>
        {active && (
          <nav className="book-outline" aria-label={t("Оглавление книги")}>
            <p>{t("Оглавление")}</p>
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
            <Layers size={15} />{t("Разборы сохраняются")}<br />
            <span>{t("на сервере и на устройстве")}</span>
          </p>
          <button onClick={() => setModal('about')}>
            <CircleHelp size={16} />{t("Как читать в Figlet")}</button>
          <a href="https://github.com/eaprelsky/figlet" target="_blank" rel="noreferrer">{t("Открытый исходный код")}<ArrowUp size={13} className="diagonal" />
          </a>
        </div>
      </aside>
      <main id="main" className={active || activeAuthor ? 'main reader-main' : 'main'}>
        {error && (
          <div className="alert error" role="alert">
            <span>{error}</span>
            <button className="icon-button" aria-label={t("Скрыть ошибку")} onClick={() => setError('')}>
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
            <LoaderCircle className="spin" />{t("Открываю библиотеку…")}</div>
        ) : route && !active && !activeAuthor ? (
          <div className="empty-state">
            {route.payment || location.hash.slice(0, 9) === '#/billing' ? (
              <>
                <LoaderCircle className="spin" size={36} />
                <h1>{t("Подтверждаю платёж…")}</h1>
                <p>{t("Проверяю статус в платёжном сервисе. Это займёт несколько секунд.")}</p>
              </>
            ) : (
              <>
                <BookOpen size={36} />
                <h1>
                  {libraryLoading === route.bookId
                    ? t('Открываю книгу с сервера…')
                    : t('Книга пока недоступна')}
                </h1>
                <p>
                  {libraryLoading === route.bookId
                    ? t('Загружаю оригинал и структуру из общей библиотеки.')
                    : t('Найдите книгу в общей библиотеке или добавьте её по ссылке или из файла.')}
                </p>
                <button className="primary" onClick={() => navigate()}>{t("Найти книгу")}</button>
              </>
            )}
          </div>
        ) : activeAuthor ? (
          <>
            <nav className="breadcrumbs" aria-label={t("Путь к автору")}>
              <button onClick={() => navigate()}>
                <Library size={16} />
              </button>
              <ChevronRight size={14} />
              <span>{activeAuthor.name}</span>
            </nav>
            <article className="reading-area author-page">
              <div className="semantic-location">
                <span>{t("Автор")}</span>
                <span>{activeAuthor.works.length}{' '}{t("произведений на карте")}</span>
              </div>
              <h1 className="reading-title">{activeAuthor.name}</h1>
              <p className="author-intro">{activeAuthor.intro}</p>
              <p className="subtle-note">{t("Карта по знаниям модели. Разбор произведений строится по загруженному оригиналу.")}</p>
              <section className="author-works">
                <div className="section-heading">
                  <h2>{t("Карта произведений")}</h2>
                  <span>{t("В рекомендуемом порядке чтения")}</span>
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
                            ? t('В вашей библиотеке')
                            : t('Открыть книгу')}
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
                  <Plus size={16} />{t("Добавить произведение")}</button>
              </div>
            </article>
            <nav className="semantic-dock" aria-label={t("Масштаб и страницы автора")}>
              <button
                className="page-step"
                aria-label={t("Предыдущий автор")}
                disabled={authors.indexOf(activeAuthor) <= 0}
                onClick={() => navigateAuthor(authors[authors.indexOf(activeAuthor) - 1])}
              >
                <ArrowLeft size={20} />
                <span>{t("Назад")}</span>
              </button>
              <div className="zoom-control">
                <button aria-label={t("Самый общий уровень — автор")} disabled>
                  −
                </button>
                <div>
                  <strong>{t("Автор")}</strong>
                  <span>
                    {authors.indexOf(activeAuthor) + 1} / {authors.length}
                  </span>
                </div>
                <button
                  aria-label={t("Приблизить — открыть произведение")}
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
                aria-label={t("Следующий автор")}
                disabled={authors.indexOf(activeAuthor) >= authors.length - 1}
                onClick={() => navigateAuthor(authors[authors.indexOf(activeAuthor) + 1])}
              >
                <span>{t("Дальше")}</span>
                <ArrowRight size={20} />
              </button>
            </nav>
          </>
        ) : !active ? (
          <>
            <section className="library-home">
              <div className="library-home-title">
                <div>
                  <h1>{t("Авторы и идеи")}</h1>
                  <p>{t("От наследия автора — к одной важной мысли.")}</p>
                </div>
                <button className="primary" onClick={() => setModal('find')}>
                  <Plus size={17} />{t("Найти книгу")}</button>
              </div>
              <div className="scale-introduction">
                <div className="scale-caption">
                  <Layers size={17} />
                  <span>{t("Выбирайте глубину чтения")}</span>
                </div>
                <div className="scale-preview">
                  <span className="scale-author">{t("Автор")}</span>
                  <ChevronRight size={15} />
                  <span className="scale-book">{t("Книги")}</span>
                  <ChevronRight size={15} />
                  <span className="scale-chapter">{t("Главы")}</span>
                  <ChevronRight size={15} />
                  <span className="scale-fragment">{t("Фрагменты")}</span>
                  <ChevronRight size={15} />
                  <span className="scale-paragraph">{t("Абзацы")}</span>
                </div>
                <p>{t("«+» — больше деталей. «−» — шире картина.")}<br />{t("Листайте книгу на выбранном уровне.")}</p>
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
                        <small>{a.works.length}{' '}{t("произведений")}</small>
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
                          <span>{b.author || t('Книга')}</span>
                          <strong>{b.title}</strong>
                          <BookOpen size={24} />
                        </span>
                        <span className="shelf-detail">
                          <strong>{b.title}</strong>
                          <span>
                            {b.nodes[b.currentNode]?.title === b.title
                              ? t('Общая картина')
                              : b.nodes[b.currentNode]?.title}
                          </span>
                          <small>{Object.keys(b.analyses).length}{' '}{t("разборов сохранено")}</small>
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </section>
            {sharedBooks.length > 0 && (
              <section className="results-section">
                <div className="section-heading">
                  <h2>{t("Общая библиотека")}</h2>
                  <span>{sharedBooks.length}{' '}{t("книг")}</span>
                </div>
                <p className="subtle-note">{t("Книги из открытых источников. Готовые разборы общие для всех читателей.")}</p>
                <div className="work-list">
                  {sharedBooks.map((b) => (
                    <button
                      className="work-row"
                      key={b.id}
                      disabled={!!busy}
                      onClick={() =>
                        void run(t("Открываю книгу из общей библиотеки…"), async () => {
                          await addBook(await api(`library/${b.id}`));
                        })
                      }
                    >
                      <BookOpen size={20} />
                      <div>
                        <div className="work-title">
                          <h3>{b.title}</h3>
                        </div>
                        <small>{b.author}</small>
                        <p>{b.paragraphs}{' '}{t("абзацев · Открыть книгу")}</p>
                      </div>
                      <ChevronRight size={18} />
                    </button>
                  ))}
                </div>
              </section>
            )}
            {guide && (
              <section className="results-section">
                <div className="section-heading">
                  <h2>{guide.title}</h2>
                  <span>{t("Маршрут чтения")}</span>
                </div>
                <p className="route-intro">{guide.intro}</p>
                <p className="subtle-note">{t("Ориентировка по знаниям модели. Точный разбор появится после загрузки текста.")}</p>
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
                        <span className="text-action">{t("Найти и открыть текст")}{' '}<ChevronRight size={14} />
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
                  <h2>{t("Тексты по запросу «")}{sourceQuery}»</h2>
                  <span>{sources.length}{' '}{t("найдено")}</span>
                </div>
                {sources.length ? (
                  <div className="source-list">
                    {sources.map((s) => (
                      <button
                        className="source-row"
                        disabled={!!busy}
                        key={s.url}
                        onClick={() =>
                          void run(t("Загружаю текст книги…"), async () =>
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
                    <h3>{t("Открытый текст не найден")}</h3>
                    <p>{t("Попробуйте точное название. Если у вас есть книга, добавьте ссылку на текст или файл.")}</p>
                    <button className="secondary" onClick={() => setModal('import')}>
                      <Plus size={16} />{t("Добавить книгу")}</button>
                  </div>
                )}
                <p className="subtle-note">{t("Поиск по Викитеке. Другие источники можно добавить по ссылке.")}</p>
              </section>
            )}
            {!guide && !sources && (
              <section className="starter-section book-catalog">
                <div className="section-heading">
                  <h2>{authors.length ? t('Другие авторы') : t('Начните с автора')}</h2>
                  <button className="text-button" onClick={() => setModal('find')}>{t("Найти автора")}</button>
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
                      <span className="catalog-open">{t("Карта автора")}{' '}<ChevronRight size={13} />
                      </span>
                    </button>
                  ))}
                </div>
                <div className="own-book-row">
                  <span>{t("Своя книга?")}</span>
                  <button
                    onClick={() => {
                      setImportTitle('');
                      setModal('import');
                    }}
                  >
                    <LinkIcon size={14} />{t("Добавить по ссылке")}</button>
                  <button
                    onClick={() => {
                      setImportTitle('');
                      fileInput.current?.click();
                    }}
                  >
                    <Upload size={14} />{t("Загрузить файл")}</button>
                </div>
              </section>
            )}
            <footer className="home-footer">
              <span>{t("Книга — это пространство для мысли.")}</span>
              <span>{t("Двигайтесь в любом направлении.")}</span>
            </footer>
          </>
        ) : node ? (
          <>
            <nav className="breadcrumbs" aria-label={t("Путь в книге")}>
              <button onClick={() => navigate()} aria-label={t("Библиотека")}>
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
                <span>{t("Страница")}{' '}{pageIndex + 1}{' '}{t("из")}{' '}{pageCount}{' '}{t("на этом уровне")}</span>
              </div>
              <div className="book-context">
                {active.author || t('Ваша книга')}
                <span>{node.id === 'root' ? t('Общая картина') : `${t('Глубина')} ${path.length - 1}`}</span>
              </div>
              <h1 className="reading-title">
                {node.id !== 'root'
                  ? active.analyses[node.parent || '']?.children.find((c) => c.id === node.id)
                      ?.title || node.title
                  : active.title}
              </h1>
              <div className="reading-meta">
                <span>
                  {readingMinutes(active.paragraphs.slice(node.start, node.end))}{' '}{t("мин оригинала")}</span>
                <span>{node.end - node.start}{' '}{t("абзацев")}</span>
                {indexProgress?.status === 'running' && (
                  <span className="index-progress">
                    <LoaderCircle className="spin" size={13} />{t("Карта книги:")}{' '}{indexProgress.done}
                    {indexProgress.total ? ` из ${indexProgress.total}` : ''}
                  </span>
                )}
                {indexProgress?.status === 'paused' && (
                  <span className="index-progress">{t("Карта книги продолжится позже")}</span>
                )}
                {analysis && (
                  <span className="saved-mark">
                    <Check size={13} />{t("Разбор сохранён")}</span>
                )}
              </div>
              {active.warnings.map((w) => (
                <p key={w} className="source-warning">
                  {w}
                </p>
              ))}
              <div className="reading-toolbar">
                <div className="view-tabs" role="tablist" aria-label={t("Режим чтения")}>
                  <button
                    role="tab"
                    aria-selected={view === 'summary'}
                    className={view === 'summary' ? 'active' : ''}
                    onClick={() => setView('summary')}
                  >
                    <Layers size={16} />{t("Карта идей")}</button>
                  <button
                    role="tab"
                    aria-selected={view === 'original'}
                    className={view === 'original' ? 'active' : ''}
                    onClick={() => setView('original')}
                  >
                    <FileText size={16} />{t("Оригинал")}</button>
                </div>
                {view === 'summary' && analysis ? (
                  <Rating value={analysis.importance} />
                ) : view === 'original' ? (
                  <div className="font-controls">
                    <button
                      aria-label={t("Уменьшить шрифт")}
                      disabled={fontSize <= 15}
                      onClick={() => setFontSize((s) => s - 1)}
                    >{t("А−")}</button>
                    <button
                      aria-label={t("Увеличить шрифт")}
                      disabled={fontSize >= 25}
                      onClick={() => setFontSize((s) => s + 1)}
                    >{t("А+")}</button>
                  </div>
                ) : null}
                <button
                  className="ask-tool"
                  aria-label={t("Спросить о фрагменте")}
                  onClick={() => setModal('question')}
                >
                  <MessageCircle size={15} />
                  <span>{t("Спросить")}</span>
                </button>
                <button
                  className="icon-button delete-book-page"
                  aria-label={t('Удалить книгу из библиотеки')}
                  title={t('Удалить книгу из библиотеки')}
                  onClick={() => setModal('deleteBook')}
                >
                  <Trash2 size={17} />
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
                        <summary>{t("Идеи, вклад и рекомендации к чтению")}</summary>
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
                            <h2>{t("Что здесь главное")}</h2>
                            <ul>
                              {analysis.ideas.map((idea, i) => (
                                <li key={i}>{idea}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="reading-advice">
                          <div>
                            <h3>{t("Зачем читать")}</h3>
                            <p>{analysis.why}</p>
                          </div>
                          {analysis.skip && (
                            <div>
                              <h3>{t("Что можно пропустить")}</h3>
                              <p>{analysis.skip}</p>
                            </div>
                          )}
                        </div>
                      </details>
                      {analysis.coverage === 'sampled' && (
                        <p className="subtle-note">{t("Обзор большого раздела построен по выборке. Приблизьте текст для подробного разбора.")}</p>
                      )}
                    </section>
                  ) : (
                    <section className="unanalyzed" aria-live="polite">
                      {inheritedSummary && (
                        <div className="summary-text">
                          <p>{inheritedSummary}</p>
                        </div>
                      )}
                      <Layers size={25} />
                      <h2>
                        {analysisFailure
                          ? t('Не удалось загрузить разбор')
                          : t('Собираем обзор и саммари разделов')}
                      </h2>
                      <p>
                        {analysisFailure ||
                          (canAnalyze
                            ? t('Саммари появятся автоматически. Пока можно читать оригинал или двигаться дальше.')
                            : t('Подключите DeepSeek, чтобы увидеть главные идеи и важность фрагментов.'))}
                      </p>
                      {(analysisFailure || !canAnalyze) && (
                        <button
                          className="secondary"
                          disabled={!!busy}
                          onClick={() =>
                            canAnalyze ? void loadAnalysis(active, node.id) : setModal('settings')
                          }
                        >
                          {canAnalyze ? t('Повторить загрузку') : t('Подключить DeepSeek')}
                        </button>
                      )}
                    </section>
                  )}
                  {node.children.length > 0 && (
                    <section className="section-map">
                      {analysis && analysisFailure && (
                        <button
                          className="secondary"
                          disabled={!!busy}
                          onClick={() => void loadAnalysis(active, node.id)}
                        >{t("Повторить загрузку саммари")}</button>
                      )}
                      <div className="section-heading">
                        <h2>{semanticLevel === 0 ? t('Карта книги') : t('Внутри этого фрагмента')}</h2>
                        {analysis && (
                          <button
                            className={`filter-button ${importantOnly ? 'active' : ''}`}
                            onClick={() => setImportantOnly(!importantOnly)}
                          >
                            {importantOnly && <Check size={13} />}{t("Только главное")}</button>
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
                                  <p>
                                    {info?.summary ||
                                      (analysisFailure
                                        ? t('Саммари не загрузилось.')
                                        : canAnalyze
                                          ? t('Готовим саммари…')
                                          : t('Саммари доступно после подключения DeepSeek.'))}
                                  </p>
                                  <div className="depth-meta">
                                    <span>
                                      {readingMinutes(
                                        active.paragraphs.slice(child.start, child.end),
                                      )}{' '}{t("мин")}</span>
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
                          <p className="subtle-note">{t("На этом уровне нет фрагментов с важностью 4–5.")}{' '}
                            <button onClick={() => setImportantOnly(false)}>{t("Показать все")}</button>
                          </p>
                        )}
                    </section>
                  )}
                  {node.end - node.start === 1 && (
                    <div className="leaf-note">
                      <Check size={16} />{t("Вы дошли до одного абзаца.")}{' '}
                      <button onClick={() => setView('original')}>{t("Прочитать оригинал")}</button>
                    </div>
                  )}
                </>
              ) : (
                <section className="original-section">
                  <p className="original-hint">{t("Текст из источника, без пересказа. Выделите фразу, чтобы спросить о ней.")}</p>
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
                            aria-label={`${t('Задать вопрос по абзацу')} ${originalPage * 6 + i + 1}`}
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
                    <nav className="original-pagination" aria-label={t("Страницы оригинала")}>
                      <button
                        disabled={originalPage === 0}
                        onClick={() => {
                          setOriginalPage((p) => p - 1);
                          originalRef.current?.scrollIntoView({ block: 'start' });
                        }}
                      >
                        <ArrowLeft size={16} />{t("Назад")}</button>
                      <span>
                        {originalPage + 1} / {originalPages}
                      </span>
                      <button
                        disabled={originalPage >= originalPages - 1}
                        onClick={() => {
                          setOriginalPage((p) => p + 1);
                          originalRef.current?.scrollIntoView({ block: 'start' });
                        }}
                      >{t("Дальше")}<ArrowRight size={16} />
                      </button>
                    </nav>
                  )}
                  {quote && (
                    <div className="quote-action">
                      <span>{t("Выбран фрагмент")}</span>
                      <button onClick={() => setModal('question')}>
                        <MessageCircle size={14} />{t("Спросить")}</button>
                      <button aria-label={t("Убрать выделение")} onClick={() => setQuote('')}>
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </section>
              )}
            </article>
            <nav className="semantic-dock" aria-label={t("Масштаб и страницы книги")}>
              <button
                className="page-step"
                aria-label={t("Предыдущая страница этого уровня")}
                disabled={pageIndex <= 0}
                onClick={() => turnPage(-1)}
              >
                <ArrowLeft size={20} />
                <span>{t("Назад")}</span>
              </button>
              <div className="zoom-control">
                <button
                  aria-label={t("Уменьшить глубину — более общий обзор")}
                  title={t("Более общий обзор")}
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
                  aria-label={t("Увеличить глубину — больше деталей")}
                  title={t("Больше деталей")}
                  disabled={node.end - node.start <= 1 || semanticLevel >= 12}
                  onClick={() => zoom(1)}
                >
                  +
                </button>
              </div>
              <button
                className="page-step"
                aria-label={t("Следующая страница этого уровня")}
                disabled={pageIndex < 0 || pageIndex >= pageCount - 1}
                onClick={() => turnPage(1)}
              >
                <span>{t("Дальше")}</span>
                <ArrowRight size={20} />
              </button>
            </nav>
          </>
        ) : (
          <div className="empty-state">
            <h1>{t("Раздел не найден")}</h1>
            <button className="primary" onClick={() => navigate(active.id)}>{t("К началу книги")}</button>
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
        ref={metaInput}
        type="file"
        accept=".txt,.md,.html,.htm,.epub,.fb2,.pdf"
        onChange={(e) => {
          setMetaFile(e.target.files?.[0] || null);
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
          void run(t("Восстанавливаю библиотеку…"), async () => {
            if (file.size > 50 * 1024 * 1024) throw new Error(t('Архив библиотеки превышает 50 МБ.'));
            const data = JSON.parse(await file.text());
            if (data.version !== 1 || !Array.isArray(data.books) || !data.books.every(validBook))
              throw new Error(t('Это не архив библиотеки Figlet или он повреждён.'));
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
            setNotice(t("Библиотека восстановлена."));
          });
        }}
      />
      {modal === 'find' && (
        <Modal title={t("Найти книгу")} onClose={() => setModal(null)}>
          <p className="modal-copy">{t("Найдите текст по названию или выберите автора, чтобы увидеть карту его произведений.")}</p>
          <form
            className="find-form"
            onSubmit={(e) => {
              e.preventDefault();
              setModal(null);
              void search();
            }}
          >
            <label className="field">{t("Автор, название или интересующая тема")}<input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Ленин, Государь, стоицизм…")}
                maxLength={500}
                autoFocus
              />
            </label>
            <div className="theme-options">
              <button
                type="button"
                className={searchMode === 'guide' ? 'selected' : ''}
                onClick={() => setSearchMode('guide')}
              >{t("Карта произведений")}</button>
              <button
                type="button"
                className={searchMode === 'text' ? 'selected' : ''}
                onClick={() => setSearchMode('text')}
              >{t("Точный текст")}</button>
            </div>
            <button className="primary full" disabled={!!busy || !query.trim()}>
              <Search size={16} />{t("Найти")}</button>
          </form>
          <button className="text-button" onClick={() => setModal('import')}>{t("У меня есть ссылка или файл")}</button>
        </Modal>
      )}
      {modal === 'import' && (
        <Modal title={t("Добавить книгу")} onClose={() => setModal(null)}>
          <p className="modal-copy">{t("Ссылка на страницу с полным текстом или файл с вашего устройства.")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(t("Загружаю и разбираю текст…"), async () => {
                const book = await api('import/url', {
                  url,
                  title: importTitle,
                  author: importAuthor || activeAuthor?.name,
                });
                await addBook({ ...book, authorId: activeAuthor?.id });
              });
            }}
          >
            <label className="field">{t("Ссылка на текст")}<input
                type="url"
                placeholder="https://…"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label className="field">{t("Название")}{' '}<span>{t("необязательно")}</span>
              <input
                value={importTitle}
                onChange={(e) => setImportTitle(e.target.value)}
                placeholder={t("Название книги")}
                maxLength={300}
              />
            </label>
            <label className="field">{t("Автор")}{' '}<span>{t("необязательно")}</span>
              <input
                value={importAuthor || activeAuthor?.name || ''}
                onChange={(e) => setImportAuthor(e.target.value)}
                placeholder={t("Имя автора")}
                maxLength={180}
              />
            </label>
            <button className="primary full" disabled={!!busy || !url.trim()}>
              <LinkIcon size={16} />{t("Загрузить по ссылке")}</button>
          </form>
          <div className="or-divider">{t("или")}</div>
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
            <strong>{t("Выбрать файл")}</strong>
            <span>{t("EPUB, FB2, PDF, TXT, Markdown, HTML · до 10 МБ")}</span>
          </button>
          <p className="subtle-note">{t("Добавляйте тексты, которые можете законно читать. PDF-сканам требуется распознавание. Загруженные книги и ссылки попадают в общую библиотеку: сервер хранит оригинал, разбор и сверяет редакции, чтобы собрать полный текст. Личная позиция чтения и вопросы остаются в вашем браузере.")}</p>
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
        <Modal title={t("Настройки")} onClose={() => setModal(null)}>
          <section className="settings-section">
            <h3>{t("Оформление")}</h3>
            <div className="theme-options">
              {[
                ['light', t('Светлая')],
                ['dark', t('Тёмная')],
                ['system', t('Как в системе')],
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
            <div className="theme-options" aria-label={t('Язык')}>
              {(
                [
                  ['ru', 'Русский'],
                  ['en', 'English'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={lang === value ? 'selected' : ''}
                  onClick={() => changeLang(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section className="settings-section">
            <h3>{t("Разборы и AI")}</h3>
            <p className="modal-copy">
              {config.sharedKey
                ? `${t('Сервер бесплатно разбирает')} ${config.freeBooksPerWeek || 5} ${t('новых книг в неделю')}`
                : t('Добавьте свой ключ для разборов и вопросов по тексту.')}
            </p>
            {quota && (
              <div className="quota-state">
                {quota.subscription?.until ? (
                  <span className="saved-mark">
                    <Check size={14} />{t("Подписка до")}{' '}{new Date(quota.subscription.until).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU')}
                  </span>
                ) : (
                  <span>{t("Новых книг на этой неделе:")}{' '}{quota.used}{' '}{t("из")}{' '}{quota.limit}
                  </span>
                )}
                {config.subscription?.enabled && !quota.subscription?.until && (
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() => void subscribe()}
                  >
                    <CreditCard size={15} />{t("Подписка —")}{' '}{config.subscription.price} ₽ / {config.subscription.days}{' '}{t("дней")}</button>
                )}
              </div>
            )}
            <label className="field">
              {config.sharedKey ? t('Личный ключ (необязательно)') : t('API-ключ')}
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
              />{t("Помнить личный ключ до закрытия вкладки")}</label>
            <details className="provider-details">
              <summary>{t("Свой провайдер (OpenAI-совместимый или Anthropic)")}</summary>
              <p className="subtle-note">{t("После исчерпания бесплатных книг можно указать собственный шлюз: базовый URL, модель и ключ. Ключ передаётся только в ваш шлюз и не сохраняется на сервере.")}</p>
              <div className="theme-options">
                {(
                  [
                    ['openai', 'OpenAI-совместимый'],
                    ['anthropic', 'Anthropic'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={aiProvider === value ? 'selected' : ''}
                    onClick={() => setAiProvider(aiProvider === value ? '' : value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {aiProvider && (
                <>
                  <label className="field">{t("Базовый URL")}<input
                      type="url"
                      placeholder="https://api.example.com/v1"
                      value={aiBaseUrl}
                      onChange={(e) => setAiBaseUrl(e.target.value.trim())}
                    />
                  </label>
                  <p className="subtle-note">{t("Публичный https-адрес на порту 80 или 443. Для OpenAI-совместимых — путь до корня API; /chat/completions добавится сам.")}</p>
                </>
              )}
            </details>
            <label className="field">{t("Модель")}<input
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
                void run(t("Проверяю доступные модели…"), async () => {
                  const data = await api('models');
                  setAvailableModels(data.models);
                  setNotice(t("Список моделей обновлён."));
                })
              }
            >{t("Получить доступные модели")}</button>
            <p className="subtle-note">{t("Текст текущего раздела отправляется выбранному провайдеру для разбора. Ключ передаётся через сервер по HTTPS и не включается в архив библиотеки.")}</p>
          </section>
          <section className="settings-section">
            <h3>{t("Ваша библиотека")}</h3>
            <p className="modal-copy">
              {books.length}{' '}{t("книг на этом устройстве. Общие разборы хранятся на сервере; позиция чтения, личные файлы и вопросы — в браузере. Экспортируйте библиотеку для переноса.")}</p>
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
                <Download size={16} />{t("Экспорт")}</button>
              <button className="secondary" onClick={() => restoreInput.current?.click()}>
                <Upload size={16} />{t("Импорт")}</button>
            </div>
            {active && (
              <>
                <button
                  className="secondary"
                  onClick={() => {
                    setBookMeta({
                      bookId: active.id,
                      title: active.title,
                      author: active.author,
                      replace: null,
                    });
                    setMetaFile(null);
                    setModal('bookMeta');
                  }}
                >{t("Переименовать «")}{active.title}»
                </button>
                <button
                  className="delete-book"
                  onClick={() =>
                    void run(t("Удаляю книгу с устройства…"), async () => {
                      await storage.remove(active.id);
                      booksRef.current = booksRef.current.filter((b) => b.id !== active.id);
                      setBooks(booksRef.current);
                      navigate();
                      setModal(null);
                      setNotice(
                        t("Книга удалена из библиотеки этого устройства. Серверные разборы сохранятся для повторной загрузки."),
                      );
                    })
                  }
                >
                  <Trash2 size={15} />{t("Удалить «")}{active.title}»
                </button>
              </>
            )}
          </section>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary full" onClick={() => setModal(null)}>{t("Готово")}</button>
        </Modal>
      )}
      {modal === 'question' && active && node && (
        <Modal title={t("Вопрос к фрагменту")} onClose={() => setModal(null)}>
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
                  aria-label={t("Убрать выделение")}
                  onClick={() => setQuote('')}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <form className="question-form" onSubmit={submitQuestion}>
              <label htmlFor="question-input" className="sr-only">{t("Вопрос по разделу")}</label>
              <textarea
                id="question-input"
                placeholder={
                  quote ? t('Что хотите понять в этой фразе?') : t('Почему автор так считает?')
                }
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={2}
                maxLength={2000}
              />
              <button
                className="search-submit"
                aria-label={t("Задать вопрос")}
                disabled={!!busy || !question.trim() || !canAnalyze}
              >
                <ArrowUp size={18} />
              </button>
            </form>
            <p className="subtle-note">
              {quote
                ? t('Ответ будет учитывать выделенный фрагмент.')
                : t('Вопрос относится к текущему разделу.')}{' '}
              {!canAnalyze && (
                <button onClick={() => setModal('settings')}>{t("Подключить DeepSeek")}</button>
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
      {modal === 'account' && (
        <Modal title={account ? t('Аккаунт') : t('Вход')} onClose={() => setModal(null)}>
          {account ? (
            <>
              <p className="modal-copy">{t("Вы вошли как")}{' '}<strong>{account.login}</strong>
                {account.isAdmin ? ' (администратор)' : ''}{t(". Подписка и бесплатный лимит привязаны к аккаунту; без входа они живут в куках этого браузера.")}</p>
              {quota && (
                <div className="quota-state">
                  {quota.subscription?.until ? (
                    <span className="saved-mark">
                      <Check size={14} />{t("Подписка до")}{' '}
                      {new Date(quota.subscription.until).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU')}
                    </span>
                  ) : (
                    <span>{t("Новых книг на этой неделе:")}{' '}{quota.used}{' '}{t("из")}{' '}{quota.limit}
                    </span>
                  )}
                  {config.subscription?.enabled && !quota.subscription?.until && (
                    <button className="secondary" disabled={!!busy} onClick={() => void subscribe()}>
                      <CreditCard size={15} />{t("Подписка —")}{' '}{config.subscription.price} ₽ / {config.subscription.days}{' '}{t("дней")}</button>
                  )}
                </div>
              )}
              <button
                className="secondary full"
                onClick={() =>
                  void run(t("Выхожу…"), async () => {
                    await api('auth/logout', {});
                    setAccount(null);
                    void refreshQuota();
                    setNotice(t("Вы вышли. Библиотека этого браузера осталась с вами."));
                  })
                }
              >
                <LogOut size={15} />{t("Выйти")}</button>
            </>
          ) : (
            <>
              <p className="modal-copy">{t("Вход необязателен: всё работает в кукисах. Аккаунт нужен, чтобы переносить подписку между устройствами.")}</p>
              <div className="theme-options">
                <button
                  className={authTab === 'login' ? 'selected' : ''}
                  onClick={() => setAuthTab('login')}
                >{t("Войти")}</button>
                <button
                  className={authTab === 'register' ? 'selected' : ''}
                  onClick={() => setAuthTab('register')}
                >{t("Создать аккаунт")}</button>
              </div>
              <form
                className="find-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(t("Проверяю данные…"), async () => {
                    const data = await api(`auth/${authTab}`, {
                      login: authLogin.trim(),
                      password: authPassword,
                    });
                    setAccount(data.user);
                    setAuthPassword('');
                    void refreshQuota();
                    setModal(null);
                    setNotice(
                      data.user.isAdmin
                        ? `${t('Здравствуйте,')} ${data.user.login}! ${t('Открыт административный доступ.')}`
                        : `${t('Здравствуйте,')} ${data.user.login}!`,
                    );
                  });
                }}
              >
                <label className="field">{t("Логин")}<input
                    value={authLogin}
                    onChange={(e) => setAuthLogin(e.target.value)}
                    placeholder="reader"
                    maxLength={63}
                    autoComplete="username"
                    autoFocus
                  />
                </label>
                <label className="field">{t("Пароль")}<input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder={t("Минимум 8 символов")}
                    maxLength={200}
                    autoComplete={authTab === 'login' ? 'current-password' : 'new-password'}
                  />
                </label>
                <button
                  className="primary full"
                  disabled={!!busy || !authLogin.trim() || authPassword.length < 8}
                >
                  {authTab === 'login' ? t('Войти') : t('Создать аккаунт')}
                </button>
              </form>
              <p className="subtle-note">{t("Пароль хранится только в виде хэша. Мы не просим почту и не восстанавливаем забытые пароли — запишите его.")}</p>
            </>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
      {modal === 'bookMeta' && bookMeta && (
        <Modal
          title={bookMeta.suggestion ? t('Подтвердите книгу') : t('Название и автор')}
          onClose={() => {
            setBookMeta(null);
            setMetaFile(null);
          }}
        >
          {bookMeta.suggestion ? (
            <p className="modal-copy">{t("Похоже, это «")}{bookMeta.suggestion.title}»
              {bookMeta.suggestion.author ? ` — ${bookMeta.suggestion.author}` : ''}{t(". Проверьте и поправьте при необходимости: от этого зависит запись в общей библиотеке.")}{bookMeta.suggestion.reason ? ` ${bookMeta.suggestion.reason}` : ''}
            </p>
          ) : (
            <p className="modal-copy">{t("Название и автора видно в библиотеке и общей карте. Разборы сохраняются по тексту, так что переименование их не теряет.")}</p>
          )}
          <form
            className="find-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveBookMeta();
            }}
          >
            <label className="field">{t("Название")}<input
                value={bookMeta.title}
                onChange={(e) => setBookMeta({ ...bookMeta, title: e.target.value })}
                maxLength={300}
                autoFocus
              />
            </label>
            <label className="field">{t("Автор")}<input
                value={bookMeta.author}
                onChange={(e) => setBookMeta({ ...bookMeta, author: e.target.value })}
                maxLength={180}
                placeholder={t("Имя автора")}
              />
            </label>
            {!bookMeta.suggestion && (
              <button
                type="button"
                className="text-button"
                onClick={() => metaInput.current?.click()}
              >{t("Загрузить файл заново с этим названием")}</button>
            )}
            <button className="primary full" disabled={!!busy || !bookMeta.title.trim()}>{t("Сохранить")}</button>
          </form>
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
      {modal === 'deleteBook' && active && (
        <Modal title={t("Удалить книгу")} onClose={() => setModal(null)}>
          <p className="modal-copy">
            {t('Удалить «')}
            {active.title}
            {t('» с этого устройства? Позиция чтения и локальные вопросы уйдут; разборы на сервере сохранятся.')}
          </p>
          <div className="settings-actions">
            <button
              className="delete-book"
              disabled={!!busy}
              onClick={() =>
                void run(t('Удаляю книгу с устройства…'), async () => {
                  await storage.remove(active.id);
                  booksRef.current = booksRef.current.filter((b) => b.id !== active.id);
                  setBooks(booksRef.current);
                  setModal(null);
                  navigate();
                  setNotice(t('Книга удалена из библиотеки этого устройства.'));
                })
              }
            >
              <Trash2 size={15} />
              {t('Удалить с устройства')}
            </button>
            {account?.isAdmin && (
              <button
                className="delete-book"
                disabled={!!busy}
                onClick={() =>
                  void run(t('Удаляю книгу с сервера…'), async () => {
                    await del(`admin/editions/${active.id}`);
                    await storage.remove(active.id);
                    booksRef.current = booksRef.current.filter((b) => b.id !== active.id);
                    setBooks(booksRef.current);
                    setModal(null);
                    navigate();
                    setNotice(t('Книга удалена с сервера и с этого устройства.'));
                  })
                }
              >
                <Trash2 size={15} />
                {t('Удалить с сервера (админ)')}
              </button>
            )}
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
      {modal === 'about' && (
        <Modal title={t("Читайте в своём масштабе")} onClose={() => setModal(null)}>
          <div className="about-content">
            <p>{t("Figlet помогает найти в книге то, что важно именно вам.")}</p>
            <ol>
              <li>
                <strong>{t("Выберите направление.")}</strong>{' '}{t("Спросите об авторе или найдите конкретную книгу.")}</li>
              <li>
                <strong>{t("Посмотрите на общую картину.")}</strong>{' '}{t("Узнайте главную мысль и роль каждого раздела.")}</li>
              <li>
                <strong>{t("Углубляйтесь.")}</strong>{' '}{t("Открывайте интересные разделы, пока не дойдёте до отдельного абзаца.")}</li>
              <li>
                <strong>{t("Сверяйтесь с текстом.")}</strong>{' '}{t("Переключитесь на оригинал, выделите фразу и задайте вопрос.")}</li>
            </ol>
            <p>{t("Разбор появляется при первом открытии уровня и сохраняется. Путь сверху и кнопки снизу помогают двигаться в любую сторону.")}</p>
            <p className="subtle-note">{t("Важность — субъективная оценка модели. Проверяйте спорные выводы по оригиналу. Общие книги и разборы хранятся на сервере. Браузер сохраняет копии для чтения офлайн, личные файлы, вопросы и вашу позицию.")}</p>
          </div>
          <button className="primary full" onClick={() => setModal(null)}>{t("Начать читать")}</button>
        </Modal>
      )}
    </div>
  );
}
