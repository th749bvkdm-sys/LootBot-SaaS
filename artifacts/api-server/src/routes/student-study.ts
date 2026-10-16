import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { pool } from '@workspace/db';
import { requireAuth, requireCsrf } from '../lib/auth-middleware';
import { actor, EducationError, fail, transaction } from '../lib/education';
import { createId, sha256 } from '../lib/security';
import { academyTracks, trackQuestions, type AcademyQuestion } from '../content/student-academy';
import { liveMember, studyStudent, studyLimit, studyTask, studyFocus, studyOverview, studyRoom, studyRoomPayload, studyRooms } from '../lib/student-study';

export const studentStudyRouter = Router();
const id = z.string().uuid();
const title = z.string().trim().min(1).max(160).refine(s => !/[\u0000-\u001f]/u.test(s));
const nickname = z.string().trim().min(2).max(24).refine(s => /^[\p{L}\p{M} _-]+$/u.test(s), 'استخدم اسمًا مستعارًا من الحروف دون بيانات تواصل.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const route = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await handler(req, res, next); }
  catch (e) {
    if (e instanceof EducationError) res.status(e.status).json({ error: e.message });
    else if (e instanceof z.ZodError) res.status(400).json({ error: 'تحقق من الحقول المطلوبة والقيم.' });
    else if ((e as any)?.code === '23505') res.status(409).json({ error: 'العملية موجودة بالفعل. حدّث الصفحة.' });
    else next(e);
  }
};
studentStudyRouter.use('/student-study', requireAuth, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'GET') requireCsrf(req, res, next); else next();
}, route(async (req, _res, next) => { await studyStudent(req); next(); }));

studentStudyRouter.get('/student-study/overview', route(async (req, res) => {
  res.json({ ...await studyOverview(req), rooms: await studyRooms(req) });
}));
studentStudyRouter.put('/student-study/goal', route(async (req, res) => {
  const v = z.object({ dailyGoalMinutes: z.number().int().min(5).max(240) }).parse(req.body);
  await studyLimit(req, 'write', 240);
  await pool.query('INSERT INTO student_study_preferences(user_id,daily_goal_minutes) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET daily_goal_minutes=$2,updated_at=now()', [actor(req), v.dailyGoalMinutes]);
  res.json(v);
}));
studentStudyRouter.get('/student-study/tasks', route(async (req, res) => {
  res.json((await pool.query('SELECT * FROM student_study_tasks WHERE user_id=$1 AND NOT removed ORDER BY done,due_date ASC NULLS LAST,created_at DESC LIMIT 100', [actor(req)])).rows.map(studyTask));
}));
studentStudyRouter.post('/student-study/tasks', route(async (req, res) => {
  const v = z.object({ title, dueDate: date.nullable().default(null) }).parse(req.body);
  await studyLimit(req, 'write', 240);
  const task = await transaction(async q => {
    // Serialize per student so concurrent requests cannot bypass the bounded planner.
    await q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor(req)]);
    const count = (await q.query('SELECT count(*)::int AS n FROM student_study_tasks WHERE user_id=$1 AND NOT removed', [actor(req)])).rows[0].n;
    if (count >= 100) fail(409, 'قائمة المهام ممتلئة. احذف مهمة قديمة أولًا.');
    return (await q.query('INSERT INTO student_study_tasks(id,user_id,title,due_date) VALUES($1,$2,$3,$4) RETURNING *', [createId(), actor(req), v.title, v.dueDate])).rows[0];
  });
  res.status(201).json(studyTask(task));
}));
studentStudyRouter.patch('/student-study/tasks/:id', route(async (req, res) => {
  const tid = id.parse(req.params.id);
  const v = z.object({ title: title.optional(), dueDate: date.nullable().optional(), done: z.boolean().optional() }).refine(v => Object.keys(v).length > 0).parse(req.body);
  await studyLimit(req, 'write', 240);
  const task = await transaction(async q => {
    const row = (await q.query('SELECT * FROM student_study_tasks WHERE id=$1 AND user_id=$2 AND NOT removed FOR UPDATE', [tid, actor(req)])).rows[0];
    if (!row) fail();
    const done = v.done ?? row.done;
    return (await q.query('UPDATE student_study_tasks SET title=$3,due_date=$4,done=$5,completed_at=CASE WHEN $5 THEN coalesce(completed_at,now()) ELSE NULL END,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *',
      [tid, actor(req), v.title ?? row.title, v.dueDate === undefined ? row.due_date : v.dueDate, done])).rows[0];
  });
  res.json(studyTask(task));
}));
studentStudyRouter.delete('/student-study/tasks/:id', route(async (req, res) => {
  await studyLimit(req, 'write', 240);
  const result = await pool.query('UPDATE student_study_tasks SET removed=true,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id', [id.parse(req.params.id), actor(req)]);
  if (!result.rowCount) fail();
  res.json({ ok: true });
}));
studentStudyRouter.post('/student-study/focus/start', route(async (req, res) => {
  const v = z.object({ minutes: z.number().int().min(1).max(120), requestId: id }).parse(req.body);
  await studyLimit(req, 'write', 240);
  const focus = await transaction(async q => {
    await q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor(req)]);
    const previous = (await q.query('SELECT * FROM student_focus_sessions WHERE user_id=$1 AND request_id=$2', [actor(req), v.requestId])).rows[0];
    if (previous) {
      if (previous.planned_minutes !== v.minutes) fail(409, 'مفتاح الطلب مستخدم لجلسة مختلفة.');
      return previous;
    }
    await q.query("UPDATE student_focus_sessions SET status='cancelled' WHERE user_id=$1 AND status='active' AND ends_at<now()-interval '4 hours'", [actor(req)]);
    if ((await q.query("SELECT 1 FROM student_focus_sessions WHERE user_id=$1 AND status='active'", [actor(req)])).rowCount) fail(409, 'لديك جلسة تركيز نشطة. أكملها أو ألغها أولًا.');
    return (await q.query("INSERT INTO student_focus_sessions(id,user_id,request_id,planned_minutes,ends_at) VALUES($1,$2,$3,$4,now()+make_interval(mins=>$4)) RETURNING *", [createId(), actor(req), v.requestId, v.minutes])).rows[0];
  });
  res.json({ ...studyFocus(focus), serverNow: new Date().toISOString() });
}));
studentStudyRouter.post('/student-study/focus/:id/complete', route(async (req, res) => {
  const fid = id.parse(req.params.id);
  await studyLimit(req, 'write', 240);
  const focus = await transaction(async q => {
    const row = (await q.query('SELECT *,ends_at<=now() AS ready,ends_at>=now()-interval \'4 hours\' AS fresh FROM student_focus_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE', [fid, actor(req)])).rows[0];
    if (!row) fail();
    if (row.status === 'completed') return row;
    if (row.status !== 'active') fail(409, 'هذه الجلسة ملغاة.');
    if (!row.ready) fail(409, 'لم تنته مدة التركيز بعد.');
    if (!row.fresh) fail(409, 'انتهت صلاحية تأكيد الجلسة. ابدأ جلسة جديدة.');
    return (await q.query("UPDATE student_focus_sessions SET status='completed',completed_at=now() WHERE id=$1 RETURNING *", [fid])).rows[0];
  });
  res.json({ focus: studyFocus(focus), ...(await studyOverview(req)) });
}));
studentStudyRouter.post('/student-study/focus/:id/cancel', route(async (req, res) => {
  await studyLimit(req, 'write', 240);
  const row = (await pool.query("UPDATE student_focus_sessions SET status=CASE WHEN status='active' THEN 'cancelled' ELSE status END WHERE id=$1 AND user_id=$2 RETURNING *", [id.parse(req.params.id), actor(req)])).rows[0];
  if (!row) fail();
  res.json(studyFocus(row));
}));

studentStudyRouter.get('/student-study/rooms', route(async (req, res) => { res.json(await studyRooms(req)); }));
studentStudyRouter.post('/student-study/rooms', route(async (req, res) => {
  const v = z.object({ title: title.pipe(z.string().max(80)), nickname, capacity: z.number().int().min(2).max(12).default(6), schoolId: id.optional() }).parse(req.body);
  await studyLimit(req, 'create-room', 8);
  const raw = randomBytes(8).toString('hex').toUpperCase();
  const result = await transaction(async q => {
    const schools = await studyStudent(req, q), school = v.schoolId ? schools.find(m => m.school_id === v.schoolId) : schools[0];
    if (!school) fail();
    await q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor(req)]);
    const active = (await q.query('SELECT count(*)::int AS n FROM student_study_rooms WHERE host_user_id=$1 AND NOT closed AND expires_at>now()', [actor(req)])).rows[0].n;
    if (active >= 3) fail(409, 'لديك ثلاث غرف نشطة بالفعل.');
    const row = (await q.query('INSERT INTO student_study_rooms(id,school_id,host_user_id,title,code_hash,capacity) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [createId(), school.school_id, actor(req), v.title, sha256(raw), v.capacity])).rows[0];
    await q.query('INSERT INTO student_study_members(room_id,user_id,nickname) VALUES($1,$2,$3)', [row.id, actor(req), v.nickname]);
    return studyRoomPayload(req, row, q);
  });
  res.status(201).json({ room: result, inviteCode: raw });
}));
studentStudyRouter.post('/student-study/rooms/join', route(async (req, res) => {
  const v = z.object({ code: z.string().trim().min(8).max(40), nickname }).parse(req.body);
  // Commit the rate counter outside the transactional join, including wrong-code failures.
  await studyLimit(req, 'join-room', 12);
  const result = await transaction(async q => {
    const schools = (await studyStudent(req, q)).map(m => m.school_id);
    const room = (await q.query('SELECT * FROM student_study_rooms WHERE code_hash=$1 AND NOT closed AND expires_at>now() AND school_id=ANY($2::text[]) FOR UPDATE', [sha256(v.code.replace(/[\s-]/g, '').toUpperCase()), schools])).rows[0];
    if (!room) fail(404, 'رمز الغرفة غير متاح في مدرستك أو انتهت صلاحيته.');
    const active = (await q.query(`SELECT count(*)::int AS n FROM student_study_members m WHERE room_id=$1 AND user_id<>$2 AND ${liveMember}`, [room.id, actor(req)])).rows[0].n;
    if (active >= room.capacity) fail(409, 'الغرفة مكتملة حاليًا.');
    if ((await q.query('SELECT 1 FROM student_study_members WHERE room_id=$1 AND user_id<>$2 AND lower(nickname)=lower($3) AND left_at IS NULL', [room.id, actor(req), v.nickname])).rowCount) fail(409, 'اختر اسمًا مستعارًا مختلفًا داخل الغرفة.');
    await q.query('INSERT INTO student_study_members(room_id,user_id,nickname) VALUES($1,$2,$3) ON CONFLICT(room_id,user_id) DO UPDATE SET nickname=$3,left_at=NULL,last_seen_at=now(),joined_at=now()', [room.id, actor(req), v.nickname]);
    return studyRoomPayload(req, room, q);
  });
  res.json(result);
}));
studentStudyRouter.get('/student-study/rooms/:id', route(async (req, res) => {
  res.json(await studyRoomPayload(req, await studyRoom(req, id.parse(req.params.id))));
}));
studentStudyRouter.post('/student-study/rooms/:id/heartbeat', route(async (req, res) => {
  await studyLimit(req, 'heartbeat', 180);
  const result = await transaction(async q => {
    const room = await studyRoom(req, id.parse(req.params.id), q, true);
    const count = (await q.query(`SELECT count(*)::int AS n FROM student_study_members m WHERE room_id=$1 AND user_id<>$2 AND ${liveMember}`, [room.id, actor(req)])).rows[0].n;
    if (count >= room.capacity) fail(409, 'الغرفة مكتملة. أعد الانضمام لاحقًا.');
    await q.query('UPDATE student_study_members SET last_seen_at=now() WHERE room_id=$1 AND user_id=$2', [room.id, actor(req)]);
    return studyRoomPayload(req, room, q);
  });
  res.json(result);
}));
studentStudyRouter.post('/student-study/rooms/:id/leave', route(async (req, res) => {
  const room = await studyRoom(req, id.parse(req.params.id));
  await pool.query('UPDATE student_study_members SET left_at=now() WHERE room_id=$1 AND user_id=$2', [room.id, actor(req)]);
  if (room.host_user_id === actor(req)) await pool.query('UPDATE student_study_rooms SET closed=true WHERE id=$1', [room.id]);
  res.json({ ok: true, closed: room.host_user_id === actor(req) });
}));
studentStudyRouter.post('/student-study/rooms/:id/focus', route(async (req, res) => {
  const v = z.object({ minutes: z.number().int().min(1).max(120) }).parse(req.body);
  await studyLimit(req, 'write', 240);
  const result = await transaction(async q => {
    const room = await studyRoom(req, id.parse(req.params.id), q, true);
    if (room.host_user_id !== actor(req)) fail(403, 'مضيف الغرفة فقط يمكنه بدء المؤقت المشترك.');
    if (room.focus_ends_at && new Date(room.focus_ends_at).getTime() > Date.now()) fail(409, 'هناك مؤقت مشترك نشط بالفعل.');
    const updated = (await q.query('UPDATE student_study_rooms SET focus_started_at=now(),focus_ends_at=now()+make_interval(mins=>$2),focus_minutes=$2 WHERE id=$1 RETURNING *', [room.id, v.minutes])).rows[0];
    return studyRoomPayload(req, updated, q);
  });
  res.json(result);
}));

const challengeAnswers = z.record(z.string().min(1).max(100), z.number().int().min(0).max(3));
function scoreChallenge(snapshot: AcademyQuestion[], answers: Record<string, number>) {
  return snapshot.filter(q => answers[q.id] === q.answer).length;
}
async function challengePayload(req: Parameters<typeof actor>[0], room: any, q: Parameters<typeof studyRoom>[2] = pool) {
  const challenge = (await q.query('SELECT *,deadline_at<=clock_timestamp() AS expired FROM student_room_challenges WHERE room_id=$1 ORDER BY started_at DESC LIMIT 1', [room.id])).rows[0];
  if (!challenge) return null;
  const entries = (await q.query('SELECT * FROM student_room_challenge_entries WHERE challenge_id=$1 ORDER BY nickname FOR UPDATE', [challenge.id])).rows;
  const own = entries.find(e => e.user_id === actor(req));
  const snapshot = challenge.snapshot as AcademyQuestion[];
  const revealed = !!challenge.expired || entries.every(e => e.submitted_at);
  if (revealed) {
    // Deadlines are graded by the server on read; no client-provided score is accepted.
    for (const entry of entries) if (entry.score === null) {
      entry.score = scoreChallenge(snapshot, entry.answers);
      entry.submitted_at ||= challenge.deadline_at;
      await q.query('UPDATE student_room_challenge_entries SET score=$3,submitted_at=coalesce(submitted_at,$4) WHERE challenge_id=$1 AND user_id=$2', [challenge.id, entry.user_id, entry.score, challenge.deadline_at]);
    }
  }
  return { id: challenge.id, trackId: challenge.track_id, trackTitle: academyTracks.find(t => t.id === challenge.track_id)?.title || challenge.track_id,
    startedAt: challenge.started_at, deadlineAt: challenge.deadline_at, serverNow: new Date().toISOString(), revealed,
    participating: !!own, submitted: !!own?.submitted_at, answers: own?.answers || {},
    questions: snapshot.map(item => ({ id: item.id, text: item.text, options: item.options, ...(item.passage ? { passage: item.passage } : {}), ...(item.audioScript ? { audioScript:item.audioScript } : {}),
      ...(revealed ? { answer: item.answer, explanation: item.explanation } : {}) })),
    standings: entries.map(e => ({ nickname: e.nickname, isYou: e.user_id === actor(req), submitted: !!e.submitted_at,
      ...(revealed ? { correct: e.score, total: snapshot.length } : {}) })).sort((a, b) => revealed ? Number(b.correct) - Number(a.correct) : 0) };
}
studentStudyRouter.post('/student-study/rooms/:id/challenge', route(async (req, res) => {
  const v = z.object({ trackId: z.string().min(1).max(80), count: z.number().int().min(3).max(10).default(5), durationSec: z.number().int().min(60).max(1800).default(300) }).parse(req.body);
  await studyLimit(req, 'challenge', 20);
  const result = await transaction(async q => {
    const room = await studyRoom(req, id.parse(req.params.id), q, true);
    if (room.host_user_id !== actor(req)) fail(403, 'مضيف الغرفة فقط يمكنه بدء التحدي.');
    if ((await q.query('SELECT 1 FROM student_room_challenges WHERE room_id=$1 AND deadline_at>clock_timestamp() AND EXISTS(SELECT 1 FROM student_room_challenge_entries e WHERE e.challenge_id=student_room_challenges.id AND e.submitted_at IS NULL)', [room.id])).rowCount) fail(409, 'أكمل التحدي الحالي أولًا.');
    const source = trackQuestions(v.trackId);
    if (source.length < v.count) fail(400, 'لا تتوفر أسئلة كافية لهذا المسار.');
    // Cryptographic Fisher-Yates selection; each participant receives the same pinned set.
    const selected = [...source];
    for (let n = selected.length - 1; n > 0; n--) { const other = randomBytes(4).readUInt32BE() % (n + 1); [selected[n], selected[other]] = [selected[other], selected[n]]; }
    const cid = createId();
    await q.query('UPDATE student_study_members SET last_seen_at=now() WHERE room_id=$1 AND user_id=$2', [room.id, actor(req)]);
    await q.query('INSERT INTO student_room_challenges(id,room_id,track_id,snapshot,deadline_at,created_by) VALUES($1,$2,$3,$4::jsonb,now()+make_interval(secs=>$5),$6)', [cid, room.id, v.trackId, JSON.stringify(selected.slice(0, v.count)), v.durationSec, actor(req)]);
    await q.query(`INSERT INTO student_room_challenge_entries(challenge_id,user_id,nickname) SELECT $1,m.user_id,m.nickname FROM student_study_members m WHERE room_id=$2 AND ${liveMember}`, [cid, room.id]);
    return challengePayload(req, room, q);
  });
  res.status(201).json(result);
}));
studentStudyRouter.get('/student-study/rooms/:id/challenge', route(async (req, res) => {
  const result = await transaction(async q => challengePayload(req, await studyRoom(req, id.parse(req.params.id), q, true), q));
  res.json(result);
}));
studentStudyRouter.put('/student-study/rooms/:id/challenge/answers', route(async (req, res) => {
  const v = z.object({ challengeId: id, answers: challengeAnswers }).parse(req.body);
  if (Object.keys(v.answers).length > 10) fail(400, 'عدد الإجابات غير صالح.');
  await studyLimit(req, 'challenge-answers', 240);
  await transaction(async q => {
    const room = await studyRoom(req, id.parse(req.params.id), q, true);
    const c = (await q.query('SELECT *,deadline_at>clock_timestamp() AS open FROM student_room_challenges WHERE room_id=$1 ORDER BY started_at DESC LIMIT 1', [room.id])).rows[0];
    if (!c) fail();
    if (c.id !== v.challengeId) fail(409, 'تغير التحدي. حدّث الغرفة قبل إرسال الإجابات.');
    const entry = (await q.query('SELECT * FROM student_room_challenge_entries WHERE challenge_id=$1 AND user_id=$2 FOR UPDATE', [c.id, actor(req)])).rows[0];
    if (!entry) fail(403, 'انضم إلى الغرفة قبل بدء التحدي التالي للمشاركة.');
    if (!c.open || entry.submitted_at) fail(409, 'تم إغلاق الإجابات لهذا التحدي.');
    if (Object.keys(v.answers).some(key => !c.snapshot.some((item: AcademyQuestion) => item.id === key))) fail(400, 'السؤال غير موجود في التحدي.');
    await q.query('UPDATE student_room_challenge_entries SET answers=$3::jsonb WHERE challenge_id=$1 AND user_id=$2', [c.id, actor(req), JSON.stringify(v.answers)]);
  });
  res.json({ ok: true });
}));
studentStudyRouter.post('/student-study/rooms/:id/challenge/submit', route(async (req, res) => {
  const v = z.object({ challengeId: id }).parse(req.body);
  await studyLimit(req, 'challenge-answers', 240);
  const result = await transaction(async q => {
    const room = await studyRoom(req, id.parse(req.params.id), q, true);
    const c = (await q.query('SELECT *,deadline_at>clock_timestamp() AS open FROM student_room_challenges WHERE room_id=$1 ORDER BY started_at DESC LIMIT 1', [room.id])).rows[0];
    if (!c) fail();
    if (c.id !== v.challengeId) fail(409, 'تغير التحدي. حدّث الغرفة قبل إرسال الإجابات.');
    const entry = (await q.query('SELECT * FROM student_room_challenge_entries WHERE challenge_id=$1 AND user_id=$2 FOR UPDATE', [c.id, actor(req)])).rows[0];
    if (!entry) fail(403, 'أنت غير مسجل في هذا التحدي.');
    if (!entry.submitted_at) await q.query('UPDATE student_room_challenge_entries SET submitted_at=LEAST(clock_timestamp(),$4),score=$3 WHERE challenge_id=$1 AND user_id=$2', [c.id, actor(req), scoreChallenge(c.snapshot, entry.answers), c.deadline_at]);
    return challengePayload(req, room, q);
  });
  res.json(result);
}));
