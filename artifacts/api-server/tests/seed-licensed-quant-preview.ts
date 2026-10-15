/** Disposable localhost QA only. This is not an application migration or a production seeder. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const expectedSourceHash = "3d7c9c2034b8e326d7242b0ffea44e08b58d7f5b40db765a4697f3adeea35c2b";
export async function seedLicensedQuantPreview(adminId: string, schoolId: string, classId: string) {
  if (process.env.NODE_ENV !== "test" || !/^teacher_qa_[a-f0-9]{32}$/.test(process.env.TEACHER_TEST_SCHEMA || ""))
    throw Error("DISPOSABLE_LOCAL_DATABASE_REQUIRED");
  const root = path.resolve("../.."), folder = path.join(root, ".local/quant-imports/almufakir120");
  let permissionText: string, draftText: string, reviewedText: string;
  try {
    [permissionText, draftText, reviewedText] = await Promise.all([
      readFile(path.join(root, ".local/quant-licenses/almufakir-permission.json"), "utf8"),
      readFile(path.join(folder, "draft-pack.json"), "utf8"), readFile(path.join(folder, "reviewed-pack.json"), "utf8"),
    ]);
  } catch (error: any) {
    if (error.code === "ENOENT") return { skipped: true, reason: "PRIVATE_LICENSED_PACK_NOT_PRESENT" };
    throw error;
  }
  const permission = JSON.parse(permissionText), reviewed = JSON.parse(reviewedText);
  if (permission.licenseStatus !== "verified" || permission.basis !== "owner_provided_written_authorization" ||
      permission.coveredFileHash !== expectedSourceHash || reviewed.sourceFileHash !== expectedSourceHash ||
      reviewed.reviewStatus !== "reviewed" || !reviewed.questions?.length || !/^[a-zA-Z0-9._-]+\.jpg$/.test(permission.proofFile))
    throw Error("LOCAL_SOURCE_AUTHORIZATION_MISMATCH");
  const proof = await readFile(path.join(root, ".local/quant-licenses", permission.proofFile));
  if (digest(proof) !== permission.proofHash || digest(await readFile(path.join(folder, "source.pdf"))) !== expectedSourceHash)
    throw Error("LOCAL_SOURCE_EVIDENCE_HASH_MISMATCH");
  const source = (await pool.query("SELECT id FROM quant_sources WHERE file_hash=$1", [expectedSourceHash])).rows[0];
  if (!source) throw Error("LOCAL_LICENSED_SOURCE_NOT_REGISTERED");
  const author = randomUUID();
  await pool.query("INSERT INTO users(id,name,email,password_hash,role,account_type) VALUES($1,$2,$3,$4,'SUPERADMIN','merchant')",
    [author, "مستورد المسودات • حساب معاينة محلي منفصل", "licensed-importer@example.invalid", randomUUID()]);
  await pool.query(`UPDATE quant_sources SET license_status='verified',license_note=$2,attribution=$3,source_url=$4,page_count=1440,updated_at=now() WHERE id=$1`,
    [source.id, `إذن كتابي مقدم من المالك بتاريخ ${permission.receivedOn}: ${permission.permissionText}. محفوظ خاصًا ببصمة ${permission.proofHash}. لم تُوثق هوية الجهة الخارجية بصورة مستقلة. اعتماد هذه المعاينة المحلية فقط.`,
      "إعداد فريق المفكر • المصدر: المفكر 120 تحديث (١). مستخدم بإذن كتابي قدمه مالك LootBot.", "https://t.me/AlmufakirGD"]);
  await pool.query("INSERT INTO audit_logs(id,user_id,action,summary,details) VALUES($1,$2,$3,$4,$5::jsonb)",
    [randomUUID(), adminId, "education.quant.source.license.local_preview", "اعتماد مصدر المفكر في قاعدة معاينة محلية فقط", JSON.stringify({ sourceId: source.id, basis: permission.basis, evidenceHash: permission.proofHash })]);
  await pool.query(`INSERT INTO education_categories(id,name,track,position) SELECT $1,'مسائل كمية متنوعة','quantitative',100 WHERE NOT EXISTS(SELECT 1 FROM education_categories WHERE name='مسائل كمية متنوعة' AND track='quantitative' AND school_id IS NULL AND class_id IS NULL)`, [randomUUID()]);
  const importer = await import(pathToFileURL(path.join(root, "scripts/import-quant-reviewed.mjs")).href);
  const draft = await importer.loadReviewedPack(path.join(folder, "draft-pack.json"));
  if (digest(draftText) !== draft.fileHash || draft.pack.sourceFileHash !== expectedSourceHash)
    throw Error("LOCAL_DRAFT_PACK_CHANGED");
  const connection = await pool.connect();
  let imported: any;
  try { imported = await importer.importReviewedDrafts(connection, author, draft); }
  finally { connection.release(); }
  const approved: { versionId: string; questionId: string; sourcePage: number }[] = [];
  for (const question of reviewed.questions) {
    const candidate = draft.pack.questions.find((r: any) => r.ref === question.ref), version = imported.versions.find((r: any) => r.ref === question.ref);
    if (!version || !candidate || question.review.status !== "reviewed" || question.correctKey !== candidate.correctKey ||
        question.sourcePage !== candidate.sourcePage || question.images[0]?.fileHash !== candidate.images[0]?.fileHash ||
        question.stem !== candidate.stem || JSON.stringify(question.choices) !== JSON.stringify(candidate.choices))
      throw Error("LOCAL_REVIEWED_VERSION_MISMATCH");
    await pool.query("UPDATE quant_question_reviews SET review_status='approved',reviewed_by=$2,review_note=$3,updated_at=now() WHERE version_id=$1",
      [version.versionId, adminId, question.review.note + " • اعتماد في قاعدة معاينة محلية فقط؛ المستورد والمراجع حسابان تجريبيان منفصلان."]);
    await pool.query("UPDATE education_questions SET status='published',reviewed_by=$2 WHERE id=$1", [version.questionId, adminId]);
    await pool.query("INSERT INTO audit_logs(id,user_id,action,summary,details) VALUES($1,$2,$3,$4,$5::jsonb)",
      [randomUUID(), adminId, "education.quant.question.approved.local_preview", "اعتماد صورة سؤال راجعتها المقارنة البصرية في المعاينة المحلية", JSON.stringify({ versionId: version.versionId, sourceId: source.id, sourcePage: question.sourcePage, cropHash: question.images[0].fileHash })]);
    approved.push({ ...version, sourcePage: question.sourcePage });
  }
  // Every test uses only the independently checked, version-pinned subset.
  let tests = 0;
  for (let start = 0; start < approved.length; start += 12) {
    const testId = randomUUID(), number = ++tests;
    await pool.query(`INSERT INTO quant_tests(id,title,description,mode,time_limit_sec,reveal_policy,status,school_id,class_id,created_by) VALUES($1,$2,$3,'untimed',NULL,'after_submit','published',$4,$5,$6)`,
      [testId, `القسم ${number}`, "12 سؤالًا مختارًا من المفكر. صور الأسئلة والخيارات خضعت للمراجعة، والإجابات من مفتاح المصدر. هذه مجموعة تدريب محلية؛ لا تتضمن شرحًا تفصيليًا من المصدر.", schoolId, classId, adminId]);
    for (const [position, version] of approved.slice(start, start + 12).entries())
      await pool.query("INSERT INTO quant_test_items(test_id,version_id,position) VALUES($1,$2,$3)", [testId, version.versionId, position]);
  }
  const report = JSON.parse(await readFile(path.join(folder, "extraction-report.json"), "utf8"));
  for (const page of report.pages) {
    const version = imported.versions.find((r: any) => r.ref === `ALMFKR120-P${String(page.page).padStart(4, "0")}`);
    const checked = approved.some(r => r.sourcePage === page.page);
    await pool.query("INSERT INTO quant_extraction_pages(source_id,page,status,reason,question_id) VALUES($1,$2,$3,$4,$5)",
      [source.id, page.page, page.state === "skipped_cover" ? "skipped" : checked ? "done" : "needs_review",
        page.state === "skipped_cover" ? "غلاف قسم؛ ليس سؤالًا" : checked ? "صورة السؤال والخيارات والمفتاح راجعتها المقارنة البصرية" : page.page === 1053 ? "لا يوجد مفتاح صريح في المصدر؛ لم يدخل البنك" : "قص واستخراج آلي فقط؛ يلزم تدقيق مستقل قبل اعتماد السؤال", version?.questionId || null]);
  }
  await pool.query("INSERT INTO quant_extraction_jobs(id,source_id,status,started_at,finished_at,created_by) VALUES($1,$2,'completed',now(),now(),$3)", [randomUUID(), source.id, author]);
  return { imported: imported.imported, approved: approved.length, needsReview: imported.imported - approved.length, heldWithoutKey: 1, tests, localOnly: true };
}
