import type { Request } from 'express';
import { pool } from '@workspace/db';
import { actor, authorize, enabledMemberships, transaction, type Query } from './education';
import { createId } from './security';
import { logger } from './logger';

export class QuantError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}
export function quantFail(status = 404, code = 'NOT_FOUND', message = 'البيانات غير متاحة.', extra: Record<string, unknown> = {}): never {
  throw new QuantError(status, code, message, extra);
}
export type QuantItem = {
  versionId: string; questionId: string; position: number; stem: string; choices: { key: string; text: string }[];
  correctKey: string; explanation: string; images: string[]; categoryId: string; skill: string; difficulty: string;
  sourceId: string; sourcePage: number | null; attribution?: string;
  sourceTitle?: string; sourceQuestionNumber?: string; sourceSection?: string; publisher?: string;
  explanationSource?: { publisher: 'almufakir'; sourceId: string; sourceFileHash: string; sourcePage: number; verifiedBy: string; reviewedAt: string };
};
export type QuantResponse = {
  questionVersionId: string; choiceKey: string | null; flagged: boolean; visited: boolean; revision: number;
  changeCount: number; timeSpentMs: number;
};
export const publicQuantItem = (item: QuantItem) => ({
  versionId: item.versionId, questionId: item.questionId, position: item.position, stem: item.stem,
  choices: item.choices, images: item.images, skill: item.skill, categoryId: item.categoryId, difficulty: item.difficulty,
  attribution: item.attribution || '',
});
export const publicResponse = (r: any): QuantResponse => ({
  questionVersionId: r.version_id, choiceKey: r.choice_key, flagged: r.flagged, visited: r.visited,
  revision: r.revision, changeCount: r.change_count, timeSpentMs: Number(r.time_spent_ms),
});
export async function quantStudent(req: Request, write = false, q: Query = pool) {
  if (req.auth?.accountType !== 'student') quantFail(403, 'STUDENT_REQUIRED', 'هذا القسم لحساب الطالب.');
  await authorize(req, write ? 'practice.write' : 'practice.read', '', q);
  return enabledMemberships(req, 'aptitude', q);
}
export function visibleScope(row: any, member: any) {
  return (!row.school_id || row.school_id === member.school_id) && (!row.class_id || row.class_id === member.class_id) &&
    (!row.stage || row.stage === (member.class_data?.stage || ''));
}
export const versionQuery = `SELECT v.id AS version_id,v.question_id,v.number,v.snapshot,r.review_status,r.source_id,r.source_page,
 c.id AS category_id,c.name AS skill,c.track,c.school_id,c.class_id,c.stage,c.visible,c.archived,
 s.license_status,s.license_note,s.attribution,s.title AS source_title,s.file_hash AS source_file_hash,s.page_count AS source_page_count,
 r.reviewed_by,q.author_id FROM education_question_versions v
 JOIN education_questions q ON q.id=v.question_id JOIN education_categories c ON c.id=coalesce(v.snapshot->>'categoryId',q.category_id)
 JOIN quant_question_reviews r ON r.version_id=v.id LEFT JOIN quant_sources s ON s.id=r.source_id`;
export function approvedVersion(row: any) {
  return row.review_status === 'approved' && row.source_id && row.license_status === 'verified' &&
    typeof row.license_note === 'string' && row.license_note.trim() && row.track === 'quantitative' && row.visible && !row.archived;
}
export function snapshotItem(row: any, position: number): QuantItem {
  const snapshot = row.snapshot;
  const content = snapshot?.content;
  if (!content || typeof snapshot.text !== 'string' || !Array.isArray(content.options) || content.options.length < 2 || content.options.length > 6 ||
      !Number.isInteger(content.answer) || content.answer < 0 || content.answer >= content.options.length ||
      content.options.some((o: any) => typeof o?.text !== 'string' || !o.text.trim()) ||
      new Set(content.options.map((o: any) => o.text.normalize('NFKC').trim())).size !== content.options.length)
    quantFail(409, 'INVALID_QUESTION', 'سؤال غير مكتمل؛ يجب مراجعته قبل استخدامه.');
  // A correct answer key is not a worked explanation. Only a separately reviewed
  // publisher explanation can enter a frozen attempt; legacy/original prose is withheld.
  const explanationSource = verifiedExplanationSource(row, content);
  return {
    versionId: row.version_id, questionId: row.question_id, position, stem: snapshot.text,
    choices: content.options.map((o: any, i: number) => ({ key: String.fromCharCode(65 + i), text: o.text })),
    correctKey: String.fromCharCode(65 + content.answer), explanation: explanationSource ? content.explanation : '',
    images: Array.isArray(content.stemImages) ? content.stemImages.filter((s: unknown) => typeof s === 'string') : [],
    categoryId: row.category_id, skill: row.skill, difficulty: snapshot.difficulty || 'unknown', sourceId: row.source_id, sourcePage: row.source_page,
    attribution: typeof row.attribution === 'string' ? row.attribution : '',
    sourceTitle: typeof row.source_title === 'string' ? row.source_title : '',
    sourceQuestionNumber: typeof content.sourceQuestionNumber === 'string' ? content.sourceQuestionNumber : '',
    sourceSection: typeof content.sourceSection === 'string' ? content.sourceSection : '',
    publisher: content.publisher === 'almufakir' ? 'almufakir' : '',
    ...(explanationSource ? { explanationSource } : {}),
  };
}
function verifiedExplanationSource(row: any, content: any): QuantItem['explanationSource'] | undefined {
  const p = content.explanationProvenance;
  if (content.publisher !== 'almufakir' || typeof content.explanation !== 'string' || !content.explanation.trim() ||
      !p || p.publisher !== 'almufakir' || p.status !== 'verified' || p.sourceId !== row.source_id ||
      !/^[0-9a-f]{64}$/i.test(p.sourceFileHash || '') || p.sourceFileHash.toLowerCase() !== row.source_file_hash ||
      !Number.isInteger(p.sourcePage) || p.sourcePage < 1 || (row.source_page_count && p.sourcePage > row.source_page_count) ||
      typeof p.verifiedBy !== 'string' || !p.verifiedBy || p.verifiedBy !== row.reviewed_by || p.verifiedBy === row.author_id ||
      typeof p.reviewedAt !== 'string' || !Number.isFinite(Date.parse(p.reviewedAt)) || !approvedVersion(row)) return;
  return { publisher: 'almufakir', sourceId: row.source_id, sourceFileHash: p.sourceFileHash.toLowerCase(),
    sourcePage: p.sourcePage, verifiedBy: p.verifiedBy, reviewedAt: p.reviewedAt };
}
export async function pinnedItems(q: Query, ids: string[], members?: any[]) {
  if (!ids.length) return [];
  const rows = (await q.query(versionQuery + ' WHERE v.id=ANY($1::text[])', [ids])).rows;
  const items: QuantItem[] = [];
  const seen = new Set<string>();
  for (const [i, versionId] of ids.entries()) {
    const row = rows.find((r: any) => r.version_id === versionId);
    if (!row || !approvedVersion(row) || (members && !members.some(m => visibleScope(row, m))))
      quantFail(409, 'QUESTION_UNAVAILABLE', 'بعض أسئلة الاختبار غير معتمدة أو غير متاحة في نطاقك.');
    if (seen.has(row.question_id)) quantFail(400, 'DUPLICATE_QUESTION', 'لا تضف السؤال نفسه بإصدارين إلى الاختبار.');
    seen.add(row.question_id); items.push(snapshotItem(row, i));
  }
  return items;
}
export async function createQuantAttempt(req: Request, q: Query, test: any, items: QuantItem[], member: any, testId: string | null) {
  const id = createId(), startedAt = new Date();
  const deadlineAt = test.timeLimitSec ? new Date(startedAt.getTime() + test.timeLimitSec * 1000) : null;
  await q.query(`INSERT INTO quant_attempts(id,test_id,user_id,enrollment_id,school_id,class_id,test_snapshot,snapshot,started_at,deadline_at,checkpoint_at)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$9)`,
  [id, testId, actor(req), member.id, member.school_id, test.classId || null, JSON.stringify(test), JSON.stringify(items), startedAt, deadlineAt]);
  for (const item of items) await q.query('INSERT INTO quant_responses(attempt_id,version_id,visited) VALUES($1,$2,$3)', [id, item.versionId, item.position === 0]);
  return { attemptId: id, deadlineAt, startedAt, serverTime: new Date().toISOString() };
}
export async function ownedQuantAttempt(req: Request, id: string, q: Query, members: any[]) {
  const a = (await q.query('SELECT * FROM quant_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, actor(req)])).rows[0];
  if (!a || !members.some(m => m.id === a.enrollment_id && m.school_id === a.school_id && (!a.class_id || m.class_id === a.class_id))) quantFail();
  return a;
}
export async function checkpointQuant(q: Query, a: any) {
  if (a.status !== 'in_progress') return false;
  const now = Date.now(), deadline = a.deadline_at ? new Date(a.deadline_at).getTime() : Infinity;
  const until = Math.min(now, deadline), duration = Math.max(0, until - new Date(a.checkpoint_at).getTime());
  const item: QuantItem | undefined = a.snapshot[a.current_index];
  if (item && duration > 0) await q.query('UPDATE quant_responses SET time_spent_ms=time_spent_ms+$3 WHERE attempt_id=$1 AND version_id=$2', [a.id, item.versionId, duration]);
  const expired = now >= deadline;
  await q.query('UPDATE quant_attempts SET checkpoint_at=$2,status=$3,submitted_at=$4 WHERE id=$1', [a.id, new Date(until), expired ? 'expired' : a.status, expired ? new Date(deadline) : a.submitted_at]);
  a.checkpoint_at = new Date(until); if (expired) { a.status = 'expired'; a.submitted_at = new Date(deadline); }
  return expired;
}
export function closedQuantError(a: any) {
  if (a.status === 'expired') return { status: 409, code: 'TIME_EXPIRED', error: 'انتهى الوقت وحُفظت الإجابات للتصحيح.' };
  if (a.status !== 'in_progress') return { status: 409, code: 'ATTEMPT_CLOSED', error: 'المحاولة مغلقة.' };
  return null;
}
export async function quantAttemptPayload(q: Query, a: any) {
  const responses = (await q.query('SELECT * FROM quant_responses WHERE attempt_id=$1 ORDER BY version_id', [a.id])).rows.map(publicResponse);
  return {
    attempt: { id: a.id, status: a.status, deadlineAt: a.deadline_at, startedAt: a.started_at, submittedAt: a.submitted_at, currentIndex: a.current_index },
    test: { title: a.test_snapshot.title, mode: a.test_snapshot.mode, allowReturn: a.test_snapshot.allowReturn, revealPolicy: a.test_snapshot.revealPolicy, revealAt: a.test_snapshot.revealAt || null },
    items: (a.snapshot as QuantItem[]).map(publicQuantItem), responses, serverTime: new Date().toISOString(),
  };
}
export function quantGrade(items: QuantItem[], responses: any[]) {
  let correct = 0, wrong = 0, unanswered = 0, timeSpentMs = 0, answerChanges = 0;
  for (const item of items) {
    const r = responses.find((r: any) => r.version_id === item.versionId);
    timeSpentMs += Number(r?.time_spent_ms || 0); answerChanges += r?.change_count || 0;
    if (!r?.choice_key) unanswered++;
    else if (r.choice_key === item.correctKey) correct++; else wrong++;
  }
  return { correct, wrong, unanswered, total: items.length, accuracy: correct + wrong ? correct / (correct + wrong) : null,
    completion: items.length ? (correct + wrong) / items.length : 0, answerChanges, timeSpentMs };
}
export function quantRevealed(a: any) {
  return (a.status !== 'in_progress' || a.test_snapshot.revealPolicy === 'after_each') && a.test_snapshot.revealPolicy !== 'never' &&
    (a.test_snapshot.revealPolicy !== 'after_deadline' || (a.test_snapshot.revealAt && Date.now() >= new Date(a.test_snapshot.revealAt).getTime()));
}
export async function quantResult(q: Query, a: any) {
  if (a.status === 'in_progress' && a.test_snapshot.revealPolicy !== 'after_each') quantFail(409, 'ATTEMPT_ACTIVE', 'سلّم المحاولة أولًا لعرض النتيجة.');
  const responses = (await q.query('SELECT * FROM quant_responses WHERE attempt_id=$1', [a.id])).rows;
  const summary: any = quantGrade(a.snapshot, responses), revealed = quantRevealed(a);
  const held = a.test_snapshot.revealPolicy === 'after_deadline' && !revealed;
  if (held) { summary.correct = null; summary.wrong = null; summary.accuracy = null; }
  const sources = (await q.query('SELECT id,title,file_hash,license_status FROM quant_sources WHERE id=ANY($1::text[])',
    [[...new Set((a.snapshot as QuantItem[]).map(item => item.sourceId).filter(Boolean))]])).rows;
  return {
    attemptId: a.id, status: a.status, revealed, revealAt: a.test_snapshot.revealAt || null,
    test: { title: a.test_snapshot.title, mode: a.test_snapshot.mode, revealPolicy: a.test_snapshot.revealPolicy },
    startedAt: a.started_at, submittedAt: a.submitted_at, summary, serverTime: new Date().toISOString(),
    items: (a.snapshot as QuantItem[]).filter(item => a.status !== 'in_progress' || responses.some((r: any) => r.version_id === item.versionId && r.choice_key)).map(item => {
      const r = responses.find((r: any) => r.version_id === item.versionId);
      const source = sources.find((s: any) => s.id === item.sourceId), proof = item.explanationSource;
      // Re-check the source license as well as the immutable explanation provenance.
      // Old snapshots may contain a placeholder explanation but have no provenance.
      const explanationAvailable = !!(revealed && item.explanation?.trim() && proof?.publisher === 'almufakir' &&
        item.publisher === 'almufakir' && proof.sourceId === item.sourceId && proof.sourceFileHash === source?.file_hash &&
        source?.license_status === 'verified');
      return { ...publicQuantItem(item), choiceKey: r?.choice_key || null, timeSpentMs: Number(r?.time_spent_ms || 0),
        changeCount: Number(r?.change_count || 0), flagged: !!r?.flagged,
        outcome: !r?.choice_key ? 'unanswered' : !revealed ? 'hidden' : r.choice_key === item.correctKey ? 'correct' : 'wrong',
        source: { title: item.sourceTitle || source?.title || '', publisher: item.publisher === 'almufakir' ? 'almufakir' : '',
          page: item.sourcePage, questionNumber: item.sourceQuestionNumber || '', section: item.sourceSection || '' },
        ...(revealed ? { correctKey: item.correctKey, correct: r?.choice_key ? r.choice_key === item.correctKey : null,
          explanationAvailable,
          ...(explanationAvailable ? { explanation: item.explanation, explanationSource: { publisher: 'almufakir', page: proof!.sourcePage, reviewedAt: proof!.reviewedAt } } : {}) } : {}) };
    }),
  };
}
export async function expireQuantAttempts() {
  return transaction(async q => {
    const rows = (await q.query("SELECT * FROM quant_attempts WHERE status='in_progress' AND deadline_at<=now() ORDER BY deadline_at LIMIT 100 FOR UPDATE SKIP LOCKED")).rows;
    for (const a of rows) await checkpointQuant(q, a);
    return rows.length;
  });
}
let quantWorker: ReturnType<typeof setInterval> | null = null;
export function startQuantWorker() {
  if (quantWorker || process.env.QUANT_WORKER_DISABLED === 'true' || process.env.TEACHER_WORKER_DISABLED === 'true') return;
  let running = false;
  quantWorker = setInterval(() => {
    if (running) return; running = true;
    void expireQuantAttempts().catch(e => logger.warn({ errorType: e instanceof Error ? e.name : 'UnknownError' }, 'Quant attempt expiration failed.')).finally(() => { running = false; });
  }, 30_000); quantWorker.unref();
}
export function stopQuantWorker() { if (quantWorker) clearInterval(quantWorker); quantWorker = null; }
