import type { Request } from "express";
import { pool, type PoolClient } from "@workspace/db";
import { createId, sha256 } from "./security";
import { randomBytes } from "node:crypto";
export type EducationRole =
  "SCHOOL_ADMIN" | "TEACHER" | "STUDENT" | "CONTENT_MANAGER" | "SUPPORT";
export const roleDefaults: Record<EducationRole, string[]> = {
  SCHOOL_ADMIN: [
    "schools.read",
    "schools.edit",
    "codes.write",
    "classes.write",
    "enrollments.write",
    "reports.read",
    "audit.read",
    "announcements.write",
  ],
  TEACHER: [
    "classes.read",
    "classes.write",
    "reports.read",
    "announcements.write",
    "assignments.write",
    "plans.write",
  ],
  STUDENT: ["practice.read", "practice.write", "personal.write", "help.write"],
  CONTENT_MANAGER: [
    "categories.write",
    "questions.write",
    "questions.publish",
    "faq.write",
    // Available for explicit grants only; the migration preserves existing roles.
    "quant.sources.read",
    "quant.sources.write",
    "quant.sources.import",
    "quant.questions.write",
    "quant.questions.approve",
    "quant.tests.write",
    "quant.tests.publish",
  ],
  SUPPORT: [
    "schools.read",
    "reports.read",
    "audit.read",
    "help.read",
    "help.write",
  ],
};
export class EducationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status = 404, message = "البيانات غير متاحة."): never => {
  throw new EducationError(status, message);
};
export type Query = Pick<PoolClient, "query">;
export async function transaction<T>(fn: (q: PoolClient) => Promise<T>) {
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
export const actor = (req: Request) => req.auth!.userId;
export const root = (req: Request) => req.auth?.role === "SUPERADMIN";
export async function permission(
  req: Request,
  key: string,
  scope = "",
  q: Query = pool,
) {
  if (root(req)) return true;
  if (!scope && ["teacher", "student"].includes(req.auth!.accountType || "")) {
    const native = req.auth!.accountType === "teacher" ? "TEACHER" : "STUDENT";
    const allowed = await q.query(
      "SELECT 1 FROM education_roles WHERE role=$1 AND permissions ? $2",
      [native, key],
    );
    if (allowed.rowCount) return true;
  }
  const r = await q.query(
    `SELECT 1 FROM education_grants g JOIN education_roles r ON r.role=g.role WHERE g.user_id=$1 AND g.active=true AND g.scope=$2 AND r.permissions ? $3`,
    [actor(req), scope, key],
  );
  return !!r.rowCount;
}
export async function authorize(
  req: Request,
  key: string,
  scope = "",
  q: Query = pool,
) {
  if (!(await permission(req, key, scope, q)))
    fail(403, "لا تملك صلاحية تنفيذ هذه العملية.");
}
export async function classAccess(
  req: Request,
  classId: string,
  write = false,
  q: Query = pool,
) {
  const r = await q.query(
    `SELECT c.*,sc.school_id FROM teacher_classes c LEFT JOIN education_school_classes sc ON sc.class_id=c.id WHERE c.id=$1`,
    [classId],
  );
  const row = r.rows[0];
  if (!row) fail();
  if (
    root(req) ||
    (req.auth!.accountType === "teacher" &&
      row.owner_id === actor(req) &&
      (await permission(
        req,
        write ? "classes.write" : "classes.read",
        "",
        q,
      ))) ||
    (row.school_id &&
      (await permission(
        req,
        write ? "classes.write" : "schools.read",
        row.school_id,
        q,
      ))) ||
    (!write && (await permission(req, "schools.read", "", q)))
  )
    return row;
  fail();
}
export async function classAction(
  req: Request,
  classroom: any,
  key: string,
  q: Query = pool,
) {
  if (await permission(req, key, "", q)) return;
  if (
    classroom.school_id &&
    (await permission(req, key, classroom.school_id, q))
  )
    return;
  fail(403, "لا تملك صلاحية تنفيذ هذه العملية.");
}
export async function schoolAccess(
  req: Request,
  schoolId: string,
  write = false,
  q: Query = pool,
) {
  await authorize(
    req,
    write ? "schools.edit" : "schools.read",
    schoolId,
    q,
  ).catch(async (e) => {
    if (!write && (await permission(req, "schools.read", "", q))) return;
    throw e;
  });
  const r = await q.query("SELECT * FROM education_schools WHERE id=$1", [
    schoolId,
  ]);
  if (!r.rowCount) fail();
  return r.rows[0];
}
export async function memberships(req: Request, q: Query = pool) {
  return (
    await q.query(
      `SELECT e.*,s.name AS school_name,c.name AS class_name,c.owner_id,c.data AS class_data FROM education_enrollments e JOIN education_schools s ON s.id=e.school_id JOIN teacher_classes c ON c.id=e.class_id JOIN teacher_students t ON t.id=e.roster_id WHERE e.user_id=$1 AND e.status='active' AND s.status='active' AND c.archived=false AND t.archived=false AND t.removed=false AND ($2::text IS NULL OR e.id=$2)`,
      [actor(req), req.auth?.studentEnrollmentId || null],
    )
  ).rows;
}
export async function audience(req: Request) {
  if (req.auth!.accountType === "student")
    return enabledMemberships(req, "aptitude");
  return (
    await pool.query(
      `SELECT c.id AS class_id,c.data AS class_data,sc.school_id FROM teacher_classes c LEFT JOIN education_school_classes sc ON sc.class_id=c.id WHERE NOT c.archived AND (c.owner_id=$1 OR EXISTS(SELECT 1 FROM education_grants g JOIN education_roles r ON r.role=g.role WHERE g.user_id=$1 AND g.active AND g.scope=sc.school_id AND r.permissions ? 'classes.write'))`,
      [actor(req)],
    )
  ).rows;
}
export async function readContent(req: Request) {
  if (root(req)) return;
  if (req.auth!.accountType === "student") {
    await studentAccess(req);
    return;
  }
  if (
    req.auth!.accountType === "teacher" &&
    (await permission(req, "classes.read"))
  )
    return;
  if (
    (
      await pool.query(
        "SELECT 1 FROM education_grants g JOIN education_roles r ON r.role=g.role WHERE g.user_id=$1 AND g.active AND g.role='SCHOOL_ADMIN' AND r.permissions ? 'classes.write'",
        [actor(req)],
      )
    ).rowCount
  )
    return;
  fail(403, "هذا المحتوى متاح للحسابات التعليمية المخوّلة.");
}
export async function studentAccess(req: Request, q: Query = pool) {
  if (req.auth?.accountType !== "student")
    fail(403, "هذه الصفحة لحساب الطالب.");
  const rows = await memberships(req, q);
  if (!rows.length)
    fail(403, "انضم إلى فصل برمز صالح، أو انتظر موافقة المدرسة.");
  return rows;
}
export async function audit(
  q: Query,
  req: Request,
  action: string,
  resource: string,
  schoolId: string | null = null,
  result = "success",
) {
  await q.query(
    `INSERT INTO audit_logs(id,user_id,action,summary,details) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [
      createId(),
      actor(req),
      "education." + action,
      "عملية تعليمية: " + action,
      JSON.stringify({ resource, schoolId, result }),
    ],
  );
}
export const code = () => randomBytes(16).toString("hex").toUpperCase();
export const codeHash = (input: string) =>
  sha256(input.replace(/[\s-]/g, "").toUpperCase());
export const questionFingerprint = (text: string) =>
  sha256(text.normalize("NFKC").replace(/\s+/g, " ").trim());
export async function entryLimit(req: Request) {
  const key = "education:" + sha256((req.ip || "unknown") + ":" + actor(req));
  const r = await pool.query(
    `INSERT INTO teacher_entry_limits(key,attempts,expires_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN teacher_entry_limits.expires_at<=now() THEN 1 ELSE teacher_entry_limits.attempts+1 END,expires_at=CASE WHEN teacher_entry_limits.expires_at<=now() THEN now()+interval '15 minutes' ELSE teacher_entry_limits.expires_at END RETURNING attempts`,
    [key],
  );
  if (r.rows[0].attempts > 10) fail(429, "محاولات كثيرة. حاول لاحقًا.");
}
export const defaultSettings = {
  platformName: "LootBot للتعليم",
  description: "مساحتك للتعلم والتقدم",
  registration: true,
  maintenance: false,
  aptitude: true,
  studentRoom: true,
  teacherRoom: true,
  comments: false,
  teacherJoinCodes: false,
  contentReview: true,
  codeMaxUses: 500,
  codeDays: 30,
  reviewDays: 3,
  uploadMaxMb: 8,
  supportLink: "",
  retentionDays: 365,
  inactivityDays: 14,
};
export async function settings(scope = "", q: Query = pool) {
  const rows = (
    await q.query(
      "SELECT scope,data FROM education_settings WHERE scope IN ($1,'')",
      [scope],
    )
  ).rows;
  return {
    ...defaultSettings,
    ...rows.find((r) => r.scope === "")?.data,
    ...rows.find((r) => r.scope === scope)?.data,
  };
}
export async function feature(
  req: Request,
  name: "aptitude" | "studentRoom" | "teacherRoom",
  q: Query = pool,
) {
  const global = await settings("", q);
  if (
    process.env.EDUCATION_DISABLED === "true" ||
    global.maintenance ||
    !global[name]
  )
    fail(403, "هذا القسم غير متاح حاليًا.");
  if (req.auth?.accountType === "student") {
    const rows = await studentAccess(req, q);
    if (
      !(
        await Promise.all(
          rows.map(async (r) => (await settings(r.school_id, q))[name]),
        )
      ).some(Boolean)
    )
      fail(403, "القسم موقوف لدى مدرستك.");
  }
}
export async function enabledMemberships(
  req: Request,
  name: "aptitude" | "studentRoom",
  q: Query = pool,
) {
  await feature(req, name, q);
  const rows = await studentAccess(req, q),
    allowed = [];
  for (const row of rows) {
    const policy = await settings(row.school_id, q);
    if (policy[name] && !policy.maintenance) allowed.push(row);
  }
  if (!allowed.length) fail(403, "هذا القسم موقوف لدى مدرستك.");
  return allowed;
}
export function publicQuestion(q: any) {
  return {
    id: q.id,
    text: q.text,
    categoryId: q.category_id,
    difficulty: q.difficulty,
    options: q.content.options.map((o: any) => o.text),
    passage: q.content.passage || "",
    canSave: !!q.content.allowSave,
  };
}
export function elapsed(session: any) {
  return (
    session.active_seconds +
    (session.status === "active"
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(session.resumed_at).getTime()) / 1000,
          ),
        )
      : 0)
  );
}
