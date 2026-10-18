import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import {
  requireAuth,
  requireCsrf,
  requireTeacher,
} from "../lib/auth-middleware";
export const classroomRouter = Router();
classroomRouter.use(
  "/teacher/classroom",
  requireAuth,
  requireTeacher,
  (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.method !== "GET") requireCsrf(req, res, next);
    else next();
  },
);
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
class ClassroomError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const route =
  (fn: RequestHandler): RequestHandler =>
  async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (e) {
      if (e instanceof z.ZodError)
        res.status(400).json({ error: "راجع الفصل والطلاب والنقاط." });
      else if (e instanceof ClassroomError)
        res.status(e.status).json({ error: e.message });
      else if ((e as { code?: string }).code === "23505")
        res.status(409).json({ error: "تعارض في معرّف المكافأة." });
      else next(e);
    }
  };
const classId = z.string().uuid();
async function owned(q: Pick<typeof pool, "query">, id: string, owner: string) {
  const row = (
    await q.query(
      "SELECT id,name,data FROM teacher_classes WHERE id=$1 AND owner_id=$2 AND NOT archived FOR UPDATE",
      [id, owner],
    )
  ).rows[0];
  if (!row) throw new ClassroomError(404, "الفصل غير متاح.");
  return row;
}
classroomRouter.get(
  "/teacher/classroom",
  route(async (req, res) => {
    const cid = classId.parse(req.query.classId),
      uid = req.auth!.userId;
    const cls = await owned(pool, cid, uid);
    const students = (
      await pool.query(
        "SELECT id,name FROM teacher_students WHERE owner_id=$1 AND class_id=$2 AND NOT archived AND NOT removed ORDER BY name,id",
        [uid, cid],
      )
    ).rows;
    const events = (
      await pool.query(
        "SELECT student_ids,points,day::text FROM teacher_classroom_events WHERE owner_id=$1 AND class_id=$2",
        [uid, cid],
      )
    ).rows;
    const scores = students
      .map((s) => ({
        ...s,
        points: events
          .filter((e) => e.student_ids.includes(s.id))
          .reduce((sum, e) => sum + e.points, 0),
        todayPoints: events
          .filter((e) => e.day === today() && e.student_ids.includes(s.id))
          .reduce((sum, e) => sum + e.points, 0),
      }))
      .sort(
        (a, b) => b.points - a.points || a.name.localeCompare(b.name, "ar"),
      );
    const days = (
      await pool.query(
        "SELECT day::text FROM teacher_classroom_days WHERE owner_id=$1 AND class_id=$2 ORDER BY day DESC",
        [uid, cid],
      )
    ).rows.map((r) => r.day);
    let cursor = new Date(today() + "T12:00:00Z"),
      streakDays = 0;
    if (!days.includes(today())) cursor.setUTCDate(cursor.getUTCDate() - 1);
    while (days.includes(cursor.toISOString().slice(0, 10))) {
      streakDays++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    res.json({
      ownerId: uid,
      classId: cid,
      className: cls.name,
      subject: cls.data.subject || "",
      scores,
      streakDays,
      creditedToday: days.includes(today()),
      classPoints: events
        .filter((e) => !e.student_ids.length)
        .reduce((sum, e) => sum + e.points, 0),
      today: today(),
    });
  }),
);
classroomRouter.post(
  "/teacher/classroom/rewards",
  route(async (req, res) => {
    const v = z
      .object({
        eventId: z.string().uuid(),
        classId,
        studentIds: z.array(z.string().uuid()).max(500),
        points: z.number().int().min(1).max(1000),
        reason: z.string().trim().min(1).max(200),
      })
      .strict()
      .parse(req.body);
    if (new Set(v.studentIds).size !== v.studentIds.length)
      throw new ClassroomError(400, "لا تكرر الطالب في المكافأة.");
    const uid = req.auth!.userId,
      q = await pool.connect();
    try {
      await q.query("BEGIN");
      await owned(q, v.classId, uid);
      const old = (
        await q.query("SELECT * FROM teacher_classroom_events WHERE id=$1", [
          v.eventId,
        ])
      ).rows[0];
      if (old) {
        if (
          old.owner_id !== uid ||
          old.class_id !== v.classId ||
          old.points !== v.points ||
          old.reason !== v.reason ||
          JSON.stringify([...old.student_ids].sort()) !==
            JSON.stringify([...v.studentIds].sort())
        )
          throw new ClassroomError(409, "تعارض في معرّف المكافأة.");
        await q.query("COMMIT");
        res.json({ saved: true, replayed: true });
        return;
      }
      if (v.studentIds.length) {
        const rows = await q.query(
          "SELECT id FROM teacher_students WHERE id=ANY($1::text[]) AND owner_id=$2 AND class_id=$3 AND NOT archived AND NOT removed FOR SHARE",
          [v.studentIds, uid, v.classId],
        );
        if (rows.rowCount !== v.studentIds.length)
          throw new ClassroomError(400, "أحد الطلاب لم يعد ضمن الفصل النشط.");
      }
      await q.query(
        "INSERT INTO teacher_classroom_events(id,owner_id,class_id,student_ids,points,reason,day) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)",
        [
          v.eventId,
          uid,
          v.classId,
          JSON.stringify(v.studentIds),
          v.points,
          v.reason,
          today(),
        ],
      );
      await q.query("COMMIT");
      res.status(201).json({ saved: true, replayed: false });
    } catch (e) {
      await q.query("ROLLBACK");
      throw e;
    } finally {
      q.release();
    }
  }),
);
classroomRouter.post(
  "/teacher/classroom/streak",
  route(async (req, res) => {
    const v = z.object({ classId }).strict().parse(req.body),
      uid = req.auth!.userId,
      q = await pool.connect();
    try {
      await q.query("BEGIN");
      await owned(q, v.classId, uid);
      await q.query(
        "INSERT INTO teacher_classroom_days(owner_id,class_id,day) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [uid, v.classId, today()],
      );
      await q.query("COMMIT");
      res.json({ saved: true, day: today() });
    } catch (e) {
      await q.query("ROLLBACK");
      throw e;
    } finally {
      q.release();
    }
  }),
);
