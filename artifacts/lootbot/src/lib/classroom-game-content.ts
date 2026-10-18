import type { TeacherQuestion, TeacherLesson } from "./teacher-api";
export type GameWord = {
  id: string;
  word: string;
  hint: string;
  subject: string;
  unit: string;
  term: string;
  origin: "starter" | "teacher";
};
export type GameQuestion = {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
  subject: string;
  origin: "starter" | "teacher";
};
const content: Record<string, [string, string][]> = {
  العلوم: [
    ["التبخر", "تحول المادة من الحالة السائلة إلى الحالة الغازية."],
    ["التكاثف", "تحول بخار الماء إلى سائل عند تبريده."],
    ["الجاذبية", "قوة تجاذب بين الأجسام ذات الكتلة."],
    ["الخلية", "الوحدة الأساسية لبناء الكائنات الحية."],
    [
      "البناء الضوئي",
      "عملية تصنع بها النباتات الخضراء غذاءها مستفيدة من الضوء.",
    ],
    ["التجمد", "تحول المادة من الحالة السائلة إلى الحالة الصلبة."],
  ],
  الرياضيات: [
    ["المحيط", "مجموع أطوال أضلاع الشكل."],
    ["المساحة", "مقدار السطح داخل حدود شكل مستوٍ."],
    ["المقام", "العدد أسفل خط الكسر."],
    ["البسط", "العدد أعلى خط الكسر."],
    ["العدد الزوجي", "عدد صحيح يقبل القسمة على 2 دون باقٍ."],
    ["المثلث", "شكل مستوٍ مغلق له ثلاثة أضلاع."],
  ],
  لغتي: [
    ["الفاعل", "اسم مرفوع يدل على من قام بالفعل أو اتصف به."],
    ["المبتدأ", "اسم مرفوع تبدأ به الجملة الاسمية غالبًا."],
    ["الخبر", "ما يتمم معنى المبتدأ في الجملة الاسمية."],
    ["الفعل الماضي", "فعل يدل على حدث وقع قبل زمن التكلم."],
    ["الفعل المضارع", "فعل يدل على حدث يقع في الحاضر أو المستقبل."],
    ["جمع التكسير", "جمع تتغير فيه صورة المفرد."],
  ],
  "الدراسات الإسلامية": [
    ["الصلاة", "عبادة ذات أقوال وأفعال مخصوصة تبدأ بالتكبير وتنتهي بالتسليم."],
    ["الزكاة", "حق واجب في المال عند تحقق شروطه."],
    [
      "الصيام",
      "الإمساك عن المفطرات من طلوع الفجر إلى غروب الشمس بنية العبادة.",
    ],
    ["الحج", "قصد البيت الحرام لأداء مناسك مخصوصة في وقت مخصوص."],
    ["الوضوء", "غسل أعضاء مخصوصة ومسحها استعدادًا للصلاة ونحوها."],
    ["الصدق", "قول الحق ومطابقة الكلام للواقع."],
  ],
  الاجتماعيات: [
    ["الخريطة", "رسم مبسط لسطح الأرض أو جزء منه."],
    ["المفتاح", "دليل يشرح الرموز المستخدمة في الخريطة."],
    ["خط الاستواء", "خط وهمي يقسم الأرض إلى نصفين شمالي وجنوبي."],
    ["القارة", "كتلة كبيرة من اليابسة تضم بلدانًا متعددة."],
    ["المناخ", "متوسط أحوال الطقس في منطقة خلال مدة طويلة."],
    ["الطقس", "حالة الجو في مكان وزمن محددين."],
  ],
  الإنجليزية: [
    ["Book", "كلمة إنجليزية معناها كتاب."],
    ["School", "كلمة إنجليزية معناها مدرسة."],
    ["Water", "كلمة إنجليزية معناها ماء."],
    ["Teacher", "كلمة إنجليزية معناها معلم أو معلمة."],
    ["Friend", "كلمة إنجليزية معناها صديق."],
    ["Sun", "كلمة إنجليزية معناها الشمس."],
  ],
};
/** Original introductory content, not a claim of alignment with an official textbook. */
export const starterWords: GameWord[] = Object.entries(content).flatMap(
  ([subject, rows], s) =>
    rows.map(([word, hint], i) => ({
      id: `starter-word-${s}-${i}`,
      word,
      hint,
      subject,
      unit: "تأسيس المفاهيم",
      term: "عام",
      origin: "starter" as const,
    })),
);
export const starterQuestions: GameQuestion[] = starterWords.map((word, i) => {
  const distractors = starterWords
      .filter((w) => w.subject === word.subject && w.id !== word.id)
      .slice(0, 3)
      .map((w) => w.word),
    correctIndex = i % 4,
    options = [...distractors];
  options.splice(correctIndex, 0, word.word);
  return {
    id: "question-" + word.id,
    text: "أي مصطلح يعني: " + word.hint,
    options,
    correctIndex,
    subject: word.subject,
    origin: "starter",
  };
});
starterQuestions.push(
  {
    id: "starter-mul-8",
    text: "ناتج 8 × 7 يساوي:",
    options: ["48", "54", "56", "64"],
    correctIndex: 2,
    subject: "الرياضيات",
    origin: "starter",
  },
  {
    id: "starter-mul-6",
    text: "ناتج 6 × 7 يساوي:",
    options: ["36", "42", "48", "49"],
    correctIndex: 1,
    subject: "الرياضيات",
    origin: "starter",
  },
  {
    id: "starter-mercury",
    text: "ما الكوكب الأقرب إلى الشمس؟",
    options: ["الأرض", "المريخ", "عطارد", "زحل"],
    correctIndex: 2,
    subject: "العلوم",
    origin: "starter",
  },
  {
    id: "starter-jupiter",
    text: "أكبر كواكب المجموعة الشمسية هو:",
    options: ["المشتري", "زحل", "الأرض", "نبتون"],
    correctIndex: 0,
    subject: "العلوم",
    origin: "starter",
  },
  {
    id: "starter-force",
    text: "وحدة قياس القوة في النظام الدولي هي:",
    options: ["المتر", "الثانية", "الكيلوغرام", "النيوتن"],
    correctIndex: 3,
    subject: "العلوم",
    origin: "starter",
  },
);
export function teacherGameQuestions(rows: TeacherQuestion[]): GameQuestion[] {
  return rows
    .filter(
      (q) =>
        !q.archived &&
        q.kind === "multiple-choice" &&
        q.options.length >= 2 &&
        q.options.length <= 6 &&
        q.options.includes(q.answer),
    )
    .map((q) => ({
      id: q.id,
      text: q.text,
      options: q.options,
      correctIndex: q.options.indexOf(q.answer),
      subject: q.subject || "بنك المعلم",
      origin: "teacher",
    }));
}
export function wordsFromLesson(lesson: TeacherLesson): GameWord[] {
  return [lesson.content, lesson.objectives]
    .filter(Boolean)
    .join("\n")
    .split(/\n/)
    .map((line) => line.split("|").map((s) => s.trim()))
    .filter(([word]) => word && word.length <= 80)
    .slice(0, 100)
    .map(([word, hint], i) => ({
      id: `lesson-${lesson.id}-${i}`,
      word,
      hint: hint || "",
      subject: "تحضير المعلم",
      unit: lesson.title,
      term: "عام",
      origin: "teacher",
    }));
}
export function customWords(text: string): GameWord[] {
  return text
    .split("\n")
    .map((line) => line.split("|").map((s) => s.trim()))
    .filter(([word]) => word && word.length <= 80)
    .slice(0, 200)
    .map(([word, hint], i) => ({
      id: "custom-" + i,
      word,
      hint: hint?.slice(0, 2000) || "",
      subject: "مفرداتي",
      unit: "قائمة مخصصة",
      term: "عام",
      origin: "teacher",
    }));
}
