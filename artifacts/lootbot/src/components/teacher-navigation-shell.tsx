import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  ChevronDown,
  Menu,
  Search,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import {
  teacherApi,
  type TeacherClass,
  type TeacherStudent,
} from "../lib/teacher-api";

export const TEACHER_NAV_GROUPS = [
  {
    id: "today",
    label: "يومي وأدوات الحصة التفاعلية",
    keys: ["", "classroom", "live", "automations"],
  },
  {
    id: "classroom",
    label: "الفصول والطلاب",
    keys: ["classes", "students", "attendance", "grades", "education"],
  },
  {
    id: "teaching",
    label: "التدريس والمحتوى",
    keys: ["lessons", "activities", "chemistry", "tasks"],
  },
  {
    id: "assessment",
    label: "الاختبارات وبنك الأسئلة",
    keys: ["exams", "questions", "templates"],
  },
  {
    id: "records",
    label: "السجلات والتقارير والإعدادات",
    keys: ["tools", "reports", "settings"],
  },
];
type Module = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
};
type ClassContext = {
  classId: string;
  setClassId: (id: string) => void;
  classes: TeacherClass[];
};
const ActiveClass = createContext<ClassContext | null>(null);
const storageKey = "tw_active_class_id";
const initial = () => {
  try {
    return (
      new URLSearchParams(location.search).get("class") ??
      sessionStorage.getItem(storageKey) ??
      ""
    );
  } catch {
    return "";
  }
};
export function ActiveTeacherClassProvider({
  children,
}: {
  children: ReactNode;
}) {
  const classes = useQuery({
    queryKey: ["teacher", "classes", ""],
    queryFn: () => teacherApi<TeacherClass[]>("/teacher/classes"),
    staleTime: 10000,
  });
  const [classId, setId] = useState(initial),
    [path] = useLocation(),
    search = useSearch();
  const available = useMemo(
    () => (classes.data ?? []).filter((c) => !c.archived),
    [classes.data],
  );
  useEffect(() => {
    const query = new URLSearchParams(location.search).get("class");
    if (query && available.some((c) => c.id === query)) setId(query);
  }, [path, search, available]);
  useEffect(() => {
    if (classes.isSuccess && !available.some((c) => c.id === classId))
      setId(available[0]?.id ?? "");
  }, [available, classId, classes.isSuccess]);
  useEffect(() => {
    try {
      if (classId) sessionStorage.setItem(storageKey, classId);
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* The session remains usable without browser storage. */
    }
  }, [classId]);
  function setClassId(id: string) {
    if (id === classId) return;
    if (id && !available.some((c) => c.id === id)) return;
    const event = new CustomEvent("workspace:before-class-change", {
      cancelable: true,
    });
    if (!window.dispatchEvent(event)) return;
    setId(id);
    const url = new URL(location.href);
    if (id) url.searchParams.set("class", id);
    else url.searchParams.delete("class");
    history.replaceState(history.state, "", url);
  }
  return (
    <ActiveClass.Provider value={{ classId, setClassId, classes: available }}>
      {children}
    </ActiveClass.Provider>
  );
}
export function useActiveTeacherClass(): [string, (id: string) => void] {
  const ctx = useContext(ActiveClass);
  const [local, setLocal] = useState(initial);
  return ctx ? [ctx.classId, ctx.setClassId] : [local, setLocal];
}
export function useClassChangeGuard(dirty: boolean) {
  useEffect(() => {
    const guard = (event: Event) => {
      if (
        dirty &&
        !window.confirm("توجد تغييرات غير محفوظة. الانتقال إلى فصل آخر؟")
      )
        event.preventDefault();
    };
    window.addEventListener("workspace:before-class-change", guard);
    return () =>
      window.removeEventListener("workspace:before-class-change", guard);
  }, [dirty]);
}
export function teacherClassPath(key: string, classId: string) {
  return `/teacher${key ? "/" + key : ""}${classId ? "?class=" + encodeURIComponent(classId) : ""}`;
}
export const CLASS_PERIODS = [
  "الأولى",
  "الثانية",
  "الثالثة",
  "الرابعة",
  "الخامسة",
  "السادسة",
  "السابعة",
].map((p) => "الحصة " + p);
const readPeriod = () => {
  try {
    return sessionStorage.getItem("tw_period_label") || CLASS_PERIODS[0];
  } catch {
    return CLASS_PERIODS[0];
  }
};
export function useClassPeriod(): [string, (period: string) => void] {
  const [period, setPeriod] = useState(readPeriod);
  useEffect(() => {
    const onChange = () => setPeriod(readPeriod());
    window.addEventListener("classroom:period", onChange);
    return () => window.removeEventListener("classroom:period", onChange);
  }, []);
  return [
    period,
    (value) => {
      if (!CLASS_PERIODS.includes(value)) return;
      setPeriod(value);
      try {
        sessionStorage.setItem("tw_period_label", value);
      } catch {
        /* Usable without storage. */
      }
      window.dispatchEvent(new CustomEvent("classroom:period"));
    },
  ];
}
export function ActiveClassContextBar() {
  const [period, setPeriod] = useClassPeriod();
  const ctx = useContext(ActiveClass);
  const id = ctx?.classId ?? "";
  const students = useQuery({
    queryKey: ["teacher", "context-students", id],
    queryFn: () =>
      teacherApi<TeacherStudent[]>(
        "/teacher/students?classId=" +
          encodeURIComponent(id) +
          "&archived=false",
      ),
    enabled: !!id,
  });
  const date = new Date().toLocaleDateString("en-CA");
  const attendance = useQuery({
    queryKey: ["teacher", "context-attendance", id, date],
    queryFn: () =>
      teacherApi<{ status: string }[]>(
        "/teacher/attendance?classId=" +
          encodeURIComponent(id) +
          "&date=" +
          date,
      ),
    enabled: !!id,
  });
  const recorded = attendance.data ?? [],
    present = recorded.filter(
      (r) => r.status === "present" || r.status === "late",
    ).length;
  return (
    <section className="ws-context-bar" aria-label="سياق الفصل النشط">
      <label>
        الفصل النشط
        <select
          aria-label="الفصل"
          value={id}
          onChange={(e) => ctx?.setClassId(e.target.value)}
        >
          <option value="">اختر فصلًا</option>
          {ctx?.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.subject || c.grade}
            </option>
          ))}
        </select>
      </label>
      <label>
        الحصة الحالية
        <select
          aria-label="الحصة الحالية"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          {CLASS_PERIODS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <div className="ws-context-facts">
        <span>
          {students.data
            ? `${students.data.filter((s) => !s.archived && !s.removed).length} طالبًا نشطًا`
            : "—"}
        </span>
        <span>
          {recorded.length
            ? `حضور مسجل: ${Math.round((present / recorded.length) * 100)}٪`
            : "لم يسجّل حضور اليوم"}
        </span>
      </div>
      <nav aria-label="إجراءات الفصل">
        <Link href={teacherClassPath("attendance", id)}>رصد الحضور</Link>
        <Link href={teacherClassPath("grades", id)}>إدخال درجات</Link>
        <Link href={teacherClassPath("education", id)}>إصدار رمز طالب</Link>
        <Link
          href={
            teacherClassPath("reports", id) + (id ? "&" : "?") + "type=roster"
          }
        >
          طباعة كشف A4
        </Link>
      </nav>
    </section>
  );
}
export function TeacherGroupedNavigation({
  modules,
  current,
}: {
  modules: Module[];
  current: string;
}) {
  const [classId] = useActiveTeacherClass();
  return (
    <>
      {TEACHER_NAV_GROUPS.map((group) => (
        <details key={group.id} className="ws-nav-group" open>
          <summary>
            {group.label}
            <ChevronDown size={14} />
          </summary>
          <div>
            {group.keys.map((key) => {
              const m = modules.find((m) => m.key === key);
              return m ? (
                <Link
                  href={teacherClassPath(key, classId)}
                  aria-label={m.label}
                  title={m.label}
                  key={key}
                  aria-current={key === current ? "page" : undefined}
                >
                  <m.icon size={17} />
                  <span>{m.label}</span>
                </Link>
              ) : null;
            })}
          </div>
        </details>
      ))}
    </>
  );
}
export function TeacherContextTabs({
  modules,
  current,
}: {
  modules: Module[];
  current: string;
}) {
  const [id] = useActiveTeacherClass();
  const group = TEACHER_NAV_GROUPS.find((g) => g.keys.includes(current));
  return (
    <nav className="ws-subtabs" aria-label="أقسام المجموعة الحالية">
      {group?.keys.map((key) => {
        const m = modules.find((m) => m.key === key);
        return m ? (
          <Link
            key={key}
            aria-current={key === current ? "page" : undefined}
            href={teacherClassPath(key, id)}
          >
            {m.label}
          </Link>
        ) : null;
      })}
    </nav>
  );
}
export function TeacherCommandPalette({
  modules,
  onStudent,
}: {
  modules: Module[];
  onStudent: (id: string) => void;
}) {
  const [text, setText] = useState(""),
    [open, setOpen] = useState(false),
    [id] = useActiveTeacherClass(),
    [path] = useLocation(),
    input = useRef<HTMLInputElement>(null);
  const students = useQuery({
    queryKey: ["teacher", "command-students"],
    queryFn: () =>
      teacherApi<TeacherStudent[]>("/teacher/students?archived=false"),
    enabled: open,
    staleTime: 30000,
  });
  const classes = useQuery({
    queryKey: ["teacher", "classes", ""],
    queryFn: () => teacherApi<TeacherClass[]>("/teacher/classes"),
    enabled: open,
  });
  const exams = useQuery({
    queryKey: ["teacher", "command-exams"],
    queryFn: () =>
      teacherApi<{ id: string; title: string }[]>(
        "/teacher/exams?templates=false",
      ),
    enabled: open,
  });
  const questions = useQuery({
    queryKey: ["teacher", "command-questions"],
    queryFn: () =>
      teacherApi<{ id: string; text: string }[]>("/teacher/questions"),
    enabled: open,
  });
  useEffect(() => {
    setOpen(false);
    setText("");
  }, [path]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
        input.current?.focus();
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  const term = text.trim();
  return (
    <div className="tw-search ws-command">
      <Search size={16} />
      <input
        ref={input}
        aria-label="البحث عن أداة في غرفة المعلم"
        placeholder="أداة، طالب، اختبار… Ctrl+K"
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
      />
      <kbd>⌘ K</kbd>
      {open && (
        <div
          className="ws-command-results"
          role="region"
          aria-label="نتائج البحث والأوامر"
        >
          <div className="ws-command-heading">
            <strong>انتقل مباشرة</strong>
            <button aria-label="إغلاق البحث" onClick={() => setOpen(false)}>
              <X size={17} />
            </button>
          </div>
          {modules
            .filter((m) => !term || m.label.includes(term))
            .slice(0, term ? 18 : 5)
            .map((m) => (
              <Link
                key={m.key}
                href={teacherClassPath(m.key, id)}
                onClick={() => setOpen(false)}
              >
                <m.icon size={17} />
                {m.label}
              </Link>
            ))}
          {!term && (
            <>
              <Link href={teacherClassPath("live", id)}>
                بدء الحصة المباشرة لهذا الفصل
              </Link>
              <Link href="/teacher/exams?new=1">تصميم اختبار جديد</Link>
              <Link href={teacherClassPath("attendance", id)}>
                رصد حضور اليوم
              </Link>
              <Link href={teacherClassPath("education", id)}>
                توليد رموز دخول الطلاب
              </Link>
            </>
          )}
          {term && (
            <>
              <h3>الطلاب</h3>
              {students.data
                ?.filter((s) => s.name.includes(term))
                .slice(0, 6)
                .map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      onStudent(s.id);
                      setOpen(false);
                    }}
                  >
                    {s.name}
                    <small>
                      {classes.data?.find((c) => c.id === s.classId)?.name}
                    </small>
                  </button>
                ))}
              <h3>الفصول</h3>
              {classes.data
                ?.filter((c) => !c.archived && c.name.includes(term))
                .slice(0, 4)
                .map((c) => (
                  <Link key={c.id} href={teacherClassPath("students", c.id)}>
                    {c.name}
                  </Link>
                ))}
              <h3>الاختبارات</h3>
              {exams.data
                ?.filter((e) => e.title.includes(term))
                .slice(0, 4)
                .map((e) => (
                  <Link
                    key={e.id}
                    href={"/teacher/exams?exam=" + encodeURIComponent(e.id)}
                  >
                    {e.title}
                  </Link>
                ))}
              <h3>بنك الأسئلة</h3>
              {questions.data
                ?.filter((q) => q.text.includes(term))
                .slice(0, 4)
                .map((q) => (
                  <Link
                    key={q.id}
                    href={
                      "/teacher/questions?question=" + encodeURIComponent(q.id)
                    }
                  >
                    {q.text}
                  </Link>
                ))}
            </>
          )}
          {(students.error ||
            exams.error ||
            classes.error ||
            questions.error) && (
            <p role="status">تعذر تحميل بعض النتائج. روابط الأدوات متاحة.</p>
          )}
        </div>
      )}
    </div>
  );
}
export function TeacherMobileBottomNav({
  current,
  onMore,
}: {
  current: string;
  onMore: () => void;
}) {
  const [id] = useActiveTeacherClass();
  return (
    <nav className="ws-mobile-dock" aria-label="التنقل السريع للمعلم">
      {[
        ["", "لوحة المعلم"],
        ["classes", "فصولي"],
        ["attendance", "الحضور"],
        ["grades", "الدرجات"],
      ].map(([key, label]) => (
        <Link
          href={teacherClassPath(key, id)}
          key={key}
          aria-current={current === key ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
      <button onClick={onMore}>
        <Menu size={18} />
        المزيد
      </button>
    </nav>
  );
}
export function SidebarCollapseButton({
  collapsed,
  toggle,
}: {
  collapsed: boolean;
  toggle: () => void;
}) {
  return (
    <button
      className="ws-collapse"
      aria-label={collapsed ? "توسيع القائمة الجانبية" : "طي القائمة الجانبية"}
      aria-expanded={!collapsed}
      onClick={toggle}
    >
      {collapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
    </button>
  );
}
