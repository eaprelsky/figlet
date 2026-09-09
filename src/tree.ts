export type Section = {
  id: string;
  title: string;
  start: number;
  end: number;
  parent: string | null;
  children: string[];
};
export type Analysis = {
  summary: string;
  ideas: string[];
  importance: number;
  why: string;
  skip: string;
  children: { id: string; title: string; summary: string; importance: number }[];
  model?: string;
  createdAt?: number;
  coverage?: string;
};
export type Book = {
  id: string;
  title: string;
  author: string;
  authorId?: string;
  sourceUrl: string;
  sourceLabel: string;
  warnings: string[];
  paragraphs: string[];
  nodes: Record<string, Section>;
  createdAt: number;
  updatedAt: number;
  currentNode: string;
  currentLevel?: number;
  currentAnchor?: number;
  nodeAliases?: Record<string, string>;
  analyses: Record<string, Analysis>;
  answers: Record<string, { question: string; answer: string; quote?: string }[]>;
};
export function resolveNodeId(book: Book, id: string): string {
  const visited = new Set<string>();
  while (!book.nodes[id] && typeof book.nodeAliases?.[id] === 'string' && !visited.has(id)) {
    visited.add(id);
    id = book.nodeAliases[id];
  }
  return id;
}

// Imported chapter pages can repeat their title beneath the table-of-contents title.
// A semantic step must narrow the source range, not visit another wrapper for it.
export function normalizeBook(book: Book): Book {
  const nodes = { ...book.nodes };
  const aliases = { ...book.nodeAliases };
  const analyses = { ...book.analyses };
  const answers = { ...book.answers };
  let changed = false;
  const pending = ['root'];
  while (pending.length) {
    const id = pending.pop()!;
    let node = nodes[id];
    while (node.children.length === 1) {
      const child = nodes[node.children[0]];
      if (child.start !== node.start || child.end !== node.end) break;
      changed = true;
      node = nodes[id] = { ...node, children: [...child.children] };
      for (const grandchild of child.children)
        nodes[grandchild] = { ...nodes[grandchild], parent: id };
      aliases[child.id] = id;
      // Both nodes summarize the same original; keep a valid cached summary.
      if (analyses[child.id]) analyses[id] = analyses[child.id];
      else if (analyses[id]) analyses[id] = { ...analyses[id], children: [] };
      if (answers[child.id]) answers[id] = [...(answers[id] || []), ...answers[child.id]];
      delete nodes[child.id];
      delete analyses[child.id];
      delete answers[child.id];
    }
    pending.push(...node.children);
  }
  if (!changed) return book;
  const result = { ...book, nodes, analyses, answers, nodeAliases: aliases };
  result.currentNode = resolveNodeId(result, book.currentNode);
  result.currentLevel = Math.max(0, ancestors(result, result.currentNode).length - 1);
  return result;
}
export function expandNode(book: Book, nodeId: string): Book {
  const node = book.nodes[nodeId];
  if (!node || node.children.length || node.end - node.start <= 1) return book;
  const nodes = { ...book.nodes };
  const children: string[] = [];
  const step = Math.max(1, Math.ceil((node.end - node.start) / 5));
  for (let start = node.start; start < node.end; start += step) {
    const end = Math.min(start + step, node.end);
    const id = `${nodeId}:${start}-${end}`;
    const first = book.paragraphs[start];
    const short = first.split(/(?<=[.!?])\s/)[0];
    const title = short.length > 100 ? `${short.slice(0, 97)}…` : short;
    nodes[id] = { id, title, start, end, parent: nodeId, children: [] };
    children.push(id);
  }
  nodes[nodeId] = { ...node, children };
  return { ...book, nodes };
}
export function ancestors(book: Book, nodeId: string): Section[] {
  const result: Section[] = [];
  let node: Section | undefined = book.nodes[nodeId];
  while (node) {
    result.unshift(node);
    node = node.parent ? book.nodes[node.parent] : undefined;
  }
  return result;
}
export function readingMinutes(paragraphs: string[]): number {
  return Math.max(1, Math.ceil(paragraphs.join(' ').split(/\s+/).length / 190));
}
export function frontierAt(book: Book, level: number): { book: Book; pages: string[] } {
  let expanded = book;
  const pages: string[] = [];
  function visit(id: string, depth: number) {
    const node = expanded.nodes[id];
    if (depth >= level || node.end - node.start <= 1) {
      pages.push(id);
      return;
    }
    expanded = expandNode(expanded, id);
    const children = expanded.nodes[id].children;
    if (!children.length) pages.push(id);
    else children.forEach((child) => visit(child, depth + 1));
  }
  visit('root', 0);
  return { book: expanded, pages };
}
