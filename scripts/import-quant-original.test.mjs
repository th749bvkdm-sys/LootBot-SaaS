import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOriginalPack, validateOriginalPack, registerOriginalSource, importOriginalDrafts } from './import-quant-original.mjs';

const original = await loadOriginalPack();
const copy = () => structuredClone(original.pack);
const skills = Object.keys(original.summary.bySkill);
test('authored pack has 30 verified calculations, 13 real skills and stable unique references', () => {
  const summary = validateOriginalPack(original.pack, skills);
  assert.equal(summary.questions, 30); assert.equal(summary.mathVerified, 30); assert.equal(summary.skills, 13);
  assert.equal(new Set(original.pack.questions.map(question => question.ref)).size, 30);
});
test('changing a key away from the computed answer is rejected', () => {
  for (let index = 0; index < 30; index++) {
    const pack = copy(), question = pack.questions[index];
    question.correctKey = question.choices.find(choice => choice.key !== question.correctKey).key;
    assert.throws(() => validateOriginalPack(pack, skills), /MATH_ANSWER_MISMATCH/);
  }
});
test('duplicate choices, moved source references and unsupported skills are rejected', () => {
  let pack = copy(); pack.questions[0].choices[1].text = pack.questions[0].choices[0].text;
  assert.throws(() => validateOriginalPack(pack, skills), /DUPLICATE_CHOICES/);
  pack = copy(); pack.questions[1].sourcePage = 1;
  assert.throws(() => validateOriginalPack(pack, skills), /UNSTABLE_SOURCE_REFERENCE/);
  pack = copy(); pack.questions[0].skill = 'مهارة غير موجودة';
  assert.throws(() => validateOriginalPack(pack, skills), /SKILL_NOT_IN_EXISTING_TAXONOMY/);
});
test('equation, sequence and constant-comparison verifier rejects incorrect models', () => {
  let pack = copy(); pack.questions[14].verification.right = 22;
  assert.throws(() => validateOriginalPack(pack, skills), /MATH_ANSWER_MISMATCH/);
  pack = copy(); pack.questions[28].verification.terms[2] = 16;
  assert.throws(() => validateOriginalPack(pack, skills), /NOT_ARITHMETIC_SEQUENCE/);
  pack = copy(); pack.questions[27].verification.right.coefficient = 2;
  assert.throws(() => validateOriginalPack(pack, skills), /NON_CONSTANT_AFFINE_COMPARISON/);
});
function fakeDatabase(status = 'verified', licenseNote = 'وثيقة تأليف أصلي لاختبار محلي فقط.') {
  const queries = [], reviews = new Map(), fingerprints = new Map();
  const source = { id: 'local-source-fixture', license_status: status, license_note: licenseNote };
  return { queries, async query(sql, args = []) {
    queries.push({ sql, args });
    if (sql.startsWith('SELECT * FROM quant_sources')) return { rows: [source] };
    if (sql.startsWith('SELECT id,license_status FROM quant_sources')) return { rows: [] };
    if (sql.startsWith('SELECT id,name FROM education_categories')) return { rows: skills.map((name, index) => ({ id: 'local-category-' + index, name })) };
    if (sql.startsWith('SELECT r.question_id')) return { rows: reviews.has(args[0]) ? [reviews.get(args[0])] : [] };
    if (sql.startsWith('SELECT id FROM education_questions')) return { rows: fingerprints.has(args[0]) ? [{ id: fingerprints.get(args[0]) }] : [] };
    if (sql.startsWith('INSERT INTO education_questions')) fingerprints.set(args[3], args[0]);
    if (sql.startsWith('INSERT INTO quant_question_reviews')) reviews.set(args[4], { question_id: args[1], source_id: args[2], source_page: args[3] });
    return { rows: [], rowCount: 1 };
  } };
}
test('registering authored source writes metadata only without approving a license', async () => {
  const connection = fakeDatabase();
  const result = await registerOriginalSource(connection, 'local-admin-fixture', original);
  assert.equal(result.licenseStatus, 'unverified'); assert.equal(result.imported, 0);
  assert.equal(connection.queries.filter(query => query.sql.startsWith('INSERT INTO quant_sources')).length, 1);
  assert.equal(connection.queries.some(query => query.sql.includes('INSERT INTO education_questions')), false);
});
test('draft import rejects unverified, restricted, rejected and empty-proof sources before question writes', async () => {
  for (const status of ['unverified', 'restricted', 'rejected']) {
    const connection = fakeDatabase(status);
    await assert.rejects(() => importOriginalDrafts(connection, 'local-admin-fixture', original), /SOURCE_NOT_LICENSED/);
    assert.equal(connection.queries.some(query => query.sql.includes('INSERT INTO education_questions')), false);
  }
  const empty = fakeDatabase('verified', '');
  await assert.rejects(() => importOriginalDrafts(empty, 'local-admin-fixture', original), /LICENSE_NOTE_MISSING/);
  assert.equal(empty.queries.some(query => query.sql.includes('INSERT INTO education_questions')), false);
});
test('verified import writes 30 drafts, is idempotent, never approves and never creates tests', async () => {
  const connection = fakeDatabase();
  const first = await importOriginalDrafts(connection, 'local-admin-fixture', original);
  assert.equal(first.imported, 30); assert.equal(first.approved, 0); assert.equal(first.publishedTests, 0);
  const second = await importOriginalDrafts(connection, 'local-admin-fixture', original);
  assert.equal(second.imported, 0); assert.equal(second.existing, 30); assert.equal(second.duplicates.length, 0);
  const questionWrites = connection.queries.filter(query => query.sql.startsWith('INSERT INTO education_questions'));
  assert.equal(questionWrites.length, 30); assert.ok(questionWrites.every(query => query.sql.includes("'draft'")));
  assert.equal(connection.queries.some(query => query.sql.includes('INSERT INTO quant_tests') || query.sql.includes("'approved'")), false);
});
