import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Clock,
  Shuffle,
  Plus,
  Play,
  Pause,
  RotateCcw,
  Check,
  Target,
} from "lucide-react";
import {
  teacherApi,
  type TeacherStudent,
  type TeacherGrade,
  type AttendanceEntry,
  type TeacherTask,
} from "../lib/teacher-api";
import {
  createExamDocument,
  newQuestion,
  newSection,
} from "../lib/teacher-exam-model";
import { newLessonStep, type StepLesson } from "../lib/step-lesson-model";
import { PresentLesson } from "./teacher-learning";
import {
  useActiveTeacherClass,
  teacherClassPath,
} from "./teacher-navigation-shell";
import type { TeacherQuestion } from "../lib/teacher-api";
const day = () => new Date().toLocaleDateString("en-CA");
const n = (value: number) => new Intl.NumberFormat("ar-SA").format(value);
function useRecords<T>(resource: string, classId = "") {
  return useQuery({
    queryKey: ["teacher", "workspace-" + resource, classId],
    queryFn: () =>
      teacherApi<T>(
        "/teacher/" +
          resource +
          (classId ? "?classId=" + encodeURIComponent(classId) : ""),
      ),
    staleTime: 10000,
  });
}
function gradePercent(g: TeacherGrade) {
  return g.marks === null || g.status === "exempt" || g.totalMarks <= 0
    ? null
    : (100 * g.marks) / g.totalMarks;
}
function average(grades: TeacherGrade[]) {
  const values = grades
    .map(gradePercent)
    .filter((v): v is number => v !== null);
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}
export function LiveClassroomCockpit() {
  const [classId] = useActiveTeacherClass(),
    qc = useQueryClient(),
    [now, setNow] = useState(Date.now()),
    [minutes, setMinutes] = useState(45),
    [endsAt, setEndsAt] = useState<number | null>(null),
    [paused, setPaused] = useState(45 * 60),
    [sound, setSound] = useState(false),
    [picked, setPicked] = useState(""),
    [used, setUsed] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [lessonId, setLessonId] = useState(""),
    [present, setPresent] = useState(false);
  const students = useRecords<TeacherStudent[]>("students", classId),
    attendance = useRecords<AttendanceEntry[]>("attendance", classId),
    grades = useRecords<TeacherGrade[]>("grades", classId),
    lessons = useRecords<StepLesson[]>("learning/activities");
  const active = (students.data ?? []).filter(
      (s) => !s.archived && s.classId === classId,
    ),
    date = day(),
    current = attendance.data?.filter((e) => e.date === date) ?? [],
    left = endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : paused;
  const beeped = useRef(false),
    audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setPicked("");
    setUsed([]);
    setEndsAt(null);
    setPaused(minutes * 60);
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("tw-live:" + classId) || "null",
      );
      if (
        saved &&
        Number.isFinite(saved.minutes) &&
        saved.minutes >= 1 &&
        saved.minutes <= 180
      ) {
        setMinutes(saved.minutes);
        if (Number.isFinite(saved.endsAt)) setEndsAt(saved.endsAt);
        setPaused(
          Number.isFinite(saved.paused)
            ? Math.max(0, saved.paused)
            : saved.minutes * 60,
        );
      }
    } catch {
      /* Fresh timer when saved state cannot be read. */
    }
  }, [classId]);
  useEffect(() => {
    try {
      if (classId)
        sessionStorage.setItem(
          "tw-live:" + classId,
          JSON.stringify({ endsAt, minutes, paused }),
        );
    } catch {
      /* Timer still works in this tab. */
    }
  }, [classId, endsAt, minutes, paused]);
  useEffect(() => {
    if (endsAt && left === 0 && !beeped.current) {
      beeped.current = true;
      setNotice("انتهى وقت الحصة. يمكنك حفظ المشاركة أو تمديد الوقت.");
      if (sound && audio.current) {
        try {
          const osc = audio.current.createOscillator(),
            gain = audio.current.createGain();
          osc.connect(gain);
          gain.connect(audio.current.destination);
          gain.gain.value = 0.05;
          osc.frequency.value = 660;
          osc.start();
          osc.stop(audio.current.currentTime + 0.25);
        } catch {
          /* Visual notification remains available. */
        }
      }
    }
  }, [left, endsAt, sound]);
  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["teacher"] });
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mark(studentId: string) {
    const previous = current.find((e) => e.studentId === studentId)?.status;
    const status: AttendanceEntry["status"] =
      previous === "present"
        ? "late"
        : previous === "late"
          ? "absent"
          : "present";
    await act(
      () =>
        teacherApi("/teacher/attendance", "POST", {
          classId,
          date,
          entries: [
            {
              studentId,
              status,
              note: current.find((e) => e.studentId === studentId)?.note ?? "",
            },
          ],
        }),
      "حُفظ الحضور.",
    );
  }
  function pick() {
    const candidates = active.filter((s) => !used.includes(s.id));
    if (!candidates.length) {
      setNotice("شارك الجميع؛ ابدأ دورة جديدة عندما ترغب.");
      return;
    }
    const s = candidates[Math.floor(Math.random() * candidates.length)];
    setPicked(s.id);
    setUsed((ids) => [...ids, s.id]);
  }
  async function participation() {
    const title = "مشاركة الحصة " + date;
    const old = grades.data?.find(
      (g) => g.studentId === picked && g.date === date && g.title === title,
    );
    const marks = Math.min(10, (old?.marks ?? 0) + 1);
    await act(
      () =>
        teacherApi("/teacher/grades/bulk", "POST", {
          classId,
          title,
          totalMarks: 10,
          date,
          entries: [{ studentId: picked, marks }],
        }),
      "حُفظت نقطة المشاركة في سجل الدرجات (من 10).",
    );
  }
  const lesson = lessons.data?.find((l) => l.id === lessonId);
  return (
    <>
      <div className="ws-live-grid">
        <section className="tw-card">
          <span className="tw-eyebrow">مساحة الحصة</span>
          <h2>وقت واضح، وتركيز على الطلاب</h2>
          <label>
            مدة الحصة بالدقائق
            <input
              type="number"
              min={1}
              max={180}
              value={minutes}
              onChange={(e) => {
                const v = Math.max(
                  1,
                  Math.min(180, Number(e.target.value) || 1),
                );
                setMinutes(v);
                if (!endsAt) setPaused(v * 60);
              }}
            />
          </label>
          <output className="ws-timer" aria-label="الوقت المتبقي للحصة">
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </output>
          <div className="tw-toolbar">
            <button
              className="tw-button primary"
              onClick={() => {
                beeped.current = false;
                if (endsAt) {
                  setPaused(left);
                  setEndsAt(null);
                } else setEndsAt(Date.now() + left * 1000);
              }}
            >
              {endsAt ? <Pause size={16} /> : <Play size={16} />}{" "}
              {endsAt ? "إيقاف مؤقت" : "بدء المؤقت"}
            </button>
            <button
              className="tw-button"
              onClick={() => {
                setEndsAt(null);
                setPaused(minutes * 60);
                beeped.current = false;
              }}
            >
              <RotateCcw size={16} />
              إعادة الضبط
            </button>
            <label>
              <input
                type="checkbox"
                checked={sound}
                onChange={(e) => {
                  setSound(e.target.checked);
                  if (e.target.checked) {
                    audio.current ??= new AudioContext();
                    void audio.current.resume();
                  }
                }}
              />
              تنبيه صوتي
            </label>
          </div>
        </section>
        <section className="tw-card">
          <h2>فرصة مشاركة لكل طالب</h2>
          <p className="tw-muted">
            اختيار دون تكرار داخل الحصة حتى يشارك جميع طلاب الفصل.
          </p>
          <div className="ws-timer" style={{ fontSize: 32 }}>
            {active.find((s) => s.id === picked)?.name || "من سيشارك الآن؟"}
          </div>
          <p>
            {n(used.length)} من {n(active.length)} شاركوا في الاختيار
          </p>
          <div className="tw-toolbar">
            <button
              className="tw-button primary"
              disabled={
                !classId || !active.length || used.length >= active.length
              }
              onClick={pick}
            >
              <Shuffle size={16} />
              اختيار طالب
            </button>
            <button
              className="tw-button"
              disabled={!picked || busy || grades.isPending || !!grades.error}
              onClick={() => void participation()}
            >
              <Plus size={16} />
              +1 مشاركة
            </button>
            <button
              className="tw-button"
              onClick={() => {
                setUsed([]);
                setPicked("");
              }}
            >
              دورة جديدة
            </button>
          </div>
          <p className="tw-small tw-muted">
            تُحفظ المشاركة كتقييم يومي من 10 درجات. لا تُضاف درجة دون الضغط على
            الزر.
          </p>
          {grades.error && (
            <p role="alert">
              تعذر تحميل سجل الدرجات؛ أعد تحميل الصفحة قبل رصد المشاركة.
            </p>
          )}
        </section>
        <section className="tw-card">
          <h2>الحضور السريع</h2>
          <p className="tw-muted">
            اضغط اسم الطالب للتبديل: حاضر ← متأخر ← غائب. كل تغيير يُحفظ للفصل
            والتاريخ الحاليين.
          </p>
          {attendance.error && (
            <p role="alert">
              تعذر تحميل الحضور المحفوظ؛ أعد تحميل الصفحة قبل التعديل.
            </p>
          )}
          {students.isPending ? (
            <p role="status">جار تحميل الفصل…</p>
          ) : students.error ? (
            <p role="alert">{students.error.message}</p>
          ) : !active.length ? (
            <p>اختر فصلًا يضم طلابًا نشطين.</p>
          ) : (
            <div className="ws-student-chips">
              {active.map((s) => (
                <button
                  key={s.id}
                  disabled={busy || attendance.isPending || !!attendance.error}
                  data-status={
                    current.find((e) => e.studentId === s.id)?.status
                  }
                  onClick={() => void mark(s.id)}
                >
                  {s.name}
                  <small>
                    {(
                      {
                        present: "حاضر",
                        late: "متأخر",
                        absent: "غائب",
                        excused: "غياب بعذر",
                      } as Record<string, string>
                    )[
                      current.find((e) => e.studentId === s.id)?.status ?? ""
                    ] || "غير مسجل"}
                  </small>
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="tw-card">
          <h2>عرض الدرس وبطاقة الخروج</h2>
          <>
            {lessons.error && (
              <p role="alert">تعذر تحميل الدروس. أعد تحميل الصفحة للمحاولة.</p>
            )}
          </>
          <label>
            الدرس المحفوظ
            <select
              aria-label="الدرس المحفوظ"
              value={lessonId}
              onChange={(e) => setLessonId(e.target.value)}
            >
              <option value="">اختر درسًا</option>
              {lessons.data
                ?.filter((l) => l.steps.length)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
            </select>
          </label>
          <div className="tw-toolbar">
            <button
              className="tw-button primary"
              disabled={!lesson}
              onClick={() => setPresent(true)}
            >
              عرض الدرس
            </button>
            <Link
              href={teacherClassPath("questions", classId)}
              className="tw-button"
            >
              إنشاء بطاقة خروج من بنك الأسئلة
            </Link>
            <Link
              href={teacherClassPath("activities", classId)}
              className="tw-button"
            >
              إسناد نشاط للفصل
            </Link>
          </div>
        </section>
      </div>
      {error && (
        <p className="tw-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="tw-success" role="status">
          {notice}
        </p>
      )}
      {present && lesson && (
        <PresentLesson content={lesson} onExit={() => setPresent(false)} />
      )}
    </>
  );
}
export function AtRiskRadarCard() {
  const students = useRecords<TeacherStudent[]>("students"),
    attendance = useRecords<AttendanceEntry[]>("attendance"),
    grades = useRecords<TeacherGrade[]>("grades"),
    tasks = useRecords<TeacherTask[]>("tasks");
  const cutoff = Date.now() - 7 * 86400000;
  const rows = (students.data ?? [])
    .filter((s) => !s.archived)
    .map((student) => {
      const absent = (attendance.data ?? []).filter(
        (a) =>
          a.studentId === student.id &&
          a.status === "absent" &&
          new Date(a.date ?? "").getTime() >= cutoff,
      ).length;
      const low = (grades.data ?? []).some(
        (g) =>
          g.studentId === student.id &&
          new Date(g.date).getTime() >= cutoff &&
          (gradePercent(g) ?? 100) < 60,
      );
      const missing = (tasks.data ?? []).filter(
        (t) =>
          t.classId === student.classId &&
          !t.archived &&
          t.kind === "assignment" &&
          t.dueAt &&
          new Date(t.dueAt).getTime() < Date.now() &&
          new Date(t.dueAt).getTime() >= cutoff &&
          !t.studentCompletion.includes(student.id),
      ).length;
      return { student, absent, low, missing };
    })
    .filter((r) => r.absent >= 2 || r.low || r.missing >= 2);
  return (
    <section className="tw-card tw-spaced">
      <div className="tw-toolbar">
        <Target size={22} />
        <h2>طلاب بحاجة لدعم هذا الأسبوع</h2>
      </div>
      <p className="tw-muted tw-small">
        إشارات من الحضور والدرجات والواجبات المسجلة؛ ليست حكمًا على الطالب.
      </p>
      {[students, attendance, grades, tasks].some((q) => q.error) ? (
        <p role="status">تعذر إكمال رادار المتابعة. راجع سجلات الفصل.</p>
      ) : students.isPending ? (
        <p>جار تحميل السجلات…</p>
      ) : rows.length ? (
        <div className="tw-list">
          {rows.slice(0, 8).map((r) => (
            <div className="tw-list-item" key={r.student.id}>
              <div>
                <strong>{r.student.name}</strong>
                <p>
                  {[
                    r.absent >= 2 ? `${r.absent} أيام غياب` : null,
                    r.low ? "درجة مسجلة أقل من 60٪" : null,
                    r.missing >= 2 ? `${r.missing} واجبات متأخرة` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Link
                className="tw-button"
                href={teacherClassPath("tasks", r.student.classId)}
              >
                إضافة مهمة متابعة
              </Link>
              <Link
                className="tw-button"
                href={teacherClassPath("questions", r.student.classId)}
              >
                ورقة عمل علاجية
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <p className="tw-muted">
          لا توجد إشارات متابعة مطابقة في السجلات المتاحة لهذا الأسبوع.
        </p>
      )}
    </section>
  );
}
export function ClassMasteryHeatmap({
  grades,
  students,
}: {
  grades: TeacherGrade[];
  students: TeacherStudent[];
}) {
  const [band, setBand] = useState("all");
  const rows = students.map((s) => ({
    student: s,
    percent: average(grades.filter((g) => g.studentId === s.id)),
  }));
  const group = (p: number | null) =>
    p === null
      ? "ungraded"
      : p >= 90
        ? "excellent"
        : p >= 80
          ? "very-good"
          : p >= 70
            ? "good"
            : "support";
  const scores = rows
    .map((r) => r.percent)
    .filter((v): v is number => v !== null);
  const bands = [
    ["excellent", "ممتاز", "90٪ فأكثر"],
    ["very-good", "جيد جدًا", "80–89٪"],
    ["good", "جيد", "70–79٪"],
    ["support", "يحتاج متابعة", "أقل من 70٪"],
  ];
  return (
    <section className="tw-card tw-spaced">
      <div className="tw-toolbar">
        <h2>إتقان الفصل من التقييمات المسجلة</h2>
        <button
          className="tw-button"
          aria-pressed={band === "all"}
          onClick={() => setBand("all")}
        >
          كل الطلاب
        </button>
      </div>
      <p className="tw-muted">
        المتوسط{" "}
        {scores.length
          ? n(scores.reduce((a, b) => a + b, 0) / scores.length) + "٪"
          : "—"}{" "}
        · أعلى {scores.length ? n(Math.max(...scores)) + "٪" : "—"} · أدنى{" "}
        {scores.length ? n(Math.min(...scores)) + "٪" : "—"}
      </p>
      <div className="ws-mastery">
        {bands.map(([id, title, range]) => (
          <button
            key={id}
            aria-pressed={band === id}
            onClick={() => setBand((v) => (v === id ? "all" : id))}
          >
            <strong>
              {n(rows.filter((r) => group(r.percent) === id).length)}
            </strong>
            <span>
              {title} · {range}
            </span>
          </button>
        ))}
      </div>
      {band !== "all" && (
        <div className="tw-table-wrap">
          <table>
            <thead>
              <tr>
                <th>الطالب</th>
                <th>متوسط التقييمات</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => group(r.percent) === band)
                .map((r) => (
                  <tr key={r.student.id}>
                    <td>{r.student.name}</td>
                    <td>
                      {r.percent === null
                        ? "لم يرصد"
                        : n(Math.round(r.percent)) + "٪"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!rows.some((r) => group(r.percent) === band) && (
            <p>لا توجد نتائج في هذه الفئة.</p>
          )}
        </div>
      )}
    </section>
  );
}
export function Student360Summary({
  data,
}: {
  data: {
    student: TeacherStudent;
    attendance: AttendanceEntry[];
    grades: TeacherGrade[];
    assignments: TeacherTask[];
  };
}) {
  const avg = average(data.grades);
  return (
    <>
      <div className="ws-kpis">
        <article>
          <strong>
            {n(data.attendance.filter((a) => a.status === "absent").length)} /{" "}
            {n(data.attendance.filter((a) => a.status === "late").length)}
          </strong>
          <span>أيام غياب / أيام تأخر</span>
        </article>
        <article>
          <strong>{avg === null ? "—" : n(Math.round(avg)) + "٪"}</strong>
          <span>متوسط التقييمات المرصودة</span>
        </article>
        <article>
          <strong>
            {n(
              data.assignments.filter((t) =>
                t.studentCompletion.includes(data.student.id),
              ).length,
            )}
          </strong>
          <span>واجبات مكتملة</span>
        </article>
        <article>
          <strong>
            {n(
              data.assignments.filter(
                (t) => !t.studentCompletion.includes(data.student.id),
              ).length,
            )}
          </strong>
          <span>واجبات لم تسلم</span>
        </article>
      </div>
      <Link
        className="tw-button"
        href={teacherClassPath("education", data.student.classId)}
      >
        إصدار رمز دخول من حسابات طلاب الفصل
      </Link>
      <details className="tw-card tw-spaced">
        <summary>آخر نشاط مسجل للطالب</summary>
        {[
          ...data.grades.map((g) => ({
            date: g.date,
            text:
              g.title +
              " — " +
              (g.marks === null ? "لم يرصد" : g.marks + " / " + g.totalMarks),
          })),
          ...data.attendance.map((a) => ({
            date: a.date || "",
            text:
              "سجل الحضور — " +
              {
                present: "حاضر",
                absent: "غائب",
                late: "متأخر",
                excused: "بعذر",
              }[a.status],
          })),
        ]
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 8)
          .map((r, i) => (
            <p key={i}>
              <time>{r.date}</time> · {r.text}
            </p>
          ))}
      </details>
    </>
  );
}
export function QuestionBasketBar({
  questions,
  clear,
}: {
  questions: TeacherQuestion[];
  clear: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [, navigate] = useLocation(),
    qc = useQueryClient();
  const [activeClassId] = useActiveTeacherClass();
  function launchGame(mode: "car-race" | "ladder-race") {
    if (!activeClassId) {
      setError("اختر الفصل النشط أولًا من صفحة الطلاب.");
      return;
    }
    const valid = questions.filter(
      (q) => q.kind === "multiple-choice" && q.options.includes(q.answer),
    );
    if (!valid.length) {
      setError("اختر سؤال اختيار متعدد له مفتاح إجابة مطابق.");
      return;
    }
    try {
      sessionStorage.setItem(
        "classroom-question-selection:" + activeClassId,
        JSON.stringify(valid.map((q) => q.id)),
      );
      navigate(
        "/teacher/classroom?class=" +
          encodeURIComponent(activeClassId) +
          "&tool=" +
          mode,
      );
    } catch {
      setError("تعذر نقل الاختيار؛ افتح مركز الحصة واختر بنك المعلم مباشرة.");
    }
  }
  if (!questions.length) return null;
  async function make(
    kind: "exam" | "support" | "standard" | "challenge" | "exit",
  ) {
    setBusy(true);
    setError("");
    try {
      if (kind === "exit") {
        const step = newLessonStep();
        const first = questions.find(
          (q) =>
            q.kind === "multiple-choice" &&
            q.options.length >= 2 &&
            q.options.includes(q.answer),
        );
        if (!first)
          throw Error(
            "اختر سؤال اختيار متعدد له إجابة مرجعية تطابق أحد الخيارات لإنشاء بطاقة خروج.",
          );
        const lesson = {
          title: "بطاقة خروج — " + day(),
          subject: first.subject,
          grade: first.grade,
          objective: "التحقق من فهم السؤال المختار",
          description:
            "بطاقة خروج من بنك أسئلة المعلم؛ تُراجع قبل إسنادها للفصل.",
          steps: [
            {
              ...step,
              title: "بطاقة الخروج",
              explanation: first.explanation || "اقرأ السؤال واختر الإجابة.",
              question: first.text,
              options: first.options.map((text, index) => ({
                id: crypto.randomUUID(),
                text,
                isCorrect: text === first.answer,
              })),
              correctExplanation: first.explanation || "",
              questionVersionId: first.versionId ?? null,
            },
          ],
        };
        await teacherApi("/teacher/learning/activities", "POST", lesson);
        await qc.invalidateQueries({ queryKey: ["step-lessons"] });
        navigate("/teacher/activities");
      } else {
        const document = createExamDocument();
        document.metadata.title =
          kind === "exam"
            ? "تقييم من بنك الأسئلة"
            : `ورقة عمل — ${({ support: "دعم", standard: "قياسي", challenge: "تحدٍ" } as Record<string, string>)[kind]}`;
        document.metadata.subject = questions[0].subject;
        document.metadata.grade = questions[0].grade;
        const instructions = {
          exam: "اقرأ الأسئلة بعناية وأجب عنها.",
          support:
            "ابدأ بما تعرفه. حدّد المعطيات والمطلوب، ثم اكتب خطوات الحل. يمكن طلب تلميح من المعلم.",
          standard: "أجب عن جميع الأسئلة ووضّح خطوات الحل.",
          challenge:
            "حل الأسئلة بصورة مستقلة، ثم تحقّق من إجاباتك واشرح سبب اختيارك.",
        };
        document.metadata.instructions = instructions[kind];
        const section = newSection();
        section.title = "أسئلة مختارة من بنك المعلم";
        section.instructions = instructions[kind];
        section.questions = questions.map((q) => ({
          ...newQuestion(),
          questionVersionId: q.versionId ?? null,
          id: crypto.randomUUID(),
          text: q.text,
          kind:
            q.kind === "multiple-choice"
              ? "choice"
              : q.kind === "true-false"
                ? "true-false"
                : "written",
          options: q.options,
          answer: q.answer,
          explanation: q.explanation || "",
          answerLines: kind === "support" ? 6 : kind === "challenge" ? 4 : 3,
          marks: q.marks,
        }));
        document.sections = [section];
        document.metadata.totalMarks = questions.reduce(
          (sum, q) => sum + q.marks,
          0,
        );
        const exam = await teacherApi<{ id: string }>(
          "/teacher/exams",
          "POST",
          {
            title: document.metadata.title,
            document,
            sourceAssetId: null,
            isTemplate: false,
          },
        );
        await qc.invalidateQueries({ queryKey: ["teacher", "exams"] });
        navigate("/teacher/exams?exam=" + encodeURIComponent(exam.id));
      }
      clear();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ws-basket" role="region" aria-label="سلة الأسئلة">
      <strong>{n(questions.length)} سؤال محدد</strong>
      <button className="tw-button" onClick={() => launchGame("car-race")}>
        🎮 شغّل في سباق السيارة
      </button>
      <button className="tw-button" onClick={() => launchGame("ladder-race")}>
        🎮 شغّل في سباق السلم
      </button>
      <button
        className="tw-button primary"
        disabled={busy}
        onClick={() => void make("exam")}
      >
        تحويل إلى اختبار
      </button>
      <button
        className="tw-button"
        disabled={busy}
        onClick={() => void make("exit")}
      >
        بطاقة خروج
      </button>
      {(["support", "standard", "challenge"] as const).map((kind, i) => (
        <button
          key={kind}
          className="tw-button"
          disabled={busy}
          onClick={() => void make(kind)}
        >
          ورقة {["دعم", "قياسي", "تحدٍ"][i]}
        </button>
      ))}
      <button className="tw-button ghost" onClick={clear}>
        إلغاء التحديد
      </button>
      {error && (
        <p role="alert" className="tw-error">
          {error}
        </p>
      )}
    </div>
  );
}
