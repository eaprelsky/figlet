import { expandNode, normalizeBook, ancestors } from '../src/tree.ts';
import { defaultModel } from './ai.mjs';

// Whole-book background indexing. Priority: what the reader opened, then
// sections the parent analyses marked as most important, then document order.
const MAX_NODES_PER_JOB = Number(process.env.INDEXER_MAX_NODES || 150);
const MIN_LEAF_PARAGRAPHS = 6; // deeper fragments stay on-demand

export function createIndexer({ cache, catalog, analyze, key, model = defaultModel, budget }) {
  const state = new Map(); // editionId -> { status, done, total, model }
  const generation = new Map(); // editionId -> run token

  function status(editionId) {
    return state.get(editionId) || { status: 'idle', done: 0, total: 0 };
  }
  function analyses(editionId, requestedModel) {
    return catalog.analyses(editionId, requestedModel || model);
  }
  function request(editionId, current = 'root', requestedModel = model) {
    const book = catalog.book(editionId);
    if (!book) return { ...status(editionId), error: 'Книга не найдена в каталоге.' };
    if (state.get(editionId)?.status === 'running') return status(editionId);
    state.set(editionId, { status: 'running', done: 0, total: 0, model: requestedModel });
    const token = Symbol('run');
    generation.set(editionId, token);
    setImmediate(() =>
      run(editionId, current, requestedModel, token).catch((error) => {
        if (generation.get(editionId) === token)
          state.set(editionId, {
            ...status(editionId),
            status: error?.status === 429 ? 'paused' : 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
      }),
    );
    return status(editionId);
  }

  async function run(editionId, current, modelId, token) {
    let book = normalizeBook(catalog.book(editionId));
    book = expandNode(book, 'root');
    const queue = []; // { id, importance, start }
    const push = (id, importance = 3) => {
      const node = book.nodes[id];
      if (node) queue.push({ id, importance, start: node.start });
    };
    const tracked = new Set();
    const track = (id) => {
      if (tracked.has(id)) return false;
      tracked.add(id);
      return true;
    };
    // The reader's current path first: root → … → current section.
    const currentResolved = book.nodes[current] ? current : 'root';
    const path = ancestors(book, currentResolved).map((n) => n.id);
    const progress = { status: 'running', done: 0, total: path.length, model: modelId };
    state.set(editionId, progress);

    async function analyzeNode(nodeId) {
      const expanded = expandNode(book, nodeId);
      book = expanded;
      const section = book.nodes[nodeId];
      const input = {
        model: modelId,
        title: book.title,
        author: book.author,
        section: section.title,
        paragraphs: book.paragraphs.slice(section.start, section.end),
        children: section.children.map((id) => {
          const child = book.nodes[id];
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
      };
      const result = await cache.remember(
        'analyze',
        { provider: process.env.AI_BASE_URL || 'https://api.deepseek.com', ...input },
        () => budget(() => analyze(input, key)),
      );
      catalog.saveAnalysis(editionId, nodeId, modelId, result.value);
      progress.done++;
      state.set(editionId, { ...progress });
      return result.value;
    }

    for (const id of path) {
      if (generation.get(editionId) !== token) return;
      await analyzeNode(id);
    }
    // Children of path nodes enter the queue by reported importance.
    for (const id of path) {
      const node = book.nodes[id];
      const analysis = catalog.analyses(editionId, modelId)[id];
      const weights = new Map(
        (analysis?.children || []).map((child) => [child.id, child.importance]),
      );
      for (const child of node.children)
        if (track(child)) push(child, weights.get(child) || 3);
    }
    queue.sort((a, b) => b.importance - a.importance || a.start - b.start);
    while (queue.length) {
      if (generation.get(editionId) !== token) return;
      if (tracked.size >= MAX_NODES_PER_JOB) {
        state.set(editionId, { ...progress, status: 'done', capped: true });
        return;
      }
      const { id } = queue.shift();
      const node = book.nodes[id];
      if (!node || node.end - node.start < 1) continue;
      const analysis = await analyzeNode(id);
      if (node.end - node.start > MIN_LEAF_PARAGRAPHS) {
        expandNode(book, id);
        const weights = new Map(
          (analysis?.children || []).map((child) => [child.id, child.importance]),
        );
        const children = book.nodes[id].children
          .map((child) => ({ id: child, start: book.nodes[child].start }))
          .filter(({ id: child }) => track(child));
        for (const child of children) push(child, weights.get(child.id) || 3);
        queue.sort((a, b) => b.importance - a.importance || a.start - b.start);
      }
      progress.total = tracked.size;
      state.set(editionId, { ...progress });
    }
    state.set(editionId, { ...progress, total: tracked.size, status: 'done' });
  }

  return { request, status, analyses };
}
