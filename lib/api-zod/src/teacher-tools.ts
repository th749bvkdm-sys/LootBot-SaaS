export interface BankQuestion {
  text: string;
  subject: string;
  grade: string;
  kind: "text" | "multiple-choice" | "true-false";
  options: string[];
  answer: string;
  marks: number;
  tags: string[];
  explanation?: string;
  difficulty?: "easy" | "medium" | "hard";
  objective?: string;
  unit?: string;
  course?: string;
  term?: string;
  language?: "ar" | "en";
  favorite?: boolean;
  source?: string;
}
export interface Blueprint {
  title: string;
  totalMarks: number;
  questionCount: number;
  items: {
    versionId: string;
    marks: number;
    objective: string;
    difficulty: "easy" | "medium" | "hard";
  }[];
}
export function blueprintIssues(b: Blueprint) {
  const issues: string[] = [];
  if (b.items.length !== b.questionCount)
    issues.push("عدد الأسئلة لا يطابق المخطط.");
  if (
    Math.abs(b.items.reduce((n, q) => n + q.marks, 0) - b.totalMarks) > 0.00001
  )
    issues.push("مجموع الدرجات لا يطابق الدرجة الكلية.");
  if (new Set(b.items.map((q) => q.versionId)).size !== b.items.length)
    issues.push("يوجد سؤال مكرر في المخطط.");
  return issues;
}
/** Stable shuffle; never changes the answer text. Unsafe positional answers are not shuffled. */
export function parallelForms(
  items: { versionId: string; marks: number; question: BankQuestion }[],
  seed: number,
) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const shuffle = <T>(values: T[]) => {
    const copy = [...values];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  return ["A", "B", "C"].map((label) => ({
    label,
    items: shuffle(items).map((item) => ({
      ...item,
      question: {
        ...item.question,
        options:
          item.question.kind === "multiple-choice" &&
          item.question.options.filter((o) => o === item.question.answer)
            .length === 1 &&
          !item.question.options.some((o) =>
            /كل ما سبق|جميع ما سبق|none of the above|all of the above/i.test(o),
          )
            ? shuffle(item.question.options)
            : [...item.question.options],
      },
    })),
  }));
}
export interface WeightedGrade {
  marks: number | null;
  totalMarks: number;
  weight: number;
  status?: "graded" | "missing" | "absent" | "exempt";
}
export function weightedGrade(rows: WeightedGrade[], precision = 2) {
  const eligible = rows.filter((r) => r.status !== "exempt");
  const denominator = eligible.reduce((n, r) => n + r.weight, 0);
  const missing = eligible.filter(
    (r) => r.marks === null || r.status === "missing" || r.status === "absent",
  ).length;
  const earned = eligible.reduce(
    (n, r) =>
      n +
      ((r.status === "absent" || r.status === "missing" ? 0 : (r.marks ?? 0)) /
        r.totalMarks) *
        r.weight,
    0,
  );
  return {
    percent: denominator
      ? Number(((earned / denominator) * 100).toFixed(precision))
      : null,
    missing,
    weight: denominator,
    formula:
      "مجموع (الدرجة ÷ الدرجة الكلية × الوزن) ÷ مجموع الأوزان غير المعفاة × 100؛ المفقود والغائب صفر مؤقتًا",
  };
}
export function rubricScore(
  criteria: { max: number; weight: number }[],
  scores: number[],
) {
  if (
    criteria.length !== scores.length ||
    criteria.some(
      (c, i) =>
        !Number.isFinite(c.max) ||
        !Number.isFinite(c.weight) ||
        !Number.isFinite(scores[i]) ||
        c.max <= 0 ||
        c.weight < 0 ||
        scores[i] < 0 ||
        scores[i] > c.max,
    )
  )
    throw Error("درجة معيار غير صالحة.");
  const weight = criteria.reduce((n, c) => n + c.weight, 0);
  return weight
    ? (criteria.reduce((n, c, i) => n + (scores[i] / c.max) * c.weight, 0) /
        weight) *
        100
    : 0;
}
