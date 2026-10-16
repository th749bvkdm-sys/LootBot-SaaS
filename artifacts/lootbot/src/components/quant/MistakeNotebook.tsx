import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookMarked, CheckCheck, CircleHelp, RefreshCw, RotateCcw, Search } from "lucide-react";
import { number, quantApi, type Row } from "./api";
import { QuestionFigure } from "./QuestionFigure";
import "./notebook.css";

const letter = (key: string | undefined) => key ? ({ A: "أ", B: "ب", C: "ج", D: "د", E: "هـ", F: "و" }[key] || key) : "لم تجب";

/** Server-derived notebook: no client grading, invented explanation or duplicated bank. */
export function MistakeNotebook({ onAttempt, onResult }: { onAttempt: (id: string) => void; onResult: (id: string) => void }) {
  const [status, setStatus] = useState("pending"), [categoryId, setCategory] = useState(""), [search, setSearch] = useState(""), [deferredSearch, setDeferredSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { const timeout = window.setTimeout(() => setDeferredSearch(search.trim()), 300); return () => window.clearTimeout(timeout); }, [search]);
  const query = new URLSearchParams({ status, search: deferredSearch, ...(categoryId ? { categoryId } : {}) });
  const notebook = useQuery({ queryKey: ["quant", "notebook", query.toString()], queryFn: () => quantApi("/notebook?" + query), retry: false });
  const data = notebook.data, items: Row[] = data?.items || [], summary = data?.summary || {};
  useEffect(() => { setSelected([]); }, [status, categoryId, deferredSearch]);
  async function practice(questionIds?: string[]) {
    setBusy(true); setError("");
    try { const result = await quantApi("/notebook/practice", "POST", { ...(questionIds?.length ? { questionIds, count: questionIds.length } : { count: 10 }), ...(categoryId ? { categoryId } : {}) }); onAttempt(result.attemptId); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر بدء التدريب من دفتر الأخطاء."); }
    finally { setBusy(false); }
  }
  return <section className="quant-notebook" dir="rtl" aria-busy={notebook.isFetching || busy}>
    <div className="edu-card quant-notebook-intro"><div className="quant-notebook-mark"><BookMarked size={30}/></div><div><span className="edu-eyebrow">مراجعة شخصية من محاولاتك الفعلية</span><h2>خطوة أقرب إلى الإتقان</h2><p>تجتمع هنا أسئلة المفكر التي أخطأت فيها أو تركتها. أعد التدريب، وعندما تجيب بشكل صحيح في محاولة لاحقة ينتقل السؤال تلقائيًا إلى «أتقنتها».</p></div></div>
    <div className="quant-notebook-stats" aria-label="ملخص دفتر الأخطاء">{[["pending", summary.pending, "تحتاج مراجعة"], ["mastered", summary.mastered, "أتقنتها لاحقًا"], ["all", summary.total, "في دفتر أخطائك"]].map(([key, value, label]) => <button key={String(key)} type="button" aria-pressed={status === key} onClick={() => setStatus(String(key))}><strong>{notebook.isPending ? "—" : number(value)}</strong><span>{String(label)}</span></button>)}</div>
    <div className="edu-card quant-notebook-toolbar"><label className="quant-notebook-search"><span><Search size={16}/> ابحث في دفتر الأخطاء</span><input type="search" value={search} maxLength={100} placeholder="السؤال، المهارة أو اسم القسم" onChange={e => setSearch(e.target.value)}/></label><label><span>المهارة</span><select value={categoryId} onChange={e => setCategory(e.target.value)}><option value="">جميع المهارات</option>{data?.skills?.map((skill: Row) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label><button className="edu-button secondary" type="button" disabled={notebook.isFetching} onClick={() => void notebook.refetch()} aria-label="تحديث دفتر الأخطاء"><RefreshCw size={17}/></button></div>
    <nav className="quant-notebook-tabs" aria-label="تصفية دفتر الأخطاء">{[["pending", "تحتاج مراجعة"], ["mastered", "أتقنتها"], ["all", "الكل"]].map(([key, label]) => <button type="button" key={key} aria-pressed={status === key} onClick={() => setStatus(key)}>{label}</button>)}</nav>
    {(error || notebook.error) && <p className="edu-notice edu-error" role="alert">{error || notebook.error?.message}</p>}
    {notebook.isPending ? <p className="edu-empty" role="status">جار تجميع أسئلة المراجعة من نتائجك…</p> : !notebook.error && <>
      <div className="quant-notebook-actions"><p aria-live="polite">{number(items.length)} سؤالًا معروضًا{selected.length ? ` • حددت ${number(selected.length)}` : ""}</p><div><button type="button" className="edu-button secondary" disabled={busy || selected.length === 0} onClick={() => void practice(selected)}>تدرّب على المحدد ({number(selected.length)})</button><button type="button" className="edu-button" disabled={busy || !summary.pending} onClick={() => void practice()}><RotateCcw size={17}/>{busy ? "جار تجهيز تدريبك…" : "راجع أخطائي • حتى ١٠ أسئلة"}</button></div></div>
      {!items.length ? <div className="edu-card quant-notebook-empty">{summary.total ? <CheckCheck size={34}/> : <BookMarked size={34}/>}<h3>{summary.total ? "لا توجد أسئلة مطابقة لهذا العرض" : "دفترك يبدأ من تجربتك"}</h3><p>{summary.total ? "غيّر المهارة أو البحث أو افتح تبويب «الكل» لمراجعة أسئلتك." : "أكمل قسمًا أو تدريبًا. بعد إتاحة التصحيح، تظهر هنا الأسئلة التي تحتاج منك مراجعة؛ لا نضيف أسئلة أو نتائج افتراضية."}</p></div> : <div className="quant-notebook-list">{items.map(entry => {
        const item = entry.item, questionId = item.questionId;
        const choice = (key: string | undefined) => { const text = item.choices?.find((c: Row) => c.key === key)?.text; return text && !/^الخيار .+ في الصورة$/.test(text) ? `${letter(key)} — ${text}` : `الخيار ${letter(key)}`; };
        return <article key={questionId} className={`edu-card quant-notebook-question${entry.mastered ? " mastered" : ""}`}>
          <header><label><input type="checkbox" aria-label={`اختيار السؤال ${item.source?.questionNumber || item.position + 1} للتدريب`} disabled={!entry.retryAvailable || busy || !selected.includes(questionId) && selected.length >= 50} checked={selected.includes(questionId)} onChange={e => setSelected(previous => e.target.checked ? [...previous, questionId] : previous.filter(id => id !== questionId))}/><span>{item.skill}</span></label><span className="quant-notebook-badge">{entry.mastered ? <CheckCheck size={15}/> : <CircleHelp size={15}/>} {entry.mastered ? "أتقنتها في محاولة لاحقة" : item.outcome === "wrong" ? "إجابة خاطئة" : "دون إجابة"}</span></header>
          <h3>{item.images?.length ? item.stem?.split("\n\n")[0] : item.stem}</h3><p className="quant-notebook-origin">{entry.testTitle} • {new Date(entry.submittedAt).toLocaleDateString("ar-SA")} • احتاج مراجعة في {number(entry.mistakeCount)} محاولات</p>
          <details><summary>مراجعة السؤال والإجابة من محاولتك</summary>{item.images?.map((url: string) => <QuestionFigure key={url} url={url}/>)}{item.images?.length > 0 && item.stem?.includes("\n\n") && <p className="quant-notebook-transcript">{item.stem.split("\n\n").slice(1).join("\n\n")}</p>}<dl className="quant-notebook-comparison"><div><dt>اختيارك حينها</dt><dd>{item.choiceKey ? choice(item.choiceKey) : "لم تجب"}</dd></div><div><dt>الإجابة بحسب مفتاح المصدر</dt><dd>{choice(item.correctKey)}</dd></div></dl>{item.explanationAvailable === true && item.explanationSource?.publisher === "almufakir" && item.explanation ? <div className="quant-notebook-explanation"><h4>شرح المفكر الموثق</h4><p>{item.explanation}</p><small>مصدر الشرح: الصفحة {number(item.explanationSource.page)}</small></div> : <p className="edu-note">لا يتوفر شرح موثّق من المفكر لهذا السؤال.</p>}{item.source?.title && <p className="edu-note">المصدر: {item.source.title}{item.source.page ? ` • الصفحة ${number(item.source.page)}` : ""}{item.source.questionNumber ? ` • السؤال ${item.source.questionNumber}` : ""}</p>}{item.attribution && <p className="quant-attribution">{item.attribution}</p>}</details>
          <footer><button type="button" className="edu-button secondary" onClick={() => onResult(entry.attemptId)}>افتح نتيجة المحاولة<ArrowLeft size={15}/></button><button type="button" className="edu-button" disabled={busy || !entry.retryAvailable} onClick={() => void practice([questionId])}><RotateCcw size={15}/>أعد التدريب</button></footer>{!entry.retryAvailable && <p className="edu-note">إعادة التدريب غير متاحة؛ لا يوجد إصدار حالي معتمد في نطاقك.</p>}
        </article>;
      })}</div>}
      <p className="edu-note quant-notebook-policy">الدفتر من أحدث {number(data?.historyLimit || 300)} محاولة في نطاقك الحالي، بحد عرض {number(data?.displayLimit || 100)} سؤال في كل تصفية. لا تدخل المحاولات المفتوحة أو النتائج المؤجلة قبل إتاحة التصحيح. تُراجع إتاحة المصدر مجددًا، ولا يظهر شرح إلا إذا كان موثقًا من المفكر. إعادة التدريب تستخدم الإصدار الحالي المعتمد.</p>
    </>}
  </section>;
}
