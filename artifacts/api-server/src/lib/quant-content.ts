import { createHash } from "node:crypto";

export const quantLicenseStatuses = ["unverified", "verified", "restricted", "rejected"] as const;
export const quantReviewStatuses = ["draft", "extracted", "needs_review", "reviewed", "approved", "rejected"] as const;
export type LicensedQuantSource = { license_status?: string; license_note?: string | null; licenseStatus?: string; licenseNote?: string | null };
export class QuantContentError extends Error {
  constructor(public status: number, public code: string, public message: string, public details?: Record<string, unknown>) { super(message); }
}
export function assertSourceCanBeImported(source: LicensedQuantSource) {
  if ((source.license_status ?? source.licenseStatus) !== "verified") throw new QuantContentError(409, "SOURCE_NOT_LICENSED", "المصدر غير مفعّل. وثّق الترخيص واعتمده قبل الاستخراج أو الاستيراد.");
  if (!(source.license_note ?? source.licenseNote)?.trim()) throw new QuantContentError(409, "LICENSE_NOTE_MISSING", "أضف مستند الترخيص أو رابط شروط الاستخدام.");
}
export const assertSourceCanBePublished = assertSourceCanBeImported;
export function normalizeForDedup(text: string) {
  return text.normalize("NFKC").replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/\s+/g, " ").trim().toLowerCase();
}
export const normalizedQuestionHash = (stem: string) => createHash("sha256").update(normalizeForDedup(stem)).digest("hex");
export function validateQuestion(question: { stem?: string; choices: { key: string; text: string }[]; correctKey: string }) {
  const errors: string[] = [], keys = question.choices.map(c => c.key.trim()), texts = question.choices.map(c => normalizeForDedup(c.text));
  if (question.stem !== undefined && !question.stem.trim()) errors.push("EMPTY_STEM");
  if (new Set(keys).size !== keys.length) errors.push("DUPLICATE_KEYS");
  if (keys.some(k => !k)) errors.push("EMPTY_CHOICE_KEY");
  if (!keys.includes(question.correctKey)) errors.push("CORRECT_KEY_NOT_IN_CHOICES");
  if (texts.some(t => !t)) errors.push("EMPTY_CHOICE_TEXT");
  if (new Set(texts).size !== texts.length) errors.push("DUPLICATE_CHOICE_TEXT");
  if (question.choices.length < 2) errors.push("TOO_FEW_CHOICES");
  return errors;
}
export function sourceJson(row: any) {
  return { id: row.id, title: row.title, fileName: row.file_name, fileHash: row.file_hash, fileSize: Number(row.file_size), pageCount: row.page_count, licenseStatus: row.license_status, licenseNote: row.license_note || "", attribution: row.attribution || "", sourceUrl: row.source_url || "", createdAt: row.created_at, updatedAt: row.updated_at };
}
export function questionJson(row: any) {
  const snapshot = row.snapshot || {}, content = snapshot.content || row.content || {}, choices = (content.options || []).map((o: any, index: number) => ({ key: String.fromCharCode(65 + index), text: typeof o === "string" ? o : o.text }));
  return { id: row.question_id || row.id, versionId: row.version_id, versionNumber: row.version_number || row.number, stem: snapshot.text || row.text, choices, correctKey: String.fromCharCode(65 + Number(content.answer)), explanation: content.explanation || "", categoryId: snapshot.categoryId || row.category_id, difficulty: snapshot.difficulty || row.difficulty, reviewStatus: row.review_status || "draft", sourceId: row.source_id || null, sourcePage: row.source_page || null, images: content.stemImages || [], skill: row.skill || "", reviewNote: row.review_note || "" };
}
