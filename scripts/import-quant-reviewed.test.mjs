import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReviewedPack, importReviewedDrafts } from './import-quant-reviewed.mjs';

// Authored unit-test fixtures only; they are not publisher questions or license evidence.
const actorId = '11111111-1111-4111-8111-111111111111';
function pack() { return { schemaVersion: 1, packId: 'fixture-reviewed-v1', publisher: 'almufakir', title: 'Private importer test fixture', attribution: 'Authored local test content',
  sourceFileHash: 'a'.repeat(64), sourceFileName: 'test-fixture.pdf', reviewStatus: 'reviewed', questions: [
    { ref: 'fixture-001', sourcePage: 1, sourceQuestionNumber: '1', stem: 'مسألة أصلية للاختبار: ما حاصل جمع ٢ و٣؟', choices: [{ key: 'A', text: '5' }, { key: 'B', text: '6' }], correctKey: 'A',
      explanation: 'الحساب المباشر: جمع اثنين وثلاثة يعطينا خمسة.', skill: 'الحساب والعمليات الأساسية', difficulty: 'easy', images: [], review: { status: 'reviewed', reviewer: 'Local fixture reviewer', note: 'Authored fixture: arithmetic and answer independently checked.' } },
    { ref: 'fixture-002', sourcePage: 2, stem: 'مسألة أخرى أصلية للاختبار: ما حاصل جمع ٤ و٤؟', choices: [{ key: 'A', text: '8' }, { key: 'B', text: '9' }], correctKey: 'A',
      explanation: 'الحساب المباشر: جمع أربعة وأربعة يعطينا ثمانية.', skill: 'الحساب والعمليات الأساسية', difficulty: 'easy', images: [], review: { status: 'reviewed', reviewer: 'Local fixture reviewer', note: 'Authored fixture: arithmetic and answer independently checked.' } },
  ] }; }
const reviewed = value => ({ pack: value, fileHash: 'b'.repeat(64) });
function database({ license = 'verified', note = 'Original fixture permission, valid only for local automated tests.', activeActor = true, sourceMissing = false, fileName = 'test-fixture.pdf', pageCount = 2, duplicate = false } = {}) {
  const queries = [], stored = new Map(), reviews = new Map(), fingerprints = new Map();
  const source = { id: 'local-source', license_status: license, license_note: note, file_name: fileName, title: 'Authored test fixture', page_count: pageCount };
  return { queries, stored, async query(sql, args = []) {
    queries.push({ sql, args });
    if (sql.startsWith('SELECT id FROM users')) return { rows: activeActor ? [{ id: actorId }] : [] };
    if (sql.startsWith('SELECT * FROM quant_sources')) return { rows: sourceMissing ? [] : [source] };
    if (sql.startsWith('SELECT id,name FROM education_categories')) return { rows: [{ id: 'local-category', name: 'الحساب والعمليات الأساسية' }] };
    if (sql.startsWith('SELECT q.id,q.content')) return { rows: stored.has(args[1]) ? [stored.get(args[1])] : [] };
    if (sql.startsWith('SELECT r.question_id')) return { rows: duplicate ? [{ question_id: 'other-question', version_id: 'other-version' }] : reviews.has(args[0]) ? [reviews.get(args[0])] : [] };
    if (sql.startsWith('SELECT id FROM education_questions')) return { rows: fingerprints.has(args[0]) ? [{ id: fingerprints.get(args[0]) }] : [] };
    if (sql.startsWith('INSERT INTO education_questions')) {
      const content = JSON.parse(args[5]); stored.set(content.licensedPackRef, { id: args[0], content, version_id: '' }); fingerprints.set(args[3], args[0]);
    }
    if (sql.startsWith('INSERT INTO education_question_versions')) for (const item of stored.values()) if (item.id === args[1]) item.version_id = args[0];
    if (sql.startsWith('INSERT INTO quant_question_reviews')) reviews.set(args[4], { question_id: args[1], version_id: args[0], source_id: args[2], source_page: args[3] });
    return { rows: [], rowCount: 1 };
  } };
}
test('reviewed pack accepts reviewed questions with exact source pages and existing skills', () => {
  const summary = validateReviewedPack(pack(), ['الحساب والعمليات الأساسية']);
  assert.equal(summary.questions, 2); assert.equal(summary.approved, 0); assert.equal(summary.publishedTests, 0); assert.equal(summary.reviewStatus, 'needs_review');
});
test('unconfirmed structural drafts remain needs_review while incomplete review metadata is rejected', () => {
  let value = pack(); value.reviewStatus = 'needs_review'; value.questions[0].review.status = 'needs_review'; const summary = validateReviewedPack(value); assert.equal(summary.reviewStatus, 'needs_review'); assert.equal(summary.approved, 0); assert.equal(summary.independentlyChecked, 1);
  value = pack(); value.questions[0].review.status = 'raw'; assert.throws(() => validateReviewedPack(value), /QUESTION_REVIEW_REQUIRED/);
  value = pack(); value.questions[0].explanation = ''; assert.throws(() => validateReviewedPack(value), /INCOMPLETE_QUESTION/);
  value = pack(); value.questions[0].sourcePage = 0; assert.throws(() => validateReviewedPack(value), /INVALID_SOURCE_REFERENCE/);
});
test('choices, answer keys, references and taxonomy are validated', () => {
  let value = pack(); value.questions[0].choices[1].text = '٥'; assert.throws(() => validateReviewedPack(value), /DUPLICATE_CHOICES/);
  value = pack(); value.questions[0].correctKey = 'D'; assert.throws(() => validateReviewedPack(value), /CORRECT_KEY_NOT_IN_CHOICES/);
  value = pack(); value.questions[1].ref = value.questions[0].ref; assert.throws(() => validateReviewedPack(value), /INVALID_SOURCE_REFERENCE/);
  value = pack(); assert.throws(() => validateReviewedPack(value, ['not-the-existing-skill']), /SKILL_NOT_IN_EXISTING_TAXONOMY/);
});
test('whole-page paths, external URLs and unsupported figure metadata cannot be imported', () => {
  for (const figure of ['https://example.invalid/page.png', { kind: 'full_page', relativePath: 'page.png' }, { kind: 'stem_diagram', relativePath: '../page.png' }]) {
    const value = pack(); value.questions[0].images = [figure]; assert.throws(() => validateReviewedPack(value), /PRIVATE_FIGURE_UNAVAILABLE/);
  }
});
test('inactive operator and unverified/rejected/restricted source block writes', async () => {
  for (const options of [{ activeActor: false }, { sourceMissing: true }, { license: 'unverified' }, { license: 'rejected' }, { license: 'restricted' }, { note: '' }]) {
    const connection = database(options); await assert.rejects(() => importReviewedDrafts(connection, actorId, reviewed(pack())));
    assert.equal(connection.queries.some(item => item.sql.startsWith('INSERT INTO education_questions') || item.sql.startsWith('INSERT INTO quant_question_figures')), false);
    assert.equal(connection.queries.at(-1).sql, 'ROLLBACK');
  }
});
test('source mismatch or page outside registered PDF range is rejected', async () => {
  let connection = database({ fileName: 'different.pdf' }); await assert.rejects(() => importReviewedDrafts(connection, actorId, reviewed(pack())), /SOURCE_FILE_NAME_MISMATCH/);
  connection = database({ pageCount: 1 }); await assert.rejects(() => importReviewedDrafts(connection, actorId, reviewed(pack())), /SOURCE_PAGE_OUT_OF_RANGE/);
});
test('licensed import creates versioned needs_review drafts, provenance and no published tests', async () => {
  const connection = database(), value = reviewed(pack()), result = await importReviewedDrafts(connection, actorId, value);
  assert.equal(result.imported, 2); assert.equal(result.approved, 0); assert.equal(result.versions.length, 2);
  const questions = connection.queries.filter(item => item.sql.startsWith('INSERT INTO education_questions'));
  assert.equal(questions.length, 2); assert.ok(questions.every(item => item.sql.includes("'draft'")));
  assert.ok(connection.queries.filter(item => item.sql.startsWith('INSERT INTO quant_question_reviews')).every(item => item.sql.includes("'needs_review'")));
  assert.equal(connection.queries.filter(item => item.sql.startsWith('INSERT INTO quant_question_sources')).length, 2);
  assert.equal(connection.queries.some(item => item.sql.startsWith('INSERT INTO quant_tests') || item.sql.includes("'approved'")), false);
  const content = JSON.parse(questions[0].args[5]); assert.equal(content.rights, 'licensed'); assert.equal(content.sourceQuestionNumber, '1');
  const rerun = await importReviewedDrafts(connection, actorId, value); assert.equal(rerun.imported, 0); assert.equal(rerun.existing, 2);
});
test('changed stable reference and existing stem never overwrite or automatically attach sources', async () => {
  const connection = database(), value = reviewed(pack()); await importReviewedDrafts(connection, actorId, value);
  value.pack.questions[0].choices[0].text = '15';
  const changed = await importReviewedDrafts(connection, actorId, value); assert.equal(changed.conflicts.length, 1); assert.equal(changed.imported, 0);
  const duplicate = database({ duplicate: true }); const result = await importReviewedDrafts(duplicate, actorId, reviewed(pack()));
  assert.equal(result.duplicates.length, 2); assert.equal(result.imported, 0); assert.equal(result.versions.length, 0);
  assert.equal(duplicate.queries.some(item => item.sql.startsWith('INSERT INTO quant_question_sources') || item.sql.startsWith('UPDATE education_questions')), false);
});
