import { Router, type Request, type RequestHandler } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { pool, type PoolClient } from "@workspace/db";
import { chemistryPack, chemistryCheck } from "../lib/chemistry";
import {
  requireAuth,
  requireTeacher,
  requireCsrf,
} from "../lib/auth-middleware";
import {
  createId,
  newOpaqueToken,
  sha256,
  safeStringEqual,
} from "../lib/security";
import {
  lessonErrors,
  publicStep,
  attemptOutcome,
  stepAnalytics,
  type StepLessonContent,
  type LessonStep,
  type AnalyticsAttempt,
} from "@workspace/api-zod";

export const learningRouter = Router();
const id = z.string().uuid();
const short = z.string().max(500);
const prose = z.string().max(20000);
const option = z.object({
  id,
  text: z.string().max(2000),
  isCorrect: z.boolean(),
});
const step = z.object({
  id,
  title: short,
  explanation: prose,
  altExplanation: prose.default(""),
  imageAssetId: id.nullable().default(null),
  altImageAssetId: id.nullable().default(null),
  question: prose,
  options: z.array(option).max(6),
  hint: prose.default(""),
  correctExplanation: prose.default(""),
  questionVersionId: id.nullable().optional(),
});
const contentSchema = z.object({
  title: short,
  subject: short.default(""),
  grade: short.default(""),
  objective: prose.default(""),
  description: prose.default(""),
  steps: z.array(step).max(80),
});
const assignmentSchema = z.object({
  versionId: id,
  classId: id,
  mode: z.enum(["learn", "assessed"]).default("learn"),
  allowedAttempts: z.number().int().min(1).max(10).default(3),
  hints: z.boolean().default(true),
  explanations: z.enum(["immediate", "after"]).default("immediate"),
  dueAt: z.string().datetime().nullable().default(null),
});
class LearningError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function deny(message = "البيانات غير متاحة.", status = 404): never {
  throw new LearningError(status, message);
}
const route =
  (fn: RequestHandler): RequestHandler =>
  async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (e) {
      if (e instanceof LearningError) {
        res.status(e.status).json({ error: e.message });
      } else if (e instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "تحقق من الحقول المطلوبة والأطوال والقيم." });
      } else next(e);
    }
  };
const own = (req: Request) => req.auth!.userId;
const write: RequestHandler = (req, res, next) =>
  ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
    ? requireCsrf(req, res, next)
    : next();
learningRouter.use("/teacher/learning", requireAuth, requireTeacher, write);
learningRouter.use(["/teacher/learning", "/student"], (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
async function tx<T>(fn: (q: PoolClient) => Promise<T>): Promise<T> {
  const q = await pool.connect();
  try {
    await q.query("BEGIN");
    const result = await fn(q);
    await q.query("COMMIT");
    return result;
  } catch (e) {
    await q.query("ROLLBACK");
    throw e;
  } finally {
    q.release();
  }
}
async function ownedClass(
  q: Pick<PoolClient, "query">,
  classId: string,
  ownerId: string,
) {
  const r = await q.query(
    "SELECT id FROM teacher_classes WHERE id=$1 AND owner_id=$2 AND archived=false",
    [classId, ownerId],
  );
  if (!r.rowCount) deny();
}
const code = () => randomBytes(8).toString("hex").toUpperCase(); // 64 bits; shown once, hashes only at rest.
const normalizedCode = (v: string) => v.replace(/[\s-]/g, "").toUpperCase();
learningRouter.get(
  "/teacher/learning/access/:classId",
  route(async (req, res) => {
    const classId = id.parse(req.params.classId);
    await ownedClass(pool, classId, own(req));
    const access = await pool.query(
      "SELECT enabled FROM teacher_class_access WHERE class_id=$1 AND owner_id=$2",
      [classId, own(req)],
    );
    const students = await pool.query(
      "SELECT s.id,s.name,coalesce(a.enabled,false) AS enabled FROM teacher_students s LEFT JOIN teacher_student_access a ON a.student_id=s.id WHERE s.owner_id=$1 AND s.class_id=$2 AND s.archived=false AND s.removed=false ORDER BY s.name",
      [own(req), classId],
    );
    res.json({
      classEnabled: access.rows[0]?.enabled ?? false,
      students: students.rows,
    });
  }),
);
learningRouter.post(
  "/teacher/learning/access/class",
  route(async (req, res) => {
    const { classId, enabled } = z
      .object({ classId: id, enabled: z.boolean().default(true) })
      .parse(req.body);
    const raw = code();
    await tx(async (q) => {
      await ownedClass(q, classId, own(req));
      await q.query(
        "DELETE FROM teacher_student_sessions WHERE class_id=$1 AND owner_id=$2",
        [classId, own(req)],
      );
      await q.query(
        "INSERT INTO teacher_class_access(class_id,owner_id,code_hash,enabled) VALUES($1,$2,$3,$4) ON CONFLICT(class_id) DO UPDATE SET code_hash=$3,enabled=$4 WHERE teacher_class_access.owner_id=$2",
        [classId, own(req), sha256(raw), enabled],
      );
    });
    res.json({ code: enabled ? raw : null });
  }),
);
learningRouter.post(
  "/teacher/learning/access/student",
  route(async (req, res) => {
    const { studentId, classId, enabled } = z
      .object({
        studentId: id,
        classId: id,
        enabled: z.boolean().default(true),
      })
      .parse(req.body);
    const raw = code();
    await tx(async (q) => {
      await ownedClass(q, classId, own(req));
      const s = await q.query(
        "SELECT id FROM teacher_students WHERE id=$1 AND owner_id=$2 AND class_id=$3 AND removed=false AND archived=false",
        [studentId, own(req), classId],
      );
      if (!s.rowCount) deny();
      await q.query(
        "DELETE FROM teacher_student_sessions WHERE student_id=$1 AND owner_id=$2",
        [studentId, own(req)],
      );
      await q.query(
        "INSERT INTO teacher_student_access(student_id,owner_id,code_hash,enabled) VALUES($1,$2,$3,$4) ON CONFLICT(student_id) DO UPDATE SET code_hash=$3,enabled=$4 WHERE teacher_student_access.owner_id=$2",
        [studentId, own(req), sha256(raw), enabled],
      );
    });
    res.json({ code: enabled ? raw : null });
  }),
);
function activity(row: Record<string, unknown>) {
  return {
    ...(row.draft as StepLessonContent),
    id: row.id,
    revision: row.revision,
    status: row.status,
    currentVersionId: row.current_version_id,
  };
}
learningRouter.get(
  "/teacher/learning/activities",
  route(async (req, res) => {
    const r = await pool.query(
      "SELECT * FROM teacher_activities WHERE owner_id=$1 ORDER BY updated_at DESC",
      [own(req)],
    );
    res.json(r.rows.map(activity));
  }),
);
async function assetsOwned(
  q: Pick<PoolClient, "query">,
  content: StepLessonContent,
  ownerId: string,
) {
  const ids = [
    ...new Set(
      content.steps
        .flatMap((s) => [s.imageAssetId, s.altImageAssetId])
        .filter(Boolean),
    ),
  ];
  if (ids.length) {
    const r = await q.query(
      "SELECT id FROM teacher_assets WHERE owner_id=$1 AND id=ANY($2::text[])",
      [ownerId, ids],
    );
    if (r.rowCount !== ids.length) deny("صورة إحدى الخطوات غير متاحة.", 400);
  }
  const versions = [
    ...new Set(content.steps.map((s) => s.questionVersionId).filter(Boolean)),
  ];
  if (versions.length) {
    const r = await q.query(
      "SELECT id FROM teacher_question_versions WHERE owner_id=$1 AND id=ANY($2::text[])",
      [ownerId, versions],
    );
    if (r.rowCount !== versions.length) deny("نسخة السؤال غير متاحة.", 400);
  }
}
learningRouter.post(
  "/teacher/learning/activities",
  route(async (req, res) => {
    const content = contentSchema.parse(req.body);
    await assetsOwned(pool, content, own(req));
    const r = await pool.query(
      "INSERT INTO teacher_activities(id,owner_id,type,draft) VALUES($1,$2,'guided_steps',$3) RETURNING *",
      [createId(), own(req), JSON.stringify(content)],
    );
    res.status(201).json(activity(r.rows[0]));
  }),
);
learningRouter.put(
  "/teacher/learning/activities/:id",
  route(async (req, res) => {
    const input = z
      .object({ revision: z.number().int().positive(), content: contentSchema })
      .parse(req.body);
    await assetsOwned(pool, input.content, own(req));
    const r = await pool.query(
      "UPDATE teacher_activities SET draft=$3,type='guided_steps',revision=revision+1,status='draft',updated_at=now() WHERE id=$1 AND owner_id=$2 AND revision=$4 RETURNING *",
      [
        id.parse(req.params.id),
        own(req),
        JSON.stringify(input.content),
        input.revision,
      ],
    );
    if (!r.rowCount) deny("تغيرت المسودة أو أنها غير متاحة. أعد تحميلها.", 409);
    res.json(activity(r.rows[0]));
  }),
);
learningRouter.post(
  "/teacher/learning/activities/:id/publish",
  route(async (req, res) => {
    const revision = z
      .object({ revision: z.number().int().positive() })
      .parse(req.body).revision;
    const result = await tx(async (q) => {
      const r = await q.query(
        "SELECT * FROM teacher_activities WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [id.parse(req.params.id), own(req)],
      );
      const a = r.rows[0];
      if (!a) deny();
      if (a.revision !== revision) deny("تغيرت المسودة. أعد تحميلها.", 409);
      const content = contentSchema.parse(a.draft);
      const errors = lessonErrors(content);
      if (errors.length) deny(errors.join("\n"), 400);
      await assetsOwned(q, content, own(req));
      const n = await q.query(
        "SELECT coalesce(max(number),0)+1 AS number FROM teacher_activity_versions WHERE activity_id=$1",
        [a.id],
      );
      const versionId = createId();
      await q.query(
        "INSERT INTO teacher_activity_versions(id,activity_id,owner_id,number,content) VALUES($1,$2,$3,$4,$5)",
        [versionId, a.id, own(req), n.rows[0].number, JSON.stringify(content)],
      );
      const updated = await q.query(
        "UPDATE teacher_activities SET current_version_id=$3,status='published',updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *",
        [a.id, own(req), versionId],
      );
      return activity(updated.rows[0]);
    });
    res.json(result);
  }),
);
learningRouter.post(
  "/teacher/learning/assignments",
  route(async (req, res) => {
    const data = assignmentSchema.parse(req.body);
    await ownedClass(pool, data.classId, own(req));
    const v = await pool.query(
      "SELECT id FROM teacher_activity_versions WHERE id=$1 AND owner_id=$2",
      [data.versionId, own(req)],
    );
    if (!v.rowCount) deny();
    const r = await pool.query(
      "INSERT INTO teacher_activity_assignments(id,owner_id,version_id,class_id,mode,allowed_attempts,hints,explanations,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
      [
        createId(),
        own(req),
        data.versionId,
        data.classId,
        data.mode,
        data.allowedAttempts,
        data.hints,
        data.explanations,
        data.dueAt,
      ],
    );
    res.status(201).json(r.rows[0]);
  }),
);
learningRouter.get(
  "/teacher/learning/assignments",
  route(async (req, res) => {
    const r = await pool.query(
      'SELECT a.id,a.version_id AS "versionId",a.class_id AS "classId",a.mode,a.allowed_attempts AS "allowedAttempts",a.hints,a.explanations,a.due_at AS "dueAt",a.archived,v.content->>\'title\' AS title,c.name AS "className",count(p.id)::int AS started,count(p.completed_at)::int AS completed FROM teacher_activity_assignments a JOIN teacher_activity_versions v ON v.id=a.version_id JOIN teacher_classes c ON c.id=a.class_id LEFT JOIN teacher_activity_progress p ON p.assignment_id=a.id WHERE a.owner_id=$1 GROUP BY a.id,v.content,c.name ORDER BY a.created_at DESC',
      [own(req)],
    );
    res.json(r.rows);
  }),
);
learningRouter.patch(
  "/teacher/learning/assignments/:id",
  route(async (req, res) => {
    const archived = z
      .object({ archived: z.boolean() })
      .parse(req.body).archived;
    const r = await pool.query(
      "UPDATE teacher_activity_assignments SET archived=$3 WHERE id=$1 AND owner_id=$2 RETURNING id",
      [id.parse(req.params.id), own(req), archived],
    );
    if (!r.rowCount) deny();
    res.json(r.rows[0]);
  }),
);
learningRouter.get(
  "/teacher/learning/results/:id",
  route(async (req, res) => {
    const assignmentId = id.parse(req.params.id);
    const a = await pool.query(
      "SELECT v.content,a.mode,a.class_id FROM teacher_activity_assignments a JOIN teacher_activity_versions v ON v.id=a.version_id WHERE a.id=$1 AND a.owner_id=$2",
      [assignmentId, own(req)],
    );
    if (!a.rowCount) deny();
    const progress = await pool.query(
      "SELECT p.*,s.name FROM teacher_activity_progress p JOIN teacher_students s ON s.id=p.student_id WHERE p.assignment_id=$1 AND p.owner_id=$2",
      [assignmentId, own(req)],
    );
    const events = await pool.query(
      "SELECT * FROM teacher_activity_events WHERE assignment_id=$1 AND owner_id=$2 ORDER BY created_at",
      [assignmentId, own(req)],
    );
    const attempts: AnalyticsAttempt[] = events.rows
      .filter((e) => e.type === "attempt")
      .map((e) => ({
        studentId: e.student_id,
        stepId: e.step_id,
        optionId: e.payload.optionId,
        correct: e.payload.correct,
        number: e.payload.number,
        run: e.run,
      }));
    const content = a.rows[0].content as StepLessonContent;
    const checks = await pool.query(
      `WITH chosen AS (
        SELECT a.id,a.created_at,v.content->>'title' AS title
        FROM teacher_activity_assignments a JOIN teacher_activity_versions v ON v.id=a.version_id
        WHERE a.owner_id=$1 AND a.class_id=$2 AND v.content->>'objective'=$3
        ORDER BY a.created_at DESC,a.id LIMIT 50
      ), firsts AS (
        SELECT DISTINCT ON(e.assignment_id,e.student_id,e.step_id) e.assignment_id,e.payload
        FROM teacher_activity_events e JOIN chosen c ON c.id=e.assignment_id
        WHERE e.owner_id=$1 AND e.type='attempt'
        ORDER BY e.assignment_id,e.student_id,e.step_id,e.created_at,e.id
      ) SELECT c.id,c.title,c.created_at AS "createdAt",
        (SELECT count(*)::int FROM teacher_activity_progress p WHERE p.assignment_id=c.id AND p.owner_id=$1) AS started,
        (SELECT count(*)::int FROM teacher_activity_progress p WHERE p.assignment_id=c.id AND p.owner_id=$1 AND p.completed_at IS NOT NULL) AS completed,
        count(f.assignment_id)::int AS attempts,
        count(f.assignment_id) FILTER(WHERE f.payload->>'correct'='true')::int AS correct
      FROM chosen c LEFT JOIN firsts f ON f.assignment_id=c.id
      GROUP BY c.id,c.title,c.created_at ORDER BY c.created_at,c.id`,
      [own(req), a.rows[0].class_id, content.objective],
    );
    const simulations = events.rows.filter((e) => e.type === "simulation");
    const rows = content.steps.map((s) =>
      stepAnalytics(
        s,
        progress.rows
          .filter((p) => (p.reached_ids as string[]).includes(s.id))
          .map((p) => p.student_id),
        attempts,
        events.rows
          .filter((e) => e.type === "support" && e.step_id === s.id)
          .map((e) => e.student_id),
      ),
    );
    res.json({
      title: content.title,
      classId: a.rows[0].class_id,
      objective: content.objective,
      checks: checks.rows.map((check) => ({
        ...check,
        firstTryRate: check.attempts ? check.correct / check.attempts : null,
      })),
      mode: a.rows[0].mode,
      started: progress.rowCount,
      completed: progress.rows.filter((p) => p.completed_at).length,
      steps: rows,
      ...(simulations.length
        ? {
            simulation: {
              runs: simulations.length,
              students: new Set(simulations.map((e) => e.student_id)).size,
              predictionsMatching: simulations.filter(
                (e) => e.payload.result?.predictionCorrect,
              ).length,
              balanced: simulations.filter((e) => e.payload.result?.balanced)
                .length,
            },
          }
        : {}),
      students: progress.rows
        .map((p) => ({
          id: p.student_id,
          name: p.name,
          completed: Boolean(p.completed_at),
          supportSteps: [
            ...new Set(
              events.rows
                .filter(
                  (e) => e.student_id === p.student_id && e.type === "support",
                )
                .map((e) => e.step_id),
            ),
          ].length,
        }))
        .sort((a, b) => b.supportSteps - a.supportSteps),
    });
  }),
);
learningRouter.get(
  "/teacher/learning/question-versions/:questionId",
  route(async (req, res) => {
    const r = await pool.query(
      'SELECT id,number,content,created_at AS "createdAt" FROM teacher_question_versions WHERE question_id=$1 AND owner_id=$2 ORDER BY number DESC',
      [id.parse(req.params.questionId), own(req)],
    );
    if (!r.rowCount) deny("السؤال غير متاح.", 404);
    res.json(r.rows);
  }),
);
learningRouter.get(
  "/teacher/learning/question-versions",
  route(async (req, res) => {
    const r = await pool.query(
      'SELECT DISTINCT ON(q.question_id) q.id,q.question_id AS "questionId",q.number,q.content FROM teacher_question_versions q JOIN teacher_records r ON r.id=q.question_id WHERE q.owner_id=$1 AND r.archived=false ORDER BY q.question_id,q.number DESC',
      [own(req)],
    );
    res.json(r.rows);
  }),
);

// A distinct, cookie-based student identity. No owner login or public roster endpoint.
const SESSION = "lootbot_student",
  CSRF = "lootbot_student_csrf";
type StudentIdentity = {
  id: string;
  studentId: string;
  classId: string;
  ownerId: string;
  csrfHash: string;
};
const identities = new WeakMap<Request, StudentIdentity>();
const studentAuth = route(async (req, res, next) => {
  const token = req.cookies?.[SESSION];
  if (typeof token !== "string" || token.length < 32)
    deny("أدخل رمزي الدخول لفتح أنشطتك.", 401);
  const r = await pool.query(
    "SELECT se.id,se.student_id,se.class_id,se.owner_id,se.csrf_hash FROM teacher_student_sessions se JOIN teacher_students s ON s.id=se.student_id AND s.owner_id=se.owner_id AND s.class_id=se.class_id JOIN teacher_classes c ON c.id=se.class_id JOIN teacher_student_access sa ON sa.student_id=s.id JOIN teacher_class_access ca ON ca.class_id=c.id WHERE se.token_hash=$1 AND se.expires_at>now() AND s.archived=false AND s.removed=false AND c.archived=false AND sa.enabled=true AND ca.enabled=true",
    [sha256(token)],
  );
  if (!r.rowCount) deny("انتهت الجلسة أو أُلغي رمز الدخول.", 401);
  const a = r.rows[0];
  identities.set(req, {
    id: a.id,
    studentId: a.student_id,
    classId: a.class_id,
    ownerId: a.owner_id,
    csrfHash: a.csrf_hash,
  });
  if (req.method !== "GET") {
    const cookie = req.cookies?.[CSRF],
      header = req.get("x-student-csrf");
    if (
      typeof cookie !== "string" ||
      typeof header !== "string" ||
      !safeStringEqual(cookie, header) ||
      !safeStringEqual(sha256(cookie), a.csrf_hash)
    )
      deny("تعذر التحقق من الطلب. حدّث الصفحة.", 403);
  }
  next();
});
learningRouter.post(
  "/student/entry",
  route(async (req, res) => {
    if (req.get("x-student-entry") !== "1") deny("تعذر التحقق من الطلب.", 403);
    const input = z
      .object({
        classCode: z.string().min(8).max(40),
        studentCode: z.string().min(8).max(40),
      })
      .parse(req.body);
    const key = sha256(
      `${req.ip}:${normalizedCode(input.classCode)}:${normalizedCode(input.studentCode)}:${Math.floor(Date.now() / 600000)}`,
    );
    const limit = await pool.query(
      "INSERT INTO teacher_entry_limits(key,attempts,expires_at) VALUES($1,1,now()+interval '10 minutes') ON CONFLICT(key) DO UPDATE SET attempts=teacher_entry_limits.attempts+1 RETURNING attempts",
      [key],
    );
    if (limit.rows[0].attempts > 12)
      deny("محاولات كثيرة. حاول بعد عشر دقائق.", 429);
    const networkLimit = await pool.query(
      "INSERT INTO teacher_entry_limits(key,attempts,expires_at) VALUES($1,1,now()+interval '10 minutes') ON CONFLICT(key) DO UPDATE SET attempts=teacher_entry_limits.attempts+1 RETURNING attempts",
      [sha256(`network:${req.ip}:${Math.floor(Date.now() / 600000)}`)],
    );
    if (networkLimit.rows[0].attempts > 240)
      deny("محاولات كثيرة. حاول بعد عشر دقائق.", 429);
    await pool.query("DELETE FROM teacher_entry_limits WHERE expires_at<now()");
    const r = await pool.query(
      "SELECT s.id,s.owner_id,s.class_id FROM teacher_class_access ca JOIN teacher_classes c ON c.id=ca.class_id JOIN teacher_students s ON s.class_id=c.id AND s.owner_id=c.owner_id JOIN teacher_student_access sa ON sa.student_id=s.id WHERE ca.code_hash=$1 AND sa.code_hash=$2 AND ca.enabled=true AND sa.enabled=true AND c.archived=false AND s.archived=false AND s.removed=false",
      [
        sha256(normalizedCode(input.classCode)),
        sha256(normalizedCode(input.studentCode)),
      ],
    );
    if (r.rowCount !== 1)
      deny("تعذر الدخول. تحقق من الرمزين أو اسأل معلمك.", 401);
    const token = newOpaqueToken(),
      csrf = newOpaqueToken(),
      s = r.rows[0];
    await pool.query(
      "DELETE FROM teacher_student_sessions WHERE expires_at<now()",
    );
    await pool.query(
      "INSERT INTO teacher_student_sessions(id,token_hash,csrf_hash,student_id,class_id,owner_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '8 hours')",
      [createId(), sha256(token), sha256(csrf), s.id, s.class_id, s.owner_id],
    );
    const opts = {
      sameSite: "strict" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 8 * 3600000,
    };
    res.cookie(SESSION, token, { ...opts, httpOnly: true });
    res.cookie(CSRF, csrf, opts);
    res.json({ authenticated: true, csrf });
  }),
);
learningRouter.use("/student", studentAuth);
learningRouter.get(
  "/student/session",
  route(async (req, res) => {
    res.json({ authenticated: true, csrf: req.cookies[CSRF] });
  }),
);
learningRouter.post(
  "/student/logout",
  route(async (req, res) => {
    await pool.query("DELETE FROM teacher_student_sessions WHERE id=$1", [
      identities.get(req)!.id,
    ]);
    res.clearCookie(SESSION, { path: "/" });
    res.clearCookie(CSRF, { path: "/" });
    res.json({ ok: true });
  }),
);
learningRouter.get(
  "/student/assignments",
  route(async (req, res) => {
    const s = identities.get(req)!;
    const r = await pool.query(
      'SELECT a.id,a.mode,a.due_at AS "dueAt",a.allowed_attempts AS "allowedAttempts",v.content->>\'title\' AS title,v.content->>\'objective\' AS objective,p.completed_at AS "completedAt" FROM teacher_activity_assignments a JOIN teacher_activity_versions v ON v.id=a.version_id LEFT JOIN teacher_activity_progress p ON p.assignment_id=a.id AND p.student_id=$3 WHERE a.owner_id=$1 AND a.class_id=$2 AND a.archived=false ORDER BY a.created_at DESC',
      [s.ownerId, s.classId, s.studentId],
    );
    res.json(r.rows);
  }),
);
type Progress = {
  id: string;
  run: number;
  current_step_id: string;
  reached_ids: string[];
  passed_ids: string[];
  completed_at: string | null;
};
async function assigned(q: Pick<PoolClient, "query">, req: Request) {
  const s = identities.get(req)!;
  const r = await q.query(
    "SELECT a.*,v.content FROM teacher_activity_assignments a JOIN teacher_activity_versions v ON v.id=a.version_id AND v.owner_id=a.owner_id WHERE a.id=$1 AND a.owner_id=$2 AND a.class_id=$3 AND a.archived=false",
    [id.parse(req.params.id), s.ownerId, s.classId],
  );
  if (!r.rowCount) deny();
  return r.rows[0] as {
    id: string;
    content: StepLessonContent;
    mode: "learn" | "assessed";
    allowed_attempts: number;
    hints: boolean;
    explanations: "immediate" | "after";
    due_at: Date | null;
  };
}
async function progressFor(
  q: Pick<PoolClient, "query">,
  a: Awaited<ReturnType<typeof assigned>>,
  s: StudentIdentity,
  lock = false,
) {
  const first = a.content.steps[0];
  await q.query(
    "INSERT INTO teacher_activity_progress(id,assignment_id,student_id,owner_id,current_step_id,reached_ids) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(assignment_id,student_id) DO NOTHING",
    [
      createId(),
      a.id,
      s.studentId,
      s.ownerId,
      first.id,
      JSON.stringify([first.id]),
    ],
  );
  const r = await q.query(
    "SELECT * FROM teacher_activity_progress WHERE assignment_id=$1 AND student_id=$2" +
      (lock ? " FOR UPDATE" : ""),
    [a.id, s.studentId],
  );
  return r.rows[0] as Progress;
}
async function studentView(
  q: Pick<PoolClient, "query">,
  a: Awaited<ReturnType<typeof assigned>>,
  p: Progress,
  s: StudentIdentity,
) {
  const step = a.content.steps.find((step) => step.id === p.current_step_id)!;
  const events = await q.query(
    "SELECT payload FROM teacher_activity_events WHERE assignment_id=$1 AND student_id=$2 AND step_id=$3 AND run=$4 AND type='attempt' ORDER BY created_at",
    [a.id, s.studentId, step.id, p.run],
  );
  const last = events.rows.at(-1)?.payload;
  const outcome = last
    ? attemptOutcome(
        last.correct,
        events.rowCount ?? 0,
        a.mode,
        a.allowed_attempts,
      )
    : { canAdvance: false };
  const reveal = outcome.canAdvance;
  const attempts = await q.query(
    "SELECT step_id,payload FROM teacher_activity_events WHERE assignment_id=$1 AND student_id=$2 AND run=$3 AND type='attempt'",
    [a.id, s.studentId, p.run],
  );
  const chemistry = (
    a.content as StepLessonContent & {
      chemistry?: { reactionId: string; packVersion: string };
    }
  ).chemistry;
  const reaction = chemistryPack.reactions.find(
    (r) =>
      r.id === chemistry?.reactionId &&
      chemistry?.packVersion === chemistryPack.version,
  );
  const lastSimulation = reaction
    ? await q.query(
        "SELECT payload FROM teacher_activity_events WHERE assignment_id=$1 AND student_id=$2 AND run=$3 AND type='simulation' ORDER BY created_at DESC LIMIT 1",
        [a.id, s.studentId, p.run],
      )
    : undefined;
  return {
    ...(lastSimulation?.rows[0]
      ? { simulationResult: lastSimulation.rows[0].payload.result }
      : {}),
    ...(reaction
      ? {
          simulation: {
            reactionId: reaction.id,
            title: reaction.title,
            reactants: reaction.reactants.map((r) => r.formula),
            condition: reaction.condition,
            scope: chemistryPack.scope,
          },
        }
      : {}),
    assignment: {
      id: a.id,
      title: a.content.title,
      objective: a.content.objective,
      mode: a.mode,
      allowedAttempts: a.allowed_attempts,
    },
    step: publicStep(step),
    position: a.content.steps.findIndex((st) => st.id === step.id) + 1,
    total: a.content.steps.length,
    progress: {
      completed: Boolean(p.completed_at),
      run: p.run,
      reachedIds: p.reached_ids,
    },
    ...(p.completed_at && a.explanations === "after"
      ? {
          review: a.content.steps.map((st) => ({
            id: st.id,
            title: st.title,
            explanation: st.correctExplanation,
          })),
        }
      : {}),
    feedback: last
      ? {
          ...outcome,
          number: events.rowCount,
          optionId: last.optionId,
          ...(reveal
            ? { correctOptionId: step.options.find((o) => o.isCorrect)!.id }
            : {}),
          ...(a.hints && events.rowCount === 1 && !last.correct
            ? { hint: step.hint }
            : {}),
          ...(reveal && (a.explanations === "immediate" || p.completed_at)
            ? { explanation: step.correctExplanation }
            : {}),
        }
      : null,
    firstTryCorrect: new Set(
      attempts.rows
        .filter((r) => r.payload.number === 1 && r.payload.correct)
        .map((r) => r.step_id),
    ).size,
  };
}
learningRouter.get(
  "/student/assignments/:id",
  route(async (req, res) => {
    const a = await assigned(pool, req);
    const p = await progressFor(pool, a, identities.get(req)!);
    res.json(await studentView(pool, a, p, identities.get(req)!));
  }),
);
const eventSchema = z.object({
  requestKey: id,
  stepId: id,
  optionId: id.optional(),
  targetStepId: id.optional(),
  predictsReaction: z.boolean().optional(),
  coefficients: z.array(z.number().int().min(1).max(20)).max(8).optional(),
});
learningRouter.post(
  "/student/assignments/:id/:action",
  route(async (req, res) => {
    const action = z
      .enum(["attempt", "support", "advance", "restart", "simulation"])
      .parse(req.params.action);
    const input = eventSchema.parse(req.body),
      s = identities.get(req)!;
    const result = await tx(async (q) => {
      const a = await assigned(q, req),
        p = await progressFor(q, a, s, true);
      const old = await q.query(
        "SELECT payload FROM teacher_activity_events WHERE assignment_id=$1 AND student_id=$2 AND request_key=$3",
        [a.id, s.studentId, input.requestKey],
      );
      if (old.rowCount) return old.rows[0].payload.response;
      if (a.due_at && new Date(a.due_at).getTime() < Date.now())
        deny("انتهى موعد النشاط. يمكنك مراجعة تقدمك المحفوظ.", 409);
      const step = a.content.steps.find((step) => step.id === input.stepId);
      if (!step || step.id !== p.current_step_id)
        deny("أعد تحميل الخطوة الحالية.", 409);
      let payload: Record<string, unknown> = {};
      let updated = p;
      if (action === "simulation") {
        const chemistry = (
          a.content as StepLessonContent & {
            chemistry?: { reactionId: string; packVersion: string };
          }
        ).chemistry;
        const reaction = chemistryPack.reactions.find(
          (r) =>
            r.id === chemistry?.reactionId &&
            chemistry?.packVersion === chemistryPack.version,
        );
        if (!reaction || input.predictsReaction === undefined)
          deny("المحاكاة غير متاحة لهذا النشاط.", 400);
        payload = {
          result: chemistryCheck({
            reactants: reaction.reactants.map((r) => r.formula),
            condition: reaction.condition,
            predictsReaction: input.predictsReaction,
            coefficients: input.coefficients,
          }),
          prediction: input.predictsReaction,
        };
      } else if (action === "attempt") {
        if (p.completed_at || p.passed_ids.includes(step.id))
          deny("هذه الخطوة مكتملة.", 409);
        const option = step.options.find((o) => o.id === input.optionId);
        if (!option) deny("اختر إجابة صالحة.", 400);
        const n = await q.query(
          "SELECT count(*)::int AS n FROM teacher_activity_events WHERE assignment_id=$1 AND student_id=$2 AND step_id=$3 AND run=$4 AND type='attempt'",
          [a.id, s.studentId, step.id, p.run],
        );
        const number = n.rows[0].n + 1;
        if (a.mode === "assessed" && number > a.allowed_attempts)
          deny("بلغت حد المحاولات.", 409);
        const outcome = attemptOutcome(
          option.isCorrect,
          number,
          a.mode,
          a.allowed_attempts,
        );
        payload = { optionId: option.id, correct: option.isCorrect, number };
        if (outcome.canAdvance) {
          updated = {
            ...p,
            passed_ids: [...new Set([...p.passed_ids, step.id])],
          };
          await q.query(
            "UPDATE teacher_activity_progress SET passed_ids=$2 WHERE id=$1",
            [p.id, JSON.stringify(updated.passed_ids)],
          );
        }
      } else if (action === "support") {
        payload = {
          alternative:
            step.altExplanation ||
            "سجّلنا أنك تحتاج توضيحاً أكثر، اسأل معلمك عن هذه الخطوة.",
          imageAssetId: step.altImageAssetId,
        };
      } else if (action === "restart") {
        if (!p.completed_at) deny("أكمل الدرس قبل إعادته.", 409);
        updated = {
          ...p,
          run: p.run + 1,
          current_step_id: a.content.steps[0].id,
          passed_ids: [],
          completed_at: null,
        };
        await q.query(
          "UPDATE teacher_activity_progress SET run=$2,current_step_id=$3,passed_ids='[]',completed_at=null WHERE id=$1",
          [p.id, updated.run, updated.current_step_id],
        );
      } else {
        const index = a.content.steps.findIndex((st) => st.id === step.id);
        if (input.targetStepId) {
          if (!p.reached_ids.includes(input.targetStepId))
            deny("هذه الخطوة لم تُفتح بعد.", 403);
          updated = { ...p, current_step_id: input.targetStepId };
        } else {
          if (!p.passed_ids.includes(step.id))
            deny("أجب أولًا أو أكمل المحاولات.", 409);
          const next = a.content.steps[index + 1];
          updated = next
            ? {
                ...p,
                current_step_id: next.id,
                reached_ids: [...new Set([...p.reached_ids, next.id])],
              }
            : { ...p, completed_at: new Date().toISOString() };
        }
        await q.query(
          "UPDATE teacher_activity_progress SET current_step_id=$2,reached_ids=$3,completed_at=$4 WHERE id=$1",
          [
            p.id,
            updated.current_step_id,
            JSON.stringify(updated.reached_ids),
            updated.completed_at,
          ],
        );
      }
      // Insert the attempt before generating its feedback, within the same locked transaction.
      const eventId = createId();
      await q.query(
        "INSERT INTO teacher_activity_events(id,assignment_id,student_id,owner_id,step_id,run,type,request_key,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          eventId,
          a.id,
          s.studentId,
          s.ownerId,
          step.id,
          p.run,
          action,
          input.requestKey,
          JSON.stringify(payload),
        ],
      );
      const view = await studentView(q, a, updated, s);
      const response = {
        ...view,
        ...(action === "support" ? { support: payload } : {}),
        ...(action === "simulation"
          ? { simulationResult: payload.result }
          : {}),
        ...(updated.completed_at
          ? {
              review:
                a.explanations === "after"
                  ? a.content.steps.map((st) => ({
                      id: st.id,
                      title: st.title,
                      explanation: st.correctExplanation,
                    }))
                  : [],
            }
          : {}),
      };
      await q.query(
        "UPDATE teacher_activity_events SET payload=$2 WHERE id=$1",
        [eventId, JSON.stringify({ ...payload, response })],
      );
      return response;
    });
    res.json(result);
  }),
);
learningRouter.get(
  "/student/assignments/:id/assets/:assetId",
  route(async (req, res) => {
    const a = await assigned(pool, req),
      assetId = id.parse(req.params.assetId);
    if (
      !a.content.steps.some(
        (s) => s.imageAssetId === assetId || s.altImageAssetId === assetId,
      )
    )
      deny();
    const r = await pool.query(
      "SELECT mime_type,content_base64 FROM teacher_assets WHERE id=$1 AND owner_id=$2",
      [assetId, identities.get(req)!.ownerId],
    );
    if (!r.rowCount) deny();
    res
      .type(r.rows[0].mime_type)
      .send(Buffer.from(r.rows[0].content_base64, "base64"));
  }),
);
