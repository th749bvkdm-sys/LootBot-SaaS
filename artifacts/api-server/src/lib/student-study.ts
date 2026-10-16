import type { Request } from 'express';
import { pool } from '@workspace/db';
import { actor, enabledMemberships, fail, type Query } from './education';
import { sha256 } from './security';

export const liveMember = "m.left_at IS NULL AND m.last_seen_at>now()-interval '90 seconds'";
export async function studyStudent(req: Request, q: Query = pool) {
  return enabledMemberships(req, 'studentRoom', q);
}
export async function studyLimit(req: Request, bucket: string, maximum: number, q: Query = pool) {
  const r = await q.query(`INSERT INTO teacher_entry_limits(key,attempts,expires_at) VALUES($1,1,now()+interval '15 minutes')
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN teacher_entry_limits.expires_at<=now() THEN 1 ELSE teacher_entry_limits.attempts+1 END,
    expires_at=CASE WHEN teacher_entry_limits.expires_at<=now() THEN now()+interval '15 minutes' ELSE teacher_entry_limits.expires_at END RETURNING attempts`,
  ['student-study:' + bucket + ':' + sha256(actor(req))]);
  if (r.rows[0].attempts > maximum) fail(429, 'محاولات كثيرة. حاول لاحقًا.');
}
export function studyTask(row: any) {
  return { id: row.id, title: row.title, dueDate: row.due_date ? typeof row.due_date === 'string' ? row.due_date.slice(0,10) : [row.due_date.getFullYear(),String(row.due_date.getMonth()+1).padStart(2,'0'),String(row.due_date.getDate()).padStart(2,'0')].join('-') : null,
    done: row.done, createdAt: row.created_at, completedAt: row.completed_at };
}
export function studyFocus(row: any) {
  return row ? { id: row.id, plannedMinutes: row.planned_minutes, startedAt: row.started_at, endsAt: row.ends_at,
    status: row.status, completedAt: row.completed_at } : null;
}
export async function studyOverview(req: Request, q: Query = pool) {
  const uid = actor(req);
  // Only persisted answers and completed sessions contribute. An open tab never earns a badge.
  const activity = `WITH activity AS (
    SELECT completed_at AS happened,planned_minutes::int AS minutes,0::int AS answered FROM student_focus_sessions WHERE user_id=$1 AND status='completed'
    UNION ALL SELECT created_at,0,1 FROM education_answers WHERE user_id=$1
    UNION ALL SELECT a.submitted_at,0,1 FROM quant_responses r JOIN quant_attempts a ON a.id=r.attempt_id WHERE a.user_id=$1 AND a.status IN ('submitted','expired') AND r.choice_key IS NOT NULL
    UNION ALL SELECT finished_at,0,(SELECT count(*)::int FROM jsonb_each(a.answers)) FROM student_academy_attempts a WHERE user_id=$1 AND status IN ('submitted','expired') AND finished_at IS NOT NULL
    UNION ALL SELECT submitted_at,0,(SELECT count(*)::int FROM jsonb_each(e.answers)) FROM student_room_challenge_entries e WHERE user_id=$1 AND submitted_at IS NOT NULL
  )`;
  const totals = (await q.query(activity + ` SELECT coalesce(sum(minutes) FILTER(WHERE (happened AT TIME ZONE 'Asia/Riyadh')::date=(now() AT TIME ZONE 'Asia/Riyadh')::date),0)::int AS today_minutes,
    coalesce(sum(answered) FILTER(WHERE (happened AT TIME ZONE 'Asia/Riyadh')::date=(now() AT TIME ZONE 'Asia/Riyadh')::date),0)::int AS today_answered,
    coalesce(sum(answered),0)::int AS all_answered FROM activity`, [uid])).rows[0];
  const dates = (await q.query(activity + ` SELECT DISTINCT (happened AT TIME ZONE 'Asia/Riyadh')::date::text AS day FROM activity WHERE happened>=now()-interval '366 days' AND (minutes>0 OR answered>0) ORDER BY day DESC LIMIT 366`, [uid])).rows.map(r => r.day);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const cursor = new Date(today + 'T00:00:00Z');
  if (!dates.includes(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streakDays = 0;
  while (dates.includes(cursor.toISOString().slice(0, 10)) && streakDays < 366) { streakDays++; cursor.setUTCDate(cursor.getUTCDate() - 1); }
  let bestStreakDays = 0, run = 0, previous = NaN;
  for (const day of dates) {
    const time = Date.parse(day + 'T00:00:00Z');
    run = previous - time === 86400000 ? run + 1 : 1;
    bestStreakDays = Math.max(bestStreakDays, run); previous = time;
  }
  const sessions = Number((await q.query("SELECT count(*)::int AS n FROM student_focus_sessions WHERE user_id=$1 AND status='completed'", [uid])).rows[0].n);
  const preference = (await q.query('SELECT daily_goal_minutes FROM student_study_preferences WHERE user_id=$1', [uid])).rows[0];
  const tasks = (await q.query('SELECT * FROM student_study_tasks WHERE user_id=$1 AND NOT removed ORDER BY done,due_date ASC NULLS LAST,created_at DESC LIMIT 100', [uid])).rows;
  await q.query("UPDATE student_focus_sessions SET status='cancelled' WHERE user_id=$1 AND status='active' AND ends_at<now()-interval '4 hours'", [uid]);
  const focus = (await q.query("SELECT * FROM student_focus_sessions WHERE user_id=$1 AND status='active'", [uid])).rows[0];
  const stats = { focusMinutesToday: totals.today_minutes, answeredToday: totals.today_answered, streakDays, bestStreakDays,
    totalFocusSessions: sessions, totalAnswered: totals.all_answered };
  return { serverNow: new Date().toISOString(), timezone: 'Asia/Riyadh', dailyGoalMinutes: preference?.daily_goal_minutes || 25, stats,
    badges: [
      { id: 'first-focus', title: 'بداية مركزة', description: 'أكملت جلسة تركيز واحدة.', earned: sessions >= 1 },
      { id: 'three-days', title: 'ثلاثة أيام متتالية', description: 'نشاط حقيقي خلال ثلاثة أيام متتالية.', earned: bestStreakDays >= 3 },
      { id: 'seven-days', title: 'أسبوع من المثابرة', description: 'نشاط حقيقي خلال سبعة أيام متتالية.', earned: bestStreakDays >= 7 },
      { id: 'ten-answers', title: 'خطوتك العاشرة', description: 'أجبت عن عشرة أسئلة في محاولات محفوظة.', earned: totals.all_answered >= 10 },
      { id: 'fifty-answers', title: 'رصيد المعرفة', description: 'أجبت عن خمسين سؤالًا في محاولات محفوظة.', earned: totals.all_answered >= 50 },
    ], tasks: tasks.map(studyTask), activeFocus: studyFocus(focus) };
}
export async function studyRoom(req: Request, roomId: string, q: Query = pool, lock = false) {
  const memberships = await studyStudent(req, q);
  const room = (await q.query(`SELECT r.* FROM student_study_rooms r JOIN student_study_members m ON m.room_id=r.id
    WHERE r.id=$1 AND m.user_id=$2 AND m.left_at IS NULL AND NOT r.closed AND r.expires_at>now() ${lock ? 'FOR UPDATE OF r' : ''}`, [roomId, actor(req)])).rows[0];
  if (!room || !memberships.some(m => m.school_id === room.school_id)) fail();
  return room;
}
export async function studyRoomPayload(req: Request, room: any, q: Query = pool) {
  const members = (await q.query(`SELECT m.user_id,m.nickname,m.last_seen_at FROM student_study_members m JOIN users u ON u.id=m.user_id
    WHERE m.room_id=$1 AND ${liveMember} AND NOT u.suspended AND NOT u.is_deleted
    AND EXISTS(SELECT 1 FROM education_enrollments e JOIN teacher_classes c ON c.id=e.class_id JOIN teacher_students t ON t.id=e.roster_id WHERE e.user_id=m.user_id AND e.school_id=$2 AND e.status='active' AND NOT c.archived AND NOT t.archived AND NOT t.removed)
    ORDER BY m.joined_at`, [room.id, room.school_id])).rows;
  const own = (await q.query('SELECT nickname FROM student_study_members WHERE room_id=$1 AND user_id=$2', [room.id, actor(req)])).rows[0];
  return { id: room.id, title: room.title, nickname: own?.nickname || '', isHost: room.host_user_id === actor(req), capacity: room.capacity,
    memberCount: members.length, members: members.map(m => ({ id: sha256(room.id + ':' + m.user_id).slice(0, 16), nickname: m.nickname,
      isHost: m.user_id === room.host_user_id, isYou: m.user_id === actor(req), lastSeenAt: m.last_seen_at })),
    focus: room.focus_started_at ? { startedAt: room.focus_started_at, endsAt: room.focus_ends_at, minutes: room.focus_minutes } : null,
    createdAt: room.created_at, expiresAt: room.expires_at, serverNow: new Date().toISOString() };
}
export async function studyRooms(req: Request, q: Query = pool) {
  const schools = (await studyStudent(req, q)).map(m => m.school_id);
  const rows = (await q.query(`SELECT r.* FROM student_study_rooms r JOIN student_study_members m ON m.room_id=r.id
    WHERE m.user_id=$1 AND m.left_at IS NULL AND NOT r.closed AND r.expires_at>now() AND r.school_id=ANY($2::text[]) ORDER BY r.created_at DESC LIMIT 12`, [actor(req), schools])).rows;
  const rooms = [];
  for (const room of rows) rooms.push(await studyRoomPayload(req, room, q));
  return rooms;
}
