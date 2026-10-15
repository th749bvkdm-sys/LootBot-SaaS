import assert from 'node:assert/strict';

/** Explicit remote QA branch or the disposable, schema-scoped local runner only. */
export function assertTestDatabase() {
  const hostname = new URL(process.env.DATABASE_URL!).hostname;
  const remoteQa = /^ep-summer-recipe-b21ls93d(?:-pooler)?\.[a-z0-9.-]+\.neon\.tech$/.test(hostname);
  const disposableLocal = hostname === '127.0.0.1' && process.env.NODE_ENV === 'test' && /^teacher_qa_[a-f0-9]{32}$/.test(process.env.TEACHER_TEST_SCHEMA || '');
  assert.ok(remoteQa || disposableLocal, 'Only the isolated QA database or disposable local test schema is permitted.');
}
