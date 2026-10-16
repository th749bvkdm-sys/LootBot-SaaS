/** Original synthetic fixtures, isolated by run-teacher-local; no publisher PDF is opened. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import app from '../src/app';
import { pool, db, usersTable, sessionsTable } from '@workspace/db';
import { sha256 } from '../src/lib/security';

const publisherHash = '3d7c9c2034b8e326d7242b0ffea44e08b58d7f5b40db765a4697f3adeea35c2b';
test('automatic mistake notebook keeps source, reveal, ownership and current-version gates', async t => {
  assert.match(process.env.TEACHER_TEST_SCHEMA || '', /^teacher_qa_[a-f0-9]+$/);
  const [admin, writer, teacher, student, other] = Array.from({ length: 5 }, () => randomUUID());
  const sessions = new Map<string, { cookie: string; csrf: string }>();
  for (const [i, uid] of [admin, writer, teacher, student, other].entries()) {
    const token = randomUUID() + randomUUID(), csrf = randomUUID() + randomUUID();
    await db.insert(usersTable).values({ id: uid, name: 'حساب دفتر أخطاء تجريبي', email: uid + '@example.invalid', passwordHash: 'unused', role: i === 0 ? 'SUPERADMIN' : 'OWNER', accountType: i === 2 ? 'teacher' : i >= 3 ? 'student' : 'merchant' });
    await db.insert(sessionsTable).values({ id: randomUUID(), userId: uid, tokenHash: sha256(token), csrfHash: sha256(csrf), expiresAt: new Date(Date.now() + 3600000) });
    sessions.set(uid, { cookie: `lootbot_session=${token}; lootbot_csrf=${csrf}`, csrf });
  }
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const request = async (path: string, uid = student, body?: unknown, method = body === undefined ? 'GET' : 'POST', csrf = true) => {
    const session = sessions.get(uid)!;
    const response = await fetch(base + path, { method, headers: { cookie: session.cookie, 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': session.csrf } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000) });
    return { status: response.status, data: await response.json() as any };
  };
  let school = '', classId = '', category = '', source = '', mainAttempt = '';
  const questions: string[] = [], versions: string[] = [];
  const body = (index: number) => ({ stem: `مسألة دفتر أصلية رقم ${index}: ما ناتج ${index} + 1؟`, choices: [{ key: 'A', text: String(index + 1) }, { key: 'B', text: String(index + 2) }], correctKey: 'A', explanation: 'شرح اختباري بلا إثبات نشر؛ يجب ألا يظهر.', categoryId: category, difficulty: 'easy', reviewStatus: 'draft', sourceId: source, sourcePage: 1, images: [] });
  const review = async (versionId: string) => { for (const reviewStatus of ['reviewed', 'approved']) assert.equal((await request(`/quant/admin/versions/${versionId}/review`, admin, { reviewStatus, reviewNote: 'مراجعة مسألة أصلية مؤلفة لهذا الاختبار المحلي.' }, 'PATCH')).status, 200); };
  const start = async (ids: string[], policy = 'after_submit') => {
    const created = await request('/quant/admin/tests', admin, { title: 'قسم دفتر أصلي محلي', mode: 'practice', timeLimitSec: null, allowReturn: true, revealPolicy: policy, revealAt: policy === 'after_deadline' ? new Date(Date.now() + 3600000).toISOString() : null, status: 'published', schoolId: school, classId, stage: '', versionIds: ids });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const attempt = await request(`/quant/tests/${created.data.id}/attempts`, student, {}); assert.equal(attempt.status, 201, JSON.stringify(attempt.data)); return attempt.data.attemptId as string;
  };
  const answer = (attemptId: string, versionId: string, choiceKey: string) => request(`/quant/attempts/${attemptId}/answers/${versionId}`, student, { choiceKey, flagged: false, revision: 0 }, 'PUT');
  try {
    await t.test('setup authentic memberships and source-reviewed original fixtures', async () => {
      school = (await request('/education/schools', admin, { name: 'مدرسة دفتر تجريبية' })).data.id;
      await request('/education/grants', admin, { userId: teacher, role: 'TEACHER', scope: school });
      await request('/education/grants', admin, { userId: writer, role: 'CONTENT_MANAGER', scope: '' });
      await pool.query("UPDATE education_roles SET permissions=permissions||$1::jsonb WHERE role='CONTENT_MANAGER'", [JSON.stringify(['quant.questions.write'])]);
      classId = (await request('/education/classes', admin, { schoolId: school, ownerId: teacher, name: 'فصل دفتر', grade: 'ثالث', stage: 'ثانوي' })).data.id;
      for (const uid of [student, other]) { const code = await request('/education/codes', admin, { schoolId: school, classId, maxUses: 1, expiresAt: new Date(Date.now() + 86400000).toISOString() }); assert.equal((await request('/education/join', uid, { code: code.data.code })).status, 200); }
      category = (await request('/education/categories', admin, { name: 'مهارة دفتر محلية', track: 'quantitative' })).data.id;
      source = (await request('/quant/admin/sources', admin, { title: 'مصدر اختبار أصلي يحاكي هوية الناشر في القاعدة المؤقتة فقط', fileHash: publisherHash, fileSize: 0, fileName: 'quant-notebook-integration.ts', attribution: 'مسائل أصلية محلية؛ لا يوجد محتوى مقتبس.' })).data.id;
      assert.equal((await request(`/quant/admin/sources/${source}/license`, admin, { licenseStatus: 'verified', licenseNote: 'مسائل أصلية مؤلفة للاختبار المحلي فقط.' }, 'PATCH')).status, 200);
      for (let i = 1; i <= 4; i++) { const q = await request('/quant/admin/questions', writer, body(i)); assert.equal(q.status, 201, JSON.stringify(q.data)); questions.push(q.data.id); versions.push(q.data.versionId); await review(q.data.versionId); }
    });
    await t.test('empty history stays empty and role/CSRF validation is enforced', async () => {
      const empty = await request('/quant/notebook'); assert.equal(empty.status, 200); assert.deepEqual(empty.data.summary, { total: 0, pending: 0, mastered: 0 });
      assert.equal((await request('/quant/notebook', teacher)).status, 403);
      assert.equal((await request('/quant/notebook/practice', student, {}, 'POST', false)).status, 403);
      assert.equal((await request('/quant/notebook/practice', student, { count: 51 })).status, 400);
    });
    await t.test('active, never-reveal, future-deadline and active after-each results never enter the notebook', async () => {
      mainAttempt = await start(versions.slice(0, 2)); assert.equal((await answer(mainAttempt, versions[0], 'B')).status, 200);
      const never = await start([versions[2]], 'never'); await answer(never, versions[2], 'B'); await request(`/quant/attempts/${never}/submit`, student, {});
      const held = await start([versions[3]], 'after_deadline'); await answer(held, versions[3], 'B'); await request(`/quant/attempts/${held}/submit`, student, {});
      const each = await start([versions[2]], 'after_each'); await answer(each, versions[2], 'B');
      const notebook = await request('/quant/notebook'); assert.equal(notebook.status, 200); assert.equal(notebook.data.items.length, 0); assert.ok(!JSON.stringify(notebook.data).includes('correctKey'));
    });
    await t.test('submission automatically adds wrong/unanswered questions without unsupported explanation', async () => {
      assert.equal((await request(`/quant/attempts/${mainAttempt}/submit`, student, {})).status, 200);
      const notebook = await request('/quant/notebook'); assert.equal(notebook.status, 200); assert.equal(notebook.data.items.length, 2);
      assert.deepEqual(new Set(notebook.data.items.map((e: any) => e.item.outcome)), new Set(['wrong', 'unanswered']));
      assert.ok(notebook.data.items.every((e: any) => e.item.correctKey === 'A' && e.item.explanationAvailable === false && !('explanation' in e.item)));
      assert.ok(!/license_note|sourceFileHash|private_path|enrollmentId|retryVersionId/.test(JSON.stringify(notebook.data)));
      assert.deepEqual(notebook.data.summary, { total: 2, pending: 2, mastered: 0 });
    });
    await t.test('search, skill, status and personal ownership filters work', async () => {
      assert.equal((await request('/quant/notebook?search=' + encodeURIComponent('رقم 1'))).data.items.length, 1);
      assert.equal((await request('/quant/notebook?categoryId=' + randomUUID())).data.items.length, 0);
      assert.equal((await request('/quant/notebook?status=mastered')).data.items.length, 0);
      assert.equal((await request('/quant/notebook?status=unknown')).status, 400);
      assert.equal((await request('/quant/notebook', other)).data.items.length, 0);
      assert.equal((await request('/quant/notebook/practice', other, { questionIds: [questions[0]] })).status, 404);
    });
    await t.test('retry deduplicates selected questions and hides answer keys in the active attempt', async () => {
      const retry = await request('/quant/notebook/practice', student, { questionIds: [questions[0], questions[0]], count: 2 }); assert.equal(retry.status, 201, JSON.stringify(retry.data));
      const state = await request('/quant/attempts/' + retry.data.attemptId); assert.equal(state.data.items.length, 1); assert.equal(state.data.items[0].versionId, versions[0]);
      assert.ok(!/correctKey|explanation/.test(JSON.stringify(state.data)));
      await request('/quant/attempts/' + retry.data.attemptId, student, undefined, 'DELETE');
      assert.equal((await request('/quant/notebook/practice', student, { questionIds: [randomUUID()] })).status, 404);
    });
    let nextVersion = '';
    await t.test('retry uses a fresh approved version and refuses an unreviewed current revision', async () => {
      const changed = await request('/quant/admin/questions/' + questions[0], writer, { ...body(1), stem: 'نص نسخة جديدة أصلية لدفتر الأخطاء: ما ناتج 1 + 1؟' }, 'PATCH'); assert.equal(changed.status, 200, JSON.stringify(changed.data)); nextVersion = changed.data.versionId;
      const draft = await request('/quant/notebook'); assert.equal(draft.data.items.find((e: any) => e.item.questionId === questions[0]).retryAvailable, false);
      assert.equal((await request('/quant/notebook/practice', student, { questionIds: [questions[0]] })).status, 409);
      await review(nextVersion);
      const retry = await request('/quant/notebook/practice', student, { questionIds: [questions[0]] }); assert.equal(retry.status, 201);
      const state = await request('/quant/attempts/' + retry.data.attemptId); assert.equal(state.data.items[0].versionId, nextVersion); assert.notEqual(nextVersion, versions[0]);
      assert.equal((await answer(retry.data.attemptId, nextVersion, 'A')).status, 200); await request('/quant/attempts/' + retry.data.attemptId + '/submit', student, {});
    });
    await t.test('a later revealed correct answer automatically marks the prior mistake as mastered', async () => {
      const all = await request('/quant/notebook?status=all'); assert.deepEqual(all.data.summary, { total: 2, pending: 1, mastered: 1 });
      assert.equal(all.data.items.find((e: any) => e.item.questionId === questions[0]).mastered, true);
      assert.equal((await request('/quant/notebook')).data.items[0].item.questionId, questions[1]);
      assert.equal((await request('/quant/notebook?status=mastered')).data.items[0].item.questionId, questions[0]);
    });
    await t.test('source revocation immediately removes notebook content and blocks new retry', async () => {
      await request(`/quant/admin/sources/${source}/license`, admin, { licenseStatus: 'restricted', licenseNote: 'إيقاف مؤقت لاختبار التحقق الحي.' }, 'PATCH');
      const revoked = await request('/quant/notebook?status=all'); assert.equal(revoked.status, 200); assert.equal(revoked.data.items.length, 0); assert.equal(revoked.data.summary.total, 0);
      assert.equal((await request('/quant/notebook/practice', student, {})).status, 409);
      await request(`/quant/admin/sources/${source}/license`, admin, { licenseStatus: 'verified', licenseNote: 'مسائل أصلية مؤلفة للاختبار المحلي فقط.' }, 'PATCH');
    });
    await t.test('review withdrawal, category visibility and membership revocation remove access', async () => {
      await pool.query("UPDATE quant_question_reviews SET review_status='reviewed' WHERE version_id=$1", [versions[1]]);
      assert.ok(!(await request('/quant/notebook?status=all')).data.items.some((e: any) => e.item.questionId === questions[1]));
      await pool.query("UPDATE quant_question_reviews SET review_status='approved' WHERE version_id=$1", [versions[1]]);
      await pool.query('UPDATE education_categories SET visible=false WHERE id=$1', [category]); assert.equal((await request('/quant/notebook?status=all')).data.items.length, 0);
      await pool.query('UPDATE education_categories SET visible=true WHERE id=$1', [category]);
      await pool.query("UPDATE education_enrollments SET status='revoked' WHERE user_id=$1", [student]); assert.equal((await request('/quant/notebook')).status, 403); assert.equal((await request('/quant/notebook/practice', student, {})).status, 403);
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); }
});
