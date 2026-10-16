/**
 * Imports structurally valid licensed packs as private drafts for independent approval.
 * Does not grant a license, approve content, overwrite a question, or publish a test.
 * Packs and any source material must remain in private storage; no .env is loaded.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateFigureMetadata, readPrivateQuantFigure, quantFigureStorageRoot, quantProjectRoot } from '../artifacts/api-server/src/lib/quant-figure-storage.mjs';

const importDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootPath = path.basename(importDirectory) === 'scripts' ? path.resolve(importDirectory, '..') : quantProjectRoot(importDirectory);
const hash = value => createHash('sha256').update(value).digest('hex');
const normalize = text => text.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\s+/g, ' ').trim().toLowerCase();
const within = (base, candidate) => { const relative = path.relative(base, candidate); return !relative.startsWith('..') && !path.isAbsolute(relative); };
const problem = code => { throw new Error(code); };
const validText = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.length <= max && !value.includes('\0');
const reference = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
const identityHash = question => question.images?.length ? hash('quant-private-figure:' + question.images.map(figure => figure.fileHash.toLowerCase()).sort().join(':')) : hash(normalize(question.stem));

export function validateReviewedPack(pack, expectedSkills) {
  if (pack?.schemaVersion !== 1 || !reference(pack.packId) || pack.publisher !== 'almufakir' || !['reviewed', 'needs_review'].includes(pack.reviewStatus) ||
      !validText(pack.title, 1, 250) || !validText(pack.attribution, 1, 4000) || !/^[0-9a-f]{64}$/i.test(pack.sourceFileHash || '') ||
      !validText(pack.sourceFileName, 1, 255) || /[\\/]/.test(pack.sourceFileName) || !Array.isArray(pack.questions) || !pack.questions.length || pack.questions.length > 2000)
    problem('INVALID_REVIEWED_PACK');
  const refs = new Set(), hashes = new Set(), bySkill = {}, possibleDuplicates = [];
  for (const question of pack.questions) {
    if (!reference(question.ref) || refs.has(question.ref) || !Number.isInteger(question.sourcePage) || question.sourcePage < 1 || question.sourcePage > 100000)
      problem('INVALID_SOURCE_REFERENCE');
    if (question.sourceQuestionNumber !== undefined && !validText(question.sourceQuestionNumber, 1, 80)) problem('INVALID_SOURCE_QUESTION_NUMBER');
    if (question.normalizedCandidateHash !== undefined && !/^[0-9a-f]{64}$/i.test(question.normalizedCandidateHash)) problem('INVALID_CANDIDATE_HASH');
    if (question.sourceSection !== undefined && !validText(question.sourceSection, 1, 200)) problem('INVALID_SOURCE_SECTION');
    if (question.rawText !== undefined && !validText(question.rawText, 1, 50000)) problem('INVALID_PRIVATE_RAW_TEXT');
    if (question.privateRawText !== undefined && !validText(question.privateRawText, 1, 50000)) problem('INVALID_PRIVATE_RAW_TEXT');
    if (question.extractionUncertainties !== undefined && (!Array.isArray(question.extractionUncertainties) || question.extractionUncertainties.length > 30 || question.extractionUncertainties.some(value => !validText(value, 1, 2000)))) problem('INVALID_EXTRACTION_UNCERTAINTIES');
    if (!validText(question.stem, 5, 20000) || !validText(question.explanation, 15, 20000) || !validText(question.skill, 1, 200) ||
        !['easy', 'medium', 'hard', 'unknown'].includes(question.difficulty)) problem('INCOMPLETE_QUESTION');
    if (expectedSkills && !expectedSkills.includes(question.skill)) problem('SKILL_NOT_IN_EXISTING_TAXONOMY');
    if (!Array.isArray(question.choices) || question.choices.length < 2 || question.choices.length > 6 ||
        question.choices.some((choice, i) => choice?.key !== String.fromCharCode(65 + i) || !validText(choice.text, 1, 3000))) problem('INVALID_CHOICES');
    if (new Set(question.choices.map(choice => normalize(choice.text))).size !== question.choices.length) problem('DUPLICATE_CHOICES');
    if (!question.choices.some(choice => choice.key === question.correctKey)) problem('CORRECT_KEY_NOT_IN_CHOICES');
    if (!['reviewed', 'needs_review'].includes(question.review?.status) || !validText(question.review.reviewer, 1, 200) || !validText(question.review.note, 15, 4000)) problem('QUESTION_REVIEW_REQUIRED');
    // Private reviewed diagram or faithful question/options crop only. Key footers and whole pages stay private.
    if (!Array.isArray(question.images) || question.images.length > 8) problem('INVALID_PRIVATE_DIAGRAMS');
    for (const figure of question.images) validateFigureMetadata(figure, question.sourcePage);
    const normalizedHash = identityHash(question);
    if (hashes.has(normalizedHash)) possibleDuplicates.push(question.ref);
    refs.add(question.ref); hashes.add(normalizedHash); bySkill[question.skill] = (bySkill[question.skill] || 0) + 1;
  }
  return { questions: pack.questions.length, skills: Object.keys(bySkill).length, bySkill, possibleDuplicates, reviewStatus: 'needs_review',
    independentlyChecked: pack.questions.filter(question => question.review.status === 'reviewed').length, approved: 0, publishedTests: 0 };
}

export async function loadReviewedPack(packPath) {
  if (!packPath) problem('PRIVATE_PACK_PATH_REQUIRED');
  const actual = await realpath(path.resolve(packPath));
  const publicRoots = [path.join(rootPath, 'artifacts/lootbot/public'), path.join(rootPath, 'artifacts/lootbot/dist'), path.join(rootPath, 'artifacts/api-server/dist')];
  if (publicRoots.some(folder => within(folder, actual))) problem('PACK_STORAGE_MUST_BE_PRIVATE');
  const metadata = await stat(actual);
  if (!metadata.isFile() || metadata.size > 32 * 1024 * 1024) problem('INVALID_PACK_FILE');
  const bytes = await readFile(actual), pack = JSON.parse(bytes.toString('utf8'));
  const migration = await readFile(path.join(rootPath, 'lib/db/migrations/0014_education_platform.sql'), 'utf8');
  const skills = [...migration.matchAll(/name='([^']+)' AND track='quantitative'/g)].map(match => match[1]);
  skills.push('مسائل كمية متنوعة'); // Must also exist as a real native category before DB import.
  return { pack, summary: validateReviewedPack(pack, skills), fileHash: hash(bytes), fileSize: bytes.length };
}

async function audit(connection, actorId, action, resource, details) {
  await connection.query('INSERT INTO audit_logs(id,user_id,action,summary,details) VALUES($1,$2,$3,$4,$5::jsonb)',
    [randomUUID(), actorId, 'education.quant.' + action, 'استيراد حزمة مرخّصة للمراجعة: ' + action, JSON.stringify({ resource, ...details })]);
}
function questionSignature(question) {
  return hash(JSON.stringify({ stem: question.stem, choices: question.choices, correctKey: question.correctKey, explanation: question.explanation,
    skill: question.skill, difficulty: question.difficulty, sourcePage: question.sourcePage, sourceQuestionNumber: question.sourceQuestionNumber || '', images: question.images }));
}

export async function importReviewedDrafts(connection, actorId, reviewed, { storeFiguresInDb = false } = {}) {
  const { pack } = reviewed;
  validateReviewedPack(pack);
  if (!/^[0-9a-f-]{36}$/i.test(actorId || '')) problem('SUPERADMIN_ACTOR_REQUIRED');
  const duplicates = [], conflicts = [], versions = [];
  let existing = 0;
  await connection.query('BEGIN');
  try {
    const actor = (await connection.query("SELECT id FROM users WHERE id=$1 AND role='SUPERADMIN' AND NOT suspended AND NOT is_deleted AND NOT student_code_managed FOR SHARE", [actorId])).rows[0];
    if (!actor) problem('SUPERADMIN_ACTOR_REQUIRED');
    const source = (await connection.query('SELECT * FROM quant_sources WHERE file_hash=$1 FOR SHARE', [pack.sourceFileHash.toLowerCase()])).rows[0];
    if (!source) problem('LICENSED_SOURCE_NOT_REGISTERED');
    if (source.license_status !== 'verified') problem('SOURCE_NOT_LICENSED');
    if (!source.license_note?.trim()) problem('LICENSE_NOTE_MISSING');
    if (source.file_name !== pack.sourceFileName) problem('SOURCE_FILE_NAME_MISMATCH');
    // Serializes imports of the same source without locking or replacing unrelated content.
    await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['quant-reviewed-source:' + source.id]);
    const categories = (await connection.query("SELECT id,name FROM education_categories WHERE track='quantitative' AND school_id IS NULL AND class_id IS NULL ORDER BY position,id")).rows;
    validateReviewedPack(pack, categories.map(row => row.name));
    for (const question of pack.questions) {
      if (source.page_count && question.sourcePage > source.page_count) problem('SOURCE_PAGE_OUT_OF_RANGE');
      const importedRef = pack.packId + ':' + question.ref, signature = questionSignature(question);
      const prior = (await connection.query("SELECT q.id,q.content,v.id AS version_id FROM education_questions q JOIN education_question_versions v ON v.question_id=q.id AND v.number=q.revision JOIN quant_question_reviews r ON r.version_id=v.id WHERE r.source_id=$1 AND q.content->>'licensedPackRef'=$2 LIMIT 1", [source.id, importedRef])).rows[0];
      if (prior) {
        if (prior.content?.licensedPackSignature === signature) { existing++; versions.push({ ref: question.ref, questionId: prior.id, versionId: prior.version_id, existing: true }); }
        else conflicts.push({ ref: question.ref, questionId: prior.id, reason: 'SOURCE_REFERENCE_CHANGED_REQUIRES_MANUAL_VERSION' });
        continue;
      }
      const normalizedHash = identityHash(question), fingerprint = question.images.length ? normalizedHash : hash(question.stem.normalize('NFKC').replace(/\s+/g, ' ').trim());
      const duplicate = (await connection.query('SELECT r.question_id,r.version_id,r.source_id,r.source_page FROM quant_question_reviews r WHERE r.normalized_hash=$1 LIMIT 1', [normalizedHash])).rows[0];
      const legacy = (await connection.query('SELECT id FROM education_questions WHERE fingerprint=$1 LIMIT 1', [fingerprint])).rows[0];
      if (duplicate || legacy) {
        duplicates.push({ ref: question.ref, questionId: duplicate?.question_id || legacy.id, versionId: duplicate?.version_id || null, reason: 'MATCHING_STEM_REQUIRES_MANUAL_REVIEW' });
        continue; // Do not silently attach a new source or equate similar diagrams/options.
      }
      const category = categories.find(row => row.name === question.skill), questionId = randomUUID(), versionId = randomUUID();
      const figures = [];
      // The source license has been checked and is held FOR SHARE before any figure file access.
      for (const [position, supplied] of question.images.entries()) {
        const metadata = validateFigureMetadata(supplied, question.sourcePage);
        const data = await readPrivateQuantFigure(quantFigureStorageRoot(rootPath), metadata.relativePath, metadata.fileHash, rootPath);
        if (storeFiguresInDb) await connection.query('INSERT INTO quant_figure_blobs(file_hash,png_data,width,height) VALUES($1,$2,$3,$4) ON CONFLICT(file_hash) DO NOTHING', [metadata.fileHash, data.bytes, data.width, data.height]);
        figures.push({ ...metadata, id: randomUUID(), position, width: data.width, height: data.height });
      }
      const content = { options: question.choices.map(choice => ({ text: choice.text, explanation: '' })), answer: question.choices.findIndex(choice => choice.key === question.correctKey),
        explanation: question.explanation, passage: '', source: source.title, rights: 'licensed', license: source.license_note, allowSave: true, stemImages: figures.map(figure => '/api/quant/figures/' + figure.id),
        licensedPackRef: importedRef, licensedPackSignature: signature, sourceQuestionNumber: question.sourceQuestionNumber || '', publisher: pack.publisher,
        attribution: pack.attribution, sourceReview: { status: question.review.status, reviewer: question.review.reviewer, note: question.review.note },
        normalizedCandidateHash: question.normalizedCandidateHash || '', sourceSection: question.sourceSection || '', extractionUncertainties: question.extractionUncertainties || question.uncertainties || [] };
      const snapshot = { categoryId: category.id, text: question.stem, difficulty: question.difficulty, status: 'draft', content };
      await connection.query("INSERT INTO education_questions(id,category_id,text,fingerprint,difficulty,content,status,author_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,'draft',$7)", [questionId, category.id, question.stem, fingerprint, question.difficulty, JSON.stringify(content), actorId]);
      await connection.query('INSERT INTO education_question_versions(id,question_id,number,snapshot) VALUES($1,$2,1,$3::jsonb)', [versionId, questionId, JSON.stringify(snapshot)]);
      for (const figure of figures) await connection.query('INSERT INTO quant_question_figures(id,version_id,source_id,source_page,position,file_hash,relative_path,width,height,review_note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [figure.id, versionId, source.id, question.sourcePage, figure.position, figure.fileHash, figure.relativePath, figure.width, figure.height, figure.reviewNote, actorId]);
      await connection.query("INSERT INTO quant_question_reviews(version_id,question_id,source_id,source_page,review_status,normalized_hash,skill,review_note) VALUES($1,$2,$3,$4,'needs_review',$5,$6,$7)",
        [versionId, questionId, source.id, question.sourcePage, normalizedHash, question.skill, 'تدقيق الحزمة: ' + question.review.note + ' — يلزم اعتماد مستقل داخل النظام.']);
      await connection.query('INSERT INTO quant_question_sources(id,question_id,source_id,source_page) VALUES($1,$2,$3,$4)', [randomUUID(), questionId, source.id, question.sourcePage]);
      await audit(connection, actorId, 'licensed.question.draft', questionId, { versionId, sourceId: source.id, sourcePage: question.sourcePage, importedRef, signature });
      versions.push({ ref: question.ref, questionId, versionId, existing: false });
    }
    const imported = versions.filter(item => !item.existing).length;
    await audit(connection, actorId, 'licensed.pack.imported', source.id, { packId: pack.packId, packHash: reviewed.fileHash || null, sourceFileHash: pack.sourceFileHash.toLowerCase(), imported, existing, duplicates: duplicates.length, conflicts: conflicts.length });
    await connection.query('COMMIT');
    return { sourceId: source.id, imported, existing, duplicates, conflicts, versions, approved: 0, publishedTests: 0, reviewStatus: 'needs_review' };
  } catch (error) { await connection.query('ROLLBACK'); throw error; }
}

async function main() {
  const args = process.argv.slice(2), value = flag => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const reviewed = await loadReviewedPack(value('--pack'));
  if (!args.includes('--import')) {
    console.log(JSON.stringify({ ...reviewed.summary, fileHash: reviewed.fileHash, fileSize: reviewed.fileSize, databaseChanged: false, pdfPagesRead: 0 }, null, 2)); return;
  }
  const actorId = value('--actor');
  if (!process.env.DATABASE_URL) problem('DATABASE_URL_REQUIRED');
  if (!/^[0-9a-f-]{36}$/i.test(actorId || '')) problem('SUPERADMIN_ACTOR_REQUIRED');
  const require = createRequire(path.join(rootPath, 'lib/db/package.json')), { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  let connection;
  try { connection = await pool.connect(); console.log(JSON.stringify({ ...await importReviewedDrafts(connection, actorId, reviewed, { storeFiguresInDb: args.includes('--store-figures-in-db') }), pdfPagesRead: 0 })); }
  finally { connection?.release(); await pool.end(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ error: /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'REVIEWED_PACK_OPERATION_FAILED', note: 'No connection strings, answer keys, license screenshots or private paths are printed.' }));
  process.exitCode = 1;
});
