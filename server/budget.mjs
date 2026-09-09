import { AppError } from './network.mjs';
// An in-process ceiling supplements per-IP limits. No prompts or keys are retained.
let day = '',
  requests = 0,
  inFlight = 0;
export async function withAiBudget(action) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    requests = 0;
  }
  if (requests >= Number(process.env.AI_DAILY_REQUEST_LIMIT || 500))
    throw new AppError(
      'Дневной лимит новых AI-запросов исчерпан. Сохранённые разборы и оригиналы доступны.',
      429,
    );
  if (inFlight >= 4)
    throw new AppError('Сейчас читают несколько человек. Повторите запрос через минуту.', 429);
  requests++;
  inFlight++;
  try {
    return await action();
  } finally {
    inFlight--;
  }
}
