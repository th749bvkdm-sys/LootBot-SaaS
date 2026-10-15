/** Focused result-contract checks; all content and provenance below are synthetic fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { quantResult, snapshotItem, type QuantItem } from '../src/lib/quant';

const sha = 'a'.repeat(64), source = { id: 'source-fixture', title: 'مصدر محلي للاختبار', file_hash: sha, license_status: 'verified' };
const row = () => ({ version_id: 'version-fixture', question_id: 'question-fixture', source_id: source.id, source_page: 8,
  category_id: 'category-fixture', skill: 'مسائل كمية متنوعة', source_title: source.title, source_file_hash: sha, source_page_count: 20,
  review_status: 'approved', reviewed_by: 'reviewer-fixture', author_id: 'author-fixture', license_status: 'verified', license_note: 'إذن اصطناعي للاختبار',
  track: 'quantitative', visible: true, archived: false,
  snapshot: { text: 'سؤال نتيجة أصلي للاختبار', content: { answer: 0, options: [{ text: '1' }, { text: '2' }],
    publisher: 'almufakir', sourceQuestionNumber: '3', sourceSection: 'القسم 1', explanation: 'الإجابة أ بحسب مفتاح المصدر؛ لا يحتوي المصدر شرحًا.' } } });
const mockQuery = (responses: any[], licensed = true) => ({ query: async (sql: string) => ({ rows: sql.includes('quant_responses') ? responses : [{ ...source, license_status: licensed ? 'verified' : 'restricted' }] }) }) as any;
const attempt = (items: QuantItem[], policy = 'after_submit', status = 'submitted') => ({ id: 'attempt-fixture', status,
  test_snapshot: { title: 'القسم 1', mode: 'timed', revealPolicy: policy, revealAt: policy === 'after_deadline' ? new Date(Date.now() + 3600000).toISOString() : null },
  started_at: '2026-10-14T08:00:00Z', submitted_at: status === 'in_progress' ? null : '2026-10-14T08:10:00Z', snapshot: items });

test('answer-key placeholders and original prose do not become sourced explanations', () => {
  const r = row(), item = snapshotItem(r, 0);
  assert.equal(item.explanation, ''); assert.equal(item.explanationSource, undefined);
  (r.snapshot.content as any).explanationProvenance = { publisher: 'almufakir', status: 'verified', sourceId: source.id, sourceFileHash: sha,
    sourcePage: 10, verifiedBy: 'reviewer-fixture', reviewedAt: '2026-10-14T09:00:00Z' };
  assert.ok(snapshotItem(r, 0).explanationSource);
  for (const changed of [
    { sourceId: 'different-source' }, { sourceFileHash: 'b'.repeat(64) }, { verifiedBy: 'author-fixture' },
    { status: 'draft' }, { sourcePage: 21 }, { publisher: 'original' }, { reviewedAt: 'invalid-date' },
  ]) {
    const invalid = structuredClone(r); Object.assign((invalid.snapshot.content as any).explanationProvenance, changed);
    assert.equal(snapshotItem(invalid, 0).explanationSource, undefined);
    assert.equal(snapshotItem(invalid, 0).explanation, '');
  }
  const original = structuredClone(r); original.snapshot.content.publisher = 'original';
  assert.equal(snapshotItem(original, 0).explanation, '');
});

test('results show exact wrong/unanswered outcomes, selected/source answers and safe source references', async () => {
  const first = snapshotItem(row(), 0), second = { ...first, versionId: 'version-second', questionId: 'question-second', position: 1 };
  const result = await quantResult(mockQuery([{ version_id: first.versionId, choice_key: 'B', flagged: true, change_count: 2, time_spent_ms: 45000 }]), attempt([first, second]));
  assert.equal(result.test.title, 'القسم 1'); assert.equal(result.attemptId, 'attempt-fixture');
  assert.equal(result.summary.wrong, 1); assert.equal(result.summary.unanswered, 1);
  assert.equal(result.items[0].outcome, 'wrong'); assert.equal(result.items[0].choiceKey, 'B'); assert.equal(result.items[0].correctKey, 'A');
  assert.equal(result.items[0].changeCount, 2); assert.equal(result.items[0].flagged, true);
  assert.equal(result.items[0].source.page, 8); assert.equal(result.items[0].source.questionNumber, '3'); assert.equal(result.items[0].source.section, 'القسم 1');
  assert.equal(result.items[1].outcome, 'unanswered'); assert.equal(result.items[1].correct, null);
  assert.ok(result.items.every(item => item.explanationAvailable === false && !('explanation' in item)));
  assert.ok(!/license_note|private_path|sourceFileHash|verifiedBy/.test(JSON.stringify(result)));
});

test('legacy attempt snapshots cannot leak their unauthenticated placeholder explanation', async () => {
  const item = { ...snapshotItem(row(), 0), explanation: 'قديم: الإجابة أ' };
  const result = await quantResult(mockQuery([]), attempt([item]));
  assert.equal(result.items[0].explanationAvailable, false); assert.ok(!('explanation' in result.items[0]));
});

test('never and withheld deadline policies omit keys and explanation metadata', async () => {
  const item = snapshotItem(row(), 0), responses = [{ version_id: item.versionId, choice_key: 'B', change_count: 0, time_spent_ms: 0 }];
  for (const policy of ['never', 'after_deadline']) {
    const result = await quantResult(mockQuery(responses), attempt([item], policy));
    assert.equal(result.revealed, false); assert.equal(result.items[0].outcome, 'hidden');
    assert.ok(!/correctKey|explanation|"correct":/.test(JSON.stringify(result.items)));
    if (policy === 'after_deadline') { assert.equal(result.summary.correct, null); assert.equal(result.summary.wrong, null); }
  }
});

test('active tests withhold result and after-each feedback only includes answered questions', async () => {
  const item = snapshotItem(row(), 0), second = { ...item, versionId: 'second', position: 1 };
  await assert.rejects(quantResult(mockQuery([]), attempt([item], 'after_submit', 'in_progress')), { code: 'ATTEMPT_ACTIVE' });
  const result = await quantResult(mockQuery([{ version_id: item.versionId, choice_key: 'A' }]), attempt([item, second], 'after_each', 'in_progress'));
  assert.equal(result.items.length, 1); assert.equal(result.items[0].outcome, 'correct'); assert.equal(result.items[0].correctKey, 'A');
});

test('only verified publisher explanation is returned, with safe provenance and live source license', async () => {
  const r = row(); (r.snapshot.content as any).explanationProvenance = { publisher: 'almufakir', status: 'verified', sourceId: source.id,
    sourceFileHash: sha, sourcePage: 10, verifiedBy: 'reviewer-fixture', reviewedAt: '2026-10-14T09:00:00Z' };
  r.snapshot.content.explanation = 'شرح اصطناعي مخصص لاختبار بوابة الإثبات فقط.';
  const item = snapshotItem(r, 0), result = await quantResult(mockQuery([]), attempt([item]));
  assert.equal(result.items[0].explanationAvailable, true); assert.equal(result.items[0].explanation, item.explanation);
  assert.deepEqual(result.items[0].explanationSource, { publisher: 'almufakir', page: 10, reviewedAt: '2026-10-14T09:00:00Z' });
  const revoked = await quantResult(mockQuery([], false), attempt([item]));
  assert.equal(revoked.items[0].explanationAvailable, false); assert.ok(!('explanation' in revoked.items[0]));
});
