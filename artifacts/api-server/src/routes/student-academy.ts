import { Router, type Request, type RequestHandler } from 'express';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { pool, type PoolClient } from '@workspace/db';
import { requireAuth, requireCsrf } from '../lib/auth-middleware';
import { actor, enabledMemberships, EducationError, fail, transaction } from '../lib/education';
import { createId } from '../lib/security';
import { academyLessons, academyNotice, academyTracks, academyVersion, trackQuestions, type AcademyQuestion } from '../content/student-academy';

export const studentAcademyRouter = Router();
const identifier = z.string().min(1).max(120);
const uuid = z.string().uuid();
const route = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await handler(req, res, next); }
  catch (error) {
    if (error instanceof EducationError) res.status(error.status).json({ error: error.message });
    else if (error instanceof z.ZodError) res.status(400).json({ error: 'راجع الحقول والقيم المطلوبة.' });
    else next(error);
  }
};
studentAcademyRouter.use('/student-academy', requireAuth, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'GET') requireCsrf(req, res, next); else next();
});
const access = (req: Request, q = pool as Pick<PoolClient, 'query'>) => enabledMemberships(req, 'studentRoom', q);

type Attempt = {
  id: string; user_id: string; track_id: string; lesson_id: string | null; mode: string; title: string;
  status: 'active' | 'submitted' | 'expired'; snapshot: AcademyQuestion[]; answers: Record<string, number>;
  result: AcademyResult | null; revision: number; started_at: Date | string; deadline_at: Date | string | null; finished_at: Date | string | null;
};
type ResultItem = { questionId: string; lessonId: string; skill: string; text: string; options: string[]; selected: number | null; correctIndex: number; isCorrect: boolean; explanation: string; passage?: string; audioScript?: string };
type AcademyResult = { total: number; correct: number; wrong: number; unanswered: number; percent: number; elapsedSec: number; items: ResultItem[]; skills: { skill: string; answered: number; correct: number; accuracy: number }[] };
const iso = (date: string | Date | null) => date ? new Date(date).toISOString() : null;
function publicQuestion(question: AcademyQuestion) {
  return { id: question.id, lessonId: question.lessonId, trackId: question.trackId, skill: question.skill, text: question.text, options: question.options,
    ...(question.passage ? { passage: question.passage } : {}), ...(question.audioScript ? { audioScript: question.audioScript } : {}) };
}
function publicAttempt(attempt: Attempt) {
  const end = attempt.finished_at ? new Date(attempt.finished_at).getTime() : Math.min(Date.now(), attempt.deadline_at ? new Date(attempt.deadline_at).getTime() : Date.now());
  return { id: attempt.id, trackId: attempt.track_id, lessonId: attempt.lesson_id, mode: attempt.mode, title: attempt.title, status: attempt.status,
    startedAt: iso(attempt.started_at), deadlineAt: iso(attempt.deadline_at), finishedAt: iso(attempt.finished_at), serverTime: new Date().toISOString(),
    elapsedSec: Math.max(0, Math.floor((end - new Date(attempt.started_at).getTime()) / 1000)), revision: attempt.revision,
    questions: attempt.snapshot.map(publicQuestion), answers: attempt.answers, ...(attempt.result ? { result: attempt.result } : {}), notice: academyNotice };
}
function resultFor(attempt: Attempt, end: Date): AcademyResult {
  const items = attempt.snapshot.map(question => {
    const selected = attempt.answers[question.id] ?? null;
    return { questionId: question.id, lessonId: question.lessonId, skill: question.skill, text: question.text, options: question.options, selected,
      correctIndex: question.answer, isCorrect: selected === question.answer, explanation: question.explanation,
      ...(question.passage ? { passage: question.passage } : {}), ...(question.audioScript ? { audioScript: question.audioScript } : {}) };
  });
  const correct = items.filter(item => item.isCorrect).length, unanswered = items.filter(item => item.selected === null).length;
  const skills = [...new Set(items.map(item => item.skill))].map(skill => {
    const same = items.filter(item => item.skill === skill), n = same.filter(item => item.isCorrect).length;
    return { skill, answered: same.length, correct: n, accuracy: Math.round(n / same.length * 100) };
  });
  return { total: items.length, correct, wrong: items.length - correct - unanswered, unanswered, percent: Math.round(correct / items.length * 100),
    elapsedSec: Math.max(0, Math.floor((end.getTime() - new Date(attempt.started_at).getTime()) / 1000)), items, skills };
}
async function closeAttempt(q: PoolClient, attempt: Attempt, expired: boolean) {
  if (attempt.status !== 'active') return;
  const end = expired && attempt.deadline_at ? new Date(attempt.deadline_at) : new Date(), result = resultFor(attempt, end);
  attempt.result = result; attempt.status = expired ? 'expired' : 'submitted'; attempt.finished_at = end; attempt.revision += 1;
  await q.query('UPDATE student_academy_attempts SET status=$2,result=$3::jsonb,finished_at=$4,revision=$5 WHERE id=$1', [attempt.id, attempt.status, JSON.stringify(result), end, attempt.revision]);
  // A deadline may be graded lazily after another attempt already finished.
  // Resolve mastery by event time, not the order in which an old tab was opened.
  const latest = (await q.query(`SELECT DISTINCT ON (entry.item->>'questionId')
      entry.item->>'questionId' AS question_id,(entry.item->>'isCorrect')::boolean AS correct,a.finished_at
    FROM student_academy_attempts a CROSS JOIN LATERAL jsonb_array_elements(a.result->'items') AS entry(item)
    WHERE a.user_id=$1 AND a.status<>'active' AND a.finished_at>=$3
      AND entry.item->>'questionId'=ANY($2::text[])
    ORDER BY entry.item->>'questionId',a.finished_at DESC,a.id DESC`,
    [attempt.user_id, result.items.map(item => item.questionId), end])).rows;
  const latestByQuestion = new Map(latest.map(row => [row.question_id, row]));
  for (const item of result.items) {
    const last = latestByQuestion.get(item.questionId)!;
    const question = attempt.snapshot.find(row => row.id === item.questionId)!;
    if (!item.isCorrect) {
      await q.query(`INSERT INTO student_academy_mistakes(user_id,question_id,track_id,lesson_id,snapshot,last_attempt_at,mastered)
        VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) ON CONFLICT(user_id,question_id) DO UPDATE SET
        wrong_count=student_academy_mistakes.wrong_count+1,
        snapshot=CASE WHEN student_academy_mistakes.last_attempt_at<=EXCLUDED.last_attempt_at THEN EXCLUDED.snapshot ELSE student_academy_mistakes.snapshot END,
        last_attempt_at=greatest(student_academy_mistakes.last_attempt_at,EXCLUDED.last_attempt_at),
        mastered=CASE WHEN student_academy_mistakes.last_attempt_at<=EXCLUDED.last_attempt_at THEN EXCLUDED.mastered ELSE student_academy_mistakes.mastered END`,
        [attempt.user_id, question.id, question.trackId, question.lessonId, JSON.stringify(question), last.finished_at, last.correct]);
    } else await q.query('UPDATE student_academy_mistakes SET mastered=$4,last_attempt_at=$3 WHERE user_id=$1 AND question_id=$2 AND last_attempt_at<=$3', [attempt.user_id, question.id, last.finished_at, last.correct]);
  }
  for (const lessonId of new Set(result.items.map(item => item.lessonId))) {
    const items = result.items.filter(item => item.lessonId === lessonId), lesson = academyLessons.find(row => row.id === lessonId);
    const score = Math.round(items.filter(item => item.isCorrect).length / items.length * 100);
    // Reading alone or a single lucky answer never marks the whole lesson complete.
    const complete = !!lesson && items.length >= lesson.questions.length && score >= 75;
    await q.query(`INSERT INTO student_academy_progress(user_id,lesson_id,attempts,best_score,completed_at) VALUES($1,$2,1,$3,$4)
      ON CONFLICT(user_id,lesson_id) DO UPDATE SET attempts=student_academy_progress.attempts+1,
      best_score=greatest(student_academy_progress.best_score,EXCLUDED.best_score),
      completed_at=coalesce(student_academy_progress.completed_at,EXCLUDED.completed_at),updated_at=now()`, [attempt.user_id, lessonId, score, complete ? end : null]);
  }
}
async function withAttempt(req: Request, action: (q: PoolClient, attempt: Attempt, justExpired: boolean) => Promise<unknown>) {
  return transaction(async q => {
    await access(req, q);
    // All attempt closures use the same user -> attempt lock order as creation.
    // This serializes shared mistake/progress updates even for different open attempts.
    await q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor(req)]);
    const attempt = (await q.query('SELECT * FROM student_academy_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE', [uuid.parse(req.params.id), actor(req)])).rows[0] as Attempt | undefined;
    if (!attempt) throw new EducationError(404, "المحاولة غير متاحة.");
    const justExpired = attempt.status === 'active' && !!attempt.deadline_at && new Date(attempt.deadline_at).getTime() <= Date.now();
    if (justExpired) await closeAttempt(q, attempt, true);
    return action(q, attempt, justExpired);
  });
}
async function analytics(userId: string) {
  const progress = (await pool.query('SELECT * FROM student_academy_progress WHERE user_id=$1', [userId])).rows;
  const results = (await pool.query("SELECT result FROM student_academy_attempts WHERE user_id=$1 AND status<>'active' ORDER BY finished_at DESC LIMIT 200", [userId])).rows.map(row => row.result as AcademyResult);
  const aggregates = new Map<string, { skill: string; answered: number; correct: number }>();
  for (const result of results) for (const item of result.items) {
    const current = aggregates.get(item.skill) || { skill: item.skill, answered: 0, correct: 0 };
    current.answered += 1; current.correct += item.isCorrect ? 1 : 0; aggregates.set(item.skill, current);
  }
  const skills = [...aggregates.values()].map(row => ({ ...row, accuracy: Math.round(row.correct / row.answered * 100) })).sort((a, b) => a.accuracy - b.accuracy);
  const answered = results.reduce((n, row) => n + row.total, 0), correct = results.reduce((n, row) => n + row.correct, 0);
  const recommendations = academyLessons.map(lesson => {
    const evidence = skills.find(row => row.skill === lesson.skill), p = progress.find(row => row.lesson_id === lesson.id);
    const reason = !evidence ? 'ابدأ الدرس لبناء أساس واضح وقياس مستواك.' : evidence.accuracy < 75 ? 'راجع الفكرة ثم جرّب الأسئلة مجددًا لتقوية هذه المهارة.' : !p?.completed_at ? 'أكمل تدريب الدرس الكامل لتثبيت تقدّمك.' : 'حافظ على المهارة بمراجعة قصيرة متباعدة.';
    return { lessonId: lesson.id, trackId: lesson.trackId, title: lesson.title, reason, rank: evidence && evidence.accuracy < 75 ? 0 : !p?.completed_at ? 1 : 2 };
  }).sort((a, b) => a.rank - b.rank).slice(0, 5).map(({ rank: _rank, ...row }) => row);
  return { progress, skills, recommendations, stats: { completedLessons: progress.filter(row => row.completed_at).length, attempts: results.length, correct, answered, accuracy: answered ? Math.round(correct / answered * 100) : 0, sampleLimit: 200 } };
}
studentAcademyRouter.get('/student-academy/catalog', route(async (req, res) => {
  await access(req); const data = await analytics(actor(req));
  res.json({ version: academyVersion, notice: academyNotice, tracks: academyTracks.map(track => ({ ...track,
    lessons: track.lessons.map(({ questions, ...lesson }) => {
      const p = data.progress.find(row => row.lesson_id === lesson.id);
      return { ...lesson, questionCount: questions.length, completed: !!p?.completed_at, bestScore: p?.best_score || 0 };
    }), questionCount: track.lessons.reduce((n, lesson) => n + lesson.questions.length, 0), completedLessons: track.lessons.filter(lesson => data.progress.some(row => row.lesson_id === lesson.id && row.completed_at)).length })),
    stats: data.stats, recommendations: data.recommendations });
}));
studentAcademyRouter.get('/student-academy/catalog/offline', route(async (req, res) => {
  await access(req);
  res.set('Content-Disposition', 'attachment; filename="lootbot-original-lessons.json"');
  res.json({ version: academyVersion, notice: academyNotice, rights: 'Original LootBot foundation lessons; offline personal study is permitted. No publisher material or personal progress is included.',
    tracks: academyTracks.map(track => ({ ...track, lessons: track.lessons.map(({ questions: _questions, ...lesson }) => lesson) })) });
}));
studentAcademyRouter.get('/student-academy/analytics', route(async (req, res) => { await access(req); const { progress: _progress, ...data } = await analytics(actor(req)); res.json(data); }));
studentAcademyRouter.post('/student-academy/attempts', route(async (req, res) => {
  const input = z.object({ trackId: identifier, lessonId: identifier.optional(), mode: z.enum(['untimed', 'timed', 'simulation']).default('untimed'),
    count: z.number().int().min(1).max(40).optional(), timeLimitSec: z.number().int().min(60).max(7200).optional(), mistakesOnly: z.boolean().default(false) }).strict().parse(req.body);
  const track = academyTracks.find(row => row.id === input.trackId); if (!track) throw new EducationError(404, 'المسار غير متاح.');
  const lesson = input.lessonId ? track.lessons.find(row => row.id === input.lessonId) : undefined;
  if (input.lessonId && !lesson) fail(404, 'الدرس غير موجود في هذا المسار.');
  const result = await transaction(async q => {
    await access(req, q);
    await q.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor(req)]);
    const expired = (await q.query("SELECT * FROM student_academy_attempts WHERE user_id=$1 AND status='active' AND deadline_at<=now() FOR UPDATE", [actor(req)])).rows as Attempt[];
    for (const previous of expired) await closeAttempt(q, previous, true);
    const count = (await q.query("SELECT count(*)::int AS n FROM student_academy_attempts WHERE user_id=$1 AND status='active'", [actor(req)])).rows[0].n;
    if (count >= 5) fail(429, 'أكمل المحاولات المفتوحة قبل بدء تدريب جديد.');
    let candidates = lesson ? [...lesson.questions] : [...trackQuestions(track.id)];
    if (input.mistakesOnly) {
      const mistakes = (await q.query('SELECT question_id FROM student_academy_mistakes WHERE user_id=$1 AND NOT mastered AND track_id=$2', [actor(req), track.id])).rows;
      candidates = candidates.filter(item => mistakes.some(row => row.question_id === item.id));
    }
    if (!candidates.length) fail(409, 'لا توجد أسئلة متاحة لهذا الاختيار.');
    for (let i = candidates.length - 1; i > 0; i--) { const j = randomInt(i + 1); [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!]; }
    const selected = candidates.slice(0, Math.min(input.count || (lesson ? lesson.questions.length : 12), candidates.length)), id = createId();
    const startedAt = new Date(), duration = input.mode === 'untimed' ? null : input.timeLimitSec || selected.length * 60;
    const deadlineAt = duration ? new Date(startedAt.getTime() + duration * 1000) : null;
    const title = (input.mode === 'simulation' ? 'محاكاة تدريبية داخلية: ' : input.mistakesOnly ? 'مراجعة الأخطاء: ' : 'تدريب: ') + (lesson?.title || track.title);
    await q.query(`INSERT INTO student_academy_attempts(id,user_id,track_id,lesson_id,mode,title,snapshot,started_at,deadline_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`, [id, actor(req), track.id, lesson?.id || null, input.mode, title, JSON.stringify(selected), startedAt, deadlineAt]);
    return { attemptId: id, startedAt: startedAt.toISOString(), deadlineAt: deadlineAt?.toISOString() || null, questionCount: selected.length, notice: academyNotice };
  }); res.status(201).json(result);
}));
studentAcademyRouter.get('/student-academy/attempts/:id', route(async (req, res) => { res.json(await withAttempt(req, async (_q, attempt) => publicAttempt(attempt))); }));
studentAcademyRouter.put('/student-academy/attempts/:id/answers', route(async (req, res) => {
  const input = z.object({ revision: z.number().int().min(0), answers: z.record(z.string().min(1).max(120), z.number().int().min(0).max(3)).refine(v => Object.keys(v).length <= 40) }).strict().parse(req.body);
  // Return closure conflicts after committing automatic expiry, rather than rolling back its grade.
  const result = await withAttempt(req, async (q, attempt) => {
    if (attempt.status !== 'active') return { closed: true, attempt: publicAttempt(attempt) };
    if (attempt.revision !== input.revision) return { conflict: true, attempt: publicAttempt(attempt) };
    for (const [questionId, selected] of Object.entries(input.answers)) {
      const question = attempt.snapshot.find(item => item.id === questionId);
      if (!question || selected >= question.options.length) fail(400, 'تتضمن الإجابات سؤالًا أو اختيارًا غير موجود في المحاولة.');
    }
    attempt.answers = { ...input.answers }; attempt.revision += 1;
    await q.query('UPDATE student_academy_attempts SET answers=$2::jsonb,revision=$3 WHERE id=$1', [attempt.id, JSON.stringify(attempt.answers), attempt.revision]);
    return { attempt: publicAttempt(attempt) };
  }) as { closed?: boolean; conflict?: boolean; attempt: ReturnType<typeof publicAttempt> };
  if (result.closed || result.conflict) res.status(409).json({ error: result.closed ? 'انتهت المحاولة؛ راجع النتيجة المحفوظة.' : 'تغيرت الإجابات في نافذة أخرى. حدّث المحاولة قبل الحفظ.', ...result });
  else res.json(result.attempt);
}));
studentAcademyRouter.post('/student-academy/attempts/:id/finish', route(async (req, res) => {
  z.object({}).strict().parse(req.body || {});
  res.json(await withAttempt(req, async (q, attempt) => { await closeAttempt(q, attempt, false); return publicAttempt(attempt); }));
}));
studentAcademyRouter.get('/student-academy/history', route(async (req, res) => {
  await access(req);
  const rows = (await pool.query('SELECT id,title,track_id,lesson_id,mode,status,started_at,finished_at,result,snapshot FROM student_academy_attempts WHERE user_id=$1 ORDER BY started_at DESC LIMIT 100', [actor(req)])).rows;
  res.json(rows.map(row => ({ id: row.id, title: row.title, trackId: row.track_id, lessonId: row.lesson_id, mode: row.mode, status: row.status, startedAt: iso(row.started_at), finishedAt: iso(row.finished_at),
    questionCount: row.snapshot.length, percent: row.result?.percent ?? null, correct: row.result?.correct ?? null })));
}));
studentAcademyRouter.get('/student-academy/mistakes', route(async (req, res) => {
  await access(req);
  const rows = (await pool.query('SELECT * FROM student_academy_mistakes WHERE user_id=$1 ORDER BY mastered ASC,last_attempt_at DESC LIMIT 200', [actor(req)])).rows;
  res.json({ items: rows.map(row => ({ ...publicQuestion(row.snapshot), correctIndex: row.snapshot.answer, explanation: row.snapshot.explanation, wrongCount: row.wrong_count, lastAttemptAt: iso(row.last_attempt_at), mastered: row.mastered })) });
}));
studentAcademyRouter.post('/student-academy/mistakes/:questionId/review', route(async (req, res) => {
  await access(req); const questionId = identifier.parse(req.params.questionId), input = z.object({ mastered: z.boolean() }).strict().parse(req.body);
  const result = await pool.query('UPDATE student_academy_mistakes SET mastered=$3 WHERE user_id=$1 AND question_id=$2', [actor(req), questionId, input.mastered]);
  if (!result.rowCount) fail(); res.json({ ok: true });
}));
