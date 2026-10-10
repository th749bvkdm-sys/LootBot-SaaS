import { z } from "zod";
const text = (max = 1000) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !s.includes("\u0000"), "النص يحتوي رمزًا غير صالح");
const required = (max = 180) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !s.includes("\u0000"), "النص يحتوي رمزًا غير صالح");
const nullableId = z.string().uuid().nullable().optional().default(null);
export function validTeacherDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !value.startsWith("0000-") &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
const date = z.string().refine(validTeacherDate, "التاريخ غير صالح");
const due = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .optional()
  .default(null);
export const teacherProfileSchema = z
  .object({
    teacherName: text(180).default(""),
    schoolName: text(180).default(""),
    stage: z
      .enum([
        "",
        "primary",
        "middle",
        "secondary",
        "other",
        "ابتدائي",
        "متوسط",
        "ثانوي",
        "أخرى",
      ])
      .default(""),
    subjects: z.array(required()).max(30).default([]),
    classes: z.array(required()).max(50).default([]),
    term: text(100).default(""),
    year: text(50).default(""),
    city: text(100).default(""),
    printStyle: z.enum(["formal", "primary", "minimal"]).default("formal"),
    digits: z.enum(["arabic", "western"]).default("arabic"),
    paperSize: z.literal("A4").default("A4"),
    logoAssetId: nullableId,
    signature: text(180).default(""),
    onboardingStep: z.number().int().min(0).max(10).default(0),
    complete: z.boolean().default(false),
  })
  .refine(
    (p) => !p.complete || Boolean(p.teacherName && p.schoolName),
    "اسم المعلم والمدرسة مطلوبان لإتمام الإعداد",
  );
export const teacherClassSchema = z.object({
  name: required(),
  grade: text(80).default(""),
  section: text(80).default(""),
  subject: text(120).default(""),
  year: text(50).default(""),
  term: text(100).default(""),
  notes: text(4000).default(""),
  archived: z.boolean().default(false),
  gradebookTemplate: z
    .array(
      z.object({
        title: required(),
        totalMarks: z.number().min(0.1).max(10000),
      }),
    )
    .max(30)
    .default([
      { title: "المشاركة", totalMarks: 10 },
      { title: "الواجبات", totalMarks: 10 },
      { title: "اختبار قصير", totalMarks: 20 },
    ]),
});
export const teacherStudentSchema = z.object({
  classId: z.string().uuid(),
  name: required(),
  internalId: text(80).default(""),
  notes: text(4000).default(""),
  archived: z.boolean().default(false),
  removed: z.boolean().default(false),
});
export const importSchema = z.object({
  classId: z.string().uuid(),
  rows: z
    .array(
      z.object({
        name: z.string().max(500),
        internalId: z.string().max(200).optional().default(""),
        notes: z.string().max(5000).optional().default(""),
      }),
    )
    .min(1)
    .max(2000),
  mode: z.enum(["add", "update"]).optional().default("add"),
});
const studentId = z.string().uuid();
export const attendanceSchema = z
  .object({
    classId: z.string().uuid(),
    date,
    entries: z
      .array(
        z.object({
          studentId,
          status: z.enum(["present", "absent", "late", "excused"]),
          note: text(500).default(""),
        }),
      )
      .max(500),
  })
  .refine(
    (d) => new Set(d.entries.map((e) => e.studentId)).size === d.entries.length,
    "تكرار الطالب في الحضور",
  );
export const gradeSchema = z
  .object({
    classId: z.string().uuid(),
    studentId,
    title: required(),
    totalMarks: z.number().min(0.1).max(10000),
    marks: z.number().min(0).nullable().default(null),
    date,
    note: text(2000).default(""),
    archived: z.boolean().default(false),
  })
  .refine(
    (d) => d.marks === null || d.marks <= d.totalMarks,
    "الدرجة تتجاوز الدرجة الكلية",
  );
export const taskSchema = z.object({
  title: required(),
  classId: nullableId,
  kind: z.enum(["assignment", "task"]).default("task"),
  dueAt: due,
  status: z.enum(["pending", "completed"]).default("pending"),
  notes: text(6000).default(""),
  studentCompletion: z.array(studentId).max(500).default([]),
  archived: z.boolean().default(false),
});
export const lessonSchema = z.object({
  title: required(),
  classId: nullableId,
  date,
  objectives: text(10000).default(""),
  content: text(20000).default(""),
  homework: text(10000).default(""),
  archived: z.boolean().default(false),
});
export const questionSchema = z.object({
  text: required(10000),
  subject: text(120).default(""),
  grade: text(80).default(""),
  kind: z.enum(["text", "multiple-choice", "true-false"]).default("text"),
  options: z.array(text(2000)).max(20).default([]),
  answer: text(5000).default(""),
  marks: z.number().min(0).max(10000).default(1),
  tags: z.array(text(60)).max(30).default([]),
  archived: z.boolean().default(false),
});
export const assessmentSchema = z.object({
  title: required(),
  classId: z.string().uuid(),
  date,
  totalMarks: z.number().min(0.1).max(10000),
  archived: z.boolean().default(false),
});
export const teacherRecordSchemas = {
  grades: gradeSchema,
  tasks: taskSchema,
  lessons: lessonSchema,
  questions: questionSchema,
  assessments: assessmentSchema,
};
export const ruleSchema = z.object({
  name: required(),
  type: z.enum([
    "upcoming",
    "absence",
    "grading",
    "weekly",
    "draft",
    "recurring",
  ]),
  enabled: z.boolean().default(true),
  config: z
    .object({
      threshold: z.number().int().min(1).max(100).optional(),
      daysBefore: z.number().int().min(0).max(90).optional(),
      weekDay: z.number().int().min(0).max(6).optional(),
      hour: z.number().int().min(0).max(23).optional(),
      title: text(180).optional(),
      intervalDays: z.number().int().min(1).max(365).optional(),
      classId: z.string().uuid().optional(),
      dueAt: z.string().datetime({ offset: true }).optional(),
    })
    .default({}),
});
const questionBlock = z.object({
  id: required(100),
  text: text(20000),
  kind: z.enum(["written", "choice", "true-false", "blank"]),
  marks: z.number().min(0).max(10000),
  answerLines: z.number().int().min(0).max(40),
  options: z.array(text(5000)).max(30),
  subquestions: z.array(text(10000)).max(50),
  pageBreakBefore: z.boolean(),
  requiresReview: z.boolean(),
  reviewNote: text(4000),
});
export const examDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    metadata: z.object({
      title: text(180),
      school: text(180),
      teacher: text(180),
      subject: text(180),
      grade: text(180),
      term: text(180),
      date: z
        .string()
        .refine((s) => !s || validTeacherDate(s), "التاريخ غير صالح"),
      duration: text(100),
      totalMarks: z.number().min(0).max(100000),
      instructions: text(20000),
      studentNameLine: z.boolean(),
      studentNumberLine: z.boolean(),
      schoolLogoAssetId: z.string().uuid().nullable(),
    }),
    layout: z.object({
      style: z.enum(["formal", "primary", "minimal"]),
      paper: z.literal("A4"),
      marginMm: z.number().min(5).max(35),
      fontSize: z.number().min(10).max(28),
      lineSpacing: z.number().min(1).max(3),
      questionSpacing: z.number().min(0).max(60),
      alignment: z.enum(["right", "center", "left"]),
      accent: z.string().regex(/^#[\da-f]{6}$/i),
      header: text(2000),
      footer: text(2000),
      pageNumbers: z.boolean(),
      digits: z.enum(["arabic", "western"]),
      font: z.enum(["arabic", "sans"]),
    }),
    source: z.object({
      adjustments: z.object({
        rotation: z.number().min(-360).max(360),
        straighten: z.number().min(-45).max(45),
        brightness: z.number().min(20).max(300),
        contrast: z.number().min(20).max(300),
        crop: z
          .object({
            x: z.number().min(0).max(100),
            y: z.number().min(0).max(100),
            width: z.number().min(1).max(100),
            height: z.number().min(1).max(100),
          })
          .refine(
            (c) => c.x + c.width <= 100 && c.y + c.height <= 100,
            "حدود القص تتجاوز الصورة",
          ),
      }),
      processedAssetId: z.string().uuid().nullable(),
      printBackground: z.boolean(),
      ocrStatus: z.enum(["none", "manual", "completed", "error"]),
      ocrText: text(100000),
      reviewed: z.boolean(),
    }),
    sections: z
      .array(
        z.object({
          id: required(100),
          title: text(1000),
          instructions: text(10000),
          pageBreakBefore: z.boolean(),
          questions: z.array(questionBlock).max(200),
        }),
      )
      .max(100),
  })
  .refine((document) => {
    const ids = document.sections.flatMap((section) => [
      section.id,
      ...section.questions.map((question) => question.id),
    ]);
    return new Set(ids).size === ids.length;
  }, "معرّفات أقسام وأسئلة الاختبار يجب أن تكون مميزة");
export const examSchema = z.object({
  title: required(),
  document: examDocumentSchema,
  sourceAssetId: nullableId,
  isTemplate: z.boolean().default(false),
  expectedVersion: z.number().int().positive().optional(),
});
export function normalizeInternalId(value: string): string {
  return value
    .trim()
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776));
}
export function normalizeStudentName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ar");
}
export function safeCsvCell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export function validateTeacherImage(bytes: Buffer, mimeType: string): boolean {
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) return false;
  let width = 0,
    height = 0;
  if (mimeType === "image/png") {
    if (
      bytes.length < 45 ||
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.toString("ascii", 12, 16) !== "IHDR" ||
      !bytes.includes(Buffer.from("IEND"))
    )
      return false;
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (mimeType === "image/jpeg") {
    if (
      bytes.length < 20 ||
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes[bytes.length - 2] !== 255 ||
      bytes[bytes.length - 1] !== 217
    )
      return false;
    for (let i = 2; i + 8 < bytes.length;) {
      if (bytes[i] !== 255) break;
      const marker = bytes[i + 1];
      if (marker === 218) break;
      const length = bytes.readUInt16BE(i + 2);
      if (length < 2 || i + length + 2 > bytes.length) return false;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        height = bytes.readUInt16BE(i + 5);
        width = bytes.readUInt16BE(i + 7);
        break;
      }
      i += length + 2;
    }
  } else if (mimeType === "image/webp") {
    if (
      bytes.length < 30 ||
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WEBP" ||
      bytes.readUInt32LE(4) + 8 !== bytes.length
    )
      return false;
    const format = bytes.toString("ascii", 12, 16);
    if (format === "VP8X") {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    } else if (
      format === "VP8 " &&
      bytes[23] === 157 &&
      bytes[24] === 1 &&
      bytes[25] === 42
    ) {
      width = bytes.readUInt16LE(26) & 16383;
      height = bytes.readUInt16LE(28) & 16383;
    } else if (format === "VP8L" && bytes[20] === 47) {
      const bits = bytes.readUInt32LE(21);
      width = (bits & 16383) + 1;
      height = ((bits >>> 14) & 16383) + 1;
    } else return false;
  } else return false;
  return (
    width > 0 &&
    height > 0 &&
    width <= 16000 &&
    height <= 16000 &&
    width * height <= 40_000_000
  );
}
