import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import app from '../src/app';
import { db, pool, usersTable, sessionsTable } from '@workspace/db';
import { sha256 } from '../src/lib/security';
import { academyTracks, academyLessons, trackQuestions } from '../src/content/student-academy';

test('original academy: real HTTP, privacy, versioned answers and server-side grading', async t => {
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
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/student-academy`;
  async function request(path: string, uid: string | null = alice, body?: unknown, method = body === undefined ? 'GET' : 'POST', csrf = true) {
    const a = uid ? auth.get(uid) : null;
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(a ? { cookie: a.cookie, ...(csrf ? { 'x-csrf-token': a.csrf } : {}) } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    return { status: r.status, data: await r.json(), cache: r.headers.get('cache-control') };
  }

  let attempt='', timed='', incorrect='';
  try {
    await t.test('original content has five tracks, 25 lessons and 100 well-formed unique questions',async()=>{
      assert.equal(academyTracks.length,5);assert.equal(academyLessons.length,25);
      const questions=academyTracks.flatMap(track=>trackQuestions(track.id));assert.equal(questions.length,100);assert.equal(new Set(questions.map(q=>q.id)).size,100);
      for(const q of questions){assert.equal(q.options.length,4);assert.equal(new Set(q.options).size,4);assert.ok(q.answer>=0&&q.answer<4);assert.ok(q.explanation.length>10);assert.ok(q.text.length>10);}
    });
    await t.test('authentication, real student enrollment, feature switch, CSRF, offline privacy',async()=>{
      assert.equal((await request('/catalog',null)).status,401);
      for(const uid of [teacher,merchant,admin,unjoined])assert.equal((await request('/catalog',uid)).status,403);
      const c=await request('/catalog');assert.equal(c.status,200);assert.equal(c.cache,'no-store');assert.equal(c.data.tracks.length,5);
      assert.ok(c.data.tracks.every((t:any)=>t.lessons.every((l:any)=>l.questions===undefined)));assert.equal(c.data.stats.attempts,0);
      const offline=await request('/catalog/offline');assert.equal(offline.status,200);assert.equal(offline.data.tracks.length,5);assert.equal(offline.data.stats,undefined);assert.equal(offline.data.tracks[0].lessons[0].questions,undefined);
      assert.equal((await request('/attempts',alice,{trackId:academyTracks[0].id},'POST',false)).status,403);
      await pool.query("INSERT INTO education_settings(scope,data) VALUES($1,'{\"studentRoom\":false}'::jsonb)",[school]);assert.equal((await request('/catalog')).status,403);await pool.query('DELETE FROM education_settings WHERE scope=$1',[school]);
    });
    await t.test('attempts expose no answers, clamp lesson count and reject cross-account or invalid selections',async()=>{
      const started=await request('/attempts',alice,{trackId:academyTracks[0].id,lessonId:academyLessons[0].id,count:40});assert.equal(started.status,201);attempt=started.data.attemptId;
      const a=await request('/attempts/'+attempt);assert.equal(a.data.questions.length,4);assert.equal(a.data.result,undefined);assert.ok(a.data.questions.every((q:any)=>q.answer===undefined&&q.explanation===undefined));
      assert.equal((await request('/attempts/'+attempt,bob)).status,404);
      assert.equal((await request('/attempts/'+attempt+'/answers',bob,{revision:0,answers:{}},'PUT')).status,404);
      assert.equal((await request('/attempts/'+attempt+'/answers',alice,{revision:0,answers:{unknown:0}},'PUT')).status,400);
      assert.equal((await request('/attempts',alice,{trackId:academyTracks[0].id,lessonId:academyLessons[7].id})).status,404);
      assert.equal((await request('/attempts',alice,{trackId:'missing'})).status,404);
      assert.equal((await request('/attempts',alice,{trackId:academyTracks[0].id,count:999})).status,400);
    });
    await t.test('answers persist with compare-and-swap; server grade, mistakes and idempotent finish',async()=>{
      const a=(await request('/attempts/'+attempt)).data;const keys=new Map(trackQuestions(academyTracks[0].id).map(q=>[q.id,q.answer]));
      const answers:Record<string,number>={};a.questions.forEach((q:any,i:number)=>{if(i<3)answers[q.id]=i===0?(keys.get(q.id)!+1)%4:keys.get(q.id)!});incorrect=a.questions[0].id;
      const saved=await request('/attempts/'+attempt+'/answers',alice,{revision:0,answers},'PUT');assert.equal(saved.status,200);assert.equal(saved.data.revision,1);
      assert.equal((await request('/attempts/'+attempt+'/answers',alice,{revision:0,answers:{}},'PUT')).status,409);
      assert.deepEqual((await request('/attempts/'+attempt)).data.answers,answers);
      const finished=await request('/attempts/'+attempt+'/finish',alice,{});assert.equal(finished.status,200);assert.equal(finished.data.result.correct,2);assert.equal(finished.data.result.wrong,1);assert.equal(finished.data.result.unanswered,1);assert.equal(finished.data.result.percent,50);
      assert.equal((await request('/attempts/'+attempt+'/answers',alice,{revision:2,answers:{}},'PUT')).status,409);
      const repeated=await request('/attempts/'+attempt+'/finish',alice,{});assert.deepEqual(repeated.data.result,finished.data.result);
      const mistakes=await request('/mistakes');assert.equal(mistakes.data.items.length,2);assert.ok(mistakes.data.items.every((r:any)=>r.wrongCount===1&&typeof r.correctIndex==='number'));assert.equal((await request('/mistakes',bob)).data.items.length,0);
      assert.equal((await request('/history',bob)).data.length,0);assert.equal((await request('/history')).data.length,1);
      const analytics=await request('/analytics');assert.equal(analytics.data.stats.correct,2);assert.equal(analytics.data.stats.attempts,1);assert.ok(analytics.data.recommendations.length);
    });
    await t.test('personal review and retry are owned; later correct answer resolves the automatic mistake',async()=>{
      assert.equal((await request('/mistakes/'+incorrect+'/review',bob,{mastered:true})).status,404);
      assert.equal((await request('/mistakes/'+incorrect+'/review',alice,{mastered:true})).status,200);
      assert.equal((await request('/mistakes/'+incorrect+'/review',alice,{mastered:false})).status,200);
      const started=await request('/attempts',alice,{trackId:academyTracks[0].id,mistakesOnly:true,count:10});assert.equal(started.status,201);const aid=started.data.attemptId;
      const a=(await request('/attempts/'+aid)).data;assert.equal(a.questions.length,2);const answers=Object.fromEntries(a.questions.map((q:any)=>[q.id,trackQuestions(academyTracks[0].id).find(r=>r.id===q.id)!.answer]));
      assert.equal((await request('/attempts/'+aid+'/answers',alice,{revision:0,answers},'PUT')).status,200);assert.equal((await request('/attempts/'+aid+'/finish',alice,{})).data.result.correct,2);
      assert.ok((await request('/mistakes')).data.items.every((r:any)=>r.mastered));assert.equal((await request('/attempts',alice,{trackId:academyTracks[0].id,mistakesOnly:true})).status,409);
    });
    await t.test('full lesson success unlocks progress and learner data remains private',async()=>{
      const started=await request('/attempts',alice,{trackId:academyTracks[1].id,lessonId:academyTracks[1].lessons[0].id});const aid=started.data.attemptId;
      const a=(await request('/attempts/'+aid)).data;const answers=Object.fromEntries(a.questions.map((q:any)=>[q.id,trackQuestions(academyTracks[1].id).find(r=>r.id===q.id)!.answer]));
      await request('/attempts/'+aid+'/answers',alice,{revision:0,answers},'PUT');assert.equal((await request('/attempts/'+aid+'/finish',alice,{})).data.result.percent,100);
      assert.equal((await request('/catalog')).data.stats.completedLessons,1);assert.equal((await request('/catalog',bob)).data.stats.completedLessons,0);
    });
    await t.test('lazy expiry follows event chronology and cannot undo a later correct or wrong answer',async()=>{
      const lesson=academyTracks[0].lessons[0], questions=trackQuestions(academyTracks[0].id).filter(q=>q.lessonId===lesson.id);
      const correctAnswers=Object.fromEntries(questions.map(q=>[q.id,q.answer]));
      const wrongAnswers=Object.fromEntries(questions.map(q=>[q.id,(q.answer+1)%4]));
      async function start(){const r=await request('/attempts',bob,{trackId:lesson.trackId,lessonId:lesson.id,mode:'timed',timeLimitSec:60});assert.equal(r.status,201);return r.data.attemptId as string;}
      async function save(aid:string,answers:Record<string,number>){assert.equal((await request('/attempts/'+aid+'/answers',bob,{revision:0,answers},'PUT')).status,200);}
      async function expire(aid:string){await pool.query("UPDATE student_academy_attempts SET started_at=now()-interval '2 minutes',deadline_at=now()-interval '1 minute' WHERE id=$1",[aid]);}
      const oldWrong=await start(), newerCorrect=await start();await save(oldWrong,wrongAnswers);await save(newerCorrect,correctAnswers);await expire(oldWrong);
      const passed=await request('/attempts/'+newerCorrect+'/finish',bob,{});assert.equal(passed.status,200);assert.equal(passed.data.result.correct,4);
      assert.equal((await request('/attempts/'+oldWrong,bob)).data.status,'expired');
      const firstReview=(await request('/mistakes',bob)).data.items;
      assert.equal(firstReview.length,4);assert.ok(firstReview.every((q:any)=>q.mastered&&q.lastAttemptAt===passed.data.finishedAt));
      // Reverse outcome: a delayed older correct grade must not erase a newer mistake.
      const oldCorrect=await start(), newerWrong=await start();await save(oldCorrect,correctAnswers);await save(newerWrong,wrongAnswers);await expire(oldCorrect);
      const failed=await request('/attempts/'+newerWrong+'/finish',bob,{});assert.equal(failed.status,200);assert.equal(failed.data.result.correct,0);
      assert.equal((await request('/attempts/'+oldCorrect,bob)).data.status,'expired');
      const lastReview=(await request('/mistakes',bob)).data.items;
      assert.equal(lastReview.length,4);assert.ok(lastReview.every((q:any)=>!q.mastered&&q.lastAttemptAt===failed.data.finishedAt&&q.wrongCount===2));
    });
    await t.test('server time expires simulation and prevents late score rewriting',async()=>{
      const started=await request('/attempts',alice,{trackId:academyTracks[2].id,mode:'simulation',count:5,timeLimitSec:60});assert.equal(started.status,201);timed=started.data.attemptId;
      await pool.query("UPDATE student_academy_attempts SET started_at=now()-interval '2 minutes',deadline_at=now()-interval '1 second' WHERE id=$1",[timed]);
      assert.equal((await request('/attempts/'+timed+'/answers',alice,{revision:0,answers:{}},'PUT')).status,409);
      const expired=await request('/attempts/'+timed);assert.equal(expired.data.status,'expired');assert.equal(expired.data.result.unanswered,5);assert.ok(expired.data.result.elapsedSec>0);
      assert.equal((await request('/attempts/'+timed+'/finish',alice,{correct:5})).status,400);
      await pool.query("UPDATE education_enrollments SET status='revoked' WHERE user_id=$1",[alice]);assert.equal((await request('/attempts/'+timed)).status,403);
    });
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();}
});
