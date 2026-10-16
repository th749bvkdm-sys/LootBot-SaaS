import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { pool, type PoolClient } from "@workspace/db";
import { requireAuth, requireCsrf } from "../lib/auth-middleware";
import { actor, root, authorize, permission, transaction, EducationError, questionFingerprint, settings } from "../lib/education";
import { createId } from "../lib/security";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { readStoredQuantFigure } from "../lib/quant-figure-storage.mjs";
import { assertSourceCanBeImported, normalizedQuestionHash, questionJson, sourceJson, validateQuestion, QuantContentError, quantLicenseStatuses, quantReviewStatuses } from "../lib/quant-content";

export const quantContentRouter = Router();
const id = z.string().uuid(), note = z.string().trim().max(20000);
const route = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (error) {
    if (error instanceof QuantContentError) res.status(error.status).json({ error: error.message, code: error.code, ...error.details });
    else if (error instanceof EducationError) res.status(error.status).json({ error: error.message, code: "FORBIDDEN" });
    else if (error instanceof z.ZodError) res.status(400).json({ error: "تحقق من الحقول والقيم المطلوبة.", code: "INVALID_INPUT" });
    else if ((error as any)?.code === "23505") res.status(409).json({ error: "المصدر أو المحتوى مسجل بالفعل.", code: "DUPLICATE" });
    else next(error);
  }
};
quantContentRouter.use("/quant/admin", requireAuth, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (req.method !== "GET") { requireCsrf(req, res, next); return; }
  next();
});
async function log(q: Pick<PoolClient, "query">, req: Request, action: string, resource: string, before: unknown, after: unknown) {
  await q.query("INSERT INTO audit_logs(id,user_id,action,summary,details) VALUES($1,$2,$3,$4,$5::jsonb)", [createId(), actor(req), "education.quant." + action, "إدارة محتوى القدرات: " + action, JSON.stringify({ resource, before, after })]);
}
async function source(q: Pick<PoolClient, "query">, sid: string, lock = false) {
  const row = (await q.query("SELECT * FROM quant_sources WHERE id=$1" + (lock ? " FOR UPDATE" : ""), [sid])).rows[0];
  if (!row) throw new QuantContentError(404, "NOT_FOUND", "المصدر غير متاح.");
  return row;
}
quantContentRouter.get("/quant/admin/sources", route(async (req, res) => {
  await authorize(req, "quant.sources.read");
  res.json((await pool.query("SELECT * FROM quant_sources ORDER BY created_at DESC LIMIT 500")).rows.map(sourceJson));
}));
const sourceBody = z.object({ title: z.string().trim().min(1).max(250), fileName: z.string().trim().min(1).max(255).refine(v => !/[\\/\u0000]/.test(v)), fileHash: z.string().regex(/^[0-9a-f]{64}$/i).transform(v => v.toLowerCase()), fileSize: z.number().int().min(0).max(300 * 1024 * 1024), sourceUrl: z.string().trim().max(2000).refine(v => !v || /^https?:\/\//i.test(v)).default(""), attribution: z.string().trim().max(4000).default("") }).strict();
quantContentRouter.post("/quant/admin/sources", route(async (req, res) => {
  await authorize(req, "quant.sources.write");
  const v = sourceBody.parse(req.body);
  const result = await transaction(async q => {
    const exists = (await q.query("SELECT * FROM quant_sources WHERE file_hash=$1", [v.fileHash])).rows[0];
    if (exists) return { row: exists, duplicate: true };
    const sid = createId();
    const row = (await q.query("INSERT INTO quant_sources(id,title,file_name,file_hash,file_size,source_url,attribution,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [sid, v.title, v.fileName, v.fileHash, v.fileSize, v.sourceUrl, v.attribution, actor(req)])).rows[0];
    await log(q, req, "source.registered", sid, null, { fileHash: v.fileHash, licenseStatus: "unverified" });
    return { row, duplicate: false };
  });
  res.status(result.duplicate ? 200 : 201).json({ ...sourceJson(result.row), duplicate: result.duplicate });
}));
quantContentRouter.patch("/quant/admin/sources/:id/license", route(async (req, res) => {
  if (!root(req)) throw new QuantContentError(403, "LICENSE_REQUIRES_SUPERADMIN", "اعتماد ترخيص المصدر متاح للمسؤول الأعلى فقط.");
  const sid = id.parse(req.params.id), v = z.object({ licenseStatus: z.enum(quantLicenseStatuses), licenseNote: note }).strict().parse(req.body);
  if (v.licenseStatus === "verified" && v.licenseNote.length < 20) throw new QuantContentError(400, "LICENSE_NOTE_MISSING", "وثّق رابط شروط الاستخدام أو نص إذن واضحًا قبل الاعتماد.");
  const row = await transaction(async q => {
    const before = await source(q, sid, true);
    const next = (await q.query("UPDATE quant_sources SET license_status=$2,license_note=$3,updated_at=now() WHERE id=$1 RETURNING *", [sid, v.licenseStatus, v.licenseNote])).rows[0];
    await log(q, req, "source.license", sid, { licenseStatus: before.license_status, licenseNote: before.license_note }, v);
    return next;
  });
  res.json(sourceJson(row));
}));
quantContentRouter.post("/quant/admin/sources/:id/extraction", route(async (req, res) => {
  await authorize(req, "quant.sources.import");
  const sid = id.parse(req.params.id);
  const job = await transaction(async q => {
    const s = await source(q, sid, true); assertSourceCanBeImported(s);
    const previous = (await q.query("SELECT * FROM quant_extraction_jobs WHERE source_id=$1 AND status IN ('pending','running') ORDER BY created_at DESC LIMIT 1", [sid])).rows[0];
    if (previous) return previous;
    const jid = createId();
    const row = (await q.query("INSERT INTO quant_extraction_jobs(id,source_id,status,created_by) VALUES($1,$2,'pending',$3) RETURNING *", [jid, sid, actor(req)])).rows[0];
    await log(q, req, "source.extraction.requested", sid, null, { jobId: jid }); return row;
  });
  res.status(202).json({ id: job.id, status: job.status, sourceId: job.source_id, message: "المهمة مسجلة. شغّل أداة الاستيراد الموثّقة على الخادم بعد إرفاق الأصل في التخزين الخاص." });
}));
quantContentRouter.get("/quant/admin/sources/:id/report", route(async (req, res) => {
  await authorize(req, "quant.sources.read"); const sid = id.parse(req.params.id); await source(pool, sid);
  const pages = (await pool.query("SELECT count(*)::int AS processed,count(*) FILTER(WHERE status='needs_review')::int AS needs_review,count(*) FILTER(WHERE status='failed')::int AS failed FROM quant_extraction_pages WHERE source_id=$1", [sid])).rows[0];
  const questions = (await pool.query("SELECT count(DISTINCT question_id)::int AS discovered,count(DISTINCT question_id) FILTER(WHERE review_status='approved')::int AS approved,count(DISTINCT question_id) FILTER(WHERE review_status='needs_review')::int AS needs_review FROM quant_question_reviews r WHERE source_id=$1 OR EXISTS(SELECT 1 FROM quant_question_sources s WHERE s.question_id=r.question_id AND s.source_id=$1)", [sid])).rows[0];
  const duplicates = (await pool.query("SELECT count(DISTINCT a.question_id)::int AS count FROM quant_question_sources a WHERE a.source_id=$1 AND EXISTS(SELECT 1 FROM quant_question_sources b WHERE b.question_id=a.question_id AND (b.source_id<>a.source_id OR b.source_page<>a.source_page))", [sid])).rows[0].count;
  const job = (await pool.query("SELECT id,status,started_at,finished_at,error FROM quant_extraction_jobs WHERE source_id=$1 ORDER BY created_at DESC LIMIT 1", [sid])).rows[0] || null;
  res.json({ pagesProcessed: pages.processed, questionsDiscovered: questions.discovered, questionsApproved: questions.approved, needsReview: questions.needs_review, pagesNeedingReview: pages.needs_review, duplicates, failedPages: pages.failed, job });
}));
quantContentRouter.get("/quant/admin/sources/:id/pages", route(async (req, res) => {
  await authorize(req, "quant.sources.read"); const sid = id.parse(req.params.id), current = await source(pool, sid); assertSourceCanBeImported(current);
  const rows = (await pool.query(`SELECT p.page,p.status,p.text_excerpt,p.reason,p.question_id,p.processed_at,
    (SELECT f.id FROM quant_question_figures f WHERE f.source_id=p.source_id AND f.source_page=p.page ORDER BY f.created_at DESC,f.position LIMIT 1) AS figure_id
    FROM quant_extraction_pages p WHERE p.source_id=$1 ORDER BY p.page LIMIT 2000`, [sid])).rows;
  const figureRead = await permission(req, "quant.questions.write");
  res.json(rows.map(({ figure_id, ...row }) => ({ ...row, previewUrl: figure_id && figureRead ? "/api/quant/admin/figures/" + figure_id : current.private_path && row.status !== "failed" ? `/api/quant/admin/sources/${sid}/pages/${row.page}/image` : null, previewKind: figure_id && figureRead ? "question_without_key" : current.private_path && row.status !== "failed" ? "source_page" : null })));
}));
quantContentRouter.get("/quant/admin/sources/:id/pages/:page/image", route(async (req, res) => {
  await authorize(req, "quant.sources.read"); const sid = id.parse(req.params.id), page = z.coerce.number().int().positive().max(100000).parse(req.params.page);
  const s = await source(pool, sid); assertSourceCanBeImported(s);
  if (!s.private_path || !(await pool.query("SELECT 1 FROM quant_extraction_pages WHERE source_id=$1 AND page=$2 AND status<>'failed'", [sid, page])).rowCount) throw new QuantContentError(404, "NOT_FOUND", "الصفحة غير متاحة.");
  const folder = await realpath(path.dirname(s.private_path)), image = await realpath(path.join(folder, "page-" + page + ".png")).catch(() => null);
  if (!image || path.dirname(image) !== folder) throw new QuantContentError(404, "NOT_FOUND", "صورة الصفحة غير متاحة.");
  res.type("png").send(await readFile(image));
}));

const choices = z.array(z.object({ key: z.string().trim().min(1).max(4), text: z.string().trim().min(1).max(3000) }).strict()).min(2).max(6);
const questionBody = z.object({ stem: z.string().trim().min(5).max(20000), choices, correctKey: z.string().min(1).max(4), explanation: note, categoryId: id, difficulty: z.enum(["easy", "medium", "hard", "unknown"]), reviewStatus: z.enum(["draft", "extracted", "needs_review"]).default("draft"), sourceId: id.nullable().default(null), sourcePage: z.number().int().positive().max(100000).nullable().default(null), images: z.array(z.string().max(2000).refine(v => /^https:\/\//.test(v) || /^\/[^/]/.test(v))).max(8).default([]) }).strict();
type QuestionBody = z.infer<typeof questionBody>;
const questionSelect = `SELECT q.id,q.category_id,q.text,q.difficulty,q.content,q.author_id,q.status,q.revision,v.id AS version_id,v.question_id,v.number AS version_number,v.snapshot,r.review_status,r.source_id,r.source_page,r.review_note,r.normalized_hash,c.name AS skill FROM education_questions q JOIN education_question_versions v ON v.question_id=q.id AND v.number=q.revision LEFT JOIN quant_question_reviews r ON r.version_id=v.id JOIN education_categories c ON c.id=q.category_id`;
quantContentRouter.get("/quant/admin/questions", route(async (req, res) => {
  await authorize(req, "quant.questions.write");
  const search = z.string().max(200).parse(req.query.search || ""), status = z.enum([...quantReviewStatuses, ""]).parse(req.query.status || ""), sid = z.union([id, z.literal("")]).parse(req.query.source || "");
  res.json((await pool.query(questionSelect + " WHERE c.track='quantitative' AND q.text ILIKE $1 AND ($2='' OR COALESCE(r.review_status,'draft')=$2) AND ($3='' OR r.source_id=$3) ORDER BY q.updated_at DESC LIMIT 500", ["%" + search + "%", status, sid])).rows.map(questionJson));
}));
async function save(req: Request, v: QuestionBody, qid?: string) {
  await authorize(req, "quant.questions.write");
  const errors = validateQuestion(v);
  if (errors.length) throw new QuantContentError(400, "INVALID_QUESTION", "راجع الخيارات والإجابة الصحيحة.", { validationErrors: errors });
  if (v.choices.some((c, index) => c.key !== String.fromCharCode(65 + index))) throw new QuantContentError(400, "CHOICE_KEYS_ORDER", "رتّب مفاتيح الخيارات A، B، C… وفق ترتيبها.");
  if (v.sourceId && !v.sourcePage) throw new QuantContentError(400, "SOURCE_PAGE_REQUIRED", "حدد صفحة المصدر.");
  return transaction(async q => {
    const category = (await q.query("SELECT * FROM education_categories WHERE id=$1 AND track='quantitative'", [v.categoryId])).rows[0];
    if (!category) throw new QuantContentError(400, "INVALID_CATEGORY", "اختر مهارة من القسم الكمي.");
    const previous = qid ? (await q.query("SELECT * FROM education_questions WHERE id=$1 FOR UPDATE", [qid])).rows[0] : null;
    if (qid && !previous) throw new QuantContentError(404, "NOT_FOUND", "السؤال غير متاح.");
    if (v.sourceId) { const s = await source(q, v.sourceId, true); assertSourceCanBeImported(s); if (s.page_count && v.sourcePage! > s.page_count) throw new QuantContentError(400, "INVALID_SOURCE_PAGE", "رقم الصفحة خارج المصدر."); }
    const questionId = qid || createId(), vid = createId(), revision = (previous?.revision || 0) + 1;
    const clonedFigures: any[] = [], images: string[] = [];
    for (const supplied of v.images) {
      let suppliedPath: string;
      try { suppliedPath = new URL(supplied, "https://private-figure.invalid").pathname; }
      catch { throw new QuantContentError(400, "INVALID_IMAGE_URL", "راجع رابط صورة السؤال."); }
      const privatePath = suppliedPath.startsWith("/api/quant/figures") || suppliedPath.startsWith("/api/quant/admin/figures");
      if (!privatePath) {
        images.push(supplied); continue;
      }
      const figureId = /^\/api\/quant\/figures\/([0-9a-f-]{36})$/i.exec(supplied)?.[1];
      if (!figureId || !qid || !v.sourceId || !v.sourcePage) throw new QuantContentError(400, "PRIVATE_FIGURE_INVALID", "الرسم الخاص مرتبط بسؤاله وإصدار المصدر فقط.");
      const figure = (await q.query(`SELECT f.*,old_version.question_id FROM quant_question_figures f
        JOIN education_question_versions old_version ON old_version.id=f.version_id WHERE f.id=$1`, [figureId])).rows[0];
      if (!figure || figure.question_id !== qid || figure.source_id !== v.sourceId || figure.source_page !== v.sourcePage)
        throw new QuantContentError(400, "PRIVATE_FIGURE_SOURCE_MISMATCH", "لا يمكن نقل رسم خاص من سؤال أو مصدر أو صفحة مختلفة.");
      try { await readStoredQuantFigure(q, figure); }
      catch { throw new QuantContentError(409, "PRIVATE_FIGURE_UNAVAILABLE", "تحقق من وجود الرسم الخاص وسلامته قبل إنشاء إصدار جديد."); }
      const cloned = { ...figure, id: createId(), position: clonedFigures.length };
      clonedFigures.push(cloned); images.push("/api/quant/figures/" + cloned.id);
    }
    const hash = clonedFigures.length ? createHash("sha256").update("quant-private-figure:" + clonedFigures.map(f => f.file_hash).sort().join(":" )).digest("hex") : normalizedQuestionHash(v.stem);
    const fingerprint = clonedFigures.length ? hash : questionFingerprint(v.stem);
    const duplicate = (await q.query("SELECT r.question_id,r.version_id FROM quant_question_reviews r WHERE r.normalized_hash=$1 AND r.question_id<>$2 LIMIT 1", [hash, qid || ""])).rows[0];
    const legacyDuplicate = (await q.query("SELECT id FROM education_questions WHERE fingerprint=$1 AND id<>$2 LIMIT 1", [fingerprint, qid || ""])).rows[0];
    if (duplicate || legacyDuplicate) throw new QuantContentError(409, "QUESTION_DUPLICATE", "يوجد سؤال مطابق. راجع النسخة القائمة ثم اربط المصدر بها دون حذف تلقائي.", { duplicateQuestionId: duplicate?.question_id || legacyDuplicate.id, duplicateVersionId: duplicate?.version_id });
    const priorSource = previous ? (await q.query("SELECT r.source_id,r.source_page FROM quant_question_reviews r JOIN education_question_versions old_version ON old_version.id=r.version_id WHERE old_version.question_id=$1 AND old_version.number=$2", [qid, previous.revision])).rows[0] : null;
    const provenance = priorSource?.source_id === v.sourceId && priorSource?.source_page === v.sourcePage ? Object.fromEntries(["publisher", "attribution", "licensedPackRef", "sourceQuestionNumber", "normalizedCandidateHash", "sourceSection", "extractionUncertainties"].filter(key => previous?.content?.[key] !== undefined).map(key => [key, previous.content[key]])) : {};
    const content = { ...provenance, options: v.choices.map(c => ({ text: c.text, explanation: "" })), answer: v.choices.findIndex(c => c.key === v.correctKey), explanation: v.explanation, passage: "", source: v.sourceId ? (await source(q, v.sourceId)).title : "تأليف أصلي", rights: v.sourceId ? "licensed" : "original", license: v.sourceId ? (await source(q, v.sourceId)).license_note : "محتوى أصلي أضافه المسؤول؛ لا يعتمد إلا بعد مراجعة.", allowSave: true, stemImages: images };
    const snapshot = { categoryId: v.categoryId, text: v.stem, difficulty: v.difficulty, status: "draft", content };
    const values = [questionId, v.categoryId, v.stem, fingerprint, v.difficulty, JSON.stringify(content), revision];
    if (previous) await q.query("UPDATE education_questions SET category_id=$2,text=$3,fingerprint=$4,difficulty=$5,content=$6::jsonb,status='draft',revision=$7,reviewed_by=NULL,updated_at=now() WHERE id=$1", values);
    else await q.query("INSERT INTO education_questions(id,category_id,text,fingerprint,difficulty,content,status,revision,author_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,'draft',$7,$8)", [...values, actor(req)]);
    await q.query("INSERT INTO education_question_versions(id,question_id,number,snapshot) VALUES($1,$2,$3,$4::jsonb)", [vid, questionId, revision, JSON.stringify(snapshot)]);
    for (const figure of clonedFigures) await q.query("INSERT INTO quant_question_figures(id,version_id,source_id,source_page,position,file_hash,relative_path,width,height,review_note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [figure.id, vid, figure.source_id, figure.source_page, figure.position, figure.file_hash, figure.relative_path, figure.width, figure.height, figure.review_note, actor(req)]);
    await q.query("INSERT INTO quant_question_reviews(version_id,question_id,source_id,source_page,review_status,normalized_hash,skill) VALUES($1,$2,$3,$4,$5,$6,$7)", [vid, questionId, v.sourceId, v.sourcePage, v.reviewStatus, hash, category.name]);
    if (v.sourceId) {
      await q.query("INSERT INTO quant_question_sources(id,question_id,source_id,source_page) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [createId(), questionId, v.sourceId, v.sourcePage]);
      await q.query("UPDATE quant_extraction_pages SET question_id=$3,status=CASE WHEN $4='needs_review' THEN 'needs_review' ELSE 'done' END WHERE source_id=$1 AND page=$2", [v.sourceId, v.sourcePage, questionId, v.reviewStatus]);
    }
    await log(q, req, "question.version.created", questionId, { version: previous?.revision || null }, { versionId: vid, version: revision, reviewStatus: v.reviewStatus, sourceId: v.sourceId, sourcePage: v.sourcePage });
    return questionJson({ ...snapshot, question_id: questionId, version_id: vid, version_number: revision, snapshot, review_status: v.reviewStatus, source_id: v.sourceId, source_page: v.sourcePage, skill: category.name });
  });
}
quantContentRouter.post("/quant/admin/questions", route(async (req, res) => { res.status(201).json(await save(req, questionBody.parse(req.body))); }));
quantContentRouter.patch("/quant/admin/questions/:id", route(async (req, res) => { res.json(await save(req, questionBody.parse(req.body), id.parse(req.params.id))); }));
quantContentRouter.get("/quant/admin/questions/:id/versions", route(async (req, res) => {
  await authorize(req, "quant.questions.write");
  res.json((await pool.query("SELECT v.id AS version_id,v.question_id,v.number AS version_number,v.snapshot,r.review_status,r.source_id,r.source_page,r.review_note,r.skill FROM education_question_versions v LEFT JOIN quant_question_reviews r ON r.version_id=v.id WHERE v.question_id=$1 ORDER BY v.number DESC", [id.parse(req.params.id)])).rows.map(questionJson));
}));
quantContentRouter.patch("/quant/admin/versions/:id/review", route(async (req, res) => {
  await authorize(req, "quant.questions.approve"); const vid = id.parse(req.params.id), v = z.object({ reviewStatus: z.enum(["needs_review", "reviewed", "approved", "rejected"]), reviewNote: note.default("") }).strict().parse(req.body);
  const result = await transaction(async q => {
    const row = (await q.query("SELECT r.*,v.snapshot,v.number,q.revision,q.author_id FROM quant_question_reviews r JOIN education_question_versions v ON v.id=r.version_id JOIN education_questions q ON q.id=r.question_id WHERE r.version_id=$1 FOR UPDATE OF r,q", [vid])).rows[0];
    if (!row) throw new QuantContentError(404, "NOT_FOUND", "الإصدار غير متاح للمراجعة.");
    if (v.reviewStatus === "approved") {
      if (!["reviewed", "approved"].includes(row.review_status)) throw new QuantContentError(409, "REVIEW_REQUIRED", "راجع الإصدار وحدد حالته «تمت المراجعة» قبل اعتماده.");
      if (!row.source_id) throw new QuantContentError(409, "SOURCE_REQUIRED", "اربط مصدرًا موثّقًا وصفحته قبل الاعتماد، بما في ذلك المحتوى الأصلي.");
      assertSourceCanBeImported(await source(q, row.source_id, true));
      if ((await settings("", q)).contentReview && row.author_id === actor(req)) throw new QuantContentError(409, "SECOND_REVIEWER_REQUIRED", "يتطلب الاعتماد مراجعًا مخوّلًا غير مؤلف السؤال.");
      const check = validateQuestion(questionJson(row)); if (check.length) throw new QuantContentError(400, "INVALID_QUESTION", "لا يمكن اعتماد سؤال بخيارات غير صحيحة.", { validationErrors: check });
    }
    await q.query("UPDATE quant_question_reviews SET review_status=$2,review_note=$3,reviewed_by=$4,updated_at=now() WHERE version_id=$1", [vid, v.reviewStatus, v.reviewNote, actor(req)]);
    if (row.number === row.revision) await q.query("UPDATE education_questions SET status=$2,reviewed_by=$3,updated_at=now() WHERE id=$1", [row.question_id, v.reviewStatus === "approved" ? "published" : "review", v.reviewStatus === "approved" ? actor(req) : null]);
    await log(q, req, "question.review", row.question_id, { versionId: vid, reviewStatus: row.review_status }, { versionId: vid, ...v });
    return { versionId: vid, reviewStatus: v.reviewStatus };
  }); res.json(result);
}));
quantContentRouter.post("/quant/admin/questions/:id/sources", route(async (req, res) => {
  await authorize(req, "quant.questions.write"); const qid = id.parse(req.params.id), v = z.object({ sourceId: id, sourcePage: z.number().int().positive().max(100000) }).strict().parse(req.body);
  await transaction(async q => {
    const s = await source(q, v.sourceId, true); assertSourceCanBeImported(s);
    if (s.page_count && v.sourcePage > s.page_count) throw new QuantContentError(400, "INVALID_SOURCE_PAGE", "رقم الصفحة خارج المصدر.");
    if (!(await q.query("SELECT 1 FROM education_questions WHERE id=$1", [qid])).rowCount) throw new QuantContentError(404, "NOT_FOUND", "السؤال غير متاح.");
    await q.query("INSERT INTO quant_question_sources(id,question_id,source_id,source_page) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [createId(), qid, v.sourceId, v.sourcePage]);
    await log(q, req, "question.source.linked", qid, null, v);
  }); res.status(201).json({ ok: true });
}));
