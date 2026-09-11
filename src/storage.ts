import { openDB } from 'idb';
import type { Book } from './tree';
const db = openDB('figlet', 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('routes')) db.createObjectStore('routes');
    if (!db.objectStoreNames.contains('authors'))
      db.createObjectStore('authors', { keyPath: 'id' });
  },
});
export const storage = {
  async books(): Promise<Book[]> {
    return (await db).getAll('books');
  },
  async save(book: Book) {
    return (await db).put('books', book);
  },
  async remove(id: string) {
    return (await db).delete('books', id);
  },
  async route(key: string) {
    return (await db).get('routes', key);
  },
  async saveRoute(key: string, value: unknown) {
    return (await db).put('routes', value, key);
  },
  async authors() {
    return (await db).getAll('authors');
  },
  async saveAuthor(author: { id: string }) {
    return (await db).put('authors', author);
  },
};
export function getCookie(name: string) {
  return document.cookie
    .split('; ')
    .find((x) => x.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
export function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
}
export function validBook(value: unknown): value is Book {
  if (!value || typeof value !== 'object') return false;
  const b = value as Book;
  if (
    typeof b.id !== 'string' ||
    !/^[a-f0-9]{24}$/.test(b.id) ||
    typeof b.title !== 'string' ||
    typeof b.author !== 'string' ||
    !Array.isArray(b.paragraphs) ||
    !b.paragraphs.every((p) => typeof p === 'string') ||
    b.paragraphs.join('').length > 5000000 ||
    !b.nodes?.root ||
    !b.analyses ||
    !b.answers ||
    !Array.isArray(b.warnings)
  )
    return false;
  const nodes = Object.values(b.nodes);
  if (
    nodes.length > 100000 ||
    b.nodes.root.parent !== null ||
    b.nodes.root.start !== 0 ||
    b.nodes.root.end !== b.paragraphs.length ||
    !b.nodes[b.currentNode]
  )
    return false;
  if (
    !nodes.every(
      (n) =>
        typeof n.id === 'string' &&
        typeof n.title === 'string' &&
        b.nodes[n.id] === n &&
        Number.isInteger(n.start) &&
        Number.isInteger(n.end) &&
        n.start >= 0 &&
        n.end <= b.paragraphs.length &&
        n.start < n.end &&
        Array.isArray(n.children) &&
        n.children.every(
          (c) =>
            b.nodes[c]?.parent === n.id &&
            b.nodes[c].start >= n.start &&
            b.nodes[c].end <= n.end &&
            c !== n.id,
        ) &&
        (n.parent === null || !!b.nodes[n.parent]),
    )
  )
    return false;
  const visited = new Set<string>();
  const pending = ['root'];
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) return false;
    visited.add(id);
    pending.push(...b.nodes[id].children);
  }
  if (visited.size !== nodes.length) return false;
  if (
    !Object.values(b.analyses).every(
      (a) =>
        a &&
        typeof a.summary === 'string' &&
        Array.isArray(a.ideas) &&
        a.ideas.every((i) => typeof i === 'string') &&
        Array.isArray(a.children) &&
        a.children.every(
          (c) =>
            typeof c.id === 'string' &&
            typeof c.title === 'string' &&
            typeof c.summary === 'string',
        ),
    )
  )
    return false;
  return Object.values(b.answers).every(
    (list) =>
      Array.isArray(list) &&
      list.every(
        (a) =>
          typeof a.question === 'string' &&
          typeof a.answer === 'string' &&
          (a.quote === undefined || typeof a.quote === 'string'),
      ),
  );
}
