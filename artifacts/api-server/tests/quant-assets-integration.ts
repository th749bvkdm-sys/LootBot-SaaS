/** Real HTTP authorization tests; all content and licenses are original local fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import app from '../src/app';
import { pool, db, usersTable, sessionsTable } from '@workspace/db';
import { sha256 } from '../src/lib/security';
// File identity is simulated only in this disposable QA database. The PNG,
// question and license below are synthetic original fixtures, not publisher material.
const simulatedMufakirSourceHash = '3d7c9c2034b8e326d7242b0ffea44e08b58d7f5b40db765a4697f3adeea35c2b';

function crc32(bytes: Buffer) { let value = 0xffffffff; for (const b of bytes) { value ^= b; for (let i = 0; i < 8; i++) value = value >>> 1 ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function chunk(name: string, bytes: Buffer) { const type = Buffer.from(name), buffer = Buffer.alloc(bytes.length + 12); buffer.writeUInt32BE(bytes.length); type.copy(buffer, 4); bytes.copy(buffer, 8); buffer.writeUInt32BE(crc32(Buffer.concat([type, bytes])), bytes.length + 8); return buffer; }
function originalPng() { const header = Buffer.alloc(13); header.writeUInt32BE(16); header.writeUInt32BE(16, 4); header[8] = 8; header[9] = 6; return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((16 * 4 + 1) * 16))), chunk('IEND', Buffer.alloc(0))]); }

test('quant private figures require owned active enrollment, approved pinned version and current source license', async t => {
  assert.match(process.env.TEACHER_TEST_SCHEMA || '', /^teacher_qa_/);
  const [admin, teacher, student, other, reviewer] = Array.from({ length: 5 }, () => randomUUID()), auth = new Map<string, { cookie: string; csrf: string }>();
  for (const [index, uid] of [admin, teacher, student, other, reviewer].entries()) {
    const token = randomUUID() + randomUUID(), csrf = randomUUID() + randomUUID();
    await db.insert(usersTable).values({ id: uid, name: 'حساب اختبار صور خاص ' + index, email: uid + '@example.invalid', passwordHash: 'unused', role: index === 0 || index === 4 ? 'SUPERADMIN' : 'OWNER', accountType: index === 1 ? 'teacher' : index === 2 || index === 3 ? 'student' : 'merchant' });
    await db.insert(sessionsTable).values({ id: randomUUID(), userId: uid, tokenHash: sha256(token), csrfHash: sha256(csrf), expiresAt: new Date(Date.now() + 3600000) });
    auth.set(uid, { cookie: `lootbot_session=${token}; lootbot_csrf=${csrf}`, csrf });
  }
  const folder = await mkdtemp(path.join(os.tmpdir(), 'lootbot-figure-http-')), oldStore = process.env.QUANT_FIGURE_STORAGE_PATH;
  process.env.QUANT_FIGURE_STORAGE_PATH = folder;
  const bytes = originalPng(), fileHash = createHash('sha256').update(bytes).digest('hex');
  await mkdir(path.join(folder, 'fixture/figures'), { recursive: true }); await writeFile(path.join(folder, 'fixture/figures/Q-0001.png'), bytes);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); const port = (server.address() as any).port;
  const request = async (url: string, uid = admin, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const account = auth.get(uid)!; const response = await fetch(`http://127.0.0.1:${port}/api${url}`, { method, headers: { cookie: account.cookie, 'content-type': 'application/json', 'x-csrf-token': account.csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    const buffer = Buffer.from(await response.arrayBuffer()); let data: any = {}; if (response.headers.get('content-type')?.includes('json')) data = JSON.parse(buffer.toString('utf8')); return { status: response.status, buffer, data, headers: response.headers };
  };
  let school = '', classId = '', enrollment = '', source = '', version = '', figure = '', attempt = '', questionId = '', category = '';
  let questionBody: any;
  try {
    await t.test('fixture enrollment and audited license establish the same production authorization prerequisites', async () => {
      school = (await request('/education/schools', admin, { name: 'مدرسة اختبار الصور الخاصة الأصلية' })).data.id;
      await request('/education/grants', admin, { userId: teacher, role: 'TEACHER', scope: school });
      classId = (await request('/education/classes', admin, { schoolId: school, ownerId: teacher, name: 'فصل اختبار الصور', grade: 'الثالث', stage: 'ثانوي' })).data.id;
      for (const uid of [student, other]) { const code = await request('/education/codes', admin, { schoolId: school, classId, maxUses: 1, expiresAt: new Date(Date.now() + 86400000).toISOString() }); assert.equal((await request('/education/join', uid, { code: code.data.code })).status, 200); }
      enrollment = (await pool.query('SELECT id FROM education_enrollments WHERE user_id=$1 AND class_id=$2', [student, classId])).rows[0].id;
      const registered = await request('/quant/admin/sources', admin, { title: 'صورة أصلية مؤلفة للاختبار فقط • محاكاة هوية المفكر', fileHash: simulatedMufakirSourceHash, fileName: 'authored-local-fixture.pdf', fileSize: 0, attribution: 'مسألة أصلية للاختبار المحلي. بصمة مصدر المفكر محاكاة في قاعدة مؤقتة فقط.' }); source = registered.data.id;
      assert.equal((await request('/quant/admin/sources/' + source + '/license', admin, { licenseStatus: 'verified', licenseNote: 'ترخيص خاص بالمحتوى الأصلي المؤلف داخل اختبار HTTP المحلي، لا يمثل ترخيص أي ناشر خارجي.' }, 'PATCH')).status, 200);
      category = (await pool.query("SELECT id FROM education_categories WHERE track='quantitative' LIMIT 1")).rows[0].id;
      questionBody = { stem: 'مسألة أصلية: ما مجموع اثنين وثلاثة؟', choices: [{ key: 'A', text: '5' }, { key: 'B', text: '6' }], correctKey: 'A', explanation: 'جمع اثنين وثلاثة يعطينا خمسة، وهو اختيار أ.', categoryId: category, difficulty: 'easy', reviewStatus: 'needs_review', sourceId: source, sourcePage: 1, images: [] };
      const question = await request('/quant/admin/questions', admin, questionBody); assert.equal(question.status, 201); version = question.data.versionId; questionId = question.data.id;
      figure = randomUUID(); const url = '/api/quant/figures/' + figure;
      await pool.query('INSERT INTO quant_question_figures(id,version_id,source_id,source_page,position,file_hash,relative_path,width,height,review_note,created_by) VALUES($1,$2,$3,1,0,$4,$5,16,16,$6,$7)', [figure, version, source, fileHash, 'fixture/figures/Q-0001.png', 'رسم أصلي صغير للاختبار: لا توجد إجابة أو تذييل أو مفاتيح في الصورة.', admin]);
      const privateContent = { licensedPackRef: 'test-origin:Q-0001', publisher: 'local-fixture', rawText: 'PRIVATE_RAW_FOOTER_ANSWER_A', sourceReview: { note: 'PRIVATE_REVIEW_NOTE' } };
      await pool.query("UPDATE education_questions SET status='published',content=content||$2::jsonb WHERE id=$1", [questionId, JSON.stringify(privateContent)]);
      await pool.query("UPDATE education_question_versions SET snapshot=jsonb_set(snapshot,'{content}',(snapshot->'content')||$2::jsonb) WHERE id=$1", [version, JSON.stringify(privateContent)]);
      await pool.query("UPDATE quant_question_reviews SET review_status='approved' WHERE version_id=$1", [version]);
      attempt = randomUUID(); const snapshot = [{ versionId: version, questionId: question.data.id, position: 0, stem: question.data.stem, choices: question.data.choices, correctKey: 'A', explanation: question.data.explanation, images: [url], categoryId: category, skill: 'حساب', difficulty: 'easy', sourceId: source, sourcePage: 1 }];
      await pool.query('INSERT INTO quant_attempts(id,user_id,enrollment_id,school_id,class_id,test_snapshot,snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)', [attempt, student, enrollment, school, classId, JSON.stringify({ title: 'محاولة اختبار خصوصية الصور الأصلية', mode: 'untimed', allowReturn: true, revealPolicy: 'after_submit' }), JSON.stringify(snapshot)]);
      await pool.query('INSERT INTO quant_responses(attempt_id,version_id,visited) VALUES($1,$2,true)', [attempt, version]);
    });
    await t.test('only owner can read the pinned approved crop; unrelated student and teacher cannot', async () => {
      const own = await request('/quant/figures/' + figure, student); assert.equal(own.status, 200, JSON.stringify(own.data)); assert.deepEqual(own.buffer, bytes); assert.match(own.headers.get('cache-control') || '', /no-store/); assert.match(own.headers.get('content-type') || '', /image\/png/);
      assert.equal((await request('/quant/figures/' + figure, other)).status, 404); assert.equal((await request('/quant/figures/' + figure, teacher)).status, 403); assert.equal((await request('/quant/admin/figures/' + figure, student)).status, 403);
      assert.equal((await request('/quant/admin/figures/' + figure, admin)).status, 200);
    });
    await t.test('active attempt response exposes crop URL without private paths, license proof or answer key', async () => {
      const result = await request('/quant/attempts/' + attempt, student); assert.equal(result.status, 200); const body = JSON.stringify(result.data);
      assert.equal(body.includes('relative_path'), false); assert.equal(body.includes(folder), false); assert.equal(body.includes('correctKey'), false); assert.equal(body.includes('licenseNote'), false); assert.ok(body.includes('/api/quant/figures/' + figure));
    });
    await t.test('revoked source license blocks student and admin figure access immediately', async () => {
      await pool.query("UPDATE quant_sources SET license_status='restricted' WHERE id=$1", [source]); assert.equal((await request('/quant/figures/' + figure, student)).status, 404); assert.equal((await request('/quant/admin/figures/' + figure, admin)).status, 404); await pool.query("UPDATE quant_sources SET license_status='verified' WHERE id=$1", [source]);
    });
    await t.test('unapproved version cannot appear to the student but is available to authorized reviewers', async () => {
      await pool.query("UPDATE quant_question_reviews SET review_status='needs_review' WHERE version_id=$1", [version]); assert.equal((await request('/quant/figures/' + figure, student)).status, 404); assert.equal((await request('/quant/admin/figures/' + figure, admin)).status, 200); await pool.query("UPDATE quant_question_reviews SET review_status='approved' WHERE version_id=$1", [version]);
    });
    await t.test('altered file hash and path traversal fail closed without disclosing server paths', async () => {
      await pool.query('UPDATE quant_question_figures SET file_hash=$2 WHERE id=$1', [figure, 'a'.repeat(64)]); assert.equal((await request('/quant/figures/' + figure, student)).status, 404); await pool.query('UPDATE quant_question_figures SET file_hash=$2,relative_path=$3 WHERE id=$1', [figure, fileHash, '../outside.png']); const failure = await request('/quant/admin/figures/' + figure, admin); assert.equal(failure.status, 404); assert.equal(JSON.stringify(failure.data).includes(folder), false); await pool.query('UPDATE quant_question_figures SET relative_path=$2 WHERE id=$1', [figure, 'fixture/figures/Q-0001.png']);
    });
    await t.test('new question version clones its own reviewed figure to a new immutable asset ID and remains independently reviewed', async () => {
      const url = '/api/quant/figures/' + figure;
      const edited = await request('/quant/admin/questions/' + questionId, admin, { ...questionBody, explanation: 'شرح معدّل أصلي: اثنان زائد ثلاثة تساوي خمسة.', images: [url] }, 'PATCH'); assert.equal(edited.status, 200, JSON.stringify(edited.data));
      assert.equal(edited.data.reviewStatus, 'needs_review'); assert.notEqual(edited.data.versionId, version); assert.notEqual(edited.data.images[0], url);
      const clonedId = edited.data.images[0].split('/').at(-1), cloned = (await pool.query('SELECT * FROM quant_question_figures WHERE id=$1', [clonedId])).rows[0];
      assert.equal(cloned.version_id, edited.data.versionId); assert.equal(cloned.source_id, source); assert.equal(cloned.file_hash, fileHash);
      assert.equal((await request('/quant/admin/versions/' + edited.data.versionId + '/review', reviewer, { reviewStatus: 'reviewed', reviewNote: 'مراجعة مستقلة للنص والرسم والخيارات الأصلية للاختبار.' }, 'PATCH')).status, 200);
      assert.equal((await request('/quant/admin/versions/' + edited.data.versionId + '/review', reviewer, { reviewStatus: 'approved', reviewNote: 'اعتماد مستقل للاختبار المحلي الأصلي.' }, 'PATCH')).status, 200);
      const published = await request('/quant/admin/tests', reviewer, { title: 'اختبار إصدار الرسم المعدّل', mode: 'untimed', status: 'published', schoolId: school, classId, versionIds: [edited.data.versionId] }); assert.equal(published.status, 201, JSON.stringify(published.data));
      const started = await request('/quant/tests/' + published.data.id + '/attempts', student, {}); assert.equal(started.status, 201, JSON.stringify(started.data));
      assert.equal((await request('/quant/figures/' + clonedId, student)).status, 200); assert.equal((await request('/quant/figures/' + figure, student)).status, 200);
      const oldSnapshot = (await pool.query('SELECT snapshot FROM quant_attempts WHERE id=$1', [attempt])).rows[0].snapshot; assert.equal(oldSnapshot[0].images[0], url);
    });
    await t.test('private crop cannot be laundered into another question, source, page or absolute URL', async () => {
      const url = '/api/quant/figures/' + figure;
      const another = await request('/quant/admin/sources', admin, { title: 'مصدر أصلي آخر للاختبار', fileHash: sha256('Another original figure fixture'), fileName: 'another-fixture.pdf', fileSize: 0 }); const otherSource = another.data.id;
      assert.equal((await request('/quant/admin/sources/' + otherSource + '/license', admin, { licenseStatus: 'verified', licenseNote: 'إذن أصلي لمحتوى fixture مختلف داخل الاختبار المحلي فقط.' }, 'PATCH')).status, 200);
      for (const altered of [{ ...questionBody, sourceId: otherSource, images: [url] }, { ...questionBody, sourcePage: 2, images: [url] }, { ...questionBody, images: ['https://example.invalid' + url] }]) assert.equal((await request('/quant/admin/questions/' + questionId, admin, altered, 'PATCH')).status, 400);
      assert.equal((await request('/quant/admin/questions', admin, { ...questionBody, stem: 'سؤال آخر لا يمكنه استعارة صورة خاصة أجنبية', images: [url] })).status, 400);
      assert.equal((await request('/quant/admin/questions/' + questionId, admin, { ...questionBody, images: ['/api/quant/admin/figures/' + figure] }, 'PATCH')).status, 400);
    });
    await t.test('imported question origins cannot expose private footer or bypass quant licensing through legacy education routes', async () => {
      for (const uid of [student, admin]) { const listed = await request('/education/questions?categoryId=' + category, uid); assert.equal(listed.status, 200); assert.equal(listed.data.some((row: any) => row.id === questionId), false); assert.equal(JSON.stringify(listed.data).includes('PRIVATE_RAW_FOOTER'), false); }
      const versions = await request('/education/questions/' + questionId + '/versions', admin); assert.equal(versions.status, 200); assert.equal(versions.data.length, 0);
      assert.equal((await request('/education/practice', student, { track: 'quantitative', categoryId: category, count: 10 })).status, 409);
      assert.equal((await request('/education/assignments', teacher, { classId, title: 'لا تتجاوز بوابة المصدر', questionIds: [questionId], startsAt: new Date(Date.now() - 1000).toISOString() })).status, 400);
    });
    await t.test('admin source page list links an available private question crop and leaves unavailable page previews empty', async () => {
      await pool.query("INSERT INTO quant_extraction_pages(source_id,page,status,reason) VALUES($1,1,'needs_review','Original fixture crop'),($1,2,'skipped','No fixture image')", [source]);
      const result = await request('/quant/admin/sources/' + source + '/pages', admin); assert.equal(result.status, 200);
      const first = result.data.find((row: any) => row.page === 1), second = result.data.find((row: any) => row.page === 2);
      assert.match(first.previewUrl, /^\/api\/quant\/admin\/figures\/[0-9a-f-]{36}$/); assert.equal(first.previewKind, 'question_without_key');
      assert.equal((await request(first.previewUrl.slice(4), admin)).status, 200); assert.equal(second.previewUrl, null); assert.equal(second.previewKind, null);
    });
    await t.test('disabled enrollment removes all access to its existing crop', async () => {
      await pool.query("UPDATE education_enrollments SET status='revoked' WHERE id=$1", [enrollment]); assert.equal((await request('/quant/figures/' + figure, student)).status, 403);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (oldStore === undefined) delete process.env.QUANT_FIGURE_STORAGE_PATH; else process.env.QUANT_FIGURE_STORAGE_PATH = oldStore;
    const actual = path.resolve(folder); assert.equal(path.dirname(actual), path.resolve(os.tmpdir())); assert.match(path.basename(actual), /^lootbot-figure-http-/); await rm(actual, { recursive: true, force: true }); await pool.end();
  }
});
