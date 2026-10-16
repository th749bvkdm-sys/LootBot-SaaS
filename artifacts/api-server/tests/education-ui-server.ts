/** Local-only, disposable PostgreSQL preview. This file is never imported by the application. */
import express from "express";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import app from "../src/app";
import { sha256, newOpaqueToken } from "../src/lib/security";
import { normalizedQuestionHash } from "../src/lib/quant-content";
import { seedLicensedQuantPreview } from "./seed-licensed-quant-preview";
if (
  process.env.NODE_ENV !== "test" ||
  !/^teacher_qa_[a-f0-9]{32}$/.test(process.env.TEACHER_TEST_SCHEMA || "")
)
  throw Error("A disposable local schema is required.");
const people = {
  admin: randomUUID(),
  teacher: randomUUID(),
  student: randomUUID(),
  manager: randomUUID(),
  content: randomUUID(),
  support: randomUUID(),
  pending: randomUUID(),
};
const cookies = new Map<string, { token: string; csrf: string }>();
for (const [name, uid] of Object.entries(people)) {
  const type = ["student", "pending"].includes(name)
    ? "student"
    : name === "teacher"
      ? "teacher"
      : "merchant";
  await pool.query(
    "INSERT INTO users(id,name,email,password_hash,role,account_type) VALUES($1,$2,$3,$4,$5,$6)",
    [
      uid,
      (
        {
          admin: "مدير العرض المحلي",
          teacher: "أ. محمد • معاينة محلية",
          student: "طالب العرض المحلي",
          manager: "مدير مدرسة تجريبية",
          content: "مؤلف محتوى تجريبي",
          support: "الدعم المحلي",
          pending: "طالب ينتظر الموافقة",
        } as any
      )[name],
      name + "@example.invalid",
      newOpaqueToken(),
      name === "admin" ? "SUPERADMIN" : "OWNER",
      type,
    ],
  );
  const token = newOpaqueToken(),
    csrf = newOpaqueToken();
  await pool.query(
    "INSERT INTO sessions(id,user_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '8 hours')",
    [randomUUID(), uid, sha256(token), sha256(csrf)],
  );
  cookies.set(name, { token, csrf });
}
const school = randomUUID(),
  classId = randomUUID();
await pool.query(
  "INSERT INTO education_schools(id,name,data) VALUES($1,$2,$3::jsonb)",
  [
    school,
    "مدرسة الآفاق • بيانات معاينة محلية",
    JSON.stringify({
      stages: ["ثانوي"],
      grades: ["الثالث"],
      terms: ["الفصل الأول"],
    }),
  ],
);
for (const [name, role, scope] of [
  ["manager", "SCHOOL_ADMIN", school],
  ["teacher", "TEACHER", school],
  ["content", "CONTENT_MANAGER", ""],
  ["support", "SUPPORT", ""],
])
  await pool.query(
    "INSERT INTO education_grants(id,user_id,role,scope) VALUES($1,$2,$3,$4)",
    [randomUUID(), people[name as keyof typeof people], role, scope],
  );
const profile = {
  teacherName: "أ. محمد • معاينة محلية",
  schoolName: "مدرسة الآفاق • بيانات معاينة محلية",
  stage: "ثانوي",
  subjects: ["الرياضيات", "اللغة العربية"],
  classes: ["الثالث أ"],
  term: "الفصل الأول",
  year: "1448 / 1449",
  printStyle: "formal",
  digits: "arabic",
  paperSize: "A4",
  complete: true,
};
await pool.query(
  "INSERT INTO teacher_profiles(owner_id,data,complete) VALUES($1,$2::jsonb,true)",
  [people.teacher, JSON.stringify(profile)],
);
await pool.query(
  "INSERT INTO teacher_classes(id,owner_id,name,data) VALUES($1,$2,$3,$4::jsonb)",
  [
    classId,
    people.teacher,
    "الثالث أ • فصل العرض",
    JSON.stringify({
      grade: "الثالث",
      stage: "ثانوي",
      subject: "القدرات",
      section: "أ",
      year: "1448 / 1449",
      term: "الفصل الأول",
    }),
  ],
);
await pool.query(
  "INSERT INTO education_school_classes(class_id,school_id) VALUES($1,$2)",
  [classId, school],
);
// Reproduce student code issuance on a teacher-owned class without a school link.
await pool.query(
  "INSERT INTO teacher_classes(id,owner_id,name,data) VALUES($1,$2,$3,$4::jsonb)",
  [randomUUID(), people.teacher, "فصل مستقل • تجربة الرموز المحلية", JSON.stringify({ grade: "الثالث", stage: "ثانوي", subject: "القدرات" })],
);
for (const name of ["student", "pending"] as const) {
  const roster = randomUUID();
  await pool.query(
    "INSERT INTO teacher_students(id,owner_id,class_id,name,internal_id,archived) VALUES($1,$2,$3,$4,$5,$6)",
    [
      roster,
      people.teacher,
      classId,
      name === "student" ? "طالب العرض المحلي" : "طالب ينتظر الموافقة",
      "account:" + people[name],
      name === "pending",
    ],
  );
  await pool.query(
    "INSERT INTO education_enrollments(id,user_id,school_id,class_id,roster_id,status) VALUES($1,$2,$3,$4,$5,$6)",
    [
      randomUUID(),
      people[name],
      school,
      classId,
      roster,
      name === "pending" ? "pending" : "active",
    ],
  );
}
const skill = (
  await pool.query(
    "SELECT id FROM education_categories WHERE track='quantitative' AND name='النسبة المئوية' LIMIT 1",
  )
).rows[0].id;
const verbal = (
  await pool.query(
    "SELECT id FROM education_categories WHERE track='verbal' AND name='استنتاج الفكرة الرئيسية' LIMIT 1",
  )
).rows[0].id;
const questions = [];
for (let i = 1; i <= 8; i++) {
  const qid = randomUUID(),
    base = i * 100,
    text = `ما قيمة 20٪ من ${base}؟`,
    correct = base / 5,
    content = {
      options: [
        { text: String(correct), explanation: "20 من كل 100." },
        { text: String(base / 4), explanation: "هذا يمثل 25٪، لا 20٪." },
        { text: String(base / 10), explanation: "هذا يمثل 10٪." },
        { text: String(base / 2), explanation: "هذا يمثل 50٪." },
      ],
      answer: 0,
      explanation: `نضرب ${base} في 20 ثم نقسم على 100، فيكون الناتج ${correct}.`,
      source: "سؤال أصلي للمعاينة المحلية",
      rights: "original",
      license: "",
      allowSave: true,
      passage: "",
    };
  await pool.query(
    "INSERT INTO education_questions(id,category_id,text,fingerprint,difficulty,content,status,author_id,reviewed_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)",
    [
      qid,
      skill,
      text,
      sha256(text),
      "easy",
      JSON.stringify(content),
      "published",
      people.content,
      people.admin,
    ],
  );
  await pool.query(
    "INSERT INTO education_question_versions(id,question_id,number,snapshot) VALUES($1,$2,1,$3::jsonb)",
    [
      randomUUID(),
      qid,
      JSON.stringify({
        categoryId: skill,
        text,
        difficulty: "easy",
        status: "published",
        content,
      }),
    ],
  );
  questions.push(qid);
}
for (let i = 1; i <= 3; i++) {
  const qid = randomUUID(),
    text = `اختر الفكرة الرئيسية للنص التدريبي ${i}.`,
    content = {
      options: [
        {
          text: "الاستمرار في التعلم مع مراجعة الأخطاء",
          explanation: "يشمل الخطوات المذكورة كلها.",
        },
        {
          text: "الاعتماد على الحفظ وحده",
          explanation: "النص يركز على الفهم والمراجعة.",
        },
        { text: "تجاهل الأخطاء", explanation: "النص يحث على مراجعتها." },
        {
          text: "التوقف بعد أول محاولة",
          explanation: "النص يتحدث عن الاستمرار.",
        },
      ],
      answer: 0,
      explanation: "تربط الفكرة الرئيسية بين التدريب والمراجعة والتحسن.",
      passage:
        "يعيد المتعلم النظر في إجاباته، ويبحث عن سبب الخطأ، ثم يتدرّب على مهارته من جديد. تساعده هذه الخطوات على فهم ما تعلمه والاستمرار فيه.",
      source: "نص أصلي للمعاينة المحلية",
      rights: "original",
      license: "",
      allowSave: true,
    };
  await pool.query(
    "INSERT INTO education_questions(id,category_id,text,fingerprint,difficulty,content,status,author_id,reviewed_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)",
    [
      qid,
      verbal,
      text,
      sha256(text),
      "medium",
      JSON.stringify(content),
      "published",
      people.content,
      people.admin,
    ],
  );
}
// Sources begin unverified. The private owner-authorized pack is gated separately below.
const authoredSource = randomUUID();
for (const [fileName,fileSize,fileHash] of [
  ["_الاقسام_الحمراء_كامله_1_40_دعواتكم_لي_.pdf",40243747,"598111922c1e729c3c4a2150d57ba52fdbbf0b00591609525b42ad57a4b497c5"],
  ["__المفكر 120 تحديث (١)_ (1).pdf",42155103,"3d7c9c2034b8e326d7242b0ffea44e08b58d7f5b40db765a4697f3adeea35c2b"],
  ["محدث (٢) الاصدارات المجانية.pdf",72644275,"ee22a294343e507da39ba965df7c84f4b0e26063cb9f8bc6d276e653b1b69299"],
] as const) {
  await pool.query("INSERT INTO quant_sources(id,title,file_name,file_hash,file_size,created_by) VALUES($1,$2,$3,$4,$5,$6)",
    [randomUUID(),fileName,fileName,fileHash,fileSize,people.admin]);
}
await pool.query(
  `INSERT INTO quant_sources(id,title,file_name,file_hash,file_size,license_status,license_note,attribution,source_url,page_count,created_by)
   VALUES($1,$2,$3,$4,0,'verified',$5,$6,$7,1,$8)`,
  [authoredSource,"مسائل النسبة المئوية • تأليف محلي", "education-ui-server.ts",sha256("education-ui-server original percentage fixtures v1"),
   "مسائل أصلية مؤلفة في education-ui-server.ts ومصرح باستخدامها في هذه المعاينة المحلية. لا تتضمن محتوى من ملفات PDF المرفقة.",
   "محتوى أصلي للمعاينة المحلية فقط", "",people.admin],
);
const quantVersions = (await pool.query(
  `SELECT v.id,q.id AS question_id,q.text FROM education_questions q JOIN education_question_versions v ON v.question_id=q.id AND v.number=q.revision WHERE q.id=ANY($1::text[]) ORDER BY q.text`,
  [questions],
)).rows;
for (const version of quantVersions) {
  await pool.query(`INSERT INTO quant_question_reviews(version_id,question_id,source_id,source_page,review_status,normalized_hash,skill,review_note,reviewed_by) VALUES($1,$2,$3,1,'approved',$4,$5,$6,$7)`,
    [version.id,version.question_id,authoredSource,normalizedQuestionHash(version.text),"النسبة المئوية","مسألة أصلية راجعها مسؤول المعاينة المحلية.",people.admin]);
  await pool.query("INSERT INTO quant_question_sources(id,question_id,source_id,source_page) VALUES($1,$2,$3,1)",[randomUUID(),version.question_id,authoredSource]);
}
for (const [title,mode,limit,amount] of [
  ["رحلة النسبة المئوية • اختبار محلي", "timed", 600, 5],
  ["ثلاث خطوات نحو الفهم • تدريب أصلي", "practice", null, 3],
] as const) {
  const quantTestId = randomUUID();
  await pool.query(`INSERT INTO quant_tests(id,title,description,mode,time_limit_sec,reveal_policy,status,school_id,class_id,created_by) VALUES($1,$2,$3,$4,$5,'after_submit','hidden',$6,$7,$8)`,
    [quantTestId,title,"أسئلة أصلية للمعاينة المحلية. النتيجة تحسب من إجاباتك الفعلية.",mode,limit,school,classId,people.admin]);
  for (const [position,version] of quantVersions.slice(0,amount).entries()) await pool.query("INSERT INTO quant_test_items(test_id,version_id,position) VALUES($1,$2,$3)",[quantTestId,version.id,position]);
}
// Original, numbered content is approved only in this guarded disposable preview.
// Production import-quant-original.mjs deliberately imports drafts and cannot approve them.
const originalPackText = await readFile("../../docs/quant/ORIGINAL_QUESTIONS.json", "utf8");
const originalPack = JSON.parse(originalPackText);
if (originalPack.packId !== "lootbot-quant-original-v1" || originalPack.questions.length !== 30)
  throw Error("The original local preview pack is missing or has changed unexpectedly.");
const originalPackSource = randomUUID();
await pool.query(
  `INSERT INTO quant_sources(id,title,file_name,file_hash,file_size,license_status,license_note,attribution,page_count,created_by)
   VALUES($1,$2,$3,$4,$5,'verified',$6,$7,30,$8)`,
  [originalPackSource, originalPack.title + " • معاينة محلية", "ORIGINAL_QUESTIONS.json", sha256(originalPackText), Buffer.byteLength(originalPackText, "utf8"),
   "حزمة تأليف أصلية أذن المالك بإعدادها. تحقق المسؤول التجريبي من استخدامها في هذه المعاينة المحلية فقط، وليس اعتمادًا أو نشرًا للإنتاج. sourcePage رقم المدخل المؤلف، لا صفحة PDF. لم يُستخرج أي محتوى من ملفات PDF المرفقة.",
   originalPack.attribution + " • بيانات عرض محلية مؤقتة؛ 30 مدخلًا مرقمًا وليس 30 صفحة PDF.", people.admin],
);
const originalPackCategories = (await pool.query("SELECT id,name FROM education_categories WHERE track='quantitative' AND school_id IS NULL AND class_id IS NULL ORDER BY position,id")).rows;
const originalPackVersions: { id: string; questionId: string; sourcePage: number }[] = [];
for (const question of originalPack.questions) {
  const category = originalPackCategories.find(row => row.name === question.skill);
  if (!category) throw Error("An original pack skill is missing from the quantitative taxonomy.");
  const questionId = randomUUID(), versionId = randomUUID(), content = {
    options: question.choices.map((choice: { text: string }) => ({ text: choice.text, explanation: "" })),
    answer: question.choices.findIndex((choice: { key: string }) => choice.key === question.correctKey),
    explanation: question.explanation, passage: "", source: originalPack.title, rights: "original", license: "تأليف أصلي مصرح بمعاينته محليًا فقط.",
    allowSave: true, stemImages: [], originalPackRef: question.ref,
  };
  await pool.query(
    "INSERT INTO education_questions(id,category_id,text,fingerprint,difficulty,content,status,author_id,reviewed_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,'published',$7,$8)",
    [questionId, category.id, question.stem, sha256(question.stem.normalize("NFKC").replace(/\s+/g, " ").trim()), question.difficulty, JSON.stringify(content), people.teacher, people.admin],
  );
  await pool.query("INSERT INTO education_question_versions(id,question_id,number,snapshot) VALUES($1,$2,1,$3::jsonb)",
    [versionId, questionId, JSON.stringify({ categoryId: category.id, text: question.stem, difficulty: question.difficulty, status: "published", content })]);
  await pool.query("INSERT INTO quant_question_reviews(version_id,question_id,source_id,source_page,review_status,normalized_hash,skill,review_note,reviewed_by) VALUES($1,$2,$3,$4,'approved',$5,$6,$7,$8)",
    [versionId, questionId, originalPackSource, question.sourcePage, normalizedQuestionHash(question.stem), question.skill, "معاينة محلية فقط؛ المؤلف معلم تجريبي والمراجع حساب إداري منفصل. الحل الحسابي تحقق بأداة الحزمة الأصلية.", people.admin]);
  await pool.query("INSERT INTO quant_question_sources(id,question_id,source_id,source_page) VALUES($1,$2,$3,$4)", [randomUUID(), questionId, originalPackSource, question.sourcePage]);
  originalPackVersions.push({ id: versionId, questionId, sourcePage: question.sourcePage });
}
const originalPackTest = randomUUID();
await pool.query(
  `INSERT INTO quant_tests(id,title,description,mode,time_limit_sec,reveal_policy,status,school_id,class_id,created_by)
   VALUES($1,$2,$3,'untimed',NULL,'after_submit','hidden',$4,$5,$6)`,
  [originalPackTest, "بداية الكمي • ثلاثون مسألة أصلية", "معاينة محلية أصلية تشمل 13 مهارة. ليست أسئلة PDF أو توقعًا لدرجة رسمية. الحلول تظهر بعد التسليم.", school, classId, people.admin],
);
for (const [position, version] of originalPackVersions.entries())
  await pool.query("INSERT INTO quant_test_items(test_id,version_id,position) VALUES($1,$2,$3)", [originalPackTest, version.id, position]);
console.log("LICENSED_QUANT_LOCAL_PREVIEW", JSON.stringify(await seedLicensedQuantPreview(people.admin, school, classId)));
await pool.query(
  "INSERT INTO education_assignments(id,class_id,owner_id,title,question_ids,due_at) VALUES($1,$2,$3,$4,$5::jsonb,now()+interval '7 days')",
  [
    randomUUID(),
    classId,
    people.teacher,
    "مهارة النسبة المئوية • تدريب أسبوعي",
    JSON.stringify(questions.slice(0, 5)),
  ],
);
await pool.query(
  `UPDATE education_assignments SET snapshot=(SELECT jsonb_agg(to_jsonb(q)) FROM education_questions q WHERE q.id IN (SELECT jsonb_array_elements_text(education_assignments.question_ids)))`,
);
const lessonId = randomUUID(),
  lessonVersion = randomUUID(),
  lessonAssignment = randomUUID();
const lesson = {
  title: "رحلة النسبة المئوية • نشاط محلي",
  subject: "الرياضيات",
  grade: "الثالث",
  objective: "فهم معنى النسبة المئوية وحسابها",
  description: "نشاط أصلي قصير لعرض ربط غرفة المعلم بحساب الطالب.",
  steps: [
    {
      id: randomUUID(),
      title: "افهم النسبة",
      explanation: "النسبة المئوية تعني أجزاء من كل مئة. 20٪ من 100 تساوي 20.",
      question: "كم تساوي 20٪ من 200؟",
      options: [
        { id: randomUUID(), text: "40", isCorrect: true },
        { id: randomUUID(), text: "20", isCorrect: false },
      ],
      hint: "ضاعف المثال عندما يتضاعف العدد.",
      correctExplanation: "200 × 20 ÷ 100 = 40.",
    },
  ],
};
await pool.query(
  "INSERT INTO teacher_activities(id,owner_id,type,draft,status) VALUES($1,$2,'guided_steps',$3::jsonb,'published')",
  [lessonId, people.teacher, JSON.stringify(lesson)],
);
await pool.query(
  "INSERT INTO teacher_activity_versions(id,activity_id,owner_id,number,content) VALUES($1,$2,$3,1,$4::jsonb)",
  [lessonVersion, lessonId, people.teacher, JSON.stringify(lesson)],
);
await pool.query(
  "INSERT INTO teacher_activity_assignments(id,owner_id,version_id,class_id,due_at) VALUES($1,$2,$3,$4,now()+interval '7 days')",
  [lessonAssignment, people.teacher, lessonVersion, classId],
);
await pool.query(
  "INSERT INTO education_announcements(id,class_id,author_id,title,body) VALUES($1,$2,$3,$4,$5)",
  [
    randomUUID(),
    classId,
    people.teacher,
    "رحلة تعلم جديدة",
    "ابدأ باختبار تشخيصي قصير، ثم اختر المهارة التي تحتاج تدريبًا. كل محاولة فرصة جديدة للفهم.",
  ],
);
await pool.query(
  "INSERT INTO education_personal(id,user_id,author_id,kind,data) VALUES($1,$2,$3,$4,$5::jsonb)",
  [
    randomUUID(),
    people.student,
    people.teacher,
    "plan",
    JSON.stringify({
      title: "خطة النسبة المئوية",
      note: "اقرأ الشرح، ثم حل خمس مسائل، وراجع السؤال الذي تعثر فيه فهمك.",
      target: 10,
      dailyMinutes: 20,
      completed: false,
    }),
  ],
);
await pool.query(
  "INSERT INTO education_help(id,kind,owner_id,title,body,status) VALUES($1,$2,$3,$4,$5,$6)",
  [
    randomUUID(),
    "faq",
    people.content,
    "كيف أراجع خطئي؟",
    "افتح نتيجة التدريب، اقرأ شرح الحل، واكتب سبب الخطأ في دفترك الخاص. بعد مدة المراجعة اختر «مراجعة الأخطاء» من مركز القدرات.",
    "published",
  ],
);
const preview = express();
let failQuantWrites = false;
// Local QA only: simulate a failed save without disabling the user's real network connection.
preview.get("/__preview/quant-network", (req, res) => {
  if (req.query.mode === "fail") failQuantWrites = true;
  if (req.query.mode === "restore") failQuantWrites = false;
  res.set("Cache-Control", "no-store");
  res.type("html").send(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>التحقق المحلي من فشل الحفظ</title><body style="font:18px system-ui;background:#101827;color:#f1f5ff;padding:32px"><h1>التحقق المحلي من فشل الحفظ</h1><p role="status">${failQuantWrites ? "حفظ إجابات ومسودات الكمي يرجع HTTP 503 مؤقتًا." : "الحفظ يعمل بصورة عادية."}</p><form method="get"><button name="mode" value="fail">تعطيل حفظ المعاينة (503)</button> <button name="mode" value="restore">استعادة الحفظ</button></form><p>قاعدة تجريبية محلية فقط. هذا يختبر فشل الطلبات وإعادة المحاولة، ولا يقطع اتصال الجهاز بالإنترنت.</p></body></html>`);
});
preview.use("/api/quant", (req, res, next) => {
  if (failQuantWrites && req.method === "PUT") return void res.status(503).json({ error: "فشل حفظ تجريبي محلي؛ احتفظ بالمسودة وأعد المحاولة.", code: "LOCAL_QA_WRITE_FAILURE" });
  next();
});
preview.get("/__preview/:role", (req, res) => {
  const auth = cookies.get(req.params.role);
  if (!auth) return void res.status(404).send("Unknown preview role.");
  res.clearCookie("lootbot_student", { path: "/" });
  res.clearCookie("lootbot_student_csrf", { path: "/" });
  res.cookie("lootbot_session", auth.token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
  });
  res.cookie("lootbot_csrf", auth.csrf, { sameSite: "strict", path: "/" });
  res.redirect(
    req.params.role === "teacher"
      ? "/teacher"
      : req.params.role === "student" || req.params.role === "pending"
        ? "/student"
        : "/education",
  );
});
preview.use(app);
const previewPort = Number(process.env.EDUCATION_PREVIEW_PORT || 5191);
const server = preview.listen(previewPort, "127.0.0.1", () =>
  console.log(
    `EDUCATION_PREVIEW_READY http://127.0.0.1:${previewPort}/__preview/admin (local disposable data only)`,
  ),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await new Promise<void>((r) => server.close(() => r()));
  await pool.end();
  process.exit(0);
}
process.stdin.resume();
process.stdin.on("data", (data) => {
  if (data.toString().includes("stop")) void close();
});
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
