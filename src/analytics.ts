type Metrika = ((...args: unknown[]) => void) & { a?: unknown[][]; l?: number };

export function initAnalytics() {
  if (location.hostname !== 'figlet.eaprelsky.ru') return;
  const target = window as Window & { ym?: Metrika; figletAnalytics?: boolean };
  if (target.figletAnalytics) return;
  target.figletAnalytics = true;
  target.ym ||= Object.assign(
    (...args: unknown[]) => {
      target.ym!.a!.push(args);
    },
    { a: [] as unknown[][], l: Date.now() },
  );
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://mc.yandex.ru/metrika/tag.js?id=112004441';
  document.head.appendChild(script);
  target.ym(112004441, 'init', {
    defer: true,
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: false,
  });
  let previous = '';
  const hit = () => {
    const url = location.href;
    if (url === previous) return;
    target.ym!(112004441, 'hit', url, {
      title: document.title,
      referer: previous || document.referrer,
    });
    previous = url;
  };
  hit();
  window.addEventListener('hashchange', hit);
}
