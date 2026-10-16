import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { pool, type PoolClient } from "@workspace/db";
import { createId, newOpaqueToken, passwordHash } from "../lib/security";
import { requireAuth, requireCsrf } from "../lib/auth-middleware";
import {
  actor,
  root,
  authorize,
  permission,
  classAccess,
  classAction,
  schoolAccess,
  memberships,
  enabledMemberships,
  audience,
  readContent,
  studentAccess,
  transaction,
  audit,
  code,
  codeHash,
  entryLimit,
  settings,
  defaultSettings,
  feature,
  fail,
  EducationError,
  roleDefaults,
  questionFingerprint,
  publicQuestion,
  elapsed,
} from "../lib/education";
export const educationRouter = Router();
// Licensed imported banks use the versioned quant engine and its current license/figure gates.
// Existing authored education practice continues to use this legacy engine unchanged.
const legacyQuestionScope = `NOT EXISTS(SELECT 1 FROM education_question_versions imported_version WHERE imported_version.question_id=q.id AND imported_version.snapshot->'content' ? 'licensedPackRef')`;
const id = z.string().uuid(),
  short = z.string().trim().min(1).max(200),
  prose = z.string().trim().max(12000);
const route =
  (fn: RequestHandler): RequestHandler =>
  async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (e) {
      if (req.auth) {
        const resource = String(
          req.params.id || req.route?.path || req.path,
        ).slice(0, 200);
        await audit(
          pool,
          req,
          "operation.failed",
          resource,
          null,
          e instanceof EducationError && e.status < 500 ? "denied" : "failed",
        ).catch(() => {});
      }
      if (e instanceof EducationError)
        res.status(e.status).json({ error: e.message });
      else if (e instanceof z.ZodError)
        res.status(400).json({ error: "تحقق من الحقول المطلوبة والقيم." });
      else if ((e as any)?.code === "23505")
        res.status(409).json({ error: "هذه البيانات مسجلة بالفعل." });
      else next(e);
    }
  };
educationRouter.use("/education", requireAuth, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (req.method !== "GET") {
    requireCsrf(req, res, next);
    return;
  }
  next();
});
educationRouter.get(
  "/education/me",
  route(async (req, res) => {
    const grants = (
      await pool.query(
        "SELECT g.role,g.scope,r.permissions FROM education_grants g JOIN education_roles r ON r.role=g.role WHERE g.user_id=$1 AND g.active=true",
        [actor(req)],
      )
    ).rows;
    const member = await memberships(req),
      config = await settings();
    if (req.auth!.accountType === "student" && member.length) {
      for (const key of ["aptitude", "studentRoom"] as const)
        config[key] =
          config[key] &&
          (
            await Promise.all(
              member.map(async (m) => (await settings(m.school_id))[key]),
            )
          ).some(Boolean);
    }
    res.json({
      accountType: req.auth!.accountType,
      root: root(req),
      grants,
      permissions: root(req)
        ? [...new Set(Object.values(roleDefaults).flat())]
        : [
            ...new Set([
              ...grants.flatMap((g) => g.permissions),
              ...(["teacher", "student"].includes(req.auth!.accountType || "")
                ? (
                    await pool.query(
                      "SELECT permissions FROM education_roles WHERE role=$1",
                      [
                        req.auth!.accountType === "teacher"
                          ? "TEACHER"
                          : "STUDENT",
                      ],
                    )
                  ).rows[0]?.permissions || []
                : []),
            ]),
          ],
      memberships: member,
      pending: (
        await pool.query(
          "SELECT id,status FROM education_enrollments WHERE user_id=$1 AND status='pending'",
          [actor(req)],
        )
      ).rows,
      settings: config,
      aiAvailable: false,
    });
  }),
);
educationRouter.post(
  "/education/student-access",
  route(async (req, res) => {
    const v = z
      .object({
        classId: id,
        enrollmentId: id.optional(),
        name: short.optional(),
        days: z.number().int().min(1).max(90).default(30),
      })
      .parse(req.body);
    const raw = code();
    const generatedPassword = v.enrollmentId
      ? null
      : await passwordHash(newOpaqueToken());
    const result = await transaction(async (tx) => {
      let classroom = await classAccess(req, v.classId, true, tx);
      // Serialize preparation and re-read the link after waiting for another issuer.
      await tx.query("SELECT id FROM teacher_classes WHERE id=$1 FOR UPDATE", [
        v.classId,
      ]);
      classroom = await classAccess(req, v.classId, true, tx);
      if (classroom.archived)
        fail(400, "الفصل مؤرشف. اختر فصلًا نشطًا لإصدار الرمز.");
      if (!classroom.school_id) {
        // An independent class gets its own isolated education scope, never an
        // existing school's scope or an administrative grant.
        if (
          !root(req) &&
          !(
            req.auth!.accountType === "teacher" &&
            classroom.owner_id === actor(req)
          )
        )
          fail(403);
        const schoolId = createId();
        await tx.query(
          "INSERT INTO education_schools(id,name,data) VALUES($1,$2,$3::jsonb)",
          [
            schoolId,
            "مساحة الفصل · " + classroom.name,
            JSON.stringify({ independentClassId: v.classId }),
          ],
        );
        await tx.query(
          "INSERT INTO education_school_classes(class_id,school_id) VALUES($1,$2)",
          [v.classId, schoolId],
        );
        classroom.school_id = schoolId;
        await audit(
          tx,
          req,
          "class.student-access-prepared",
          v.classId,
          schoolId,
        );
      }
      const school = (
        await tx.query("SELECT status FROM education_schools WHERE id=$1", [
          classroom.school_id,
        ])
      ).rows[0];
      if (school?.status !== "active") fail(400, "المدرسة غير نشطة.");
      let enrollment;
      if (v.enrollmentId)
        enrollment = (
          await tx.query(
            `SELECT e.*,u.name FROM education_enrollments e JOIN users u ON u.id=e.user_id WHERE e.id=$1 AND e.class_id=$2 AND e.status='active' AND u.account_type='student' AND u.role='OWNER' AND u.student_code_managed AND NOT u.suspended AND NOT u.is_deleted AND NOT EXISTS(SELECT 1 FROM education_enrollments other WHERE other.user_id=e.user_id AND other.id<>e.id) FOR UPDATE OF e`,
            [v.enrollmentId, v.classId],
          )
        ).rows[0];
      else {
        if (!v.name) fail(400, "أدخل اسم الطالب لتجهيز حسابه.");
        const uid = createId(),
          roster = createId(),
          eid = createId();
        await tx.query(
          "INSERT INTO users(id,name,email,password_hash,role,account_type,student_code_managed) VALUES($1,$2,$3,$4,'OWNER','student',true)",
          [
            uid,
            v.name,
            "student." + uid + "@accounts.lootbot.invalid",
            generatedPassword,
          ],
        );
        await tx.query(
          "INSERT INTO teacher_students(id,owner_id,class_id,name,internal_id) VALUES($1,$2,$3,$4,$5)",
          [roster, classroom.owner_id, v.classId, v.name, "account:" + uid],
        );
        await tx.query(
          "INSERT INTO education_enrollments(id,user_id,school_id,class_id,roster_id,status) VALUES($1,$2,$3,$4,$5,'active')",
          [eid, uid, classroom.school_id, v.classId, roster],
        );
        enrollment = { id: eid, user_id: uid, name: v.name };
      }
      if (!enrollment) fail();
      await tx.query(
        "UPDATE education_student_access SET revoked=true WHERE enrollment_id=$1",
        [enrollment.id],
      );
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [
        enrollment.user_id,
      ]);
      const aid = createId();
      await tx.query(
        "INSERT INTO education_student_access(id,enrollment_id,code_hash,created_by,expires_at) VALUES($1,$2,$3,$4,now()+make_interval(days=>$5))",
        [aid, enrollment.id, codeHash(raw), actor(req), v.days],
      );
      await audit(tx, req, "student-access.issued", aid, classroom.school_id);
      return {
        id: aid,
        name: enrollment.name,
        enrollmentId: enrollment.id,
        days: v.days,
      };
    });
    res.status(201).json({ ...result, code: raw });
  }),
);
educationRouter.delete(
  "/education/student-access/:enrollmentId",
  route(async (req, res) => {
    const eid = id.parse(req.params.enrollmentId);
    await transaction(async (tx) => {
      const enrollment = (
        await tx.query(
          "SELECT e.* FROM education_enrollments e JOIN users u ON u.id=e.user_id WHERE e.id=$1 AND u.student_code_managed FOR UPDATE OF e",
          [eid],
        )
      ).rows[0];
      if (!enrollment) fail();
      const classroom = await classAccess(req, enrollment.class_id, true, tx);
      await tx.query(
        "UPDATE education_student_access SET revoked=true WHERE enrollment_id=$1",
        [eid],
      );
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [
        enrollment.user_id,
      ]);
      await audit(tx, req, "student-access.revoked", eid, classroom.school_id);
    });
    res.json({ ok: true });
  }),
);
educationRouter.get(
  "/education/schools",
  route(async (req, res) => {
    const all = root(req) || (await permission(req, "schools.read"));
    const r = await pool.query(
      `SELECT s.*,(SELECT count(*)::int FROM education_enrollments e WHERE e.school_id=s.id AND e.status='active') AS students,(SELECT count(*)::int FROM education_school_classes c WHERE c.school_id=s.id) AS classes FROM education_schools s WHERE $1 OR EXISTS(SELECT 1 FROM education_grants g JOIN education_roles r ON r.role=g.role WHERE g.scope=s.id AND g.user_id=$2 AND g.active AND (r.permissions ? 'schools.read')) ORDER BY s.created_at DESC`,
      [all, actor(req)],
    );
    res.json(r.rows);
  }),
);
const schoolSchema = z.object({
  name: short,
  status: z.enum(["active", "suspended", "archived"]).default("active"),
  data: z
    .object({
      stages: z.array(short).max(10).default([]),
      grades: z.array(short).max(30).default([]),
      terms: z.array(short).max(8).default([]),
    })
    .default({ stages: [], grades: [], terms: [] }),
});
educationRouter.post(
  "/education/schools",
  route(async (req, res) => {
    if (!root(req)) fail(403);
    const v = schoolSchema.parse(req.body),
      sid = createId();
    await transaction(async (q) => {
      await q.query(
        "INSERT INTO education_schools(id,name,status,data) VALUES($1,$2,$3,$4::jsonb)",
        [sid, v.name, v.status, JSON.stringify(v.data)],
      );
      await audit(q, req, "school.created", sid, sid);
    });
    res.status(201).json({ id: sid, ...v });
  }),
);
educationRouter.put(
  "/education/schools/:id",
  route(async (req, res) => {
    const sid = id.parse(req.params.id),
      v = schoolSchema.parse(req.body);
    await transaction(async (q) => {
      await schoolAccess(req, sid, true, q);
      await q.query(
        "UPDATE education_schools SET name=$2,status=$3,data=$4::jsonb,updated_at=now() WHERE id=$1",
        [sid, v.name, v.status, JSON.stringify(v.data)],
      );
      await audit(q, req, "school.updated", sid, sid);
    });
    res.json({ id: sid, ...v });
  }),
);
educationRouter.get(
  "/education/roles",
  route(async (req, res) => {
    if (!root(req)) fail(403);
    res.json({
      roles: (await pool.query("SELECT * FROM education_roles ORDER BY role"))
        .rows,
      permissions: [...new Set(Object.values(roleDefaults).flat())],
      capabilities: roleDefaults,
    });
  }),
);
educationRouter.put(
  "/education/roles/:role",
  route(async (req, res) => {
    if (!root(req)) fail(403);
    const role = z
        .enum([
          "SCHOOL_ADMIN",
          "TEACHER",
          "STUDENT",
          "CONTENT_MANAGER",
          "SUPPORT",
        ])
        .parse(req.params.role),
      v = z
        .object({ permissions: z.array(z.string()).max(30) })
        .parse(req.body);
    if (v.permissions.some((p) => !roleDefaults[role].includes(p)))
      fail(400, "الصلاحية تتجاوز نطاق هذا الدور.");
    await transaction(async (q) => {
      await q.query(
        "UPDATE education_roles SET permissions=$2::jsonb WHERE role=$1",
        [role, JSON.stringify(v.permissions)],
      );
      await audit(q, req, "role.permissions", role);
    });
    res.json({ role, ...v });
  }),
);
educationRouter.get(
  "/education/users",
  route(async (req, res) => {
    if (!root(req)) fail(403);
    const term = z
        .string()
        .max(200)
        .parse(req.query.q || ""),
      role = String(req.query.role || ""),
      school = String(req.query.school || "");
    res.json(
      (
        await pool.query(
          `SELECT u.id,u.name,u.email,u.account_type,u.role,u.suspended,u.created_at,coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'role',g.role,'scope',g.scope,'active',g.active)) FROM education_grants g WHERE g.user_id=u.id),'[]') AS grants FROM users u WHERE u.is_deleted=false AND (u.name ILIKE $1 OR u.email ILIKE $1 OR u.id=$2) AND ($3='' OR u.account_type=$3 OR u.role=$3 OR EXISTS(SELECT 1 FROM education_grants g WHERE g.user_id=u.id AND g.role=$3 AND g.active)) AND ($4='' OR EXISTS(SELECT 1 FROM education_grants g WHERE g.user_id=u.id AND g.scope=$4 AND g.active) OR EXISTS(SELECT 1 FROM education_enrollments e WHERE e.user_id=u.id AND e.school_id=$4)) ORDER BY u.created_at DESC LIMIT 300`,
          ["%" + term + "%", term, role, school],
        )
      ).rows,
    );
  }),
);
educationRouter.post(
  "/education/grants",
  route(async (req, res) => {
    if (!root(req)) fail(403);
    const v = z
      .object({
        userId: id,
        role: z.enum(["SCHOOL_ADMIN", "TEACHER", "CONTENT_MANAGER", "SUPPORT"]),
        scope: z.string().default(""),
        active: z.boolean().default(true),
      })
      .parse(req.body);
    if (v.userId === actor(req)) fail(403, "لا يمكنك تعديل صلاحيات حسابك.");
    if (["SCHOOL_ADMIN", "TEACHER"].includes(v.role)) {
      id.parse(v.scope);
      await schoolAccess(req, v.scope);
    } else if (v.scope !== "") fail(400);
    await transaction(async (q) => {
      const u = await q.query(
        "SELECT role,account_type,student_code_managed FROM users WHERE id=$1 AND is_deleted=false",
        [v.userId],
      );
      if (!u.rowCount || u.rows[0].role === "SUPERADMIN") fail(403);
      if (v.active && u.rows[0].student_code_managed)
        fail(
          400,
          "الحساب المدرسي المخصص للطالب لا يقبل صلاحيات إدارة. استخدم حسابًا مستقلاً مسجلًا بالبريد.",
        );
      if (v.role === "TEACHER" && u.rows[0].account_type !== "teacher")
        fail(400, "اختر حساب معلم.");
      await q.query(
        `INSERT INTO education_grants(id,user_id,role,scope,active) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,role,scope) DO UPDATE SET active=EXCLUDED.active`,
        [createId(), v.userId, v.role, v.scope, v.active],
      );
      await audit(q, req, "grant.changed", v.userId, v.scope || null);
    });
    res.json({ success: true });
  }),
);
educationRouter.patch(
  "/education/users/:id",
  route(async (req, res) => {
    if (!root(req)) fail(403);
    const uid = id.parse(req.params.id),
      v = z
        .object({
          suspended: z.boolean().optional(),
          revokeSessions: z.boolean().default(false),
        })
        .parse(req.body);
    if (uid === actor(req)) fail(403);
    await transaction(async (q) => {
      const u = await q.query("SELECT role FROM users WHERE id=$1", [uid]);
      if (!u.rowCount || u.rows[0].role === "SUPERADMIN") fail(403);
      if (v.suspended !== undefined)
        await q.query(
          "UPDATE users SET suspended=$2,updated_at=now() WHERE id=$1",
          [uid, v.suspended],
        );
      if (v.revokeSessions || v.suspended)
        await q.query("DELETE FROM sessions WHERE user_id=$1", [uid]);
      await audit(q, req, "user.status", uid);
    });
    res.json({ success: true });
  }),
);
educationRouter.get(
  "/education/classes",
  route(async (req, res) => {
    const all = root(req) || (await permission(req, "schools.read"));
    res.json(
      (
        await pool.query(
          `SELECT c.id,c.name,c.owner_id,c.data,c.archived,s.school_id,u.name AS teacher_name,sc.name AS school_name FROM teacher_classes c LEFT JOIN education_school_classes s ON s.class_id=c.id LEFT JOIN education_schools sc ON sc.id=s.school_id JOIN users u ON u.id=c.owner_id WHERE $1 OR c.owner_id=$2 OR EXISTS(SELECT 1 FROM education_grants g JOIN education_roles r ON r.role=g.role WHERE g.scope=s.school_id AND g.user_id=$2 AND g.active AND r.permissions ? 'classes.write') ORDER BY c.created_at DESC`,
          [all, actor(req)],
        )
      ).rows,
    );
  }),
);
educationRouter.post(
  "/education/classes",
  route(async (req, res) => {
    const v = z
      .object({
        schoolId: id,
        classId: id.optional(),
        ownerId: id,
        name: short,
        grade: short,
        stage: short.default("ثانوي"),
        term: short.default("الفصل الأول"),
        subject: short.default("القدرات"),
      })
      .parse(req.body);
    await transaction(async (q) => {
      await schoolAccess(req, v.schoolId, true, q);
      const teacher = await q.query(
        `SELECT 1 FROM users u JOIN education_grants g ON g.user_id=u.id WHERE u.id=$1 AND u.account_type='teacher' AND u.suspended=false AND g.scope=$2 AND g.role='TEACHER' AND g.active`,
        [v.ownerId, v.schoolId],
      );
      if (!teacher.rowCount) fail(400, "المعلم غير مسند لهذه المدرسة.");
      const cid = v.classId || createId();
      if (v.classId) {
        const c = await q.query(
          "SELECT owner_id FROM teacher_classes WHERE id=$1 AND archived=false",
          [cid],
        );
        if (c.rows[0]?.owner_id !== v.ownerId) fail();
      } else {
        await q.query(
          "INSERT INTO teacher_classes(id,owner_id,name,data) VALUES($1,$2,$3,$4::jsonb)",
          [
            cid,
            v.ownerId,
            v.name,
            JSON.stringify({
              grade: v.grade,
              stage: v.stage,
              term: v.term,
              subject: v.subject,
              section: "",
              year: "",
              notes: "",
            }),
          ],
        );
      }
      await q.query(
        "INSERT INTO education_school_classes(class_id,school_id) VALUES($1,$2)",
        [cid, v.schoolId],
      );
      await audit(q, req, "class.assigned", cid, v.schoolId);
      res.status(201).json({ id: cid });
    });
  }),
);
educationRouter.patch(
  "/education/classes/:id",
  route(async (req, res) => {
    const cid = id.parse(req.params.id),
      v = z.object({ archived: z.boolean() }).parse(req.body);
    await transaction(async (q) => {
      const c = await classAccess(req, cid, true, q);
      await q.query(
        "UPDATE teacher_classes SET archived=$2,updated_at=now() WHERE id=$1",
        [cid, v.archived],
      );
      if (v.archived)
        await q.query(
          "DELETE FROM teacher_student_sessions WHERE class_id=$1",
          [cid],
        );
      await audit(q, req, "class.archived", cid, c.school_id);
    });
    res.json({ success: true });
  }),
);
educationRouter.get(
  "/education/codes",
  route(async (req, res) => {
    const sid = id.parse(req.query.schoolId);
    await schoolAccess(req, sid);
    res.json(
      (
        await pool.query(
          `SELECT id,school_id,class_id,max_uses,used_count,expires_at,approval,data,created_at,CASE WHEN status<>'active' THEN status WHEN expires_at<=now() THEN 'expired' WHEN used_count>=max_uses THEN 'exhausted' ELSE 'active' END AS status FROM education_join_codes WHERE school_id=$1 ORDER BY created_at DESC`,
          [sid],
        )
      ).rows,
    );
  }),
);
educationRouter.post(
  "/education/codes",
  route(async (req, res) => {
    const v = z
        .object({
          schoolId: id,
          classId: id,
          maxUses: z.number().int().min(1).max(5000),
          expiresAt: z.string().datetime(),
          approval: z.boolean().default(false),
          type: z.enum(["class", "batch", "temporary"]).default("class"),
        })
        .parse(req.body),
      raw = code(),
      cid = createId();
    await transaction(async (q) => {
      const c = await classAccess(req, v.classId, true, q);
      if (c.school_id !== v.schoolId || c.archived) fail();
      const config = await settings(v.schoolId, q);
      if (
        !root(req) &&
        !(await permission(req, "codes.write", v.schoolId, q)) &&
        !(c.owner_id === actor(req) && config.teacherJoinCodes)
      )
        fail(403);
      if (
        new Date(v.expiresAt).getTime() <= Date.now() ||
        new Date(v.expiresAt).getTime() >
          Date.now() + config.codeDays * 86400000 ||
        v.maxUses > config.codeMaxUses
      )
        fail(400, "المدة أو عدد الاستخدامات يتجاوز سياسة المدرسة.");
      await q.query(
        "INSERT INTO education_join_codes(id,school_id,class_id,created_by,code_hash,max_uses,expires_at,approval,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",
        [
          cid,
          v.schoolId,
          v.classId,
          actor(req),
          codeHash(raw),
          v.maxUses,
          v.expiresAt,
          v.approval,
          JSON.stringify({ ...c.data, type: v.type }),
        ],
      );
      await audit(q, req, "code.created", cid, v.schoolId);
    });
    res.status(201).json({ id: cid, code: raw });
  }),
);
educationRouter.patch(
  "/education/codes/:id",
  route(async (req, res) => {
    const cid = id.parse(req.params.id),
      v = z
        .object({ status: z.enum(["active", "paused", "revoked"]) })
        .parse(req.body);
    await transaction(async (q) => {
      const c = (
        await q.query(
          "SELECT * FROM education_join_codes WHERE id=$1 FOR UPDATE",
          [cid],
        )
      ).rows[0];
      if (!c) fail();
      await authorize(req, "codes.write", c.school_id, q);
      if (c.status === "revoked") fail(409, "الرمز ملغى. أنشئ رمزًا جديدًا.");
      await q.query("UPDATE education_join_codes SET status=$2 WHERE id=$1", [
        cid,
        v.status,
      ]);
      await audit(q, req, "code." + v.status, cid, c.school_id);
    });
    res.json({ success: true });
  }),
);
educationRouter.post(
  "/education/codes/:id/reissue",
  route(async (req, res) => {
    const cid = id.parse(req.params.id),
      raw = code(),
      next = createId();
    await transaction(async (q) => {
      const previous = (
        await q.query(
          "SELECT * FROM education_join_codes WHERE id=$1 FOR UPDATE",
          [cid],
        )
      ).rows[0];
      if (!previous) fail();
      await authorize(req, "codes.write", previous.school_id, q);
      const c = await classAccess(req, previous.class_id, true, q);
      if (c.archived) fail(409, "الفصل مؤرشف.");
      const policy = await settings(previous.school_id, q);
      await q.query(
        "UPDATE education_join_codes SET status='revoked' WHERE id=$1",
        [cid],
      );
      await q.query(
        "INSERT INTO education_join_codes(id,school_id,class_id,created_by,code_hash,max_uses,expires_at,approval,data) VALUES($1,$2,$3,$4,$5,$6,now()+make_interval(days=>$7),$8,$9)",
        [
          next,
          previous.school_id,
          previous.class_id,
          actor(req),
          codeHash(raw),
          Math.min(previous.max_uses, policy.codeMaxUses),
          policy.codeDays,
          previous.approval,
          previous.data,
        ],
      );
      await audit(q, req, "code.reissued", next, previous.school_id);
    });
    res.status(201).json({ id: next, code: raw });
  }),
);
educationRouter.post(
  "/education/join",
  route(async (req, res) => {
    if (req.auth!.accountType !== "student")
      fail(403, "الانضمام متاح لحساب الطالب فقط.");
    await entryLimit(req);
    const v = z.object({ code: z.string().min(8).max(100) }).parse(req.body);
    try {
      const result = await transaction(async (q) => {
        const account = (
          await q.query(
            "SELECT student_code_managed FROM users WHERE id=$1 AND account_type='student' AND NOT suspended AND NOT is_deleted FOR UPDATE",
            [actor(req)],
          )
        ).rows[0];
        if (!account) fail(403, "الانضمام غير متاح لهذا الحساب.");
        const r = await q.query(
            `SELECT j.*,c.owner_id,c.archived AS class_archived,s.status AS school_status,u.name FROM education_join_codes j JOIN teacher_classes c ON c.id=j.class_id JOIN education_schools s ON s.id=j.school_id JOIN users u ON u.id=$2 WHERE j.code_hash=$1 FOR UPDATE OF j`,
            [codeHash(v.code), actor(req)],
          ),
          c = r.rows[0];
        if (
          !c ||
          c.status !== "active" ||
          c.school_status !== "active" ||
          c.class_archived ||
          new Date(c.expires_at).getTime() <= Date.now() ||
          c.used_count >= c.max_uses
        )
          fail(400, "تعذر الانضمام بهذا الرمز. تحقق منه أو راجع المدرسة.");
        if (
          account.student_code_managed &&
          (
            await q.query(
              "SELECT 1 FROM education_enrollments WHERE user_id=$1 AND class_id<>$2",
              [actor(req), c.class_id],
            )
          ).rowCount
        )
          fail(
            403,
            "الحساب المدرسي مرتبط بفصل واحد. اطلب من معلمك نقله بدل إنشاء ارتباط آخر.",
          );
        const previous = (
          await q.query(
            "SELECT * FROM education_enrollments WHERE user_id=$1 AND class_id=$2 FOR UPDATE",
            [actor(req), c.class_id],
          )
        ).rows[0];
        if (previous && previous.status !== "revoked")
          return { id: previous.id, status: previous.status };
        if (
          (
            await q.query(
              "SELECT 1 FROM education_code_uses WHERE code_id=$1 AND user_id=$2",
              [c.id, actor(req)],
            )
          ).rowCount
        )
          fail(400, "تعذر الانضمام بهذا الرمز.");
        const eid = previous?.id || createId(),
          rid = previous?.roster_id || createId(),
          status = c.approval ? "pending" : "active";
        if (!previous)
          await q.query(
            "INSERT INTO teacher_students(id,owner_id,class_id,name,internal_id,archived) VALUES($1,$2,$3,$4,$5,$6)",
            [
              rid,
              c.owner_id,
              c.class_id,
              c.name,
              "account:" + actor(req),
              c.approval,
            ],
          );
        else
          await q.query(
            "UPDATE teacher_students SET archived=$2,removed=false WHERE id=$1",
            [rid, c.approval],
          );
        await q.query(
          `INSERT INTO education_enrollments(id,user_id,school_id,class_id,roster_id,status) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,class_id) DO UPDATE SET status=EXCLUDED.status,updated_at=now()`,
          [eid, actor(req), c.school_id, c.class_id, rid, status],
        );
        await q.query(
          "UPDATE education_join_codes SET used_count=used_count+1 WHERE id=$1",
          [c.id],
        );
        await q.query(
          "INSERT INTO education_code_uses(id,code_id,user_id,enrollment_id) VALUES($1,$2,$3,$4)",
          [createId(), c.id, actor(req), eid],
        );
        await audit(q, req, "student.joined", eid, c.school_id);
        return { id: eid, status };
      });
      res.json(result);
    } catch (e) {
      if (e instanceof EducationError) {
        await audit(pool, req, "join.denied", "join", null, "denied");
      }
      throw e;
    }
  }),
);
educationRouter.get(
  "/education/enrollments",
  route(async (req, res) => {
    const cid = id.parse(req.query.classId);
    await classAccess(req, cid);
    res.json(
      (
        await pool.query(
          `SELECT e.id,e.user_id,e.status,e.created_at,u.name,u.student_code_managed AS code_managed FROM education_enrollments e JOIN users u ON u.id=e.user_id WHERE e.class_id=$1 ORDER BY e.created_at DESC`,
          [cid],
        )
      ).rows,
    );
  }),
);
educationRouter.patch(
  "/education/enrollments/:id",
  route(async (req, res) => {
    const eid = id.parse(req.params.id),
      v = z
        .object({
          status: z.enum(["active", "revoked"]),
          classId: id.optional(),
        })
        .parse(req.body);
    await transaction(async (q) => {
      const e = (
        await q.query(
          "SELECT * FROM education_enrollments WHERE id=$1 FOR UPDATE",
          [eid],
        )
      ).rows[0];
      if (!e) fail();
      await classAccess(req, e.class_id, true, q);
      if (v.status === "revoked" || (v.classId && v.classId !== e.class_id)) {
        await q.query(
          "UPDATE education_student_access SET revoked=true WHERE enrollment_id=$1",
          [eid],
        );
        await q.query(
          "DELETE FROM sessions WHERE student_access_id IN (SELECT id FROM education_student_access WHERE enrollment_id=$1)",
          [eid],
        );
      }
      if (v.classId && v.classId !== e.class_id) {
        const c = await classAccess(req, v.classId, true, q);
        if (c.school_id !== e.school_id || c.archived) fail();
        const u = (
            await q.query("SELECT name FROM users WHERE id=$1", [e.user_id])
          ).rows[0],
          rid = createId();
        if (
          (
            await q.query(
              "SELECT 1 FROM education_enrollments WHERE user_id=$1 AND class_id=$2 AND id<>$3",
              [e.user_id, c.id, eid],
            )
          ).rowCount
        )
          fail(409, "الطالب مرتبط بالفعل بالفصل المستهدف.");
        await q.query(
          "UPDATE teacher_students SET archived=true,removed=true WHERE id=$1",
          [e.roster_id],
        );
        await q.query(
          "INSERT INTO teacher_students(id,owner_id,class_id,name,internal_id) VALUES($1,$2,$3,$4,$5)",
          [rid, c.owner_id, c.id, u.name, "account:" + e.user_id],
        );
        await q.query(
          "UPDATE education_enrollments SET class_id=$2,roster_id=$3 WHERE id=$1",
          [eid, c.id, rid],
        );
      }
      await q.query(
        "UPDATE education_enrollments SET status=$2,updated_at=now() WHERE id=$1",
        [eid, v.status],
      );
      await q.query(
        "UPDATE teacher_students SET archived=$2 WHERE id=(SELECT roster_id FROM education_enrollments WHERE id=$1)",
        [eid, v.status !== "active"],
      );
      await q.query(
        "DELETE FROM teacher_student_sessions WHERE student_id=$1",
        [e.roster_id],
      );
      await audit(q, req, "enrollment." + v.status, eid, e.school_id);
    });
    res.json({ success: true });
  }),
);
educationRouter.post(
  "/education/enrollments/import",
  route(async (req, res) => {
    const v = z
      .object({
        classId: id,
        preview: z.boolean().default(true),
        rows: z
          .array(z.object({ email: z.string().email().max(254) }))
          .min(1)
          .max(500),
      })
      .parse(req.body);
    const result = await transaction(async (q) => {
      const c = await classAccess(req, v.classId, true, q);
      if (!c.school_id || c.archived) fail();
      await authorize(req, "enrollments.write", c.school_id, q);
      const seen = new Set<string>(),
        rows = [];
      for (const [index, item] of v.rows.entries()) {
        const email = item.email.toLowerCase().trim(),
          u = (
            await q.query(
              "SELECT id,name,student_code_managed FROM users WHERE email=$1 AND account_type='student' AND role='OWNER' AND NOT is_deleted AND NOT suspended FOR UPDATE",
              [email],
            )
          ).rows[0];
        const duplicate = seen.has(email);
        seen.add(email);
        const exists = u
          ? (
              await q.query(
                "SELECT id,status FROM education_enrollments WHERE user_id=$1 AND ($3::boolean OR class_id=$2)",
                [u.id, c.id, u.student_code_managed],
              )
            ).rows[0]
          : null;
        rows.push({
          row: index + 1,
          email,
          error: duplicate
            ? "صف مكرر"
            : !u
              ? "تعذر ربط هذا الحساب"
              : exists
                ? "الحساب مرتبط بالفعل"
                : "",
          user: u,
        });
      }
      if (v.preview)
        return {
          rows: rows.map(({ user, ...r }) => r),
          valid: rows.filter((r) => !r.error).length,
        };
      if (rows.some((r) => r.error))
        fail(400, "عالج جميع أخطاء الملف قبل الاستيراد.");
      for (const row of rows) {
        const eid = createId(),
          rid = createId();
        await q.query(
          "INSERT INTO teacher_students(id,owner_id,class_id,name,internal_id) VALUES($1,$2,$3,$4,$5)",
          [rid, c.owner_id, c.id, row.user!.name, "account:" + row.user!.id],
        );
        await q.query(
          "INSERT INTO education_enrollments(id,user_id,school_id,class_id,roster_id,status) VALUES($1,$2,$3,$4,$5,'active')",
          [eid, row.user!.id, c.school_id, c.id, rid],
        );
        await audit(q, req, "enrollment.imported", eid, c.school_id);
      }
      return { imported: rows.length };
    });
    res.json(result);
  }),
);
educationRouter.post(
  "/education/users/bulk",
  route(async (req, res) => {
    if (!root(req)) fail(403);
    const v = z
      .object({
        ids: z.array(id).min(1).max(100),
        action: z.enum(["suspend", "reactivate", "revokeSessions"]),
        confirmed: z.literal(true),
      })
      .parse(req.body);
    if (v.ids.includes(actor(req))) fail(403);
    await transaction(async (q) => {
      const users = await q.query(
        "SELECT id,role FROM users WHERE id=ANY($1::text[]) AND NOT is_deleted FOR UPDATE",
        [v.ids],
      );
      if (
        users.rowCount !== new Set(v.ids).size ||
        users.rows.some((u) => u.role === "SUPERADMIN")
      )
        fail(403);
      if (v.action !== "revokeSessions")
        await q.query(
          "UPDATE users SET suspended=$2,updated_at=now() WHERE id=ANY($1::text[])",
          [v.ids, v.action === "suspend"],
        );
      if (v.action !== "reactivate")
        await q.query("DELETE FROM sessions WHERE user_id=ANY($1::text[])", [
          v.ids,
        ]);
      for (const uid of v.ids)
        await audit(q, req, "user.bulk." + v.action, uid);
    });
    res.json({ updated: v.ids.length });
  }),
);
const categorySchema = z.object({
  name: short,
  track: z.enum(["quantitative", "verbal", "teacher", "student"]),
  parentId: id.nullable().default(null),
  link: z
    .string()
    .max(300)
    .default("")
    .refine(
      (v) => v === "" || /^\/(teacher|student|learn)(\/[^\s?#]*)?$/.test(v),
      "اختر رابطًا داخليًا تعليميًا.",
    ),
  classId: id.nullable().default(null),
  description: prose.default(""),
  icon: z.string().max(40).default("book"),
  schoolId: id.nullable().default(null),
  stage: z.string().max(100).default(""),
  position: z.number().int().min(0).max(1000).default(0),
  visible: z.boolean().default(true),
  archived: z.boolean().default(false),
});
educationRouter.get(
  "/education/categories",
  route(async (req, res) => {
    const canManage = root(req) || (await permission(req, "categories.write"));
    if (!canManage) {
      await readContent(req);
      await feature(req, "aptitude");
    }
    const member = await audience(req);
    res.json(
      (
        await pool.query(
          `SELECT * FROM education_categories WHERE $1 OR (visible AND NOT archived AND (school_id IS NULL OR school_id=ANY($2::text[])) AND (stage='' OR stage=ANY($3::text[])) AND (class_id IS NULL OR class_id=ANY($4::text[]))) ORDER BY position,name`,
          [
            canManage,
            member.map((m) => m.school_id),
            member.map((m) => m.class_data?.stage || m.class_data?.grade || ""),
            member.map((m) => m.class_id),
          ],
        )
      ).rows,
    );
  }),
);
async function saveCategory(req: Request) {
  await authorize(req, "categories.write");
  const v = categorySchema.parse(req.body),
    cid = req.params.id ? id.parse(req.params.id) : createId();
  await transaction(async (q) => {
    if (v.schoolId) await schoolAccess(req, v.schoolId, false, q);
    if (v.classId) {
      const c = await classAccess(req, v.classId, false, q);
      if (v.schoolId && c.school_id !== v.schoolId) fail(400);
    }
    if (v.parentId) {
      if (v.parentId === cid) fail(400);
      const ancestors = await q.query(
        `WITH RECURSIVE parents AS(SELECT id,parent_id,track FROM education_categories WHERE id=$1 UNION SELECT c.id,c.parent_id,c.track FROM education_categories c JOIN parents p ON c.id=p.parent_id) SELECT * FROM parents`,
        [v.parentId],
      );
      if (
        !ancestors.rowCount ||
        ancestors.rows.some((p) => p.id === cid || p.track !== v.track)
      )
        fail(400, "التصنيف الأب غير صالح.");
    }
    const values = [
      cid,
      v.parentId,
      v.name,
      v.track,
      v.description,
      v.icon,
      v.schoolId,
      v.stage,
      v.position,
      v.visible,
      v.archived,
    ];
    if (req.params.id) {
      const result = await q.query(
        "UPDATE education_categories SET parent_id=$2,name=$3,track=$4,description=$5,icon=$6,school_id=$7,stage=$8,position=$9,visible=$10,archived=$11 WHERE id=$1 RETURNING id",
        values,
      );
      if (!result.rowCount) fail();
    } else
      await q.query(
        "INSERT INTO education_categories(id,parent_id,name,track,description,icon,school_id,stage,position,visible,archived) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        values,
      );
    await q.query(
      "UPDATE education_categories SET link=$2,class_id=$3 WHERE id=$1",
      [cid, v.link, v.classId],
    );
    await audit(q, req, "category.saved", cid, v.schoolId);
  });
  return { id: cid, ...v };
}
educationRouter.post(
  "/education/categories",
  route(async (req, res) => {
    res.status(201).json(await saveCategory(req));
  }),
);
educationRouter.put(
  "/education/categories/:id",
  route(async (req, res) => {
    res.json(await saveCategory(req));
  }),
);
educationRouter.delete(
  "/education/categories/:id",
  route(async (req, res) => {
    await authorize(req, "categories.write");
    const cid = id.parse(req.params.id);
    await transaction(async (q) => {
      await q.query(
        "SELECT id FROM education_categories WHERE id=$1 FOR UPDATE",
        [cid],
      );
      if (
        (
          await q.query(
            "SELECT 1 FROM education_questions WHERE category_id=$1 UNION ALL SELECT 1 FROM education_categories WHERE parent_id=$1",
            [cid],
          )
        ).rowCount
      )
        fail(409, "التصنيف مستخدم. استخدم الأرشفة للاحتفاظ بسجلاته.");
      await q.query("DELETE FROM education_categories WHERE id=$1", [cid]);
      await audit(q, req, "category.deleted", cid);
    });
    res.json({ success: true });
  }),
);
const questionSchema = z.object({
  categoryId: id,
  text: prose.refine((t) => t.length > 4),
  difficulty: z.enum(["easy", "medium", "hard"]),
  status: z.enum(["draft", "review", "published", "archived"]).default("draft"),
  content: z.object({
    options: z
      .array(z.object({ text: short, explanation: prose.default("") }))
      .min(2)
      .max(6),
    answer: z.number().int().min(0).max(5),
    explanation: prose,
    passage: prose.default(""),
    source: short,
    rights: z.enum(["original", "licensed"]),
    license: prose.default(""),
    allowSave: z.boolean().default(true),
  }),
});
educationRouter.get(
  "/education/room-content",
  route(async (req, res) => {
    await readContent(req);
    const student = req.auth!.accountType === "student";
    if (student) await feature(req, "studentRoom");
    const member = student ? await enabledMemberships(req, "studentRoom") : [];
    const classrooms = student
      ? member.map((m) => m.class_id)
      : (
          await pool.query("SELECT id FROM teacher_classes WHERE owner_id=$1", [
            actor(req),
          ])
        ).rows.map((c) => c.id);
    const schools = student
      ? member.map((m) => m.school_id)
      : (
          await pool.query(
            "SELECT scope FROM education_grants WHERE user_id=$1 AND active AND role IN ('TEACHER','SCHOOL_ADMIN')",
            [actor(req)],
          )
        ).rows.map((g) => g.scope);
    const stages = student
      ? member.map((m) => m.class_data?.stage || "")
      : (
          await pool.query(
            "SELECT data FROM teacher_profiles WHERE owner_id=$1",
            [actor(req)],
          )
        ).rows.map((p) => p.data.stage || "");
    res.json(
      (
        await pool.query(
          `SELECT id,name,description,icon,link FROM education_categories WHERE track=$1 AND visible AND NOT archived AND (school_id IS NULL OR school_id=ANY($2::text[])) AND (class_id IS NULL OR class_id=ANY($3::text[])) AND (stage='' OR stage=ANY($4::text[])) ORDER BY position,name`,
          [student ? "student" : "teacher", schools, classrooms, stages],
        )
      ).rows,
    );
  }),
);
async function saveQuestion(
  req: Request,
  input: unknown,
  existing?: string,
  external?: PoolClient,
) {
  await authorize(req, "questions.write", "", external || pool);
  const v = questionSchema.parse(input);
  if (
    v.content.answer >= v.content.options.length ||
    new Set(v.content.options.map((o) => o.text)).size !==
      v.content.options.length
  )
    fail(400, "راجع الاختيارات والإجابة الصحيحة.");
  if (v.content.rights === "licensed" && !v.content.license)
    fail(400, "وثّق إذن الاستخدام.");
  const qid = existing || createId();
  const save = async (q: PoolClient) => {
    if (
      existing &&
      (
        await q.query(
          "SELECT 1 FROM education_question_versions WHERE question_id=$1 AND snapshot->'content' ? 'licensedPackRef' LIMIT 1",
          [existing],
        )
      ).rowCount
    )
      fail(
        409,
        "تُدار أسئلة البنك المرخّص بإصداراتها ومصادرها من إدارة الكمي.",
      );
    const cat = (
      await q.query("SELECT * FROM education_categories WHERE id=$1", [
        v.categoryId,
      ])
    ).rows[0];
    if (!cat || !["quantitative", "verbal"].includes(cat.track))
      fail(400, "اختر مهارة كمي أو لفظي.");
    const duplicate = await q.query(
      "SELECT 1 FROM education_questions WHERE fingerprint=$1 AND id<>$2",
      [questionFingerprint(v.text), qid],
    );
    if (duplicate.rowCount) fail(409, "السؤال مكرر في بنك المحتوى.");
    let reviewedBy = null;
    if (v.status === "published") {
      await authorize(req, "questions.publish", "", q);
      const s = await settings("", q);
      if (s.contentReview) {
        const prev = existing
          ? (
              await q.query(
                "SELECT status,author_id FROM education_questions WHERE id=$1 FOR UPDATE",
                [qid],
              )
            ).rows[0]
          : null;
        if (!prev || prev.status !== "review" || prev.author_id === actor(req))
          fail(409, "أرسل السؤال للمراجعة، ثم ينشره مراجع آخر.");
        reviewedBy = actor(req);
      }
    }
    const previous = existing
      ? (
          await q.query(
            "SELECT revision FROM education_questions WHERE id=$1 FOR UPDATE",
            [qid],
          )
        ).rows[0]
      : null;
    if (existing && !previous) fail();
    const rev = (previous?.revision || 0) + 1;
    const values = [
      qid,
      v.categoryId,
      v.text,
      questionFingerprint(v.text),
      v.difficulty,
      JSON.stringify(v.content),
      v.status,
      rev,
      actor(req),
      reviewedBy,
    ];
    if (existing)
      await q.query(
        "UPDATE education_questions SET category_id=$2,text=$3,fingerprint=$4,difficulty=$5,content=$6::jsonb,status=$7,revision=$8,reviewed_by=$9,updated_at=now() WHERE id=$1",
        [...values.slice(0, 8), reviewedBy],
      );
    else
      await q.query(
        "INSERT INTO education_questions(id,category_id,text,fingerprint,difficulty,content,status,revision,author_id,reviewed_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)",
        values,
      );
    await q.query(
      "INSERT INTO education_question_versions(id,question_id,number,snapshot) VALUES($1,$2,$3,$4::jsonb)",
      [createId(), qid, rev, JSON.stringify(v)],
    );
    await audit(q, req, "question." + v.status, qid, cat.school_id);
  };
  if (external) await save(external);
  else await transaction(save);
  return { id: qid, ...v };
}
educationRouter.get(
  "/education/questions",
  route(async (req, res) => {
    const manage = root(req) || (await permission(req, "questions.write"));
    if (!manage) {
      await readContent(req);
      await feature(req, "aptitude");
    }
    const term = z
        .string()
        .max(200)
        .parse(req.query.q || ""),
      cat = String(req.query.categoryId || ""),
      difficulty = String(req.query.difficulty || "");
    const member = await audience(req);
    const rows = (
      await pool.query(
        `SELECT q.*,c.name AS skill,c.track FROM education_questions q JOIN education_categories c ON c.id=q.category_id WHERE ${legacyQuestionScope} AND ($1 OR (q.status='published' AND c.visible AND NOT c.archived AND (c.school_id IS NULL OR c.school_id=ANY($5::text[])) AND (c.stage='' OR c.stage=ANY($6::text[])) AND (c.class_id IS NULL OR c.class_id=ANY($7::text[])))) AND q.text ILIKE $2 AND ($3='' OR q.category_id=$3) AND ($4='' OR q.difficulty=$4) ORDER BY q.updated_at DESC LIMIT 500`,
        [
          manage,
          "%" + term + "%",
          cat,
          difficulty,
          member.map((m) => m.school_id),
          member.map((m) => m.class_data?.stage || ""),
          member.map((m) => m.class_id),
        ],
      )
    ).rows;
    res.json(manage ? rows : rows.map(publicQuestion));
  }),
);
educationRouter.post(
  "/education/questions",
  route(async (req, res) => {
    res.status(201).json(await saveQuestion(req, req.body));
  }),
);
educationRouter.put(
  "/education/questions/:id",
  route(async (req, res) => {
    res.json(await saveQuestion(req, req.body, id.parse(req.params.id)));
  }),
);
educationRouter.get(
  "/education/questions/:id/versions",
  route(async (req, res) => {
    await authorize(req, "questions.write");
    res.json(
      (
        await pool.query(
          "SELECT * FROM education_question_versions WHERE question_id=$1 AND NOT EXISTS(SELECT 1 FROM education_question_versions imported_version WHERE imported_version.question_id=$1 AND imported_version.snapshot->'content' ? 'licensedPackRef') ORDER BY number DESC",
          [id.parse(req.params.id)],
        )
      ).rows,
    );
  }),
);
educationRouter.post(
  "/education/questions/:id/restore",
  route(async (req, res) => {
    const qid = id.parse(req.params.id),
      v = z.object({ number: z.number().int().positive() }).parse(req.body);
    await authorize(req, "questions.write");
    const row = (
      await pool.query(
        "SELECT snapshot FROM education_question_versions WHERE question_id=$1 AND number=$2",
        [qid, v.number],
      )
    ).rows[0];
    if (!row) fail();
    res.json(
      await saveQuestion(req, { ...row.snapshot, status: "draft" }, qid),
    );
  }),
);
educationRouter.post(
  "/education/questions/import",
  route(async (req, res) => {
    const v = z
      .object({
        questions: z.array(questionSchema).min(1).max(100),
        preview: z.boolean().default(true),
      })
      .parse(req.body);
    await authorize(req, "questions.write");
    const seen = new Set<string>(),
      report = [];
    for (const [i, q] of v.questions.entries()) {
      const hash = questionFingerprint(q.text),
        duplicate =
          seen.has(hash) ||
          (
            await pool.query(
              "SELECT 1 FROM education_questions WHERE fingerprint=$1",
              [hash],
            )
          ).rowCount;
      seen.add(hash);
      report.push({ row: i + 1, duplicate: !!duplicate });
    }
    if (v.preview) return void res.json({ rows: report });
    if (report.some((r) => r.duplicate)) fail(409, "يتضمن الملف أسئلة مكررة.");
    await transaction(async (tx) => {
      for (const q of v.questions)
        await saveQuestion(req, { ...q, status: "draft" }, undefined, tx);
    });
    res.status(201).json({ imported: v.questions.length });
  }),
);

educationRouter.get(
  "/education/assignments",
  route(async (req, res) => {
    if (req.auth!.accountType === "student") {
      const member = await enabledMemberships(req, "aptitude");
      await feature(req, "aptitude");
      res.json(
        (
          await pool.query(
            `SELECT a.id,a.title,a.question_ids,a.kind,a.mode,a.starts_at,a.due_at,a.time_limit,c.name AS class_name,(SELECT count(*)::int FROM education_practice_sessions p WHERE p.assignment_id=a.id AND p.user_id=$2 AND p.status='completed') AS completed FROM education_assignments a JOIN teacher_classes c ON c.id=a.class_id WHERE a.class_id=ANY($1::text[]) AND NOT a.archived ORDER BY a.created_at DESC`,
            [member.map((m) => m.class_id), actor(req)],
          )
        ).rows,
      );
      return;
    }
    const cid = id.parse(req.query.classId);
    await classAccess(req, cid);
    res.json(
      (
        await pool.query(
          "SELECT * FROM education_assignments WHERE class_id=$1 ORDER BY created_at DESC",
          [cid],
        )
      ).rows,
    );
  }),
);
educationRouter.post(
  "/education/assignments",
  route(async (req, res) => {
    const v = z
      .object({
        classId: id,
        title: short,
        questionIds: z.array(id).min(1).max(120),
        startsAt: z.string().datetime(),
        dueAt: z.string().datetime().nullable().default(null),
        kind: z.enum(["training", "challenge"]).default("training"),
        mode: z.enum(["learn", "assessed"]).default("learn"),
        timeLimit: z.number().int().min(30).max(14400).nullable().default(null),
      })
      .parse(req.body);
    if (v.dueAt && v.dueAt < v.startsAt) fail(400);
    const aid = createId();
    await transaction(async (q) => {
      const c = await classAccess(req, v.classId, true, q);
      const questions = await q.query(
        `SELECT q.* FROM education_questions q JOIN education_categories cat ON cat.id=q.category_id WHERE ${legacyQuestionScope} AND q.id=ANY($1::text[]) AND q.status='published' AND cat.visible AND NOT cat.archived AND (cat.school_id IS NULL OR cat.school_id=$2) AND (cat.class_id IS NULL OR cat.class_id=$3) AND (cat.stage='' OR cat.stage=$4)`,
        [v.questionIds, c.school_id, v.classId, c.data?.stage || ""],
      );
      await classAction(req, c, "assignments.write", q);
      if (questions.rowCount !== new Set(v.questionIds).size)
        fail(400, "بعض الأسئلة غير منشورة أو غير متاحة للفصل.");
      await q.query(
        "INSERT INTO education_assignments(id,class_id,owner_id,title,question_ids,starts_at,due_at,snapshot,kind,mode,time_limit) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9,$10,$11)",
        [
          aid,
          v.classId,
          actor(req),
          v.title,
          JSON.stringify([...new Set(v.questionIds)]),
          v.startsAt,
          v.dueAt,
          JSON.stringify(questions.rows),
          v.kind,
          v.mode,
          v.timeLimit,
        ],
      );
      await audit(q, req, "assignment.created", aid, c.school_id);
    });
    res.status(201).json({ id: aid });
  }),
);
educationRouter.patch(
  "/education/assignments/:id",
  route(async (req, res) => {
    const aid = id.parse(req.params.id),
      v = z.object({ archived: z.boolean() }).parse(req.body);
    await transaction(async (q) => {
      const a = (
        await q.query("SELECT * FROM education_assignments WHERE id=$1", [aid])
      ).rows[0];
      if (!a) fail();
      const c = await classAccess(req, a.class_id, true, q);
      await q.query(
        "UPDATE education_assignments SET archived=$2 WHERE id=$1",
        [aid, v.archived],
      );
      await classAction(req, c, "assignments.write", q);
      await audit(q, req, "assignment.archived", aid, c.school_id);
    });
    res.json({ success: true });
  }),
);
educationRouter.post(
  "/education/practice",
  route(async (req, res) => {
    await authorize(req, "practice.write");
    await feature(req, "aptitude");
    const member = await enabledMemberships(req, "aptitude"),
      v = z
        .object({
          track: z.enum(["quantitative", "verbal"]),
          categoryId: id.optional(),
          assignmentId: id.optional(),
          mode: z
            .enum(["diagnostic", "skill", "mock", "review"])
            .default("skill"),
          count: z.number().int().min(1).max(120).default(10),
          timeLimit: z
            .number()
            .int()
            .min(30)
            .max(14400)
            .nullable()
            .default(null),
        })
        .parse(req.body);
    let ids: string[] | null = null,
      assigned: any = null;
    if (v.assignmentId) {
      const a = (
        await pool.query(
          "SELECT * FROM education_assignments WHERE id=$1 AND class_id=ANY($2::text[]) AND NOT archived AND starts_at<=now() AND (due_at IS NULL OR due_at>now())",
          [v.assignmentId, member.map((m) => m.class_id)],
        )
      ).rows[0];
      if (!a) fail();
      ids = a.question_ids;
      assigned = a;
    }
    const rows = (
      await pool.query(
        `SELECT q.*,c.track FROM education_questions q JOIN education_categories c ON c.id=q.category_id WHERE ${legacyQuestionScope} AND q.status='published' AND c.visible AND NOT c.archived AND (c.school_id IS NULL OR c.school_id=ANY($1::text[])) AND (c.stage='' OR c.stage=ANY($2::text[])) AND (c.class_id IS NULL OR c.class_id=ANY($10::text[])) AND ($3::text[] IS NOT NULL AND q.id=ANY($3::text[]) OR $3::text[] IS NULL AND c.track=$4 AND ($5='' OR q.category_id=$5)) AND ($6<>'review' OR EXISTS(SELECT 1 FROM education_answers a WHERE a.question_id=q.id AND a.user_id=$7 AND NOT a.correct AND a.created_at<=now()-make_interval(days=>$8))) ORDER BY random() LIMIT $9`,
        [
          member.map((m) => m.school_id),
          member.map((m) => m.class_data?.stage || ""),
          ids,
          v.track,
          v.categoryId || "",
          assigned ? "mock" : v.mode,
          actor(req),
          (await settings()).reviewDays,
          ids?.length || v.count,
          member.map((m) => m.class_id),
        ],
      )
    ).rows;
    if (!rows.length)
      fail(
        409,
        "لا توجد أسئلة منشورة مطابقة. اختر مهارة أخرى أو انتظر نشر المحتوى.",
      );
    if (assigned && rows.length !== ids!.length)
      fail(409, "بعض محتويات المجموعة لم تعد متاحة. راجع معلمك.");
    const frozen =
      assigned && Array.isArray(assigned.snapshot) && assigned.snapshot.length
        ? assigned.snapshot
        : rows;
    const mode = assigned
      ? assigned.mode === "assessed" || assigned.kind === "challenge"
        ? "mock"
        : "skill"
      : v.mode;
    const sid = createId();
    await pool.query(
      "INSERT INTO education_practice_sessions(id,user_id,assignment_id,mode,snapshot,time_limit) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
      [
        sid,
        actor(req),
        v.assignmentId || null,
        mode,
        JSON.stringify(frozen),
        assigned ? assigned.time_limit : v.timeLimit,
      ],
    );
    res.status(201).json({ id: sid });
  }),
);
async function ownedSession(
  req: Request,
  sid: string,
  q: Pick<typeof pool, "query"> = pool,
  lock = false,
) {
  await feature(req, "aptitude", q);
  await authorize(
    req,
    req.method === "GET" ? "practice.read" : "practice.write",
    "",
    q,
  );
  const s = (
    await q.query(
      "SELECT * FROM education_practice_sessions WHERE id=$1 AND user_id=$2" +
        (lock ? " FOR UPDATE" : ""),
      [sid, actor(req)],
    )
  ).rows[0];
  if (!s) fail();
  const member = await enabledMemberships(req, "aptitude", q);
  const visible = await q.query(
    `SELECT q.id FROM education_questions q JOIN education_categories c ON c.id=q.category_id WHERE ${legacyQuestionScope} AND q.id=ANY($1::text[]) AND (c.school_id IS NULL OR c.school_id=ANY($2::text[])) AND (c.class_id IS NULL OR c.class_id=ANY($3::text[])) AND (c.stage='' OR c.stage=ANY($4::text[]))`,
    [
      s.snapshot.map((row: any) => row.id),
      member.map((row) => row.school_id),
      member.map((row) => row.class_id),
      member.map((row) => row.class_data?.stage || ""),
    ],
  );
  if (visible.rowCount !== s.snapshot.length)
    fail(403, "بعض محتوى التدريب لم يعد متاحًا لعضويتك الحالية.");
  if (s.assignment_id) {
    const valid = await q.query(
      `SELECT 1 FROM education_assignments a JOIN education_enrollments e ON e.class_id=a.class_id WHERE a.id=$1 AND e.user_id=$2 AND e.status='active' AND NOT a.archived AND a.class_id=ANY($3::text[])`,
      [s.assignment_id, actor(req), member.map((row) => row.class_id)],
    );
    if (!valid.rowCount) fail();
    if (req.method !== "GET" && req.body?.action !== "complete") {
      const open = await q.query(
        "SELECT 1 FROM education_assignments WHERE id=$1 AND starts_at<=now() AND (due_at IS NULL OR due_at>now())",
        [s.assignment_id],
      );
      if (!open.rowCount)
        fail(
          409,
          "انتهى موعد المجموعة. يمكنك إنهاء التدريب لعرض الإجابات المسجلة.",
        );
    }
  }
  return s;
}
educationRouter.get(
  "/education/practice/:id",
  route(async (req, res) => {
    const s = await ownedSession(req, id.parse(req.params.id)),
      answers = (
        await pool.query(
          "SELECT question_id,selected,correct,seconds FROM education_answers WHERE session_id=$1 AND user_id=$2",
          [s.id, actor(req)],
        )
      ).rows;
    res.json({
      id: s.id,
      mode: s.mode,
      status: s.status,
      timeLimit: s.time_limit,
      elapsed: elapsed(s),
      questions: s.snapshot.map(publicQuestion),
      answers:
        s.status === "completed"
          ? answers
          : answers.map((a) => ({
              question_id: a.question_id,
              selected: a.selected,
            })),
      ...(s.status === "completed"
        ? {
            solutions: s.snapshot.map((q: any) => ({
              id: q.id,
              answer: q.content.answer,
              explanation: q.content.explanation,
              options: q.content.options,
            })),
            score: {
              correct: answers.filter((a) => a.correct).length,
              total: s.snapshot.length,
            },
          }
        : {}),
    });
  }),
);
educationRouter.post(
  "/education/practice/:id/answer",
  route(async (req, res) => {
    const sid = id.parse(req.params.id),
      v = z
        .object({
          questionId: id,
          selected: z.number().int().min(0).max(5),
          seconds: z.number().int().min(0).max(14400),
        })
        .parse(req.body);
    await transaction(async (q) => {
      const s = await ownedSession(req, sid, q, true);
      if (s.status !== "active" || (s.time_limit && elapsed(s) > s.time_limit))
        fail(409, "الجلسة موقوفة أو انتهى الوقت. أنهِ الاختبار لعرض النتيجة.");
      const question = s.snapshot.find((x: any) => x.id === v.questionId);
      if (!question || v.selected >= question.content.options.length) fail(400);
      const previous = (
        await q.query(
          "SELECT selected FROM education_answers WHERE session_id=$1 AND question_id=$2",
          [sid, v.questionId],
        )
      ).rows[0];
      if (previous) {
        if (previous.selected !== v.selected) fail(409, "تم تسجيل الإجابة.");
        res.json({ saved: true });
        return;
      }
      const correct = v.selected === question.content.answer;
      const measured = (
        await q.query(
          "SELECT coalesce(sum(seconds),0)::int AS used FROM education_answers WHERE session_id=$1",
          [sid],
        )
      ).rows[0].used;
      await q.query(
        "INSERT INTO education_answers(id,session_id,question_id,user_id,category_id,selected,correct,seconds) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          createId(),
          sid,
          v.questionId,
          actor(req),
          question.category_id,
          v.selected,
          correct,
          Math.max(0, elapsed(s) - measured),
        ],
      );
      res.json({
        saved: true,
        ...(["skill", "review"].includes(s.mode)
          ? {
              correct,
              answer: question.content.answer,
              explanation: question.content.explanation,
              optionExplanation:
                question.content.options[v.selected].explanation,
            }
          : {}),
      });
    });
  }),
);
educationRouter.patch(
  "/education/practice/:id",
  route(async (req, res) => {
    const sid = id.parse(req.params.id),
      v = z
        .object({ action: z.enum(["pause", "resume", "complete"]) })
        .parse(req.body);
    await transaction(async (q) => {
      const s = await ownedSession(req, sid, q, true);
      if (s.status === "completed") return;
      const seconds = elapsed(s);
      if (v.action === "pause" && s.time_limit)
        fail(409, "الاختبار الزمني لا يُوقف.");
      let status =
        v.action === "pause"
          ? "paused"
          : v.action === "complete"
            ? "completed"
            : "active";
      if (s.time_limit && seconds >= s.time_limit) status = "completed";
      await q.query(
        `UPDATE education_practice_sessions SET status=$2,active_seconds=$3,resumed_at=now(),completed_at=CASE WHEN $2='completed' THEN now() ELSE NULL END WHERE id=$1`,
        [sid, status, seconds],
      );
    });
    res.json({ success: true });
  }),
);
async function progress(uid: string, classId: string | null = null) {
  const permitted = `($2::text IS NULL OR EXISTS(SELECT 1 FROM education_practice_sessions p LEFT JOIN education_assignments ass ON ass.id=p.assignment_id JOIN education_categories category ON category.id=a.category_id WHERE p.id=a.session_id AND ((p.assignment_id IS NOT NULL AND ass.class_id=$2) OR (p.assignment_id IS NULL AND (category.school_id IS NULL OR category.school_id=(SELECT school_id FROM education_school_classes WHERE class_id=$2)) AND (category.class_id IS NULL OR category.class_id=$2)))))`;
  const skills = (
    await pool.query(
      `SELECT c.id,c.name,c.track,count(*)::int AS attempts,count(*) FILTER(WHERE a.correct)::int AS correct,round(avg(a.seconds),1) AS average_seconds FROM education_answers a JOIN education_categories c ON c.id=a.category_id WHERE a.user_id=$1 AND ${permitted} GROUP BY c.id ORDER BY c.position,c.name`,
      [uid, classId],
    )
  ).rows;
  const timeline = (
    await pool.query(
      `SELECT to_char(a.created_at,'YYYY-MM-DD') AS day,count(*)::int AS attempts,count(*) FILTER(WHERE a.correct)::int AS correct FROM education_answers a WHERE user_id=$1 AND ${permitted} GROUP BY day ORDER BY day`,
      [uid, classId],
    )
  ).rows;
  const sessions = (
    await pool.query(
      `SELECT p.id,p.mode,p.status,p.time_limit,p.created_at,p.completed_at FROM education_practice_sessions p WHERE p.user_id=$1 AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM education_answers a WHERE a.session_id=p.id AND ${permitted})) ORDER BY p.created_at DESC LIMIT 100`,
      [uid, classId],
    )
  ).rows;
  const recent = (
    await pool.query(
      `SELECT a.category_id,a.correct,a.created_at FROM education_answers a WHERE a.user_id=$1 AND ${permitted} ORDER BY a.created_at DESC LIMIT 3000`,
      [uid, classId],
    )
  ).rows;
  return {
    skills: skills.map((s) => {
      const current = recent.filter((a) => a.category_id === s.id).slice(0, 5),
        previous = recent.filter((a) => a.category_id === s.id).slice(5, 10);
      return {
        ...s,
        accuracy: Math.round((s.correct * 100) / s.attempts),
        level:
          s.attempts < 5
            ? "insufficient"
            : s.correct / s.attempts >= 0.8
              ? "mastered"
              : "review",
        reason:
          s.attempts < 5
            ? "تحتاج المهارة محاولات إضافية قبل وصف مستوى الإتقان."
            : `${s.correct} إجابات صحيحة من ${s.attempts} محاولات فعلية.`,
        recentAccuracy:
          current.length === 5
            ? Math.round((current.filter((a) => a.correct).length * 100) / 5)
            : null,
        previousAccuracy:
          previous.length === 5
            ? Math.round((previous.filter((a) => a.correct).length * 100) / 5)
            : null,
      };
    }),
    timeline,
    sessions,
  };
}
educationRouter.get(
  "/education/progress",
  route(async (req, res) => {
    await authorize(req, "practice.read");
    await studentAccess(req);
    res.json(await progress(actor(req)));
  }),
);
educationRouter.get(
  "/education/student-home",
  route(async (req, res) => {
    await feature(req, "studentRoom");
    const member = await enabledMemberships(req, "studentRoom");
    const classes = member.map((m) => m.class_id);
    const tasks = (
      await pool.query(
        `SELECT r.id,r.class_id,r.data,c.name AS class_name FROM teacher_records r JOIN teacher_classes c ON c.id=r.class_id WHERE r.class_id=ANY($1::text[]) AND r.kind='tasks' AND r.data->>'kind'='assignment' AND NOT r.archived ORDER BY r.created_at DESC LIMIT 50`,
        [classes],
      )
    ).rows;
    const activities = (
      await pool.query(
        `SELECT a.id,v.content->>'title' AS title,a.due_at,a.class_id,e.id AS enrollment_id FROM teacher_activity_assignments a JOIN teacher_activity_versions v ON v.id=a.version_id JOIN education_enrollments e ON e.class_id=a.class_id AND e.user_id=$2 AND e.status='active' WHERE a.class_id=ANY($1::text[]) AND NOT a.archived ORDER BY a.created_at DESC`,
        [classes, actor(req)],
      )
    ).rows;
    const announcements = (
      await pool.query(
        "SELECT id,title,body,created_at FROM education_announcements WHERE class_id=ANY($1::text[]) AND NOT archived ORDER BY created_at DESC LIMIT 50",
        [classes],
      )
    ).rows;
    res.json({
      memberships: member,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.data.title,
        dueAt: t.data.dueAt,
        status: t.data.studentCompletion?.includes(
          member.find((m) => m.class_id === t.class_id)?.roster_id,
        )
          ? "completed"
          : "pending",
        className: t.class_name,
      })),
      activities,
      announcements,
      progress: await progress(actor(req)),
    });
  }),
);
educationRouter.get(
  "/education/personal",
  route(async (req, res) => {
    await studentAccess(req);
    res.json(
      (
        await pool.query(
          `SELECT p.id,p.kind,p.question_id,p.data,p.created_at,q.text FROM education_personal p LEFT JOIN education_questions q ON q.id=p.question_id WHERE p.user_id=$1 AND NOT p.archived AND p.kind<>'teacher-note' ORDER BY p.updated_at DESC`,
          [actor(req)],
        )
      ).rows,
    );
  }),
);
const personalSchema = z.object({
  kind: z.enum(["mistake", "bookmark", "goal", "plan", "teacher-note"]),
  questionId: id.nullable().default(null),
  userId: id.optional(),
  data: z.object({
    title: z.string().max(200).default(""),
    note: prose.default(""),
    cause: z
      .enum(["concept", "calculation", "reading", "time", "other"])
      .default("other"),
    target: z.number().int().min(1).max(500).default(10),
    dueAt: z.string().datetime().nullable().default(null),
    dailyMinutes: z.number().int().min(5).max(240).default(20),
    steps: z.array(short).max(30).default([]),
    completed: z.boolean().default(false),
    buildSchedule: z.boolean().default(true),
  }),
});
educationRouter.post(
  "/education/personal",
  route(async (req, res) => {
    const v = personalSchema.parse(req.body),
      uid = v.userId || actor(req);
    if (uid === actor(req)) {
      await authorize(req, "personal.write");
      await studentAccess(req);
      if (v.kind === "teacher-note") fail(403);
    } else {
      const e = (
        await pool.query(
          `SELECT class_id FROM education_enrollments WHERE user_id=$1 AND status='active'`,
          [uid],
        )
      ).rows;
      let allowed = false;
      for (const row of e) {
        try {
          const c = await classAccess(req, row.class_id, true);
          await classAction(req, c, "plans.write");
          allowed = true;
          break;
        } catch {}
      }
      if (!allowed || !["plan", "teacher-note"].includes(v.kind)) fail(403);
    }
    if (v.questionId) {
      const m = await memberships(req);
      const question = (
        await pool.query(
          `SELECT q.* FROM education_questions q JOIN education_categories c ON c.id=q.category_id WHERE ${legacyQuestionScope} AND q.id=$1 AND q.status='published' AND c.visible AND NOT c.archived AND (c.school_id IS NULL OR c.school_id=ANY($2::text[])) AND (c.class_id IS NULL OR c.class_id=ANY($3::text[]))`,
          [v.questionId, m.map((x) => x.school_id), m.map((x) => x.class_id)],
        )
      ).rows[0];
      if (!question || !question.content.allowSave) fail();
      if (
        v.kind === "mistake" &&
        !(
          await pool.query(
            "SELECT 1 FROM education_answers WHERE user_id=$1 AND question_id=$2 AND NOT correct",
            [uid, v.questionId],
          )
        ).rowCount
      )
        fail(400, "دفتر الأخطاء يعتمد على إجابة فعلية غير صحيحة.");
    }
    if (v.kind === "goal" && v.data.dueAt && v.data.buildSchedule) {
      const days = Math.ceil(
        (new Date(v.data.dueAt).getTime() - Date.now()) / 86400000,
      );
      if (days <= 0) fail(400, "حدد موعدًا قادمًا للهدف.");
      const actual = await progress(uid),
        weak = actual.skills
          .filter((s) => s.level === "review")
          .sort((a, b) => a.accuracy - b.accuracy)
          .map((s) => s.name);
      const read = Math.max(1, Math.floor(v.data.dailyMinutes * 0.3)),
        review = Math.max(1, Math.floor(v.data.dailyMinutes * 0.2)),
        practice = v.data.dailyMinutes - read - review;
      v.data.steps = Array.from(
        { length: Math.min(30, days) },
        (_, i) =>
          `اليوم ${i + 1}: ${weak.length ? weak[i % weak.length] : "المهارة التي تختارها"} — فهم الشرح ${read} دقائق، تدريب ${practice} دقائق، مراجعة ${review} دقائق.`,
      );
    }
    const pid = createId();
    await pool.query(
      "INSERT INTO education_personal(id,user_id,author_id,kind,question_id,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
      [pid, uid, actor(req), v.kind, v.questionId, JSON.stringify(v.data)],
    );
    res.status(201).json({ id: pid });
  }),
);
educationRouter.patch(
  "/education/personal/:id",
  route(async (req, res) => {
    const pid = id.parse(req.params.id),
      v = z
        .object({
          archived: z.boolean().optional(),
          completed: z.boolean().optional(),
          note: prose.optional(),
          data: z
            .object({
              title: z.string().max(200).optional(),
              note: prose.optional(),
              target: z.number().int().min(1).max(500).optional(),
              dailyMinutes: z.number().int().min(5).max(240).optional(),
              dueAt: z.string().datetime().nullable().optional(),
              steps: z.array(short).max(30).optional(),
              completed: z.boolean().optional(),
            })
            .optional(),
        })
        .parse(req.body);
    const p = (
      await pool.query(
        "SELECT * FROM education_personal WHERE id=$1 AND user_id=$2 AND kind<>'teacher-note'",
        [pid, actor(req)],
      )
    ).rows[0];
    if (!p) fail();
    await authorize(req, "personal.write");
    await studentAccess(req);
    await pool.query(
      "UPDATE education_personal SET data=$2::jsonb,archived=$3,updated_at=now() WHERE id=$1",
      [
        pid,
        JSON.stringify({
          ...p.data,
          ...v.data,
          ...(v.completed === undefined ? {} : { completed: v.completed }),
          ...(v.note === undefined ? {} : { note: v.note }),
        }),
        v.archived ?? p.archived,
      ],
    );
    res.json({ success: true });
  }),
);
educationRouter.get(
  "/education/reports",
  route(async (req, res) => {
    const cid = id.parse(req.query.classId);
    const c = await classAccess(req, cid);
    await classAction(req, c, "reports.read");
    const students = (
      await pool.query(
        `SELECT e.user_id,e.roster_id,u.name,e.status FROM education_enrollments e JOIN users u ON u.id=e.user_id WHERE e.class_id=$1 AND e.status='active'`,
        [cid],
      )
    ).rows;
    const rows = await Promise.all(
      students.map(async (s) => ({
        ...s,
        ...(await progress(s.user_id, cid)),
      })),
    );
    await audit(pool, req, "report.viewed", cid);
    res.json(rows);
  }),
);
educationRouter.get(
  "/education/student/:id/followup",
  route(async (req, res) => {
    const uid = id.parse(req.params.id),
      cid = id.parse(req.query.classId);
    const c = await classAccess(req, cid, true);
    await classAction(req, c, "reports.read");
    if (
      !(
        await pool.query(
          "SELECT 1 FROM education_enrollments WHERE user_id=$1 AND class_id=$2 AND status='active'",
          [uid, cid],
        )
      ).rowCount
    )
      fail();
    res.json({
      progress: await progress(uid, cid),
      plans: (
        await pool.query(
          "SELECT * FROM education_personal WHERE user_id=$1 AND kind IN ('plan','teacher-note') AND author_id=$2 AND NOT archived",
          [uid, actor(req)],
        )
      ).rows,
    });
  }),
);
educationRouter.post(
  "/education/announcements",
  route(async (req, res) => {
    const v = z
      .object({
        classId: id,
        title: short,
        body: prose.refine((x) => x.length > 0),
      })
      .parse(req.body);
    if (
      /https?:\/\/|\b\d{10}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(
        v.body,
      )
    )
      fail(
        400,
        "الإعلان تعليمي؛ تجنب بيانات الاتصال الشخصية والروابط الخارجية.",
      );
    const aid = createId();
    await transaction(async (q) => {
      const c = await classAccess(req, v.classId, true, q);
      await q.query(
        "INSERT INTO education_announcements(id,class_id,author_id,title,body) VALUES($1,$2,$3,$4,$5)",
        [aid, v.classId, actor(req), v.title, v.body],
      );
      await classAction(req, c, "announcements.write", q);
      await audit(q, req, "announcement.created", aid, c.school_id);
    });
    res.status(201).json({ id: aid });
  }),
);
educationRouter.get(
  "/education/announcements",
  route(async (req, res) => {
    const cid = id.parse(req.query.classId);
    await classAccess(req, cid);
    res.json(
      (
        await pool.query(
          "SELECT * FROM education_announcements WHERE class_id=$1 ORDER BY created_at DESC",
          [cid],
        )
      ).rows,
    );
  }),
);
educationRouter.patch(
  "/education/announcements/:id",
  route(async (req, res) => {
    const aid = id.parse(req.params.id),
      v = z.object({ archived: z.boolean() }).parse(req.body);
    await transaction(async (q) => {
      const a = (
        await q.query("SELECT * FROM education_announcements WHERE id=$1", [
          aid,
        ])
      ).rows[0];
      if (!a) fail();
      const c = await classAccess(req, a.class_id, true, q);
      await q.query(
        "UPDATE education_announcements SET archived=$2 WHERE id=$1",
        [aid, v.archived],
      );
      await classAction(req, c, "announcements.write", q);
      await audit(q, req, "announcement.archived", aid, c.school_id);
    });
    res.json({ success: true });
  }),
);
educationRouter.get(
  "/education/help",
  route(async (req, res) => {
    const support = root(req) || (await permission(req, "help.read"));
    res.json(
      (
        await pool.query(
          `SELECT id,kind,title,body,response,status,role,created_at FROM education_help WHERE (kind='faq' AND status='published' AND (role='all' OR role=$2)) OR owner_id=$1 OR ($3 AND kind='ticket') ORDER BY created_at DESC`,
          [actor(req), req.auth!.accountType, support],
        )
      ).rows,
    );
  }),
);
educationRouter.post(
  "/education/help",
  route(async (req, res) => {
    const v = z
      .object({
        kind: z.enum(["faq", "ticket"]),
        title: short,
        body: prose,
        role: z.enum(["all", "teacher", "student"]).default("all"),
        status: z.enum(["open", "draft", "published"]).default("open"),
      })
      .parse(req.body);
    if (v.kind === "faq") await authorize(req, "faq.write");
    else if (req.auth!.accountType === "student")
      await authorize(req, "help.write");
    const hid = createId();
    await pool.query(
      "INSERT INTO education_help(id,kind,owner_id,title,body,role,status) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        hid,
        v.kind,
        actor(req),
        v.title,
        v.body,
        v.role,
        v.kind === "ticket" ? "open" : v.status,
      ],
    );
    res.status(201).json({ id: hid });
  }),
);
educationRouter.patch(
  "/education/help/:id",
  route(async (req, res) => {
    const hid = id.parse(req.params.id),
      v = z
        .object({
          status: z.enum(["open", "resolved", "published", "archived"]),
          response: prose,
        })
        .parse(req.body);
    const h = (
      await pool.query("SELECT kind FROM education_help WHERE id=$1", [hid])
    ).rows[0];
    if (!h) fail();
    await authorize(req, h.kind === "faq" ? "faq.write" : "help.read");
    await transaction(async (q) => {
      await q.query(
        "UPDATE education_help SET status=$2,response=$3,updated_at=now() WHERE id=$1",
        [hid, v.status, v.response],
      );
      await audit(q, req, "help.updated", hid);
    });
    res.json({ success: true });
  }),
);
const settingsSchema = z.object({
  platformName: short,
  description: prose,
  registration: z.boolean(),
  maintenance: z.boolean(),
  aptitude: z.boolean(),
  studentRoom: z.boolean(),
  teacherRoom: z.boolean(),
  comments: z.literal(false),
  teacherJoinCodes: z.boolean(),
  contentReview: z.boolean(),
  codeMaxUses: z.number().int().min(1).max(5000),
  codeDays: z.number().int().min(1).max(365),
  reviewDays: z.number().int().min(0).max(90),
  uploadMaxMb: z.number().int().min(1).max(8),
  supportLink: z.union([
    z.literal(""),
    z
      .string()
      .url()
      .refine((v) => v.startsWith("https://")),
  ]),
  retentionDays: z.number().int().min(30).max(3650),
  inactivityDays: z.number().int().min(3).max(90).default(14),
});
educationRouter.get(
  "/education/settings",
  route(async (req, res) => {
    const scope = String(req.query.scope || "");
    if (scope) await schoolAccess(req, id.parse(scope));
    else if (!root(req)) fail(403);
    res.json(await settings(scope));
  }),
);
educationRouter.put(
  "/education/settings",
  route(async (req, res) => {
    const scope = String(req.query.scope || "");
    if (scope) await schoolAccess(req, id.parse(scope), true);
    else if (!root(req)) fail(403);
    const v = settingsSchema.parse(req.body);
    await transaction(async (q) => {
      await q.query(
        "INSERT INTO education_settings(scope,data) VALUES($1,$2::jsonb) ON CONFLICT(scope) DO UPDATE SET data=EXCLUDED.data,updated_at=now()",
        [scope, JSON.stringify(v)],
      );
      await audit(
        q,
        req,
        "settings.updated",
        scope || "platform",
        scope || null,
      );
    });
    res.json(v);
  }),
);
educationRouter.get(
  "/education/audit",
  route(async (req, res) => {
    const scope = String(req.query.schoolId || "");
    if (scope) await authorize(req, "audit.read", id.parse(scope));
    else await authorize(req, "audit.read");
    res.json(
      (
        await pool.query(
          `SELECT a.id,a.action,a.summary,a.created_at,a.details,a.user_id FROM audit_logs a WHERE a.action LIKE 'education.%' AND ($1='' OR a.details->>'schoolId'=$1) ORDER BY a.created_at DESC LIMIT 300`,
          [scope],
        )
      ).rows,
    );
  }),
);
educationRouter.get(
  "/education/overview",
  route(async (req, res) => {
    if (!root(req)) fail(403);
    const days = z.coerce
      .number()
      .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
      .parse(req.query.days || 30);
    const counts = (
      await pool.query(
        `SELECT (SELECT count(*)::int FROM education_schools WHERE status='active') AS schools,(SELECT count(*)::int FROM users WHERE account_type='teacher' AND NOT is_deleted) AS teachers,(SELECT count(*)::int FROM users WHERE account_type='student' AND NOT is_deleted) AS students,(SELECT count(*)::int FROM users WHERE suspended AND NOT is_deleted) AS suspended,(SELECT count(*)::int FROM education_enrollments WHERE status='pending') AS pending,(SELECT count(*)::int FROM education_join_codes WHERE status='active' AND expires_at>now() AND used_count<max_uses) AS codes,(SELECT count(*)::int FROM education_join_codes WHERE expires_at<=now()) AS expired_codes,(SELECT count(*)::int FROM teacher_classes WHERE NOT archived) AS classes,(SELECT count(*)::int FROM teacher_records WHERE kind='tasks' AND NOT archived) AS tasks,(SELECT count(*)::int FROM teacher_activities) AS activities,(SELECT count(*)::int FROM education_questions WHERE status='published') AS questions,(SELECT count(*)::int FROM education_practice_sessions WHERE status='completed') AS completed_sessions,(SELECT count(*)::int FROM education_help WHERE kind='ticket' AND status='open') AS open_tickets`,
      )
    ).rows[0];
    res.json({
      counts,
      days,
      recent: (
        await pool.query(
          "SELECT id,action,created_at,details FROM audit_logs WHERE action LIKE 'education.%' ORDER BY created_at DESC LIMIT 10",
        )
      ).rows,
      activity: (
        await pool.query(
          `SELECT to_char(created_at,'YYYY-MM-DD') AS day,count(*)::int AS actions FROM audit_logs WHERE action LIKE 'education.%' AND created_at>now()-make_interval(days=>$1) GROUP BY day ORDER BY day`,
          [days],
        )
      ).rows,
    });
  }),
);
educationRouter.get(
  "/education/teacher-summary",
  route(async (req, res) => {
    if (req.auth!.accountType !== "teacher" && !root(req)) fail(403);
    const config = await settings();
    const pending = (
      await pool.query(
        "SELECT count(*)::int AS count FROM education_enrollments e JOIN teacher_classes c ON c.id=e.class_id WHERE c.owner_id=$1 AND e.status='pending' AND NOT c.archived",
        [actor(req)],
      )
    ).rows[0].count;
    const upcoming = (
      await pool.query(
        "SELECT a.id,a.title,a.due_at,c.name AS class_name FROM education_assignments a JOIN teacher_classes c ON c.id=a.class_id WHERE c.owner_id=$1 AND NOT a.archived AND a.due_at>now() ORDER BY a.due_at LIMIT 5",
        [actor(req)],
      )
    ).rows;
    const alerts = (
      await pool.query(
        `SELECT e.id,u.name,c.name AS class_name,max(a.created_at) AS last_attempt FROM education_enrollments e JOIN teacher_classes c ON c.id=e.class_id JOIN users u ON u.id=e.user_id JOIN education_answers a ON a.user_id=e.user_id WHERE c.owner_id=$1 AND e.status='active' AND NOT c.archived GROUP BY e.id,u.name,c.name HAVING max(a.created_at)<now()-make_interval(days=>$2)`,
        [actor(req), config.inactivityDays],
      )
    ).rows;
    res.json({
      pending,
      upcoming,
      alerts,
      inactivityDays: config.inactivityDays,
    });
  }),
);
