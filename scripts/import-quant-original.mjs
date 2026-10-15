/** Imports only authored drafts. Never grants licenses, approves questions, or publishes tests. */
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultPack = path.join(rootPath, 'docs/quant/ORIGINAL_QUESTIONS.json');
const close = (a, b) => Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b));
const hash = text => createHash('sha256').update(text).digest('hex');
const normalize = text => text.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\s+/g, ' ').trim().toLowerCase();
const problem = (code, ref = '') => { throw new Error(code + (ref ? ':' + ref : '')); };
function numericChoice(text) {
  const value = text.trim();
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (/^-?\d+\/\d+$/.test(value)) { const [top, bottom] = value.split('/').map(Number); if (!bottom) problem('ZERO_DENOMINATOR'); return top / bottom; }
  problem('NON_NUMERIC_CHOICE');
}
export function evaluateOriginalExpression(expression, variable, depth = 0) {
  if (depth > 12) problem('EXPRESSION_TOO_DEEP');
  if (typeof expression === 'number' && Number.isFinite(expression)) return expression;
  if (expression?.variable === 'x' && Number.isFinite(variable)) return variable;
  if (!expression || !Array.isArray(expression.args) || expression.args.length < 2 || expression.args.length > 8) problem('INVALID_EXPRESSION');
  const values = expression.args.map(arg => evaluateOriginalExpression(arg, variable, depth + 1));
  let result;
  switch (expression.op) {
    case 'add': result = values.reduce((sum, number) => sum + number, 0); break;
    case 'mul': result = values.reduce((product, number) => product * number, 1); break;
    case 'sub': if (values.length !== 2) problem('INVALID_EXPRESSION'); result = values[0] - values[1]; break;
    case 'div': if (values.length !== 2 || values[1] === 0) problem('INVALID_EXPRESSION'); result = values[0] / values[1]; break;
    case 'pow': if (values.length !== 2) problem('INVALID_EXPRESSION'); result = values[0] ** values[1]; break;
    default: problem('UNKNOWN_EXPRESSION');
  }
  if (!Number.isFinite(result) || Math.abs(result) > 1e12) problem('INVALID_EXPRESSION_RESULT');
  return result;
}
function computedAnswer(check) {
  if (check.kind === 'expression') return evaluateOriginalExpression(check.expression);
  if (check.kind === 'median') {
    if (!Array.isArray(check.values) || !check.values.length || check.values.some(value => !Number.isFinite(value))) problem('INVALID_MEDIAN');
    const sorted = [...check.values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  if (check.kind === 'arithmetic_sequence') {
    if (!Array.isArray(check.terms) || check.terms.length < 3 || check.terms.some(value => !Number.isFinite(value))) problem('INVALID_SEQUENCE');
    const step = check.terms[1] - check.terms[0];
    if (check.terms.slice(1).some((value, index) => !close(value - check.terms[index], step))) problem('NOT_ARITHMETIC_SEQUENCE');
    return check.terms.at(-1) + step;
  }
  if (check.kind === 'lcm') {
    if (!Array.isArray(check.values) || check.values.length < 2 || check.values.some(value => !Number.isSafeInteger(value) || value <= 0)) problem('INVALID_LCM');
    const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
    return check.values.reduce((a, b) => a / gcd(a, b) * b, 1);
  }
  if (check.kind === 'comparison' || check.kind === 'affine_comparison') {
    let difference;
    if (check.kind === 'comparison') difference = evaluateOriginalExpression(check.left) - evaluateOriginalExpression(check.right);
    else {
      if (!check.left || !check.right || !Number.isFinite(check.left.coefficient) || check.left.coefficient !== check.right.coefficient || !Number.isFinite(check.left.constant) || !Number.isFinite(check.right.constant)) problem('NON_CONSTANT_AFFINE_COMPARISON');
      difference = check.left.constant - check.right.constant;
    }
    return close(difference, 0) ? 'الكميتان متساويتان' : difference > 0 ? 'الكمية الأولى أكبر' : 'الكمية الثانية أكبر';
  }
  problem('UNKNOWN_VERIFICATION_KIND');
}
export function validateOriginalPack(pack, expectedSkills) {
  if (pack?.schemaVersion !== 1 || pack.packId !== 'lootbot-quant-original-v1' || pack.version !== 1 || pack.reviewStatus !== 'draft' || !pack.attribution || !pack.rightsStatement || !Array.isArray(pack.questions) || pack.questions.length !== 30) problem('INVALID_ORIGINAL_PACK');
  const references = new Set(), stems = new Set(), counts = {};
  for (const [index, question] of pack.questions.entries()) {
    const ref = 'LBQ-ORIGINAL-V1-' + String(index + 1).padStart(3, '0');
    if (question.ref !== ref || question.sourcePage !== index + 1 || references.has(question.ref)) problem('UNSTABLE_SOURCE_REFERENCE', ref);
    if (typeof question.stem !== 'string' || question.stem.trim().length < 5 || question.stem.length > 20000 || typeof question.explanation !== 'string' || question.explanation.length < 15 || !['easy', 'medium', 'hard', 'unknown'].includes(question.difficulty) || !question.verification) problem('INCOMPLETE_QUESTION', ref);
    if (!Array.isArray(question.choices) || question.choices.length !== 4 || question.choices.some((choice, position) => choice.key !== String.fromCharCode(65 + position) || typeof choice.text !== 'string' || !choice.text.trim())) problem('INVALID_CHOICES', ref);
    if (new Set(question.choices.map(choice => normalize(choice.text))).size !== 4) problem('DUPLICATE_CHOICES', ref);
    if (!question.choices.some(choice => choice.key === question.correctKey)) problem('CORRECT_KEY_NOT_IN_CHOICES', ref);
    if (stems.has(normalize(question.stem))) problem('DUPLICATE_STEM', ref);
    if (expectedSkills && !expectedSkills.includes(question.skill)) problem('SKILL_NOT_IN_EXISTING_TAXONOMY', ref);
    references.add(ref); stems.add(normalize(question.stem)); counts[question.skill] = (counts[question.skill] || 0) + 1;
    let matching;
    if (question.verification.kind === 'equation') {
      matching = question.choices.filter(choice => { const candidate = numericChoice(choice.text); return close(evaluateOriginalExpression(question.verification.left, candidate), evaluateOriginalExpression(question.verification.right, candidate)); });
    } else {
      const expected = computedAnswer(question.verification);
      matching = question.choices.filter(choice => typeof expected === 'number' ? close(numericChoice(choice.text), expected) : choice.text === expected);
    }
    if (matching.length !== 1 || matching[0].key !== question.correctKey) problem('MATH_ANSWER_MISMATCH', ref);
    if (!Array.isArray(question.images) || question.images.length) problem('UNSUPPORTED_AUTHORED_MEDIA', ref);
  }
  if (Object.keys(counts).length !== 13 || (expectedSkills && expectedSkills.some(skill => !counts[skill]))) problem('INCOMPLETE_SKILL_COVERAGE');
  return { questions: pack.questions.length, skills: Object.keys(counts).length, mathVerified: pack.questions.length, bySkill: counts, reviewStatus: 'draft' };
}
export async function loadOriginalPack(packPath = defaultPack) {
  const bytes = await readFile(packPath), pack = JSON.parse(bytes.toString('utf8'));
  const migration = await readFile(path.join(rootPath, 'lib/db/migrations/0014_education_platform.sql'), 'utf8');
  const expectedSkills = [...migration.matchAll(/name='([^']+)' AND track='quantitative'/g)].map(match => match[1]);
  if (new Set(expectedSkills).size !== 13) problem('EXISTING_TAXONOMY_MISSING');
  return { pack, summary: validateOriginalPack(pack, expectedSkills), fileHash: hash(bytes), fileSize: bytes.length, fileName: path.basename(packPath) };
}
async function audit(connection, actorId, action, resource, details) {
  await connection.query('INSERT INTO audit_logs(id,user_id,action,summary,details) VALUES($1,$2,$3,$4,$5::jsonb)', [randomUUID(), actorId, 'education.quant.' + action, 'إدارة الحزمة الأصلية للكمي: ' + action, JSON.stringify({ resource, ...details })]);
}
export async function registerOriginalSource(connection, actorId, original) {
  const { pack, fileHash, fileSize, fileName } = original;
  await connection.query('BEGIN');
  try {
    const existing = (await connection.query('SELECT id,license_status FROM quant_sources WHERE file_hash=$1', [fileHash])).rows[0];
    if (existing) { await connection.query('COMMIT'); return { sourceId: existing.id, licenseStatus: existing.license_status, duplicate: true, imported: 0 }; }
    const sourceId = randomUUID();
    await connection.query("INSERT INTO quant_sources(id,title,file_name,file_hash,file_size,attribution,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)", [sourceId, pack.title, fileName, fileHash, fileSize, pack.attribution, actorId]);
    await audit(connection, actorId, 'original.source.registered', sourceId, { fileHash, packId: pack.packId, licenseStatus: 'unverified' });
    await connection.query('COMMIT');
    return { sourceId, licenseStatus: 'unverified', duplicate: false, imported: 0 };
  } catch (error) { await connection.query('ROLLBACK'); throw error; }
}
export async function importOriginalDrafts(connection, actorId, original) {
  const { pack, fileHash } = original;
  let imported = 0, existing = 0;
  const duplicates = [];
  await connection.query('BEGIN');
  try {
    const source = (await connection.query('SELECT * FROM quant_sources WHERE file_hash=$1 FOR SHARE', [fileHash])).rows[0];
    if (!source) problem('ORIGINAL_SOURCE_NOT_REGISTERED');
    if (source.license_status !== 'verified') problem('SOURCE_NOT_LICENSED');
    if (!source.license_note?.trim()) problem('LICENSE_NOTE_MISSING');
    const categoryRows = (await connection.query("SELECT id,name FROM education_categories WHERE track='quantitative' AND school_id IS NULL AND class_id IS NULL ORDER BY position,id")).rows;
    for (const question of pack.questions) {
      const category = categoryRows.find(row => row.name === question.skill);
      if (!category) problem('SKILL_NOT_IN_EXISTING_TAXONOMY', question.ref);
      const normalizedHash = hash(normalize(question.stem));
      const duplicate = (await connection.query('SELECT r.question_id,r.source_id,r.source_page FROM quant_question_reviews r WHERE r.normalized_hash=$1 LIMIT 1', [normalizedHash])).rows[0];
      const fingerprint = hash(question.stem.normalize('NFKC').replace(/\s+/g, ' ').trim());
      const legacy = (await connection.query('SELECT id FROM education_questions WHERE fingerprint=$1 LIMIT 1', [fingerprint])).rows[0];
      if (duplicate || legacy) {
        if (duplicate?.source_id === source.id && duplicate?.source_page === question.sourcePage) existing++;
        else duplicates.push({ ref: question.ref, questionId: duplicate?.question_id || legacy.id });
        continue; // Never deletes, overwrites, reapproves or automatically attaches a duplicate.
      }
      const questionId = randomUUID(), versionId = randomUUID();
      const content = { options: question.choices.map(choice => ({ text: choice.text, explanation: '' })), answer: question.choices.findIndex(choice => choice.key === question.correctKey), explanation: question.explanation, passage: '', source: pack.title, rights: 'original', license: source.license_note, allowSave: true, stemImages: [], originalPackRef: question.ref };
      const snapshot = { categoryId: category.id, text: question.stem, difficulty: question.difficulty, status: 'draft', content };
      await connection.query("INSERT INTO education_questions(id,category_id,text,fingerprint,difficulty,content,status,author_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,'draft',$7)", [questionId, category.id, question.stem, fingerprint, question.difficulty, JSON.stringify(content), actorId]);
      await connection.query('INSERT INTO education_question_versions(id,question_id,number,snapshot) VALUES($1,$2,1,$3::jsonb)', [versionId, questionId, JSON.stringify(snapshot)]);
      await connection.query("INSERT INTO quant_question_reviews(version_id,question_id,source_id,source_page,review_status,normalized_hash,skill,review_note) VALUES($1,$2,$3,$4,'draft',$5,$6,$7)", [versionId, questionId, source.id, question.sourcePage, normalizedHash, question.skill, 'تحقق حسابي آلي ناجح؛ يلزم مراجع مستقل للصياغة والحل قبل الاعتماد.']);
      await connection.query('INSERT INTO quant_question_sources(id,question_id,source_id,source_page) VALUES($1,$2,$3,$4)', [randomUUID(), questionId, source.id, question.sourcePage]);
      await audit(connection, actorId, 'original.question.draft', questionId, { versionId, sourceId: source.id, sourcePage: question.sourcePage, ref: question.ref });
      imported++;
    }
    await audit(connection, actorId, 'original.pack.imported', source.id, { packId: pack.packId, fileHash, imported, existing, duplicates: duplicates.length });
    await connection.query('COMMIT');
    return { sourceId: source.id, imported, existing, duplicates, approved: 0, publishedTests: 0 };
  } catch (error) { await connection.query('ROLLBACK'); throw error; }
}
async function main() {
  const args = process.argv.slice(2), value = flag => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const original = await loadOriginalPack(path.resolve(value('--pack') || defaultPack));
  const mode = ['--register', '--import'].filter(flag => args.includes(flag));
  if (!mode.length) { console.log(JSON.stringify({ ...original.summary, fileHash: original.fileHash, fileSize: original.fileSize, databaseChanged: false, pdfPagesRead: 0 }, null, 2)); return; }
  if (mode.length > 1) problem('CHOOSE_REGISTER_OR_IMPORT');
  const actorId = value('--actor');
  if (!process.env.DATABASE_URL) problem('DATABASE_URL_REQUIRED');
  if (!actorId || !/^[0-9a-f-]{36}$/i.test(actorId)) problem('SUPERADMIN_ACTOR_REQUIRED');
  const require = createRequire(path.join(rootPath, 'lib/db/package.json')), { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  let connection;
  try {
    connection = await pool.connect();
    const actor = (await connection.query("SELECT id FROM users WHERE id=$1 AND role='SUPERADMIN' AND NOT suspended AND NOT is_deleted AND NOT student_code_managed", [actorId])).rows[0];
    if (!actor) problem('SUPERADMIN_ACTOR_REQUIRED');
    const result = mode[0] === '--register' ? await registerOriginalSource(connection, actorId, original) : await importOriginalDrafts(connection, actorId, original);
    console.log(JSON.stringify({ ...result, pdfPagesRead: 0 }));
  } finally { connection?.release(); await pool.end(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  const message = error instanceof Error ? error.message : '';
  console.error(JSON.stringify({ error: /^[A-Z_]+(:LBQ-ORIGINAL-V1-\d{3})?$/.test(message) ? message : 'ORIGINAL_PACK_OPERATION_FAILED', note: 'No connection strings, answer keys or private data are printed.' }));
  process.exitCode = 1;
});
