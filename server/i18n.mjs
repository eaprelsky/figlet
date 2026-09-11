// Server-side localization of user-facing errors. The client sends figlet_lang
// with every request; Accept-Language is the fallback for first-time visitors.
export function detectLocale(req) {
  const cookie = /(?:^|;\s*)figlet_lang=(en|ru)\b/.exec(String(req.headers.cookie || ''));
  if (cookie) return cookie[1];
  return String(req.headers['accept-language'] || '').toLowerCase().startsWith('en') ? 'en' : 'ru';
}

const en = {
  'Адрес должен вести на публичный сайт.': 'The address must point to a public website.',
  'В EPUB не найдено оглавление.': 'No table of contents found in the EPUB.',
  'В PDF нет текстового слоя. Распознайте скан (OCR) или загрузите EPUB, FB2 либо TXT.':
    'The PDF has no text layer. Run OCR on the scan or upload EPUB, FB2 or TXT.',
  'Введите название книги или автора (до 500 символов).':
    'Enter a book title or author (up to 500 characters).',
  'Викитека временно не отвечает. Попробуйте ссылку или файл.':
    'Wikisource is not responding. Try a URL or a file.',
  'Выберите файл книги.': 'Choose a book file.',
  'Выделенный текст не найден в этом разделе. Выберите его заново.':
    'The selected text was not found in this section. Select it again.',
  'Для разбора нужен ключ. Добавьте его в настройках.':
    'A key is required for analysis. Add it in Settings.',
  'Дневной лимит новых AI-запросов исчерпан. Сохранённые разборы и оригиналы доступны.':
    'The daily limit of new AI requests is used up. Saved analyses and originals remain available.',
  'Запрос разрешён только из Figlet.': 'The request is allowed only from Figlet.',
  'Источник прервал соединение. Попробуйте ещё раз или добавьте файл книги.':
    'The source dropped the connection. Try again or add a book file.',
  'Книга не найдена в каталоге.': 'The book was not found in the catalog.',
  'Книга пока не добавлена в общую библиотеку.':
    'The book has not been added to the shared library yet.',
  'Лимит новых разборов исчерпан.': 'The limit of new analyses is used up.',
  'Лимит — 40 новых разборов и вопросов в час. Сохранённые доступны без ограничений.':
    'The limit is 40 new analyses and questions per hour. Saved ones are unlimited.',
  'Логин: 3–63 символа — буквы, цифры, точка, дефис или подчёркивание.':
    'Login: 3–63 characters — letters, digits, dot, hyphen or underscore.',
  'Модель вернула неполный разбор. Повторите запрос.':
    'The model returned an incomplete analysis. Try again.',
  'Модель не вернула ответ. Повторите вопрос.':
    'The model returned no answer. Ask again.',
  'Модель не завершила саммари разделов. Повторите загрузку.':
    'The model did not finish the section summaries. Try loading again.',
  'Модель не ответила вовремя. Попробуйте ещё раз: готовые разборы сохранены.':
    'The model did not answer in time. Try again: finished analyses are saved.',
  'На странице не найден текст книги. Укажите прямую ссылку на текст или загрузите файл.':
    'No book text found on the page. Give a direct text URL or upload a file.',
  'На счёте провайдера недостаточно средств.':
    'The provider account is out of funds.',
  'Назовите автора, книгу или интересующую идею.':
    'Name an author, a book or an idea of interest.',
  'Напишите вопрос по тексту.': 'Write a question about the text.',
  'Не удалось найти сайт по этому адресу.': 'Could not resolve the website at this address.',
  'Не удалось обработать запрос. Попробуйте другой файл, ссылку или повторите позже.':
    'Could not process the request. Try another file or URL, or retry later.',
  'Не удалось открыть EPUB. Проверьте файл.': 'Could not open the EPUB. Check the file.',
  'Не удалось получить модели. Проверьте ключ.':
    'Could not fetch the model list. Check the key.',
  'Не удалось составить маршрут. Уточните автора или тему.':
    'Could not build a route. Clarify the author or topic.',
  'Неверный логин или пароль.': 'Wrong login or password.',
  'Неизвестный платёж.': 'Unknown payment.',
  'Некорректный идентификатор.': 'Invalid identifier.',
  'Некорректный идентификатор модели.': 'Invalid model identifier.',
  'Некорректный текст раздела.': 'Invalid section text.',
  'Оплата пока не настроена на сервере.': 'Payments are not configured on the server yet.',
  'Пароль: минимум 8 символов.': 'Password: at least 8 characters.',
  'Платёж не найден для этого читателя.': 'Payment not found for this reader.',
  'Платёжный сервис не ответил. Попробуйте ещё раз позже.':
    'The payment service did not respond. Try again later.',
  'Поддерживаются TXT, Markdown, HTML, FB2, EPUB и PDF.':
    'Supported formats are TXT, Markdown, HTML, FB2, EPUB and PDF.',
  'Поддерживаются провайдеры: OpenAI-совместимый или Anthropic.':
    'Supported providers: OpenAI-compatible or Anthropic.',
  'Поддерживаются только публичные HTTP- и HTTPS-адреса на стандартных портах.':
    'Only public HTTP and HTTPS URLs on standard ports are supported.',
  'Провайдер ограничил частоту запросов. Попробуйте немного позже.':
    'The provider rate-limited the requests. Try again a bit later.',
  'Провайдер отклонил ключ. Проверьте его в настройках.':
    'The provider rejected the key. Check it in Settings.',
  'Разбор не поместился в ответ модели. Попробуйте открыть меньший раздел.':
    'The analysis did not fit into the model response. Try a smaller section.',
  'Сейчас читают несколько человек. Повторите запрос через минуту.':
    'Several people are reading right now. Retry in a minute.',
  'Слишком много запросов. Попробуйте через несколько минут.':
    'Too many requests. Try again in a few minutes.',
  'Слишком много перенаправлений на сайте.': 'Too many redirects on the website.',
  'Слишком много попыток входа. Подождите немного.':
    'Too many sign-in attempts. Please wait.',
  'Такого API-метода нет.': 'No such API method.',
  'Такой логин уже занят.': 'This login is already taken.',
  'Только для администратора.': 'Administrators only.',
  'Укажите URL книги.': 'Provide a book URL.',
  'Укажите книгу для разбора.': 'Provide a book to analyse.',
  'Укажите корректный идентификатор модели.': 'Provide a valid model identifier.',
  'Укажите название (до 300 символов).': 'Provide a title (up to 300 characters).',
  'Укажите полный URL, начиная с https://.': 'Provide a full URL starting with https://.',
  'Файл слишком большой. Максимум — 10 МБ.': 'The file is too large. Maximum is 10 MB.',
  'EPUB слишком большой после распаковки.': 'The EPUB is too large after unpacking.',
  'Эта модель недоступна. Выберите модель в настройках.':
    'This model is unavailable. Pick a model in Settings.',
};

export function translateError(message, locale) {
  if (locale !== 'en' || typeof message !== 'string') return message;
  if (en[message]) return en[message];
  // The only dynamic message we localize by prefix.
  if (message.startsWith('На этой неделе вы уже разобрали')) {
    const count = /(\d+)/.exec(message)?.[1] || '5';
    return `You have already analysed ${count} new books on the server's key this week. Connect your own key in Settings or subscribe — saved books keep working.`;
  }
  return message;
}
