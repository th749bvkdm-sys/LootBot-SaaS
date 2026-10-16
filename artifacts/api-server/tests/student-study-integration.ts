import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import app from '../src/app';
import { db, pool, usersTable, sessionsTable } from '@workspace/db';
import { sha256 } from '../src/lib/security';
import { trackQuestions } from '../src/content/student-academy';

test('private student study tools: authenticated HTTP, persistence, server timing and scoped challenge grading', async t => {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, '127.0.0.1');
  assert.match(process.env.TEACHER_TEST_SCHEMA || '', /^teacher_qa_[a-f0-9]{32}$/);
  const [teacher, merchant, admin, alice, bob, carol, otherSchool, unjoined] = Array.from({ length: 8 }, () => randomUUID());
  const auth = new Map<string, { cookie: string; csrf: string }>();
  for (const uid of [teacher, merchant, admin, alice, bob, carol, otherSchool, unjoined]) {
    const token = randomUUID() + randomUUID(), csrf = randomUUID() + randomUUID();
    await db.insert(usersTable).values({ id: uid, name: 'Private QA fixture', email: uid + '@example.invalid', passwordHash: 'unused',
      role: uid === admin ? 'SUPERADMIN' : 'OWNER', accountType: uid === teacher ? 'teacher' : uid === merchant || uid === admin ? 'merchant' : 'student' });
    await db.insert(sessionsTable).values({ id: randomUUID(), userId: uid, tokenHash: sha256(token), csrfHash: sha256(csrf), expiresAt: new Date(Date.now() + 3600000) });
    auth.set(uid, { cookie: `lootbot_session=${token}; lootbot_csrf=${csrf}`, csrf });
  }
  const school = randomUUID(), schoolB = randomUUID(), classroom = randomUUID(), classB = randomUUID();
  for (const [sid, cid] of [[school, classroom], [schoolB, classB]]) {
    await pool.query('INSERT INTO education_schools(id,name) VALUES($1,$2)', [sid, 'Private QA school']);
    await pool.query('INSERT INTO teacher_classes(id,owner_id,name) VALUES($1,$2,$3)', [cid, teacher, 'Private QA class']);
    await pool.query('INSERT INTO education_school_classes(class_id,school_id) VALUES($1,$2)', [cid, sid]);
  }
  for (const uid of [alice, bob, carol, otherSchool]) {
    const roster = randomUUID(), foreign = uid === otherSchool;
    await pool.query('INSERT INTO teacher_students(id,owner_id,class_id,name) VALUES($1,$2,$3,$4)', [roster, teacher, foreign ? classB : classroom, 'Do not expose this real name']);
    await pool.query("INSERT INTO education_enrollments(id,user_id,school_id,class_id,roster_id,status) VALUES($1,$2,$3,$4,$5,'active')", [randomUUID(), uid, foreign ? schoolB : school, foreign ? classB : classroom, roster]);
  }
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/student-study`;
  async function request(path: string, uid: string | null = alice, body?: unknown, method = body === undefined ? 'GET' : 'POST', csrf = true) {
    const a = uid ? auth.get(uid) : null;
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(a ? { cookie: a.cookie, ...(csrf ? { 'x-csrf-token': a.csrf } : {}) } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    return { status: r.status, data: await r.json(), cache: r.headers.get('cache-control') };
  }
  let room = '', invite = '', focus = '';
  try {
    await t.test('students only, real enrollment, feature policy, CSRF and no-store', async () => {
      assert.equal((await request('/overview', null)).status, 401);
      for (const uid of [teacher, merchant, admin, unjoined]) assert.equal((await request('/overview', uid)).status, 403);
      const overview = await request('/overview'); assert.equal(overview.status, 200); assert.equal(overview.cache, 'no-store');
      assert.equal(overview.data.stats.totalFocusSessions, 0); assert.ok(overview.data.badges.every((b: any) => !b.earned));
      assert.equal((await request('/goal', alice, { dailyGoalMinutes: 30 }, 'PUT', false)).status, 403);
      await pool.query("INSERT INTO education_settings(scope,data) VALUES($1,'{\"studentRoom\":false}'::jsonb)", [school]);
      assert.equal((await request('/overview')).status, 403);
      await pool.query('DELETE FROM education_settings WHERE scope=$1', [school]);
    });
    await t.test('persisted private planner, validation, idempotent completion and removal', async () => {
      assert.equal((await request('/goal', alice, { dailyGoalMinutes: 40 }, 'PUT')).status, 200);
      assert.equal((await request('/goal', alice, { dailyGoalMinutes: 900 }, 'PUT')).status, 400);
      assert.equal((await request('/tasks', alice, { title: 'bad date', dueDate: '2026-02-31' })).status, 400);
      const created = await request('/tasks', alice, { title: 'مراجعة التناسب', dueDate: '2026-11-01' }); assert.equal(created.status, 201); assert.equal(created.data.dueDate, "2026-11-01");
      const tid = created.data.id;
      assert.equal((await request('/tasks/' + tid, bob, { done: true }, 'PATCH')).status, 404);
      assert.equal((await request('/tasks', bob)).data.length, 0);
      const done = await request('/tasks/' + tid, alice, { done: true }, 'PATCH'); assert.equal(done.data.done, true);
      assert.equal((await request('/tasks/' + tid, alice, { done: true }, 'PATCH')).data.completedAt, done.data.completedAt);
      assert.equal((await request('/overview')).data.dailyGoalMinutes, 40);
      assert.equal((await request('/tasks/' + tid, alice, undefined, 'DELETE')).status, 200);
      assert.equal((await request('/tasks/' + tid, alice, undefined, 'DELETE')).status, 200);
      assert.equal((await request('/tasks')).data.length, 0);
      assert.equal((await pool.query('SELECT removed FROM student_study_tasks WHERE id=$1', [tid])).rows[0].removed, true);
    });
    await t.test('focus uses server elapsed time, single active session and exactly-once credit', async () => {
      const requestId = randomUUID();
      const created = await request('/focus/start', alice, { minutes: 1, requestId }); assert.equal(created.status, 200); focus = created.data.id;
      assert.equal((await request('/focus/start', alice, { minutes: 1, requestId })).data.id, focus);
      assert.equal((await request('/focus/start', alice, { minutes: 5, requestId })).status, 409);
      assert.equal((await request('/focus/start', alice, { minutes: 1, requestId: randomUUID() })).status, 409);
      assert.equal((await request('/focus/' + focus + '/complete', bob, {})).status, 404);
      assert.equal((await request('/focus/' + focus + '/complete', alice, { minutes: 100, elapsed: 900 })).status, 409);
      await pool.query("UPDATE student_focus_sessions SET started_at=now()-interval '61 seconds',ends_at=now()-interval '1 second' WHERE id=$1", [focus]);
      const completed = await request('/focus/' + focus + '/complete', alice, {}); assert.equal(completed.status, 200);
      assert.equal(completed.data.stats.focusMinutesToday, 1); assert.equal(completed.data.stats.streakDays, 1);
      assert.ok(completed.data.badges.find((b: any) => b.id === 'first-focus').earned);
      const duplicate = await request('/focus/' + focus + '/complete', alice, {}); assert.equal(duplicate.data.stats.totalFocusSessions, 1);
      assert.equal(duplicate.data.focus.completedAt, completed.data.focus.completedAt);
      const cancelled = await request('/focus/start', alice, { minutes: 1, requestId: randomUUID() });
      assert.equal((await request('/focus/' + cancelled.data.id + '/cancel', alice, {})).status, 200);
      assert.equal((await request('/focus/' + cancelled.data.id + '/complete', alice, {})).status, 409);
    });
    await t.test('invite rooms hash codes, constrain schools/capacity and expose no identities or contacts', async () => {
      assert.equal((await request('/rooms', alice, { title: 'فريق', nickname: 'test@gmail.com' })).status, 400);
      const created = await request('/rooms', alice, { title: 'فريق المذاكرة', nickname: 'المثابر', capacity: 2 }); assert.equal(created.status, 201);
      room = created.data.room.id; invite = created.data.inviteCode;
      assert.match(invite, /^[A-F0-9]{16}$/);
      assert.notEqual((await pool.query('SELECT code_hash FROM student_study_rooms WHERE id=$1', [room])).rows[0].code_hash, invite);
      assert.equal((await request('/rooms/' + room, otherSchool)).status, 404);
      assert.equal((await request('/rooms/join', otherSchool, { code: invite, nickname: 'غريب' })).status, 404);
      assert.equal((await request('/rooms/join', bob, { code: invite.toLowerCase(), nickname: 'المجتهد' })).status, 200);
      assert.equal((await request('/rooms/join', carol, { code: invite, nickname: 'الطموح' })).status, 409);
      const detail = (await request('/rooms/' + room)).data;
      assert.equal(detail.members.length, 2); assert.ok(detail.members.some((m: any) => m.isYou));
      const serialized = JSON.stringify(detail);
      for (const forbidden of [alice, bob, 'example.invalid', 'Do not expose', invite, 'code_hash']) assert.ok(!serialized.includes(forbidden));
      assert.equal((await request('/rooms/' + room + '/focus', bob, { minutes: 2 })).status, 403);
      const clock = await request('/rooms/' + room + '/focus', alice, { minutes: 2 }); assert.equal(clock.status, 200);
      assert.equal(new Date(clock.data.focus.endsAt).getTime() - new Date(clock.data.focus.startedAt).getTime(), 120000);
      assert.equal((await request('/rooms/' + room + '/focus', alice, { minutes: 2 })).status, 409);
      assert.equal((await request('/rooms/' + room + '/heartbeat', bob, {})).status, 200);
    });
    await t.test('identical pinned room challenge, hidden answers, ownership, deadline and server grading', async () => {
      assert.equal((await request('/rooms/' + room + '/challenge', bob, { trackId: 'verbal' })).status, 403);
      const started = await request('/rooms/' + room + '/challenge', alice, { trackId: 'verbal', count: 3, durationSec: 60 });
      assert.equal(started.status, 201); assert.equal(started.data.questions.length, 3);
      assert.ok(started.data.questions.every((q: any) => q.answer === undefined && q.explanation === undefined));
      const bobView = await request('/rooms/' + room + '/challenge', bob);
      assert.deepEqual(bobView.data.questions, started.data.questions);
      assert.equal((await request('/rooms/' + room + '/challenge/answers', alice, { challengeId: started.data.id, answers: { forged: 0 } }, 'PUT')).status, 400);
      const source = trackQuestions('verbal');
      const correct = Object.fromEntries(started.data.questions.map((q: any) => [q.id, source.find(s => s.id === q.id)!.answer]));
      assert.equal((await request('/rooms/' + room + '/challenge/answers', alice, { challengeId: started.data.id, answers: correct, score: 999 }, 'PUT')).status, 200);
      const submitted = await request('/rooms/' + room + '/challenge/submit', alice, { challengeId: started.data.id, score: 999 });
      assert.equal(submitted.status, 200); assert.equal(submitted.data.revealed, false);
      assert.ok(submitted.data.standings.every((s: any) => s.correct === undefined));
      assert.equal((await request('/rooms/' + room + '/challenge/answers', alice, { challengeId: started.data.id, answers: {} }, 'PUT')).status, 409);
      assert.equal((await request('/rooms/' + room + '/challenge/submit', alice, { challengeId: started.data.id })).status, 200);
      await pool.query("UPDATE student_room_challenges SET deadline_at=now()-interval '1 second' WHERE id=$1", [started.data.id]);
      assert.equal((await request('/rooms/' + room + '/challenge/answers', bob, { challengeId: started.data.id, answers: correct }, 'PUT')).status, 409);
      const finished = await request('/rooms/' + room + '/challenge', alice);
      assert.equal(finished.data.revealed, true); assert.ok(finished.data.questions.every((q: any) => typeof q.answer === 'number'));
      assert.equal(finished.data.submitted, true); assert.ok(finished.data.standings.every((s:any)=>s.submitted));
      assert.equal(finished.data.standings.find((s: any) => s.isYou).correct, 3);
      assert.equal(finished.data.standings.find((s: any) => !s.isYou).correct, 0);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM student_room_challenge_entries WHERE challenge_id=$1', [started.data.id])).rows[0].n, 2);
      const successor = await request('/rooms/' + room + '/challenge', alice, { trackId: 'step', count: 3, durationSec: 60 });
      assert.equal(successor.status, 201);
      assert.equal((await request('/rooms/' + room + '/challenge/answers', alice, { challengeId: started.data.id, answers: {} }, 'PUT')).status, 409);
      assert.equal((await request('/rooms/' + room + '/challenge/submit', alice, { challengeId: started.data.id })).status, 409);
      assert.equal((await request('/rooms/' + room + '/challenge/answers', alice, { answers: {} }, 'PUT')).status, 400);
      assert.equal((await request('/rooms/' + room + '/challenge/submit', alice, {})).status, 400);
      const unchanged = (await request('/rooms/' + room + '/challenge', alice)).data;
      assert.equal(unchanged.id, successor.data.id); assert.equal(unchanged.submitted, false); assert.deepEqual(unchanged.answers, {});
      // A STEP listening item always carries its original announcement, including shared challenges.
      const listening = trackQuestions('step').filter(q => q.audioScript).slice(0, 3);
      await pool.query('UPDATE student_room_challenges SET snapshot=$2::jsonb WHERE id=$1', [successor.data.id, JSON.stringify(listening)]);
      const listeningView = (await request('/rooms/' + room + '/challenge', alice)).data;
      assert.ok(listeningView.questions.every((q: any) => typeof q.audioScript === 'string' && q.audioScript.length > 50));
      assert.ok(listeningView.questions.every((q: any) => q.answer === undefined));
    });
    await t.test('presence expiration, leave, host closure and revoked enrollment', async () => {
      await pool.query("UPDATE student_study_members SET last_seen_at=now()-interval '2 minutes' WHERE room_id=$1 AND user_id=$2", [room, bob]);
      assert.equal((await request('/rooms/' + room)).data.memberCount, 1);
      assert.equal((await request('/rooms/join', carol, { code: invite, nickname: 'الطموح' })).status, 200);
      assert.equal((await request('/rooms/' + room + '/heartbeat', bob, {})).status, 409);
      assert.equal((await request('/rooms/' + room + '/leave', carol, {})).status, 200);
      assert.equal((await request('/rooms/' + room, carol)).status, 404);
      await pool.query("UPDATE education_enrollments SET status='revoked' WHERE user_id=$1", [bob]);
      assert.equal((await request('/rooms/' + room + '/heartbeat', bob, {})).status, 403);
      assert.equal((await request('/rooms/' + room + '/leave', alice, {})).data.closed, true);
      assert.equal((await request('/rooms/join', carol, { code: invite, nickname: 'الطموح' })).status, 404);
      assert.equal((await request('/rooms')).data.length, 0);
    });
    await t.test('failed invite guesses are rate limited and cannot bypass persisted limits', async () => {
      for (let n = 0; n < 12; n++) assert.equal((await request('/rooms/join', carol, { code: 'NOTAREALINVITE', nickname: 'الطموح' })).status, n < 9 ? 404 : 429);
      assert.equal((await request('/rooms/join', carol, { code: invite, nickname: 'الطموح' })).status, 429);
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); }
});
