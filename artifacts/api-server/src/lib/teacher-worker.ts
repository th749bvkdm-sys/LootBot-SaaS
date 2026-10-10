import { pool, type PoolClient } from "@workspace/db";
import { createId } from "./security";
import { logger } from "./logger";

type Config = {
  threshold?: number;
  daysBefore?: number;
  weekDay?: number;
  hour?: number;
  title?: string;
  intervalDays?: number;
  classId?: string;
  dueAt?: string;
};
export function nextTeacherRun(
  type: string,
  config: Config,
  now = new Date(),
  afterExecution = false,
  scheduledAt?: Date,
): Date {
  if (
    !afterExecution &&
    config.dueAt &&
    new Date(config.dueAt).getTime() > now.getTime()
  )
    return new Date(config.dueAt);
  if (type !== "weekly" && type !== "recurring" && !afterExecution)
    return new Date(now.getTime() + 60_000);
  const next = new Date(now);
  next.setUTCHours(config.hour ?? 6, 0, 0, 0);
  if (type === "weekly") {
    const days = ((config.weekDay ?? 0) - next.getUTCDay() + 7) % 7;
    next.setUTCDate(next.getUTCDate() + days);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 7);
  } else if (type === "recurring" && afterExecution) {
    const cadence = config.intervalDays ?? 1;
    if (scheduledAt)
      next.setUTCFullYear(
        scheduledAt.getUTCFullYear(),
        scheduledAt.getUTCMonth(),
        scheduledAt.getUTCDate(),
      );
    next.setUTCDate(next.getUTCDate() + cadence);
    if (next <= now)
      next.setUTCDate(
        next.getUTCDate() +
          (Math.floor((now.getTime() - next.getTime()) / (cadence * 86400000)) +
            1) *
            cadence,
      );
  } else if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
interface Rule {
  id: string;
  owner_id: string;
  name: string;
  type: string;
  config: Config;
  next_run_at: Date;
}
async function remind(
  q: PoolClient,
  r: Rule,
  key: string,
  title: string,
  body: string,
) {
  return (
    (
      await q.query(
        "INSERT INTO teacher_reminders(id,owner_id,rule_id,title,body,dedupe_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,dedupe_key) DO NOTHING",
        [createId(), r.owner_id, r.id, title, body, `${r.id}:${key}`],
      )
    ).rowCount ?? 0
  );
}
async function execute(q: PoolClient, r: Rule): Promise<string> {
  const cfg = r.config;
  let created = 0;
  if (r.type === "absence") {
    const { rows } = await q.query(
      "SELECT student_id,class_id,count(*)::int AS count FROM teacher_records WHERE owner_id=$1 AND kind='attendance' AND data->>'status'='absent' AND ($2::text IS NULL OR class_id=$2) GROUP BY student_id,class_id HAVING count(*) >= $3",
      [r.owner_id, cfg.classId ?? null, cfg.threshold ?? 3],
    );
    for (const row of rows) {
      const key = `absence:${row.student_id}:${row.count}`;
      const inserted = await q.query(
        "INSERT INTO teacher_records(id,owner_id,kind,class_id,student_id,dedupe_key,data) VALUES($1,$2,'tasks',$3,$4,$5,$6) ON CONFLICT(owner_id,kind,dedupe_key) DO NOTHING",
        [
          createId(),
          r.owner_id,
          row.class_id,
          row.student_id,
          `${r.id}:${key}`,
          JSON.stringify({
            title: "متابعة غياب متكرر",
            classId: row.class_id,
            kind: "task",
            dueAt: null,
            status: "pending",
            notes: `بلغ عدد أيام الغياب ${row.count}. راجع ملف الطالب داخل غرفة المعلم.`,
            studentCompletion: [],
            archived: false,
          }),
        ],
      );
      if (inserted.rowCount)
        created += await remind(
          q,
          r,
          key,
          "متابعة الغياب",
          "أُنشئت مهمة متابعة وفق حد الغياب المحدد.",
        );
    }
  } else if (r.type === "upcoming") {
    const days = cfg.daysBefore ?? 2;
    const tasks = await q.query(
      "SELECT id,data FROM teacher_records WHERE owner_id=$1 AND kind='tasks' AND archived=false AND data->>'status'='pending' AND data->>'dueAt' IS NOT NULL AND (data->>'dueAt')::timestamptz::date BETWEEN CURRENT_DATE AND CURRENT_DATE+$2::int AND ($3::text IS NULL OR class_id=$3)",
      [r.owner_id, days, cfg.classId ?? null],
    );
    for (const task of tasks.rows)
      created += await remind(
        q,
        r,
        `task:${task.id}:${task.data.dueAt}`,
        "موعد واجب أو مهمة قريب",
        `${task.data.title} — ${task.data.dueAt}`,
      );
    // Exam grade labels do not identify a class; only unscoped rules include exams.
    if (!cfg.classId) {
      const exams = await q.query(
        "SELECT id,title,document FROM teacher_exams WHERE owner_id=$1 AND archived=false AND is_template=false AND NULLIF(document->'metadata'->>'date','')::date BETWEEN CURRENT_DATE AND CURRENT_DATE+$2::int",
        [r.owner_id, days],
      );
      for (const e of exams.rows)
        created += await remind(
          q,
          r,
          `exam:${e.id}:${e.document.metadata.date}`,
          "موعد اختبار قريب",
          `${e.title} — ${e.document.metadata.date}`,
        );
    }
  } else if (r.type === "grading") {
    const { rows } = await q.query(
      "SELECT id,data FROM teacher_records WHERE owner_id=$1 AND kind='grades' AND archived=false AND data->'marks'='null' AND (data->>'date')::date<=CURRENT_DATE+$2::int AND ($3::text IS NULL OR class_id=$3)",
      [r.owner_id, cfg.daysBefore ?? 2, cfg.classId ?? null],
    );
    for (const row of rows)
      created += await remind(
        q,
        r,
        `grade:${row.id}:${row.data.date}`,
        "تقييم يحتاج رصد الدرجة",
        `${row.data.title} — راجع الدرجات غير المرصودة.`,
      );
  } else if (r.type === "weekly") {
    const { rows } = await q.query(
      "SELECT count(*) FILTER(WHERE kind='attendance')::int AS attendance,count(*) FILTER(WHERE kind='grades')::int AS grades,count(*) FILTER(WHERE kind='tasks' AND data->>'status'='completed')::int AS tasks FROM teacher_records WHERE owner_id=$1 AND archived=false AND updated_at>=now()-interval '7 days' AND ($2::text IS NULL OR class_id=$2)",
      [r.owner_id, cfg.classId ?? null],
    );
    const s = rows[0];
    created += await remind(
      q,
      r,
      `weekly:${r.next_run_at.toISOString().slice(0, 10)}`,
      "ملخص الأسبوع",
      `سجلات الحضور: ${s.attendance}، التقييمات: ${s.grades}، المهام المكتملة: ${s.tasks}.`,
    );
  } else if (r.type === "draft") {
    const { rows } = await q.query(
      "SELECT id,title,updated_at FROM teacher_exams WHERE owner_id=$1 AND archived=false AND is_template=false AND document->'source'->>'reviewed'='false' AND (updated_at<now()-$2::int*interval '1 day' OR ($3::timestamptz IS NOT NULL AND now()>=$3::timestamptz))",
      [r.owner_id, cfg.daysBefore ?? 7, cfg.dueAt ?? null],
    );
    for (const e of rows)
      created += await remind(
        q,
        r,
        `draft:${e.id}:${e.updated_at.toISOString()}`,
        "مسودة اختبار تحتاج مراجعة",
        `${e.title} — أكمل مراجعة المحتوى قبل الطباعة.`,
      );
  } else
    created += await remind(
      q,
      r,
      `recurring:${r.next_run_at.toISOString()}`,
      cfg.title || r.name,
      "تذكير داخلي وفق الجدول الذي اخترته.",
    );
  return `تم فحص البيانات وإنشاء ${created} تذكيرات جديدة.`;
}
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
export async function runTeacherRules(ownerId?: string): Promise<void> {
  if (running) return;
  running = true;
  let q: PoolClient | undefined;
  try {
    q = await pool.connect();
    await q.query("BEGIN");
    const { rows } = await q.query<Rule>(
      "SELECT r.* FROM teacher_rules r JOIN users u ON u.id=r.owner_id WHERE r.enabled=true AND r.next_run_at<=now() AND u.is_deleted=false AND (u.account_type='teacher' OR u.role='SUPERADMIN') AND ($1::text IS NULL OR r.owner_id=$1) ORDER BY r.next_run_at LIMIT 100 FOR UPDATE OF r SKIP LOCKED",
      [ownerId ?? null],
    );
    for (const r of rows) {
      const inserted = await q.query(
        "INSERT INTO teacher_rule_runs(id,rule_id,scheduled_at,result) VALUES($1,$2,$3,$4) ON CONFLICT(rule_id,scheduled_at) DO NOTHING",
        [createId(), r.id, r.next_run_at, "قيد التنفيذ"],
      );
      if (!inserted.rowCount) continue;
      await q.query("SAVEPOINT teacher_rule");
      try {
        const result = await execute(q, r);
        await q.query(
          "UPDATE teacher_rule_runs SET result=$3 WHERE rule_id=$1 AND scheduled_at=$2",
          [r.id, r.next_run_at, result],
        );
        await q.query(
          "UPDATE teacher_rules SET next_run_at=$2,last_run_at=now(),last_result=$3,error=null WHERE id=$1",
          [
            r.id,
            nextTeacherRun(r.type, r.config, new Date(), true, r.next_run_at),
            result,
          ],
        );
        await q.query("RELEASE SAVEPOINT teacher_rule");
      } catch {
        await q.query("ROLLBACK TO SAVEPOINT teacher_rule");
        await q.query(
          "UPDATE teacher_rule_runs SET result='تعذر تنفيذ القاعدة. راجع إعداداتها.' WHERE rule_id=$1 AND scheduled_at=$2",
          [r.id, r.next_run_at],
        );
        await q.query(
          "UPDATE teacher_rules SET next_run_at=$2,last_run_at=now(),last_result='فشل التنفيذ',error='تعذر تنفيذ القاعدة. راجع إعداداتها.' WHERE id=$1",
          [r.id, new Date(Date.now() + 3600000)],
        );
      }
    }
    await q.query("COMMIT");
  } catch (error) {
    if (q) await q.query("ROLLBACK");
    throw error;
  } finally {
    q?.release();
    running = false;
  }
}
export function startTeacherWorker() {
  if (timer || process.env.TEACHER_WORKER_DISABLED === "true") return;
  const tick = () =>
    void runTeacherRules().catch(() =>
      logger.error(
        { errorType: "TeacherWorkerError" },
        "Teacher reminders worker failed.",
      ),
    );
  timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
}
export function stopTeacherWorker() {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
