import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneDocument, copyQuestion, countExamMarks, createExamDocument, examPaperBlocks, examReviewItems, formatExamNumber, importExtractedLines, moveItem, newQuestion, newSection, paginateExamBlocks } from './teacher-exam-model.ts';

test('profile values prefill a real A4 document without inventing questions', () => {
  const doc = createExamDocument('primary', { teacherName: 'معلم تجريبي', schoolName: 'مدرسة اختبار', subjects: ['رياضيات', 'علوم'], stage: 'ابتدائي', term: 'الأول', year: '1448', logoAssetId: 'private-test-logo' });
  assert.equal(doc.layout.paper, 'A4'); assert.equal(doc.layout.style, 'primary');
  assert.equal(doc.metadata.subject, 'رياضيات'); assert.equal(doc.metadata.term, 'الأول / 1448');
  assert.equal(doc.metadata.schoolLogoAssetId, 'private-test-logo'); assert.equal(doc.sections[0].questions.length, 0);
});
test('duplicate questions receive new identities and independent nested options', () => {
  const question = { ...newQuestion('اختر'), options: ['أ', 'ب'], subquestions: ['فرع'] };
  const copy = copyQuestion(question); copy.options[0] = 'مختلف'; copy.subquestions.push('إضافة');
  assert.notEqual(copy.id, question.id); assert.equal(question.options[0], 'أ'); assert.equal(question.subquestions.length, 1);
});
test('design styles remain independent of editable document content and source', () => {
  const original = createExamDocument(); original.sections[0].questions.push(newQuestion('سؤال حقيقي')); original.source.ocrText = 'نص مرجعي';
  const copy = cloneDocument(original); copy.layout.style = 'minimal'; copy.layout.fontSize = 12;
  assert.deepEqual(copy.sections, original.sections); assert.deepEqual(copy.metadata, original.metadata); assert.deepEqual(copy.source, original.source); assert.equal(original.layout.style, 'formal');
});
test('OCR blocks are editable, always require review, and never guess marks or answers', () => {
  const original = createExamDocument();
  const extracted = importExtractedLines(original, 'نص', [{ text: 'سؤال غير واضح', confidence: .55, requiresReview: true }, { text: 'إجابة؟', confidence: .99, requiresReview: false }]);
  assert.equal(original.sections.length, 1); assert.equal(extracted.source.reviewed, false);
  for (const question of extracted.sections[1].questions) { assert.equal(question.requiresReview, true); assert.equal(question.marks, 0); assert.deepEqual(question.options, []); }
  assert.equal(extracted.source.ocrStatus, 'completed');
});
test('manual fallback preserves every nonempty Arabic and English line without an invented answer', () => {
  const doc = importExtractedLines(createExamDocument(), 'ما الناتج؟\n\nExplain the result.\n', []);
  assert.deepEqual(doc.sections[1].questions.map(question => question.text), ['ما الناتج؟', 'Explain the result.']);
  assert.ok(doc.sections[1].questions.every(question => question.reviewNote.includes('لم يُفترض')));
});
test('large extraction is divided into bounded sections without losing lines', () => {
  const blocks = Array.from({ length: 501 }, (_, index) => ({ text: `سطر تجريبي ${index}`, confidence: null, requiresReview: true }));
  const doc = importExtractedLines(createExamDocument(), '', blocks);
  assert.deepEqual(doc.sections.slice(1).map(section => section.questions.length), [200, 200, 101]);
  assert.equal(doc.sections.flatMap(section => section.questions).at(-1).text, 'سطر تجريبي 500');
});
test('review detects absent fields, empty questions, choices, marks, and unreviewed OCR', () => {
  const doc = createExamDocument(); doc.sections[0].questions.push({ ...newQuestion(), kind: 'choice', options: ['خيار واحد'], requiresReview: true }); doc.source.ocrStatus = 'completed';
  const review = examReviewItems(doc).join('\n');
  for (const phrase of ['اسم المدرسة', 'المادة', 'نص السؤال فارغ', 'خيارين', 'إجمالي الدرجات', 'أكد اكتمال المراجعة']) assert.ok(review.includes(phrase), `Missing review for ${phrase}`);
});
test('all allocated marks are counted and question ordering boundaries are safe', () => {
  const doc = createExamDocument(); doc.sections[0].questions = [{ ...newQuestion('أ'), marks: 2.5 }, { ...newQuestion('ب'), marks: 4 }];
  assert.equal(countExamMarks(doc), 6.5); assert.deepEqual(moveItem([1, 2, 3], 0, -1), [1, 2, 3]); assert.deepEqual(moveItem([1, 2, 3], 1, 1), [1, 3, 2]);
});
test('measured pagination honors manual page breaks and retains headings with their question', () => {
  const doc = createExamDocument(); doc.sections[0].questions = [newQuestion('أ')];
  const second = newSection('الثاني'); second.questions = [{ ...newQuestion('ب'), pageBreakBefore: true }, newQuestion('ج')]; doc.sections.push(second);
  const blocks = examPaperBlocks(doc); const result = paginateExamBlocks(blocks, [40, 120, 40, 120, 120], 250);
  assert.deepEqual(result.pages.map(page => page.map(block => block.kind)), [['section', 'question'], ['section', 'question'], ['question']]); assert.equal(result.oversized, false);
  assert.deepEqual(result.pages.flat().filter(block => block.kind === 'question').map(block => block.number), [1, 2, 3]);
});
test('pagination flags a question too tall for A4 instead of silently truncating it', () => {
  const doc = createExamDocument(); doc.sections[0].questions.push(newQuestion('سؤال طويل'));
  const result = paginateExamBlocks(examPaperBlocks(doc), [40, 400], 250);
  assert.equal(result.oversized, true); assert.equal(result.pages.flat().length, 2);
});
test('digit formatting supports Arabic and Western display and preserves numerical storage', () => {
  assert.equal(formatExamNumber(123, 'arabic'), '١٢٣'); assert.equal(formatExamNumber(123, 'western'), '123');
});
