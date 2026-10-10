export type AccountType = 'merchant' | 'teacher';
export interface AccountWorkspace { accountType: AccountType | null; role: string; profileComplete: boolean }
export interface TeacherProfile { teacherName: string; schoolName: string; stage: string; subjects: string[]; classes: string[]; term: string; year: string; city: string; printStyle: 'formal' | 'primary' | 'minimal'; digits: 'arabic' | 'western'; paperSize: 'A4'; logoAssetId: string | null; signature: string; onboardingStep: number; complete: boolean }
export interface TeacherClass { id: string; name: string; grade: string; section: string; subject: string; year: string; term: string; notes: string; archived: boolean; gradebookTemplate?: {title:string;totalMarks:number}[]; createdAt: string; updatedAt: string }
export interface TeacherStudent { id: string; classId: string; name: string; internalId: string; notes: string; archived: boolean; removed?: boolean; createdAt: string; updatedAt: string }
export interface AttendanceEntry { id?: string; classId?: string; date?: string; studentId: string; status: 'present' | 'absent' | 'late' | 'excused'; note: string }
export interface TeacherGrade { id: string; classId: string; studentId: string; title: string; totalMarks: number; marks: number | null; date: string; note: string; archived?: boolean }
export interface TeacherTask { id: string; title: string; classId: string | null; kind: 'assignment' | 'task'; dueAt: string | null; status: 'pending' | 'completed'; notes: string; studentCompletion: string[]; archived?: boolean }
export interface TeacherLesson { id: string; title: string; classId: string | null; date: string; objectives: string; content: string; homework: string; archived?: boolean }
export interface TeacherQuestion { id: string; text: string; subject: string; grade: string; kind: 'text' | 'multiple-choice' | 'true-false'; options: string[]; answer: string; marks: number; tags: string[]; archived?: boolean }
export type TeacherRuleType = 'upcoming' | 'absence' | 'grading' | 'weekly' | 'draft' | 'recurring';
export interface TeacherRule { id: string; name: string; type: TeacherRuleType; enabled: boolean; config: { threshold?: number; daysBefore?: number; weekDay?: number; hour?: number; title?: string; intervalDays?: number; classId?: string; dueAt?: string }; nextRunAt: string | null; lastRunAt: string | null; lastResult: string | null; error: string | null }
export interface TeacherReminder { id: string; title: string; body: string; read: boolean; createdAt: string; ruleId: string | null }
export interface TeacherExam { id: string; title: string; document: Record<string, unknown>; sourceAssetId: string | null; version: number; isTemplate: boolean; archived: boolean; createdAt: string; updatedAt: string }
export interface TeacherDashboard { counts: { classes: number; students: number; exams: number; tasks: number; ungraded: number; absences: number }; tasks: TeacherTask[]; upcomingExams: TeacherExam[]; recentFiles: TeacherExam[]; reminders: TeacherReminder[]; weekly: { attendance: number; grades: number; tasksCompleted: number } }
export interface RosterImportRow { name: string; internalId?: string; notes?: string }
export interface RosterPreview { rows: { row: number; student: RosterImportRow; errors: string[]; matchedStudentId: string | null }[]; totals: { valid: number; invalid: number; matched: number } }
export interface TeacherAsset { id: string; url: string; mimeType: string; size: number }
export class TeacherApiError extends Error { constructor(message: string, public status: number) { super(message); this.name = 'TeacherApiError'; } }
async function csrfToken(): Promise<string> { const response = await fetch('/api/auth/csrf', { credentials: 'include' }); if (!response.ok) throw new TeacherApiError('تعذر تهيئة الطلب. حدّث الصفحة.', response.status); return (await response.json() as { token: string }).token; }
export async function teacherApi<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') { headers['x-csrf-token'] = await csrfToken(); headers['Content-Type'] = 'application/json'; }
  const response = await fetch(`/api${path}`, { method, credentials: 'include', headers, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new TeacherApiError(result.error || 'تعذر إتمام الطلب. حاول مجددًا.', response.status);
  return result as T;
}
export async function uploadTeacherAsset(file: Blob): Promise<TeacherAsset> { const response = await fetch('/api/teacher/assets', { method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type, 'x-csrf-token': await csrfToken() }, body: file }); const result = await response.json(); if (!response.ok) throw new TeacherApiError(result.error || 'تعذر رفع الصورة.', response.status); return result as TeacherAsset; }
