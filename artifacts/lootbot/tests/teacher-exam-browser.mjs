/** Browser acceptance against an explicitly isolated local fictional fixture only. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createExamDocument, newQuestion } from '../src/lib/teacher-exam-model.ts';
const base = process.env.TEACHER_UI_URL || 'http://127.0.0.1:5190';
if (!/^http:\/\/127\.0\.0\.1:51\d{2}$/.test(base)) throw Error('Only the disposable local fixture is allowed.');
const runtime = 'C:/Users/kh7bw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || runtime).href);
const { PDFDocument } = createRequire(import.meta.url)(process.env.PDF_LIB_MODULE || 'C:/Users/kh7bw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdf-lib');
const resultDir = path.resolve('artifacts/lootbot/test-results/teacher-exam'); await mkdir(resultDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ar-SA' });
const page = await context.newPage();
page.setDefaultTimeout(90000); page.setDefaultNavigationTimeout(90000);
const results = [], errors = [];
const suffix = Date.now(), copyTitle = `نسخة قبول تجريبية ${suffix}`, templateTitle = `قالب قبول تجريبي ${suffix}`;
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => void (dialog.type() === 'prompt' ? dialog.accept(dialog.message().includes('قالب') ? templateTitle : copyTitle) : dialog.accept()));
const waitSaved = () => page.locator('.exam-save-status.saved').waitFor({ timeout: 45000 });
async function api(endpoint, method = 'GET', data) {
  const headers = {};
  if (method !== 'GET') { const csrf = await page.request.get(`${base}/api/auth/csrf`); headers['x-csrf-token'] = (await csrf.json()).token; }
  const response = await page.request.fetch(`${base}/api${endpoint}`, { method, headers, ...(data !== undefined ? { data } : {}) });
  assert.ok(response.ok(), `API ${method} ${endpoint}: ${response.status()} ${await response.text()}`);
  return response.json();
}
async function check(name, action) { console.log(`RUN ${name}`); await action(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
try {
  console.log('RUN fixture login');
  await page.goto(`${base}/login`); await page.locator('input[name=email]').fill('teacher@example.invalid'); await page.locator('input[name=password]').fill('Local-Fixture-Only-2026!'); await page.getByTestId('button-submit').click(); await page.waitForURL('**/teacher');
  const document = createExamDocument('formal', await api('/teacher/profile')); document.metadata.title = `اختبار قبول مستقل ${suffix}`; document.sections[0].questions = [newQuestion('اكتب ناتج ٢ + ٣.'), newQuestion('اشرح طريقة جمع عددين.')]; document.metadata.totalMarks = 2;
  let current = await api('/teacher/exams', 'POST', { title: document.metadata.title, document });
  await page.goto(`${base}/teacher/exams`); await page.locator('.tw-list-item').filter({ hasText: document.metadata.title }).getByRole('button', { name: 'فتح وتعديل' }).click();
  await check('editable content and persisted autosave', async () => {
    await page.getByLabel('عنوان الاختبار', { exact: true }).fill('اختبار قبول المحرر');
    await page.getByLabel('المادة', { exact: true }).fill('الرياضيات');
    await page.getByLabel('الصف / الفصل', { exact: true }).fill('الصف الثالث — تجريبي');
    await page.getByRole('button', { name: 'إضافة سؤال', exact: true }).first().click();
    const last = page.locator('.exam-question-editor').last();
    await last.getByLabel('نص السؤال', { exact: true }).fill('اختر ناتج ٣ + ٢.');
    await last.getByLabel('نوع السؤال').selectOption('choice');
    await last.getByLabel('الخيار 1', { exact: true }).fill('٥'); await last.getByLabel('الخيار 2', { exact: true }).fill('٧');
    await last.getByLabel('الدرجة', { exact: true }).fill('2');
    await last.getByLabel('ابدأ في صفحة جديدة', { exact: true }).check();
    await page.getByRole('button', { name: 'اعتماد المجموع' }).click(); await waitSaved();
    current = await api(`/teacher/exams/${current.id}`); assert.equal(current.title, 'اختبار قبول المحرر'); assert.equal(current.document.sections[0].questions.at(-1).options[0], '٥'); assert.equal(current.document.metadata.totalMarks, 4);
  });
  await check('undo, redo, question duplication and ordering', async () => {
    const last = page.locator('.exam-question-editor').last(); await last.getByLabel('نص السؤال', { exact: true }).fill('نص معدل للتراجع');
    await page.getByRole('button', { name: 'تراجع', exact: true }).click(); assert.equal(await last.getByLabel('نص السؤال', { exact: true }).inputValue(), 'اختر ناتج ٣ + ٢.');
    await page.getByRole('button', { name: 'إعادة', exact: true }).click(); assert.equal(await last.getByLabel('نص السؤال', { exact: true }).inputValue(), 'نص معدل للتراجع');
    await last.getByRole('button', { name: 'تكرار السؤال', exact: true }).click(); assert.equal(await page.locator('.exam-question-editor').count(), 4);
    await page.locator('.exam-question-editor').last().getByRole('button', { name: 'نقل السؤال لأعلى', exact: true }).click(); await waitSaved();
  });
  await check('save failure remains visible and retry persists', async () => {
    let intercepted = false;
    await page.route(`**/api/teacher/exams/${current.id}`, async route => { if (route.request().method() === 'PUT' && !intercepted) { intercepted = true; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'خطأ حفظ تجريبي مؤقت' }) }); } else await route.continue(); });
    await page.getByLabel('المدة', { exact: true }).fill('٣٠ دقيقة'); await page.locator('.exam-save-status.error').waitFor(); assert.equal(await page.getByLabel('المدة', { exact: true }).inputValue(), '٣٠ دقيقة');
    await page.unroute(`**/api/teacher/exams/${current.id}`); await page.getByRole('button', { name: 'حفظ الآن', exact: true }).click(); await waitSaved(); assert.equal((await api(`/teacher/exams/${current.id}`)).document.metadata.duration, '٣٠ دقيقة');
  });
  await check('version conflict protects saved data and allows an independent copy', async () => {
    current = await api(`/teacher/exams/${current.id}`); const external = structuredClone(current.document); external.metadata.title = 'إصدار آخر محفوظ';
    await api(`/teacher/exams/${current.id}`, 'PUT', { title: external.metadata.title, document: external, expectedVersion: current.version, sourceAssetId: current.sourceAssetId, isTemplate: false });
    await page.getByLabel('عنوان الاختبار', { exact: true }).fill('تعديل محلي يحتاج نسخة'); await page.locator('.exam-save-status.conflict').waitFor();
    assert.equal((await api(`/teacher/exams/${current.id}`)).title, 'إصدار آخر محفوظ');
    await page.getByRole('button', { name: 'حفظ تعديلاتي كنسخة', exact: true }).click(); await waitSaved();
    current = (await api('/teacher/exams')).find(exam => exam.title === copyTitle); assert.ok(current); assert.equal(current.document.sections[0].questions.length, 4);
  });
  await check('private image, rotation, crop, adjusted asset and honest manual OCR fallback', async () => {
    await page.getByRole('button', { name: 'الصورة والاستخراج', exact: true }).click();
    const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 800; const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 640, 800); ctx.fillStyle = 'black'; ctx.font = '24px Arial'; ctx.fillText('Fictional exam 2 + 3 = ?', 60, 100); return canvas.toDataURL('image/png').split(',')[1]; });
    const bytes = Buffer.from(png, 'base64'); await page.getByLabel('ارفع صورة الاختبار', { exact: true }).setInputFiles({ name: 'fictional-exam.png', mimeType: 'image/png', buffer: bytes });
    await page.locator('.exam-source-image img').waitFor(); await page.getByRole('button', { name: 'تدوير ٩٠°', exact: true }).click();
    await page.getByLabel('بداية القص أفقيًا (%)', { exact: true }).fill('5'); await page.getByLabel('عرض الجزء المقصوص (%)', { exact: true }).fill('90');
    await page.getByRole('button', { name: 'حفظ الصورة المعدلة', exact: true }).click(); await page.getByText('حُفظت نسخة الصورة بعد القص والتعديل؛ الأصل لم يتغير.', { exact: true }).waitFor(); await waitSaved();
    current = await api(`/teacher/exams/${current.id}`); assert.ok(current.sourceAssetId); assert.notEqual(current.sourceAssetId, current.document.source.processedAssetId);
    const original = await page.request.get(`${base}/api/teacher/assets/${current.sourceAssetId}`); assert.equal(createHash('sha256').update(await original.body()).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
    await page.getByRole('button', { name: 'استخراج النص ومراجعته', exact: true }).click(); await page.getByText(/الاستخراج الآلي غير مفعّل/).waitFor(); await waitSaved();
    assert.equal((await api(`/teacher/exams/${current.id}`)).document.source.ocrStatus, 'manual');
    await page.getByLabel('نص الأسئلة الذي تراجعه يدويًا', { exact: true }).fill('سؤال عربي تجريبي\nExplain a fictional result.'); await page.getByRole('button', { name: 'إضافة السطور كأسئلة للمراجعة', exact: true }).click(); await waitSaved();
    const manual = (await api(`/teacher/exams/${current.id}`)).document; assert.equal(manual.source.ocrStatus, 'manual'); assert.ok(manual.sections.at(-1).questions.every(question => question.requiresReview && question.marks === 0));
    await page.getByLabel(/استخدام الصورة المحفوظة كخلفية ورقة/).check(); await waitSaved();
  });
  await check('three print styles preserve editable content and template creation works', async () => {
    const before = (await api(`/teacher/exams/${current.id}`)).document.sections;
    await page.getByRole('button', { name: 'تصميم الورقة', exact: true }).click();
    const borders = [];
    for (const [style, label] of [['primary', 'مناسب للمرحلة الابتدائية'], ['minimal', 'اقتصادي للطباعة'], ['formal', 'رسمي']]) {
      await page.locator('.exam-edit-panel .exam-style-card').filter({ has: page.getByText(label, { exact: true }) }).click(); await waitSaved();
      const saved = await api(`/teacher/exams/${current.id}`); assert.equal(saved.document.layout.style, style); assert.deepEqual(saved.document.sections, before);
      borders.push(await page.locator('.exam-live-preview .exam-paper-section h2').first().evaluate(element => getComputedStyle(element).borderStyle));
      await page.getByRole('button', { name: 'المعاينة والطباعة / PDF', exact: true }).click();
      await page.locator('.exam-print-root .exam-a4').first().screenshot({ path: path.join(resultDir, `style-${style}.png`) });
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await page.pdf({ path: path.join(resultDir, `style-${style}.pdf`), printBackground: true, preferCSSPageSize: true });
      await page.emulateMedia({ media: 'screen' });
      await page.getByRole('button', { name: 'إغلاق المعاينة', exact: true }).click();
    }
    assert.ok(new Set(borders).size >= 2);
    await page.getByRole('button', { name: 'حفظ كقالب', exact: true }).click(); await page.getByText('حُفظ القالب؛ يمكنك إنشاء اختبار مستقل منه في مكتبة القوالب.', { exact: true }).waitFor(); assert.ok((await api('/teacher/exams?templates=true')).some(exam => exam.title === templateTitle));
  });
  await check('responsive RTL desktop, iPad and mobile; keyboard and reduced motion', async () => {
    for (const [name, width, height] of [['desktop', 1440, 1000], ['ipad', 820, 1180], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.screenshot({ path: path.join(resultDir, `${name}.png`), fullPage: true });
      await page.screenshot({ path: path.join(resultDir, `${name}-viewport.png`) });
      const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: innerWidth, direction: getComputedStyle(document.querySelector('.exam-workspace')).direction }));
      assert.ok(layout.scrollWidth <= layout.width + 1, `${name}: unexpected outer overflow ${layout.scrollWidth}/${layout.width}`); assert.equal(layout.direction, 'rtl');
    }
    await page.emulateMedia({ reducedMotion: 'reduce' }); const transition = await page.locator('.exam-edit-panel .exam-style-card').first().evaluate(element => getComputedStyle(element).transitionDuration); assert.equal(transition, '0s'); await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.getByRole('button', { name: 'المعاينة والطباعة / PDF', exact: true }).click(); await page.getByRole('button', { name: 'إغلاق المعاينة', exact: true }).focus(); await page.keyboard.press('Tab'); assert.equal(await page.locator(':focus').innerText(), 'طباعة / حفظ PDF');
  });
  await check('real Chromium A4 PDF generation includes multiple ordered pages', async () => {
    await page.locator('.exam-print-root .exam-a4').nth(1).waitFor(); const pages = await page.locator('.exam-print-root .exam-a4').count(); assert.ok(pages >= 2);
    const box = await page.locator('.exam-print-root .exam-a4').first().boundingBox(); assert.ok(Math.abs(box.width / box.height - 210 / 297) < .01);
    await page.evaluate(() => { window.__teacherPrintCalls = 0; window.print = () => { window.__teacherPrintCalls++; }; });
    await page.getByRole('button', { name: 'طباعة / حفظ PDF', exact: true }).click(); await page.waitForFunction(() => window.__teacherPrintCalls === 1);
    await page.emulateMedia({ media: 'print' }); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const headers = await page.locator('.exam-print-root .exam-a4 .exam-paper-header').evaluateAll(items => items.map(header => ({ height: header.getBoundingClientRect().height, text: header.textContent })));
    assert.ok(headers.every(header => header.height > 100 && header.text.includes('مدرسة الاختبار الوهمية')));
    const pdfBytes = await page.pdf({ path: path.join(resultDir, 'fictional-exam-a4.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
    const pdf = await PDFDocument.load(pdfBytes); assert.equal(pdf.getPageCount(), pages, 'Printed page count matches the measured preview');
    for (const pdfPage of pdf.getPages()) { const size = pdfPage.getSize(); assert.ok(Math.abs(size.width / size.height - 210 / 297) < .01); }
    await page.emulateMedia({ media: 'screen' }); await page.screenshot({ path: path.join(resultDir, 'print-preview.png'), fullPage: true });
    await page.getByRole('button', { name: 'إغلاق المعاينة', exact: true }).click();
  });
  await check('saved document can be reopened after refresh', async () => {
    await page.getByRole('button', { name: 'العودة للمكتبة', exact: true }).click(); await page.reload(); await page.locator('.tw-list-item').filter({ hasText: copyTitle }).getByRole('button', { name: 'فتح وتعديل' }).click(); assert.equal(await page.getByLabel('عنوان الاختبار', { exact: true }).inputValue(), copyTitle); await page.getByRole('button', { name: 'الصورة والاستخراج', exact: true }).click(); await page.locator('.exam-source-image img').waitFor();
  });
  assert.deepEqual(errors, [], 'No browser runtime exceptions');
  await writeFile(path.join(resultDir, 'results.json'), JSON.stringify({ passed: results.length, results, runtimeErrors: errors, fixture: 'disposable local fictional data', limitation: 'OCR external provider deliberately not configured; actual Safari/iOS hardware not available.' }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(resultDir, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(resultDir, 'results.json'), JSON.stringify({ results, runtimeErrors: errors, failure: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
