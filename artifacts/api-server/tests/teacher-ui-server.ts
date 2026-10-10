/** Fictional local browser fixture, created only inside a disposable acceptance schema. */
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import app from '../src/app';
import { passwordHash } from '../src/lib/security';
import { createExamDocument, newQuestion } from '../../lootbot/src/lib/teacher-exam-model';
if (!/^teacher_qa_[a-f0-9]{32}$/.test(process.env.TEACHER_TEST_SCHEMA ?? '')) throw Error('Disposable schema required.');
const teacher = randomUUID(), merchant = randomUUID(), newUser = randomUUID(), store = randomUUID(), category = randomUUID(), classId = randomUUID();
const password = 'Local-Fixture-Only-2026!';
const hash = await passwordHash(password);
for (const [id, type, name, email] of [[teacher, 'teacher', 'معلم تجريبي', 'teacher@example.invalid'], [merchant, 'merchant', 'تاجر تجريبي', 'merchant@example.invalid'], [newUser, null, 'حساب جديد تجريبي', 'new@example.invalid']] as const) await pool.query('INSERT INTO users(id,name,email,password_hash,account_type) VALUES($1,$2,$3,$4,$5)', [id, name, email, hash, type]);
const profile = { teacherName: 'معلم تجريبي', schoolName: 'مدرسة الاختبار الوهمية', stage: 'primary', subjects: ['الرياضيات'], classes: ['الصف الثالث'], term: 'الفصل الأول', year: '2026', city: '', printStyle: 'formal', digits: 'arabic', paperSize: 'A4', logoAssetId: null, signature: '', onboardingStep: 2, complete: true };
await pool.query('INSERT INTO teacher_profiles(owner_id,data,complete) VALUES($1,$2,true)', [teacher, JSON.stringify(profile)]);
await pool.query('INSERT INTO teacher_classes(id,owner_id,name,data) VALUES($1,$2,$3,$4)', [classId, teacher, 'الصف التجريبي', JSON.stringify({ name: 'الصف التجريبي', grade: 'الثالث', section: 'أ', subject: 'الرياضيات', year: '2026', term: 'الأول', notes: '', archived: false })]);
for (let index = 1; index <= 5; index++) await pool.query('INSERT INTO teacher_students(id,owner_id,class_id,name,internal_id) VALUES($1,$2,$3,$4,$5)', [randomUUID(), teacher, classId, `طالب تجريبي ${index}`, String(index)]);
const document = createExamDocument('formal', profile); document.metadata.title = 'اختبار تجريبي'; document.sections[0].questions = [newQuestion('اكتب ناتج ٢ + ٣.'), newQuestion('اشرح طريقة جمع عددين.')]; document.metadata.totalMarks = 2;
await pool.query('INSERT INTO teacher_exams(id,owner_id,title,document) VALUES($1,$2,$3,$4)', [randomUUID(), teacher, document.metadata.title, JSON.stringify(document)]);
await pool.query('INSERT INTO stores(id,owner_id,name,slug,currency) VALUES($1,$2,$3,$4,$5)', [store, merchant, 'متجر الاختبار الوهمي', 'local-fixture-store', 'SAR']);
await pool.query('INSERT INTO store_settings(store_id,settings) VALUES($1,$2)', [store, JSON.stringify({ plan: { code: 'BUSINESS' }, storefront: { theme: 'nebula', enabled: true } })]);
await pool.query('INSERT INTO categories(id,store_id,name) VALUES($1,$2,$3)', [category, store, 'تصنيف تجريبي']);
for (let index = 1; index <= 4; index++) await pool.query('INSERT INTO products(id,store_id,category_id,name,price,stock,is_published) VALUES($1,$2,$3,$4,$5,$6,true)', [randomUUID(), store, category, `منتج تجريبي ${index}`, String(20 + index), 5]);
const server = app.listen(5190, '127.0.0.1', () => console.log('TEACHER_UI_READY http://127.0.0.1:5190 fixture-password=Local-Fixture-Only-2026!'));
let closing = false;
async function close() { if (closing) return; closing = true; await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); process.exit(0); }
process.stdin.resume(); process.stdin.on('data', chunk => { if (chunk.toString().includes('stop')) void close(); });
process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
