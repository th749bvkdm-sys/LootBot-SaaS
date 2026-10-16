import { useCallback, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  BookMarked,
  ChartNoAxesCombined,
  PenLine,
  ArrowLeft,
  History,
  Layers,
  Film,
} from "lucide-react";
import { Attempt } from "./Attempt";
import { QuantResults } from "./Results";
import { SectionVideos } from "./SectionVideos";
import { MistakeNotebook } from "./MistakeNotebook";
import { quantApi, number, percent, type Row } from "./api";
import "./quant.css";
export function useQuant<T = Row>(path: string, enabled = true) {
  return useQuery({
    queryKey: ["quant", path],
    queryFn: () => quantApi<T>(path),
    enabled,
    retry: false,
  });
}
export function QuantState({
  query,
  children,
}: {
  query: { isPending: boolean; error: Error | null; refetch: () => unknown };
  children: ReactNode;
}) {
  if (query.isPending)
    return (
      <p role="status" className="edu-empty">
        جار تحميل بيانات الكمي…
      </p>
    );
  if (query.error)
    return (
      <div role="alert" className="edu-notice edu-error">
        {query.error.message}
        <button
          className="edu-button secondary"
          onClick={() => query.refetch()}
        >
          إعادة المحاولة
        </button>
      </div>
    );
  return <>{children}</>;
}
const tabs = [
  ["tests", "أقسام المفكر", BookOpen],
  ["topics", "تدريب سريع", PenLine],
  ["notebook", "دفتر أخطائي", BookMarked],
  ["videos", "شرح الأقسام", Film],
  ["history", "نتائجي", History],
  ["analytics", "تقدمي", ChartNoAxesCombined],
] as const;
export function QuantWorkspace({
  initialTab = "tests",
  compact = false,
}: {
  initialTab?: string;
  compact?: boolean;
}) {
  const meta = useQuant("/meta"),
    tests = useQuant<Row[]>("/tests"),
    history = useQuant<Row[]>("/history"),
    analytics = useQuant("/analytics");
  const initial = new URLSearchParams(window.location.search);
  const [tab, setTab] = useState(
      initial.get("quantVideos") === "1"
        ? "videos"
        : initial.get("quantNotebook") === "1"
          ? "notebook"
          : initialTab === "home"
            ? "tests"
            : initialTab,
    ),
    [attempt, setAttempt] = useState(initial.get("quantAttempt") || ""),
    [resultId, setResultId] = useState(initial.get("quantResult") || ""),
    [reviewOnly, setReviewOnly] = useState(initial.get("quantReview") === "1"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [categoryId, setCategory] = useState(""),
    [count, setCount] = useState(5),
    [timed, setTimed] = useState(false),
    [limit, setLimit] = useState(600);
  function route(id: string, mode: "attempt" | "result" | "review") {
    const u = new URL(window.location.href);
    [
      "quantAttempt",
      "quantResult",
      "quantReview",
      "quantVideos",
      "quantVideo",
      "quantNotebook",
    ].forEach((k) => u.searchParams.delete(k));
    if (id)
      u.searchParams.set(
        mode === "result" ? "quantResult" : "quantAttempt",
        id,
      );
    if (mode === "review" && id) u.searchParams.set("quantReview", "1");
    window.history.replaceState(null, "", u);
    window.scrollTo(0, 0);
  }
  const showResult = useCallback((id: string) => {
    setAttempt("");
    setResultId(id);
    setReviewOnly(false);
    route(id, "result");
  }, []);
  function open(id: string, review = false) {
    setResultId("");
    setAttempt(id);
    setReviewOnly(review);
    route(id, review ? "review" : "attempt");
  }
  function close(nextTab = compact ? "notebook" : "tests") {
    setAttempt("");
    setResultId("");
    setReviewOnly(false);
    setTab(nextTab);
    route("", "attempt");
    void history.refetch();
    void analytics.refetch();
  }
  function selectTab(nextTab: string) {
    setTab(nextTab);
    setError("");
    const url = new URL(window.location.href);
    url.searchParams.delete("quantVideo");
    if (nextTab === "videos") url.searchParams.set("quantVideos", "1");
    else url.searchParams.delete("quantVideos");
    if (nextTab === "notebook") url.searchParams.set("quantNotebook", "1");
    else url.searchParams.delete("quantNotebook");
    window.history.replaceState(null, "", url);
  }
  function showVideos() {
    close("videos");
    selectTab("videos");
  }
  async function begin(fn: () => Promise<Row>) {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      open(r.attemptId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر بدء المحاولة.");
    } finally {
      setBusy(false);
    }
  }
  if (resultId)
    return (
      <QuantResults
        key={resultId}
        id={resultId}
        onBack={() => close(compact ? "notebook" : "tests")}
        onReview={() => open(resultId, true)}
        onVideos={showVideos}
      />
    );
  if (attempt && meta.data?.userId)
    return (
      <Attempt
        key={attempt}
        id={attempt}
        userId={meta.data.userId}
        close={() => close()}
        onComplete={showResult}
        reviewOnly={reviewOnly}
      />
    );
  const skills: Row[] = meta.data?.skills || [],
    stats = analytics.data?.summary;
  const available = skills.reduce((sum, s) => sum + (s.questionCount || 0), 0);
  const selectedAvailable = categoryId
    ? skills.find((s) => s.id === categoryId)?.questionCount || 0
    : available;
  const pageTitle = tabs.find(([key]) => key === tab)?.[1] || "أقسام المفكر";
  return (
    <div className="quant-workspace">
      {!compact && (
        <header className="quant-hub-head">
          <div>
            <span className="edu-eyebrow">القدرات الكمي • أسئلة المفكر</span>
            <h1>{pageTitle}</h1>
            <p>
              {tab === "videos"
                ? "شاهد شرح أقسام المصدر، ثم عد للتدريب عندما تكون جاهزًا."
                : "اختر قسمًا، حلّه في مساحتك الخاصة، ثم راجع نتيجتك وتفاصيل إجاباتك."}
            </p>
          </div>
          <div className="quant-hub-count">
            <strong>
              {tests.isPending ? "—" : number(tests.data?.length)}
            </strong>
            <span>أقسام اختبار متاحة</span>
          </div>
        </header>
      )}
      {!compact && (
        <nav className="quant-nav quant-hub-nav" aria-label="التنقل في القدرات">
          {tabs.map(([key, title, Icon]) => (
            <button
              key={key}
              className="edu-button secondary"
              aria-current={tab === key ? "page" : undefined}
              onClick={() => selectTab(key)}
            >
              <Icon size={18} />
              {title}
            </button>
          ))}
        </nav>
      )}
      {error && (
        <p role="alert" className="edu-notice edu-error">
          {error}
        </p>
      )}
      <QuantState query={meta}>
        {tab === "videos" && <SectionVideos />}
        {tab === "notebook" && (
          <MistakeNotebook onAttempt={(id) => open(id)} onResult={showResult} />
        )}
        {tab === "tests" && (
          <QuantState query={tests}>
            <div className="quant-section-title">
              <p className="edu-note">
                الاختبارات المعروضة من مصدر المفكر المعتمد فقط. تظهر الإجابات
                الصحيحة بعد التسليم.
              </p>
              <span className="quant-catalog-count">
                {number(available)} سؤالًا معتمدًا
              </span>
            </div>
            <div className="quant-test-list">
              {tests.data?.map((t, i) => (
                <article className="edu-card quant-test-card" key={t.id}>
                  <div className="quant-section-card-top">
                    <span className="quant-section-number">
                      {number(i + 1).padStart(2, "٠")}
                    </span>
                    <span className="edu-eyebrow">
                      المفكر • {number(t.itemCount)} سؤالًا
                    </span>
                  </div>
                  <h2>{t.title}</h2>
                  <p>
                    {t.timeLimitSec
                      ? number(t.timeLimitSec / 60) + " دقيقة"
                      : "دون مؤقت"}{" "}
                    •{" "}
                    {t.allowReturn
                      ? "يمكن الرجوع للأسئلة"
                      : "تنقل إلى الأمام فقط"}
                  </p>
                  <div className="quant-card-detail">
                    <BookOpen size={16} /> صور السؤال الأصلية <span>•</span>
                    <PenLine size={16} /> مساحة للحل
                  </div>
                  <button
                    className="edu-button"
                    disabled={busy}
                    onClick={() =>
                      void begin(() =>
                        quantApi(`/tests/${t.id}/attempts`, "POST", {}),
                      )
                    }
                  >
                    {busy ? "جار فتح القسم…" : "ابدأ القسم"}
                    <ArrowLeft size={16} />
                  </button>
                </article>
              ))}
            </div>
            {tests.data?.length === 0 && (
              <p className="edu-empty">
                لا توجد أقسام المفكر المنشورة في نطاق مدرستك بعد.
              </p>
            )}
          </QuantState>
        )}
        {tab === "topics" && (
          <section className="edu-card quant-quick-practice">
            <div className="quant-section-title">
              <h2>تدريب قصير من أسئلة المفكر</h2>
              <Layers size={24} />
            </div>
            <p className="edu-note">
              اختر مهارة معينة أو جميع المهارات، ثم حدد عدد الأسئلة. التدريب
              يستخدم أسئلة المفكر المعتمدة المتاحة في حسابك فقط.
            </p>
            <form
              className="edu-form"
              onSubmit={(e) => {
                e.preventDefault();
                void begin(() =>
                  quantApi("/practice", "POST", {
                    categoryId: categoryId || undefined,
                    count,
                    ...(timed ? { timeLimitSec: limit } : {}),
                  }),
                );
              }}
            >
              <label>
                المهارة
                <select
                  aria-label="مهارة التدريب"
                  value={categoryId}
                  onChange={(e) => {
                    const selected = e.target.value;
                    setCategory(selected);
                    const n = selected
                      ? skills.find((s) => s.id === selected)?.questionCount ||
                        0
                      : available;
                    setCount((current) =>
                      Math.max(1, Math.min(current, n, 50)),
                    );
                  }}
                >
                  <option value="">جميع المهارات المتاحة</option>
                  {skills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({number(s.questionCount)} سؤالًا)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                عدد الأسئلة
                <input
                  aria-label="عدد أسئلة التدريب"
                  type="number"
                  min="1"
                  max={Math.min(50, selectedAvailable || 50)}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </label>
              <label className="quant-check">
                <input
                  type="checkbox"
                  checked={timed}
                  onChange={(e) => setTimed(e.target.checked)}
                />{" "}
                تدريب بمؤقت
              </label>
              {timed && (
                <label>
                  المدة بالدقائق
                  <input
                    aria-label="مدة التدريب بالدقائق"
                    type="number"
                    min="1"
                    max="240"
                    value={limit / 60}
                    onChange={(e) => setLimit(Number(e.target.value) * 60)}
                  />
                </label>
              )}
              <div className="edu-actions edu-wide">
                <button
                  className="edu-button"
                  disabled={busy || !selectedAvailable}
                >
                  {busy ? "جار التحضير…" : "ابدأ التدريب"}
                </button>
              </div>
            </form>
          </section>
        )}
        {tab === "history" && (
          <QuantState query={history}>
            <section className="edu-card">
              <h2>نتائج الأقسام ومحاولاتك</h2>
              <p className="edu-note">
                افتح النتيجة لمراجعة اختياراتك والأخطاء والأسئلة التي تركتها دون
                إجابة.
              </p>
              {!history.data?.length && (
                <p className="edu-empty">بعد أول محاولة، تظهر نتيجتك هنا.</p>
              )}
              {history.data?.map((r) => (
                <article className="quant-history-row" key={r.id}>
                  <div>
                    <strong>{r.title}</strong>
                    <small>
                      {new Date(r.startedAt).toLocaleString("ar-SA")} •{" "}
                      {r.status === "in_progress"
                        ? "قيد الحل"
                        : r.status === "expired"
                          ? "انتهى الوقت"
                          : "تم التسليم"}
                    </small>
                    {r.summary && (
                      <div className="quant-history-score">
                        <span>
                          {r.summary.correct == null
                            ? "نتيجة مؤجلة"
                            : `${number(r.summary.correct)} صحيحة`}
                        </span>
                        <span>{number(r.summary.unanswered)} دون إجابة</span>
                        <span>الإنجاز {percent(r.summary.completion)}</span>
                      </div>
                    )}
                  </div>
                  <button
                    className="edu-button secondary"
                    onClick={() =>
                      r.status === "in_progress" ? open(r.id) : showResult(r.id)
                    }
                  >
                    {r.status === "in_progress"
                      ? "استكمال الحل"
                      : "النتيجة والتفاصيل"}
                    <ArrowLeft size={16} />
                  </button>
                </article>
              ))}
            </section>
          </QuantState>
        )}
        {tab === "analytics" && (
          <>
            <div className="edu-kpis">
              {[
                [history.data?.length || 0, "محاولاتك"],
                [
                  stats?.accuracy == null ? "—" : percent(stats.accuracy),
                  "دقة الإجابات المقدمة",
                ],
                [
                  stats?.completion == null ? "—" : percent(stats.completion),
                  "الإنجاز",
                ],
              ].map(([value, label]) => (
                <article className="edu-card quant-stat" key={label}>
                  <strong>{String(value)}</strong>
                  <span>{label}</span>
                </article>
              ))}
            </div>
            <QuantAnalytics
              query={analytics}
              availableSkillIds={skills.map((s) => s.id)}
              practice={(skillId) =>
                void begin(() =>
                  quantApi("/practice", "POST", {
                    categoryId: skillId,
                    count: 5,
                  }),
                )
              }
            />
          </>
        )}
      </QuantState>
    </div>
  );
}
function QuantAnalytics({
  query,
  practice,
  availableSkillIds,
}: {
  availableSkillIds: string[];
  query: {
    data?: Row;
    isPending: boolean;
    error: Error | null;
    refetch: () => unknown;
  };
  practice: (id: string) => void;
}) {
  return (
    <QuantState query={query}>
      <div className="edu-grid">
        {query.data?.skills?.map((s: Row) => (
          <article className="edu-card quant-skill" key={s.id}>
            <h3>{s.name}</h3>
            <div className="quant-skill-row">
              <strong>{percent(s.accuracy)}</strong>
              <span>دقة • {number(s.attempted)} إجابات</span>
            </div>
            <div className="edu-progress">
              <span style={{ width: `${(s.mastery || 0) * 100}%` }} />
            </div>
            <p>
              {s.confidence === "insufficient"
                ? "البيانات لا تكفي للحكم على المهارة. أكمل مزيدًا من التدريب."
                : s.confidence === "low"
                  ? "عينة محدودة؛ التقدير مبدئي."
                  : "تقدير من عينة أوضح، وليس حكمًا نهائيًا."}
            </p>
            <dl className="quant-skill-details">
              <div>
                <dt>تقدير بتمهيد</dt>
                <dd>{percent(s.mastery)}</dd>
              </div>
              <div>
                <dt>دون إجابة</dt>
                <dd>{number(s.unanswered)}</dd>
              </div>
              <div>
                <dt>متوسط الوقت</dt>
                <dd>
                  {s.averageTimeMs == null
                    ? "—"
                    : number(s.averageTimeMs / 1000)}{" "}
                  ث
                </dd>
              </div>
              <div>
                <dt>تغيير الإجابات</dt>
                <dd>{number(s.changeCount)}</dd>
              </div>
            </dl>
            {s.trend != null && (
              <p>
                فرق الدقة في آخر 5 إجابات مقارنة بالخمس السابقة:{" "}
                {s.trend > 0 ? "+" : ""}
                {number(s.trend * 100)} نقطة مئوية.
              </p>
            )}
          </article>
        ))}
      </div>
      {!query.data?.skills?.length && (
        <p className="edu-empty">
          تظهر مهاراتك من محاولات مكتملة فعلًا. لا توجد نتائج مصطنعة.
        </p>
      )}
      <section className="edu-card">
        <h3>أخطاء متكررة عبر محاولات مختلفة</h3>
        {query.data?.repeatedErrors?.length ? (
          query.data.repeatedErrors.map((r: Row) => (
            <p key={r.questionId}>
              {r.skill} • تكرر الخطأ في السؤال نفسه في {number(r.count)}{" "}
              محاولات؛ المرجع {r.questionId.slice(0, 8)}.
            </p>
          ))
        ) : (
          <p>لا توجد أخطاء متكررة يمكن عرضها وفق سياسة الحلول الحالية.</p>
        )}
      </section>
      <section className="edu-card">
        <h3>خطوتك التالية، مع سببها</h3>
        <p className="edu-note">
          التحليل مبني على أحدث 300 محاولة متاحة في نطاقك؛ النتائج المؤجلة لا
          تدخل قبل موعد إظهارها.
        </p>
        {!query.data?.recommendations?.length && (
          <p>أكمل عدة محاولات لتتكون توصيات مدعومة ببياناتك.</p>
        )}
        {query.data?.recommendations?.map((r: Row, i: number) => (
          <div className="edu-row" key={i}>
            <div>
              <strong>{r.skill}</strong>
              <p>{r.reason}</p>
              <small>
                بناءً على {number(r.basedOnAttemptIds?.length)} محاولات:{" "}
                {r.basedOnAttemptIds
                  ?.map((id: string) => id.slice(0, 8))
                  .join("، ")}
              </small>
            </div>
            {r.skillId && (
              <div>
                <button
                  className="edu-button secondary"
                  disabled={!availableSkillIds.includes(r.skillId)}
                  onClick={() => practice(r.skillId)}
                >
                  تدريب مركّز
                </button>
                {!availableSkillIds.includes(r.skillId) && (
                  <p className="edu-note">
                    لا توجد أسئلة مفكر معتمدة متاحة لهذه المهارة حاليًا.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
        <p className="edu-note">
          الدقة = الصحيحة ÷ الإجابات المقدمة. دون إجابة منفصل. التمهيد (صحيحة +
          1) ÷ (مقدمة + 2). أقل من 5 إجابات: غير كافٍ؛ 5–14: محدود؛ 15 فأكثر:
          أوضح.
        </p>
      </section>
    </QuantState>
  );
}
