import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { pool, type PoolClient } from '@workspace/db';
import { requireAuth, requireCsrf } from '../lib/auth-middleware';
import { actor, audit, authorize, EducationError, transaction, type Query } from '../lib/education';
import { createId } from '../lib/security';
import {
  QuantError, quantFail, quantStudent, visibleScope, versionQuery, approvedVersion, snapshotItem, pinnedItems, createQuantAttempt,
  ownedQuantAttempt, checkpointQuant, closedQuantError, quantAttemptPayload, publicResponse, quantResult, quantGrade, quantRevealed,
  type QuantItem,
} from '../lib/quant';

export const quantRouter = Router();
const id = z.string().uuid();
const route = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) {
    if (e instanceof QuantError) res.status(e.status).json({ error: e.message, code: e.code, ...e.extra });
    else if (e instanceof EducationError) res.status(e.status).json({ error: e.message, code: e.status === 403 ? 'FORBIDDEN' : 'NOT_FOUND' });
    else if (e instanceof z.ZodError) res.status(400).json({ error: 'راجع الحقول والقيم المطلوبة.', code: 'INVALID_INPUT' });
    else if ((e as any)?.code === '23505') res.status(409).json({ error: 'هذه البيانات موجودة بالفعل.', code: 'DUPLICATE' });
    else next(e);
  }
};
quantRouter.use('/quant', requireAuth, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'GET') requireCsrf(req, res, next); else next();
});
const testBody = z.object({
  title: z.string().trim().min(1).max(240), description: z.string().max(4000).default(''),
  mode: z.enum(['timed', 'untimed', 'practice', 'simulation']), timeLimitSec: z.number().int().min(60).max(14400).nullable().default(null),
  allowReturn: z.boolean().default(true), revealPolicy: z.enum(['never', 'after_submit', 'after_each', 'after_deadline']).default('after_submit'),
  revealAt: z.string().datetime().nullable().default(null), status: z.enum(['draft', 'published', 'hidden']).default('draft'),
  schoolId: id.nullable().default(null), classId: id.nullable().default(null), stage: z.string().max(80).default(''),
  versionIds: z.array(id).max(100).default([]),
});
function testPublic(t: any) {
  return { id: t.id, title: t.title, description: t.description, mode: t.mode, timeLimitSec: t.time_limit_sec, allowReturn: t.allow_return,
    revealPolicy: t.reveal_policy, revealAt: t.reveal_at ? new Date(t.reveal_at).toISOString() : null, status: t.status,
    schoolId: t.school_id, classId: t.class_id, stage: t.stage, itemCount: Number(t.item_count || t.version_ids?.length || 0),
    ...(t.version_ids ? { versionIds: t.version_ids, items: t.version_ids.map((versionId: string) => ({ versionId })) } : {}) };
}
const testsQuery = `SELECT t.*,coalesce((SELECT jsonb_agg(i.version_id ORDER BY i.position) FROM quant_test_items i WHERE i.test_id=t.id),'[]') AS version_ids,
 (SELECT count(*)::int FROM quant_test_items i WHERE i.test_id=t.id) AS item_count FROM quant_tests t`;
// Identify the authorized publisher by its registered file identity, never by a test title.
// This limits new student offerings without removing questions or historical attempts.
const mufakirSourceHash = '3d7c9c2034b8e326d7242b0ffea44e08b58d7f5b40db765a4697f3adeea35c2b';
const mufakirTestPredicate = `EXISTS (SELECT 1 FROM quant_test_items i WHERE i.test_id=t.id)
 AND NOT EXISTS (SELECT 1 FROM quant_test_items i
 LEFT JOIN quant_question_reviews r ON r.version_id=i.version_id LEFT JOIN quant_sources s ON s.id=r.source_id
 WHERE i.test_id=t.id AND coalesce(s.file_hash,'')<>'${mufakirSourceHash}')`;
const sectionOrder = "CASE WHEN t.title ~ '^القسم [0-9]+$' THEN substring(t.title FROM '[0-9]+$')::numeric END ASC NULLS LAST,t.title ASC,t.id";
async function saveTest(req: Request, input: unknown, existing?: string, partial = false) {
  await authorize(req, 'quant.tests.write');
  return transaction(async q => {
    const previous = existing ? (await q.query(testsQuery + ' WHERE t.id=$1 FOR UPDATE OF t', [existing])).rows[0] : null;
    if (existing && !previous) quantFail();
    const raw = input as any;
    const body = { ...(partial && previous ? testPublic(previous) : {}), ...raw };
    if (raw?.questionVersionIds && !raw?.versionIds) body.versionIds = raw.questionVersionIds;
    const v = testBody.parse(body);
    if (['timed', 'simulation'].includes(v.mode) && !v.timeLimitSec) quantFail(400, 'TIME_LIMIT_REQUIRED', 'حدد مدة الاختبار المؤقت.');
    if (v.revealPolicy === 'after_deadline' && !v.revealAt) quantFail(400, 'REVEAL_DATE_REQUIRED', 'حدد موعد إظهار الحلول.');
    if (new Set(v.versionIds).size !== v.versionIds.length) quantFail(400, 'DUPLICATE_QUESTION', 'تتضمن القائمة سؤالًا مكررًا.');
    if (v.schoolId && !(await q.query("SELECT 1 FROM education_schools WHERE id=$1 AND status='active'", [v.schoolId])).rowCount) quantFail(400, 'SCHOOL_UNAVAILABLE', 'المدرسة غير متاحة.');
    if (v.classId) {
      const c = (await q.query('SELECT c.archived,s.school_id FROM teacher_classes c JOIN education_school_classes s ON s.class_id=c.id WHERE c.id=$1', [v.classId])).rows[0];
      if (!c || c.archived || c.school_id !== v.schoolId) quantFail(400, 'CLASS_SCOPE_REQUIRED', 'حدد المدرسة الصحيحة للفصل.');
    }
    if (v.status === 'published') {
      await authorize(req, 'quant.tests.publish', '', q);
      if (!v.versionIds.length) quantFail(400, 'EMPTY_TEST', 'أضف أسئلة معتمدة أولًا.');
      await pinnedItems(q, v.versionIds);
    }
    const versionRows = v.versionIds.length ? (await q.query(versionQuery + ' WHERE v.id=ANY($1::text[])', [v.versionIds])).rows : [];
    if (versionRows.length !== v.versionIds.length) quantFail(400, 'INVALID_QUESTION', 'تتضمن القائمة إصدارًا غير موجود في بنك الكمي.');
    for (const row of versionRows) {
      if (row.track !== 'quantitative' || (row.school_id && row.school_id !== v.schoolId) || (row.class_id && row.class_id !== v.classId) || (row.stage && row.stage !== v.stage))
        quantFail(400, 'QUESTION_SCOPE_MISMATCH', 'نطاق الاختبار يجب أن يحترم المدرسة والفصل والمرحلة المحددة للأسئلة.');
    }
    if (new Set(versionRows.map((r: any) => r.question_id)).size !== versionRows.length) quantFail(400, 'DUPLICATE_QUESTION', 'لا تضف نسختين من السؤال نفسه.');
    const tid = existing || createId();
    const values = [tid, v.title, v.description, v.mode, v.timeLimitSec, v.allowReturn, v.revealPolicy, v.revealAt, v.status, v.schoolId, v.classId, v.stage, actor(req)];
    if (existing) await q.query('UPDATE quant_tests SET title=$2,description=$3,mode=$4,time_limit_sec=$5,allow_return=$6,reveal_policy=$7,reveal_at=$8,status=$9,school_id=$10,class_id=$11,stage=$12,updated_at=now() WHERE id=$1', values.slice(0, 12));
    else await q.query('INSERT INTO quant_tests(id,title,description,mode,time_limit_sec,allow_return,reveal_policy,reveal_at,status,school_id,class_id,stage,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', values);
    await q.query('DELETE FROM quant_test_items WHERE test_id=$1', [tid]);
    for (const [position, versionId] of v.versionIds.entries()) await q.query('INSERT INTO quant_test_items(test_id,version_id,position) VALUES($1,$2,$3)', [tid, versionId, position]);
    await audit(q, req, 'quant.test.' + (v.status === 'published' ? 'published' : existing ? 'updated' : 'created'), tid, v.schoolId);
    return { id: tid };
  });
}
quantRouter.get('/quant/admin/tests', route(async (req, res) => {
  await authorize(req, 'quant.tests.write');
  res.json((await pool.query(testsQuery + ' ORDER BY t.updated_at DESC LIMIT 300')).rows.map(testPublic));
}));
quantRouter.get('/quant/admin/tests/:id', route(async (req, res) => {
  await authorize(req, 'quant.tests.write');
  const t = (await pool.query(testsQuery + ' WHERE t.id=$1', [id.parse(req.params.id)])).rows[0]; if (!t) quantFail();
  const rows = t.version_ids.length ? (await pool.query(versionQuery + ' WHERE v.id=ANY($1::text[])', [t.version_ids])).rows : [];
  res.json({ test: testPublic(t), items: t.version_ids.map((vid: string, position: number) => {
    const row = rows.find((r: any) => r.version_id === vid); return row ? { ...snapshotItem(row, position), reviewStatus: row.review_status, licenseStatus: row.license_status } : null;
  }).filter(Boolean) });
}));
quantRouter.post('/quant/admin/tests', route(async (req, res) => { res.status(201).json(await saveTest(req, req.body)); }));
quantRouter.put('/quant/admin/tests/:id', route(async (req, res) => { res.json(await saveTest(req, req.body, id.parse(req.params.id))); }));
quantRouter.patch('/quant/admin/tests/:id', route(async (req, res) => { res.json(await saveTest(req, req.body, id.parse(req.params.id), true)); }));

quantRouter.get('/quant/meta', route(async (req, res) => {
  const members = await quantStudent(req);
  const categories = (await pool.query("SELECT * FROM education_categories WHERE track='quantitative' AND visible AND NOT archived ORDER BY position,name")).rows.filter(c => members.some(m => visibleScope(c, m)));
  const counts = (await pool.query(`SELECT c.id AS category_id,c.school_id,c.class_id,c.stage,count(*)::int AS n
    FROM education_question_versions v JOIN education_questions q ON q.id=v.question_id
    JOIN education_categories c ON c.id=coalesce(v.snapshot->>'categoryId',q.category_id)
    JOIN quant_question_reviews r ON r.version_id=v.id JOIN quant_sources s ON s.id=r.source_id WHERE v.number=q.revision
    AND r.review_status='approved' AND s.license_status='verified' AND length(trim(s.license_note))>0 AND s.file_hash=$1
    AND c.track='quantitative' AND c.visible AND NOT c.archived GROUP BY c.id,c.school_id,c.class_id,c.stage`, [mufakirSourceHash])).rows
    .filter(c => members.some(m => visibleScope(c, m)));
  const skills = categories.map(c => ({ id: c.id, name: c.name, description: c.description, icon: c.icon,
    questionCount: counts.find(r => r.category_id === c.id)?.n || 0 })).filter(c => c.questionCount > 0);
  res.json({ userId: actor(req), track: 'quantitative', verbal: { status: 'coming_soon', title: 'اللفظي قريبًا' },
    skills,
    thresholds: { minimum: 5, adequate: 15 }, scratchLimits: { strokes: 400, pointsPerStroke: 4000, totalPoints: 12000 }, serverTime: new Date().toISOString() });
}));
quantRouter.get('/quant/tests', route(async (req, res) => {
  const members = await quantStudent(req);
  const rows = (await pool.query(testsQuery + ` WHERE t.status='published' AND ${mufakirTestPredicate} ORDER BY ${sectionOrder} LIMIT 200`)).rows;
  const visible = [];
  for (const t of rows) {
    if (!t.item_count || !members.some(m => visibleScope(t, m))) continue;
    const member = members.filter(m => visibleScope(t, m));
    try { await pinnedItems(pool, t.version_ids, member); } catch (e) { if (e instanceof QuantError) continue; throw e; }
    const { versionIds: _versionIds, items: _items, ...safe } = testPublic(t); visible.push(safe);
  }
  res.json(visible);
}));
async function guardAttemptCount(q: PoolClient, uid: string) {
  await q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [uid]);
  const n = (await q.query("SELECT count(*)::int AS n FROM quant_attempts WHERE user_id=$1 AND status='in_progress' AND (deadline_at IS NULL OR deadline_at>now())", [uid])).rows[0].n;
  if (n >= 5) quantFail(429, 'TOO_MANY_ATTEMPTS', 'أكمل محاولاتك المفتوحة قبل بدء تدريب آخر.');
}
quantRouter.post('/quant/tests/:id/attempts', route(async (req, res) => {
  const testId = id.parse(req.params.id), input = z.object({ enrollmentId: id.optional() }).parse(req.body || {});
  const result = await transaction(async q => {
    const members = await quantStudent(req, true, q);
    const t = (await q.query(testsQuery + ` WHERE t.id=$1 AND t.status='published' AND ${mufakirTestPredicate} FOR SHARE OF t`, [testId])).rows[0];
    if (!t) quantFail();
    const member = members.find(m => visibleScope(t, m) && (!input.enrollmentId || m.id === input.enrollmentId)); if (!member) quantFail();
    const items = await pinnedItems(q, t.version_ids, [member]); if (!items.length) quantFail(409, 'EMPTY_TEST', 'الاختبار لا يحتوي أسئلة معتمدة.');
    await q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor(req)]);
    const previous = (await q.query("SELECT id,deadline_at,started_at FROM quant_attempts WHERE user_id=$1 AND test_id=$2 AND enrollment_id=$3 AND status='in_progress' AND (deadline_at IS NULL OR deadline_at>now()) ORDER BY started_at DESC LIMIT 1", [actor(req), testId, member.id])).rows[0];
    if (previous) return { attemptId: previous.id, deadlineAt: previous.deadline_at, startedAt: previous.started_at, serverTime: new Date().toISOString() };
    await guardAttemptCount(q, actor(req));
    return createQuantAttempt(req, q, testPublic(t), items, member, testId);
  }); res.status(201).json(result);
}));
quantRouter.post('/quant/practice', route(async (req, res) => {
  const v = z.object({ categoryId: id.optional(), count: z.number().int().min(1).max(50).default(10), timeLimitSec: z.number().int().min(60).max(14400).nullable().optional(), enrollmentId: id.optional() }).parse(req.body);
  const result = await transaction(async q => {
    const members = await quantStudent(req, true, q);
    let category: Record<string, any> | undefined;
    if (v.categoryId) {
      category = (await q.query("SELECT * FROM education_categories WHERE id=$1 AND track='quantitative' AND visible AND NOT archived", [v.categoryId])).rows[0];
      if (!category) quantFail();
    }
    const member = members.find(m => (!category || visibleScope(category, m)) && (!v.enrollmentId || m.id === v.enrollmentId)); if (!member) quantFail();
    const rows = (await q.query(versionQuery + ` WHERE v.number=q.revision AND r.review_status='approved' AND s.license_status='verified' AND length(trim(s.license_note))>0 AND s.file_hash=$6 AND c.track='quantitative' AND c.visible AND NOT c.archived
      AND ($1::text IS NULL OR c.id=$1) AND (c.school_id IS NULL OR c.school_id=$2) AND (c.class_id IS NULL OR c.class_id=$3) AND (c.stage='' OR c.stage=$4) ORDER BY random() LIMIT $5`,
    [v.categoryId || null, member.school_id, member.class_id, member.class_data?.stage || '', v.count, mufakirSourceHash])).rows;
    const items = rows.filter(approvedVersion).map(snapshotItem);
    if (!items.length) quantFail(409, 'NO_APPROVED_QUESTIONS', 'لا توجد أسئلة معتمدة من المفكر متاحة لهذا التدريب بعد.');
    await guardAttemptCount(q, actor(req));
    return createQuantAttempt(req, q, { title: category ? 'تدريب: ' + category.name : 'تدريب كمي متنوع', mode: 'practice', timeLimitSec: v.timeLimitSec || null, allowReturn: true, revealPolicy: 'after_submit', revealAt: null, classId: category?.class_id || null }, items, member, null);
  }); res.status(201).json(result);
}));

async function withAttempt(req: Request, write: boolean, action: (q: PoolClient, a: any) => Promise<any>) {
  const aid = id.parse(req.params.id);
  return transaction(async q => {
    const members = await quantStudent(req, write, q), a = await ownedQuantAttempt(req, aid, q, members);
    await checkpointQuant(q, a);
    if (write && closedQuantError(a)) return { closedError: closedQuantError(a) };
    return action(q, a);
  });
}
function sendAttemptResult(res: Parameters<RequestHandler>[1], result: any) {
  if (result.closedError) res.status(result.closedError.status).json({ error: result.closedError.error, code: result.closedError.code, serverTime: new Date().toISOString() });
  else res.json(result);
}
function itemInAttempt(a: any, vid: string, editable = false) {
  const item = (a.snapshot as QuantItem[]).find(i => i.versionId === vid);
  if (!item) quantFail(404, 'NOT_IN_TEST', 'السؤال ليس ضمن هذه المحاولة.');
  if (editable && !a.test_snapshot.allowReturn && item.position !== a.current_index) quantFail(409, 'RETURN_DISABLED', 'لا يمكن تعديل سؤال غادرته في هذا الاختبار.');
  return item;
}
quantRouter.get('/quant/attempts/:id', route(async (req, res) => { sendAttemptResult(res, await withAttempt(req, false, quantAttemptPayload)); }));
quantRouter.post('/quant/attempts/:id/navigate', route(async (req, res) => {
  const v = z.object({ position: z.number().int().min(0).max(99) }).parse(req.body);
  sendAttemptResult(res, await withAttempt(req, true, async (q, a) => {
    if (v.position >= a.snapshot.length) quantFail(400, 'INVALID_POSITION', 'رقم السؤال غير صالح.');
    if (!a.test_snapshot.allowReturn && v.position < a.current_index) quantFail(409, 'RETURN_DISABLED', 'الرجوع غير متاح في هذا الاختبار.');
    await q.query('UPDATE quant_attempts SET current_index=$2 WHERE id=$1', [a.id, v.position]); a.current_index = v.position;
    await q.query('UPDATE quant_responses SET visited=true WHERE attempt_id=$1 AND version_id=$2', [a.id, a.snapshot[v.position].versionId]);
    return quantAttemptPayload(q, a);
  }));
}));
const answerBody = z.object({ choiceKey: z.string().min(1).max(4).nullable(), flagged: z.boolean(), revision: z.number().int().min(0) });
quantRouter.put('/quant/attempts/:id/answers/:versionId', route(async (req, res) => {
  const vid = id.parse(req.params.versionId), v = answerBody.parse(req.body);
  sendAttemptResult(res, await withAttempt(req, true, async (q, a) => {
    const item = itemInAttempt(a, vid, true);
    if (v.choiceKey && !item.choices.some(c => c.key === v.choiceKey)) quantFail(400, 'INVALID_CHOICE', 'الخيار غير صالح لهذا السؤال.');
    const row = (await q.query('SELECT * FROM quant_responses WHERE attempt_id=$1 AND version_id=$2', [a.id, vid])).rows[0];
    if (!row || row.revision !== v.revision) quantFail(409, 'REVISION_CONFLICT', 'توجد إجابة أحدث. أعد تحميلها قبل الحفظ.', { currentRevision: row?.revision || 0 });
    const changes = row.change_count + (row.choice_key !== v.choiceKey && row.first_answered_at ? 1 : 0);
    const r = (await q.query(`UPDATE quant_responses SET choice_key=$3,flagged=$4,revision=revision+1,change_count=$5,visited=true,updated_at=now(),
      first_answered_at=CASE WHEN $3::text IS NOT NULL THEN coalesce(first_answered_at,now()) ELSE first_answered_at END WHERE attempt_id=$1 AND version_id=$2 RETURNING *`, [a.id, vid, v.choiceKey, v.flagged, changes])).rows[0];
    return { revision: r.revision, response: publicResponse(r), serverTime: new Date().toISOString() };
  }));
}));
const stroke = z.object({ id: z.string().max(100).optional(), color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/), width: z.number().finite().min(0.1).max(60),
  tool: z.enum(['pen', 'eraser']).optional(), points: z.array(z.tuple([z.number().finite().min(-10000).max(10000), z.number().finite().min(-10000).max(10000), z.number().finite().min(0).max(1)])).min(1).max(4000) });
const scratchBody = z.object({ strokes: z.array(stroke).max(400), revision: z.number().int().min(0) }).refine(v => v.strokes.reduce((n, s) => n + s.points.length, 0) <= 12000);
quantRouter.get('/quant/attempts/:id/scratchpad/:versionId', route(async (req, res) => {
  const vid = id.parse(req.params.versionId);
  sendAttemptResult(res, await withAttempt(req, false, async (q, a) => {
    itemInAttempt(a, vid); const r = (await q.query('SELECT strokes,revision FROM quant_scratchpads WHERE attempt_id=$1 AND version_id=$2', [a.id, vid])).rows[0];
    return { strokes: r?.strokes || [], revision: r?.revision || 0, serverTime: new Date().toISOString() };
  }));
}));
quantRouter.put('/quant/attempts/:id/scratchpad/:versionId', route(async (req, res) => {
  const vid = id.parse(req.params.versionId), v = scratchBody.parse(req.body);
  sendAttemptResult(res, await withAttempt(req, true, async (q, a) => {
    itemInAttempt(a, vid, true); const r = (await q.query('SELECT revision FROM quant_scratchpads WHERE attempt_id=$1 AND version_id=$2', [a.id, vid])).rows[0];
    if ((r?.revision || 0) !== v.revision) quantFail(409, 'REVISION_CONFLICT', 'توجد مسودة أحدث. أعد تحميلها قبل الحفظ.', { currentRevision: r?.revision || 0 });
    const revision = v.revision + 1;
    await q.query(`INSERT INTO quant_scratchpads(attempt_id,version_id,strokes,revision) VALUES($1,$2,$3::jsonb,$4)
      ON CONFLICT(attempt_id,version_id) DO UPDATE SET strokes=EXCLUDED.strokes,revision=EXCLUDED.revision,updated_at=now()`, [a.id, vid, JSON.stringify(v.strokes), revision]);
    return { revision, serverTime: new Date().toISOString() };
  }));
}));
quantRouter.post('/quant/attempts/:id/submit', route(async (req, res) => {
  // A completed attempt remains idempotently readable; submission never changes saved answers.
  sendAttemptResult(res, await withAttempt(req, false, async (q, a) => {
    await authorize(req, 'practice.write', '', q);
    if (a.status === 'in_progress') {
      await q.query("UPDATE quant_attempts SET status='submitted',submitted_at=now() WHERE id=$1", [a.id]); a.status = 'submitted'; a.submitted_at = new Date();
      await audit(q, req, 'quant.attempt.submitted', a.id, a.school_id);
    }
    return quantResult(q, a);
  }));
}));
quantRouter.get('/quant/attempts/:id/result', route(async (req, res) => { sendAttemptResult(res, await withAttempt(req, false, quantResult)); }));
quantRouter.delete('/quant/attempts/:id', route(async (req, res) => {
  sendAttemptResult(res, await withAttempt(req, false, async (q, a) => {
    await authorize(req, 'practice.write', '', q); await audit(q, req, 'quant.attempt.deleted', a.id, a.school_id);
    await q.query('DELETE FROM quant_attempts WHERE id=$1', [a.id]); return { ok: true };
  }));
}));
async function historyRows(req: Request, q: Query = pool) {
  const members = await quantStudent(req, false, q);
  return (await q.query('SELECT * FROM quant_attempts WHERE user_id=$1 ORDER BY started_at DESC LIMIT 300 FOR UPDATE', [actor(req)])).rows
    .filter(a => members.some(m => m.id === a.enrollment_id && m.school_id === a.school_id && (!a.class_id || m.class_id === a.class_id)));
}
// The notebook is derived from the student's own revealed history. It stores no
// extra copy of licensed questions and never upgrades an unrevealed result.
async function notebookRows(req: Request, q: Query) {
  const members = await quantStudent(req, false, q), attempts = await historyRows(req, q);
  for (const a of attempts) await checkpointQuant(q, a);
  const revealed = attempts.filter(a => a.status !== 'in_progress' && quantRevealed(a))
    .sort((a, b) => new Date(b.submitted_at || b.started_at).getTime() - new Date(a.submitted_at || a.started_at).getTime());
  const versionIds = [...new Set(revealed.flatMap(a => (a.snapshot as QuantItem[]).map(item => item.versionId)))];
  const versions = versionIds.length ? (await q.query(versionQuery + ' WHERE v.id=ANY($1::text[])', [versionIds])).rows : [];
  const current = versions.length ? (await q.query(versionQuery + ' WHERE q.id=ANY($1::text[]) AND v.number=q.revision', [[...new Set(versions.map(v => v.question_id))]])).rows : [];
  const entries = new Map<string, any>(), latest = new Map<string, string>();
  for (const a of revealed) {
    const member = members.find(m => m.id === a.enrollment_id)!;
    const result = await quantResult(q, a);
    for (const item of result.items) {
      const row = versions.find(v => v.version_id === item.versionId);
      const frozen = (a.snapshot as QuantItem[]).find(v => v.versionId === item.versionId);
      if (!row || !frozen || row.source_id !== frozen.sourceId || !approvedVersion(row) || row.source_file_hash !== mufakirSourceHash || !visibleScope(row, member)) continue;
      if (!latest.has(item.questionId)) latest.set(item.questionId, item.outcome);
      if (!['wrong', 'unanswered'].includes(item.outcome)) continue;
      let entry = entries.get(item.questionId);
      if (!entry) {
        const retry = current.find(v => v.question_id === item.questionId && approvedVersion(v) && v.source_file_hash === mufakirSourceHash && visibleScope(v, member));
        entry = { item, attemptId: a.id, testTitle: result.test.title, submittedAt: a.submitted_at || a.started_at,
          mistakeCount: 0, wrongCount: 0, unansweredCount: 0, mastered: latest.get(item.questionId) === 'correct',
          retryVersionId: retry?.version_id || null, enrollmentId: member.id };
        entries.set(item.questionId, entry);
      }
      entry.mistakeCount++; if (item.outcome === 'wrong') entry.wrongCount++; else entry.unansweredCount++;
    }
  }
  return { entries: [...entries.values()], members, reviewedAttempts: revealed.length, historyLimit: 300 };
}
const notebookFilter = z.object({ categoryId: id.optional(), search: z.string().trim().max(100).default(''), status: z.enum(['all', 'pending', 'mastered']).default('pending') });
quantRouter.get('/quant/notebook', route(async (req, res) => {
  const input = notebookFilter.parse(req.query);
  res.json(await transaction(async q => {
    const notebook = await notebookRows(req, q), all = notebook.entries;
    const skills = [...new Map(all.map(e => [e.item.categoryId, { id: e.item.categoryId, name: e.item.skill }])).values()];
    const search = input.search.normalize('NFKC').toLocaleLowerCase('ar');
    const items = all.filter(e => (!input.categoryId || e.item.categoryId === input.categoryId) &&
      (input.status === 'all' || e.mastered === (input.status === 'mastered')) && (!search ||
        [e.item.stem, e.item.skill, e.testTitle, e.item.source?.section, e.item.source?.questionNumber].join(' ').normalize('NFKC').toLocaleLowerCase('ar').includes(search)))
      .slice(0, 100).map(({ retryVersionId, enrollmentId: _enrollmentId, ...entry }) => ({ ...entry, retryAvailable: !!retryVersionId }));
    return { items, skills, summary: { total: all.length, pending: all.filter(e => !e.mastered).length, mastered: all.filter(e => e.mastered).length },
      reviewedAttempts: notebook.reviewedAttempts, historyLimit: notebook.historyLimit, displayLimit: 100, serverTime: new Date().toISOString() };
  }));
}));
quantRouter.post('/quant/notebook/practice', route(async (req, res) => {
  const input = z.object({ questionIds: z.array(id).min(1).max(50).optional(), categoryId: id.optional(), count: z.number().int().min(1).max(50).default(10) }).parse(req.body || {});
  res.status(201).json(await transaction(async q => {
    await quantStudent(req, true, q);
    const notebook = await notebookRows(req, q);
    if (input.questionIds?.some(qid => !notebook.entries.some(e => e.item.questionId === qid))) quantFail();
    const candidates = notebook.entries.filter(e => e.retryVersionId && (!input.categoryId || e.item.categoryId === input.categoryId) &&
      (input.questionIds ? input.questionIds.includes(e.item.questionId) : !e.mastered))
      .sort((a, b) => b.mistakeCount - a.mistakeCount || new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
    if (!candidates.length) quantFail(409, 'NO_NOTEBOOK_QUESTIONS', 'لا توجد أسئلة معتمدة متاحة لإعادة التدريب من دفتر أخطائك الآن.');
    const member = notebook.members.find(m => m.id === candidates[0].enrollmentId)!;
    if (input.questionIds && candidates.some(e => e.enrollmentId !== member.id)) quantFail(409, 'NOTEBOOK_SCOPE_MISMATCH', 'اختر أسئلة من فصل واحد لبدء تدريب موحّد.');
    const selected = candidates.filter(e => e.enrollmentId === member.id).slice(0, input.count);
    const items = await pinnedItems(q, selected.map(e => e.retryVersionId), [member]);
    await guardAttemptCount(q, actor(req));
    return createQuantAttempt(req, q, { title: 'تدريب من دفتر أخطائي', mode: 'practice', timeLimitSec: null, allowReturn: true,
      revealPolicy: 'after_submit', revealAt: null, classId: member.class_id || null }, items, member, null);
  }));
}));
quantRouter.get('/quant/history', route(async (req, res) => {
  const rows = await transaction(async q => {
    const all = await historyRows(req, q), out = [];
    for (const a of all) {
      await checkpointQuant(q, a);
      const result = a.status !== 'in_progress' ? await quantResult(q, a) : null;
      out.push({ id: a.id, title: a.test_snapshot.title, status: a.status, startedAt: a.started_at, submittedAt: a.submitted_at, deadlineAt: a.deadline_at,
        ...(result ? { summary: result.summary, revealed: result.revealed, revealAt: result.revealAt } : {}) });
    }
    return out;
  }); res.json(rows);
}));
quantRouter.get('/quant/analytics', route(async (req, res) => {
  const result = await transaction(async q => {
    const all = await historyRows(req, q), skills = new Map<string, any>(), recommendations: any[] = [];
    const repeated = new Map<string, { questionId: string; skillId: string; skill: string; attempts: Set<string> }>();
    const summary = { correct: 0, wrong: 0, unanswered: 0, total: 0, accuracy: null as number | null, completion: 0, answerChanges: 0, timeSpentMs: 0 };
    for (const a of all) await checkpointQuant(q, a);
    const scored = all.filter(a => a.status !== 'in_progress' && (a.test_snapshot.revealPolicy !== 'after_deadline' || quantRevealed(a)));
    for (const a of scored) {
      const responses = (await q.query('SELECT * FROM quant_responses WHERE attempt_id=$1', [a.id])).rows;
      const grade = quantGrade(a.snapshot, responses);
      summary.correct += grade.correct; summary.wrong += grade.wrong; summary.unanswered += grade.unanswered;
      summary.total += grade.total; summary.answerChanges += grade.answerChanges; summary.timeSpentMs += grade.timeSpentMs;
      for (const item of a.snapshot as QuantItem[]) {
        const r = responses.find(r => r.version_id === item.versionId), s = skills.get(item.categoryId) || {
          id: item.categoryId, name: item.skill, correct: 0, attempted: 0, total: 0, unanswered: 0, time: 0, timed: 0, changeCount: 0, attemptIds: new Set<string>(), recent: [],
        };
        s.total++; s.attemptIds.add(a.id); s.changeCount += r?.change_count || 0;
        if (!r?.choice_key) s.unanswered++;
        else {
          s.attempted++; const correct = r.choice_key === item.correctKey; if (correct) s.correct++;
          if (!correct && a.test_snapshot.revealPolicy !== 'never' && quantRevealed(a)) {
            const previous = repeated.get(item.questionId) || { questionId: item.questionId, skillId: item.categoryId, skill: item.skill, attempts: new Set<string>() };
            previous.attempts.add(a.id); repeated.set(item.questionId, previous);
          }
          if (Number(r.time_spent_ms) > 0) { s.time += Number(r.time_spent_ms); s.timed++; }
          s.recent.push(correct);
        }
        skills.set(item.categoryId, s);
      }
    }
    summary.accuracy = summary.correct + summary.wrong ? summary.correct / (summary.correct + summary.wrong) : null;
    summary.completion = summary.total ? (summary.correct + summary.wrong) / summary.total : 0;
    const data = [...skills.values()].map(s => ({ id: s.id, name: s.name, correct: s.correct, attempted: s.attempted, total: s.total, unanswered: s.unanswered,
      accuracy: s.attempted ? s.correct / s.attempted : null, mastery: (s.correct + 1) / (s.attempted + 2),
      confidence: s.attempted < 5 ? 'insufficient' : s.attempted < 15 ? 'low' : 'ok', averageTimeMs: s.timed ? s.time / s.timed : null, changeCount: s.changeCount,
      trend: s.recent.length >= 10 ? (s.recent.slice(0, 5).filter(Boolean).length - s.recent.slice(5, 10).filter(Boolean).length) / 5 : null,
      attemptIds: [...s.attemptIds] }));
    const totalAverage = data.filter(s => s.averageTimeMs !== null).reduce((n, s) => n + s.averageTimeMs!, 0) / Math.max(1, data.filter(s => s.averageTimeMs !== null).length);
    for (const s of data) {
      let kind = '', reason = '';
      if (s.confidence === 'insufficient') { kind = 'practice_set'; reason = `أجبت عن ${s.attempted} سؤالًا في ${s.name}؛ يلزم 5 إجابات على الأقل قبل تقدير نقاط القوة أو الضعف.`; }
      else if (s.accuracy !== null && s.accuracy < 0.6) { kind = 'review_topic'; reason = `الدقة ${Math.round(s.accuracy * 100)}٪ من ${s.attempted} إجابة في ${s.name}.`; }
      else if (s.accuracy !== null && s.accuracy >= 0.8 && s.averageTimeMs !== null && s.averageTimeMs > totalAverage * 1.5 && s.confidence === 'ok') { kind = 'revisit_slow_questions'; reason = `دقتك جيدة في ${s.name}، ومتوسط الوقت أطول من متوسط موضوعاتك الأخرى؛ جرّب تدريبًا قصيرًا على سرعة الحل.`; }
      else if (s.total >= 5 && s.unanswered / s.total > 0.3) { kind = 'practice_set'; reason = `تركت ${s.unanswered} من ${s.total} سؤالًا دون إجابة في ${s.name}؛ ابدأ بتدريب غير مؤقت.`; }
      if (kind) recommendations.push({ kind, skillId: s.id, skill: s.name, reason, basedOnAttemptIds: s.attemptIds });
    }
    const repeatedErrors = [...repeated.values()].filter(r => r.attempts.size >= 2).map(r => ({ questionId: r.questionId, skillId: r.skillId, skill: r.skill,
      count: r.attempts.size, basedOnAttemptIds: [...r.attempts] }));
    return { skills: data, recommendations, repeatedErrors, summary, thresholds: { minimum: 5, adequate: 15 }, totalAttempts: all.length, scoredAttempts: scored.length,
      pendingResults: all.filter(a => a.status !== 'in_progress' && a.test_snapshot.revealPolicy === 'after_deadline' && !quantRevealed(a)).length, serverTime: new Date().toISOString() };
  }); res.json(result);
}));
