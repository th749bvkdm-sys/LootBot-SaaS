import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useAcademy,
  academyApi,
  type AcademyRow as Row,
} from "./student-academy-api";
import { teacherApi } from "../lib/teacher-api";
import { quantApi } from "./quant/api";
import { QuestionFigure } from "./quant/QuestionFigure";
export function MistakeFlashcardsView({
  initialSource = "mufakir",
}: {
  initialSource?: "mufakir" | "academy" | "saved";
}) {
  const [source, setSource] = useState(initialSource),
    [index, setIndex] = useState(0),
    [flipped, setFlipped] = useState(false),
    [hidden, setHidden] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const academy = useAcademy("/mistakes", source === "academy"),
    quant = useQuery({
      queryKey: ["quant", "flashcards"],
      queryFn: () => quantApi("/notebook?status=pending"),
      enabled: source === "mufakir",
    }),
    saved = useQuery({
      queryKey: ["education", "/personal"],
      queryFn: () => teacherApi<Row[]>("/education/personal"),
      enabled: source === "saved",
    }),
    qc = useQueryClient();
  const rows: Row[] =
    source === "academy"
      ? (academy.data?.items ?? []).filter((r: Row) => !r.mastered)
      : source === "mufakir"
        ? (quant.data?.items ?? [])
        : (saved.data ?? []).filter((r) => r.kind === "bookmark");
  const all = rows.filter(
      (r) => !hidden.includes(String(r.item?.questionId ?? r.id)),
    ),
    card = all[Math.min(index, Math.max(0, all.length - 1))],
    item = source === "mufakir" ? card?.item : card;
  const query =
    source === "academy" ? academy : source === "mufakir" ? quant : saved;
  useEffect(() => {
    setIndex(0);
    setFlipped(false);
    setHidden([]);
    setError("");
  }, [source]);
  useEffect(() => setFlipped(false), [index, item?.id, item?.questionId]);
  async function review(mastered: boolean) {
    if (!item) return;
    setBusy(true);
    setError("");
    try {
      if (source === "academy") {
        await academyApi("/mistakes/" + item.id + "/review", "POST", {
          mastered,
        });
        await qc.invalidateQueries({ queryKey: ["student-academy"] });
      } else if (mastered) {
        setHidden((h) => [...h, String(item.questionId ?? item.id)]);
      } else setIndex((i) => (all.length ? (i + 1) % all.length : 0));
      setFlipped(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="sa-workspace">
      <div className="sa-section-head">
        <div>
          <span className="sa-overline">استرجع الفكرة قبل كشف الإجابة</span>
          <h2>بطاقات المراجعة السريعة</h2>
        </div>
        <label>
          مصدر البطاقات
          <select
            aria-label="مصدر البطاقات"
            value={source}
            onChange={(e) => setSource(e.target.value as typeof source)}
          >
            <option value="mufakir">أخطاء المفكر</option>
            <option value="academy">أخطاء التأسيس</option>
            <option value="saved">أسئلتي المحفوظة</option>
          </select>
        </label>
      </div>
      {query.isPending ? (
        <p role="status">جار تحميل بطاقاتك…</p>
      ) : query.error ? (
        <p role="alert">{query.error.message}</p>
      ) : !item ? (
        <p className="edu-empty">
          لا بطاقات تحتاج مراجعة في هذا العرض.{" "}
          <button
            className="edu-button secondary"
            onClick={() => setHidden([])}
          >
            إظهار ما أخفيته في الجلسة
          </button>
        </p>
      ) : (
        <>
          <p>
            {Math.min(index + 1, all.length)} / {all.length}
          </p>
          <article
            className="ws-flashcard"
            data-face={flipped ? "answer" : "question"}
          >
            <span className="sa-overline">
              {item.skill || "من أسئلتك الشخصية"}
            </span>
            <h3>
              {item.stem?.split("\n\n")[0] || item.text || item.data?.title}
            </h3>
            {item.images?.map((src: string) => (
              <QuestionFigure key={src} url={src} />
            ))}
            {!flipped ? (
              <>
                <ol>
                  {(item.choices ?? item.options ?? []).map(
                    (c: Row | string, i: number) => (
                      <li key={i}>{typeof c === "string" ? c : c.text}</li>
                    ),
                  )}
                </ol>
                <button className="edu-button" onClick={() => setFlipped(true)}>
                  اكشف فكرة الحل
                </button>
              </>
            ) : (
              <div aria-live="polite">
                <h4>
                  {source === "mufakir"
                    ? "الإجابة بحسب مفتاح المفكر"
                    : source === "academy"
                      ? "الإجابة والشرح الأصلي للتأسيس"
                      : "ملاحظتك المحفوظة"}
                </h4>
                <p>
                  {source === "academy"
                    ? item.options?.[item.correctIndex]
                    : source === "mufakir"
                      ? item.choices?.find(
                          (c: Row) => c.key === item.correctKey,
                        )?.text
                      : item.data?.note || "لم تحفظ إجابة لهذا العنصر."}
                </p>
                {source === "academy" ? (
                  <p>{item.explanation}</p>
                ) : source === "mufakir" &&
                  item.explanationAvailable === true &&
                  item.explanationSource?.publisher === "almufakir" ? (
                  <p>{item.explanation}</p>
                ) : source === "mufakir" ? (
                  <p className="edu-note">
                    لا يتوفر شرح موثّق من المفكر لهذا السؤال.
                  </p>
                ) : null}
                <div className="ws-flash-controls">
                  <button
                    className="edu-button secondary"
                    disabled={busy}
                    onClick={() => void review(false)}
                  >
                    أحتاج مراجعته لاحقًا
                  </button>
                  <button
                    className="edu-button"
                    disabled={busy}
                    onClick={() => void review(true)}
                  >
                    أتقنته — إخفاء من المراجعة العاجلة
                  </button>
                  <button
                    className="edu-button secondary"
                    onClick={() => setFlipped(false)}
                  >
                    العودة للسؤال
                  </button>
                </div>
              </div>
            )}
          </article>
          <nav
            className="ws-flash-controls"
            aria-label="التنقل بين بطاقات المراجعة"
          >
            <button
              className="edu-button secondary"
              disabled={index <= 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              البطاقة السابقة
            </button>
            <button
              className="edu-button secondary"
              disabled={index >= all.length - 1}
              onClick={() => setIndex((i) => i + 1)}
            >
              البطاقة التالية
            </button>
          </nav>
          {source === "mufakir" && (
            <p className="edu-note">
              الإخفاء هنا تقييم ذاتي لهذه الجلسة فقط؛ الإتقان المحسوب في دفتر
              المفكر يتغير عند إجابة صحيحة لاحقة.
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="edu-error">
          {error}
        </p>
      )}
    </section>
  );
}
