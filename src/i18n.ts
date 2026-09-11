export type Lang = 'ru' | 'en';

// The Russian source string is the key; English translations live in one map.
// Anything missing falls back to Russian, so new UI text never breaks the app.
const en: Record<string, string> = {
  '. Оценки и интерпретации AI могут быть неточны.': '. AI ratings and interpretations may be inaccurate.',
  '. Подписка и бесплатный лимит привязаны к аккаунту; без входа они живут в куках этого браузера.':
    '. The subscription and free limit belong to the account; without signing in they live in this browser’s cookies.',
  '. Проверьте и поправьте при необходимости: от этого зависит запись в общей библиотеке.':
    '. Check and correct if needed: the shared library entry depends on it.',
  '«+» — больше деталей. «−» — шире картина.': '“+” — more detail. “−” — the wider picture.',
  'А−': 'A−',
  'А+': 'A+',
  'Абзацы': 'Paragraphs',
  'Автор': 'Author',
  'Автор, название или интересующая тема': 'Author, title or a theme of interest',
  'Авторы и идеи': 'Authors and ideas',
  'Базовый URL': 'Base URL',
  'Библиотека': 'Library',
  'Библиотека восстановлена.': 'Library restored.',
  'Более общий обзор': 'Zoom out for a broader overview',
  'Больше деталей': 'Zoom in for more detail',
  'В рекомендуемом порядке чтения': 'In recommended reading order',
  'Важность — субъективная оценка модели. Проверяйте спорные выводы по оригиналу. Общие книги и разборы хранятся на сервере. Браузер сохраняет копии для чтения офлайн, личные файлы, вопросы и вашу позицию.':
    'Importance is the model’s subjective rating. Verify debatable conclusions against the original. Shared books and analyses live on the server; the browser keeps offline copies, private files, questions and your position.',
  'Ваша библиотека': 'Your library',
  'Ваша личная библиотека': 'Your personal library',
  'Войти': 'Sign in',
  'Вопрос к фрагменту': 'Ask about a passage',
  'Вопрос по разделу': 'Question about this section',
  'Восстанавливаю библиотеку…': 'Restoring library…',
  'Вход необязателен: всё работает в кукисах. Аккаунт нужен, чтобы переносить подписку между устройствами.':
    'Signing in is optional: everything works in cookies. An account lets you carry the subscription across devices.',
  'Вы вошли как': 'Signed in as',
  'Вы вышли. Библиотека этого браузера осталась с вами.':
    'You are signed out. This browser’s library stays with you.',
  'Вы дошли до одного абзаца.': 'You have reached a single paragraph.',
  'Выберите направление.': 'Choose a direction.',
  'Выбирайте глубину чтения': 'Choose your reading depth',
  'Выбран фрагмент': 'Passage selected',
  'Выбрать файл': 'Choose a file',
  'Выйти': 'Sign out',
  'Выхожу…': 'Signing out…',
  'Главы': 'Chapters',
  'Готово': 'Done',
  'Дальше': 'Next',
  'Двигайтесь в любом направлении.': 'Move in any direction.',
  'дней': 'days',
  'Добавить книгу': 'Add a book',
  'Добавить по ссылке': 'Add by URL',
  'Добавить произведение': 'Add a work',
  'Добавить свою книгу': 'Add your own book',
  'Добавляйте тексты, которые можете законно читать. PDF-сканам требуется распознавание. Загруженные книги и ссылки попадают в общую библиотеку: сервер хранит оригинал, разбор и сверяет редакции, чтобы собрать полный текст. Личная позиция чтения и вопросы остаются в вашем браузере.':
    'Add texts you may legally read. Scanned PDFs need OCR. Uploaded books and URLs join the shared library: the server keeps the original, the analysis and cross-checks editions to assemble the fullest text. Your reading position and questions stay in your browser.',
  'Загружаю и разбираю текст…': 'Loading and parsing the text…',
  'Загружаю текст книги…': 'Loading the book text…',
  'Загрузить по ссылке': 'Load by URL',
  'Загрузить файл': 'Upload a file',
  'Загрузить файл заново с этим названием': 'Re-upload the file under this title',
  'Задать вопрос': 'Ask',
  'Закрыть': 'Close',
  'Закрыть библиотеку': 'Close the library',
  'Зачем читать': 'Why read this',
  'Здесь появятся книги,': 'Books you will want',
  'Идеи, вклад и рекомендации к чтению': 'Ideas, contribution and reading advice',
  'из': 'of',
  'Извлекаю текст и определяю книгу…': 'Extracting text and identifying the book…',
  'или': 'or',
  'Импорт': 'Import',
  'Имя автора': 'Author name',
  'Источник:': 'Source:',
  'Ищу ответ в тексте…': 'Looking for the answer in the text…',
  'Ищу полный текст книги…': 'Looking for the full text…',
  'к которым захочется вернуться.': 'to return to will appear here.',
  'К началу книги': 'Back to the start of the book',
  'К содержанию': 'Skip to content',
  'Как читать в Figlet': 'How to read in Figlet',
  'Карта автора': 'Author map',
  'Карта идей': 'Idea map',
  'Карта книги продолжится позже': 'The book map will continue later',
  'Карта книги:': 'Book map:',
  'Карта по знаниям модели. Разбор произведений строится по загруженному оригиналу.':
    'The map comes from the model’s knowledge. Work analyses are built from the loaded original.',
  'Карта произведений': 'Map of works',
  'книг': 'books',
  'книг на этом устройстве. Общие разборы хранятся на сервере; позиция чтения, личные файлы и вопросы — в браузере. Экспортируйте библиотеку для переноса.':
    'books on this device. Shared analyses live on the server; reading position, private files and questions stay in the browser. Export the library to move it.',
  'Книга — это пространство для мысли.': 'A book is a space for thought.',
  'Книга удалена из библиотеки этого устройства. Серверные разборы сохранятся для повторной загрузки.':
    'The book is removed from this device. Server-side analyses remain for the next upload.',
  'Книги': 'Books',
  'Книги из открытых источников. Готовые разборы общие для всех читателей.':
    'Books from open sources. Ready analyses are shared by all readers.',
  'Ленин, Государь, стоицизм…': 'Lenin, The Prince, stoicism…',
  'Листайте книгу на выбранном уровне.': 'Page through the book at the chosen level.',
  'Логин': 'Login',
  'Маршрут чтения': 'Reading route',
  'Масштаб и страницы автора': 'Zoom and author paging',
  'Масштаб и страницы книги': 'Zoom and book paging',
  'мин': 'min',
  'мин оригинала': 'min of original text',
  'Минимум 8 символов': 'At least 8 characters',
  'Модель': 'Model',
  'Мои авторы': 'My authors',
  'Мои книги': 'My books',
  'на сервере и на устройстве': 'on the server and on your device',
  'на этом уровне': 'at this level',
  'На этом уровне нет фрагментов с важностью 4–5.':
    'No passages rated 4–5 at this level.',
  'Назад': 'Back',
  'Название': 'Title',
  'Название и автор сохранены.': 'Title and author saved.',
  'Название и автора видно в библиотеке и общей карте. Разборы сохраняются по тексту, так что переименование их не теряет.':
    'The title and author show up in the library and the shared map. Analyses are stored per text, so renaming keeps them.',
  'Название книги': 'Book title',
  'найдено': 'found',
  'Найдите текст по названию или выберите автора, чтобы увидеть карту его произведений.':
    'Find a text by title or pick an author to see the map of their works.',
  'Найти': 'Find',
  'Найти автора': 'Find an author',
  'Найти и открыть текст': 'Find and open the text',
  'Найти книгу': 'Find a book',
  'Настройки': 'Settings',
  'Начать читать': 'Start reading',
  'Не удалось сохранить книгу в браузере. Освободите место или экспортируйте библиотеку.':
    'Could not save the book in the browser. Free up space or export the library.',
  'необязательно': 'optional',
  'Нет соединения с сервером. Сохранённые книги можно продолжать читать.':
    'No connection to the server. Saved books remain readable.',
  'Новых книг на этой неделе:': 'New books this week:',
  'Обзор большого раздела построен по выборке. Приблизьте текст для подробного разбора.':
    'This overview of a large section is built from a sample. Zoom in for a detailed analysis.',
  'Общая библиотека': 'Shared library',
  'Оглавление': 'Contents',
  'Оглавление книги': 'Book contents',
  'Оригинал': 'Original',
  'Ориентировка по знаниям модели. Точный разбор появится после загрузки текста.':
    'Orientation from the model’s knowledge. A precise analysis appears once the text is loaded.',
  'От наследия автора — к одной важной мысли.':
    'From an author’s legacy — to one important thought.',
  'Ответ на этот вопрос уже сохранён ниже.':
    'An answer to this question is already saved below.',
  'Открывайте интересные разделы, пока не дойдёте до отдельного абзаца.':
    'Open the sections that interest you, down to a single paragraph.',
  'Открываю библиотеку…': 'Opening the library…',
  'Открываю книгу из общей библиотеки…': 'Opening the book from the shared library…',
  'Открытый исходный код': 'Open source',
  'Открытый текст не найден': 'No open text found',
  'Открыть библиотеку': 'Open the library',
  'Оформление': 'Appearance',
  'Пароль': 'Password',
  'Пароль хранится только в виде хэша. Мы не просим почту и не восстанавливаем забытые пароли — запишите его.':
    'The password is stored only as a hash. We ask for no email and cannot recover forgotten passwords — write it down.',
  'Переименовать «': 'Rename “',
  'Переключитесь на оригинал, выделите фразу и задайте вопрос.':
    'Switch to the original, select a phrase and ask about it.',
  'Переключить тему': 'Toggle theme',
  'Повторить загрузку саммари': 'Retry loading summaries',
  'Подключите DeepSeek для карты автора.': 'Connect DeepSeek for the author map.',
  'Подключить DeepSeek': 'Connect DeepSeek',
  'Подписка —': 'Subscription —',
  'Подписка активна. Спасибо!': 'Subscription is active. Thank you!',
  'Подписка до': 'Subscription until',
  'Подтверждаю платёж…': 'Confirming the payment…',
  'Поиск по Викитеке. Другие источники можно добавить по ссылке.':
    'Searches Wikisource. Other sources can be added by URL.',
  'Показать все': 'Show all',
  'Получить доступные модели': 'Fetch available models',
  'Помнить личный ключ до закрытия вкладки':
    'Remember the personal key until the tab closes',
  'Попробуйте точное название. Если у вас есть книга, добавьте ссылку на текст или файл.':
    'Try the exact title. If you have the book, add a text URL or a file.',
  'После исчерпания бесплатных книг можно указать собственный шлюз: базовый URL, модель и ключ. Ключ передаётся только в ваш шлюз и не сохраняется на сервере.':
    'Once the free books run out you can set your own gateway: base URL, model and key. The key goes only to your gateway and is never stored on the server.',
  'Посмотрите на общую картину.': 'Look at the big picture.',
  'Похоже, это «': 'Looks like “',
  'Предыдущая страница этого уровня': 'Previous page at this level',
  'Предыдущий автор': 'Previous author',
  'Приблизить — открыть произведение': 'Zoom in — open the work',
  'Проверяю данные…': 'Checking credentials…',
  'Проверяю доступные модели…': 'Checking available models…',
  'Проверяю статус в платёжном сервисе. Это займёт несколько секунд.':
    'Checking the payment service. This takes a few seconds.',
  'произведений': 'works',
  'произведений на карте': 'works on the map',
  'Прочитать оригинал': 'Read the original',
  'Публичный https-адрес на порту 80 или 443. Для OpenAI-совместимых — путь до корня API; /chat/completions добавится сам.':
    'A public https URL on port 80 or 443. For OpenAI-compatible gateways give the API root; /chat/completions is appended automatically.',
  'Путь в книге': 'Path in the book',
  'Путь к автору': 'Path to the author',
  'Разбор появляется при первом открытии уровня и сохраняется. Путь сверху и кнопки снизу помогают двигаться в любую сторону.':
    'An analysis appears the first time you open a level and is saved. The path above and the buttons below help you move in any direction.',
  'Разбор сохранён': 'Analysis saved',
  'разборов сохранено': 'analyses saved',
  'Разборы и AI': 'Analyses and AI',
  'Разборы сохраняются': 'Analyses are stored',
  'Раздел не найден': 'Section not found',
  'Режим чтения': 'Reading mode',
  'Самый общий уровень — автор': 'Widest level — the author',
  'Сверяйтесь с текстом.': 'Check against the text.',
  'Свой провайдер (OpenAI-совместимый или Anthropic)':
    'Your own provider (OpenAI-compatible or Anthropic)',
  'Своя книга?': 'Have your own book?',
  'Скрыть ошибку': 'Dismiss the error',
  'Следующая страница этого уровня': 'Next page at this level',
  'Следующий автор': 'Next author',
  'Собираю карту автора и его произведений…': 'Building the author and works map…',
  'Создать аккаунт': 'Create an account',
  'Создаю платёж…': 'Creating a payment…',
  'Сохранить': 'Save',
  'Сохраняю название и автора…': 'Saving the title and author…',
  'Список моделей обновлён.': 'Model list refreshed.',
  'Спросите об авторе или найдите конкретную книгу.':
    'Ask about an author or find a specific book.',
  'Спросить': 'Ask',
  'Спросить о фрагменте': 'Ask about a passage',
  'Ссылка на страницу с полным текстом или файл с вашего устройства.':
    'A URL of a page with the full text, or a file from your device.',
  'Ссылка на текст': 'Text URL',
  'Страница': 'Page',
  'Страницы оригинала': 'Original text pages',
  'Текст из источника, без пересказа. Выделите фразу, чтобы спросить о ней.':
    'Source text without retelling. Select a phrase to ask about it.',
  'Текст текущего раздела отправляется выбранному провайдеру для разбора. Ключ передаётся через сервер по HTTPS и не включается в архив библиотеки.':
    'The current section’s text is sent to the selected provider for analysis. The key travels via the server over HTTPS and is never included in a library export.',
  'Тексты по запросу «': 'Texts for “',
  'Только главное': 'Essentials only',
  'Точный текст': 'Exact text',
  'У меня есть ссылка или файл': 'I have a URL or a file',
  'Убрать выделение': 'Clear selection',
  'Увеличить глубину — больше деталей': 'Zoom in — more detail',
  'Увеличить шрифт': 'Increase font size',
  'Углубляйтесь.': 'Go deeper.',
  'Удалить «': 'Delete “',
  'Удаляю книгу с устройства…': 'Removing the book from this device…',
  'Узнайте главную мысль и роль каждого раздела.':
    'Learn the main idea and the role of each section.',
  'Уменьшить глубину — более общий обзор': 'Zoom out — a broader overview',
  'Уменьшить шрифт': 'Decrease font size',
  'Файл слишком большой. Максимум — 10 МБ.': 'The file is too large. Maximum is 10 MB.',
  'Фрагменты': 'Fragments',
  'Хранилище браузера недоступно. Разрешите локальное хранение данных для библиотеки.':
    'Browser storage is unavailable. Allow local data storage for the library.',
  'Читайте в своём масштабе': 'Read at your own scale',
  'читать вглубь': 'read in depth',
  'Читаю раздел и собираю карту идей…': 'Reading the section and mapping ideas…',
  'Что здесь главное': 'What matters here',
  'Что можно пропустить': 'What you can skip',
  'Экспорт': 'Export',
  'Эта книга уже есть в библиотеке. Открыта сохранённая версия.':
    'This book is already in the library. The saved copy is open.',
  'EPUB, FB2, PDF, TXT, Markdown, HTML · до 10 МБ': 'EPUB, FB2, PDF, TXT, Markdown, HTML · up to 10 MB',
  'Figlet помогает найти в книге то, что важно именно вам.':
    'Figlet helps you find what matters to you in a book.',
  'абзацев': 'paragraphs',
  'абзацев · Открыть книгу': 'paragraphs · Open the book',
  // Extra strings used outside JSX text nodes (labels chosen in code).
  'Вся книга': 'Whole book',
  'Разделы': 'Sections',
  'Малые фрагменты': 'Small fragments',
  'Общая картина': 'The big picture',
  'Глубина': 'Depth',
  'Светлая': 'Light',
  'Тёмная': 'Dark',
  'Как в системе': 'System',
  'Начните с автора': 'Start with an author',
  'Другие авторы': 'Other authors',
  'Ваша книга': 'Your book',
  'Готовим саммари…': 'Preparing summaries…',
  'Саммари не загрузилось.': 'Summaries failed to load.',
  'Саммари доступно после подключения DeepSeek.':
    'Summaries are available once DeepSeek is connected.',
  'Собираем обзор и саммари разделов': 'Building the overview and section summaries',
  'Не удалось загрузить разбор': 'Could not load the analysis',
  'Саммари появятся автоматически. Пока можно читать оригинал или двигаться дальше.':
    'Summaries will appear automatically. Meanwhile, read the original or move on.',
  'Подключите DeepSeek, чтобы увидеть главные идеи и важность фрагментов.':
    'Connect DeepSeek to see the key ideas and the importance of fragments.',
  'Повторить загрузку': 'Retry loading',
  'Разборы, сохранённые на сервере, доступны сразу.':
    'Server-side analyses are available immediately.',
  'Язык': 'Language',
  // Book-level warnings persisted by the server, rendered as plain text.
  'Текст извлечён из PDF: переносы и порядок колонок могут отличаться от печатной страницы.':
    'Text extracted from a PDF: line breaks and column order may differ from the printed page.',
  'В PDF нет текстового слоя. Распознайте скан (OCR) или загрузите EPUB, FB2 либо TXT.':
    'The PDF has no text layer. Run OCR on the scan or upload EPUB, FB2 or TXT.',
  'Текст объединён из нескольких редакций источника.':
    'Text merged from several editions of the source.',
  'Текст превышает лимит 5 млн символов. Загружена только начальная часть.':
    'The text exceeds the 5M character limit. Only the beginning was loaded.',
  // Strings used in code ternaries and template literals.
  'Важность': 'Importance',
  'из 5 — оценка модели': 'of 5 — model rating',
  'Задать вопрос по абзацу': 'Ask about paragraph',
  'Аккаунт': 'Account',
  'Войти в аккаунт': 'Sign in to an account',
  'Войти (необязательно)': 'Sign in (optional)',
  'Здравствуйте,': 'Hello,',
  'Открыт административный доступ.': 'Administrative access is enabled.',
  'Сервер бесплатно разбирает': 'The server analyses',
  'новых книг в неделю': 'new books a week for free.',
  'API-ключ': 'API key',
  'Личный ключ (необязательно)': 'Personal key (optional)',
  'Открываю книгу с сервера…': 'Opening the book from the server…',
  'Книга пока недоступна': 'The book is not available yet',
  'Загружаю оригинал и структуру из общей библиотеки.':
    'Loading the original and structure from the shared library.',
  'Найдите книгу в общей библиотеке или добавьте её по ссылке или из файла.':
    'Find the book in the shared library or add it by URL or from a file.',
  'В вашей библиотеке': 'In your library',
  'Открыть книгу': 'Open the book',
  'Книга': 'Book',
  'Внутри этого фрагмента': 'Inside this fragment',
  'Архив библиотеки превышает 50 МБ.': 'The library archive exceeds 50 MB.',
  'Это не архив библиотеки Figlet или он повреждён.':
    'This is not a Figlet library archive, or it is damaged.',
  'Платёж ещё подтверждается. Обновите страницу через минуту.':
    'The payment is still being confirmed. Refresh the page in a minute.',
  'Платёж не завершён. Попробуйте ещё раз.':
    'The payment was not completed. Please try again.',
  'Составляю маршрут чтения…': 'Building a reading route…',
  'Ищу текст в открытой библиотеке…': 'Searching the open library…',
  'Сервер не ответил. Проверьте подключение и повторите запрос.':
    'The server did not respond. Check the connection and try again.',
  'Не удалось выполнить запрос.': 'Could not complete the request.',
  'Не удалось выполнить действие.': 'Could not complete the action.',
  'Не удалось создать платёж.': 'Could not create the payment.',
  'Что хотите понять в этой фразе?': 'What do you want to understand in this phrase?',
  'Почему автор так считает?': 'Why does the author think so?',
  'Ответ будет учитывать выделенный фрагмент.':
    'The answer will take the selected passage into account.',
  'Вопрос относится к текущему разделу.': 'The question refers to the current section.',
  // Book page deletion and related copy.
  'Удалить книгу из библиотеки': 'Delete the book from the library',
  'Удалить книгу': 'Delete the book',
  '» с этого устройства? Позиция чтения и локальные вопросы уйдут; разборы на сервере сохранятся.':
    '” from this device? The reading position and local questions go away; server-side analyses remain.',
  'Удаляю книгу с сервера…': 'Removing the book from the server…',
  'Удалить с устройства': 'Delete from this device',
  'Удалить с сервера (админ)': 'Delete from the server (admin)',
  'Книга удалена из библиотеки этого устройства.': 'The book is removed from this device.',
  'Книга удалена с сервера и с этого устройства.':
    'The book is removed from the server and from this device.',
};

export function translate(lang: Lang, ru: string): string {
  return lang === 'ru' ? ru : en[ru] ?? ru;
}

// The app re-renders on language change, so a module-level locale is enough
// for helpers defined outside the App component (Rating etc.).
let current: Lang = 'ru';
export function setLang(lang: Lang) {
  current = lang;
}
export function t(ru: string): string {
  return translate(current, ru);
}

export function readLang(): Lang {
  const cookie = document.cookie
    .split('; ')
    .find((x) => x.startsWith('figlet_lang='))
    ?.slice('figlet_lang='.length);
  if (cookie === 'en' || cookie === 'ru') return cookie;
  return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'ru';
}
