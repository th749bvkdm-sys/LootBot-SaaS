export type Row = Record<string, any>;
export type Stroke = { color: string; width: number; points: [number, number, number][] };
export class QuantError extends Error {
  constructor(public status: number, public details: Row) {
    super((details.error || "تعذر الاتصال. تبقى التغييرات على هذا الجهاز حتى إعادة المحاولة.") + (details.duplicateQuestionId ? " معرف السؤال القائم: " + details.duplicateQuestionId : ""));
  }
}
export async function quantApi<T = Row>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    const csrf = await fetch("/api/auth/csrf", { credentials: "include", cache: "no-store" });
    if (!csrf.ok) throw new QuantError(csrf.status, { error: "حدّث الصفحة لتجديد الجلسة." });
    headers["x-csrf-token"] = (await csrf.json()).token;
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch("/api/quant" + path, { method, headers, credentials: "include", cache: "no-store", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new QuantError(response.status, data);
  return data;
}
export const number = (n: unknown) => new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 1 }).format(Number(n) || 0);
export const percent = (n: unknown) => n == null ? "—" : number(Number(n) * 100) + "٪";
export const modeLabels: Record<string, string> = { timed: "موقّت", untimed: "بلا مؤقت", practice: "تدريب", simulation: "محاكاة" };
export const revealLabels: Record<string, string> = { never: "لا تظهر الحلول", after_submit: "بعد التسليم", after_each: "بعد الإجابة", after_deadline: "بعد انتهاء الموعد" };
export const localRead = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; } };
export function localWrite(key: string, value: unknown) { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
