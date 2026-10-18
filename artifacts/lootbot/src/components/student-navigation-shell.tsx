import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  ChartNoAxesCombined,
  House,
  Layers,
  Target,
  Menu,
  X,
  Flame,
  Clock,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import {
  useAcademy,
  useStudy,
  studyApi,
  studentNumber as n,
  type AcademyRow as Row,
} from "./student-academy-api";
import { teacherApi } from "../lib/teacher-api";
import { quantApi } from "./quant/api";
const StudentLearning = lazy(() =>
  import("./teacher-learning").then((m) => ({ default: m.StudentLearning })),
);
export const STUDENT_HUBS = [
  { key: "home", label: "مساحتي اليومية", icon: House, sections: ["home"] },
  {
    key: "learn-hub",
    label: "التعلّم والتدريب",
    icon: BookOpen,
    sections: ["academy", "aptitude", "class-activities", "downloads"],
  },
  {
    key: "review-hub",
    label: "المراجعة والإتقان",
    icon: Layers,
    sections: ["mistakes", "bookmarks", "flashcards"],
  },
  {
    key: "progress-hub",
    label: "تحليلي وإنجازاتي",
    icon: ChartNoAxesCombined,
    sections: [
      "foundation-progress",
      "foundation-history",
      "history",
      "progress",
      "achievements",
    ],
  },
  {
    key: "study-hub",
    label: "خطتي وغرف المذاكرة",
    icon: Target,
    sections: ["plan", "goals", "rooms", "help"],
  },
];
const names: Record<string, string> = {
  home: "مساحتي",
  academy: "مسارات التأسيس",
  aptitude: "أقسام المفكر",
  "class-activities": "أنشطة المعلم ومختبر الكيمياء",
  downloads: "مكتبتي دون إنترنت",
  mistakes: "دفتر أخطائي",
  bookmarks: "أسئلتي المحفوظة",
  flashcards: "البطاقات السريعة",
  "foundation-progress": "تحليل مهاراتي",
  "foundation-history": "نتائج التأسيس",
  history: "سجل محاولاتي",
  progress: "تحليل الكمي",
  achievements: "السلسلة والأوسمة",
  plan: "خطة اليوم والتركيز",
  goals: "الأهداف والخطة",
  rooms: "غرف المذاكرة والتحديات",
  help: "المساعدة",
};
export const studentHubDestination = (key: string) =>
  STUDENT_HUBS.find((h) => h.key === key)?.sections[0] ?? key;
export function StudentHubNavigation({
  section,
  search,
  navigate,
}: {
  section: string;
  search: string;
  navigate: (key: string) => void;
}) {
  const hub = STUDENT_HUBS.find((h) => h.sections.includes(section));
  return (
    <>
      <div className="ws-hub-nav">
        {STUDENT_HUBS.filter(
          (h) =>
            !search ||
            [h.label, ...h.sections.map((s) => names[s])].some((n) =>
              n?.includes(search),
            ),
        ).map((h) => (
          <button
            key={h.key}
            aria-current={h.key === hub?.key ? "page" : undefined}
            onClick={() => navigate(h.sections[0])}
          >
            <h.icon size={19} />
            {h.label}
          </button>
        ))}
      </div>
      <details className="ws-quick-nav" open>
        <summary>وصول سريع إلى جميع الأقسام</summary>
        <nav aria-label="أقسام الطالب الفرعية">
          {Object.entries(names)
            .filter(([, label]) => label.includes(search))
            .map(([key, label]) => (
              <button
                key={key}
                aria-current={key === section ? "page" : undefined}
                onClick={() => navigate(key)}
              >
                {label}
              </button>
            ))}
        </nav>
      </details>
    </>
  );
}
export function StudentContextTabs({
  section,
  navigate,
}: {
  section: string;
  navigate: (key: string) => void;
}) {
  const hub = STUDENT_HUBS.find((h) => h.sections.includes(section));
  return (
    <nav className="ws-subtabs" aria-label="تبويبات محور الطالب">
      {hub?.sections
        .filter((k) => k !== "goals")
        .map((key) => (
          <button
            key={key}
            aria-label={`تبويب ${names[key]}`}
            aria-current={key === section ? "page" : undefined}
            onClick={() => navigate(key)}
          >
            {names[key]}
          </button>
        ))}
    </nav>
  );
}
export function StudentMobileBottomDock({
  section,
  navigate,
}: {
  section: string;
  navigate: (key: string) => void;
}) {
  const [more, setMore] = useState(false),
    hub = STUDENT_HUBS.find((h) => h.sections.includes(section));
  return (
    <>
      <nav
        className="ws-mobile-dock ws-student-dock"
        aria-label="محاور غرفة الطالب"
      >
        {STUDENT_HUBS.map((h, i) => (
          <button
            key={h.key}
            aria-current={hub?.key === h.key ? "page" : undefined}
            onClick={() => navigate(h.sections[0])}
          >
            <h.icon size={19} />
            {["يومي", "التعلّم", "المراجعة", "تحليلي", "خطتي"][i]}
          </button>
        ))}
        <button onClick={() => setMore(true)}>
          <Menu size={19} />
          المزيد
        </button>
      </nav>
      <Dialog open={more} onOpenChange={setMore}>
        <DialogContent className="edu-room ws-student-more" dir="rtl">
          <DialogTitle>أقسام غرفة الطالب</DialogTitle>
          <DialogDescription>
            انتقل لأي قسم مع الاحتفاظ بتقدمك.
          </DialogDescription>
          <div style={{ maxHeight: "65dvh", overflow: "auto" }}>
            <StudentHubNavigation
              section={section}
              search=""
              navigate={(key) => {
                navigate(key);
                setMore(false);
              }}
            />
          </div>
          <button
            className="edu-button secondary"
            onClick={() => setMore(false)}
          >
            إغلاق
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function FloatingFocusBar() {
  const q = useStudy("/overview"),
    qc = useQueryClient(),
    [now, setNow] = useState(Date.now()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const d = q.data,
    focus = d?.activeFocus,
    offset = d ? new Date(d.serverNow).getTime() - q.dataUpdatedAt : 0,
    left = focus
      ? Math.max(
          0,
          Math.ceil((new Date(focus.endsAt).getTime() - now - offset) / 1000),
        )
      : 0;
  async function act(action: "start" | "complete" | "cancel") {
    setBusy(true);
    setError("");
    try {
      await studyApi(
        action === "start" ? "/focus/start" : `/focus/${focus.id}/${action}`,
        "POST",
        action === "start"
          ? { minutes: 25, requestId: crypto.randomUUID() }
          : {},
      );
      await qc.invalidateQueries({ queryKey: ["student-study"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (q.error)
    return (
      <p className="edu-notice" role="status">
        تعذر تحميل مؤقت التركيز.{" "}
        <button onClick={() => void q.refetch()}>إعادة المحاولة</button>
      </p>
    );
  return (
    <div className="ws-focus-bar" aria-label="جلسة التركيز المستمرة">
      <Clock size={17} />
      {focus ? (
        <>
          <strong aria-label="الوقت المتبقي للتركيز">
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </strong>
          <progress
            aria-label="تقدم جلسة التركيز"
            max={100}
            value={Math.max(
              0,
              Math.min(
                100,
                100 *
                  (1 -
                    left /
                      Math.max(
                        1,
                        (new Date(focus.endsAt).getTime() -
                          new Date(focus.startedAt).getTime()) /
                          1000,
                      )),
              ),
            )}
          />
          <button
            className="edu-button secondary"
            disabled={busy || left > 0}
            onClick={() => void act("complete")}
          >
            إتمام الجلسة
          </button>
          <button
            className="edu-button secondary"
            disabled={busy}
            onClick={() => void act("cancel")}
          >
            إلغاء
          </button>
        </>
      ) : (
        <button
          className="edu-button secondary"
          disabled={busy || !d}
          onClick={() => void act("start")}
        >
          ابدأ 25 دقيقة تركيز
        </button>
      )}
      <span className="ws-streak">
        <Flame size={15} />
        {n(d?.stats?.streakDays ?? 0)} أيام متتابعة
      </span>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
export function DailySmartQuestCard({
  navigate,
}: {
  navigate: (key: string) => void;
}) {
  const catalog = useAcademy("/catalog"),
    study = useStudy("/overview"),
    school = useQuery({
      queryKey: ["education", "/student-home"],
      queryFn: () => teacherApi<Row>("/education/student-home"),
    }),
    mistakes = useAcademy("/mistakes"),
    quantMistakes = useQuery({
      queryKey: ["quant", "daily-notebook"],
      queryFn: () => quantApi("/notebook?status=pending"),
      retry: false,
    });
  const stats = catalog.data?.stats,
    skills = school.data?.progress?.skills ?? [],
    schoolAnswers = skills.reduce((sum: number, s: Row) => sum + s.attempts, 0),
    schoolCorrect = skills.reduce((sum: number, s: Row) => sum + s.correct, 0),
    answered = (stats?.answered ?? 0) + schoolAnswers,
    correct = (stats?.correct ?? 0) + schoolCorrect;
  const unresolved = mistakes.data?.items ?? mistakes.data ?? [];
  const academyMistakeCount = Array.isArray(unresolved)
    ? unresolved.filter(
        (m: Row) => !m.resolvedAt && !m.resolved_at && !m.mastered,
      ).length
    : 0;
  const mistakeCount =
    academyMistakeCount + (quantMistakes.data?.summary?.pending ?? 0);
  const tasks =
    (school.data?.tasks ?? []).filter((t: Row) => t.status === "pending")
      .length + (school.data?.activities?.length ?? 0);
  const next = catalog.data?.recommendations?.[0];
  return (
    <>
      <div className="ws-kpis">
        <article>
          <strong>
            {study.data ? n(study.data.stats?.streakDays ?? 0) : "—"}
          </strong>
          <span>
            أيام السلسلة · {n(study.data?.stats?.focusMinutesToday ?? 0)} دقيقة
            تركيز اليوم
          </span>
        </article>
        <article>
          <strong>
            {answered ? n(Math.round((100 * correct) / answered)) + "٪" : "—"}
          </strong>
          <span>دقة إجابات التأسيس والأنشطة المسجلة</span>
        </article>
        <article>
          <strong>
            {mistakes.data || quantMistakes.data ? n(mistakeCount) : "—"}
          </strong>
          <span>أخطاء المفكر والتأسيس التي تنتظر المراجعة</span>
          <button
            className="edu-button secondary"
            onClick={() => navigate("mistakes")}
          >
            راجعها الآن
          </button>
        </article>
        <article>
          <strong>{school.data ? n(tasks) : "—"}</strong>
          <span>مهام وأنشطة الفصل المتاحة</span>
          <button
            className="edu-button secondary"
            onClick={() => navigate("class-activities")}
          >
            أنشطة فصلي
          </button>
        </article>
      </div>
      <section className="ws-quest">
        <span className="sa-overline">مساحتك اليومية</span>
        <h2>مهمتك الذكية اليوم</h2>
        <p>ثلاث خطوات من تقدمك المسجل؛ ابدأ بما يناسب وقتك.</p>
        <ol>
          <li>
            <strong>1 · تعلّم شيئًا واضحًا</strong>
            <small>
              {next?.title ||
                next?.lessonTitle ||
                "اختر درس تأسيس من المسارات المتاحة"}
            </small>
            <button
              className="edu-button"
              onClick={() => {
                navigate("academy");
                if (next?.lessonId && next?.trackId) {
                  const url = new URL(location.href);
                  url.searchParams.set("academyLesson", next.lessonId);
                  url.searchParams.set("academyTrack", next.trackId);
                  history.replaceState(history.state, "", url);
                  window.dispatchEvent(new Event("academy:lesson"));
                }
              }}
            >
              فتح مسارات التأسيس
            </button>
          </li>
          <li>
            <strong>2 · راجع ما فاتك</strong>
            <small>
              {mistakeCount
                ? `ابدأ بمراجعة ${Math.min(2, mistakeCount)} من أخطائك`
                : "لا أخطاء مسجلة للمراجعة الآن"}
            </small>
            <button
              className="edu-button secondary"
              onClick={() => navigate(mistakeCount ? "mistakes" : "bookmarks")}
            >
              {mistakeCount ? "دفتر أخطائي" : "أسئلتي المحفوظة"}
            </button>
          </li>
          <li>
            <strong>3 · امنح نفسك وقتًا</strong>
            <small>
              {study.data?.activeFocus
                ? "جلسة تركيزك الحالية ظاهرة أعلى الصفحة"
                : "ابدأ جلسة تركيز أو أكمل مهمة اليوم"}
            </small>
            <button
              className="edu-button secondary"
              onClick={() => navigate("plan")}
            >
              خطتي اليوم
            </button>
          </li>
        </ol>
      </section>
    </>
  );
}
export function ClassActivitiesTab() {
  const q = useQuery({
      queryKey: ["education", "/student-home"],
      queryFn: () => teacherApi<Row>("/education/student-home"),
    }),
    [assignment, setAssignment] = useState(
      new URLSearchParams(location.search).get("activity") ?? "",
    );
  function open(id: string, enrollment: string) {
    setAssignment(id);
    const u = new URL(location.href);
    u.searchParams.set("activity", id);
    u.searchParams.set("enrollmentId", enrollment);
    history.pushState(history.state, "", u);
  }
  useEffect(() => {
    const sync = () =>
      setAssignment(new URLSearchParams(location.search).get("activity") ?? "");
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  return (
    <section className="sa-workspace">
      <h2>أنشطة المعلم ومختبر الكيمياء</h2>
      <p className="edu-note">
        تظهر الأنشطة المسندة لفصولك المرتبطة فقط. تبقى المحاولات محفوظة في
        الأنظمة الحالية.
      </p>
      {assignment ? (
        <>
          <button
            className="edu-button secondary"
            onClick={() => {
              setAssignment("");
              const u = new URL(location.href);
              u.searchParams.delete("activity");
              u.searchParams.delete("enrollmentId");
              history.pushState(history.state, "", u);
            }}
          >
            العودة لأنشطة الفصل
          </button>
          <Suspense fallback={<p role="status">جار تحميل النشاط…</p>}>
            <StudentLearning
              embedded
              assignmentId={assignment}
              onExit={() => {
                setAssignment("");
                const u = new URL(location.href);
                u.searchParams.delete("activity");
                u.searchParams.delete("enrollmentId");
                history.pushState(history.state, "", u);
              }}
            />
          </Suspense>
        </>
      ) : (
        <>
          {q.isPending ? (
            <p role="status">جار تحميل أنشطة الفصل…</p>
          ) : q.error ? (
            <p role="alert">{q.error.message}</p>
          ) : (
            <div className="edu-grid">
              {q.data?.activities?.map((a: Row) => (
                <article className="edu-card" key={a.id}>
                  <BookOpen />
                  <h3>{a.title}</h3>
                  <p>
                    {a.due_at
                      ? "التسليم: " +
                        new Date(a.due_at).toLocaleDateString("ar-SA")
                      : "دون موعد تسليم محدد"}
                  </p>
                  <button
                    className="edu-button"
                    onClick={() => open(a.id, a.enrollment_id)}
                  >
                    فتح النشاط داخل غرفتي
                  </button>
                </article>
              ))}
              {!q.data?.activities?.length && (
                <p className="edu-empty">لا توجد أنشطة مسندة لفصلك الآن.</p>
              )}
            </div>
          )}
          <details className="edu-card">
            <summary>الدخول برمز نشاط أو جلسة طالب محفوظة</summary>
            <Suspense fallback={<p role="status">جار تحميل بوابة الأنشطة…</p>}>
              <StudentLearning embedded />
            </Suspense>
          </details>
        </>
      )}
    </section>
  );
}
