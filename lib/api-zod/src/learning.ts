export interface StepOption {
  id: string;
  text: string;
  isCorrect: boolean;
}
export interface LessonStep {
  id: string;
  title: string;
  explanation: string;
  altExplanation: string;
  imageAssetId: string | null;
  altImageAssetId: string | null;
  question: string;
  options: StepOption[];
  hint: string;
  correctExplanation: string;
  questionVersionId?: string | null;
}
export interface StepLessonContent {
  title: string;
  subject: string;
  grade: string;
  objective: string;
  description: string;
  steps: LessonStep[];
}
export interface StepLesson extends StepLessonContent {
  id: string;
  revision: number;
  status: "draft" | "published";
  currentVersionId: string | null;
}
export interface ActivityAssignment {
  id: string;
  versionId: string;
  classId: string;
  mode: "learn" | "assessed";
  allowedAttempts: number;
  hints: boolean;
  explanations: "immediate" | "after";
  dueAt: string | null;
  title?: string;
  className?: string;
  started?: number;
  completed?: number;
  archived?: boolean;
}
export const DEFAULT_ATTEMPTS = 3;
export const DIFFICULT_STEP = {
  firstTryRate: 0.5,
  helpRate: 0.3,
  minimumReached: 5,
} as const;
export function newLessonStep(makeId: () => string): LessonStep {
  return {
    id: makeId(),
    title: "",
    explanation: "",
    altExplanation: "",
    imageAssetId: null,
    altImageAssetId: null,
    question: "",
    options: [
      { id: makeId(), text: "", isCorrect: true },
      { id: makeId(), text: "", isCorrect: false },
    ],
    hint: "",
    correctExplanation: "",
  };
}
export function lessonErrors(content: StepLessonContent): string[] {
  const errors: string[] = [];
  if (!content.title.trim()) errors.push("أدخل عنوان الدرس.");
  if (!content.steps.length) errors.push("أضف خطوة واحدة على الأقل.");
  if (new Set(content.steps.map((s) => s.id)).size !== content.steps.length)
    errors.push("معرّفات الخطوات مكررة.");
  content.steps.forEach((s, i) => {
    const prefix = `الخطوة ${i + 1}: `;
    if (!s.title.trim()) errors.push(prefix + "أدخل العنوان.");
    if (!s.explanation.trim()) errors.push(prefix + "أدخل الشرح.");
    if (!s.question.trim()) errors.push(prefix + "أدخل السؤال.");
    if (
      s.options.length < 2 ||
      s.options.length > 6 ||
      s.options.some((o) => !o.text.trim())
    )
      errors.push(prefix + "أدخل من خيارين إلى ستة خيارات واضحة.");
    if (s.options.filter((o) => o.isCorrect).length !== 1)
      errors.push(prefix + "حدد إجابة صحيحة واحدة.");
    if (new Set(s.options.map((o) => o.id)).size !== s.options.length)
      errors.push(prefix + "معرّفات الخيارات مكررة.");
    if (
      s.altExplanation.trim() &&
      s.altExplanation.trim() === s.explanation.trim()
    )
      errors.push(prefix + "استخدم شرحًا بديلًا مختلفًا.");
  });
  return errors;
}
export function attemptOutcome(
  correct: boolean,
  attempts: number,
  mode: "learn" | "assessed",
  limit = DEFAULT_ATTEMPTS,
) {
  const exhausted = mode === "assessed" && attempts >= limit;
  return {
    correct,
    exhausted,
    canAdvance: correct || exhausted,
    struggled: !correct && exhausted,
  };
}
export interface AnalyticsAttempt {
  studentId: string;
  stepId: string;
  optionId: string;
  correct: boolean;
  number: number;
  run: number;
}
export function stepAnalytics(
  step: LessonStep,
  reached: string[],
  attempts: AnalyticsAttempt[],
  help: string[],
) {
  const rows = attempts.filter((a) => a.stepId === step.id);
  const students = [...new Set(rows.map((a) => a.studentId))];
  const first = students.map(
    (id) =>
      rows
        .filter((a) => a.studentId === id)
        .sort((a, b) => a.run - b.run || a.number - b.number)[0],
  );
  const firstTryRate = first.length
    ? first.filter((a) => a.correct).length / first.length
    : null;
  const distinctHelp = new Set(help.filter((id) => reached.includes(id))).size;
  return {
    stepId: step.id,
    title: step.title,
    reached: reached.length,
    studentsWithAttempts: students.length,
    firstTryRate,
    averageAttempts: students.length ? rows.length / students.length : 0,
    helpStudents: distinctHelp,
    difficult:
      reached.length >= DIFFICULT_STEP.minimumReached &&
      ((firstTryRate !== null && firstTryRate < DIFFICULT_STEP.firstTryRate) ||
        distinctHelp / reached.length >= DIFFICULT_STEP.helpRate),
    options: step.options.map((o) => ({
      id: o.id,
      text: o.text,
      count: rows.filter((a) => a.optionId === o.id).length,
      students: new Set(
        rows.filter((a) => a.optionId === o.id).map((a) => a.studentId),
      ).size,
    })),
  };
}
export type StudentStep = Omit<
  LessonStep,
  "options" | "hint" | "correctExplanation" | "questionVersionId"
> & { options: { id: string; text: string }[] };
export function publicStep(step: LessonStep): StudentStep {
  return {
    id: step.id,
    title: step.title,
    explanation: step.explanation,
    altExplanation: "",
    imageAssetId: step.imageAssetId,
    altImageAssetId: null,
    question: step.question,
    options: step.options.map(({ id, text }) => ({ id, text })),
  };
}
