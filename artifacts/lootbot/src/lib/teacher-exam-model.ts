export type ExamStyle = 'formal' | 'primary' | 'minimal';
export type ExamQuestion = {
  id: string; text: string; kind: 'written' | 'choice' | 'true-false' | 'blank';
  marks: number; answerLines: number; options: string[]; subquestions: string[];
  pageBreakBefore: boolean; requiresReview: boolean; reviewNote: string;
};
export type ExamSection = { id: string; title: string; instructions: string; questions: ExamQuestion[]; pageBreakBefore: boolean };
export type ImageAdjustments = { rotation: number; straighten: number; brightness: number; contrast: number; crop: { x: number; y: number; width: number; height: number } };
export type ExamDocument = {
  schemaVersion: 1;
  metadata: { title: string; school: string; teacher: string; subject: string; grade: string; term: string; date: string; duration: string; totalMarks: number; instructions: string; studentNameLine: boolean; studentNumberLine: boolean; schoolLogoAssetId: string | null };
  layout: { style: ExamStyle; paper: 'A4'; marginMm: number; fontSize: number; lineSpacing: number; questionSpacing: number; alignment: 'right' | 'center' | 'left'; accent: string; header: string; footer: string; pageNumbers: boolean; digits: 'arabic' | 'western'; font: 'arabic' | 'sans' };
  source: { adjustments: ImageAdjustments; processedAssetId: string | null; printBackground: boolean; ocrStatus: 'none' | 'manual' | 'completed' | 'error'; ocrText: string; reviewed: boolean };
  sections: ExamSection[];
};
export type TeacherExam = { id: string; title: string; document: ExamDocument; sourceAssetId: string | null; version: number; createdAt: string; updatedAt: string; isTemplate: boolean };
export const EXAM_STYLES: { value: ExamStyle; title: string; description: string }[] = [
  { value: 'formal', title: 'رسمي', description: 'ترويسة مدرسية، حدود واضحة، ومساحة عملية للإجابات.' },
  { value: 'primary', title: 'مناسب للمرحلة الابتدائية', description: 'عناوين ودودة ونجوم خفيفة، مع نص واضح وزخرفة محدودة.' },
  { value: 'minimal', title: 'اقتصادي للطباعة', description: 'أبيض وأسود، ترويسة مختصرة، واستهلاك أقل للحبر.' },
];
export function examId() { return globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
export function newQuestion(text = ''): ExamQuestion { return { id: examId(), text, kind: 'written', marks: 1, answerLines: 3, options: [], subquestions: [], pageBreakBefore: false, requiresReview: false, reviewNote: '' }; }
export function newSection(title = 'القسم الأول'): ExamSection { return { id: examId(), title, instructions: '', questions: [], pageBreakBefore: false }; }
export function defaultAdjustments(): ImageAdjustments { return { rotation: 0, straighten: 0, brightness: 100, contrast: 100, crop: { x: 0, y: 0, width: 100, height: 100 } }; }
export function createExamDocument(style: ExamStyle = 'formal', profile?: Record<string, unknown>): ExamDocument {
  const name = (key: string) => typeof profile?.[key] === 'string' ? profile[key] as string : '';
  const subjects = Array.isArray(profile?.subjects) ? profile.subjects.filter(value => typeof value === 'string') : [];
  const classes = Array.isArray(profile?.classes) ? profile.classes.filter(value => typeof value === 'string') : [];
  const stage = ({ primary: 'ابتدائي', middle: 'متوسط', secondary: 'ثانوي', other: 'أخرى' } as Record<string, string>)[name('stage')] || name('stage');
  return { schemaVersion: 1,
    metadata: { title: 'اختبار جديد', school: name('schoolName'), teacher: name('teacherName'), subject: subjects[0] ?? '', grade: classes[0] || stage, term: [name('term'), name('year') || name('schoolYear')].filter(Boolean).join(' / '), date: '', duration: '', totalMarks: 0, instructions: '', studentNameLine: true, studentNumberLine: false, schoolLogoAssetId: typeof profile?.logoAssetId === 'string' ? profile.logoAssetId : null },
    layout: { style, paper: 'A4', marginMm: 15, fontSize: style === 'primary' ? 16 : 14, lineSpacing: 1.7, questionSpacing: 12, alignment: 'right', accent: '#475569', header: '', footer: `انتهت الأسئلة — بالتوفيق${name('signature') ? ` / ${name('signature')}` : ''}`, pageNumbers: true, digits: name('digits') === 'western' ? 'western' : 'arabic', font: 'arabic' },
    source: { adjustments: defaultAdjustments(), processedAssetId: null, printBackground: false, ocrStatus: 'none', ocrText: '', reviewed: false }, sections: [newSection()] };
}
export function cloneDocument(document: ExamDocument): ExamDocument { return structuredClone(document); }
export function countExamMarks(document: ExamDocument) { return document.sections.reduce((sum, section) => sum + section.questions.reduce((value, question) => value + question.marks, 0), 0); }
export function examReviewItems(document: ExamDocument): string[] {
  const issues: string[] = [];
  if (!document.metadata.title.trim()) issues.push('أدخل عنوان الاختبار.');
  if (!document.metadata.school.trim()) issues.push('راجع اسم المدرسة.');
  if (!document.metadata.subject.trim()) issues.push('حدد المادة الدراسية.');
  if (!document.sections.some(section => section.questions.length)) issues.push('أضف سؤالًا واحدًا على الأقل.');
  let index = 0;
  for (const section of document.sections) for (const question of section.questions) {
    index++;
    if (!question.text.trim()) issues.push(`السؤال ${index}: نص السؤال فارغ.`);
    if (question.requiresReview) issues.push(`السؤال ${index}: ${question.reviewNote || 'يحتاج مراجعة المعلم بعد الاستخراج.'}`);
    if (question.kind === 'choice' && question.options.filter(option => option.trim()).length < 2) issues.push(`السؤال ${index}: أضف خيارين واضحين على الأقل.`);
  }
  if (document.metadata.totalMarks !== countExamMarks(document)) issues.push('إجمالي الدرجات لا يطابق مجموع درجات الأسئلة.');
  if (document.source.ocrStatus === 'completed' && !document.source.reviewed) issues.push('راجع النص المستخرج من الصورة ثم أكد اكتمال المراجعة.');
  return issues;
}
export function importExtractedLines(document: ExamDocument, text: string, blocks: { text: string; confidence: number | null; requiresReview: boolean }[]): ExamDocument {
  const next = cloneDocument(document);
  const source = blocks.length ? blocks : text.split(/\r?\n/).filter(line => line.trim()).map(line => ({ text: line, confidence: null, requiresReview: true }));
  const questions = source.filter(block => block.text.trim()).map(block => ({ ...newQuestion(block.text.trim()), marks: 0, requiresReview: true, reviewNote: block.confidence != null ? `دقة الاستخراج: ${Math.round(block.confidence * 100)}٪؛ تحقق من النص والدرجات.` : 'تحقق من نص السؤال وترتيبه؛ لم يُفترض أي جواب أو درجة من الصورة.' }));
  if (next.sections.length + Math.ceil(questions.length / 200) > 100) throw new Error('وصل المستند إلى حد الأقسام؛ احفظ النص في اختبار جديد أو أزل الأقسام غير اللازمة.');
  for (let offset = 0; offset < questions.length; offset += 200) { const section = newSection(offset ? `نص مستخرج للمراجعة — متابعة ${Math.floor(offset / 200) + 1}` : 'نص مستخرج للمراجعة'); section.questions = questions.slice(offset, offset + 200); next.sections.push(section); }
  next.source.ocrStatus = 'completed'; next.source.ocrText = text; next.source.reviewed = false;
  return next;
}
export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] { const next = [...items], target = index + direction; if (index < 0 || target < 0 || index >= next.length || target >= next.length) return next; [next[index], next[target]] = [next[target], next[index]]; return next; }
export function copyQuestion(question: ExamQuestion): ExamQuestion { return { ...structuredClone(question), id: examId() }; }
export function formatExamNumber(value: number, digits: 'arabic' | 'western') { return new Intl.NumberFormat(digits === 'arabic' ? 'ar-SA' : 'en-US', { useGrouping: false }).format(value); }
export type ExamPaperBlock = { id: string; kind: 'section'; section: ExamSection; breakBefore: boolean } | { id: string; kind: 'question'; question: ExamQuestion; number: number; breakBefore: boolean };
export function examPaperBlocks(document: ExamDocument): ExamPaperBlock[] {
  let number = 0;
  return document.sections.flatMap(section => [{ id: `${section.id}-heading`, kind: 'section' as const, section, breakBefore: section.pageBreakBefore || !!section.questions[0]?.pageBreakBefore }, ...section.questions.map((question, index) => ({ id: question.id, kind: 'question' as const, question, number: ++number, breakBefore: index > 0 && question.pageBreakBefore }))]);
}
/** Uses actual DOM block heights; keeps a section heading with its first question. */
export function paginateExamBlocks(blocks: ExamPaperBlock[], heights: number[], available: number): { pages: ExamPaperBlock[][]; oversized: boolean } {
  const pages: ExamPaperBlock[][] = [[]]; let remaining = available, oversized = available <= 0;
  blocks.forEach((block, index) => {
    const height = heights[index] ?? 50;
    const following = block.kind === 'section' && blocks[index + 1]?.kind === 'question' ? heights[index + 1] ?? 0 : 0;
    if ((block.breakBefore || height + following > remaining) && pages.at(-1)!.length > 0) { pages.push([]); remaining = available; }
    if (height > available || (block.kind === 'section' && height + following > available)) oversized = true;
    pages.at(-1)!.push(block); remaining -= height;
  });
  return { pages, oversized };
}
/** Explicit page breaks preserve teacher ordering. Browser print fragments long pages safely. */
export function examPages(document: ExamDocument): ExamSection[][] {
  const pages: ExamSection[][] = [[]];
  for (const section of document.sections) {
    if (section.pageBreakBefore && pages.at(-1)!.length) pages.push([]);
    let current = { ...section, questions: [] as ExamQuestion[] };
    for (const question of section.questions) {
      if (question.pageBreakBefore && (current.questions.length || pages.at(-1)!.length)) { if (current.questions.length) pages.at(-1)!.push(current); pages.push([]); current = { ...section, title: `${section.title} — متابعة`, instructions: '', questions: [] }; }
      current.questions.push(question);
    }
    pages.at(-1)!.push(current);
  }
  return pages.filter(page => page.length);
}
