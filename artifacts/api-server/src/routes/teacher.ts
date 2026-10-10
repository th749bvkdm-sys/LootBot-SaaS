import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { pool, type PoolClient } from "@workspace/db";
import {
  requireAuth,
  requireCsrf,
  requireTeacher,
} from "../lib/auth-middleware";
import { createId } from "../lib/security";
import {
  attendanceSchema,
  examSchema,
  importSchema,
  normalizeInternalId,
  normalizeStudentName,
  ruleSchema,
  safeCsvCell,
  teacherClassSchema,
  teacherProfileSchema,
  teacherRecordSchemas,
  teacherStudentSchema,
  validateTeacherImage,
} from "../lib/teacher-validation";
import { extractTeacherImage } from "../lib/teacher-ocr";
import { runTeacherRules, nextTeacherRun } from "../lib/teacher-worker";

export const teacherRouter = Router();
teacherRouter.use(
  "/teacher",
  requireAuth,
  requireTeacher,
  (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  },
);
teacherRouter.use("/teacher", (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method))
    requireCsrf(req, res, next);
  else next();
});
const uuid = z.string().uuid();
const owner = (req: Parameters<RequestHandler>[0]) => req.auth!.userId;
const pathId = (req: Parameters<RequestHandler>[0]) => String(req.params.id);
function fail(
  res: Parameters<RequestHandler>[1],
  status = 400,
  message = "تحقق من البيانات المدخلة.",
) {
  res.status(status).json({ error: message });
}
const route =
  (handler: RequestHandler): RequestHandler =>
  async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      const pgError = error as { code?: string };
      if (["23505", "23503", "23514", "22P02"].includes(pgError.code || "")) {
        fail(
          res,
          409,
          "تعارض في البيانات. راجع الرقم الداخلي والفصل والسجل ثم حاول مجددًا.",
        );
        return;
      }
      next(error);
    }
  };
type Queryable = Pick<PoolClient, "query">;
async function exists(
  q: Queryable,
  table: "teacher_classes" | "teacher_students" | "teacher_assets",
  id: string,
  ownerId: string,
) {
  if (!uuid.safeParse(id).success) return false;
  return Boolean(
    (
      await q.query(`SELECT id FROM ${table} WHERE id=$1 AND owner_id=$2`, [
        id,
        ownerId,
      ])
    ).rowCount,
  );
}
function common(row: Record<string, unknown>) {
  return {
    id: row.id,
    ...(row.data as Record<string, unknown>),
    ...(row.class_id !== undefined ? { classId: row.class_id } : {}),
    ...(row.student_id ? { studentId: row.student_id } : {}),
    archived: row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function student(row: Record<string, unknown>) {
  return {
    id: row.id,
    classId: row.class_id,
    name: row.name,
    internalId: row.internal_id,
    notes: row.notes,
    archived: row.archived,
    removed: row.removed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function exam(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    document: row.document,
    sourceAssetId: row.source_asset_id,
    version: row.version,
    isTemplate: row.is_template,
    archived: row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function rule(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    config: row.config,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastResult: row.last_result,
    error: row.error,
  };
}
function reminder(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    read: row.read,
    createdAt: row.created_at,
    ruleId: row.rule_id,
  };
}

teacherRouter.get(
  "/teacher/profile",
  route(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT data,complete FROM teacher_profiles WHERE owner_id=$1",
      [owner(req)],
    );
    res.json(
      teacherProfileSchema.parse({
        ...rows[0]?.data,
        complete: rows[0]?.complete ?? false,
      }),
    );
  }),
);
teacherRouter.put(
  "/teacher/profile",
  route(async (req, res) => {
    const parsed = teacherProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(
        res,
        400,
        parsed.error.issues[0]?.message ===
          "اسم المعلم والمدرسة مطلوبان لإتمام الإعداد"
          ? parsed.error.issues[0].message
          : "تحقق من معلومات المعلم والمدرسة.",
      );
      return;
    }
    if (
      parsed.data.logoAssetId &&
      !(await exists(
        pool,
        "teacher_assets",
        parsed.data.logoAssetId,
        owner(req),
      ))
    ) {
      fail(res, 400, "صورة المدرسة غير موجودة.");
      return;
    }
    await pool.query(
      "INSERT INTO teacher_profiles(owner_id,data,complete) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET data=$2,complete=$3,updated_at=now()",
      [owner(req), JSON.stringify(parsed.data), parsed.data.complete],
    );
    res.json(parsed.data);
  }),
);

teacherRouter.get(
  "/teacher/classes",
  route(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM teacher_classes WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 500",
      [owner(req)],
    );
    res.json(rows.map(common));
  }),
);
teacherRouter.post(
  "/teacher/classes",
  route(async (req, res) => {
    const p = teacherClassSchema.safeParse(req.body);
    if (!p.success) {
      fail(res);
      return;
    }
    const { rows } = await pool.query(
      "INSERT INTO teacher_classes(id,owner_id,name,data,archived) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [
        createId(),
        owner(req),
        p.data.name,
        JSON.stringify(p.data),
        p.data.archived,
      ],
    );
    res.status(201).json(common(rows[0]));
  }),
);
teacherRouter.put(
  "/teacher/classes/:id",
  route(async (req, res) => {
    const p = teacherClassSchema.safeParse(req.body);
    if (!p.success || !uuid.safeParse(pathId(req)).success) {
      fail(res);
      return;
    }
    const { rows } = await pool.query(
      "UPDATE teacher_classes SET name=$3,data=$4,archived=$5,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *",
      [
        pathId(req),
        owner(req),
        p.data.name,
        JSON.stringify(p.data),
        p.data.archived,
      ],
    );
    if (!rows[0]) {
      fail(res, 404, "الفصل غير موجود.");
      return;
    }
    res.json(common(rows[0]));
  }),
);
teacherRouter.delete(
  "/teacher/classes/:id",
  route(async (req, res) => {
    const { rowCount } = await pool.query(
      "UPDATE teacher_classes SET archived=true,data=jsonb_set(data,'{archived}','true'),updated_at=now() WHERE id=$1 AND owner_id=$2",
      [pathId(req), owner(req)],
    );
    if (!rowCount) {
      fail(res, 404, "الفصل غير موجود.");
      return;
    }
    res.json({ ok: true });
  }),
);

teacherRouter.get(
  "/teacher/students",
  route(async (req, res) => {
    const classId =
      typeof req.query.classId === "string" ? req.query.classId : null;
    const { rows } = await pool.query(
      "SELECT * FROM teacher_students WHERE owner_id=$1 AND ($2::text IS NULL OR class_id=$2) AND (removed=false OR $3::boolean=true) ORDER BY name LIMIT 5000",
      [owner(req), classId, req.query.archived === "true"],
    );
    res.json(rows.map(student));
  }),
);
teacherRouter.post(
  "/teacher/students/search",
  route(async (req, res) => {
    const p = z
      .object({
        classId: uuid.optional(),
        search: z.string().max(200).optional().default(""),
        archived: z.boolean().optional(),
        page: z.number().int().min(1).max(10000).default(1),
        pageSize: z.number().int().min(1).max(100).default(30),
        sort: z.enum(["name", "newest", "internalId"]).default("name"),
      })
      .safeParse(req.body);
    if (!p.success) {
      fail(res);
      return;
    }
    const { classId, search, archived, page, pageSize, sort } = p.data;
    const params = [owner(req), classId ?? null, search, archived ?? null];
    const where =
      "owner_id=$1 AND ($2::text IS NULL OR class_id=$2) AND ($3='' OR position(lower($3) in lower(name))>0 OR position($3 in internal_id)>0) AND ($4::boolean IS NULL OR archived=$4) AND (removed=false OR $4::boolean=true)";
    const [counts, items] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS total FROM teacher_students WHERE ${where}`,
        params,
      ),
      pool.query(
        `SELECT * FROM teacher_students WHERE ${where} ORDER BY ${sort === "newest" ? "created_at DESC" : sort === "internalId" ? "internal_id,name" : "name"} LIMIT $5 OFFSET $6`,
        [...params, pageSize, (page - 1) * pageSize],
      ),
    ]);
    res.json({
      items: items.rows.map(student),
      total: counts.rows[0].total,
      page,
      pageSize,
    });
  }),
);
teacherRouter.post(
  "/teacher/students",
  route(async (req, res) => {
    const p = teacherStudentSchema.safeParse(req.body);
    if (!p.success) {
      fail(res);
      return;
    }
    if (!(await exists(pool, "teacher_classes", p.data.classId, owner(req)))) {
      fail(res, 404, "الفصل غير موجود.");
      return;
    }
    const { rows } = await pool.query(
      "INSERT INTO teacher_students(id,owner_id,class_id,name,internal_id,notes,archived) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [
        createId(),
        owner(req),
        p.data.classId,
        p.data.name,
        normalizeInternalId(p.data.internalId),
        p.data.notes,
        p.data.archived,
      ],
    );
    res.status(201).json(student(rows[0]));
  }),
);
teacherRouter.put(
  "/teacher/students/:id",
  route(async (req, res) => {
    const p = teacherStudentSchema.safeParse(req.body);
    if (!p.success) {
      fail(res);
      return;
    }
    if (!(await exists(pool, "teacher_classes", p.data.classId, owner(req)))) {
      fail(res, 404, "الفصل غير موجود.");
      return;
    }
    const { rows } = await pool.query(
      "UPDATE teacher_students SET class_id=$3,name=$4,internal_id=$5,notes=$6,archived=$7,removed=$8,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *",
      [
        pathId(req),
        owner(req),
        p.data.classId,
        p.data.name,
        normalizeInternalId(p.data.internalId),
        p.data.notes,
        p.data.archived,
        p.data.removed,
      ],
    );
    if (!rows[0]) {
      fail(res, 404, "الطالب غير موجود.");
      return;
    }
    res.json(student(rows[0]));
  }),
);
teacherRouter.delete(
  "/teacher/students/:id",
  route(async (req, res) => {
    const { rowCount } = await pool.query(
      "UPDATE teacher_students SET removed=true,archived=true,updated_at=now() WHERE id=$1 AND owner_id=$2",
      [pathId(req), owner(req)],
    );
    if (!rowCount) {
      fail(res, 404, "الطالب غير موجود.");
      return;
    }
    res.json({ ok: true, recoverable: true });
  }),
);
teacherRouter.get(
  "/teacher/students/:id/profile",
  route(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM teacher_students WHERE id=$1 AND owner_id=$2",
      [pathId(req), owner(req)],
    );
    if (!rows[0]) {
      fail(res, 404, "الطالب غير موجود.");
      return;
    }
    const records = await pool.query(
      "SELECT * FROM teacher_records WHERE student_id=$1 AND owner_id=$2 ORDER BY created_at DESC LIMIT 1000",
      [pathId(req), owner(req)],
    );
    const tasks = await pool.query(
      "SELECT * FROM teacher_records WHERE owner_id=$1 AND kind='tasks' AND archived=false AND data->>'kind'='assignment' AND (class_id=$3 OR data->'studentCompletion' ? $2) ORDER BY created_at DESC LIMIT 100",
      [owner(req), pathId(req), rows[0].class_id],
    );
    res.json({
      student: student(rows[0]),
      attendance: records.rows
        .filter((r) => r.kind === "attendance")
        .map(common),
      grades: records.rows.filter((r) => r.kind === "grades").map(common),
      assignments: tasks.rows.map(common),
    });
  }),
);
teacherRouter.post(
  "/teacher/students/bulk",
  route(async (req, res) => {
    const p = z
      .object({
        ids: z.array(uuid).min(1).max(500),
        action: z.enum(["archive", "restore", "remove", "move"]),
        classId: uuid.optional(),
        confirm: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!p.success) {
      fail(res);
      return;
    }
    if (["remove", "move"].includes(p.data.action) && !p.data.confirm) {
      fail(res, 400, "أكد العملية أولًا.");
      return;
    }
    if (
      p.data.action === "move" &&
      (!p.data.classId ||
        !(await exists(pool, "teacher_classes", p.data.classId, owner(req))))
    ) {
      fail(res, 404, "الفصل غير موجود.");
      return;
    }
    const expression =
      p.data.action === "move"
        ? "class_id=$3"
        : p.data.action === "restore"
          ? "archived=false,removed=false"
          : p.data.action === "remove"
            ? "archived=true,removed=true"
            : "archived=true";
    const { rowCount } = await pool.query(
      `UPDATE teacher_students SET ${expression},updated_at=now() WHERE owner_id=$1 AND id=ANY($2::text[])`,
      [
        owner(req),
        p.data.ids,
        ...(p.data.action === "move" ? [p.data.classId] : []),
      ],
    );
    res.json({ ok: true, changed: rowCount });
  }),
);

async function previewRoster(
  q: Queryable,
  ownerId: string,
  classId: string,
  rows: { name: string; internalId: string; notes: string }[],
) {
  const existing = (
    await q.query(
      "SELECT id,name,internal_id FROM teacher_students WHERE owner_id=$1 AND class_id=$2 AND removed=false",
      [ownerId, classId],
    )
  ).rows;
  const seen = new Set<string>();
  const result = rows.map((s, i) => {
    const normalized = {
      name: s.name.trim(),
      internalId: normalizeInternalId(s.internalId),
      notes: s.notes.trim(),
    };
    const errors: string[] = [];
    if (Object.values(normalized).some((value) => value.includes("\u0000")))
      errors.push("أحد الحقول يحتوي رمزًا غير صالح.");
    if (!normalized.name) errors.push("اسم الطالب فارغ.");
    if (
      normalized.name.length > 180 ||
      normalized.internalId.length > 80 ||
      normalized.notes.length > 4000
    )
      errors.push("أحد الحقول أطول من الحد المسموح.");
    const key = normalized.internalId
      ? `id:${normalized.internalId}`
      : `name:${normalizeStudentName(normalized.name)}`;
    if (seen.has(key)) errors.push("صف مكرر في الملف.");
    seen.add(key);
    const matches = existing.filter((e) =>
      normalized.internalId
        ? e.internal_id === normalized.internalId
        : normalizeStudentName(e.name) ===
          normalizeStudentName(normalized.name),
    );
    if (matches.length > 1)
      errors.push("أكثر من طالب بنفس الاسم. استخدم رقمًا داخليًا للتمييز.");
    return {
      row: i + 1,
      student: normalized,
      errors,
      matchedStudentId: matches[0]?.id ?? null,
    };
  });
  return {
    rows: result,
    totals: {
      valid: result.filter((r) => !r.errors.length).length,
      invalid: result.filter((r) => r.errors.length).length,
      matched: result.filter((r) => r.matchedStudentId).length,
    },
  };
}
teacherRouter.post(
  "/teacher/students/import/preview",
  route(async (req, res) => {
    const p = importSchema.safeParse(req.body);
    if (!p.success) {
      fail(res);
      return;
    }
    if (!(await exists(pool, "teacher_classes", p.data.classId, owner(req)))) {
      fail(res, 404, "الفصل غير موجود.");
      return;
    }
    res.json(
      await previewRoster(pool, owner(req), p.data.classId, p.data.rows),
    );
  }),
);
teacherRouter.post(
  "/teacher/students/import",
  route(async (req, res) => {
    const p = importSchema.safeParse(req.body);
    if (!p.success) {
      fail(res);
      return;
    }
    const q = await pool.connect();
    try {
      await q.query("BEGIN");
      const cls = await q.query(
        "SELECT id FROM teacher_classes WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [p.data.classId, owner(req)],
      );
      if (!cls.rowCount) {
        await q.query("ROLLBACK");
        fail(res, 404, "الفصل غير موجود.");
        return;
      }
      const preview = await previewRoster(
        q,
        owner(req),
        p.data.classId,
        p.data.rows,
      );
      if (preview.totals.invalid) {
        await q.query("ROLLBACK");
        res.status(400).json({
          error: "صحّح الصفوف غير الصالحة قبل الاستيراد.",
          ...preview,
        });
        return;
      }
      let added = 0,
        updated = 0,
        skipped = 0;
      for (const row of preview.rows) {
        const s = row.student;
        if (row.matchedStudentId) {
          if (p.data.mode === "add") {
            skipped++;
            continue;
          }
          await q.query(
            "UPDATE teacher_students SET name=$3,internal_id=$4,notes=$5,updated_at=now() WHERE id=$1 AND owner_id=$2",
            [row.matchedStudentId, owner(req), s.name, s.internalId, s.notes],
          );
          updated++;
        } else {
          await q.query(
            "INSERT INTO teacher_students(id,owner_id,class_id,name,internal_id,notes) VALUES($1,$2,$3,$4,$5,$6)",
            [
              createId(),
              owner(req),
              p.data.classId,
              s.name,
              s.internalId,
              s.notes,
            ],
          );
          added++;
        }
      }
      await q.query(
        "INSERT INTO teacher_reminders(id,owner_id,title,body,dedupe_key) VALUES($1,$2,$3,$4,$5)",
        [
          createId(),
          owner(req),
          "ملخص استيراد الكشف",
          `تمت إضافة ${added} وتحديث ${updated} وتجاوز ${skipped} سجلات مطابقة.`,
          `import:${createId()}`,
        ],
      );
      await q.query("COMMIT");
      res.json({ ok: true, added, updated, skipped });
    } catch (e) {
      await q.query("ROLLBACK");
      throw e;
    } finally {
      q.release();
    }
  }),
);
teacherRouter.get(
  "/teacher/students/export",
  route(async (req, res) => {
    const classId =
      typeof req.query.classId === "string" ? req.query.classId : null;
    const { rows } = await pool.query(
      "SELECT name,internal_id,notes FROM teacher_students WHERE owner_id=$1 AND ($2::text IS NULL OR class_id=$2) AND removed=false AND archived=false ORDER BY name",
      [owner(req), classId],
    );
    const csv =
      "\ufeff" +
      [
        ["اسم الطالب", "الرقم الداخلي", "ملاحظات"],
        ...rows.map((r) => [r.name, r.internal_id, r.notes]),
      ]
        .map((r) => r.map(safeCsvCell).join(","))
        .join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="roster.csv"');
    res.send(csv);
  }),
);

teacherRouter.get(
  "/teacher/attendance",
  route(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM teacher_records WHERE owner_id=$1 AND kind='attendance' AND ($2::text IS NULL OR class_id=$2) AND ($3::text IS NULL OR data->>'date'=$3) ORDER BY data->>'date' DESC LIMIT 10000",
      [
        owner(req),
        typeof req.query.classId === "string" ? req.query.classId : null,
        typeof req.query.date === "string" ? req.query.date : null,
      ],
    );
    res.json(rows.map(common));
  }),
);
teacherRouter.post(
  "/teacher/attendance",
  route(async (req, res) => {
    const p = attendanceSchema.safeParse(req.body);
    if (!p.success) {
      fail(res);
      return;
    }
    const q = await pool.connect();
    try {
      await q.query("BEGIN");
      const ids = (
        await q.query(
          "SELECT id FROM teacher_students WHERE owner_id=$1 AND class_id=$2 AND removed=false AND archived=false",
          [owner(req), p.data.classId],
        )
      ).rows.map((r) => r.id);
      if (
        !(await exists(q, "teacher_classes", p.data.classId, owner(req))) ||
        p.data.entries.some((e) => !ids.includes(e.studentId))
      ) {
        await q.query("ROLLBACK");
        fail(res, 400, "تحقق من الفصل والطلاب المحددين.");
        return;
      }
      const entries = [];
      for (const e of p.data.entries) {
        const data = { ...e, date: p.data.date };
        const { rows } = await q.query(
          "INSERT INTO teacher_records(id,owner_id,kind,class_id,student_id,dedupe_key,data) VALUES($1,$2,'attendance',$3,$4,$5,$6) ON CONFLICT(owner_id,kind,dedupe_key) DO UPDATE SET data=$6,updated_at=now() WHERE teacher_records.class_id=EXCLUDED.class_id RETURNING *",
          [
            createId(),
            owner(req),
            p.data.classId,
            e.studentId,
            `${e.studentId}:${p.data.date}`,
            JSON.stringify(data),
          ],
        );
        if (!rows[0]) {
          await q.query("ROLLBACK");
          fail(
            res,
            409,
            "يوجد حضور لهذا الطالب في التاريخ نفسه قبل نقله إلى هذا الفصل. راجع السجل الأصلي.",
          );
          return;
        }
        entries.push(common(rows[0]));
      }
      await q.query("COMMIT");
      res.json({ classId: p.data.classId, date: p.data.date, entries });
    } catch (e) {
      await q.query("ROLLBACK");
      throw e;
    } finally {
      q.release();
    }
  }),
);

teacherRouter.post(
  "/teacher/grades/bulk",
  route(async (req, res) => {
    const p = z
      .object({
        classId: uuid,
        title: z.string().trim().min(1).max(180),
        totalMarks: z.number().min(0.1).max(10000),
        date: z.string(),
        entries: z
          .array(
            z.object({
              studentId: uuid,
              marks: z.number().min(0).nullable(),
              note: z.string().max(2000).default(""),
            }),
          )
          .min(1)
          .max(500),
      })
      .safeParse(req.body);
    if (
      !p.success ||
      p.data.entries.some(
        (e) =>
          !teacherRecordSchemas.grades.safeParse({ ...p.data, ...e }).success,
      ) ||
      new Set(p.data.entries.map((e) => e.studentId)).size !==
        p.data.entries.length
    ) {
      fail(res, 400, "تحقق من التاريخ والدرجات وتكرار الطلاب.");
      return;
    }
    const q = await pool.connect();
    try {
      await q.query("BEGIN");
      const cls = await q.query(
        "SELECT id FROM teacher_classes WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [p.data.classId, owner(req)],
      );
      const students = await q.query(
        "SELECT id FROM teacher_students WHERE owner_id=$1 AND class_id=$2 AND id=ANY($3::text[]) AND removed=false",
        [owner(req), p.data.classId, p.data.entries.map((e) => e.studentId)],
      );
      if (!cls.rowCount || students.rowCount !== p.data.entries.length) {
        await q.query("ROLLBACK");
        fail(res, 400, "تحقق من الفصل والطلاب.");
        return;
      }
      const result = [];
      for (const e of p.data.entries) {
        const data = teacherRecordSchemas.grades.parse({ ...p.data, ...e });
        const existing = await q.query(
          "SELECT id FROM teacher_records WHERE owner_id=$1 AND class_id=$2 AND student_id=$3 AND kind='grades' AND archived=false AND data->>'title'=$4 AND data->>'date'=$5 FOR UPDATE",
          [owner(req), p.data.classId, e.studentId, p.data.title, p.data.date],
        );
        if (existing.rows.length > 1) {
          await q.query("ROLLBACK");
          fail(
            res,
            409,
            "يوجد أكثر من تقييم بالاسم والتاريخ نفسيهما. راجع التقييمات قبل الحفظ الجماعي.",
          );
          return;
        }
        const saved = existing.rows[0]
          ? await q.query(
              "UPDATE teacher_records SET data=$3,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *",
              [existing.rows[0].id, owner(req), JSON.stringify(data)],
            )
          : await q.query(
              "INSERT INTO teacher_records(id,owner_id,kind,class_id,student_id,data) VALUES($1,$2,'grades',$3,$4,$5) RETURNING *",
              [
                createId(),
                owner(req),
                p.data.classId,
                e.studentId,
                JSON.stringify(data),
              ],
            );
        result.push(common(saved.rows[0]));
      }
      await q.query("COMMIT");
      res.json({ ok: true, entries: result, saved: result.length });
    } catch (e) {
      await q.query("ROLLBACK");
      throw e;
    } finally {
      q.release();
    }
  }),
);

for (const [kind, schema] of Object.entries(teacherRecordSchemas)) {
  teacherRouter.get(
    `/teacher/${kind}`,
    route(async (req, res) => {
      const { rows } = await pool.query(
        "SELECT * FROM teacher_records WHERE owner_id=$1 AND kind=$2 AND archived=false AND ($3::text IS NULL OR class_id=$3) ORDER BY created_at DESC LIMIT 5000",
        [
          owner(req),
          kind,
          typeof req.query.classId === "string" ? req.query.classId : null,
        ],
      );
      res.json(rows.map(common));
    }),
  );
  const save: RequestHandler = async (req, res) => {
    const p = schema.safeParse(req.body);
    if (!p.success) {
      fail(res, 400, "تحقق من الحقول والدرجات والتاريخ.");
      return;
    }
    const data = p.data as Record<string, unknown>;
    const classId = typeof data.classId === "string" ? data.classId : null;
    const studentId =
      typeof data.studentId === "string" ? data.studentId : null;
    const previous = req.params.id ? (await pool.query('SELECT class_id,student_id,data FROM teacher_records WHERE id=$1 AND owner_id=$2 AND kind=$3', [pathId(req),owner(req),kind])).rows[0] : undefined;
    if (req.params.id && !previous) { fail(res,404,'السجل غير موجود.'); return; }
    if (
      classId &&
      !(await exists(pool, "teacher_classes", classId, owner(req)))
    ) {
      fail(res, 404, "الفصل غير موجود.");
      return;
    }
    if (studentId) {
      const historicalReference = previous?.student_id === studentId && previous?.class_id === classId;
      const s = await pool.query(
        "SELECT id FROM teacher_students WHERE id=$1 AND owner_id=$2 AND ((class_id=$3 AND removed=false) OR $4::boolean=true)",
        [studentId, owner(req), classId,historicalReference],
      );
      if (!s.rowCount) {
        fail(res, 404, "الطالب غير موجود في الفصل.");
        return;
      }
    }
    if (
      Array.isArray(data.studentCompletion) &&
      data.studentCompletion.length
    ) {
      const found = await pool.query(
        "SELECT id,class_id FROM teacher_students WHERE owner_id=$1 AND id=ANY($2::text[])",
        [owner(req), data.studentCompletion],
      );
      const historicalCompletion = new Set(previous?.class_id === classId && Array.isArray(previous?.data.studentCompletion) ? previous.data.studentCompletion : []);
      if (found.rowCount !== new Set(data.studentCompletion).size || found.rows.some(row => classId && row.class_id !== classId && !historicalCompletion.has(row.id))) {
        fail(res, 400, "تحقق من الطلاب المكتملة واجباتهم.");
        return;
      }
    }
    const id = req.params.id ? pathId(req) : createId();
    const { rows } = req.params.id
      ? await pool.query(
          "UPDATE teacher_records SET class_id=$3,student_id=$4,data=$5,archived=$6,updated_at=now() WHERE id=$1 AND owner_id=$2 AND kind=$7 RETURNING *",
          [
            id,
            owner(req),
            classId,
            studentId,
            JSON.stringify(data),
            data.archived === true,
            kind,
          ],
        )
      : await pool.query(
          "INSERT INTO teacher_records(id,owner_id,kind,class_id,student_id,data,archived) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            id,
            owner(req),
            kind,
            classId,
            studentId,
            JSON.stringify(data),
            data.archived === true,
          ],
        );
    if (!rows[0]) {
      fail(res, 404, "السجل غير موجود.");
      return;
    }
    res.status(req.params.id ? 200 : 201).json(common(rows[0]));
  };
  teacherRouter.post(`/teacher/${kind}`, route(save));
  teacherRouter.put(`/teacher/${kind}/:id`, route(save));
  teacherRouter.delete(
    `/teacher/${kind}/:id`,
    route(async (req, res) => {
      const { rowCount } = await pool.query(
        "UPDATE teacher_records SET archived=true,updated_at=now() WHERE id=$1 AND owner_id=$2 AND kind=$3",
        [pathId(req), owner(req), kind],
      );
      if (!rowCount) {
        fail(res, 404, "السجل غير موجود.");
        return;
      }
      res.json({ ok: true });
    }),
  );
}
teacherRouter.post(
  "/teacher/lessons/:id/clone",
  route(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM teacher_records WHERE id=$1 AND owner_id=$2 AND kind='lessons'",
      [pathId(req), owner(req)],
    );
    if (!rows[0]) {
      fail(res, 404, "الخطة غير موجودة.");
      return;
    }
    const data = {
      ...rows[0].data,
      title: `${rows[0].data.title} — نسخة`,
      date:
        typeof req.body?.date === "string"
          ? req.body.date
          : new Date(new Date(rows[0].data.date).getTime() + 7 * 86400000)
              .toISOString()
              .slice(0, 10),
    };
    const parsed = teacherRecordSchemas.lessons.safeParse(data);
    if (!parsed.success) {
      fail(res);
      return;
    }
    const inserted = await pool.query(
      "INSERT INTO teacher_records(id,owner_id,kind,class_id,data) VALUES($1,$2,'lessons',$3,$4) RETURNING *",
      [createId(), owner(req), rows[0].class_id, JSON.stringify(parsed.data)],
    );
    res.status(201).json(common(inserted.rows[0]));
  }),
);

teacherRouter.post(
  "/teacher/assets",
  route(async (req, res) => {
    const mimeType = req.get("content-type")?.split(";")[0] ?? "";
    if (
      !Buffer.isBuffer(req.body) ||
      !validateTeacherImage(req.body, mimeType)
    ) {
      fail(
        res,
        400,
        "ارفع صورة JPEG أو PNG أو WebP صحيحة، بحجم أقصى 8 ميجابايت و40 مليون بكسل.",
      );
      return;
    }
    const id = createId();
    const q = await pool.connect();
    try {
      await q.query("BEGIN");
      await q.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        owner(req),
      ]);
      const count = await q.query(
        "SELECT count(*)::int AS count FROM teacher_assets WHERE owner_id=$1",
        [owner(req)],
      );
      if (count.rows[0].count >= 200) {
        await q.query("ROLLBACK");
        fail(res, 409, "وصلت إلى حد الصور المحفوظة (200).");
        return;
      }
      await q.query(
        "INSERT INTO teacher_assets(id,owner_id,mime_type,size,content_base64) VALUES($1,$2,$3,$4,$5)",
        [
          id,
          owner(req),
          mimeType,
          req.body.length,
          req.body.toString("base64"),
        ],
      );
      await q.query("COMMIT");
    } catch (error) {
      await q.query("ROLLBACK");
      throw error;
    } finally {
      q.release();
    }
    res.status(201).json({
      id,
      url: `/api/teacher/assets/${id}`,
      mimeType,
      size: req.body.length,
    });
  }),
);
teacherRouter.get(
  "/teacher/assets/:id",
  route(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM teacher_assets WHERE id=$1 AND owner_id=$2",
      [pathId(req), owner(req)],
    );
    if (!rows[0]) {
      fail(res, 404, "الصورة غير موجودة.");
      return;
    }
    res.setHeader("Content-Type", rows[0].mime_type);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.send(Buffer.from(rows[0].content_base64, "base64"));
  }),
);
teacherRouter.post(
  "/teacher/assets/:id/ocr",
  route(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM teacher_assets WHERE id=$1 AND owner_id=$2",
      [pathId(req), owner(req)],
    );
    if (!rows[0]) {
      fail(res, 404, "الصورة غير موجودة.");
      return;
    }
    res.json(
      await extractTeacherImage(
        Buffer.from(rows[0].content_base64, "base64"),
        rows[0].mime_type,
      ),
    );
  }),
);

teacherRouter.get(
  "/teacher/exams",
  route(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM teacher_exams WHERE owner_id=$1 AND archived=false AND ($2::boolean IS NULL OR is_template=$2) ORDER BY updated_at DESC LIMIT 500",
      [
        owner(req),
        req.query.templates === "true"
          ? true
          : req.query.templates === "false"
            ? false
            : null,
      ],
    );
    res.json(rows.map(exam));
  }),
);
teacherRouter.get(
  "/teacher/exams/:id",
  route(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM teacher_exams WHERE id=$1 AND owner_id=$2",
      [pathId(req), owner(req)],
    );
    if (!rows[0]) {
      fail(res, 404, "الاختبار غير موجود.");
      return;
    }
    res.json(exam(rows[0]));
  }),
);
const saveExam: RequestHandler = async (req, res) => {
  const p = examSchema.safeParse(req.body);
  if (!p.success) {
    fail(res, 400, "تحقق من محتوى الاختبار وتنسيق الصفحة.");
    return;
  }
  const assets = [
    p.data.sourceAssetId,
    p.data.document.metadata.schoolLogoAssetId,
    p.data.document.source.processedAssetId,
  ].filter((id): id is string => Boolean(id));
  for (const id of assets)
    if (!(await exists(pool, "teacher_assets", id, owner(req)))) {
      fail(res, 400, "إحدى صور الاختبار غير موجودة.");
      return;
    }
  if (req.params.id) {
    if (!p.data.expectedVersion) {
      fail(res, 400, "رقم نسخة الاختبار مطلوب للحفظ الآمن.");
      return;
    }
    const { rows } = await pool.query(
      "UPDATE teacher_exams SET title=$3,document=$4,source_asset_id=$5,is_template=$6,version=version+1,updated_at=now() WHERE id=$1 AND owner_id=$2 AND version=$7 RETURNING *",
      [
        pathId(req),
        owner(req),
        p.data.title,
        JSON.stringify(p.data.document),
        p.data.sourceAssetId,
        p.data.isTemplate,
        p.data.expectedVersion,
      ],
    );
    if (!rows[0]) {
      fail(
        res,
        409,
        "تغيّر الاختبار في نافذة أخرى أو أصبح غير متاح. أعد تحميل النسخة المحفوظة قبل المتابعة.",
      );
      return;
    }
    res.json(exam(rows[0]));
  } else {
    const { rows } = await pool.query(
      "INSERT INTO teacher_exams(id,owner_id,title,document,source_asset_id,is_template) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [
        createId(),
        owner(req),
        p.data.title,
        JSON.stringify(p.data.document),
        p.data.sourceAssetId,
        p.data.isTemplate,
      ],
    );
    res.status(201).json(exam(rows[0]));
  }
};
teacherRouter.post("/teacher/exams", route(saveExam));
teacherRouter.put("/teacher/exams/:id", route(saveExam));
teacherRouter.post(
  "/teacher/exams/:id/clone",
  route(async (req, res) => {
    const p = z
      .object({
        title: z.string().trim().min(1).max(180).optional(),
        isTemplate: z.boolean().optional(),
      })
      .safeParse(req.body ?? {});
    if (!p.success) {
      fail(res);
      return;
    }
    const { rows } = await pool.query(
      "SELECT * FROM teacher_exams WHERE id=$1 AND owner_id=$2",
      [pathId(req), owner(req)],
    );
    if (!rows[0]) {
      fail(res, 404, "الاختبار غير موجود.");
      return;
    }
    const source = rows[0];
    const title = p.data.title ?? `${source.title} — نسخة`;
    const document = {
      ...source.document,
      metadata: { ...source.document.metadata, title },
    };
    const inserted = await pool.query(
      "INSERT INTO teacher_exams(id,owner_id,title,document,source_asset_id,is_template) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [
        createId(),
        owner(req),
        title,
        JSON.stringify(document),
        source.source_asset_id,
        p.data.isTemplate ?? false,
      ],
    );
    res.status(201).json(exam(inserted.rows[0]));
  }),
);
teacherRouter.delete(
  "/teacher/exams/:id",
  route(async (req, res) => {
    const { rowCount } = await pool.query(
      "UPDATE teacher_exams SET archived=true,updated_at=now(),version=version+1 WHERE id=$1 AND owner_id=$2",
      [pathId(req), owner(req)],
    );
    if (!rowCount) {
      fail(res, 404, "الاختبار غير موجود.");
      return;
    }
    res.json({ ok: true });
  }),
);

for (const name of ["automations", "rules"]) {
  teacherRouter.get(
    `/teacher/${name}`,
    route(async (req, res) => {
      const { rows } = await pool.query(
        "SELECT * FROM teacher_rules WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 200",
        [owner(req)],
      );
      res.json(rows.map(rule));
    }),
  );
  const save: RequestHandler = async (req, res) => {
    const p = ruleSchema.safeParse(req.body);
    if (!p.success) {
      fail(res);
      return;
    }
    if (
      p.data.config.classId &&
      !(await exists(
        pool,
        "teacher_classes",
        p.data.config.classId,
        owner(req),
      ))
    ) {
      fail(res, 404, "الفصل غير موجود.");
      return;
    }
    const next = p.data.enabled
      ? nextTeacherRun(p.data.type, p.data.config)
      : null;
    const { rows } = req.params.id
      ? await pool.query(
          "UPDATE teacher_rules SET name=$3,type=$4,enabled=$5,config=$6,next_run_at=$7,error=null,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *",
          [
            pathId(req),
            owner(req),
            p.data.name,
            p.data.type,
            p.data.enabled,
            JSON.stringify(p.data.config),
            next,
          ],
        )
      : await pool.query(
          "INSERT INTO teacher_rules(id,owner_id,name,type,enabled,config,next_run_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            createId(),
            owner(req),
            p.data.name,
            p.data.type,
            p.data.enabled,
            JSON.stringify(p.data.config),
            next,
          ],
        );
    if (!rows[0]) {
      fail(res, 404, "القاعدة غير موجودة.");
      return;
    }
    res.status(req.params.id ? 200 : 201).json(rule(rows[0]));
  };
  teacherRouter.post(`/teacher/${name}`, route(save));
  teacherRouter.put(`/teacher/${name}/:id`, route(save));
  teacherRouter.delete(
    `/teacher/${name}/:id`,
    route(async (req, res) => {
      const { rowCount } = await pool.query(
        "DELETE FROM teacher_rules WHERE id=$1 AND owner_id=$2",
        [pathId(req), owner(req)],
      );
      if (!rowCount) {
        fail(res, 404, "القاعدة غير موجودة.");
        return;
      }
      res.json({ ok: true });
    }),
  );
  teacherRouter.post(
    `/teacher/${name}/:id/clone`,
    route(async (req, res) => {
      const { rows } = await pool.query(
        "SELECT * FROM teacher_rules WHERE id=$1 AND owner_id=$2",
        [pathId(req), owner(req)],
      );
      if (!rows[0]) {
        fail(res, 404, "القاعدة غير موجودة.");
        return;
      }
      const r = rows[0];
      const inserted = await pool.query(
        "INSERT INTO teacher_rules(id,owner_id,name,type,enabled,config) VALUES($1,$2,$3,$4,false,$5) RETURNING *",
        [
          createId(),
          owner(req),
          `${r.name} — نسخة`,
          r.type,
          JSON.stringify(r.config),
        ],
      );
      res.status(201).json(rule(inserted.rows[0]));
    }),
  );
  teacherRouter.get(
    `/teacher/${name}/:id/runs`,
    route(async (req, res) => {
      const { rows } = await pool.query(
        'SELECT runs.id,runs.scheduled_at AS "scheduledAt",runs.result,runs.created_at AS "createdAt" FROM teacher_rule_runs runs JOIN teacher_rules rules ON rules.id=runs.rule_id WHERE rules.id=$1 AND rules.owner_id=$2 ORDER BY runs.created_at DESC LIMIT 100',
        [pathId(req), owner(req)],
      );
      res.json(rows);
    }),
  );
}
teacherRouter.post(
  "/teacher/automations/run",
  route(async (req, res) => {
    await runTeacherRules(owner(req));
    res.json({ ok: true });
  }),
);
teacherRouter.get(
  "/teacher/reminders",
  route(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM teacher_reminders WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 300",
      [owner(req)],
    );
    res.json(rows.map(reminder));
  }),
);
teacherRouter.put(
  "/teacher/reminders/:id",
  route(async (req, res) => {
    if (typeof req.body?.read !== "boolean") {
      fail(res);
      return;
    }
    const { rows } = await pool.query(
      "UPDATE teacher_reminders SET read=$3 WHERE id=$1 AND owner_id=$2 RETURNING *",
      [pathId(req), owner(req), req.body.read],
    );
    if (!rows[0]) {
      fail(res, 404, "التذكير غير موجود.");
      return;
    }
    res.json(reminder(rows[0]));
  }),
);
teacherRouter.get(
  "/teacher/dashboard",
  route(async (req, res) => {
    const uid = owner(req);
    const [counts, records, exams, reminders] = await Promise.all([
      pool.query(
        "SELECT (SELECT count(*)::int FROM teacher_classes WHERE owner_id=$1 AND archived=false) AS classes,(SELECT count(*)::int FROM teacher_students WHERE owner_id=$1 AND archived=false AND removed=false) AS students,(SELECT count(*)::int FROM teacher_exams WHERE owner_id=$1 AND archived=false AND is_template=false) AS exams,(SELECT count(*)::int FROM teacher_records WHERE owner_id=$1 AND kind='tasks' AND archived=false AND data->>'status'='pending') AS tasks,(SELECT count(*)::int FROM teacher_records WHERE owner_id=$1 AND kind='grades' AND archived=false AND (data->'marks' IS NULL OR data->'marks'='null')) AS ungraded,(SELECT count(*)::int FROM teacher_records WHERE owner_id=$1 AND kind='attendance' AND data->>'status'='absent' AND (data->>'date')::date>=CURRENT_DATE-7) AS absences",
        [uid],
      ),
      pool.query(
        "SELECT * FROM teacher_records WHERE owner_id=$1 AND archived=false ORDER BY created_at DESC LIMIT 10000",
        [uid],
      ),
      pool.query(
        "SELECT * FROM teacher_exams WHERE owner_id=$1 AND archived=false ORDER BY updated_at DESC LIMIT 100",
        [uid],
      ),
      pool.query(
        "SELECT * FROM teacher_reminders WHERE owner_id=$1 AND read=false ORDER BY created_at DESC LIMIT 10",
        [uid],
      ),
    ]);
    const week = Date.now() - 7 * 86400000;
    res.json({
      counts: counts.rows[0],
      tasks: records.rows
        .filter((r) => r.kind === "tasks" && r.data.status === "pending")
        .map(common)
        .slice(0, 10),
      upcomingExams: exams.rows
        .filter(
          (r) =>
            !r.is_template &&
            r.document.metadata?.date &&
            new Date(r.document.metadata.date).getTime() >=
              Date.now() - 86400000,
        )
        .map(exam)
        .slice(0, 10),
      recentFiles: exams.rows.slice(0, 6).map(exam),
      reminders: reminders.rows.map(reminder),
      weekly: {
        attendance: records.rows.filter(
          (r) =>
            r.kind === "attendance" && new Date(r.data.date).getTime() >= week,
        ).length,
        grades: records.rows.filter(
          (r) =>
            r.kind === "grades" && new Date(r.created_at).getTime() >= week,
        ).length,
        tasksCompleted: records.rows.filter(
          (r) =>
            r.kind === "tasks" &&
            r.data.status === "completed" &&
            new Date(r.updated_at).getTime() >= week,
        ).length,
      },
    });
  }),
);
