import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CircleHelp, Clock3, Flag, ListChecks, RefreshCw, X } from "lucide-react";
import { number, percent, quantApi, type Row } from "./api";
import { QuestionFigure } from "./QuestionFigure";
import "./results.css";

type Filter = "review" | "wrong" | "unanswered" | "correct" | "all";
const letter = (key: string | null | undefined) => key ? ({ A: "أ", B: "ب", C: "ج", D: "د", E: "هـ", F: "و" }[key] || key) : "لم تجب";
const duration = (ms: number) => {
  const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  return seconds >= 60 ? `${number(Math.floor(seconds / 60))} دقيقة و${number(seconds % 60)} ثانية` : `${number(seconds)} ثانية`;
};
const statusText = (item: Row) => item.outcome === "correct" ? "إجابة صحيحة" : item.outcome === "wrong" ? "إجابة خاطئة" : item.outcome === "unanswered" ? "دون إجابة" : "التصحيح غير متاح الآن";

/** A separate read-only destination after submission. Answers remain controlled by the server reveal policy. */
export function QuantResults({ id, onBack, onReview, onVideos }: { id: string; onBack: () => void; onReview?: () => void; onVideos?: () => void }) {
  const [result, setResult] = useState<Row | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("review"), heading = useRef<HTMLHeadingElement>(null), requestId = useRef(0);
  const load = useCallback(async () => {
    const current = ++requestId.current; setLoading(true); setError("");
    try { const data = await quantApi(`/attempts/${id}/result`); if (current === requestId.current) setResult(data); }
    catch (e) { if (current === requestId.current) setError(e instanceof Error ? e.message : "تعذر تحميل النتيجة."); }
    finally { if (current === requestId.current) setLoading(false); }
  }, [id]);
  useEffect(() => { setResult(null); setFilter("review"); void load(); return () => { requestId.current++; }; }, [load]);
  useEffect(() => { if (result && !loading) heading.current?.focus(); }, [id, result, loading]);
  if (!result) return <section className="edu-card quant-results" dir="rtl" aria-busy={loading}>
    <h1>نتيجة الاختبار</h1><p role={error ? "alert" : "status"}>{error || "جار تحميل النتيجة وحصر الإجابات…"}</p>
    <div className="edu-actions"><button type="button" className="edu-button secondary" onClick={onBack}><ArrowRight size={17}/> العودة للأقسام</button>{error && <button type="button" className="edu-button" disabled={loading} onClick={() => void load()}><RefreshCw size={17}/> إعادة المحاولة</button>}</div>
  </section>;
  const summary = result.summary || {}, items: Row[] = result.items || [], revealed = !!result.revealed;
  const currentFilter = !revealed && filter !== "all" && filter !== "unanswered" ? "all" : filter;
  const visible = items.filter(item => currentFilter === "all" || currentFilter === "review" && ["wrong", "unanswered"].includes(item.outcome) || item.outcome === currentFilter);
  const count = (outcome: string) => items.filter(item => item.outcome === outcome).length;
  const filters: { id: Filter; label: string; count: number }[] = revealed ? [
    { id: "review", label: "تحتاج مراجعة", count: count("wrong") + count("unanswered") },
    { id: "wrong", label: "الخاطئة", count: count("wrong") },
    { id: "unanswered", label: "دون إجابة", count: count("unanswered") },
    { id: "correct", label: "الصحيحة", count: count("correct") },
    { id: "all", label: "كل الأسئلة", count: items.length },
  ] : [{ id: "all", label: "كل الإجابات", count: items.length }, { id: "unanswered", label: "دون إجابة", count: count("unanswered") }];
  return <section className="quant-results" dir="rtl" aria-busy={loading}>
    <header className="quant-results-hero">
      <div className="quant-results-title"><span className="edu-eyebrow">نتيجة الاختبار • {result.status === "expired" ? "انتهى الوقت" : result.status === "in_progress" ? "تغذية راجعة" : "تم التسليم"}</span>
        <h1 ref={heading} tabIndex={-1}>{result.test?.title || "نتيجة المحاولة"}</h1>
        <p>{result.status === "in_progress" ? "مراجعة الإجابات المحفوظة المتاحة وفق إعداد الاختبار." : "راجِع اختيارك ومفتاح الإجابة لكل سؤال، ثم عد للأقسام عندما تنتهي."}</p></div>
      <button type="button" className="edu-button secondary" onClick={onBack}><ArrowRight size={17}/> العودة للأقسام</button>
    </header>
    {error && <p className="edu-notice edu-error" role="alert">{error}</p>}
    <div className="quant-results-stats" aria-label="ملخص النتيجة">
      <div><Check aria-hidden="true"/><strong>{summary.correct == null ? "—" : number(summary.correct)}</strong><span>إجابات صحيحة</span></div>
      <div><X aria-hidden="true"/><strong>{summary.wrong == null ? "—" : number(summary.wrong)}</strong><span>إجابات خاطئة</span></div>
      <div><CircleHelp aria-hidden="true"/><strong>{number(summary.unanswered)}</strong><span>دون إجابة</span></div>
      <div><ListChecks aria-hidden="true"/><strong>{percent(summary.accuracy)}</strong><span>دقة الإجابات المقدّمة</span></div>
    </div>
    <dl className="quant-results-facts">
      <div><dt>عدد الأسئلة</dt><dd>{number(summary.total)}</dd></div>
      <div><dt>اكتمال الإجابات</dt><dd>{percent(summary.completion)}</dd></div>
      <div><dt>الوقت المسجّل</dt><dd>{duration(summary.timeSpentMs)}</dd></div>
      <div><dt>تغييرات الإجابة</dt><dd>{number(summary.answerChanges)}</dd></div>
    </dl>
    {!revealed ? <div className="edu-notice quant-results-policy"><h3>التصحيح التفصيلي غير متاح الآن</h3><p>{result.revealAt ? `يُتاح بعد ${new Date(result.revealAt).toLocaleString("ar-SA")}. تظهر هنا إجاباتك المحفوظة فقط حتى الموعد.` : "سياسة هذا الاختبار لا تتيح عرض مفتاح الإجابة. يمكنك مراجعة اختياراتك والأسئلة التي تركتها."}</p><button type="button" className="edu-button secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={16}/> تحديث النتيجة</button></div> :
      <p className="quant-results-explanation-note">التصحيح يقارن اختيارك بمفتاح الإجابة. لا يظهر شرح للسؤال إلا عند وجود شرح من المفكر موثّق ومراجع؛ مفاتيح الإجابة وحدها ليست شرحًا.</p>}
    <section aria-labelledby="quant-results-review-title">
      <div className="quant-results-section-heading"><h3 id="quant-results-review-title">مراجعة الأسئلة</h3><span aria-live="polite">{number(visible.length)} من {number(items.length)}</span></div>
      <nav className="quant-results-filters" aria-label="تصفية مراجعة النتيجة">{filters.map(option => <button type="button" key={option.id} aria-pressed={currentFilter === option.id} onClick={() => setFilter(option.id)}>{option.label}<span>{number(option.count)}</span></button>)}</nav>
      {visible.length === 0 ? <div className="edu-card quant-results-empty"><Check size={30}/><h4>{currentFilter === "review" ? "لا توجد إجابات خاطئة أو أسئلة متروكة" : "لا توجد أسئلة في هذا التصنيف"}</h4><p>{currentFilter === "review" ? "يمكنك الاطلاع على إجاباتك الصحيحة أو العودة للأقسام." : "اختر تصنيفًا آخر لمتابعة المراجعة."}</p></div> :
        <div className="quant-results-items">{visible.map(item => <ResultQuestion key={item.versionId} item={item} revealed={revealed}/>)}</div>}
    </section>
    <footer className="quant-results-footer"><button type="button" className="edu-button" onClick={onBack}><ArrowRight size={17}/> العودة للأقسام</button>{onReview && <button type="button" className="edu-button secondary" onClick={onReview}>عرض مسودات الحل المحفوظة</button>}{onVideos && <button type="button" className="edu-button secondary" onClick={onVideos}>مكتبة شرح أقسام المفكر</button>}</footer>
  </section>;
}

function ResultQuestion({ item, revealed }: { item: Row; revealed: boolean }) {
  const imageQuestion = item.images?.length > 0, source = item.source || {};
  const choiceLabel = (key: string | null) => {
    if (!key) return "لم تجب";
    const text = item.choices?.find((c: Row) => c.key === key)?.text;
    return text && !/^الخيار .+ في الصورة$/.test(text) ? `${letter(key)} — ${text}` : `الخيار ${letter(key)}`;
  };
  return <article className={`edu-card quant-result-question ${item.outcome || "hidden"}`} aria-labelledby={`quant-result-question-${item.versionId}`}>
    <header><h4 id={`quant-result-question-${item.versionId}`}>السؤال {number(Number(item.position || 0) + 1)}</h4><span className="quant-result-outcome">{item.outcome === "correct" ? <Check size={16}/> : item.outcome === "wrong" ? <X size={16}/> : <CircleHelp size={16}/>} {statusText(item)}</span></header>
    <h5 className="quant-result-stem">{imageQuestion ? item.stem?.split("\n\n")[0] : item.stem}</h5>
    <dl className="quant-result-answer-comparison"><div className="student"><dt>اختيارك</dt><dd>{choiceLabel(item.choiceKey)}</dd></div>{revealed && item.correctKey && <div className="source"><dt>الإجابة الصحيحة بحسب المفتاح</dt><dd>{choiceLabel(item.correctKey)}</dd></div>}</dl>
    <details className="quant-result-details"><summary>عرض صورة السؤال وخياراته</summary>
    {item.images?.map((url: string) => <QuestionFigure key={url} url={url}/>)}
    {imageQuestion && item.stem?.includes("\n\n") && <details className="quant-transcript"><summary>قراءة نص السؤال ووصف الرسم</summary><p>{item.stem.split("\n\n").slice(1).join("\n\n")}</p></details>}
    <ul className="quant-result-choices" aria-label="مراجعة خيارات الإجابة">{item.choices?.map((choice: Row) => <li key={choice.key} className={`${revealed && item.correctKey === choice.key ? "is-correct" : ""} ${item.choiceKey === choice.key ? "is-selected" : ""}`}><b>{letter(choice.key)}</b><span>{choice.text}</span>{item.choiceKey === choice.key && <small>اختيارك</small>}{revealed && item.correctKey === choice.key && <small>المفتاح الصحيح</small>}</li>)}</ul>
    {revealed && item.explanationAvailable === true && item.explanationSource?.publisher === "almufakir" && item.explanation ? <section className="quant-result-source-explanation"><h5>شرح المفكر</h5><p>{item.explanation}</p><small>مصدر الشرح: المفكر • الصفحة {number(item.explanationSource.page)}</small></section> : null}
    </details>
    {revealed && !item.explanationAvailable && <p className="quant-result-no-explanation">لا يتوفر شرح موثّق من المفكر لهذا السؤال.</p>}
    <footer><span><Clock3 size={14}/> الوقت المسجّل: {duration(item.timeSpentMs)}</span><span>تغييرات الإجابة: {number(item.changeCount)}</span>{item.flagged && <span><Flag size={14}/> علّمته للمراجعة</span>}</footer>
    {(source.title || source.page || source.questionNumber) && <p className="quant-result-source-reference">المصدر: {source.title || (source.publisher === "almufakir" ? "المفكر" : "المصدر المراجع")}{source.section && ` • ${String(source.section).startsWith("القسم") ? source.section : "القسم " + source.section}`}{source.questionNumber && ` • السؤال ${source.questionNumber}`}{source.page && ` • الصفحة ${number(source.page)}`}</p>}
    {item.attribution && <p className="quant-attribution">{item.attribution}</p>}
  </article>;
}
