import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { pool, type PoolClient } from "@workspace/db";
import {
  blueprintIssues,
  parallelForms,
  weightedGrade,
  type BankQuestion,
  newLessonStep,
} from "@workspace/api-zod";
import {
  requireAuth,
  requireTeacher,
  requireCsrf,
} from "../lib/auth-middleware";
import { createId, newOpaqueToken, sha256 } from "../lib/security";
import { validTeacherDate } from "../lib/teacher-validation";
export const teacherToolsRouter = Router();
teacherToolsRouter.use(
  "/teacher/tools",
  requireAuth,
  requireTeacher,
  (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.method === "GET") next();
    else requireCsrf(req, res, next);
  },
);
class ToolsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (message = "البيانات غير متاحة.", status = 404): never => {
  throw new ToolsError(status, message);
};
const route =
  (fn: RequestHandler): RequestHandler =>
  async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (e) {
      if (e instanceof ToolsError)
        res.status(e.status).json({ error: e.message });
      else if (e instanceof z.ZodError)
        res.status(400).json({ error: "راجع الحقول المطلوبة والقيم." });
      else next(e);
    }
  };
const uuid = z.string().uuid(),
  text = z.string().trim().max(20000),
  title = z.string().trim().min(1).max(300),
  date = z.string().refine(validTeacherDate);
teacherToolsRouter.get(
  "/teacher/tools/assets",
  route(async (req, res) => {
    const r = await pool.query(
      'SELECT id,mime_type AS "mimeType",size,created_at AS "createdAt" FROM teacher_assets WHERE owner_id=$1 ORDER BY created_at DESC',
      [req.auth!.userId],
    );
    res.json(
      r.rows.map((row) => ({
        ...row,
        title:
          "صورة خاصة — " + new Date(row.createdAt).toISOString().slice(0, 10),
        type: "asset",
      })),
    );
  }),
);
teacherToolsRouter.post(
  "/teacher/tools/packets",
  route(async (req, res) => {
    const input = z
        .object({
          type: z.enum(["absence_pack", "substitute"]),
          classId: uuid,
          studentId: uuid.optional(),
          from: date,
          to: date,
        })
        .parse(req.body),
      owner = req.auth!.userId;
    if (
      input.from > input.to ||
      (Date.parse(input.to) - Date.parse(input.from)) / 86400000 > 90
    )
      fail("اختر مدة لا تزيد على 90 يومًا.", 400);
    const cls = await pool.query(
      "SELECT name FROM teacher_classes WHERE id=$1 AND owner_id=$2",
      [input.classId, owner],
    );
    if (!cls.rowCount) fail();
    let studentName = "",
      dates: string[] = [];
    if (input.type === "absence_pack") {
      if (!input.studentId) fail("اختر الطالب.", 400);
      const student = await pool.query(
        "SELECT name FROM teacher_students WHERE id=$1 AND class_id=$2 AND owner_id=$3",
        [input.studentId, input.classId, owner],
      );
      if (!student.rowCount) fail();
      studentName = student.rows[0].name;
      const absences = await pool.query(
        "SELECT data->>'date' AS date FROM teacher_records WHERE owner_id=$1 AND class_id=$2 AND student_id=$3 AND kind='attendance' AND data->>'status'='absent' AND data->>'date' BETWEEN $4 AND $5",
        [owner, input.classId, input.studentId, input.from, input.to],
      );
      dates = absences.rows.map((r) => r.date);
    }
    const plans = await pool.query(
      "SELECT id,data FROM teacher_records WHERE owner_id=$1 AND class_id=$2 AND kind='lessons' AND archived=false AND data->>'date' BETWEEN $3 AND $4 ORDER BY data->>'date'",
      [owner, input.classId, input.from, input.to],
    );
    const tasks = await pool.query(
      "SELECT data FROM teacher_records WHERE owner_id=$1 AND class_id=$2 AND kind='tasks' AND archived=false AND left(data->>'dueAt',10) BETWEEN $3 AND $4",
      [owner, input.classId, input.from, input.to],
    );
    const matched =
      input.type === "absence_pack"
        ? plans.rows.filter((r) => dates.includes(r.data.date))
        : plans.rows;
    const sections = [
      {
        heading: "الفصل والفترة",
        body:
          cls.rows[0].name +
          "\n" +
          input.from +
          " — " +
          input.to +
          (studentName ? "\n" + studentName : ""),
      },
      {
        heading:
          input.type === "absence_pack"
            ? "الغياب المسجل"
            : "تعليمات وخطة الحصص",
        body:
          input.type === "absence_pack"
            ? dates.join("، ") || "لا غياب مسجل في الفترة."
            : "راجع الخطط والموارد قبل الحصة. عند تعذر النشاط الإلكتروني استخدم ورقة مطبوعة يراجعها المعلم.",
      },
      {
        heading: "الخطط المحفوظة",
        body:
          matched
            .map((r) =>
              [
                r.data.title + " — " + r.data.date,
                r.data.objectives,
                r.data.content,
                r.data.homework,
              ]
                .filter(Boolean)
                .join("\n"),
            )
            .join("\n\n") || "لا خطط محفوظة في الفترة.",
      },
      {
        heading: "قائمة المهام والمواعيد",
        body:
          tasks.rows
            .map(
              (r) => r.data.title + " — " + r.data.dueAt + "\n□ مراجعة الإنجاز",
            )
            .join("\n") || "لا مهام محفوظة في الفترة.",
      },
    ];
    const data = {
      title:
        input.type === "absence_pack" ? "حزمة تعويض غياب" : "حزمة معلم بديل",
      type: input.type,
      classId: input.classId,
      date: input.from,
      sections,
      refs: matched.map((r) => ({ type: "lesson_plan", id: r.id })),
      reviewed: false,
    };
    const r = await pool.query(
      "INSERT INTO teacher_records(id,owner_id,kind,class_id,data) VALUES($1,$2,'documents',$3,$4) RETURNING *",
      [createId(), owner, input.classId, JSON.stringify(data)],
    );
    res.status(201).json(record(r.rows[0]));
  }),
);
teacherToolsRouter.get(
  "/teacher/tools/shares",
  route(async (req, res) => {
    const r = await pool.query(
      'SELECT id,enabled,created_at AS "createdAt",content FROM teacher_template_shares WHERE owner_id=$1 ORDER BY created_at DESC',
      [req.auth!.userId],
    );
    res.json(
      r.rows.map((r) => ({
        id: r.id,
        enabled: r.enabled,
        kind: r.content.kind,
        createdAt: r.createdAt,
      })),
    );
  }),
);
teacherToolsRouter.post(
  "/teacher/tools/shares",
  route(async (req, res) => {
    const { recordId, reviewed } = z
      .object({ recordId: uuid, reviewed: z.literal(true) })
      .parse(req.body);
    if (!reviewed) fail("راجع الخصوصية قبل المشاركة.", 400);
    const r = await pool.query(
      "SELECT kind,data,revision FROM teacher_records WHERE id=$1 AND owner_id=$2 AND kind IN ('documents','rubrics') AND archived=false",
      [recordId, req.auth!.userId],
    );
    if (!r.rowCount) fail();
    const original = r.rows[0];
    const data =
      original.kind === "documents"
        ? {
            title: "قالب وثيقة",
            type: "preparation",
            date: new Date().toISOString().slice(0, 10),
            classId: null,
            sections: original.data.sections.map((_: unknown, i: number) => ({
              heading: "القسم " + (i + 1),
              body: "",
            })),
            refs: [],
            reviewed: false,
          }
        : {
            title: "قالب معايير تقييم",
            criteria: original.data.criteria.map(
              (criterion: { max: number; weight: number }, i: number) => ({
                name: "المعيار " + (i + 1),
                max: criterion.max,
                weight: criterion.weight,
                description: "",
              }),
            ),
          };
    const token = newOpaqueToken(),
      shareId = createId();
    const sharedData = {
      ...data,
      templateSource: {
        version: original.revision,
        sharedAt: new Date().toISOString(),
        author: "معلم " + sha256(req.auth!.userId).slice(0, 8),
      },
    };
    await pool.query(
      "INSERT INTO teacher_template_shares(id,owner_id,token_hash,content) VALUES($1,$2,$3,$4)",
      [
        shareId,
        req.auth!.userId,
        sha256(token),
        JSON.stringify({ kind: original.kind, data: sharedData }),
      ],
    );
    res.status(201).json({ id: shareId, token });
  }),
);
teacherToolsRouter.delete(
  "/teacher/tools/shares/:id",
  route(async (req, res) => {
    const r = await pool.query(
      "UPDATE teacher_template_shares SET enabled=false WHERE id=$1 AND owner_id=$2 RETURNING id",
      [uuid.parse(req.params.id), req.auth!.userId],
    );
    if (!r.rowCount) fail();
    res.json({ ok: true });
  }),
);
teacherToolsRouter.post(
  "/teacher/tools/shares/import",
  route(async (req, res) => {
    const { token } = z
      .object({ token: z.string().min(32).max(64) })
      .parse(req.body);
    const r = await pool.query(
      "SELECT content FROM teacher_template_shares WHERE token_hash=$1 AND enabled=true",
      [sha256(token)],
    );
    if (!r.rowCount) fail("القالب غير متاح أو أُلغيت مشاركته.");
    const { kind, data } = r.rows[0].content;
    const parsed = (kind === "documents" ? documentSchema : rubricSchema).parse(
      data,
    );
    const saved = await pool.query(
      "INSERT INTO teacher_records(id,owner_id,kind,data) VALUES($1,$2,$3,$4) RETURNING *",
      [createId(), req.auth!.userId, kind, JSON.stringify(parsed)],
    );
    res.status(201).json(record(saved.rows[0]));
  }),
);
teacherToolsRouter.post(
  "/teacher/tools/feedback/apply",
  route(async (req, res) => {
    const input = z
        .object({
          feedbackId: uuid,
          classId: uuid,
          studentIds: z.array(uuid).min(1).max(500),
          title,
          date,
          confirmed: z.literal(true),
        })
        .parse(req.body),
      owner = req.auth!.userId;
    const updated = await transaction(async (q) => {
      const feedback = await q.query(
        "SELECT data FROM teacher_records WHERE id=$1 AND owner_id=$2 AND kind='feedback' AND archived=false",
        [input.feedbackId, owner],
      );
      if (!feedback.rowCount) fail();
      const students = await q.query(
        "SELECT id FROM teacher_students WHERE owner_id=$1 AND class_id=$2 AND id=ANY($3::text[]) AND removed=false",
        [owner, input.classId, input.studentIds],
      );
      if (students.rowCount !== new Set(input.studentIds).size) fail();
      const r = await q.query(
        "UPDATE teacher_records SET data=jsonb_set(data,'{note}',to_jsonb($6::text)),updated_at=now() WHERE owner_id=$1 AND class_id=$2 AND student_id=ANY($3::text[]) AND kind='grades' AND archived=false AND data->>'title'=$4 AND data->>'date'=$5 RETURNING id",
        [
          owner,
          input.classId,
          input.studentIds,
          input.title,
          input.date,
          feedback.rows[0].data.body,
        ],
      );
      return r.rowCount;
    });
    res.json({ updated });
  }),
);
const ref = z.object({
  type: z.enum(["asset", "exam", "lesson_plan", "activity", "question"]),
  id: uuid,
});
const templateSource = z
  .object({
    version: z.number().int().positive(),
    sharedAt: z.string().datetime(),
    author: z.string().max(50),
  })
  .optional();
const documentSchema = z.object({
  templateSource,
  title,
  type: z.enum([
    "preparation",
    "analysis",
    "remediation",
    "progress",
    "activity_log",
    "portfolio",
    "reflection",
    "term_summary",
    "substitute",
    "differentiated",
    "exit_ticket",
    "absence_pack",
    "weekly",
  ]),
  classId: uuid.nullable().default(null),
  date,
  sections: z
    .array(z.object({ heading: title, body: text, answer: text.default("") }))
    .max(50),
  objective: z.string().max(1000).default(""),
  refs: z.array(ref).max(50).default([]),
  reviewed: z.boolean().default(false),
});
const blueprintSchema = z.object({
  title,
  totalMarks: z.number().positive().max(10000),
  questionCount: z.number().int().positive().max(200),
  items: z
    .array(
      z.object({
        versionId: uuid,
        marks: z.number().min(0).max(10000),
        objective: z.string().max(300).default(""),
        difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
      }),
    )
    .min(1)
    .max(200),
});
const rubricSchema = z
  .object({
    title,
    templateSource,
    criteria: z
      .array(
        z.object({
          name: title,
          max: z.number().positive().max(10000),
          weight: z.number().min(0).max(1000),
          description: text.default(""),
        }),
      )
      .min(1)
      .max(30),
  })
  .refine((r) => r.criteria.some((c) => c.weight > 0));
const feedbackSchema = z.object({
  title,
  skill: z.string().max(300),
  tone: z.enum(["encouraging", "neutral", "next_step"]),
  body: text,
});
const resourceSchema = z.object({
  title,
  type: z.enum(["asset", "exam", "lesson_plan", "activity", "question"]),
  refId: uuid,
  tags: z.array(z.string().max(100)).max(30).default([]),
  folder: z.string().max(200).default(""),
  notes: text.default(""),
});
const calendarSchema = z.object({
  title,
  calendar: z.enum(["gregory", "islamic-umalqura"]).default("gregory"),
  holidays: z.array(date).max(400).default([]),
  schedule: z
    .array(
      z.object({
        day: z.number().int().min(0).max(6),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        classId: uuid,
        label: z.string().max(300),
      }),
    )
    .max(100)
    .default([]),
});
const schemas = {
  blueprints: blueprintSchema,
  rubrics: rubricSchema,
  feedback: feedbackSchema,
  documents: documentSchema,
  resources: resourceSchema,
  calendar: calendarSchema,
};
teacherToolsRouter.post(
  "/teacher/tools/worksheets",
  route(async (req, res) => {
    const input = z
        .object({
          versionId: uuid,
          objective: title,
          classId: uuid.nullable().default(null),
        })
        .parse(req.body),
      owner = req.auth!.userId;
    const question = await pool.query(
      "SELECT content FROM teacher_question_versions WHERE id=$1 AND owner_id=$2",
      [input.versionId, owner],
    );
    if (!question.rowCount) fail();
    if (
      input.classId &&
      !(
        await pool.query(
          "SELECT id FROM teacher_classes WHERE id=$1 AND owner_id=$2",
          [input.classId, owner],
        )
      ).rowCount
    )
      fail();
    const q = question.rows[0].content as BankQuestion,
      base = [q.text, ...q.options.map((o, i) => i + 1 + ". " + o)].join("\n");
    const data = documentSchema.parse({
      title: "ورقة عمل — " + input.objective,
      type: "differentiated",
      classId: input.classId,
      date: new Date().toISOString().slice(0, 10),
      objective: input.objective,
      sections: [
        {
          heading: "دعم وتدرج",
          body:
            base +
            "\n\nحدد المعطيات، ثم اكتب خطوة واحدة في كل سطر.\nالمعطيات: ........\nخطوات الحل: ........",
          answer: q.answer,
        },
        {
          heading: "قياسي",
          body: base + "\n\nالإجابة: ................................",
          answer: q.answer,
        },
        {
          heading: "تحدٍ وتوسع",
          body: base + "\n\nفسّر سبب اختيارك وبرر كل خطوة في الحل نفسه.",
          answer: q.answer + (q.explanation ? "\n" + q.explanation : ""),
        },
      ],
      refs: [{ type: "question", id: input.versionId }],
      reviewed: false,
    });
    const saved = await pool.query(
      "INSERT INTO teacher_records(id,owner_id,kind,class_id,data) VALUES($1,$2,'documents',$3,$4) RETURNING *",
      [createId(), owner, input.classId, JSON.stringify(data)],
    );
    res.status(201).json(record(saved.rows[0]));
  }),
);
teacherToolsRouter.post(
  "/teacher/tools/exit-ticket",
  route(async (req, res) => {
    const input = z
        .object({ versionId: uuid, objective: title })
        .parse(req.body),
      owner = req.auth!.userId;
    const found = await pool.query(
      "SELECT content FROM teacher_question_versions WHERE id=$1 AND owner_id=$2",
      [input.versionId, owner],
    );
    if (!found.rowCount) fail();
    const q = found.rows[0].content as BankQuestion;
    if (
      q.options.length < 2 ||
      q.options.length > 6 ||
      q.options.filter((o) => o === q.answer).length !== 1
    )
      fail("اختر سؤالًا من خيارين إلى ستة خيارات وإجابة واحدة محددة.", 400);
    const step = {
      ...newLessonStep(createId),
      title: input.objective,
      explanation: "أجب عن السؤال للتحقق من فهم الهدف: " + input.objective,
      question: q.text,
      questionVersionId: input.versionId,
      options: q.options.map((text) => ({
        id: createId(),
        text,
        isCorrect: text === q.answer,
      })),
      correctExplanation: q.explanation || "",
      hint: "",
    };
    const draft = {
      title: "بطاقة خروج — " + input.objective,
      subject: q.subject,
      grade: q.grade,
      objective: input.objective,
      description: "مسودة من سؤال محفوظ — يراجعها المعلم وينشرها ثم يسندها.",
      steps: [step],
    };
    const saved = await pool.query(
      "INSERT INTO teacher_activities(id,owner_id,type,draft) VALUES($1,$2,'guided_steps',$3) RETURNING id",
      [createId(), owner, JSON.stringify(draft)],
    );
    res.status(201).json(saved.rows[0]);
  }),
);
teacherToolsRouter.get(
  "/teacher/tools/resources/:id/uses",
  route(async (req, res) => {
    const owner = req.auth!.userId;
    const r = await pool.query(
      "SELECT id,data FROM teacher_records WHERE id=$1 AND owner_id=$2 AND kind='resources'",
      [uuid.parse(req.params.id), owner],
    );
    if (!r.rowCount) fail();
    const resource = r.rows[0];
    const uses = await pool.query(
      "SELECT id,kind,data->>'title' AS title FROM teacher_records WHERE owner_id=$1 AND archived=false AND ((kind='lessons' AND data->'resourceIds' @> $2::jsonb) OR (kind='documents' AND data->'refs' @> $3::jsonb))",
      [
        owner,
        JSON.stringify([resource.id]),
        JSON.stringify([{ id: resource.data.refId, type: resource.data.type }]),
      ],
    );
    res.json(uses.rows);
  }),
);
async function transaction<T>(fn: (q: PoolClient) => Promise<T>) {
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
async function references(
  q: Pick<PoolClient, "query">,
  owner: string,
  refs: { type: string; id: string }[],
) {
  const map: Record<string, { table: string; extra: string }> = {
    asset: { table: "teacher_assets", extra: "" },
    exam: { table: "teacher_exams", extra: "AND archived=false" },
    lesson_plan: {
      table: "teacher_records",
      extra: "AND kind='lessons' AND archived=false",
    },
    activity: { table: "teacher_activities", extra: "" },
    question: { table: "teacher_question_versions", extra: "" },
  };
  for (const r of refs) {
    const entry = map[r.type];
    if (!entry) fail("مرجع غير صالح.", 400);
    const found = await q.query(
      `SELECT id FROM ${entry.table} WHERE owner_id=$1 AND id=$2 ${entry.extra}`,
      [owner, r.id],
    );
    if (!found.rowCount) fail("أحد الموارد غير متاح لحسابك.", 400);
  }
}
function record(row: Record<string, unknown>) {
  return {
    ...(row.data as object),
    id: row.id,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}
for (const [kind, schema] of Object.entries(schemas)) {
  teacherToolsRouter.get(
    "/teacher/tools/" + kind,
    route(async (req, res) => {
      const r = await pool.query(
        "SELECT * FROM teacher_records WHERE owner_id=$1 AND kind=$2 AND archived=false ORDER BY updated_at DESC",
        [req.auth!.userId, kind],
      );
      res.json(r.rows.map(record));
    }),
  );
  const save: RequestHandler = route(async (req, res) => {
    const data = schema.parse(req.body),
      owner = req.auth!.userId;
    const classId = "classId" in data ? data.classId : null;
    if (classId) {
      const r = await pool.query(
        "SELECT id FROM teacher_classes WHERE id=$1 AND owner_id=$2",
        [classId, owner],
      );
      if (!r.rowCount) fail();
    }
    if (kind === "blueprints")
      await references(
        pool,
        owner,
        (data as z.infer<typeof blueprintSchema>).items.map((i) => ({
          type: "question",
          id: i.versionId,
        })),
      );
    if (kind === "documents")
      await references(
        pool,
        owner,
        (data as z.infer<typeof documentSchema>).refs,
      );
    if (kind === "resources") {
      const r = data as z.infer<typeof resourceSchema>;
      await references(pool, owner, [{ type: r.type, id: r.refId }]);
    }
    if (kind === "calendar") {
      for (const cls of (data as z.infer<typeof calendarSchema>).schedule) {
        const r = await pool.query(
          "SELECT id FROM teacher_classes WHERE id=$1 AND owner_id=$2",
          [cls.classId, owner],
        );
        if (!r.rowCount) fail();
      }
    }
    const r = req.params.id
      ? await pool.query(
          "UPDATE teacher_records SET data=$4,class_id=$5,revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2 AND kind=$3 AND revision=$6 RETURNING *",
          [
            uuid.parse(req.params.id),
            owner,
            kind,
            JSON.stringify(data),
            classId,
            z.number().int().positive().parse(req.body.revision),
          ],
        )
      : await pool.query(
          "INSERT INTO teacher_records(id,owner_id,kind,class_id,data) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [createId(), owner, kind, classId, JSON.stringify(data)],
        );
    if (!r.rowCount) fail("تغير السجل. أعد تحميله.", 409);
    res.status(req.params.id ? 200 : 201).json(record(r.rows[0]));
  });
  teacherToolsRouter.post("/teacher/tools/" + kind, save);
  teacherToolsRouter.put("/teacher/tools/" + kind + "/:id", save);
  teacherToolsRouter.delete(
    "/teacher/tools/" + kind + "/:id",
    route(async (req, res) => {
      const r = await pool.query(
        "UPDATE teacher_records SET archived=true WHERE id=$1 AND owner_id=$2 AND kind=$3 RETURNING id",
        [uuid.parse(req.params.id), req.auth!.userId, kind],
      );
      if (!r.rowCount) fail();
      res.json({ ok: true });
    }),
  );
}
teacherToolsRouter.post(
  "/teacher/tools/blueprints/:id/forms",
  route(async (req, res) => {
    const recordId = uuid.parse(req.params.id),
      owner = req.auth!.userId;
    const result = await transaction(async (q) => {
      const r = await q.query(
        "SELECT * FROM teacher_records WHERE id=$1 AND owner_id=$2 AND kind='blueprints' AND archived=false FOR UPDATE",
        [recordId, owner],
      );
      if (!r.rowCount) fail();
      const b = blueprintSchema.parse(r.rows[0].data);
      const issues = blueprintIssues(b);
      if (issues.length) fail(issues.join("\n"), 400);
      const versions = await q.query(
        "SELECT id,content FROM teacher_question_versions WHERE owner_id=$1 AND id=ANY($2::text[])",
        [owner, b.items.map((i) => i.versionId)],
      );
      if (versions.rowCount !== b.items.length) fail();
      const questions = b.items.map((item) => ({
        ...item,
        question: versions.rows.find((v) => v.id === item.versionId)!
          .content as BankQuestion,
      }));
      if (
        questions.some(
          (q) =>
            q.question.kind === "multiple-choice" &&
            q.question.options.filter((o) => o === q.question.answer).length !==
              1,
        )
      )
        fail("راجع مفتاح الإجابة لكل سؤال اختياري.", 400);
      const forms = parallelForms(questions, Date.now());
      const data = { ...b, forms, generatedAt: new Date().toISOString() };
      const saved = await q.query(
        "UPDATE teacher_records SET data=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *",
        [recordId, owner, JSON.stringify(data)],
      );
      return record(saved.rows[0]);
    });
    res.json(result);
  }),
);
teacherToolsRouter.get(
  "/teacher/tools/grade-summary/:classId",
  route(async (req, res) => {
    const classId = uuid.parse(req.params.classId),
      owner = req.auth!.userId;
    const cls = await pool.query(
      "SELECT id FROM teacher_classes WHERE id=$1 AND owner_id=$2",
      [classId, owner],
    );
    if (!cls.rowCount) fail();
    const students = await pool.query(
      "SELECT id,name FROM teacher_students WHERE class_id=$1 AND owner_id=$2 AND removed=false AND archived=false ORDER BY name",
      [classId, owner],
    );
    const grades = await pool.query(
      "SELECT student_id,data FROM teacher_records WHERE owner_id=$1 AND class_id=$2 AND kind='grades' AND archived=false",
      [owner, classId],
    );
    const profile = await pool.query(
      "SELECT data FROM teacher_profiles WHERE owner_id=$1",
      [owner],
    );
    const precision = profile.rows[0]?.data.gradePrecision ?? 2;
    res.json(
      students.rows.map((s) => ({
        id: s.id,
        name: s.name,
        ...weightedGrade(
          grades.rows
            .filter((g) => g.student_id === s.id)
            .map((g) => ({
              ...g.data,
              weight: g.data.weight ?? g.data.totalMarks,
            })),
          precision,
        ),
        records: grades.rows
          .filter((g) => g.student_id === s.id)
          .map((g) => g.data),
      })),
    );
  }),
);
teacherToolsRouter.post(
  "/teacher/tools/roster-snapshots",
  route(async (req, res) => {
    const { classId, term } = z
        .object({ classId: uuid, term: title })
        .parse(req.body),
      owner = req.auth!.userId;
    const cls = await pool.query(
      "SELECT id FROM teacher_classes WHERE id=$1 AND owner_id=$2",
      [classId, owner],
    );
    if (!cls.rowCount) fail();
    const students = await pool.query(
      "SELECT id,name,internal_id FROM teacher_students WHERE owner_id=$1 AND class_id=$2 AND archived=false AND removed=false ORDER BY name",
      [owner, classId],
    );
    const r = await pool.query(
      "INSERT INTO teacher_roster_snapshots(id,owner_id,class_id,term,students) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [createId(), owner, classId, term, JSON.stringify(students.rows)],
    );
    res.status(201).json(r.rows[0]);
  }),
);
teacherToolsRouter.get(
  "/teacher/tools/roster-snapshots",
  route(async (req, res) => {
    const r = await pool.query(
      'SELECT id,class_id AS "classId",term,students,created_at AS "createdAt" FROM teacher_roster_snapshots WHERE owner_id=$1 ORDER BY created_at DESC',
      [req.auth!.userId],
    );
    res.json(r.rows);
  }),
);
teacherToolsRouter.post(
  "/teacher/tools/planner/shift",
  route(async (req, res) => {
    const input = z
        .object({
          ids: z.array(uuid).min(1).max(200),
          days: z.number().int().min(-365).max(365),
          duplicate: z.boolean().default(false),
        })
        .parse(req.body),
      owner = req.auth!.userId;
    const result = await transaction(async (q) => {
      const rows = await q.query(
        "SELECT * FROM teacher_records WHERE id=ANY($1::text[]) AND owner_id=$2 AND kind='lessons' AND archived=false FOR UPDATE",
        [input.ids, owner],
      );
      if (rows.rowCount !== new Set(input.ids).size) fail();
      const result = [];
      for (const r of rows.rows) {
        const d = new Date(r.data.date + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() + input.days);
        const data = { ...r.data, date: d.toISOString().slice(0, 10) };
        if (input.duplicate) {
          const copyId = createId();
          await q.query(
            "INSERT INTO teacher_records(id,owner_id,kind,class_id,data) VALUES($1,$2,'lessons',$3,$4)",
            [copyId, owner, r.class_id, JSON.stringify(data)],
          );
          result.push(copyId);
        } else {
          await q.query(
            "UPDATE teacher_records SET data=$3,updated_at=now() WHERE id=$1 AND owner_id=$2",
            [r.id, owner, JSON.stringify(data)],
          );
          result.push(r.id);
        }
      }
      return result;
    });
    res.json({ ids: result });
  }),
);
teacherToolsRouter.get(
  "/teacher/tools/export",
  route(async (req, res) => {
    const owner = req.auth!.userId;
    const data: Record<string, unknown> = {
      format: "lootbot-teacher-private-v1",
      exportedAt: new Date().toISOString(),
    };
    for (const table of [
      "teacher_profiles",
      "teacher_classes",
      "teacher_students",
      "teacher_records",
      "teacher_assets",
      "teacher_exams",
      "teacher_rules",
      "teacher_reminders",
      "teacher_activities",
      "teacher_activity_versions",
      "teacher_activity_assignments",
      "teacher_activity_progress",
      "teacher_activity_events",
      "teacher_question_versions",
      "teacher_roster_snapshots",
    ]) {
      const r = await pool.query(`SELECT * FROM ${table} WHERE owner_id=$1`, [
        owner,
      ]);
      data[table] = r.rows.map((row) => {
        if (table === "teacher_activity_events") {
          const { response: _, ...payload } = row.payload;
          return { ...row, payload };
        }
        return row;
      });
    }
    res
      .set(
        "Content-Disposition",
        'attachment; filename="teacher-private-export.json"',
      )
      .json(data);
  }),
);
teacherToolsRouter.post(
  "/teacher/tools/delete-data",
  route(async (req, res) => {
    z.object({ confirmation: z.literal("DELETE_TEACHER_DATA") }).parse(
      req.body,
    );
    await transaction(async (q) => {
      for (const table of [
        "teacher_student_sessions",
        "teacher_activity_events",
        "teacher_activity_progress",
        "teacher_activity_assignments",
        "teacher_activity_versions",
        "teacher_activities",
        "teacher_template_shares",
        "teacher_roster_snapshots",
        "teacher_question_versions",
        "teacher_records",
        "teacher_exams",
        "teacher_student_access",
        "teacher_class_access",
        "teacher_students",
        "teacher_classes",
        "teacher_assets",
        "teacher_reminders",
        "teacher_rules",
        "teacher_profiles",
      ])
        await q.query(`DELETE FROM ${table} WHERE owner_id=$1`, [
          req.auth!.userId,
        ]);
    });
    res.json({ ok: true });
  }),
);
