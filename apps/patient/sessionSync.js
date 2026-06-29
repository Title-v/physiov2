import { apiPost } from '../../shared/core/api.js';
import { buildPracticeSessionPayload } from '../../shared/practice/session.js';

function toMs(value) {
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const date = Number(new Date(value));
  return Number.isFinite(date) ? date : 0;
}

export async function savePracticeSession({
  exercise = {},
  planItems = [],
  run = null,
  endedAt = Date.now(),
  postSession = apiPost,
} = {}) {
  if (!run?.summary) return null;
  const payload = buildPracticeSessionPayload({
    exercise,
    planItems,
    summary: run.summary,
    reference: run.reference,
    endedAt,
  });
  try {
    const saved = await postSession('/sessions', payload);
    return { ...payload, ...saved, endedAt: toMs(saved.endedAt ?? endedAt) };
  } catch {
    return payload;
  }
}
