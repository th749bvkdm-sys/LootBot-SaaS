import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Flame,
  Headphones,
  Layers,
  Play,
  RotateCcw,
  Sparkles,
  Target,
  Trophy,
  Users,
  X,
} from "lucide-react";
import {
  academyApi,
  useAcademy,
  useStudy,
  studentNumber as n,
  studentPercent as pct,
  saveDownload,
  type AcademyRow as Row,
} from "./student-academy-api";
import "./student-academy.css";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
export function StudentLoading({
  query,
  children,
}: {
  query: { isPending: boolean; error: Error | null; refetch: () => unknown };
  children: ReactNode;
}) {
  if (query.isPending)
    return (
      <p className="edu-empty" role="status">
        نجهّز مساحة تعلمك…
      </p>
    );
  if (query.error)
    return (
      <div className="edu-notice edu-error" role="alert">
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
export function StudentLaunchpad({
  navigate,
}: {
  navigate: (key: string) => void;
}) {
  const catalog = useAcademy("/catalog"),
    study = useStudy("/overview");
  const stats = catalog.data?.stats,
    s = study.data?.stats;
  return (
    <div className="sa-workspace">
      <section className="sa-welcome">
        <div>
          <span className="sa-overline">
            <Sparkles size={15} />
            خطوة صغيرة اليوم. أثر أكبر غدًا.
          </span>
          <h2>
            مساحتك للتعلّم،
            <br />
            <em>على إيقاعك.</em>
          </h2>
          <p>
            تأسيس واضح، تدريب له هدف، ومراجعة ترجع لك ما فاتك. اختر خطوتك وابدأ.
          </p>
          <div className="edu-actions">
            <button className="edu-button" onClick={() => navigate("academy")}>
              استكشف مساراتي <ArrowLeft size={17} />
            </button>
            <button
              className="edu-button secondary"
              onClick={() => navigate("aptitude")}
            >
              أقسام المفكر
            </button>
          </div>
        </div>
        <div className="sa-orb" aria-hidden="true">
          <div>
            <GraduationSymbol />
          </div>
          <span>LEARN · PRACTICE · GROW</span>
        </div>
      </section>
      <div className="sa-metrics">
        {[
          [Flame, s?.streakDays, "أيام الاستمرارية"],
          [Clock, s?.focusMinutesToday, "دقائق التركيز اليوم"],
          [BookOpen, stats?.completedLessons, "دروس اجتزتها"],
          [
            Target,
            stats?.accuracy == null
              ? null
              : n(Math.round(stats.accuracy)) + "٪",
            "دقة تدريبات التأسيس",
          ],
        ].map(([Icon, value, label]) => {
          const I = Icon as typeof Flame;
          return (
            <article className="edu-card" key={String(label)}>
              <I size={22} />
              <strong>
                {value == null
                  ? "—"
                  : typeof value === "number"
                    ? n(value)
                    : String(value)}
              </strong>
              <span>{String(label)}</span>
            </article>
          );
        })}
      </div>
      <div className="sa-dashboard-grid">
        <section className="edu-card">
          <div className="sa-section-head">
            <div>
              <span className="sa-overline">من نتائجك الفعلية</span>
              <h2>خطوتك التالية</h2>
            </div>
            <Target size={24} />
          </div>
          {catalog.isPending ? (
            <p>جار تحميل التوصيات…</p>
          ) : catalog.error ? (
            <p role="alert">{catalog.error.message}</p>
          ) : catalog.data?.recommendations?.length ? (
            catalog.data.recommendations.slice(0, 3).map((r: Row) => (
              <button
                className="sa-recommendation"
                key={r.lessonId}
                onClick={() => {
                  navigate("academy");
                  const u = new URL(window.location.href);
                  u.searchParams.set("academyTrack", r.trackId);
                  u.searchParams.set("academyLesson", r.lessonId);
                  window.history.replaceState(null, "", u);
                  window.dispatchEvent(new Event("academy:lesson"));
                }}
              >
                <span>
                  <b>{r.title}</b>
                  <small>{r.reason}</small>
                </span>
                <ArrowLeft size={18} />
              </button>
            ))
          ) : (
            <>
              <p>ابدأ درسًا قصيرًا. بعدها نرشّح لك مراجعة مدعومة بإجاباتك.</p>
              <button
                className="edu-button secondary"
                onClick={() => navigate("academy")}
              >
                ابدأ التأسيس
              </button>
            </>
          )}
        </section>
        <section className="edu-card">
          <div className="sa-section-head">
            <h2>موعدك مع التركيز</h2>
            <Clock size={24} />
          </div>
          <p>
            هدفك اليومي {n(study.data?.dailyGoalMinutes || 25)} دقيقة. جلسة
            هادئة أو غرفة خاصة مع زملائك.
          </p>
          <div className="edu-progress">
            <span
              style={{
                width:
                  Math.min(
                    100,
                    ((s?.focusMinutesToday || 0) /
                      (study.data?.dailyGoalMinutes || 25)) *
                      100,
                  ) + "%",
              }}
            />
          </div>
          <div className="edu-actions">
            <button className="edu-button" onClick={() => navigate("plan")}>
              خطة اليوم
            </button>
            <button
              className="edu-button secondary"
              onClick={() => navigate("rooms")}
            >
              <Users size={16} />
              غرف المذاكرة
            </button>
          </div>
        </section>
      </div>
      <div className="sa-shortcuts">
        {[
          ["mistakes", RotateCcw, "دفتر الأخطاء", "راجع ما يحتاج انتباهك"],
          ["achievements", Trophy, "إنجازاتي", "سلسلة وأوسمة من نشاطك"],
          [
            "downloads",
            Download,
            "مكتبتي دون إنترنت",
            "دروس أصلية تحمّلها لجهازك",
          ],
        ].map(([key, Icon, title, desc]) => {
          const I = Icon as typeof Trophy;
          return (
            <button
              className="edu-card sa-shortcut"
              key={String(key)}
              onClick={() => navigate(String(key))}
            >
              <I size={26} />
              <span>
                <b>{String(title)}</b>
                <small>{String(desc)}</small>
              </span>
              <ArrowLeft size={18} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
function GraduationSymbol() {
  return <Layers size={72} strokeWidth={1.2} />;
}
export function StudentAcademy({ view = "tracks" }: { view?: string }) {
  const catalog = useAcademy("/catalog"),
    history = useAcademy<Row[]>("/history", view === "history"),
    analytics = useAcademy("/analytics", view === "analytics");
  const initial = new URLSearchParams(window.location.search);
  const [attempt, setAttempt] = useState(initial.get("academyAttempt") || ""),
    [track, setTrack] = useState(initial.get("academyTrack") || ""),
    [lesson, setLesson] = useState<Row | null>(null),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [mode, setMode] = useState("untimed"),
    [count, setCount] = useState(10),
    [minutes, setMinutes] = useState(15);
  useEffect(() => {
    if (lesson)
      document
        .querySelector(".sa-reader")
        ?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [lesson]);
  useEffect(() => {
    function selectLesson() {
      const u = new URLSearchParams(window.location.search);
      const t = u.get("academyTrack"),
        l = u.get("academyLesson");
      if (t) setTrack(t);
      if (l) {
        const selected = catalog.data?.tracks
          ?.flatMap((row: Row) => row.lessons)
          .find((row: Row) => row.id === l);
        if (selected) setLesson(selected);
      }
    }
    selectLesson();
    window.addEventListener("academy:lesson", selectLesson);
    return () => window.removeEventListener("academy:lesson", selectLesson);
  }, [catalog.data]);
  function route(id: string) {
    const u = new URL(window.location.href);
    if (id) u.searchParams.set("academyAttempt", id);
    else u.searchParams.delete("academyAttempt");
    window.history.replaceState(null, "", u);
  }
  function open(id: string) {
    setAttempt(id);
    route(id);
    window.scrollTo(0, 0);
  }
  async function start(
    trackId: string,
    lessonId?: string,
    mistakesOnly = false,
  ) {
    setBusy(true);
    setError("");
    try {
      const r = await academyApi("/attempts", "POST", {
        trackId,
        lessonId,
        mode,
        count,
        ...(mode !== "untimed" ? { timeLimitSec: minutes * 60 } : {}),
        mistakesOnly,
      });
      setLesson(null);
      open(r.attemptId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (attempt)
    return (
      <AcademyAttempt
        id={attempt}
        close={() => {
          setAttempt("");
          route("");
          void catalog.refetch();
          void history.refetch();
          void analytics.refetch();
        }}
      />
    );
  const tracks: Row[] = catalog.data?.tracks || [];
  const selected = tracks.find((t) => t.id === track);
  const filtered = tracks.filter(
    (t) =>
      !search ||
      [t.title, t.description, ...t.lessons.map((l: Row) => l.title)]
        .join(" ")
        .includes(search),
  );
  return (
    <div className="sa-workspace">
      <StudentLoading query={catalog}>
        {error && (
          <p className="edu-notice edu-error" role="alert">
            {error}
          </p>
        )}
        {view === "history" ? (
          <StudentLoading query={history}>
            <section className="edu-card">
              <h2>محاولات التأسيس</h2>
              {!history.data?.length && (
                <p className="edu-empty">
                  تظهر محاولاتك هنا بعد بدء أول تدريب.
                </p>
              )}
              {history.data?.map((r) => (
                <div className="edu-row" key={r.id}>
                  <div>
                    <b>{r.title}</b>
                    <small>
                      {r.status === "active"
                        ? "قيد الحل"
                        : `${pct(r.percent ?? r.result?.percent)} · ${n(r.correct ?? r.result?.correct)} صحيحة`}
                    </small>
                  </div>
                  <button
                    className="edu-button secondary"
                    onClick={() => open(r.id)}
                  >
                    {r.status === "active" ? "استكمال" : "عرض النتيجة"}
                  </button>
                </div>
              ))}
            </section>
          </StudentLoading>
        ) : view === "analytics" ? (
          <StudentLoading query={analytics}>
            <section className="edu-card">
              <h2>مهاراتك في التأسيس</h2>
              <p>تحليل تدريبات LootBot الأصلية، منفصل عن نتائج المفكر.</p>
              {analytics.data?.skills?.map((s: Row) => (
                <div key={s.skill || s.id} className="edu-row">
                  <div>
                    <b>{s.skill || s.title}</b>
                    <small>
                      {n(s.answered)} إجابة · {pct(s.accuracy)} دقة
                    </small>
                  </div>
                  <span>{n(s.correct)} صحيحة</span>
                </div>
              ))}
              {!analytics.data?.skills?.length && (
                <p className="edu-empty">لا توجد إجابات كافية للتحليل بعد.</p>
              )}
            </section>
          </StudentLoading>
        ) : (
          <>
            <div className="sa-section-head">
              <div>
                <span className="sa-overline">أساس متين، تدريب واعٍ</span>
                <h2>{selected?.title || "اختر مسارك"}</h2>
                <p className="edu-note">
                  دروس وتمارين تأسيسية أصلية من LootBot. ليست نماذج رسمية أو
                  ضمانًا لدرجة.
                </p>
              </div>
              {selected && (
                <button
                  className="edu-button secondary"
                  onClick={() => {
                    setTrack("");
                    setLesson(null);
                  }}
                >
                  كل المسارات <ArrowLeft size={16} />
                </button>
              )}
            </div>
            {!selected ? (
              <>
                <label className="sa-search">
                  <span>ابحث عن درس أو مهارة</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="نسب، قراءة، كيمياء…"
                  />
                </label>
                <div className="sa-track-grid">
                  {filtered.map((t, i) => (
                    <article
                      className="edu-card sa-track"
                      key={t.id}
                      style={
                        {
                          "--sa-track":
                            (
                              {
                                violet: "#b19aff",
                                sky: "#8bc6f5",
                                mint: "#83ddc2",
                                emerald: "#83ddc2",
                                amber: "#edc18a",
                                rose: "#eca8c1",
                              } as Record<string, string>
                            )[t.color] ||
                            t.color ||
                            "#aa92ff",
                        } as CSSProperties
                      }
                    >
                      <span className="sa-track-num">0{i + 1}</span>
                      <div className="sa-track-icon">
                        <BookOpen size={30} />
                      </div>
                      <h3>{t.title}</h3>
                      <p>{t.description}</p>
                      <div className="sa-track-meta">
                        <span>{n(t.lessons.length)} دروس</span>
                        <span>{n(t.questionCount)} تمرينًا</span>
                      </div>
                      <div className="edu-progress">
                        <span
                          style={{
                            width:
                              ((t.completedLessons || 0) /
                                Math.max(1, t.lessons.length)) *
                                100 +
                              "%",
                          }}
                        />
                      </div>
                      <button
                        className="edu-button secondary"
                        onClick={() => setTrack(t.id)}
                      >
                        استكشف المسار <ArrowLeft size={16} />
                      </button>
                    </article>
                  ))}
                </div>
                {!filtered.length && (
                  <p className="edu-empty">لم نجد درسًا بهذا الاسم.</p>
                )}
              </>
            ) : (
              <>
                <section className="edu-card sa-practice-config">
                  <div>
                    <h3>جلسة تدريب على المسار</h3>
                    <p>
                      اختر تدريبًا بلا وقت أو مؤقتًا أو محاكاة داخلية بوقت وعدد
                      تختارهما.
                    </p>
                  </div>
                  <label>
                    الوضع
                    <select
                      value={mode}
                      onChange={(e) => setMode(e.target.value)}
                    >
                      <option value="untimed">تدريب هادئ</option>
                      <option value="timed">تدريب بمؤقت</option>
                      <option value="simulation">محاكاة تدريبية داخلية</option>
                    </select>
                  </label>
                  <label>
                    عدد الأسئلة
                    <input
                      type="number"
                      min="1"
                      max={Math.min(40, selected.questionCount)}
                      value={count}
                      onChange={(e) => setCount(Number(e.target.value))}
                    />
                  </label>
                  {mode !== "untimed" && (
                    <label>
                      المدة بالدقائق
                      <input
                        type="number"
                        min="1"
                        max="120"
                        value={minutes}
                        onChange={(e) => setMinutes(Number(e.target.value))}
                      />
                    </label>
                  )}
                  <button
                    className="edu-button"
                    disabled={busy}
                    onClick={() => void start(selected.id)}
                  >
                    <Play size={16} />
                    ابدأ التدريب
                  </button>
                </section>
                <div className="sa-lesson-grid">
                  {selected.lessons.map((l: Row, i: number) => (
                    <button
                      className="edu-card sa-lesson"
                      key={l.id}
                      onClick={() => setLesson(l)}
                    >
                      <span className="sa-lesson-index">
                        {l.completed ? <Check size={20} /> : n(i + 1)}
                      </span>
                      <span>
                        <b>{l.title}</b>
                        <small>{l.summary}</small>
                        <span className="sa-track-meta">
                          <span>
                            <Clock size={13} />
                            {n(l.minutes)} دقائق
                          </span>
                          <span>{n(l.questionCount)} تمارين</span>
                          {l.completed && (
                            <span>اجتزته · أفضل نتيجة {pct(l.bestScore)}</span>
                          )}
                        </span>
                      </span>
                      <ChevronLeft size={20} />
                    </button>
                  ))}
                </div>
                {lesson && (
                  <section
                    className="edu-card sa-reader"
                    aria-label="محتوى الدرس"
                  >
                    <div className="sa-section-head">
                      <span className="sa-overline">{lesson.skill}</span>
                      <button
                        className="edu-button secondary"
                        onClick={() => {
                          setLesson(null);
                          window.speechSynthesis?.cancel();
                        }}
                        aria-label="إغلاق الدرس"
                      >
                        <X size={17} />
                      </button>
                    </div>
                    <h2>{lesson.title}</h2>
                    {lesson.blocks.map((b: Row, i: number) => (
                      <section key={i}>
                        <h3>{b.title}</h3>
                        <p>{b.text}</p>
                      </section>
                    ))}
                    {lesson.audioScript && (
                      <Listening script={lesson.audioScript} />
                    )}
                    <aside className="sa-example">
                      <h3>مثال محلول</h3>
                      <p>{lesson.example.prompt}</p>
                      <p>{lesson.example.solution}</p>
                    </aside>
                    <button
                      className="edu-button"
                      disabled={busy}
                      onClick={() => void start(selected.id, lesson.id)}
                    >
                      طبّق ما تعلمته <ArrowLeft size={17} />
                    </button>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </StudentLoading>
    </div>
  );
}
export function Listening({ script }: { script: string }) {
  const [message, setMessage] = useState("");
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  return (
    <aside className="sa-example" dir="ltr">
      <h3>
        <Headphones size={18} /> Listening practice
      </h3>
      <button
        className="edu-button secondary"
        onClick={() => {
          if (!("speechSynthesis" in window)) {
            setMessage("الصوت غير متاح في هذا المتصفح؛ استخدم النص التدريبي.");
            return;
          }
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(script);
          utterance.lang = "en-US";
          utterance.rate = 0.85;
          utterance.onerror = () =>
            setMessage("تعذّر الصوت؛ يمكنك قراءة النص التدريبي.");
          window.speechSynthesis.speak(utterance);
          setMessage("صوت آلي للتدريب من متصفحك.");
        }}
      >
        <Play size={15} />
        تشغيل النص التدريبي
      </button>
      <details>
        <summary>عرض نص الاستماع</summary>
        <p>{script}</p>
      </details>
      {message && (
        <p role="status" dir="rtl">
          {message}
        </p>
      )}
    </aside>
  );
}
function AcademyAttempt({ id, close }: { id: string; close: () => void }) {
  const q = useAcademy("/attempts/" + id),
    qc = useQueryClient(),
    [answers, setAnswers] = useState<Record<string, number>>({}),
    [index, setIndex] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [tick, setTick] = useState(Date.now()),
    [filter, setFilter] = useState("all"),
    [confirmSubmit, setConfirmSubmit] = useState(false);
  const loaded = useRef("");
  useEffect(() => {
    if (q.data && loaded.current !== id) {
      loaded.current = id;
      setAnswers(q.data.answers || {});
    }
  }, [q.data, id]);
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const data = q.data,
    questions: Row[] = data?.questions || [],
    question = questions[index],
    result = data?.result;
  const offset = data?.serverTime
    ? new Date(data.serverTime).getTime() - q.dataUpdatedAt
    : 0;
  const left = data?.deadlineAt
    ? Math.max(
        0,
        Math.ceil((new Date(data.deadlineAt).getTime() - tick - offset) / 1000),
      )
    : null;
  async function save(finish = false) {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      await academyApi(`/attempts/${id}/answers`, "PUT", {
        revision: data.revision,
        answers,
      });
      if (finish) await academyApi(`/attempts/${id}/finish`, "POST", {});
      await q.refetch();
      if (finish) {
        await qc.invalidateQueries({ queryKey: ["student-academy"] });
        window.scrollTo(0, 0);
      }
    } catch (e) {
      setError((e as Error).message);
      const refreshed = await q.refetch();
      if ((e as { status?: number }).status === 409 && refreshed.data)
        setAnswers(refreshed.data.answers || {});
    } finally {
      setBusy(false);
    }
  }
  async function choose(value: number) {
    if (busy || !question) return;
    const next = { ...answers, [question.id]: value };
    setAnswers(next);
    setBusy(true);
    setError("");
    try {
      const r = await academyApi(`/attempts/${id}/answers`, "PUT", {
        revision: data?.revision,
        answers: next,
      });
      qc.setQueryData(["student-academy", "/attempts/" + id], r);
    } catch (e) {
      setError((e as Error).message);
      const refreshed = await q.refetch();
      if ((e as { status?: number }).status === 409 && refreshed.data)
        setAnswers(refreshed.data.answers || {});
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (left === 0 && data?.status === "active" && !busy) void q.refetch();
  }, [left, data?.status, busy]);
  return (
    <div className="sa-workspace">
      <Dialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
        <DialogContent dir="rtl">
          <DialogTitle>تسليم التدريب؟</DialogTitle>
          <DialogDescription>
            أجبت عن {n(Object.keys(answers).length)} من {n(questions.length)}{" "}
            أسئلة. بعد التسليم تظهر النتيجة وتفاصيل المراجعة.
          </DialogDescription>
          <DialogFooter>
            <button
              className="edu-button secondary"
              onClick={() => setConfirmSubmit(false)}
            >
              أكمل الحل
            </button>
            <button
              className="edu-button"
              disabled={busy}
              onClick={() => {
                setConfirmSubmit(false);
                void save(true);
              }}
            >
              تأكيد التسليم
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <StudentLoading query={q}>
        {data && (
          <>
            <div className="sa-section-head">
              <div>
                <span className="sa-overline">تدريب LootBot الأصلي</span>
                <h2>{data.title}</h2>
              </div>
              <button
                className="edu-button secondary"
                disabled={busy}
                onClick={close}
              >
                {result ? "العودة للمسارات" : "خروج واستكمال لاحقًا"}
                <ArrowLeft size={16} />
              </button>
            </div>
            {error && (
              <p role="alert" className="edu-notice edu-error">
                {error}
              </p>
            )}
            {result ? (
              <>
                <section className="edu-card sa-result">
                  <span className="sa-result-score">{pct(result.percent)}</span>
                  <div>
                    <h2>هذه نتيجتك، وخطوتك التالية.</h2>
                    <p>
                      {n(result.correct)} صحيحة · {n(result.wrong)} خاطئة ·{" "}
                      {n(result.unanswered)} دون إجابة
                    </p>
                    <p>
                      {n(Math.round(result.elapsedSec / 60))} دقيقة تدريب.
                      الأخطاء محفوظة للمراجعة.
                    </p>
                  </div>
                </section>
                <div className="edu-tabs" aria-label="تصفية مراجعة الإجابات">
                  {[
                    ["all", "كل الأسئلة"],
                    ["wrong", "الأخطاء والمتروك"],
                    ["correct", "الصحيحة"],
                  ].map(([key, title]) => (
                    <button
                      className="edu-button secondary"
                      aria-pressed={filter === key}
                      onClick={() => setFilter(key)}
                      key={key}
                    >
                      {title}
                    </button>
                  ))}
                </div>
                {result.items
                  .filter(
                    (r: Row) =>
                      filter === "all" ||
                      (filter === "wrong" ? !r.isCorrect : r.isCorrect),
                  )
                  .map((r: Row, i: number) => (
                    <article className="edu-card sa-review" key={r.questionId}>
                      <span
                        className={
                          "sa-pill " + (r.isCorrect ? "correct" : "wrong")
                        }
                      >
                        {r.isCorrect
                          ? "إجابة صحيحة"
                          : r.selected == null
                            ? "دون إجابة"
                            : "تحتاج مراجعة"}
                      </span>
                      <h3>
                        {n(i + 1)}. {r.text}
                      </h3>
                      <p>
                        إجابتك:{" "}
                        {r.selected == null ? "لم تجب" : r.options[r.selected]}
                      </p>
                      <p>
                        الصحيحة: <b>{r.options[r.correctIndex]}</b>
                      </p>
                      <p className="sa-explanation">{r.explanation}</p>
                      <small>شرح أصلي من LootBot · {r.skill}</small>
                    </article>
                  ))}
              </>
            ) : question ? (
              <>
                <div className="sa-attempt-bar">
                  <span>
                    السؤال {n(index + 1)} / {n(questions.length)}
                  </span>
                  <span>{n(Object.keys(answers).length)} إجابات محفوظة</span>
                  <strong role="timer">
                    {left == null
                      ? "دون مؤقت"
                      : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
                  </strong>
                </div>
                <div className="edu-progress">
                  <span
                    style={{
                      width:
                        (Object.keys(answers).length /
                          Math.max(questions.length, 1)) *
                          100 +
                        "%",
                    }}
                  />
                </div>
                <section className="edu-card sa-question">
                  <span className="sa-overline">{question.skill}</span>
                  {question.passage && (
                    <p
                      className="sa-passage"
                      dir={data.trackId === "step" ? "ltr" : "rtl"}
                    >
                      {question.passage}
                    </p>
                  )}
                  {question.audioScript && (
                    <Listening script={question.audioScript} />
                  )}
                  <h2 dir={data.trackId === "step" ? "ltr" : "rtl"}>
                    {question.text}
                  </h2>
                  <div className="sa-options">
                    {question.options.map((o: string, i: number) => (
                      <button
                        className="edu-option"
                        disabled={busy || left === 0}
                        aria-pressed={answers[question.id] === i}
                        key={i}
                        onClick={() => void choose(i)}
                      >
                        <span>{String.fromCharCode(65 + i)}</span>
                        {o}
                      </button>
                    ))}
                  </div>
                  <div className="sa-section-head">
                    <button
                      className="edu-button secondary"
                      disabled={!index || busy}
                      onClick={() => setIndex((i) => i - 1)}
                    >
                      <ChevronRight size={16} />
                      السابق
                    </button>
                    <span role="status" className="edu-note">
                      {busy ? "جار الحفظ…" : "يحفظ اختيارك بعد كل إجابة"}
                    </span>
                    <button
                      className="edu-button secondary"
                      disabled={index === questions.length - 1 || busy}
                      onClick={() => setIndex((i) => i + 1)}
                    >
                      التالي
                      <ChevronLeft size={16} />
                    </button>
                  </div>
                </section>
                <nav className="sa-question-map" aria-label="خريطة الأسئلة">
                  {questions.map((r, i) => (
                    <button
                      key={r.id}
                      aria-current={i === index ? "step" : undefined}
                      className={answers[r.id] != null ? "answered" : ""}
                      onClick={() => setIndex(i)}
                    >
                      {n(i + 1)}
                    </button>
                  ))}
                </nav>
                <button
                  className="edu-button"
                  disabled={busy}
                  onClick={() => setConfirmSubmit(true)}
                >
                  تسليم وعرض النتيجة <Check size={17} />
                </button>
              </>
            ) : (
              <p className="edu-empty">المحاولة غير متاحة.</p>
            )}
          </>
        )}
      </StudentLoading>
    </div>
  );
}
export function AcademyMistakes() {
  const q = useAcademy("/mistakes"),
    [error, setError] = useState(""),
    [only, setOnly] = useState(true),
    [search, setSearch] = useState(""),
    [attempt, setAttempt] = useState(""),
    [busy, setBusy] = useState(false);
  async function retry(trackId: string) {
    setBusy(true);
    setError("");
    try {
      const r = await academyApi("/attempts", "POST", {
        trackId,
        mode: "untimed",
        count: 10,
        mistakesOnly: true,
      });
      setAttempt(r.attemptId);
      const u = new URL(window.location.href);
      u.searchParams.set("academyAttempt", r.attemptId);
      u.searchParams.set("studentTab", "academy");
      window.history.replaceState(null, "", u);
      window.scrollTo(0, 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (attempt)
    return (
      <AcademyAttempt
        id={attempt}
        close={() => {
          setAttempt("");
          const u = new URL(window.location.href);
          u.searchParams.delete("academyAttempt");
          u.searchParams.set("studentTab", "mistakes");
          window.history.replaceState(null, "", u);
          void q.refetch();
        }}
      />
    );
  const rows: Row[] = (q.data?.items || []).filter(
    (r: Row) =>
      (!only || !r.mastered) &&
      (!search || [r.text, r.skill].join(" ").includes(search)),
  );
  return (
    <StudentLoading query={q}>
      <section className="edu-card">
        <div className="sa-section-head">
          <h2>أخطاء التأسيس</h2>
          <span className="sa-pill">تُحفظ تلقائيًا بعد التسليم</span>
        </div>
        <div className="edu-form">
          <label>
            ابحث في أسئلتك
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label className="sa-check">
            <input
              type="checkbox"
              checked={only}
              onChange={(e) => setOnly(e.target.checked)}
            />
            ما يحتاج مراجعة فقط
          </label>
        </div>
        {error && (
          <p role="alert" className="edu-error">
            {error}
          </p>
        )}
        {rows.map((r: Row) => (
          <article className="sa-notebook-item" key={r.id}>
            <span className="sa-overline">
              {r.skill} · {n(r.wrongCount)} مرات تحتاج مراجعة
            </span>
            <h3>{r.text}</h3>
            <details>
              <summary>الإجابة والشرح الأصلي</summary>
              <p>{r.options[r.correctIndex]}</p>
              <p>{r.explanation}</p>
            </details>
            <div className="edu-actions">
              <button
                className="edu-button secondary"
                disabled={busy}
                onClick={async () => {
                  setError("");
                  setBusy(true);
                  try {
                    await academyApi("/mistakes/" + r.id + "/review", "POST", {
                      mastered: !r.mastered,
                    });
                    await q.refetch();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {r.mastered ? "إعادة للمراجعة" : "راجعتها وفهمتها"}
              </button>
              {!r.mastered && (
                <button
                  className="edu-button"
                  disabled={busy}
                  onClick={() => void retry(r.trackId)}
                >
                  <RotateCcw size={16} />
                  تدرّب على أخطاء هذا المسار
                </button>
              )}
            </div>
          </article>
        ))}
        {!rows.length && (
          <p className="edu-empty">
            {q.data?.items?.length
              ? "لا توجد أسئلة مطابقة للبحث والتصفية."
              : "أخطاؤك في تدريبات التأسيس تظهر هنا تلقائيًا بعد التسليم."}
          </p>
        )}
      </section>
    </StudentLoading>
  );
}
function escapeHtml(s: unknown) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function StudentDownloads() {
  const q = useAcademy("/catalog/offline");
  const [message, setMessage] = useState("");
  function download(track: Row) {
    const lessons = track.lessons || [];
    const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(track.title)} — LootBot</title><style>body{margin:0;background:#101727;color:#f2f4ff;font:17px/1.9 system-ui;padding:clamp(18px,5vw,65px);max-width:950px;margin:auto}article,aside{padding:25px;border:1px solid #6e718b;border-radius:18px;margin:20px 0;background:#1b253b}h1,h2{color:#c6b5ff}summary{cursor:pointer;color:#8ce4d2}a{color:#8ce4d2}@media print{body{background:white;color:black}article{break-inside:avoid}}</style><h1>${escapeHtml(track.title)}</h1><p>مكتبة LootBot الأصلية · نسخة محفوظة تعمل دون إنترنت · ${new Date().toLocaleDateString("ar-SA")}</p><p>هذه دروس تأسيسية. لا تتضمن أسئلة المفكر أو بيانات حسابك، والتقدم هنا لا يتزامن مع الموقع.</p>${lessons.map((l: Row) => `<article><h2>${escapeHtml(l.title)}</h2>${(l.blocks || []).map((b: Row) => `<h3>${escapeHtml(b.title)}</h3><p>${escapeHtml(b.text)}</p>`).join("")}${l.audioScript ? `<p dir="ltr">${escapeHtml(l.audioScript)}</p>` : ""}<aside><h3>طبّق على المثال</h3><p>${escapeHtml(l.example?.prompt)}</p><details><summary>تحقق من الحل</summary><p>${escapeHtml(l.example?.solution)}</p></details></aside></article>`).join("")}<p>LootBot · تعلم واعٍ، في أي مكان.</p></html>`;
    saveDownload(
      `lootbot-${track.id}-offline.html`,
      html,
      "text/html;charset=utf-8",
    );
    setMessage(
      `حُمّلت دروس ${track.title}. افتح ملف HTML من التنزيلات في متصفحك دون إنترنت.`,
    );
  }
  return (
    <StudentLoading query={q}>
      <div className="sa-workspace">
        <section className="edu-card">
          <Download size={30} />
          <h2>معرفتك معك، حتى دون اتصال.</h2>
          <p>
            نزّل حزمة دروس أصلية مع أمثلة محلولة في ملف مستقل. لا تحتاج تسجيل
            دخول عند فتحه، ولا يحتوي بياناتك أو محتوى المفكر المحمي.
          </p>
          <p className="edu-note">
            الاختبارات وحفظ النتائج والغرف تحتاج إنترنت. الملفات المحمّلة
            للمراجعة والقراءة والتطبيق الذاتي.
          </p>
          {message && (
            <p role="status" className="edu-notice">
              {message}
            </p>
          )}
        </section>
        <div className="sa-track-grid">
          {q.data?.tracks?.map((t: Row) => (
            <article className="edu-card" key={t.id}>
              <BookOpen size={25} />
              <h3>{t.title}</h3>
              <p>{n(t.lessons?.length)} دروس مع الأمثلة</p>
              <button
                className="edu-button secondary"
                onClick={() => download(t)}
              >
                <Download size={17} />
                تنزيل للاستخدام دون إنترنت
              </button>
            </article>
          ))}
        </div>
      </div>
    </StudentLoading>
  );
}
