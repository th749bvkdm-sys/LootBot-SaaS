import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, BookOpen, Check, Copy, FileImage, FilePlus2, FolderOpen, ImagePlus, Loader2, Plus, Printer, Redo2, RotateCw, Save, ScanText, Trash2, Undo2, X } from 'lucide-react';
import { teacherApi, uploadTeacherAsset, TeacherApiError, type TeacherProfile, type TeacherQuestion } from '../lib/teacher-api';
import { cloneDocument, copyQuestion, countExamMarks, createExamDocument, EXAM_STYLES, examPaperBlocks, examReviewItems, formatExamNumber, importExtractedLines, moveItem, newQuestion, newSection, paginateExamBlocks, type ExamDocument, type ExamPaperBlock, type ExamQuestion, type ExamSection, type ExamStyle, type ImageAdjustments, type TeacherExam } from '../lib/teacher-exam-model';
import './teacher-exam-editor.css';

const EXAM_LIST_KEY = ['teacher', 'exams'];
function message(error: unknown) { return error instanceof Error ? error.message : 'تعذر إتمام العملية. حاول مجددًا.'; }
function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) { const id = useId(); return <div className={`tw-field ${wide ? 'wide' : ''}`}><label htmlFor={id}>{label}</label>{Children.map(children, child => isValidElement(child) && typeof child.type === 'string' && ['input', 'textarea', 'select'].includes(child.type) ? cloneElement(child as ReactElement<{ id?: string }>, { id }) : child)}</div>; }
function Tool({ title, children, onClick, disabled = false }: { title: string; children: ReactNode; onClick: () => void; disabled?: boolean }) { return <button type="button" className="tw-button tw-icon-button" title={title} aria-label={title} onClick={onClick} disabled={disabled}>{children}</button>; }
function documentIsSupported(value: unknown): value is ExamDocument { return !!value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 1 && 'sections' in value && Array.isArray(value.sections) && 'metadata' in value && 'layout' in value && 'source' in value; }

export function TeacherExams({ templatesOnly = false }: { templatesOnly?: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: [...EXAM_LIST_KEY, templatesOnly], queryFn: () => teacherApi<TeacherExam[]>(`/teacher/exams?templates=${templatesOnly ? 'true' : 'false'}`) });
  const profile = useQuery({ queryKey: ['teacher', 'profile'], queryFn: () => teacherApi<TeacherProfile>('/teacher/profile') });
  const [active, setActive] = useState<TeacherExam | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const invalidate = useCallback(() => { void client.invalidateQueries({ queryKey: EXAM_LIST_KEY }); void client.invalidateQueries({ queryKey: ['teacher', 'dashboard'] }); }, [client]);
  async function create(style: ExamStyle, image = false) {
    setBusy(true); setError('');
    try {
      const document = createExamDocument(style, profile.data as unknown as Record<string, unknown>);
      document.metadata.title = templatesOnly ? `قالب ${EXAM_STYLES.find(item => item.value === style)?.title ?? 'اختبار'}` : image ? 'اختبار من صورة' : 'اختبار جديد';
      const exam = await teacherApi<TeacherExam>('/teacher/exams', 'POST', { title: document.metadata.title, document, isTemplate: templatesOnly });
      setActive(exam); invalidate();
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function open(id: string, fromTemplate = false) {
    setBusy(true); setError('');
    try { const exam = fromTemplate ? await teacherApi<TeacherExam>(`/teacher/exams/${id}/clone`, 'POST', { title: 'اختبار من قالب', isTemplate: false }) : await teacherApi<TeacherExam>(`/teacher/exams/${id}`); if (!documentIsSupported(exam.document)) throw new Error('صيغة هذا المستند غير مدعومة في المحرر الحالي. احتفظ بالأصل دون تغييره.'); setActive(exam); invalidate(); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function archive(exam: TeacherExam) {
    if (!window.confirm(`هل تريد أرشفة «${exam.title}»؟ سيبقى المستند محفوظًا في قاعدة البيانات.`)) return;
    setBusy(true); setError(''); try { await teacherApi(`/teacher/exams/${exam.id}`, 'DELETE'); invalidate(); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  if (active) return <ExamEditor key={active.id} initial={active} onClose={() => { setActive(null); invalidate(); }} onSaved={invalidate} onCopy={exam => { setActive(exam); invalidate(); }} />;
  const list = query.data?.filter(exam => exam.title.includes(search.trim())) ?? [];
  return <section className="exam-workspace" dir="rtl">
    <header className="tw-heading"><div><p className="tw-eyebrow">غرفة المعلم / مستندات قابلة للتعديل</p><h1>{templatesOnly ? 'القوالب والتصاميم' : 'الاختبارات وتصميم أوراق الأسئلة'}</h1><p>مستندات محفوظة، أسئلة قابلة للتعديل، ومعاينة فعلية بحجم A4. تصميم الورقة مستقل عن مظهر لوحة المعلم.</p></div><button className="tw-button primary" disabled={busy} onClick={() => void create(profile.data?.printStyle ?? 'formal')}><FilePlus2 size={17}/>{templatesOnly ? 'إنشاء قالب' : 'اختبار جديد'}</button></header>
    {error && <div className="tw-error" role="alert">{error}</div>}
    {!templatesOnly && <div className="tw-card exam-import-entry"><FileImage size={30}/><div><h2>حوّل صورة اختبار إلى اختبار قابل للتعديل</h2><p className="tw-muted">ارفع صورة أصلية، عدّل اتجاهها، ثم راجع النص المستخرج أو اكتب الأسئلة يدويًا. لا تُفترض إجابات أو نصوص غير مقروءة.</p></div><button className="tw-button" disabled={busy} onClick={() => void create(profile.data?.printStyle ?? 'formal', true)}><ImagePlus size={17}/>ابدأ من صورة</button></div>}
    <div className="exam-style-grid">{EXAM_STYLES.map(style => <button key={style.value} className={`exam-style-card ${style.value}`} disabled={busy} onClick={() => void create(style.value)}><span className="exam-template-mini" aria-hidden="true"><span/><i/><i/><i/></span><strong>{style.title}</strong><p>{style.description}</p><span>إنشاء {templatesOnly ? 'قالب' : 'اختبار'} بهذا التصميم ←</span></button>)}</div>
    <section className="tw-card"><div className="tw-toolbar"><h2>{templatesOnly ? 'قوالبي المحفوظة' : 'الاختبارات المحفوظة'}</h2><Field label="البحث في العناوين"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="عنوان المستند"/></Field></div>
      {query.isPending ? <div className="tw-loading" aria-busy="true">جارٍ تحميل المستندات…</div> : query.error ? <div className="tw-error" role="alert">{message(query.error)} <button className="tw-button" onClick={() => void query.refetch()}>إعادة المحاولة</button></div> : list.length === 0 ? <div className="tw-empty"><FolderOpen/><strong>{search ? 'لا توجد نتائج مطابقة' : 'لا توجد مستندات محفوظة بعد'}</strong><p>ابدأ بتصميم جاهز أو بصورة اختبار. لن تظهر بيانات تجريبية ضمن ملفاتك.</p></div> : <div className="tw-list">{list.map(exam => <article className="tw-list-item" key={exam.id}><div><strong>{exam.title}</strong><p>{exam.isTemplate ? 'قالب قابل لإعادة الاستخدام' : 'اختبار'} · آخر تعديل: {new Date(exam.updatedAt).toLocaleDateString('ar-SA')} · إصدار {exam.version}</p></div><div className="tw-actions"><button className="tw-button" disabled={busy} onClick={() => void open(exam.id)}><FolderOpen size={16}/>فتح وتعديل</button>{exam.isTemplate && <button className="tw-button" disabled={busy} onClick={() => void open(exam.id, true)}><Copy size={16}/>اختبار من القالب</button>}<Tool title="أرشفة المستند" disabled={busy} onClick={() => void archive(exam)}><Trash2 size={16}/></Tool></div></article>)}</div>}
    </section>
  </section>;
}

function useExamDraft(initial: TeacherExam, onSaved: () => void) {
  const [draft, setDraft] = useState(() => cloneDocument(initial.document));
  const [sourceAssetId, setSourceAssetId] = useState(initial.sourceAssetId);
  const [state, setState] = useState<'saved' | 'dirty' | 'saving' | 'error' | 'conflict'>('saved');
  const [error, setError] = useState('');
  const [history, setHistory] = useState({ past: [] as ExamDocument[], future: [] as ExamDocument[] });
  const current = useRef({ document: draft, sourceAssetId, version: initial.version, revision: 0, savedRevision: 0, conflict: false });
  const pending = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const saveRef = useRef<(() => Promise<void>) | null>(null);
  const savedCallback = useRef(onSaved); savedCallback.current = onSaved;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const update = useCallback((change: (value: ExamDocument) => void, recordHistory = true) => {
    const previous = current.current.document, next = cloneDocument(previous); change(next);
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    current.current.document = next; current.current.revision++;
    if (!mounted.current) { void saveRef.current?.().catch(() => undefined); return; }
    if (recordHistory) setHistory(value => ({ past: [...value.past.slice(-49), previous], future: [] }));
    setDraft(next); setState(current.current.conflict ? 'conflict' : 'dirty');
  }, []);
  const source = useCallback((id: string | null) => { current.current.sourceAssetId = id; current.current.revision++; if (!mounted.current) { void saveRef.current?.().catch(() => undefined); return; } setSourceAssetId(id); setState(current.current.conflict ? 'conflict' : 'dirty'); }, []);
  const save = useCallback(async () => {
    while (pending.current) await pending.current;
    if (current.current.savedRevision === current.current.revision) return;
    if (current.current.conflict) throw new Error('يوجد إصدار أحدث على الخادم. أعد تحميله أو احفظ نسخة مستقلة.');
    const snapshot = { ...current.current };
    if (mounted.current) { setState('saving'); setError(''); }
    const request = (async () => {
      try {
        const result = await teacherApi<TeacherExam>(`/teacher/exams/${initial.id}`, 'PUT', { title: snapshot.document.metadata.title || 'اختبار بلا عنوان', document: snapshot.document, sourceAssetId: snapshot.sourceAssetId, expectedVersion: snapshot.version, isTemplate: initial.isTemplate });
        current.current.version = result.version; current.current.savedRevision = snapshot.revision;
        if (mounted.current) setState(current.current.revision === snapshot.revision ? 'saved' : 'dirty');
        savedCallback.current();
      } catch (cause) {
        current.current.conflict = cause instanceof TeacherApiError && cause.status === 409;
        if (mounted.current) { setState(current.current.conflict ? 'conflict' : 'error'); setError(message(cause)); }
        throw cause;
      }
    })();
    pending.current = request;
    try { await request; } finally { pending.current = null; }
  }, [initial.id, initial.isTemplate]);
  saveRef.current = save;
  useEffect(() => () => { if (current.current.savedRevision !== current.current.revision) void saveRef.current?.().catch(() => undefined); }, []);
  useEffect(() => { if (state !== 'dirty') return; const timer = window.setTimeout(() => { void save().catch(() => undefined); }, 1100); return () => window.clearTimeout(timer); }, [draft, sourceAssetId, state, save]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (current.current.savedRevision !== current.current.revision) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, []);
  function undo() { const previous = history.past.at(-1); if (!previous) return; const next = current.current.document; current.current.document = previous; current.current.revision++; setDraft(previous); setHistory({ past: history.past.slice(0, -1), future: [next, ...history.future] }); setState(current.current.conflict ? 'conflict' : 'dirty'); }
  function redo() { const next = history.future[0]; if (!next) return; const previous = current.current.document; current.current.document = next; current.current.revision++; setDraft(next); setHistory({ past: [...history.past, previous], future: history.future.slice(1) }); setState(current.current.conflict ? 'conflict' : 'dirty'); }
  async function reload() { if (!window.confirm('تحميل آخر إصدار سيستبدل تعديلاتك غير المحفوظة في هذا المحرر. يمكنك حفظ نسخة مستقلة أولًا. هل تتابع؟')) return; const latest = await teacherApi<TeacherExam>(`/teacher/exams/${initial.id}`); if (!documentIsSupported(latest.document)) throw new Error('صيغة المستند غير مدعومة.'); current.current = { document: cloneDocument(latest.document), sourceAssetId: latest.sourceAssetId, version: latest.version, revision: 0, savedRevision: 0, conflict: false }; setDraft(current.current.document); setSourceAssetId(latest.sourceAssetId); setHistory({ past: [], future: [] }); setError(''); setState('saved'); }
  return { draft, sourceAssetId, state, error, update, source, save, undo, redo, reload, canUndo: history.past.length > 0, canRedo: history.future.length > 0, latest: current };
}

function ExamEditor({ initial, onClose, onSaved, onCopy }: { initial: TeacherExam; onClose: () => void; onSaved: () => void; onCopy: (exam: TeacherExam) => void }) {
  const editor = useExamDraft(initial, onSaved);
  const { draft, update } = editor;
  const [tab, setTab] = useState<'content' | 'layout' | 'source' | 'review'>('content');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [targetSection, setTargetSection] = useState('');
  const [bank, setBank] = useState<TeacherQuestion[] | null>(null);
  const reviews = examReviewItems(draft);
  const marks = countExamMarks(draft);
  async function close() { try { await editor.save(); if (editor.latest.current.savedRevision !== editor.latest.current.revision) await editor.save(); onClose(); } catch (cause) { setError(message(cause)); } }
  async function copy(asTemplate: boolean) {
    const title = window.prompt(asTemplate ? 'اسم القالب القابل لإعادة الاستخدام' : 'عنوان النسخة الجديدة — عدّل الصف والفصل الدراسي لاحقًا', `${draft.metadata.title} — ${asTemplate ? 'قالب' : 'نسخة'}`);
    if (!title?.trim()) return;
    if (title.trim().length > 180) { setError('العنوان يجب ألا يتجاوز 180 حرفًا. اختر عنوانًا أقصر ثم احفظ النسخة.'); return; }
    setBusy(true); setError('');
    try { const document = cloneDocument(editor.latest.current.document); document.metadata.title = title.trim(); const next = await teacherApi<TeacherExam>('/teacher/exams', 'POST', { title: title.trim(), document, sourceAssetId: editor.latest.current.sourceAssetId, isTemplate: asTemplate }); setNotice(asTemplate ? 'حُفظ القالب؛ يمكنك إنشاء اختبار مستقل منه في مكتبة القوالب.' : 'حُفظت نسخة مستقلة من الاختبار.'); if (!asTemplate) onCopy(next); onSaved(); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  function patchMetadata(key: keyof ExamDocument['metadata'], value: string | number | boolean | null) { update(next => { Object.assign(next.metadata, { [key]: value }); }); }
  function patchLayout(key: keyof ExamDocument['layout'], value: string | number | boolean) { update(next => { Object.assign(next.layout, { [key]: value }); }); }
  function editSection(id: string, change: (section: ExamSection) => void) { update(next => { const section = next.sections.find(item => item.id === id); if (section) change(section); }); }
  function editQuestion(sectionId: string, id: string, change: (question: ExamQuestion) => void) { editSection(sectionId, section => { const question = section.questions.find(item => item.id === id); if (question) change(question); }); }
  async function showBank() { setBusy(true); try { setBank(await teacherApi<TeacherQuestion[]>('/teacher/questions')); } catch (cause) { setError(message(cause)); } finally { setBusy(false); } }
  function groupSelected() { if (!selected.length || !targetSection) return; const existing = draft.sections.find(section => section.id === targetSection)?.questions.filter(question => !selected.includes(question.id)).length ?? 0; if (existing + selected.length > 200) { setError('الحد الأقصى 200 سؤال في القسم. اختر قسمًا آخر أو مجموعة أصغر.'); return; } update(next => { const questions = next.sections.flatMap(section => section.questions.filter(question => selected.includes(question.id))); next.sections.forEach(section => { section.questions = section.questions.filter(question => !selected.includes(question.id)); }); next.sections.find(section => section.id === targetSection)?.questions.push(...questions); }); setSelected([]); setNotice('نُقلت الأسئلة المحددة مع الحفاظ على نصوصها ودرجاتها.'); }
  return <section className="exam-workspace" dir="rtl">
    <header className="tw-heading"><div><p className="tw-eyebrow">{initial.isTemplate ? 'قالب محفوظ' : 'محرر الاختبارات'} / A4</p><h1>{draft.metadata.title || 'اختبار بلا عنوان'}</h1><p>كل حقل قابل للتعديل. الصور الأصلية محفوظة بشكل منفصل ومحمية بحسابك.</p></div><button className="tw-button" onClick={() => void close()} disabled={busy}>العودة للمكتبة</button></header>
    <div className="exam-command-bar tw-card"><div className="exam-actions"><button className="tw-button primary" onClick={() => void editor.save().catch(cause => setError(message(cause)))} disabled={editor.state === 'saving' || busy}><Save size={16}/>حفظ الآن</button><Tool title="تراجع" onClick={editor.undo} disabled={!editor.canUndo || busy}><Undo2 size={17}/></Tool><Tool title="إعادة" onClick={editor.redo} disabled={!editor.canRedo || busy}><Redo2 size={17}/></Tool><button className="tw-button" onClick={() => void copy(false)} disabled={busy}><Copy size={16}/>حفظ نسخة</button><button className="tw-button" onClick={() => void copy(true)} disabled={busy}><BookOpen size={16}/>حفظ كقالب</button><button className="tw-button" onClick={() => setPreview(true)}><Printer size={16}/>المعاينة والطباعة / PDF</button></div><span role="status" aria-live="polite" className={`exam-save-status ${editor.state}`}>{editor.state === 'saving' && <Loader2 size={14} className="exam-spinner"/>}{({ saved: 'كل التعديلات محفوظة', dirty: 'تعديلات غير محفوظة — حفظ تلقائي قريبًا', saving: 'جارٍ الحفظ…', error: 'تعذر الحفظ؛ تعديلاتك ما زالت في المحرر', conflict: 'يوجد إصدار أحدث؛ لم تُستبدل بيانات الخادم' })[editor.state]}</span></div>
    {(editor.error || error) && <div className="tw-error" role="alert">{editor.error || error}{editor.state === 'conflict' && <div className="exam-actions"><button className="tw-button" onClick={() => void editor.reload().catch(cause => setError(message(cause)))}>تحميل آخر إصدار</button><button className="tw-button" onClick={() => void copy(false)}>حفظ تعديلاتي كنسخة</button></div>}</div>}
    {notice && <div className="tw-success" role="status">{notice}<button className="exam-notice-close" aria-label="إخفاء الرسالة" onClick={() => setNotice('')}><X size={14}/></button></div>}
    <div className="tw-section-tabs" aria-label="أقسام محرر الاختبار">{([['content', 'المحتوى والأسئلة'], ['source', 'الصورة والاستخراج'], ['layout', 'تصميم الورقة'], ['review', `المراجعة (${reviews.length})`]] as const).map(([key, title]) => <button key={key} className="tw-button" aria-pressed={tab === key} onClick={() => setTab(key)}>{title}</button>)}</div>
    <div className="exam-editor-grid"><div className="exam-edit-panel">
      {tab === 'content' && <><section className="tw-card"><h2>بيانات ورقة الاختبار</h2><div className="tw-form-grid exam-form-spaced">
        {([['title', 'عنوان الاختبار'], ['school', 'اسم المدرسة'], ['teacher', 'اسم المعلم'], ['subject', 'المادة'], ['grade', 'الصف / الفصل'], ['term', 'الفصل / العام الدراسي'], ['date', 'التاريخ'], ['duration', 'المدة']] as const).map(([key, label]) => <Field key={key} label={label}><input type={key === 'date' ? 'date' : 'text'} maxLength={key === 'duration' ? 100 : 180} value={draft.metadata[key]} onChange={event => patchMetadata(key, event.target.value)}/></Field>)}
        <Field label="إجمالي الدرجات"><input type="number" min={0} max={10000} value={draft.metadata.totalMarks} onChange={event => patchMetadata('totalMarks', Math.max(0, Number(event.target.value)))}/><small>مجموع درجات الأسئلة: {marks} <button type="button" className="exam-text-button" onClick={() => patchMetadata('totalMarks', marks)}>اعتماد المجموع</button></small></Field>
        <Field label="شعار المدرسة (اختياري)"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) { setBusy(true); void uploadTeacherAsset(file).then(asset => patchMetadata('schoolLogoAssetId', asset.id)).catch(cause => setError(message(cause))).finally(() => setBusy(false)); } event.target.value = ''; }}/>{draft.metadata.schoolLogoAssetId && <button type="button" className="exam-text-button" onClick={() => patchMetadata('schoolLogoAssetId', null)}>إزالة الشعار من الورقة</button>}</Field>
        <Field label="تعليمات الاختبار" wide><textarea value={draft.metadata.instructions} maxLength={5000} onChange={event => patchMetadata('instructions', event.target.value)}/></Field>
        <label className="tw-check"><input type="checkbox" checked={draft.metadata.studentNameLine} onChange={event => patchMetadata('studentNameLine', event.target.checked)}/>سطر اسم الطالب</label><label className="tw-check"><input type="checkbox" checked={draft.metadata.studentNumberLine} onChange={event => patchMetadata('studentNumberLine', event.target.checked)}/>سطر رقم الطالب الداخلي</label>
      </div></section>
      <section className="tw-card"><div className="tw-toolbar"><h2>الأقسام والأسئلة</h2><button className="tw-button" disabled={draft.sections.length >= 100} onClick={() => update(next => { next.sections.push(newSection(`القسم ${next.sections.length + 1}`)); })}><Plus size={16}/>قسم جديد</button><button className="tw-button" onClick={() => void showBank()} disabled={busy}><BookOpen size={16}/>من بنك الأسئلة</button></div>
        {selected.length > 0 && <div className="exam-group-bar"><span>{selected.length} سؤال محدد</span><select aria-label="القسم الذي ستُنقل إليه الأسئلة" value={targetSection} onChange={event => setTargetSection(event.target.value)}><option value="">اختر قسمًا</option>{draft.sections.map(section => <option key={section.id} value={section.id}>{section.title || 'قسم بلا عنوان'}</option>)}</select><button className="tw-button" disabled={!targetSection} onClick={groupSelected}>تجميع / نقل الأسئلة</button><button className="exam-text-button" onClick={() => setSelected([])}>إلغاء التحديد</button></div>}
        {draft.sections.map((section, sectionIndex) => <section className="exam-section-editor" key={section.id}><div className="exam-section-heading"><input aria-label={`عنوان القسم ${sectionIndex + 1}`} value={section.title} maxLength={200} onChange={event => editSection(section.id, next => { next.title = event.target.value; })}/><Tool title="نقل القسم لأعلى" disabled={sectionIndex === 0} onClick={() => update(next => { next.sections = moveItem(next.sections, sectionIndex, -1); })}><ArrowUp size={15}/></Tool><Tool title="نقل القسم لأسفل" disabled={sectionIndex === draft.sections.length - 1} onClick={() => update(next => { next.sections = moveItem(next.sections, sectionIndex, 1); })}><ArrowDown size={15}/></Tool><Tool title="حذف القسم وأسئلته" onClick={() => { if (window.confirm('حذف هذا القسم وكل أسئلته؟ يمكنك التراجع داخل المحرر.')) update(next => { next.sections = next.sections.filter(item => item.id !== section.id); }); }}><Trash2 size={15}/></Tool></div>
          <Field label="تعليمات القسم"><textarea className="exam-short-textarea" maxLength={2000} value={section.instructions} onChange={event => editSection(section.id, next => { next.instructions = event.target.value; })}/></Field><label className="tw-check"><input type="checkbox" checked={section.pageBreakBefore} onChange={event => editSection(section.id, next => { next.pageBreakBefore = event.target.checked; })}/>ابدأ القسم في صفحة جديدة</label>
          {section.questions.map((question, questionIndex) => <QuestionEditor key={question.id} question={question} index={questionIndex} count={section.questions.length} checked={selected.includes(question.id)} onSelect={() => setSelected(value => value.includes(question.id) ? value.filter(id => id !== question.id) : [...value, question.id])} onChange={change => editQuestion(section.id, question.id, change)} onMove={direction => editSection(section.id, next => { next.questions = moveItem(next.questions, questionIndex, direction); })} onCopy={() => editSection(section.id, next => { next.questions.splice(questionIndex + 1, 0, copyQuestion(question)); })} onDelete={() => { if (window.confirm('حذف السؤال؟ يمكنك التراجع داخل المحرر.')) editSection(section.id, next => { next.questions = next.questions.filter(item => item.id !== question.id); }); }}/>) }
          <button className="tw-button exam-add-question" disabled={section.questions.length >= 200} onClick={() => editSection(section.id, next => { next.questions.push(newQuestion()); })}><Plus size={16}/>إضافة سؤال</button>
        </section>)}
        {draft.sections.length === 0 && <p className="tw-notice">أضف قسمًا لبدء كتابة الأسئلة.</p>}
      </section></>}
      {tab === 'layout' && <section className="tw-card"><h2>تصميم الورقة — مستقل عن محتواها</h2><p className="tw-muted tw-small">تبديل التصميم لا يغيّر الأسئلة أو إجاباتها أو درجاتها. الورقة بيضاء ومناسبة للطباعة.</p><div className="exam-style-grid compact">{EXAM_STYLES.map(style => <button className={`exam-style-card ${style.value}`} key={style.value} aria-pressed={draft.layout.style === style.value} onClick={() => patchLayout('style', style.value)}><strong>{style.title}</strong><p>{style.description}</p></button>)}</div><div className="tw-form-grid">
        <Field label="هوامش الورقة (مم)"><input type="number" min={8} max={30} value={draft.layout.marginMm} onChange={event => patchLayout('marginMm', Math.min(30, Math.max(8, Number(event.target.value))))}/></Field><Field label="حجم الخط (نقطة)"><input type="number" min={10} max={24} value={draft.layout.fontSize} onChange={event => patchLayout('fontSize', Math.min(24, Math.max(10, Number(event.target.value))))}/></Field>
        <Field label="تباعد السطور"><input type="number" step="0.1" min={1.1} max={2.5} value={draft.layout.lineSpacing} onChange={event => patchLayout('lineSpacing', Math.min(2.5, Math.max(1.1, Number(event.target.value))))}/></Field><Field label="المسافة بين الأسئلة (بكسل)"><input type="number" min={4} max={40} value={draft.layout.questionSpacing} onChange={event => patchLayout('questionSpacing', Math.min(40, Math.max(4, Number(event.target.value))))}/></Field>
        <Field label="محاذاة الأسئلة"><select value={draft.layout.alignment} onChange={event => patchLayout('alignment', event.target.value)}><option value="right">يمين</option><option value="center">وسط</option><option value="left">يسار</option></select></Field><Field label="الخط"><select value={draft.layout.font} onChange={event => patchLayout('font', event.target.value)}><option value="arabic">IBM Plex Sans Arabic مع بديل Arial</option><option value="sans">Arial</option></select></Field>
        <Field label="شكل الأرقام"><select value={draft.layout.digits} onChange={event => patchLayout('digits', event.target.value)}><option value="arabic">عربية ١٢٣</option><option value="western">غربية 123</option></select></Field><Field label="لون محدود للعناوين"><input type="color" value={draft.layout.accent} onChange={event => patchLayout('accent', event.target.value)}/><small>التصميم الاقتصادي يبقى أحادي اللون.</small></Field>
        <Field label="نص إضافي أعلى الورقة" wide><input maxLength={200} value={draft.layout.header} onChange={event => patchLayout('header', event.target.value)}/></Field><Field label="تذييل الورقة" wide><input maxLength={200} value={draft.layout.footer} onChange={event => patchLayout('footer', event.target.value)}/></Field><label className="tw-check"><input type="checkbox" checked={draft.layout.pageNumbers} onChange={event => patchLayout('pageNumbers', event.target.checked)}/>ترقيم الصفحات</label>
      </div></section>}
      {tab === 'source' && <SourceEditor document={draft} sourceAssetId={editor.sourceAssetId} onUpdate={update} onSource={editor.source} onNotice={setNotice} onBusy={setBusy}/>}
      {tab === 'review' && <section className="tw-card"><h2>قائمة المراجعة قبل الطباعة</h2><p className="tw-muted tw-small">راجع النصوص والدرجات يدويًا. لا تُعد هذه الورقة معتمدة من جهة تعليمية.</p>{reviews.length ? <ul className="exam-review-list">{reviews.map((item, index) => <li key={index}>{item}</li>)}</ul> : <div className="tw-success"><Check size={17}/> لا توجد ملاحظات في فحص الحقول الحالي؛ تبقى مراجعة صحة المحتوى مسؤولية المعلم.</div>}{draft.source.ocrStatus === 'completed' && <label className="tw-check"><input type="checkbox" checked={draft.source.reviewed} onChange={event => update(next => { next.source.reviewed = event.target.checked; })}/>راجعت كامل النص المستخرج من الصورة</label>}<button className="tw-button exam-form-spaced" onClick={() => setPreview(true)}><Printer size={16}/>فتح معاينة الورقة</button></section>}
    </div><aside className={`exam-live-preview ${tab === 'source' ? 'exam-source-review' : ''}`}>
      {tab === 'source' ? <><div className="exam-preview-heading"><strong>مراجعة المحتوى بجانب الصورة</strong><span>قابل للتعديل</span></div><p className="tw-muted tw-small">صحّح النص والخيارات والدرجات هنا أثناء مقارنة الصورة الأصلية. أزل علامة «يحتاج مراجعة» لكل سؤال بعد التحقق منه.</p><div className="exam-source-review-list">{draft.sections.map(section => <section key={section.id}><h3>{section.title}</h3>{section.questions.map((question, index) => <QuestionEditor key={question.id} question={question} index={index} count={section.questions.length} checked={selected.includes(question.id)} onSelect={() => setSelected(value => value.includes(question.id) ? value.filter(id => id !== question.id) : [...value, question.id])} onChange={change => editQuestion(section.id, question.id, change)} onMove={direction => editSection(section.id, next => { next.questions = moveItem(next.questions, index, direction); })} onCopy={() => editSection(section.id, next => { next.questions.splice(index + 1, 0, copyQuestion(question)); })} onDelete={() => { if (window.confirm('حذف السؤال؟ يمكنك التراجع داخل المحرر.')) editSection(section.id, next => { next.questions = next.questions.filter(item => item.id !== question.id); }); }}/>)}</section>)}{!draft.sections.some(section => section.questions.length > 0) && <p className="tw-notice">أضف أسئلة يدويًا أو استخرج النص أولًا؛ سيظهر هنا للمراجعة.</p>}</div></> : <><div className="exam-preview-heading"><strong>معاينة A4</strong><span>{draft.layout.style === 'formal' ? 'رسمي' : draft.layout.style === 'primary' ? 'ابتدائي' : 'اقتصادي'}</span></div><A4Preview document={draft} sourceAssetId={editor.sourceAssetId}/><p className="tw-muted tw-small">المعاينة تتكيف مع مساحة الشاشة؛ قياسات الطباعة الفعلية A4. لا يُرسل المستند إلى خدمة خارجية للطباعة.</p></>}
    </aside></div>
    {preview && <PrintPreview document={draft} sourceAssetId={editor.sourceAssetId} onClose={() => setPreview(false)} onSave={editor.save}/>}
    {bank && <ExamDialog title="إضافة سؤال من بنك الأسئلة" onClose={() => setBank(null)}>{bank.length === 0 ? <div className="tw-empty">لا توجد أسئلة محفوظة في بنكك.</div> : <div className="tw-list">{bank.map(item => <article key={item.id} className="tw-list-item"><div><strong>{item.text}</strong><p>{item.subject} · {item.marks} درجة</p></div><button className="tw-button" disabled={!!draft.sections.length && draft.sections[0].questions.length >= 200} onClick={() => { update(next => { if (!next.sections.length) next.sections.push(newSection()); next.sections[0].questions.push({ ...newQuestion(item.text), marks: item.marks, kind: item.kind === 'multiple-choice' ? 'choice' : item.kind === 'true-false' ? 'true-false' : 'written', options: [...item.options] }); }); setNotice('أُضيف السؤال؛ لا تُطبع الإجابة النموذجية من بنك الأسئلة.'); }}><Plus size={16}/>إضافة</button></article>)}</div>}</ExamDialog>}
  </section>;
}

function QuestionEditor({ question, index, count, checked, onSelect, onChange, onMove, onCopy, onDelete }: { question: ExamQuestion; index: number; count: number; checked: boolean; onSelect: () => void; onChange: (change: (question: ExamQuestion) => void) => void; onMove: (direction: -1 | 1) => void; onCopy: () => void; onDelete: () => void }) {
  return <article className={`exam-question-editor ${question.requiresReview ? 'needs-review' : ''}`}><div className="exam-question-toolbar"><label className="tw-check"><input type="checkbox" checked={checked} onChange={onSelect}/><strong>السؤال {index + 1}</strong></label><span className="exam-question-tools"><Tool title="نقل السؤال لأعلى" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={14}/></Tool><Tool title="نقل السؤال لأسفل" disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown size={14}/></Tool><Tool title="تكرار السؤال" disabled={count >= 200} onClick={onCopy}><Copy size={14}/></Tool><Tool title="حذف السؤال" onClick={onDelete}><Trash2 size={14}/></Tool></span></div>
    <Field label="نص السؤال"><textarea value={question.text} maxLength={8000} onChange={event => onChange(next => { next.text = event.target.value; })}/></Field><div className="tw-form-grid"><Field label="نوع السؤال"><select value={question.kind} onChange={event => onChange(next => { next.kind = event.target.value as ExamQuestion['kind']; if (next.kind === 'choice' && next.options.length < 2) next.options = ['', '']; })}><option value="written">إجابة كتابية</option><option value="choice">اختيار من متعدد</option><option value="true-false">صح / خطأ</option><option value="blank">إكمال الفراغ</option></select></Field><Field label="الدرجة"><input type="number" min={0} max={1000} step="0.5" value={question.marks} onChange={event => onChange(next => { next.marks = Math.min(1000, Math.max(0, Number(event.target.value))); })}/></Field><Field label="عدد أسطر الإجابة"><input type="number" min={0} max={20} value={question.answerLines} onChange={event => onChange(next => { next.answerLines = Math.min(20, Math.max(0, Math.round(Number(event.target.value)))); })}/></Field></div>
    {question.kind === 'choice' && <fieldset className="exam-choice-fields"><legend>خيارات الإجابة — لا تُحدد الإجابة الصحيحة على ورقة الطالب</legend>{question.options.map((option, optionIndex) => <div className="exam-inline-field" key={optionIndex}><input aria-label={`الخيار ${optionIndex + 1}`} value={option} maxLength={1000} onChange={event => onChange(next => { next.options[optionIndex] = event.target.value; })}/><Tool title={`حذف الخيار ${optionIndex + 1}`} onClick={() => onChange(next => { next.options.splice(optionIndex, 1); })}><X size={14}/></Tool></div>)}<button className="exam-text-button" disabled={question.options.length >= 12} onClick={() => onChange(next => { next.options.push(''); })}>+ خيار جديد</button></fieldset>}
    <details className="exam-subquestions"><summary>الأسئلة الفرعية ({question.subquestions.length})</summary>{question.subquestions.map((text, subIndex) => <div className="exam-inline-field" key={subIndex}><textarea aria-label={`السؤال الفرعي ${subIndex + 1}`} maxLength={2000} value={text} onChange={event => onChange(next => { next.subquestions[subIndex] = event.target.value; })}/><Tool title="حذف السؤال الفرعي" onClick={() => onChange(next => { next.subquestions.splice(subIndex, 1); })}><X size={14}/></Tool></div>)}<button className="exam-text-button" disabled={question.subquestions.length >= 20} onClick={() => onChange(next => { next.subquestions.push(''); })}>+ سؤال فرعي</button></details>
    <div className="exam-question-checks"><label className="tw-check"><input type="checkbox" checked={question.pageBreakBefore} onChange={event => onChange(next => { next.pageBreakBefore = event.target.checked; })}/>ابدأ في صفحة جديدة</label><label className="tw-check"><input type="checkbox" checked={question.requiresReview} onChange={event => onChange(next => { next.requiresReview = event.target.checked; })}/>يحتاج مراجعة</label></div>{question.requiresReview && <Field label="ملاحظة المراجعة"><input value={question.reviewNote} maxLength={1000} onChange={event => onChange(next => { next.reviewNote = event.target.value; })}/></Field>}
  </article>;
}

function ExamDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null), closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.querySelector<HTMLElement>('button,input')?.focus(); const key = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); if (event.key === 'Tab') { const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,textarea,a[href]') ?? []); const first = controls[0], last = controls.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }; window.addEventListener('keydown', key); return () => { window.removeEventListener('keydown', key); previous?.focus(); }; }, []);
  return createPortal(<div className="tw-overlay exam-dialog-overlay" dir="rtl"><div ref={ref} className="tw-modal wide" role="dialog" aria-modal="true" aria-label={title}><div className="tw-modal-header"><h2>{title}</h2><Tool title="إغلاق" onClick={onClose}><X size={19}/></Tool></div>{children}</div></div>, document.body);
}

type OcrResult = { status: 'manual' | 'completed' | 'error'; text: string; blocks: { text: string; confidence: number | null; requiresReview: boolean }[]; message: string; provider: string };
async function adjustedImage(assetId: string, adjustments: ImageAdjustments): Promise<Blob> {
  const response = await fetch(`/api/teacher/assets/${assetId}`, { credentials: 'include' });
  if (!response.ok) throw new Error('تعذر قراءة الصورة الأصلية. تحقق من اتصالك وصلاحية الملف.');
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('تعذر فتح الصورة؛ جرّب JPEG أو PNG أو WebP صالحًا.')); image.src = objectUrl; });
    if (image.naturalWidth * image.naturalHeight > 30_000_000) throw new Error('أبعاد الصورة كبيرة جدًا للمعالجة داخل المتصفح. استخدم صورة لا تتجاوز 30 مليون بكسل.');
    const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    const angle = ((adjustments.rotation + adjustments.straighten) * Math.PI) / 180;
    const rotated = document.createElement('canvas');
    rotated.width = Math.max(1, Math.ceil(Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle))));
    rotated.height = Math.max(1, Math.ceil(Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle))));
    const context = rotated.getContext('2d');
    if (!context) throw new Error('هذا المتصفح لا يدعم تعديل الصورة. يمكنك استخدام الأصل والكتابة اليدوية.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, rotated.width, rotated.height);
    context.translate(rotated.width / 2, rotated.height / 2); context.rotate(angle);
    context.filter = `brightness(${adjustments.brightness}%) contrast(${adjustments.contrast}%)`;
    context.drawImage(image, -width / 2, -height / 2, width, height);
    const crop = adjustments.crop, cropped = document.createElement('canvas');
    cropped.width = Math.max(1, Math.round(rotated.width * crop.width / 100));
    cropped.height = Math.max(1, Math.round(rotated.height * crop.height / 100));
    cropped.getContext('2d')?.drawImage(rotated, rotated.width * crop.x / 100, rotated.height * crop.y / 100, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    return await new Promise<Blob>((resolve, reject) => cropped.toBlob(value => value ? resolve(value) : reject(new Error('تعذر حفظ تعديل الصورة.')), 'image/png'));
  } finally { URL.revokeObjectURL(objectUrl); }
}
function SourceEditor({ document, sourceAssetId, onUpdate, onSource, onNotice, onBusy }: { document: ExamDocument; sourceAssetId: string | null; onUpdate: (change: (value: ExamDocument) => void) => void; onSource: (id: string | null) => void; onNotice: (notice: string) => void; onBusy: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [manualText, setManualText] = useState('');
  const [ocrMessage, setOcrMessage] = useState('');
  const adjustments = document.source.adjustments;
  function loading(value: boolean) { setBusy(value); onBusy(value); }
  useEffect(() => {
    if (!sourceAssetId) { setPreviewUrl(null); return; }
    let disposed = false, url: string | null = null;
    const timer = window.setTimeout(() => { void adjustedImage(sourceAssetId, adjustments).then(blob => { if (disposed) return; url = URL.createObjectURL(blob); setPreviewUrl(url); }).catch(cause => { if (!disposed) setError(message(cause)); }); }, 200);
    return () => { disposed = true; window.clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [sourceAssetId, adjustments]);
  function adjust(key: 'straighten' | 'brightness' | 'contrast', value: number) { onUpdate(next => { next.source.adjustments[key] = value; next.source.processedAssetId = null; }); }
  function crop(key: keyof ImageAdjustments['crop'], value: number) { onUpdate(next => { const bounds = next.source.adjustments.crop; bounds[key] = value; if (key === 'x') bounds.width = Math.min(bounds.width, 100 - value); if (key === 'y') bounds.height = Math.min(bounds.height, 100 - value); if (key === 'width') bounds.width = Math.min(value, 100 - bounds.x); if (key === 'height') bounds.height = Math.min(value, 100 - bounds.y); next.source.processedAssetId = null; }); }
  async function upload(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('اختر صورة JPEG أو PNG أو WebP. معالجة صفحات PDF غير متاحة في هذا الإصدار.'); return; }
    if (file.size > 8 * 1024 * 1024) { setError('حجم الصورة يجب ألا يتجاوز 8 ميجابايت.'); return; }
    if (sourceAssetId && !window.confirm('استبدال المصدر لهذا المستند؟ يبقى الملف الأصلي محفوظًا ولا يُحذف.')) return;
    loading(true); setError('');
    try { const asset = await uploadTeacherAsset(file); onSource(asset.id); onUpdate(next => { next.source.processedAssetId = null; next.source.ocrStatus = 'none'; next.source.ocrText = ''; next.source.reviewed = false; }); onNotice('رُفعت الصورة الأصلية بشكل خاص. يمكن تعديل نسخة المعالجة دون تغيير الأصل.'); }
    catch (cause) { setError(message(cause)); } finally { loading(false); }
  }
  async function process(extract: boolean) {
    if (!sourceAssetId) return;
    loading(true); setError(''); setOcrMessage('');
    try {
      const asset = document.source.processedAssetId ? { id: document.source.processedAssetId } : await uploadTeacherAsset(await adjustedImage(sourceAssetId, adjustments));
      onUpdate(next => { next.source.processedAssetId = asset.id; });
      if (!extract) { onNotice('حُفظت نسخة الصورة بعد القص والتعديل؛ الأصل لم يتغير.'); return; }
      const result = await teacherApi<OcrResult>(`/teacher/assets/${asset.id}/ocr`, 'POST');
      setOcrMessage(result.message);
      if (result.status === 'completed' && (result.text.trim() || result.blocks.length)) {
        onUpdate(next => { Object.assign(next, importExtractedLines(next, result.text, result.blocks)); next.source.processedAssetId = asset.id; });
        onNotice('أُضيف النص المستخرج ككتل أسئلة قابلة للتعديل والمراجعة. الدرجات صفر حتى تحددها؛ لم تُفترض إجابات أو بنية غير مؤكدة.');
      } else {
        onUpdate(next => { next.source.ocrStatus = result.status === 'error' ? 'error' : 'manual'; next.source.ocrText = ''; });
        if (result.status === 'error') setError(result.message || 'تعذر الاستخراج. يمكنك متابعة التحرير اليدوي.');
      }
    } catch (cause) { setError(message(cause)); } finally { loading(false); }
  }
  function importManual() { if (!manualText.trim()) return; try { onUpdate(next => { Object.assign(next, importExtractedLines(next, manualText, [])); next.source.ocrStatus = 'manual'; }); setManualText(''); onNotice('أُضيفت السطور التي كتبتها يدويًا؛ راجع تقسيمها إلى أسئلة وخيارات وحدد الدرجات.'); } catch (cause) { setError(message(cause)); } }
  return <section className="tw-card"><h2>الصورة الأصلية ونسخة المعالجة</h2><p className="tw-muted tw-small">JPEG وPNG وWebP حتى 8 ميجابايت. الأصل خاص بحساب المعلم. استخراج النص يحتاج إعداد مزود حقيقي؛ التحرير اليدوي متاح دائمًا.</p>
    <Field label="ارفع صورة الاختبار"><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }}/></Field>
    {error && <div className="tw-error" role="alert">{error}</div>}
    {sourceAssetId ? <><div className="exam-source-toolbar"><button className="tw-button" aria-pressed={showOriginal} onClick={() => setShowOriginal(value => !value)}>{showOriginal ? 'عرض النسخة المعدلة' : 'عرض الأصل'}</button><button className="tw-button" disabled={busy} onClick={() => onUpdate(next => { next.source.adjustments.rotation = (next.source.adjustments.rotation + 90) % 360; next.source.processedAssetId = null; })}><RotateCw size={16}/>تدوير ٩٠°</button></div><div className="exam-source-image">{showOriginal ? <img src={`/api/teacher/assets/${sourceAssetId}`} alt="صورة الاختبار الأصلية المحفوظة دون تعديل"/> : previewUrl ? <img src={previewUrl} alt="نسخة معاينة بعد القص والتدوير وضبط الإضاءة"/> : <p aria-busy="true">جارٍ تجهيز المعاينة…</p>}</div>
      <div className="tw-form-grid exam-form-spaced">{([['straighten', 'استقامة الصورة (درجات)', -10, 10], ['brightness', 'الإضاءة (%)', 50, 180], ['contrast', 'التباين (%)', 50, 180]] as const).map(([key, label, min, max]) => <Field key={key} label={`${label}: ${adjustments[key]}`}><input type="range" disabled={busy} min={min} max={max} step={key === 'straighten' ? 0.5 : 1} value={adjustments[key]} onChange={event => adjust(key, Number(event.target.value))}/></Field>)}
      {([['x', 'بداية القص أفقيًا (%)', 0, 95], ['y', 'بداية القص رأسيًا (%)', 0, 95], ['width', 'عرض الجزء المقصوص (%)', 5, 100], ['height', 'ارتفاع الجزء المقصوص (%)', 5, 100]] as const).map(([key, label, min, max]) => <Field key={key} label={label}><input type="number" disabled={busy} min={min} max={max} step={1} value={adjustments.crop[key]} onChange={event => crop(key, Math.min(max, Math.max(min, Number(event.target.value))))}/></Field>)}
      </div><div className="exam-actions"><button className="tw-button" disabled={busy} onClick={() => void process(false)}><Save size={16}/>حفظ الصورة المعدلة</button><button className="tw-button primary" disabled={busy} onClick={() => void process(true)}>{busy ? <Loader2 className="exam-spinner" size={16}/> : <ScanText size={16}/>}استخراج النص ومراجعته</button></div>
      <label className="tw-check exam-form-spaced"><input type="checkbox" checked={document.source.printBackground} onChange={event => onUpdate(next => { next.source.printBackground = event.target.checked; })}/>استخدام الصورة المحفوظة كخلفية ورقة (اختياري)</label><p className="tw-muted tw-small">تُستخدم نسخة المعالجة المحفوظة إن وُجدت. عند إضافة أسئلة تصبح الخلفية باهتة لتبقى الكتابة مقروءة. راجع المعاينة قبل الطباعة.</p>
    </> : <div className="tw-empty"><FileImage/><strong>لم تُرفَع صورة بعد</strong><p>يمكنك أيضًا إنشاء الاختبار بالكامل بالأسئلة اليدوية.</p></div>}
    {ocrMessage && <div className="tw-notice" role="status">{ocrMessage}</div>}
    {document.source.ocrText && <details className="exam-subquestions"><summary>النص المستخرج المرجعي</summary><pre className="exam-extracted-text">{document.source.ocrText}</pre></details>}
    <hr className="exam-divider"/><h3>تحرير يدوي إلى جانب الصورة</h3><p className="tw-muted tw-small">اكتب سطرًا لكل سؤال أولي، ثم عدّل الأقسام والاختيارات والدرجات في «المحتوى والأسئلة». لا يعمل OCR تلقائيًا إذا لم يُضبط مزوده.</p><Field label="نص الأسئلة الذي تراجعه يدويًا"><textarea maxLength={50000} value={manualText} onChange={event => setManualText(event.target.value)} placeholder="اكتب نص السؤال كما يظهر في الصورة…"/></Field><button className="tw-button" disabled={!manualText.trim()} onClick={importManual}><Plus size={16}/>إضافة السطور كأسئلة للمراجعة</button>
  </section>;
}

function paperStyle(document: ExamDocument): CSSProperties { return { '--exam-margin': `${document.layout.marginMm}mm`, '--exam-font-size': `${document.layout.fontSize}pt`, '--exam-line-height': document.layout.lineSpacing, '--exam-question-gap': `${document.layout.questionSpacing}px`, '--exam-accent': document.layout.style === 'minimal' ? '#000000' : document.layout.accent, '--exam-font-family': document.layout.font === 'arabic' ? "'IBM Plex Sans Arabic',Arial,sans-serif" : 'Arial,sans-serif', '--exam-align': document.layout.alignment } as CSSProperties; }
function PaperHeader({ document }: { document: ExamDocument }) { const meta = document.metadata; return <header className="exam-paper-header">
  {document.layout.header && <p className="exam-paper-overline">{document.layout.header}</p>}<div className="exam-school-heading">{meta.schoolLogoAssetId && <img className="exam-school-logo" src={`/api/teacher/assets/${meta.schoolLogoAssetId}`} alt="شعار المدرسة"/>}<div><strong>{meta.school || 'اسم المدرسة'}</strong><h1>{meta.title || 'عنوان الاختبار'}</h1></div>{document.layout.style === 'primary' && <span className="exam-primary-stars" aria-hidden="true">☆ ✎ ☆</span>}</div>
  <div className="exam-paper-meta">{meta.subject && <span>المادة: {meta.subject}</span>}{meta.grade && <span>الصف: {meta.grade}</span>}{meta.term && <span>الفصل / العام: {meta.term}</span>}{meta.teacher && <span>المعلم: {meta.teacher}</span>}{meta.date && <span>التاريخ: {meta.date}</span>}{meta.duration && <span>المدة: {meta.duration}</span>}<span>الدرجة الكلية: {formatExamNumber(meta.totalMarks, document.layout.digits)}</span></div>
  {(meta.studentNameLine || meta.studentNumberLine) && <div className="exam-student-lines">{meta.studentNameLine && <span>اسم الطالب: <i/></span>}{meta.studentNumberLine && <span>رقم الطالب: <i/></span>}</div>}{meta.instructions && <p className="exam-paper-instructions">{meta.instructions}</p>}
</header>; }
function PaperContent({ block, document }: { block: ExamPaperBlock; document: ExamDocument }) {
  if (block.kind === 'section') return <div className="exam-paper-section"><h2>{block.section.title}</h2>{block.section.instructions && <p>{block.section.instructions}</p>}</div>;
  const question = block.question, number = (value: number) => formatExamNumber(value, document.layout.digits);
  return <article className="exam-paper-question"><div className="exam-paper-question-heading"><span className="exam-paper-number">{number(block.number)}</span><p dir="auto">{question.text || 'نص السؤال'}</p><span className="exam-paper-marks">({number(question.marks)} درجة)</span></div>
    {question.kind === 'choice' && <ol className="exam-paper-options">{question.options.map((option, index) => <li key={index}><span>{['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي', 'ك', 'ل'][index]}.</span> <span dir="auto">{option}</span></li>)}</ol>}
    {question.kind === 'true-false' && <p className="exam-paper-true-false">□ صح &nbsp;&nbsp;&nbsp; □ خطأ</p>}
    {question.kind === 'blank' && <p className="exam-paper-blank">الإجابة: ....................................................................</p>}
    {question.subquestions.length > 0 && <ol className="exam-paper-subquestions">{question.subquestions.map((text, index) => <li key={index}><span>{number(index + 1)} — </span><span dir="auto">{text}</span></li>)}</ol>}
    {question.answerLines > 0 && <div className="exam-answer-lines" aria-label={`${question.answerLines} أسطر للإجابة`}>{Array.from({ length: question.answerLines }, (_, index) => <div key={index}/>)}</div>}
  </article>;
}
function PrintedExam({ document, sourceAssetId, onOversize }: { document: ExamDocument; sourceAssetId: string | null; onOversize?: (oversize: boolean) => void }) {
  const measure = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<ExamPaperBlock[][]>(() => [examPaperBlocks(document)]);
  const blocks = examPaperBlocks(document);
  useLayoutEffect(() => {
    let disposed = false;
    const paginate = () => {
      if (disposed || !measure.current || globalThis.matchMedia('print').matches) return;
      const header = measure.current.querySelector<HTMLElement>('.exam-paper-header');
      const available = 1122.52 - document.layout.marginMm * 2 * 3.77952756 - (header?.getBoundingClientRect().height ?? 150) - 36;
      const elements = Array.from(measure.current.querySelectorAll<HTMLElement>('[data-measure-block]'));
      const heights = elements.map(element => element.getBoundingClientRect().height);
      const result = paginateExamBlocks(blocks, heights, available);
      setPages(result.pages); onOversize?.(result.oversized);
    };
    const timer = window.setTimeout(paginate, 20);
    void globalThis.document.fonts?.ready.then(paginate);
    const images = measure.current?.querySelectorAll('img') ?? [];
    images.forEach(image => image.addEventListener('load', paginate));
    return () => { disposed = true; window.clearTimeout(timer); images.forEach(image => image.removeEventListener('load', paginate)); };
  // A serialized document prevents callback identity changes from triggering repeated measurements.
  }, [JSON.stringify(document)]);
  const hasQuestions = document.sections.some(section => section.questions.length > 0);
  const backgroundId = document.source.processedAssetId || sourceAssetId;
  return <div className={`exam-printed-document ${document.layout.style}`} style={paperStyle(document)} dir="rtl">
    <div ref={measure} className="exam-measure-page" aria-hidden="true"><PaperHeader document={document}/>{blocks.map(block => <div key={block.id} data-measure-block><PaperContent block={block} document={document}/></div>)}</div>
    {pages.map((page, index) => <section className="exam-a4" key={index} aria-label={`صفحة ${index + 1}`}>
      {document.source.printBackground && backgroundId && <img className={`exam-scan-background ${hasQuestions ? 'faint' : ''}`} src={`/api/teacher/assets/${backgroundId}`} alt="خلفية صورة الاختبار المحفوظة"/>}
      <div className="exam-paper-content"><PaperHeader document={document}/>{page.map(block => <PaperContent key={block.id} block={block} document={document}/>)}</div><footer className="exam-paper-footer"><span>{document.layout.footer}</span>{document.layout.pageNumbers && <span>الصفحة {formatExamNumber(index + 1, document.layout.digits)} من {formatExamNumber(pages.length, document.layout.digits)}</span>}</footer>
    </section>)}
  </div>;
}
function A4Preview({ document, sourceAssetId }: { document: ExamDocument; sourceAssetId: string | null }) {
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ scale: 0.55, height: 630 });
  useLayoutEffect(() => { const update = () => { if (!outer.current || !inner.current || !outer.current.clientWidth || globalThis.matchMedia('print').matches) return; const scale = Math.min(1, outer.current.clientWidth / 793.7008), height = inner.current.offsetHeight * scale; setDimensions(value => value.scale === scale && value.height === height ? value : { scale, height }); }; const observer = new ResizeObserver(update); if (outer.current) observer.observe(outer.current); if (inner.current) observer.observe(inner.current); update(); return () => observer.disconnect(); }, []);
  return <div className="exam-preview-viewport" ref={outer}><div className="exam-preview-sized" style={{ height: dimensions.height }}><div className="exam-preview-transform" ref={inner} style={{ transform: `scale(${dimensions.scale})` }}><PrintedExam document={document} sourceAssetId={sourceAssetId}/></div></div></div>;
}
function PrintPreview({ document, sourceAssetId, onClose, onSave }: { document: ExamDocument; sourceAssetId: string | null; onClose: () => void; onSave: () => Promise<void> }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [oversize, setOversize] = useState(false);
  const container = useRef<HTMLDivElement>(null), closeRef = useRef(onClose); closeRef.current = onClose;
  const review = examReviewItems(document);
  useEffect(() => { const previous = globalThis.document.activeElement as HTMLElement | null; container.current?.querySelector<HTMLElement>('button')?.focus(); const previousOverflow = globalThis.document.body.style.overflow; globalThis.document.body.style.overflow = 'hidden'; const key = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); if (event.key === 'Tab') { const controls = Array.from(container.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]') ?? []); if (event.shiftKey && globalThis.document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); } else if (!event.shiftKey && globalThis.document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); } } }; window.addEventListener('keydown', key); return () => { globalThis.document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', key); previous?.focus(); }; }, []);
  async function print() {
    if (review.length && !window.confirm(`توجد ${review.length} ملاحظة تحتاج مراجعتك. هل تريد متابعة المعاينة والطباعة؟`)) return;
    setBusy(true); setError('');
    try { await onSave(); await globalThis.document.fonts?.ready; const images = Array.from(container.current?.querySelectorAll('img') ?? []); await Promise.all(images.filter(image => !image.closest('.exam-measure-page')).map(image => image.complete && image.naturalWidth > 0 ? image.decode() : new Promise<void>((resolve, reject) => { const timeout = window.setTimeout(() => reject(new Error('تعذر تحميل صورة مضمّنة قبل الطباعة. تحقق من الاتصال أو أزلها من الورقة.')), 10000); const complete = () => { window.clearTimeout(timeout); image.removeEventListener('load', complete); image.removeEventListener('error', failed); resolve(); }; const failed = () => { window.clearTimeout(timeout); image.removeEventListener('load', complete); image.removeEventListener('error', failed); reject(new Error('إحدى صور الورقة مفقودة أو غير متاحة.')); }; image.addEventListener('load', complete); image.addEventListener('error', failed); }))); await new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))); window.print(); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return createPortal(<div className="exam-print-root" ref={container} dir="rtl" role="dialog" aria-modal="true" aria-label="معاينة الاختبار والطباعة"><div className="exam-print-toolbar"><div><h2>معاينة A4 قبل الطباعة</h2><p>اختر «حفظ بتنسيق PDF» في نافذة الطباعة إن كان متصفحك يدعمه. أوقف ترويسة وتذييل المتصفح، واختر حجم A4 ومقياس 100٪.</p></div><button className="tw-button primary" disabled={busy || oversize} onClick={() => void print()}><Printer size={17}/>{busy ? 'جارٍ التجهيز…' : 'طباعة / حفظ PDF'}</button><Tool title="إغلاق المعاينة" onClick={onClose}><X size={20}/></Tool></div>{error && <div className="tw-error exam-print-notice" role="alert">{error}</div>}{oversize && <div className="tw-error exam-print-notice" role="alert">أحد الأسئلة أطول من المساحة المتاحة في صفحة A4. قلّل أسطر الإجابة أو حجم الخط أو قسّمه إلى أسئلة مستقلة قبل الطباعة.</div>}{review.length > 0 && <details className="exam-print-review"><summary>{review.length} ملاحظة تحتاج مراجعة المعلم</summary><ul>{review.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}<PrintedExam document={document} sourceAssetId={sourceAssetId} onOversize={setOversize}/></div>, globalThis.document.body);
}
