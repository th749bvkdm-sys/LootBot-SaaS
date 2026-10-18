import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  GraduationCap,
  School,
  Users,
  BookOpen,
  Target,
  ShieldCheck,
  KeyRound,
  ChartNoAxesCombined,
  NotebookPen,
  Settings2,
  Bell,
  LifeBuoy,
  Layers,
  ClipboardList,
  Search,
  ArrowUpRight,
  Check,
  Plus,
  Clock,
  Trophy,
  Download,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import { AppThemeToggle } from "./app-theme-toggle";
import { AccountLogoutButton } from "./account-logout";
import { teacherApi } from "../lib/teacher-api";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import "./education.css";
import "./workspace-shell.css";
import {StudentHubNavigation,StudentContextTabs,StudentMobileBottomDock,FloatingFocusBar,DailySmartQuestCard,ClassActivitiesTab,studentHubDestination} from './student-navigation-shell';
import {useActiveTeacherClass} from './teacher-navigation-shell';
import {MistakeFlashcardsView} from './student-review-cards';
import { QuantWorkspace } from "./quant/QuantWorkspace";
import { QuantAdmin } from "./quant/QuantAdmin";
import {
  StudentAcademy,
  StudentLaunchpad,
  AcademyMistakes,
  StudentDownloads,
} from "./student-academy";
import { StudentStudy } from "./student-study";
type Row = Record<string, any>;
type Me = {
  accountType: string;
  root: boolean;
  grants: { role: string; scope: string }[];
  memberships: Row[];
  settings: Row;
  aiAvailable: boolean;
  pending?: Row[];
  permissions?: string[];
};
const api = <T,>(path: string, method = "GET", body?: unknown) =>
  teacherApi<T>("/education" + path, method, body);
function useData<T>(path: string, enabled = true) {
  return useQuery({
    queryKey: ["education", path],
    queryFn: () => api<T>(path),
    enabled,
    retry: false,
  });
}
function useAction() {
  const qc = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  async function run<T>(fn: () => Promise<T>, message = "تم الحفظ.") {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await fn();
      await qc.invalidateQueries({ queryKey: ["education"] });
      await qc.invalidateQueries({ queryKey: ["teacher"] });
      setSuccess(message);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إتمام العملية.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, success, run };
}
type Action = ReturnType<typeof useAction>;
const fmt = (v: unknown) =>
  new Intl.NumberFormat("ar-SA").format(Number(v) || 0);
const date = (v: string) =>
  v
    ? new Date(v).toLocaleString("ar-SA", {
        calendar: "gregory",
        dateStyle: "short",
      })
    : "غير محدد";
// Quoting alone does not stop spreadsheet formula execution in exported names.
const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  const safe =
    /^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
};
const labels: Record<string, string> = {
  active: "فعال",
  paused: "موقوف",
  revoked: "ملغى",
  expired: "منتهٍ",
  exhausted: "مستنفد",
  pending: "بانتظار الموافقة",
  suspended: "معلّق",
  archived: "مؤرشف",
  draft: "مسودة",
  review: "بانتظار المراجعة",
  published: "منشور",
  completed: "مكتمل",
  open: "مفتوح",
  resolved: "تمت المعالجة",
  quantitative: "كمي",
  verbal: "لفظي",
  teacher: "المعلم",
  student: "الطالب",
  easy: "سهل",
  medium: "متوسط",
  hard: "متقدم",
  diagnostic: "تشخيصي",
  skill: "تدريب مهارة",
  mock: "اختبار تجريبي",
  insufficient: "محاولات إضافية",
  mastered: "متقنة",
  calculation: "خطأ حسابي",
  concept: "فهم المفهوم",
  reading: "قراءة السؤال",
  time: "إدارة الوقت",
  other: "أخرى",
  SCHOOL_ADMIN: "مدير مدرسة",
  TEACHER: "معلم",
  STUDENT: "طالب",
  CONTENT_MANAGER: "مسؤول محتوى",
  SUPPORT: "دعم فني",
};
function Status({ value }: { value: string }) {
  return <span className="edu-status">{labels[value] || value}</span>;
}
function Notice({ action }: { action: Action }) {
  return (
    <>
      {action.error && (
        <p className="edu-notice edu-error" role="alert">
          {action.error}
        </p>
      )}
      {action.success && (
        <p className="edu-notice" role="status">
          {action.success}
        </p>
      )}
    </>
  );
}
function Loading() {
  return (
    <div className="edu-empty" role="status">
      جار تحميل البيانات المحفوظة…
    </div>
  );
}
function Empty({
  children = "لا توجد سجلات بعد. ابدأ بإضافة بياناتك.",
}: {
  children?: ReactNode;
}) {
  return <div className="edu-empty">{children}</div>;
}
function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="edu-card">
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}
function QueryState({
  query,
  children,
}: {
  query: ReturnType<typeof useData>;
  children: ReactNode;
}) {
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <div className="edu-notice edu-error" role="alert">
        {query.error.message}
        <button
          className="edu-button secondary"
          onClick={() => void query.refetch()}
        >
          إعادة المحاولة
        </button>
      </div>
    );
  return <>{children}</>;
}
function Btn({
  children,
  onClick,
  disabled = false,
  secondary = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <button
      type="button"
      className={"edu-button" + (secondary ? " secondary" : "")}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
type Option = { value: string; label: string };
type FieldSpec = {
  name: string;
  label: string;
  type?: string;
  options?: Option[];
  required?: boolean;
  wide?: boolean;
  min?: number;
  max?: number;
};
function Form({
  fields,
  initial = {},
  submit,
  action,
  button = "حفظ",
}: {
  fields: FieldSpec[];
  initial?: Row;
  submit: (values: Row) => Promise<unknown>;
  action: Action;
  button?: string;
}) {
  const [values, setValues] = useState<Row>(initial);
  useEffect(() => setValues(initial), [JSON.stringify(initial)]);
  const handle = (e: FormEvent) => {
    e.preventDefault();
    void submit(values);
  };
  return (
    <form className="edu-form" onSubmit={handle}>
      {fields.map((f) => (
        <label className={f.wide ? "edu-wide" : ""} key={f.name}>
          {f.label}
          {f.type === "checkbox" ? (
            <input
              type="checkbox"
              aria-label={f.label}
              checked={!!values[f.name]}
              onChange={(e) =>
                setValues({ ...values, [f.name]: e.target.checked })
              }
            />
          ) : f.options ? (
            <select
              aria-label={f.label}
              required={f.required !== false}
              value={values[f.name] ?? ""}
              onChange={(e) =>
                setValues({ ...values, [f.name]: e.target.value })
              }
            >
              <option value="">اختر…</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === "textarea" ? (
            <textarea
              aria-label={f.label}
              required={f.required !== false}
              value={values[f.name] ?? ""}
              onChange={(e) =>
                setValues({ ...values, [f.name]: e.target.value })
              }
              maxLength={12000}
            />
          ) : (
            <input
              aria-label={f.label}
              required={f.required !== false}
              type={f.type || "text"}
              onInput={
                f.type === "datetime-local" || f.type === "date"
                  ? (e) =>
                      setValues({ ...values, [f.name]: e.currentTarget.value })
                  : undefined
              }
              min={f.min}
              max={f.max}
              value={values[f.name] ?? ""}
              onChange={(e) =>
                setValues({
                  ...values,
                  [f.name]:
                    f.type === "number"
                      ? Number(e.target.value)
                      : e.target.value,
                })
              }
              maxLength={200}
            />
          )}
        </label>
      ))}
      <div className="edu-wide">
        <button className="edu-button" disabled={action.busy}>
          <Plus size={16} />
          {action.busy ? "جار الحفظ…" : button}
        </button>
      </div>
    </form>
  );
}
function Table({
  rows,
  columns,
  actions,
}: {
  rows: Row[];
  columns: { key: string; label: string; render?: (r: Row) => ReactNode }[];
  actions?: (r: Row) => ReactNode;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [sort, setSort] = useState(columns[0].key);
  const filtered = rows
    .filter((r) =>
      JSON.stringify(r).toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      String(a[sort] ?? "").localeCompare(String(b[sort] ?? ""), "ar"),
    );
  const max = Math.max(0, Math.ceil(filtered.length / 10) - 1),
    current = Math.min(page, max);
  return (
    <>
      <div className="edu-toolbar">
        <input
          aria-label="بحث في السجلات"
          placeholder="ابحث بالاسم أو الحالة…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="ترتيب السجلات"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          {columns.map((c) => (
            <option key={c.key} value={c.key}>
              ترتيب حسب {c.label}
            </option>
          ))}
        </select>
        <span className="edu-note">{fmt(filtered.length)} سجل</span>
      </div>
      {!filtered.length ? (
        <Empty />
      ) : (
        <div className="edu-table">
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                {actions && <th>الإجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(current * 10, current * 10 + 10).map((r, i) => (
                <tr key={r.id || i}>
                  {columns.map((c) => (
                    <td key={c.key}>
                      {c.render ? c.render(r) : String(r[c.key] ?? "—")}
                    </td>
                  ))}
                  {actions && (
                    <td>
                      <div className="edu-actions">{actions(r)}</div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="edu-actions">
        <Btn secondary disabled={!current} onClick={() => setPage(current - 1)}>
          السابق
        </Btn>
        <span className="edu-note">
          صفحة {fmt(current + 1)} من {fmt(max + 1)}
        </span>
        <Btn
          secondary
          disabled={current === max}
          onClick={() => setPage(current + 1)}
        >
          التالي
        </Btn>
      </div>
    </>
  );
}
const sections = [
  ["overview", "المؤشرات", ChartNoAxesCombined],
  ["schools", "المدارس", School],
  ["users", "المستخدمون", Users],
  ["classes", "الفصول والإسناد", GraduationCap],
  ["codes", "رموز الانضمام", KeyRound],
  ["enrollments", "الانضمام والمتابعة", ClipboardList],
  ["categories", "التصنيفات", Layers],
  ["questions", "محتوى القدرات", BookOpen],
  ["quant-content", "إدارة الكمي", Target],
  ["roles", "الأدوار والصلاحيات", ShieldCheck],
  ["teacher-room", "غرفة المعلم", GraduationCap],
  ["student-room", "غرفة الطلاب", Users],
  ["settings", "إعدادات المنصة", Settings2],
  ["help", "المساعدة والبلاغات", LifeBuoy],
  ["audit", "سجل التدقيق", ShieldCheck],
] as const;
const studentSections = [
  ["home", "مساحتي", GraduationCap],
  ["aptitude", "أقسام المفكر", Target],
  ["academy", "مسارات التأسيس", Layers],
  ["foundation-history", "نتائج التأسيس", ClipboardList],
  ["foundation-progress", "تحليل مهاراتي", ChartNoAxesCombined],
  ["mistakes", "دفتر أخطائي", NotebookPen],
  ["bookmarks", "أسئلتي المحفوظة", BookOpen],
  ["plan", "خطة اليوم والتركيز", Clock],
  ["rooms", "غرف المذاكرة والتحديات", Users],
  ["achievements", "السلسلة والأوسمة", Trophy],
  ["downloads", "مكتبتي دون إنترنت", Download],
  ["goals", "الأهداف والخطة", Check],
  ["help", "المساعدة", LifeBuoy],
  ["class-activities","أنشطة المعلم ومختبر الكيمياء",BookOpen],
  ["flashcards","البطاقات السريعة",Layers],
  ["history","سجل محاولاتي",Clock],
  ["progress","تحليل الكمي",Target],
] as const;
const sectionCapabilities: Record<string, string> = {
  schools: "schools.read",
  classes: "classes.write",
  codes: "codes.write",
  enrollments: "classes.write",
  categories: "categories.write",
  questions: "questions.write",
  settings: "schools.edit",
  audit: "audit.read",
};
export function EducationWorkspace() {
  const me = useData<Me>("/me"),
    [section, setSection] = useState(
      new URLSearchParams(window.location.search).get("adminSection") ||
      new URLSearchParams(window.location.search).get("studentTab") ||
        (new URLSearchParams(window.location.search).has("academyAttempt")
          ? "academy"
          : [
                "quantAttempt",
                "quantResult",
                "quantVideos",
                "quantNotebook",
              ].some((k) => new URLSearchParams(window.location.search).has(k))
            ? "aptitude"
            : "overview"),
    ),
    [search, setSearch] = useState(""),
    [quantNavigation, setQuantNavigation] = useState(0);
  const student = me.data?.accountType === "student";
  const manager = me.data?.grants.some((g) => g.role === "SCHOOL_ADMIN");
  const content = me.data?.grants.some((g) => g.role === "CONTENT_MANAGER");
  const support = me.data?.grants.some((g) => g.role === "SUPPORT");
  const list = student
    ? studentSections.filter(
        ([key]) =>
          me.data?.settings.aptitude ||
          !["aptitude", "progress", "history"].includes(key),
      )
    : sections.filter(
        ([key]) =>
          me.data?.root ||
          (manager &&
            [
              "schools",
              "classes",
              "codes",
              "enrollments",
              "settings",
              "help",
              "audit",
            ].includes(key)) ||
          (content &&
            ["categories", "questions", "quant-content", "help"].includes(
              key,
            )) ||
          (support && ["schools", "help", "audit"].includes(key)),
      );
  const allowed = list.filter(
    ([key]) =>
      me.data?.root ||
      student ||
      key === "help" ||
      (key === "quant-content" &&
        me.data?.permissions?.some((p) => p.startsWith("quant."))) ||
      me.data?.permissions?.includes(sectionCapabilities[key] || "never"),
  );
  const visible = allowed.filter(([, label]) => label.includes(search));
  const requested=studentHubDestination(section);
  const effective = allowed.some(([key]) => key === requested)
    ? requested
    : allowed[0]?.[0] || "help";
  const title = list.find(([key]) => key === effective)?.[1] || "مركز المساعدة";
  function selectSection(key: string) {
    key=studentHubDestination(key);
    setSection(key);
    if (student) {
      if (key === "aptitude") setQuantNavigation((current) => current + 1);
      const url = new URL(window.location.href);
      [
        "quantAttempt",
        "quantResult",
        "quantReview",
        "quantVideos",
        "quantVideo",
        "quantNotebook",
        "academyAttempt",
        "academyLesson",
        "academyTrack",
        "studyRoom",
        "activity",
        "enrollmentId",
      ].forEach((k) => url.searchParams.delete(k));
      url.searchParams.set("studentTab", key);
      window.scrollTo(0, 0);
      window.history.pushState(null, "", url);
    }
  }
  useEffect(()=>{if(!student)return;const sync=()=>{const params=new URLSearchParams(location.search);setSection(studentHubDestination(params.get('studentTab')||(params.has('academyAttempt')?'academy':['quantAttempt','quantResult','quantReview','quantVideo','quantVideos','quantNotebook'].some(k=>params.has(k))?'aptitude':'home')));setQuantNavigation(v=>v+1);};window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[student]);
  useEffect(() => {
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
    document.title = title + " | LootBot";
  }, [title]);
  if (me.data && section === "quant-content" && (student || !allowed.some(([key]) => key === "quant-content"))) {
    return <main className="edu-room" dir="rtl"><section className="edu-card">
      <h1>اعتماد ونشر أقسام المفكر</h1>
      <p role="alert">الحساب الحالي لا يملك الوصول إلى إدارة الكمي. تحتاج إلى الدخول بحساب المسؤول الأعلى أو مسؤول محتوى مخوّل.</p>
      <button className="edu-button" disabled>اعتماد ونشر الكل — يحتاج حسابًا مخوّلًا</button>
      <AccountLogoutButton />
      <p className="edu-note">فتح الرابط لا يمنح صلاحيات إضافية، ولم يُعتمد أو يُنشر أي اختبار.</p>
      <a className="edu-button secondary" href="/education">العودة إلى غرفة التعليم</a>
    </section></main>;
  }
  return (
    <main className={"edu-room" + (student ? "" : " edu-admin")} dir="rtl">
      <div className="edu-shell">
        <aside className="edu-sidebar">
          <div className="edu-brand">
            <BrandMark />
            <div>
              <b>{me.data?.settings.platformName || "LootBot"}</b>
              <small>{student ? "غرفة الطالب" : "إدارة التعليم"}</small>
            </div>
          </div>
          <nav aria-label="التنقل التعليمي">
            {student&&<StudentHubNavigation section={effective} search={search} navigate={selectSection}/>}
            {!student&&visible.map(([key, label, Icon]) => (
              <div key={key} className="edu-nav-item">
                {student &&
                  ["home", "mistakes", "plan", "help"].includes(key) && (
                    <span className="edu-nav-group-label">
                      {key === "home"
                        ? "التعلّم"
                        : key === "mistakes"
                          ? "المراجعة"
                          : key === "plan"
                            ? "تنظيم ومشاركة"
                            : "المساعدة والحساب"}
                    </span>
                  )}
                <button
                  aria-current={effective === key ? "page" : undefined}
                  onClick={() => selectSection(key)}
                >
                  <Icon size={19} />
                  {label}
                </button>
              </div>
            ))}
            <Link href="/account/continue">
              <ArrowUpRight size={18} />
              مساحة حسابي
            </Link>
            {me.data?.root && (
              <Link href="/admin">
                <ShieldCheck size={18} />
                إدارة المتاجر
              </Link>
            )}
          </nav>
        </aside>
        <div className="edu-main">
          <header className="edu-top">
            <div className="edu-search">
              <input
                placeholder="ابحث في القائمة…"
                aria-label="البحث في القائمة"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <AppThemeToggle label="مظهر مساحة التعليم" />
            <AccountLogoutButton />
            <span className="edu-tag">
              {student
                ? "التعلم يبدأ بخطوة"
                : me.data?.root
                  ? "مدير النظام"
                  : manager
                    ? "مدير المدرسة"
                    : content
                      ? "مسؤول المحتوى"
                      : "الدعم"}
            </span>
          </header>
          {student&&<StudentContextTabs section={effective} navigate={selectSection}/>}
          {student&&!!me.data?.memberships.length&&me.data.settings.studentRoom&&!me.data.settings.maintenance&&<FloatingFocusBar/>}
          {!(
            student && ["home", "aptitude", "academy"].includes(effective)
          ) && (
            <section className="edu-hero">
              <div>
                <span className="edu-eyebrow">
                  مساحة تعليمية • تقدم محفوظ • خصوصية لكل حساب
                </span>
                <h1>{title}</h1>
                <p>
                  {student
                    ? "أهداف صغيرة، معرفة أعمق. تابع تعلمك من نتائجك الفعلية، وخذ وقتك في اكتشاف الخطوة التالية."
                    : "إدارة مترابطة للمدارس والفصول والمحتوى. كل إجراء محفوظ، وكل حساب يصل إلى البيانات المخوّل لها."}
                </p>
              </div>
              <div className="edu-orbit">
                <Target size={55} />
              </div>
            </section>
          )}
          <QueryState query={me}>
            {me.data &&
              (student ? (
                <StudentWorkspace
                  key={quantNavigation}
                  me={me.data}
                  section={effective}
                  navigate={selectSection}
                />
              ) : (
                <AdminWorkspace me={me.data} section={effective} />
              ))}
          </QueryState>
        </div>
      </div>
      {student&&<StudentMobileBottomDock section={effective} navigate={selectSection}/>}
    </main>
  );
}
function Overview() {
  const [days, setDays] = useState("30");
  const q = useData<Row>("/overview?days=" + days);
  const names: Record<string, string> = {
    schools: "مدارس نشطة",
    teachers: "معلمون",
    students: "طلاب",
    suspended: "حسابات معلّقة",
    pending: "طلبات انضمام",
    codes: "رموز فعالة",
    expired_codes: "رموز منتهية",
    classes: "فصول",
    tasks: "مهمات",
    activities: "أنشطة",
    questions: "أسئلة منشورة",
    completed_sessions: "تدريبات مكتملة",
    open_tickets: "بلاغات مفتوحة",
  };
  return (
    <QueryState query={q}>
      <div className="edu-kpis">
        {Object.entries(q.data?.counts || {}).map(([k, v]) => (
          <article className="edu-card edu-kpi" key={k}>
            <ChartNoAxesCombined size={24} />
            <strong>{fmt(v)}</strong>
            <span>{names[k] || k}</span>
          </article>
        ))}
      </div>
      <Card title="نشاط المنصة">
        <Field label="الفترة الزمنية">
          <select
            aria-label="الفترة الزمنية"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          >
            {[7, 30, 90].map((n) => (
              <option key={n} value={n}>
                آخر {fmt(n)} يومًا
              </option>
            ))}
          </select>
        </Field>
        <Timeline rows={q.data?.activity || []} valueKey="actions" />
      </Card>
      <Card title="آخر التعديلات والعمليات">
        <Table
          rows={q.data?.recent || []}
          columns={[
            { key: "action", label: "العملية" },
            {
              key: "created_at",
              label: "الوقت",
              render: (r) => date(r.created_at),
            },
            {
              key: "result",
              label: "النتيجة",
              render: (r) => (
                <Status
                  value={
                    r.details?.result === "success"
                      ? "ناجحة"
                      : r.details?.result === "denied"
                        ? "مرفوضة"
                        : "فشلت"
                  }
                />
              ),
            },
            {
              key: "resource",
              label: "المورد",
              render: (r) => r.details?.resource || "—",
            },
          ]}
        />
      </Card>
    </QueryState>
  );
}
function Timeline({
  rows,
  valueKey = "correct",
}: {
  rows: Row[];
  valueKey?: string;
}) {
  if (!rows.length) return <Empty>لا توجد محاولات مسجلة خلال الفترة.</Empty>;
  const max = Math.max(1, ...rows.map((r) => r[valueKey])),
    points = rows
      .map(
        (r, i) =>
          `${20 + (i * 560) / Math.max(1, rows.length - 1)},${140 - (r[valueKey] * 110) / max}`,
      )
      .join(" ");
  return (
    <>
      <svg
        className="edu-timeline"
        viewBox="0 0 600 165"
        role="img"
        aria-label="مخطط النشاط المسجل عبر الأيام"
      >
        <defs>
          <linearGradient id="edu-line">
            <stop stopColor="#bd9cf9" />
            <stop offset="1" stopColor="#7bd5c6" />
          </linearGradient>
        </defs>
        {[35, 70, 105, 140].map((y) => (
          <line x1="15" x2="585" y1={y} y2={y} stroke="#a3b0cb20" key={y} />
        ))}
        <polyline
          points={points}
          fill="none"
          stroke="url(#edu-line)"
          strokeWidth="4"
        />
        {rows.map((r, i) => (
          <circle
            key={r.day}
            cx={20 + (i * 560) / Math.max(1, rows.length - 1)}
            cy={140 - (r[valueKey] * 110) / max}
            r="4"
            fill="#c6a8ff"
          >
            <title>
              {r.day}: {r[valueKey]}
            </title>
          </circle>
        ))}
      </svg>
      <p className="edu-note">
        {rows[0].day} ← {rows.at(-1)?.day} · الأرقام من السجلات المحفوظة.
      </p>
    </>
  );
}
function AdminWorkspace({ me, section }: { me: Me; section: string }) {
  if (section === "quant-content")
    return <QuantAdmin root={me.root} permissions={me.permissions} />;
  if (section === "overview") return <Overview />;
  if (section === "schools") return <Schools me={me} />;
  if (section === "users") return <UsersAdmin />;
  if (section === "classes") return <SchoolClasses me={me} />;
  if (section === "codes") return <JoinCodes me={me} />;
  if (section === "enrollments") return <TeacherEducation />;
  if (section === "categories") return <Categories />;
  if (section === "questions") return <Questions />;
  if (section === "roles") return <Roles />;
  if (section === "teacher-room" || section === "student-room")
    return (
      <>
        <Categories
          roomTrack={section === "teacher-room" ? "teacher" : "student"}
        />
        <Settings me={me} room={section} />
      </>
    );
  if (section === "settings") return <Settings me={me} room={section} />;
  if (section === "audit") return <Audit me={me} />;
  return <Help me={me} />;
}
function Schools({ me }: { me: Me }) {
  const q = useData<Row[]>("/schools"),
    action = useAction(),
    [edit, setEdit] = useState<Row | null>(null);
  const fields: FieldSpec[] = [
    { name: "name", label: "اسم المدرسة" },
    {
      name: "status",
      label: "الحالة",
      options: ["active", "suspended", "archived"].map((v) => ({
        value: v,
        label: labels[v],
      })),
    },
    { name: "stages", label: "المراحل، مفصولة بفاصلة", required: false },
    { name: "grades", label: "الصفوف، مفصولة بفاصلة", required: false },
    { name: "terms", label: "الفصول الدراسية، مفصولة بفاصلة", required: false },
  ];
  const save = async (v: Row) => {
    const result = await action.run(() =>
      api(edit ? "/schools/" + edit.id : "/schools", edit ? "PUT" : "POST", {
        name: v.name,
        status: v.status,
        data: Object.fromEntries(
          ["stages", "grades", "terms"].map((k) => [
            k,
            String(v[k] || "")
              .split(/[,،]/)
              .map((s) => s.trim())
              .filter(Boolean),
          ]),
        ),
      }),
    );
    if (result) setEdit(null);
  };
  return (
    <>
      <Notice action={action} />
      {(me.root || edit) && (
        <Card title={edit ? "تعديل المدرسة" : "إنشاء مدرسة"}>
          <Form
            fields={fields}
            initial={
              edit
                ? {
                    ...edit,
                    ...Object.fromEntries(
                      Object.entries(edit.data || {}).map(([k, v]) => [
                        k,
                        (v as string[]).join("، "),
                      ]),
                    ),
                  }
                : { status: "active" }
            }
            submit={save}
            action={action}
          />
          {edit && (
            <Btn secondary onClick={() => setEdit(null)}>
              إلغاء التعديل
            </Btn>
          )}
        </Card>
      )}
      <Card title="مدارسك">
        <QueryState query={q}>
          <Table
            rows={q.data || []}
            columns={[
              { key: "name", label: "المدرسة" },
              {
                key: "status",
                label: "الحالة",
                render: (r) => <Status value={r.status} />,
              },
              { key: "students", label: "الطلاب" },
              { key: "classes", label: "الفصول" },
            ]}
            actions={
              me.root || me.grants.some((g) => g.role === "SCHOOL_ADMIN")
                ? (r) => (
                    <Btn secondary onClick={() => setEdit(r)}>
                      تعديل
                    </Btn>
                  )
                : undefined
            }
          />
        </QueryState>
      </Card>
    </>
  );
}
function UsersAdmin() {
  const q = useData<Row[]>("/users"),
    schools = useData<Row[]>("/schools"),
    action = useAction(),
    [roleFilter, setRoleFilter] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  return (
    <>
      <Notice action={action} />
      <Card title="إسناد دور لحساب قائم">
        <p>
          إسناد مدير المدرسة أو المعلم يحتاج مدرسة محددة. منح المحتوى والدعم على
          مستوى المنصة.
        </p>
        <Form
          fields={[
            {
              name: "userId",
              label: "المستخدم",
              options: (q.data || [])
                .filter((u) => u.role !== "SUPERADMIN")
                .map((u) => ({ value: u.id, label: u.name + " · " + u.email })),
            },
            {
              name: "role",
              label: "الدور",
              options: [
                "SCHOOL_ADMIN",
                "TEACHER",
                "CONTENT_MANAGER",
                "SUPPORT",
              ].map((r) => ({ value: r, label: labels[r] })),
            },
            {
              name: "scope",
              label: "المدرسة (لأدوار المدارس)",
              required: false,
              options: (schools.data || []).map((s) => ({
                value: s.id,
                label: s.name,
              })),
            },
            { name: "active", label: "المنحة مفعّلة", type: "checkbox" },
          ]}
          initial={{ active: true }}
          submit={(v) =>
            action.run(() =>
              api("/grants", "POST", {
                ...v,
                scope: ["CONTENT_MANAGER", "SUPPORT"].includes(v.role)
                  ? ""
                  : v.scope,
              }),
            )
          }
          action={action}
        />
      </Card>
      <Card title="المستخدمون">
        <div className="edu-actions">
          {[
            ["suspend", "تعليق المحددين"],
            ["reactivate", "تفعيل المحددين"],
            ["revokeSessions", "إلغاء جلسات المحددين"],
          ].map(([kind, label]) => (
            <Btn
              key={kind}
              secondary
              disabled={!selected.length || action.busy}
              onClick={() => {
                const names = (q.data || [])
                  .filter((u) => selected.includes(u.id))
                  .map((u) => u.name)
                  .join("، ");
                if (
                  confirm(label + " (" + selected.length + "): " + names + "؟")
                )
                  void action.run(() =>
                    api("/users/bulk", "POST", {
                      ids: selected,
                      action: kind,
                      confirmed: true,
                    }),
                  );
              }}
            >
              {label}
            </Btn>
          ))}
        </div>
        <select
          aria-label="تصفية الأدوار"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="">كل الأدوار</option>
          {[
            "student",
            "teacher",
            "SCHOOL_ADMIN",
            "CONTENT_MANAGER",
            "SUPPORT",
          ].map((r) => (
            <option value={r} key={r}>
              {labels[r] || r}
            </option>
          ))}
        </select>
        <QueryState query={q}>
          <Table
            rows={(q.data || []).filter(
              (u) =>
                !roleFilter ||
                u.account_type === roleFilter ||
                u.grants.some((g: Row) => g.role === roleFilter && g.active),
            )}
            columns={[
              {
                key: "selected",
                label: "تحديد",
                render: (r) =>
                  r.role === "SUPERADMIN" ? null : (
                    <input
                      type="checkbox"
                      aria-label={"تحديد " + r.name}
                      checked={selected.includes(r.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, r.id]
                            : selected.filter((x) => x !== r.id),
                        )
                      }
                    />
                  ),
              },
              { key: "name", label: "الاسم" },
              { key: "email", label: "البريد" },
              {
                key: "account_type",
                label: "الحساب",
                render: (r) =>
                  labels[r.account_type] || r.account_type || "لم يختر",
              },
              {
                key: "role",
                label: "المنح",
                render: (r) => (
                  <>
                    {r.role === "SUPERADMIN"
                      ? "مدير النظام"
                      : r.grants
                          .filter((g: Row) => g.active)
                          .map((g: Row) => labels[g.role])
                          .join("، ")}
                  </>
                ),
              },
              {
                key: "suspended",
                label: "الحالة",
                render: (r) => (
                  <Status value={r.suspended ? "suspended" : "active"} />
                ),
              },
            ]}
            actions={(r) =>
              r.role === "SUPERADMIN" ? null : (
                <>
                  <Btn
                    secondary
                    disabled={action.busy}
                    onClick={() => {
                      if (
                        confirm(
                          "تأكيد تغيير حالة هذا الحساب وإلغاء جلساته عند التعليق؟",
                        )
                      )
                        void action.run(() =>
                          api("/users/" + r.id, "PATCH", {
                            suspended: !r.suspended,
                          }),
                        );
                    }}
                  >
                    {r.suspended ? "تفعيل" : "تعليق"}
                  </Btn>
                  <Btn
                    secondary
                    onClick={() => {
                      if (confirm("إلغاء كل جلسات هذا الحساب؟"))
                        void action.run(() =>
                          api("/users/" + r.id, "PATCH", {
                            revokeSessions: true,
                          }),
                        );
                    }}
                  >
                    إلغاء الجلسات
                  </Btn>
                  {r.grants
                    .filter((g: Row) => g.active)
                    .map((g: Row) => (
                      <Btn
                        key={g.id}
                        secondary
                        onClick={() => {
                          if (confirm("إيقاف منحة " + labels[g.role] + "؟"))
                            void action.run(() =>
                              api("/grants", "POST", {
                                userId: r.id,
                                role: g.role,
                                scope: g.scope,
                                active: false,
                              }),
                            );
                        }}
                      >
                        إيقاف {labels[g.role]}
                      </Btn>
                    ))}
                </>
              )
            }
          />
        </QueryState>
      </Card>
    </>
  );
}
function SchoolClasses({ me }: { me: Me }) {
  const q = useData<Row[]>("/classes"),
    schools = useData<Row[]>("/schools"),
    users = useData<Row[]>("/users", me.root),
    action = useAction();
  return (
    <>
      <Notice action={action} />
      <Card title="ربط فصل بمدرسة">
        <p>
          تُستخدم فصول غرفة المعلم نفسها. يجب إسناد المعلم للمدرسة من إدارة
          المستخدمين أولًا.
        </p>
        <Form
          fields={[
            {
              name: "schoolId",
              label: "المدرسة",
              options: (schools.data || []).map((s) => ({
                value: s.id,
                label: s.name,
              })),
            },
            {
              name: "ownerId",
              label: "معرّف المعلم",
              ...(me.root
                ? {
                    options: (users.data || [])
                      .filter((u) => u.account_type === "teacher")
                      .map((u) => ({ value: u.id, label: u.name })),
                  }
                : {}),
            },
            {
              name: "classId",
              label: "فصل قائم (اختياري)",
              options: (q.data || [])
                .filter((c) => !c.school_id)
                .map((c) => ({ value: c.id, label: c.name })),
              required: false,
            },
            { name: "name", label: "اسم الفصل" },
            { name: "grade", label: "الصف" },
            { name: "stage", label: "المرحلة" },
            { name: "subject", label: "المادة" },
            { name: "term", label: "الفصل الدراسي" },
          ]}
          initial={{ stage: "ثانوي", subject: "القدرات", term: "الفصل الأول" }}
          action={action}
          submit={(v) =>
            action.run(() =>
              api("/classes", "POST", {
                ...v,
                ...(v.classId ? {} : { classId: undefined }),
              }),
            )
          }
        />
      </Card>
      <Card title="الفصول المحفوظة">
        <QueryState query={q}>
          <Table
            rows={q.data || []}
            columns={[
              { key: "name", label: "الفصل" },
              { key: "school_name", label: "المدرسة" },
              { key: "teacher_name", label: "المعلم" },
              {
                key: "archived",
                label: "الحالة",
                render: (r) => (
                  <Status value={r.archived ? "archived" : "active"} />
                ),
              },
            ]}
            actions={(r) => (
              <Btn
                secondary
                onClick={() => {
                  if (
                    confirm(
                      "تأكيد " +
                        (r.archived ? "إعادة تفعيل" : "أرشفة") +
                        " الفصل؟",
                    )
                  )
                    void action.run(() =>
                      api("/classes/" + r.id, "PATCH", {
                        archived: !r.archived,
                      }),
                    );
                }}
              >
                {r.archived ? "تفعيل" : "أرشفة"}
              </Btn>
            )}
          />
        </QueryState>
      </Card>
    </>
  );
}
function JoinCodes({ me }: { me: Me }) {
  const schools = useData<Row[]>("/schools"),
    classes = useData<Row[]>("/classes"),
    [sid, setSid] = useState(""),
    [raw, setRaw] = useState(""),
    action = useAction(),
    q = useData<Row[]>("/codes?schoolId=" + sid, !!sid);
  return (
    <>
      <Notice action={action} />
      <Card title="المدرسة">
        <select
          aria-label="مدرسة الرموز"
          value={sid}
          onChange={(e) => {
            setSid(e.target.value);
            setRaw("");
          }}
        >
          <option value="">اختر المدرسة</option>
          {schools.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Card>
      {sid && (
        <>
          <Card title="رمز انضمام جديد">
            <Form
              fields={[
                {
                  name: "classId",
                  label: "الفصل",
                  options: (classes.data || [])
                    .filter((c) => c.school_id === sid && !c.archived)
                    .map((c) => ({ value: c.id, label: c.name })),
                },
                {
                  name: "maxUses",
                  label: "عدد الاستخدامات",
                  type: "number",
                  min: 1,
                  max: 5000,
                },
                {
                  name: "expiresAt",
                  label: "تاريخ الانتهاء",
                  type: "datetime-local",
                },
                {
                  name: "type",
                  label: "النوع",
                  options: ["class", "batch", "temporary"].map((v, i) => ({
                    value: v,
                    label: ["لفصل محدد", "دفعة طلاب", "مؤقت"][i],
                  })),
                },
                {
                  name: "approval",
                  label: "يتطلب موافقة قبل فتح المحتوى",
                  type: "checkbox",
                },
              ]}
              initial={{
                maxUses: 30,
                type: "class",
                approval: true,
                expiresAt: new Date(Date.now() + 7 * 86400000)
                  .toISOString()
                  .slice(0, 16),
              }}
              action={action}
              submit={async (v) => {
                const result = await action.run(() =>
                  api<Row>("/codes", "POST", {
                    ...v,
                    schoolId: sid,
                    expiresAt: new Date(v.expiresAt).toISOString(),
                  }),
                );
                if (result) setRaw(result.code);
              }}
              button="إنشاء الرمز"
            />
            {raw && (
              <>
                <p className="edu-note">
                  يظهر الرمز هنا مرة واحدة. شاركه مع الطلاب المخوّلين فقط.
                </p>
                <div className="edu-code">{raw}</div>
              </>
            )}
          </Card>
          <Card title="رموز المدرسة">
            <QueryState query={q}>
              <Table
                rows={q.data || []}
                columns={[
                  {
                    key: "id",
                    label: "مرجع الرمز",
                    render: (r) => r.id.slice(0, 8),
                  },
                  {
                    key: "class_id",
                    label: "الفصل",
                    render: (r) =>
                      classes.data?.find((c) => c.id === r.class_id)?.name ||
                      "—",
                  },
                  {
                    key: "status",
                    label: "الحالة",
                    render: (r) => <Status value={r.status} />,
                  },
                  {
                    key: "used_count",
                    label: "الاستخدام",
                    render: (r) => `${fmt(r.used_count)} / ${fmt(r.max_uses)}`,
                  },
                  {
                    key: "expires_at",
                    label: "الانتهاء",
                    render: (r) => date(r.expires_at),
                  },
                ]}
                actions={(r) => (
                  <>
                    <Btn
                      secondary
                      onClick={() => {
                        if (confirm("إلغاء الرمز السابق وإصدار بديل جديد؟"))
                          void action.run(async () => {
                            const r2 = await api<Row>(
                              "/codes/" + r.id + "/reissue",
                              "POST",
                              {},
                            );
                            setRaw(r2.code);
                            return r2;
                          });
                      }}
                    >
                      إعادة إصدار
                    </Btn>
                    {!["revoked", "expired", "exhausted"].includes(
                      r.status,
                    ) && (
                      <>
                        <Btn
                          secondary
                          onClick={() =>
                            void action.run(() =>
                              api("/codes/" + r.id, "PATCH", {
                                status:
                                  r.status === "paused" ? "active" : "paused",
                              }),
                            )
                          }
                        >
                          {r.status === "paused" ? "تفعيل" : "إيقاف"}
                        </Btn>
                        <Btn
                          secondary
                          onClick={() => {
                            if (
                              confirm(
                                "إلغاء الرمز نهائيًا؟ يمكنك إصدار رمز جديد.",
                              )
                            )
                              void action.run(() =>
                                api("/codes/" + r.id, "PATCH", {
                                  status: "revoked",
                                }),
                              );
                          }}
                        >
                          إلغاء
                        </Btn>
                      </>
                    )}
                  </>
                )}
              />
            </QueryState>
          </Card>
        </>
      )}
    </>
  );
}
function Categories({ roomTrack }: { roomTrack?: string } = {}) {
  const q = useData<Row[]>("/categories"),
    action = useAction(),
    [edit, setEdit] = useState<Row | null>(null);
  return (
    <>
      <Notice action={action} />
      <Card title={edit ? "تعديل التصنيف" : "تصنيف جديد"}>
        <Form
          fields={[
            { name: "name", label: "الاسم" },
            {
              name: "track",
              label: "المسار",
              options: ["quantitative", "verbal", "teacher", "student"].map(
                (t) => ({ value: t, label: labels[t] }),
              ),
            },
            {
              name: "parentId",
              label: "التصنيف الأب",
              required: false,
              options: (q.data || [])
                .filter((c) => c.id !== edit?.id)
                .map((c) => ({ value: c.id, label: c.name })),
            },
            {
              name: "description",
              label: "الوصف",
              type: "textarea",
              required: false,
            },
            {
              name: "stage",
              label: "المرحلة المستهدفة (فارغ = الجميع)",
              required: false,
            },
            {
              name: "position",
              label: "ترتيب العرض",
              type: "number",
              min: 0,
              max: 1000,
            },
            { name: "icon", label: "اسم الأيقونة" },
            {
              name: "link",
              label: "رابط تعليمي داخلي (مثل /teacher/chemistry)",
              required: false,
            },
            {
              name: "schoolId",
              label: "معرّف مدرسة للتخصيص (اختياري)",
              required: false,
            },
            {
              name: "classId",
              label: "معرّف فصل للتخصيص (اختياري)",
              required: false,
            },
            { name: "visible", label: "ظاهر", type: "checkbox" },
            { name: "archived", label: "مؤرشف", type: "checkbox" },
          ]}
          initial={
            edit
              ? {
                  ...edit,
                  parentId: edit.parent_id || "",
                  schoolId: edit.school_id,
                  classId: edit.class_id,
                }
              : {
                  track: roomTrack || "quantitative",
                  position: 0,
                  icon: "book",
                  visible: true,
                  archived: false,
                }
          }
          submit={async (v) => {
            if (
              await action.run(() =>
                api(
                  edit ? "/categories/" + edit.id : "/categories",
                  edit ? "PUT" : "POST",
                  {
                    ...v,
                    parentId: v.parentId || null,
                    schoolId: v.schoolId || null,
                    classId: v.classId || null,
                  },
                ),
              )
            )
              setEdit(null);
          }}
          action={action}
        />
        {edit && (
          <Btn secondary onClick={() => setEdit(null)}>
            إلغاء التعديل
          </Btn>
        )}
      </Card>
      <Card title="تصنيفات المحتوى">
        <QueryState query={q}>
          <Table
            rows={(q.data || []).filter(
              (c) => !roomTrack || c.track === roomTrack,
            )}
            columns={[
              { key: "name", label: "المهارة" },
              { key: "track", label: "المسار", render: (r) => labels[r.track] },
              {
                key: "parent_id",
                label: "التصنيف الأب",
                render: (r) =>
                  q.data?.find((c) => c.id === r.parent_id)?.name || "رئيسي",
              },
              { key: "position", label: "الترتيب" },
              {
                key: "visible",
                label: "الظهور",
                render: (r) =>
                  r.archived ? "مؤرشف" : r.visible ? "ظاهر" : "مخفي",
              },
            ]}
            actions={(r) => (
              <Btn secondary onClick={() => setEdit(r)}>
                تعديل
              </Btn>
            )}
          />
        </QueryState>
      </Card>
    </>
  );
}

const blankQuestion = () => ({
  categoryId: "",
  text: "",
  difficulty: "medium",
  status: "draft",
  content: {
    options: [
      { text: "", explanation: "" },
      { text: "", explanation: "" },
      { text: "", explanation: "" },
      { text: "", explanation: "" },
    ],
    answer: 0,
    explanation: "",
    passage: "",
    source: "تأليف فريق المحتوى",
    rights: "original",
    license: "",
    allowSave: true,
  },
});
function Questions() {
  const q = useData<Row[]>("/questions"),
    cats = useData<Row[]>("/categories"),
    action = useAction(),
    [editing, setEditing] = useState<Row>(blankQuestion),
    [versionId, setVersionId] = useState(""),
    [preview, setPreview] = useState(false),
    [imported, setImported] = useState<Row[] | null>(null),
    [importReport, setImportReport] = useState<Row[] | null>(null);
  const versions = useData<Row[]>(
      "/questions/" + versionId + "/versions",
      !!versionId,
    ),
    patch = (key: string, value: any) =>
      setEditing({ ...editing, [key]: value }),
    content = (key: string, value: any) =>
      setEditing({ ...editing, content: { ...editing.content, [key]: value } });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = await action.run(() =>
      api(
        editing.id ? "/questions/" + editing.id : "/questions",
        editing.id ? "PUT" : "POST",
        editing,
      ),
    );
    if (result) {
      setEditing(blankQuestion());
      setPreview(false);
    }
  };
  return (
    <>
      <Notice action={action} />
      <Card title={editing.id ? "تعديل السؤال المحفوظ" : "سؤال قدرات أصلي"}>
        <p>
          لا يعرض السؤال على الطلاب قبل نشره. المراجعة المفعّلة تتطلب ناشرًا آخر
          غير مؤلف السؤال.
        </p>
        <form className="edu-form" onSubmit={submit}>
          <Field label="المهارة">
            <select
              required
              value={editing.categoryId}
              onChange={(e) => patch("categoryId", e.target.value)}
            >
              <option value="">اختر المهارة</option>
              {cats.data
                ?.filter((c) => ["quantitative", "verbal"].includes(c.track))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {labels[c.track]} · {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="الصعوبة">
            <select
              value={editing.difficulty}
              onChange={(e) => patch("difficulty", e.target.value)}
            >
              {["easy", "medium", "hard"].map((v) => (
                <option value={v} key={v}>
                  {labels[v]}
                </option>
              ))}
            </select>
          </Field>
          <label className="edu-wide">
            نص السؤال
            <textarea
              required
              value={editing.text}
              onChange={(e) => patch("text", e.target.value)}
            />
          </label>
          <label className="edu-wide">
            قطعة القراءة (اختياري)
            <textarea
              value={editing.content.passage}
              onChange={(e) => content("passage", e.target.value)}
            />
          </label>
          {editing.content.options.map((o: Row, i: number) => (
            <div key={i}>
              <Field label={"الاختيار " + fmt(i + 1)}>
                <input
                  required
                  value={o.text}
                  onChange={(e) =>
                    content(
                      "options",
                      editing.content.options.map((x: Row, j: number) =>
                        j === i ? { ...x, text: e.target.value } : x,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="تفسير هذا البديل (اختياري)">
                <input
                  value={o.explanation}
                  onChange={(e) =>
                    content(
                      "options",
                      editing.content.options.map((x: Row, j: number) =>
                        j === i ? { ...x, explanation: e.target.value } : x,
                      ),
                    )
                  }
                />
              </Field>
            </div>
          ))}
          <Field label="الإجابة الصحيحة">
            <select
              value={editing.content.answer}
              onChange={(e) => content("answer", Number(e.target.value))}
            >
              {editing.content.options.map((o: Row, i: number) => (
                <option key={i} value={i}>
                  {fmt(i + 1)} · {o.text || "الاختيار"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="حالة المحتوى">
            <select
              value={editing.status}
              onChange={(e) => patch("status", e.target.value)}
            >
              {["draft", "review", "published", "archived"].map((s) => (
                <option value={s} key={s}>
                  {labels[s]}
                </option>
              ))}
            </select>
          </Field>
          <label className="edu-wide">
            شرح الحل الصحيح
            <textarea
              required
              value={editing.content.explanation}
              onChange={(e) => content("explanation", e.target.value)}
            />
          </label>
          <Field label="مصدر المحتوى">
            <input
              required
              value={editing.content.source}
              onChange={(e) => content("source", e.target.value)}
            />
          </Field>
          <Field label="حقوق الاستخدام">
            <select
              value={editing.content.rights}
              onChange={(e) => content("rights", e.target.value)}
            >
              <option value="original">محتوى أصلي</option>
              <option value="licensed">محتوى مرخّص</option>
            </select>
          </Field>
          {editing.content.rights === "licensed" && (
            <label className="edu-wide">
              توثيق الإذن
              <textarea
                required
                value={editing.content.license}
                onChange={(e) => content("license", e.target.value)}
              />
            </label>
          )}
          <Field label="السماح للطالب بحفظ السؤال">
            <input
              type="checkbox"
              checked={editing.content.allowSave}
              onChange={(e) => content("allowSave", e.target.checked)}
            />
          </Field>
          <div className="edu-wide edu-actions">
            <button className="edu-button" disabled={action.busy}>
              {action.busy ? "جار الحفظ…" : "حفظ السؤال"}
            </button>
            <Btn secondary onClick={() => setPreview(!preview)}>
              معاينة السؤال
            </Btn>
            <Btn secondary onClick={() => setEditing(blankQuestion())}>
              سؤال جديد
            </Btn>
          </div>
        </form>
        {preview && (
          <div className="edu-notice">
            <p>{editing.content.passage}</p>
            <h3>{editing.text || "أدخل نص السؤال"}</h3>
            {editing.content.options.map((o: Row, i: number) => (
              <p key={i}>
                {fmt(i + 1)}. {o.text}
              </p>
            ))}
          </div>
        )}
      </Card>
      <Card title="بنك الأسئلة">
        <QueryState query={q}>
          <Table
            rows={q.data || []}
            columns={[
              {
                key: "text",
                label: "السؤال",
                render: (r) => (
                  <span title={r.text}>
                    {r.text.slice(0, 65)}
                    {r.text.length > 65 ? "…" : ""}
                  </span>
                ),
              },
              { key: "skill", label: "المهارة" },
              {
                key: "status",
                label: "الحالة",
                render: (r) => <Status value={r.status} />,
              },
              { key: "revision", label: "الإصدار" },
            ]}
            actions={(r) => (
              <>
                <Btn
                  secondary
                  onClick={() => {
                    setEditing({ ...r, categoryId: r.category_id });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  تحرير
                </Btn>
                <Btn secondary onClick={() => setVersionId(r.id)}>
                  الإصدارات
                </Btn>
              </>
            )}
          />
        </QueryState>
      </Card>
      {versionId && (
        <Card title="الإصدارات المحفوظة">
          <QueryState query={versions}>
            {versions.data?.map((v) => (
              <div className="edu-row" key={v.id}>
                <span>
                  إصدار {fmt(v.number)} · {date(v.created_at)}
                </span>
                <Btn
                  secondary
                  onClick={() => {
                    if (confirm("استعادة هذا الإصدار كمسودة جديدة؟"))
                      void action.run(() =>
                        api("/questions/" + versionId + "/restore", "POST", {
                          number: v.number,
                        }),
                      );
                  }}
                >
                  استعادة كمسودة
                </Btn>
              </div>
            ))}
          </QueryState>
        </Card>
      )}
      <Card title="استيراد وتصدير محتوى JSON">
        <p>
          ملف يحتوي مصفوفة أسئلة بالتنسيق نفسه. راجع فحص التكرار قبل الاستيراد؛
          الأسئلة تُحفظ كمسودات.
        </p>
        <input
          type="file"
          accept=".json,application/json"
          aria-label="استيراد أسئلة JSON"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 800000) {
              await action.run(async () => {
                throw Error("الملف أكبر من ٨٠٠ كيلوبايت.");
              });
              return;
            }
            await action.run(async () => {
              const rows = JSON.parse(await f.text());
              if (!Array.isArray(rows)) throw Error("اختر مصفوفة JSON.");
              setImported(rows);
              const result = await api<Row>("/questions/import", "POST", {
                questions: rows,
                preview: true,
              });
              setImportReport(result.rows);
              return result;
            }, "اكتمل فحص الملف.");
          }}
        />
        {importReport && (
          <p>
            {fmt(importReport.length)} سؤال ·{" "}
            {fmt(importReport.filter((r) => r.duplicate).length)} مكرر
          </p>
        )}
        <div className="edu-actions">
          <Btn
            disabled={
              !imported ||
              action.busy ||
              !!importReport?.some((r) => r.duplicate)
            }
            onClick={() => {
              if (confirm("استيراد الأسئلة كمسودات؟"))
                void action.run(() =>
                  api("/questions/import", "POST", {
                    questions: imported,
                    preview: false,
                  }),
                );
            }}
          >
            تأكيد الاستيراد
          </Btn>
          <Btn
            secondary
            disabled={!q.data?.length}
            onClick={() =>
              download(
                "aptitude-questions.json",
                JSON.stringify(
                  q.data?.map((r) => ({
                    categoryId: r.category_id,
                    text: r.text,
                    difficulty: r.difficulty,
                    status: "draft",
                    content: r.content,
                  })),
                  null,
                  2,
                ),
                "application/json",
              )
            }
          >
            تصدير المحتوى
          </Btn>
        </div>
      </Card>
    </>
  );
}
function download(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Roles() {
  const q = useData<Row>("/roles"),
    action = useAction(),
    [draft, setDraft] = useState<Row>({});
  return (
    <>
      <Notice action={action} />
      <QueryState query={q}>
        {q.data?.roles.map((r: Row) => (
          <Card key={r.role} title={labels[r.role]}>
            <p>
              تغييرات الدور تسري على الطلبات التالية. لا يمكن منحه صلاحيات خارج
              نطاقه أو ترقيته إلى مدير النظام.
            </p>
            <div className="edu-form">
              {(q.data?.capabilities[r.role] || []).map((p: string) => (
                <label key={p}>
                  <span dir="ltr">{p}</span>
                  <input
                    type="checkbox"
                    checked={(draft[r.role] || r.permissions).includes(p)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [r.role]: e.target.checked
                          ? [...(draft[r.role] || r.permissions), p]
                          : (draft[r.role] || r.permissions).filter(
                              (x: string) => x !== p,
                            ),
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="edu-actions">
              <Btn
                disabled={action.busy}
                onClick={() => {
                  if (confirm("تأكيد تعديل صلاحيات " + labels[r.role] + "؟"))
                    void action.run(() =>
                      api("/roles/" + r.role, "PUT", {
                        permissions: draft[r.role] || r.permissions,
                      }),
                    );
                }}
              >
                حفظ الصلاحيات
              </Btn>
            </div>
          </Card>
        ))}
      </QueryState>
    </>
  );
}
function Settings({ me, room }: { me: Me; room: string }) {
  const schools = useData<Row[]>("/schools"),
    [scope, setScope] = useState(""),
    q = useData<Row>("/settings?scope=" + scope, me.root || !!scope),
    action = useAction();
  const bools: Record<string, string> = {
    registration: "التسجيل مفتوح",
    maintenance: "وضع الصيانة",
    aptitude: "مركز القدرات",
    studentRoom: "غرفة الطلاب",
    teacherRoom: "غرفة المعلم",
    teacherJoinCodes: "السماح للمعلم بإصدار رمز فصل",
    contentReview: "مراجعة المحتوى قبل النشر",
  };
  return (
    <>
      <Notice action={action} />
      <Card title="نطاق الإعدادات">
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          aria-label="نطاق إعدادات المنصة"
        >
          {me.root && <option value="">المنصة بالكامل</option>}
          {!me.root && <option value="">اختر المدرسة</option>}
          {schools.data?.map((s) => (
            <option value={s.id} key={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Card>
      {(me.root || scope) && (
        <QueryState query={q}>
          {q.data && (
            <Card
              title={
                room === "teacher-room"
                  ? "ضبط غرفة المعلم"
                  : room === "student-room"
                    ? "ضبط غرفة الطلاب"
                    : "سياسات المنصة"
              }
            >
              <Form
                fields={[
                  { name: "platformName", label: "اسم المنصة" },
                  { name: "description", label: "الوصف", type: "textarea" },
                  ...Object.entries(bools).map(([name, label]) => ({
                    name,
                    label,
                    type: "checkbox",
                  })),
                  {
                    name: "codeMaxUses",
                    label: "أقصى عدد استخدامات للرمز",
                    type: "number",
                    min: 1,
                    max: 5000,
                  },
                  {
                    name: "codeDays",
                    label: "أقصى عمر للرمز بالأيام",
                    type: "number",
                    min: 1,
                    max: 365,
                  },
                  {
                    name: "reviewDays",
                    label: "إعادة الأخطاء بعد أيام",
                    type: "number",
                    min: 0,
                    max: 90,
                  },
                  {
                    name: "uploadMaxMb",
                    label: "حجم الصور بالميغابايت",
                    type: "number",
                    min: 1,
                    max: 8,
                  },
                  {
                    name: "retentionDays",
                    label: "مدة الاحتفاظ المقترحة بالأيام",
                    type: "number",
                    min: 30,
                    max: 3650,
                  },
                  {
                    name: "supportLink",
                    label: "رابط الدعم HTTPS",
                    type: "url",
                    required: false,
                  },
                ]}
                initial={q.data}
                submit={(v) =>
                  action.run(() =>
                    api("/settings?scope=" + scope, "PUT", {
                      ...v,
                      comments: false,
                    }),
                  )
                }
                action={action}
              />
              <p className="edu-note">
                التعليقات المفتوحة موقوفة. سياسة الاحتفاظ لا تحذف بيانات
                تلقائيًا؛ التنفيذ التشغيلي يحتاج إجراءًا مستقلًا.
              </p>
            </Card>
          )}
        </QueryState>
      )}
    </>
  );
}
function Audit({ me }: { me: Me }) {
  const schools = useData<Row[]>("/schools"),
    [scope, setScope] = useState(""),
    q = useData<Row[]>(
      "/audit?schoolId=" + scope,
      me.root || me.grants.some((g) => g.role === "SUPPORT") || !!scope,
    );
  return (
    <Card title="سجل التدقيق للقراءة فقط">
      <select
        aria-label="مدرسة سجل التدقيق"
        value={scope}
        onChange={(e) => setScope(e.target.value)}
      >
        <option value="">{me.root ? "المنصة" : "اختر المدرسة"}</option>
        {schools.data?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {q.isEnabled && (
        <QueryState query={q}>
          <Table
            rows={q.data || []}
            columns={[
              {
                key: "created_at",
                label: "الوقت",
                render: (r) => date(r.created_at),
              },
              { key: "action", label: "العملية" },
              {
                key: "user_id",
                label: "المنفذ",
                render: (r) => r.user_id?.slice(0, 8) || "النظام",
              },
              {
                key: "details",
                label: "النتيجة / المورد",
                render: (r) =>
                  `${r.details.result || "نجاح"} · ${String(r.details.resource || "").slice(0, 15)}`,
              },
            ]}
          />
        </QueryState>
      )}
    </Card>
  );
}
function Help({ me }: { me: Me }) {
  const q = useData<Row[]>("/help"),
    action = useAction(),
    support = me.root || !!me.permissions?.includes("help.read"),
    content = me.root || !!me.permissions?.includes("faq.write");
  return (
    <>
      <Notice action={action} />
      <Card title="دليل استخدام سريع">
        <div className="edu-grid">
          <div>
            <h3>الانضمام والتعلم</h3>
            <p>
              اختر حساب طالب ثم أدخل رمز المدرسة. إذا كان الرمز يتطلب موافقة،
              انتظر المدير قبل بدء المحتوى المحمي.
            </p>
          </div>
          <div>
            <h3>إدارة الفصول</h3>
            <p>
              مدير النظام يسند المعلم للمدرسة. مدير المدرسة يربط فصلًا ويصدر
              رمزًا. المعلم يراجع نتائج طلاب فصله وينشر تدريبًا.
            </p>
          </div>
        </div>
      </Card>
      <Card title={content ? "إضافة دليل أو بلاغ" : "بلاغ تعليمي خاص"}>
        <Form
          fields={[
            ...(content
              ? [
                  {
                    name: "kind",
                    label: "النوع",
                    options: [
                      { value: "faq", label: "سؤال شائع" },
                      { value: "ticket", label: "بلاغ" },
                    ],
                  },
                ]
              : []),
            { name: "title", label: "العنوان" },
            { name: "body", label: "التفاصيل", type: "textarea" },
            ...(content
              ? [
                  {
                    name: "role",
                    label: "الدور المستهدف",
                    options: ["all", "teacher", "student"].map((v) => ({
                      value: v,
                      label: labels[v] || "الجميع",
                    })),
                  },
                  {
                    name: "status",
                    label: "الحالة",
                    options: [
                      { value: "draft", label: "مسودة" },
                      { value: "published", label: "نشر" },
                    ],
                  },
                ]
              : []),
          ]}
          initial={{
            kind: content ? "faq" : "ticket",
            role: "all",
            status: content ? "draft" : "open",
          }}
          submit={(v) => action.run(() => api("/help", "POST", v))}
          action={action}
        />
        <p className="edu-note">
          البلاغ خاص بحسابك والدعم المخوّل. تجنب كلمات المرور والبيانات الحساسة.
        </p>
      </Card>
      <Card title="الأدلة والبلاغات">
        <QueryState query={q}>
          {!q.data?.length ? (
            <Empty />
          ) : (
            q.data.map((h) => (
              <article className="edu-card" key={h.id}>
                <h3>
                  {h.title} <Status value={h.status} />
                </h3>
                <p>{h.body}</p>
                {h.response && <p>رد الدعم: {h.response}</p>}
                {((support && h.kind === "ticket") ||
                  (content && h.kind === "faq")) && (
                  <Form
                    fields={[
                      {
                        name: "response",
                        label: "رد أو تحديث",
                        type: "textarea",
                      },
                      {
                        name: "status",
                        label: "الحالة",
                        options: (h.kind === "faq"
                          ? ["published", "archived"]
                          : ["open", "resolved"]
                        ).map((v) => ({ value: v, label: labels[v] || v })),
                      },
                    ]}
                    initial={{
                      response: h.response,
                      status: h.kind === "faq" ? "published" : h.status,
                    }}
                    action={action}
                    submit={(v) =>
                      action.run(() => api("/help/" + h.id, "PATCH", v))
                    }
                  />
                )}
              </article>
            ))
          )}
        </QueryState>
      </Card>
    </>
  );
}

export function TeacherEducation() {
  const classes = useData<Row[]>("/classes"),
    [cid, setCid] = useActiveTeacherClass(),
    [tab, setTab] = useState("enrollments"),
    [student, setStudent] = useState(""),
    [studentCode, setStudentCode] = useState<Row | null>(null),
    action = useAction();
  useEffect(() => setStudentCode(null), [cid, tab]);
  useEffect(() => {
    if (classes.data && !classes.data.some((c) => c.id === cid && !c.archived))
      setCid(classes.data.find((c) => !c.archived)?.id || "");
  }, [classes.data, cid]);
  const enroll = useData<Row[]>("/enrollments?classId=" + cid, !!cid),
    reports = useData<Row[]>(
      "/reports?classId=" + cid,
      !!cid && tab === "reports",
    ),
    questions = useData<Row[]>("/questions", tab === "assignments"),
    assignments = useData<Row[]>(
      "/assignments?classId=" + cid,
      !!cid && tab === "assignments",
    ),
    announcements = useData<Row[]>(
      "/announcements?classId=" + cid,
      !!cid && tab === "announcements",
    ),
    followup = useData<Row>(
      "/student/" + student + "/followup?classId=" + cid,
      !!student && !!cid && tab === "reports",
    ),
    [chosen, setChosen] = useState<string[]>([]);
  return (
    <div className="edu-room" style={{ background: "none" }}>
      <Notice action={action} />
      <Card title="اختر الفصل">
        <QueryState query={classes}>
          <select
            aria-label="فصل المتابعة التعليمية"
            disabled={action.busy}
            value={cid}
            onChange={(e) => {
              setCid(e.target.value);
              setStudent("");
            }}
          >
            <option value="">اختر الفصل</option>
            {classes.data
              ?.filter((c) => !c.archived)
              .map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </QueryState>
        <div className="edu-tabs">
          {[
            ["enrollments", "الطلاب والطلبات"],
            ["assignments", "مجموعات القدرات"],
            ["reports", "المتابعة والتقارير"],
            ["announcements", "الإعلانات"],
          ].map(([key, label]) => (
            <button
              className="edu-button secondary"
              aria-pressed={tab === key}
              disabled={action.busy}
              onClick={() => setTab(key)}
              key={key}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>
      {cid && tab === "enrollments" && (
        <>
          <Card title="رمز دخول الطالب">
            <p>
              اكتب اسم الطالب، ثم أنشئ رمزه وسلّمه له بشكل خاص. يدخل بالرمز فقط،
              دون بريد أو كلمة مرور.
            </p>
            {!classes.data?.find((c) => c.id === cid)?.school_id && (
              <p className="edu-note">
                هذا فصل مستقل. سنجهّزه تلقائيًا عند إنشاء أول رمز، دون خطوات ربط
                إضافية.
              </p>
            )}
            <form
              key={cid}
              className="edu-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget,
                  values = new FormData(form);
                const name = String(values.get("name") || "").trim();
                if (!name || action.busy) return;
                void action.run(async () => {
                  const issued = await api<Row>("/student-access", "POST", {
                    classId: cid,
                    name,
                    days: Number(values.get("days") || 30),
                  });
                  setStudentCode(issued);
                  form.reset();
                  return issued;
                }, "رمز الطالب جاهز. انسخه وسلّمه له بشكل خاص.");
              }}
            >
              <label className="edu-wide">
                اسم الطالب
                <input
                  name="name"
                  required
                  maxLength={200}
                  placeholder="مثال: أنس محمد"
                  autoComplete="off"
                  disabled={action.busy}
                />
              </label>
              <details className="edu-wide">
                <summary>خيارات إضافية · الصلاحية الافتراضية 30 يومًا</summary>
                <label>
                  صلاحية الرمز
                  <select name="days" defaultValue="30" disabled={action.busy}>
                    <option value="7">7 أيام</option>
                    <option value="30">30 يومًا</option>
                    <option value="90">90 يومًا</option>
                  </select>
                </label>
              </details>
              <div className="edu-wide">
                <button className="edu-button" disabled={action.busy}>
                  <KeyRound size={16} />
                  {action.busy ? "جار إنشاء الرمز…" : "إنشاء رمز الدخول"}
                </button>
              </div>
            </form>
          </Card>
          {studentCode && (
            <Card title={"رمز دخول " + studentCode.name}>
              <p>
                يظهر هنا مرة واحدة. صالح لمدة {fmt(studentCode.days)} يومًا، وهو
                شخصي لهذا الطالب. تجديد الرمز يلغي السابق والجلسات المفتوحة.
              </p>
              <div
                className="edu-code"
                dir="ltr"
                style={{ overflowWrap: "anywhere", userSelect: "all" }}
                aria-label="رمز دخول الطالب"
              >
                {studentCode.code.match(/.{1,4}/g)?.join("-")}
              </div>
              <div className="edu-actions">
                <Btn
                  secondary
                  onClick={() =>
                    void action.run(async () => {
                      await navigator.clipboard.writeText(studentCode.code);
                      return true;
                    }, "تم نسخ الرمز.")
                  }
                >
                  نسخ الرمز
                </Btn>
                <Link className="edu-button secondary" href="/student-entry">
                  صفحة دخول الطالب
                </Link>
                <Btn secondary onClick={() => setStudentCode(null)}>
                  إخفاء الرمز
                </Btn>
              </div>
            </Card>
          )}
          <EnrollmentImport classId={cid} />
        </>
      )}
      {!cid ? (
        <Empty>
          أضف فصلًا أولًا لتتمكن من إنشاء رموز الطلاب.{" "}
          <Link className="edu-button secondary" href="/teacher/classes">
            إضافة فصل
          </Link>
        </Empty>
      ) : tab === "enrollments" ? (
        <Card title="حسابات الطلاب وطلبات الانضمام">
          <QueryState query={enroll}>
            <Table
              rows={enroll.data || []}
              columns={[
                { key: "name", label: "الطالب" },
                {
                  key: "status",
                  label: "الارتباط",
                  render: (r) => <Status value={r.status} />,
                },
                {
                  key: "created_at",
                  label: "تاريخ الطلب",
                  render: (r) => date(r.created_at),
                },
              ]}
              actions={(r) => (
                <>
                  {r.status === "active" && r.code_managed && (
                    <Btn
                      secondary
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          const issued = await api<Row>(
                            "/student-access",
                            "POST",
                            { classId: cid, enrollmentId: r.id },
                          );
                          setStudentCode(issued);
                          return issued;
                        }, "صدر رمز شخصي جديد؛ أُلغي السابق.")
                      }
                    >
                      إصدار/تجديد رمز الدخول
                    </Btn>
                  )}
                  {r.status === "active" && r.code_managed && (
                    <Btn
                      secondary
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(
                          () => api("/student-access/" + r.id, "DELETE"),
                          "أُوقفت رموز الدخول والجلسات الحالية.",
                        )
                      }
                    >
                      إيقاف رمز الدخول
                    </Btn>
                  )}
                  <Btn
                    secondary
                    onClick={() => {
                      if (
                        confirm(
                          r.status === "active"
                            ? "إلغاء ارتباط الطالب؟ تبقى سجلاته محفوظة."
                            : "الموافقة على انضمام هذا الطالب؟",
                        )
                      )
                        void action.run(() =>
                          api("/enrollments/" + r.id, "PATCH", {
                            status:
                              r.status === "active" ? "revoked" : "active",
                          }),
                        );
                    }}
                  >
                    {r.status === "active" ? "إلغاء الارتباط" : "موافقة"}
                  </Btn>
                  <select
                    aria-label={"نقل " + r.name}
                    defaultValue=""
                    onChange={(e) => {
                      if (
                        e.target.value &&
                        confirm("نقل الطالب إلى الفصل المحدد؟")
                      )
                        void action.run(() =>
                          api("/enrollments/" + r.id, "PATCH", {
                            status: "active",
                            classId: e.target.value,
                          }),
                        );
                      e.target.value = "";
                    }}
                  >
                    <option value="">نقل إلى فصل…</option>
                    {classes.data
                      ?.filter(
                        (c) =>
                          c.id !== cid &&
                          !c.archived &&
                          c.school_id ===
                            classes.data?.find((c) => c.id === cid)?.school_id,
                      )
                      .map((c) => (
                        <option value={c.id} key={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </>
              )}
            />
          </QueryState>
        </Card>
      ) : tab === "assignments" ? (
        <>
          <Card title="مجموعة تدريبية للفصل">
            <p>
              اختر أسئلة منشورة، ثم حدد عنوان التدريب وموعده. لا يظهر إلا لطلاب
              هذا الفصل.
            </p>
            <QueryState query={questions}>
              <div className="edu-table" style={{ maxHeight: 260 }}>
                {questions.data?.map((q) => (
                  <label className="edu-row" key={q.id}>
                    <span>
                      {q.text.slice(0, 80)} <Status value={q.difficulty} />
                    </span>
                    <input
                      type="checkbox"
                      checked={chosen.includes(q.id)}
                      onChange={(e) =>
                        setChosen(
                          e.target.checked
                            ? [...chosen, q.id]
                            : chosen.filter((x) => x !== q.id),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            </QueryState>
            <Form
              fields={[
                { name: "title", label: "عنوان المجموعة" },
                {
                  name: "kind",
                  label: "نوع المجموعة",
                  options: [
                    { value: "training", label: "تدريب تعليمي" },
                    { value: "challenge", label: "تحدٍ بإشراف المعلم" },
                  ],
                },
                {
                  name: "mode",
                  label: "سياسة الحل",
                  options: [
                    { value: "learn", label: "شرح بعد كل إجابة" },
                    { value: "assessed", label: "الحلول بعد إنهاء الاختبار" },
                  ],
                },
                {
                  name: "timeLimit",
                  label: "وقت الحل بالثواني (اختياري)",
                  type: "number",
                  min: 30,
                  max: 14400,
                  required: false,
                },
                { name: "startsAt", label: "تبدأ في", type: "datetime-local" },
                {
                  name: "dueAt",
                  label: "موعد الانتهاء",
                  type: "datetime-local",
                  required: false,
                },
              ]}
              initial={{
                startsAt: new Date().toISOString().slice(0, 16),
                kind: "training",
                mode: "learn",
              }}
              action={action}
              submit={(v) =>
                action.run(() =>
                  api("/assignments", "POST", {
                    ...v,
                    timeLimit: v.timeLimit || null,
                    classId: cid,
                    questionIds: chosen,
                    startsAt: new Date(v.startsAt).toISOString(),
                    dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : null,
                  }),
                )
              }
            />
            <p className="edu-note">{fmt(chosen.length)} سؤال مختار</p>
          </Card>
          <Card title="المجموعات المحفوظة">
            <QueryState query={assignments}>
              <Table
                rows={assignments.data || []}
                columns={[
                  { key: "title", label: "التدريب" },
                  {
                    key: "question_ids",
                    label: "عدد الأسئلة",
                    render: (r) => fmt(r.question_ids.length),
                  },
                  {
                    key: "due_at",
                    label: "الموعد",
                    render: (r) => date(r.due_at),
                  },
                  {
                    key: "archived",
                    label: "الحالة",
                    render: (r) => (r.archived ? "مؤرشف" : "فعال"),
                  },
                ]}
                actions={(r) => (
                  <Btn
                    secondary
                    onClick={() =>
                      void action.run(() =>
                        api("/assignments/" + r.id, "PATCH", {
                          archived: !r.archived,
                        }),
                      )
                    }
                  >
                    {r.archived ? "إعادة تفعيل" : "أرشفة"}
                  </Btn>
                )}
              />
            </QueryState>
          </Card>
        </>
      ) : tab === "announcements" ? (
        <>
          <Card title="إعلان تعليمي للفصل">
            <Form
              fields={[
                { name: "title", label: "العنوان" },
                { name: "body", label: "الإعلان", type: "textarea" },
              ]}
              action={action}
              submit={(v) =>
                action.run(() =>
                  api("/announcements", "POST", { ...v, classId: cid }),
                )
              }
            />
          </Card>
          <Card title="إعلانات الفصل">
            <QueryState query={announcements}>
              {announcements.data?.map((a) => (
                <div className="edu-row" key={a.id}>
                  <div>
                    <strong>{a.title}</strong>
                    <p>{a.body}</p>
                  </div>
                  <Btn
                    secondary
                    onClick={() =>
                      void action.run(() =>
                        api("/announcements/" + a.id, "PATCH", {
                          archived: !a.archived,
                        }),
                      )
                    }
                  >
                    {a.archived ? "إعادة إظهار" : "أرشفة"}
                  </Btn>
                </div>
              ))}
            </QueryState>
          </Card>
        </>
      ) : (
        <>
          <Card title="متابعة مبنية على المحاولات الفعلية">
            <QueryState query={reports}>
              <Table
                rows={reports.data || []}
                columns={[
                  { key: "name", label: "الطالب" },
                  {
                    key: "skills",
                    label: "المهارات",
                    render: (r) => fmt(r.skills.length),
                  },
                  {
                    key: "sessions",
                    label: "جلسات مكتملة",
                    render: (r) =>
                      fmt(
                        r.sessions.filter((s: Row) => s.status === "completed")
                          .length,
                      ),
                  },
                  {
                    key: "review",
                    label: "تحتاج تقوية",
                    render: (r) =>
                      r.skills
                        .filter((s: Row) => s.level === "review")
                        .map((s: Row) => s.name)
                        .join("، ") || "لا توجد بيانات كافية",
                  },
                ]}
                actions={(r) => (
                  <Btn secondary onClick={() => setStudent(r.user_id)}>
                    ملف المتابعة
                  </Btn>
                )}
              />
              <div className="edu-actions">
                <Btn secondary onClick={() => window.print()}>
                  طباعة التقرير
                </Btn>
                <Btn
                  secondary
                  onClick={() =>
                    void action.run(async () => {
                      await api("/reports?classId=" + cid);
                      download(
                        "class-progress.csv",
                        "\ufeffالطالب,المهارة,المحاولات,الصحيحة\n" +
                          (reports.data || [])
                            .flatMap((r) =>
                              r.skills.map((s: Row) =>
                                [r.name, s.name, s.attempts, s.correct]
                                  .map(csvCell)
                                  .join(","),
                              ),
                            )
                            .join("\n"),
                      );
                      return true;
                    }, "تم تصدير التقرير المخوّل لك.")
                  }
                >
                  تصدير CSV
                </Btn>
              </div>
            </QueryState>
          </Card>
          {student && (
            <QueryState query={followup}>
              <Card title="الخطة الفردية والملاحظات الخاصة">
                <Skills rows={followup.data?.progress?.skills || []} />
                <Form
                  fields={[
                    {
                      name: "kind",
                      label: "نوع المتابعة",
                      options: [
                        { value: "plan", label: "خطة تظهر للطالب" },
                        { value: "teacher-note", label: "ملاحظة خاصة للمعلم" },
                      ],
                    },
                    { name: "title", label: "العنوان" },
                    {
                      name: "note",
                      label: "الخطة أو الملاحظة",
                      type: "textarea",
                    },
                    {
                      name: "target",
                      label: "هدف المحاولات",
                      type: "number",
                      min: 1,
                      max: 500,
                    },
                  ]}
                  initial={{ kind: "plan", target: 10 }}
                  action={action}
                  submit={(v) =>
                    action.run(() =>
                      api("/personal", "POST", {
                        kind: v.kind,
                        userId: student,
                        data: {
                          title: v.title,
                          note: v.note,
                          target: v.target,
                        },
                      }),
                    )
                  }
                />
                {followup.data?.plans.map((p: Row) => (
                  <p key={p.id}>
                    <Status value={p.kind} />
                    {p.data.title} · {p.data.note}
                  </p>
                ))}
              </Card>
            </QueryState>
          )}
        </>
      )}
    </div>
  );
}
function Skills({ rows }: { rows: Row[] }) {
  if (!rows.length)
    return <Empty>خريطة مهاراتك تبدأ بعد أول إجابة فعلية.</Empty>;
  return (
    <div className="edu-grid">
      {rows.map((s) => (
        <article className="edu-card" key={s.id}>
          <span className="edu-eyebrow">{labels[s.track]}</span>
          <h3>{s.name}</h3>
          <div className="edu-progress">
            <span style={{ width: s.accuracy + "%" }} />
          </div>
          <div className="edu-row">
            <strong>{fmt(s.accuracy)}٪</strong>
            <Status value={s.level} />
          </div>
          <p>{s.reason}</p>
          {s.recentAccuracy !== null && (
            <p>
              آخر خمس محاولات: {fmt(s.recentAccuracy)}٪
              {s.previousAccuracy !== null
                ? " · الخمس السابقة: " + fmt(s.previousAccuracy) + "٪"
                : ""}
            </p>
          )}
          <small className="edu-note">
            متوسط وقت الإجابة: {fmt(s.average_seconds)} ثانية.
          </small>
        </article>
      ))}
    </div>
  );
}
export function RoomContent() {
  const q = useData<Row[]>("/room-content");
  if (!q.data?.length) return null;
  return (
    <section className="edu-room" style={{ background: "none" }}>
      <Card title="المحتوى المتاح لك">
        <div className="edu-grid">
          {q.data.map((c) => (
            <article className="edu-card" key={c.id}>
              <BookOpen size={22} color="#bca7ff" />
              <h3>{c.name}</h3>
              <p>{c.description}</p>
              {c.link && (
                <Link className="edu-button secondary" href={c.link}>
                  فتح القسم <ArrowUpRight size={16} />
                </Link>
              )}
            </article>
          ))}
        </div>
      </Card>
    </section>
  );
}
export function TeacherEducationSummary() {
  const q = useData<Row>("/teacher-summary");
  if (!q.data) return null;
  return (
    <section className="tw-card tw-spaced">
      <h2>الربط المدرسي والقدرات</h2>
      <p className="tw-muted tw-spaced">
        {fmt(q.data.pending)} طلب انضمام بانتظار المراجعة ·{" "}
        {fmt(q.data.upcoming.length)} تدريب قريب.
      </p>
      {q.data.alerts.length > 0 && (
        <p className="tw-muted">
          {fmt(q.data.alerts.length)} طالب لم يسجل محاولة خلال{" "}
          {fmt(q.data.inactivityDays)} يومًا منذ آخر نشاط. راجع الظروف والخطة
          قبل أي قرار.
        </p>
      )}
      <Link className="tw-button primary tw-spaced" href="/teacher/education">
        فتح المتابعة التعليمية
      </Link>
      <RoomContent />
    </section>
  );
}
function EnrollmentImport({ classId }: { classId: string }) {
  const me = useData<Me>("/me"),
    classes = useData<Row[]>("/classes"),
    action = useAction(),
    [rows, setRows] = useState<{ email: string }[]>([]),
    [report, setReport] = useState<Row | null>(null);
  const school = classes.data?.find((c) => c.id === classId)?.school_id;
  if (
    !me.data?.root &&
    !me.data?.grants.some(
      (g) => g.role === "SCHOOL_ADMIN" && g.scope === school,
    )
  )
    return null;
  return (
    <Card title="ربط طلاب مسجلين عبر CSV">
      <Notice action={action} />
      <p>
        ملف بعمود واحد اسمه email، لحسابات طلاب موجودة. يُراجع الملف بالكامل قبل
        ربطهم بالفصل.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="ملف حسابات الطلاب CSV"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setReport(null);
          await action.run(async () => {
            if (file.size > 128000) throw Error("الملف أكبر من الحد المسموح.");
            const lines = (await file.text())
              .replace(/^\uFEFF/, "")
              .split(/\r?\n/)
              .filter((x) => x.trim());
            if (lines.shift()?.trim().toLowerCase() !== "email")
              throw Error("يجب أن يبدأ الملف بعمود email.");
            const records = lines.map((email) => ({
              email: email.trim().replace(/^"|"$/g, ""),
            }));
            setRows(records);
            const result = await api<Row>("/enrollments/import", "POST", {
              classId,
              rows: records,
              preview: true,
            });
            setReport(result);
            return result;
          }, "اكتمل فحص الصفوف.");
        }}
      />
      {report && (
        <>
          <p>
            {fmt(report.valid)} صف صالح من {fmt(report.rows.length)}
          </p>
          <Table
            rows={report.rows}
            columns={[
              { key: "row", label: "الصف" },
              { key: "email", label: "الحساب" },
              {
                key: "error",
                label: "المراجعة",
                render: (r) => r.error || "صالح",
              },
            ]}
          />
          <div className="edu-actions">
            <Btn
              disabled={action.busy || report.valid !== rows.length}
              onClick={() => {
                if (confirm("ربط " + rows.length + " حساب طالب بالفصل المحدد؟"))
                  void action.run(
                    () =>
                      api("/enrollments/import", "POST", {
                        classId,
                        rows,
                        preview: false,
                      }),
                    "تم ربط الطلاب.",
                  );
              }}
            >
              تأكيد الربط
            </Btn>
          </div>
        </>
      )}
    </Card>
  );
}
function StudentWorkspace({
  me,
  section,
  navigate,
}: {
  me: Me;
  section: string;
  navigate: (key: string) => void;
}) {
  const action = useAction(),
    [session, setSession] = useState("");
  useEffect(() => setSession(""), [section]);
  if (section === "help") return <Help me={me} />;
  if (!me.settings.studentRoom || me.settings.maintenance)
    return (
      <Empty>غرفة الطالب غير متاحة حاليًا. راجع مدرستك أو مركز المساعدة.</Empty>
    );
  if (!me.memberships.length)
    return (
      <>
        <Notice action={action} />
        <Card title="اربط حسابك بالمدرسة">
          {!!me.pending?.length && (
            <p className="edu-notice">
              لديك طلب انضمام بانتظار موافقة المدرسة.
            </p>
          )}
          <p>
            أدخل الرمز الذي سلّمته لك المدرسة. لا يفتح المحتوى المحمي قبل إكمال
            الربط والموافقة عند طلبها.
          </p>
          <Form
            fields={[{ name: "code", label: "رمز الانضمام" }]}
            action={action}
            submit={(v) =>
              action.run(
                () => api("/join", "POST", v),
                "تم تسجيل الطلب. إن كان الرمز يتطلب موافقة، راجع مدرستك.",
              )
            }
            button="انضم إلى فصلي"
          />
        </Card>
      </>
    );
  if (session)
    return (
      <Practice
        key={session}
        sessionId={session}
        close={() => setSession("")}
      />
    );
  if (section === "home")
    return (
      <>
        <DailySmartQuestCard navigate={navigate} />
        <h2 className="sa-school-heading">مدرستي وأنشطتي</h2>
        <StudentHome start={setSession} navigate={navigate} />
      </>
    );
  if (section === "academy") return <StudentAcademy key="academy" />;
  if (section === "foundation-history")
    return <StudentAcademy key="foundation-history" view="history" />;
  if (section === "foundation-progress")
    return <StudentAcademy key="foundation-progress" view="analytics" />;
  if (section === "class-activities") return <ClassActivitiesTab/>;
  if (section === "flashcards") return <MistakeFlashcardsView/>;
  if (section === "downloads") return <StudentDownloads />;
  if (section === "plan" || section === "goals") return <><StudentStudy view="plan"/><details className="edu-card"><summary>أهدافي وخطتي المسجلة سابقًا</summary><Personal section="goals"/></details></>;
  if (section === "plan" || section === "rooms" || section === "achievements")
    return <StudentStudy key={section} view={section} />;
  if (section === "mistakes")
    return (
      <>
        <StudentMistakeHub />
        <details className="edu-card" style={{ marginTop: 25 }}>
          <summary>ملاحظات أخطاء الأنشطة السابقة</summary>
          <Personal section="mistakes" />
        </details>
      </>
    );
  if (section === "aptitude") return <QuantWorkspace />;
  if (section === "progress" || section === "history")
    return (
      <QuantWorkspace
        key={section}
        initialTab={section === "history" ? "history" : "analytics"}
      />
    );
  return <Personal section={section} />;
}
function StudentMistakeHub() {
  const [cards,setCards]=useState(false);
  const [source, setSource] = useState("mufakir");
  return (
    <div className="sa-workspace">
      <div className="edu-tabs" role="group" aria-label="طريقة عرض الأخطاء"><button className="edu-button secondary" aria-pressed={!cards} onClick={()=>setCards(false)}>قائمة الأخطاء</button><button className="edu-button secondary" aria-pressed={cards} onClick={()=>setCards(true)}>بطاقات المراجعة السريعة (Flashcards)</button></div>{cards?<MistakeFlashcardsView/>:<><div className="edu-tabs" role="group" aria-label="مصدر أخطاء المراجعة">
        <button
          className="edu-button secondary"
          aria-pressed={source === "mufakir"}
          onClick={() => setSource("mufakir")}
        >
          أسئلة المفكر
        </button>
        <button
          className="edu-button secondary"
          aria-pressed={source === "academy"}
          onClick={() => setSource("academy")}
        >
          تدريبات التأسيس
        </button>
      </div>
      {source === "mufakir" ? (
        <QuantWorkspace key="notebook" initialTab="notebook" compact />
      ) : (
        <AcademyMistakes />
      )}</>}
    </div>
  );
}
function StudentHome({ start,navigate }: { start: (id: string) => void;navigate:(key:string)=>void }) {
  const q = useData<Row>("/student-home"),
    p = useData<Row[]>("/personal"),
    action = useAction();
  const skills = q.data?.progress?.skills || [],
    answers = skills.reduce((sum: number, s: Row) => sum + s.attempts, 0),
    correct = skills.reduce((sum: number, s: Row) => sum + s.correct, 0);
  return (
    <QueryState query={q}>
      <RoomContent />
      <div className="edu-grid">
        <Card title="مدرستي وفصلي">
          {q.data?.memberships.map((m: Row) => (
            <div key={m.id} className="edu-row">
              <div>
                <strong>{m.school_name}</strong>
                <small>{m.class_name}</small>
              </div>
              <Status value="active" />
            </div>
          ))}
        </Card>
        <Card title="خطتي الحالية">
          {p.data
            ?.filter((x) => ["plan", "goal"].includes(x.kind))
            .slice(0, 3)
            .map((x) => (
              <div key={x.id}>
                <h3>{x.data.title}</h3>
                <p>{x.data.note}</p>
                <Status value={x.data.completed ? "completed" : "active"} />
              </div>
            ))}
          {!p.data?.some((x) => ["plan", "goal"].includes(x.kind)) && (
            <p>ضع هدفًا أسبوعيًا من «الأهداف والخطة»، أو انتظر خطة معلمك.</p>
          )}
        </Card>
      </div>
      <Notice action={action} />
      <Card title="أنشطتي ومواعيدي">
        <div className="edu-grid">
          {q.data?.activities.map((a: Row) => (
            <article className="edu-card" key={a.id}>
              <BookOpen color="#bca7ff" />
              <h3>{a.title}</h3>
              <p>موعد التسليم: {date(a.due_at)}</p>
              <Link
                className="edu-button"
                href={"/student?studentTab=class-activities&activity="+a.id+"&enrollmentId="+a.enrollment_id} onClick={event=>{event.preventDefault();navigate("class-activities");const u=new URL(location.href);u.searchParams.set("activity",a.id);u.searchParams.set("enrollmentId",a.enrollment_id);history.replaceState(history.state,"",u);}}
              >
                فتح النشاط <ArrowUpRight size={17} />
              </Link>
            </article>
          ))}
          {q.data?.tasks.map((t: Row) => (
            <article className="edu-card" key={t.id}>
              <ClipboardList color="#80dfc9" />
              <h3>{t.title}</h3>
              <p>
                {t.className} · {date(t.dueAt)}
              </p>
              <Status value={t.status} />
            </article>
          ))}
        </div>
        {!q.data?.activities.length && !q.data?.tasks.length && (
          <Empty>لا توجد مهام أو أنشطة مسندة بعد.</Empty>
        )}
      </Card>
      <Card title="إعلانات الفصل">
        {!q.data?.announcements.length ? (
          <Empty>لا توجد إعلانات جديدة.</Empty>
        ) : (
          q.data.announcements.map((a: Row) => (
            <div className="edu-row" key={a.id}>
              <div>
                <h3>{a.title}</h3>
                <p>{a.body}</p>
              </div>
              <Bell color="#bca7ff" size={20} />
            </div>
          ))
        )}
      </Card>
      <Card title="الأسبوع والتقدم">
        <Timeline rows={q.data?.progress?.timeline || []} />
      </Card>
      <Card title="لوحة إنجازك الشخصية">
        <div className="edu-actions">
          {answers > 0 && <Status value="أول خطوة تعلم مسجلة" />}
          {answers >= 10 && <Status value="عشر محاولات تعلم فعلية" />}
          {skills.some((s: Row) => s.level === "mastered") && (
            <Status value="مهارة متقنة من التدريب" />
          )}
          <span className="edu-note">
            {fmt(
              (q.data?.progress?.timeline || []).filter(
                (r: Row) =>
                  new Date(r.day).getTime() >= Date.now() - 7 * 86400000,
              ).length,
            )}{" "}
            أيام تعلم هذا الأسبوع، دون عقوبة عند التوقف.
          </span>
        </div>
      </Card>
      <Card title="الخطوة التالية المقترحة">
        {!skills.filter((s: Row) => s.level === "review").length ? (
          <p>أكمل عدة محاولات في المهارة نفسها حتى تتكون صورة أوضح عن تقدمك.</p>
        ) : (
          skills
            .filter((s: Row) => s.level === "review")
            .slice(0, 3)
            .map((s: Row) => (
              <div className="edu-row" key={s.id}>
                <div>
                  <strong>{s.name}</strong>
                  <small>{s.reason}</small>
                </div>
                <Btn
                  onClick={() =>
                    void action.run(async () => {
                      const r = await api<Row>("/practice", "POST", {
                        track: s.track,
                        categoryId: s.id,
                        mode: "skill",
                        count: 5,
                      });
                      start(r.id);
                      return r;
                    }, "بدأ تدريب مركّز.")
                  }
                >
                  تدريب مركّز
                </Btn>
              </div>
            ))
        )}
      </Card>
    </QueryState>
  );
}
function Aptitude({ start }: { start: (id: string) => void }) {
  const cats = useData<Row[]>("/categories"),
    assignments = useData<Row[]>("/assignments"),
    action = useAction(),
    [track, setTrack] = useState("quantitative"),
    [category, setCategory] = useState("");
  return (
    <>
      <Notice action={action} />
      <Card title="اختر مسارك">
        <div className="edu-tabs">
          {["quantitative"].map((t) => (
            <button
              className="edu-button secondary"
              aria-pressed={track === t}
              key={t}
              onClick={() => {
                setTrack(t);
                setCategory("");
              }}
            >
              {labels[t]}
            </button>
          ))}
        </div>
        <p>
          أسئلة تدريبية أصلية أو مرخّصة. النتائج وصف لمحاولاتك الحالية وليست
          توقعًا مضمونًا لاختبار رسمي.
        </p>
        <Form
          fields={[
            {
              name: "mode",
              label: "نوع التدريب",
              options: ["diagnostic", "skill", "mock", "review"].map((v) => ({
                value: v,
                label: v === "review" ? "مراجعة الأخطاء" : labels[v],
              })),
            },
            {
              name: "categoryId",
              label: "المهارة (اختياري)",
              required: false,
              options: (cats.data || [])
                .filter((c) => c.track === track)
                .map((c) => ({ value: c.id, label: c.name })),
            },
            {
              name: "count",
              label: "عدد الأسئلة",
              type: "number",
              min: 1,
              max: 120,
            },
            {
              name: "timeLimit",
              label: "مؤقت بالثواني (اختياري)",
              type: "number",
              min: 30,
              max: 14400,
              required: false,
            },
          ]}
          initial={{ mode: "skill", count: 10, categoryId: category }}
          action={action}
          submit={async (v) => {
            const r = await action.run(
              () =>
                api<Row>("/practice", "POST", {
                  ...v,
                  track,
                  timeLimit: v.timeLimit || null,
                  categoryId: v.categoryId || undefined,
                }),
              "بدأ التدريب.",
            );
            if (r) start(r.id);
          }}
          button="ابدأ التدريب"
        />
      </Card>
      <QueryState query={cats}>
        <div className="edu-grid">
          {cats.data
            ?.filter((c) => c.track === track)
            .map((c) => (
              <Card title={c.name} key={c.id}>
                <p>
                  {c.description ||
                    "تدريب على هذه المهارة من بنك المحتوى المنشور."}
                </p>
                <Btn secondary onClick={() => setCategory(c.id)}>
                  اختيار المهارة
                </Btn>
              </Card>
            ))}
        </div>
      </QueryState>
      <Card title="مجموعات التدريب المسندة">
        <QueryState query={assignments}>
          {!assignments.data?.length ? (
            <Empty>معلمك لم يسند مجموعة قدرات بعد.</Empty>
          ) : (
            assignments.data.map((a) => (
              <div className="edu-row" key={a.id}>
                <div>
                  <strong>{a.title}</strong>
                  <small>
                    {a.class_name} · {date(a.due_at)}
                  </small>
                </div>
                <Btn
                  onClick={() =>
                    void action.run(async () => {
                      const r = await api<Row>("/practice", "POST", {
                        track,
                        assignmentId: a.id,
                        mode: "mock",
                      });
                      start(r.id);
                      return r;
                    }, "بدأ التدريب المسند.")
                  }
                >
                  فتح التدريب
                </Btn>
              </div>
            ))
          )}
        </QueryState>
      </Card>
    </>
  );
}
function Progress({
  history,
  start,
}: {
  history: boolean;
  start: (id: string) => void;
}) {
  const q = useData<Row>("/progress");
  return (
    <QueryState query={q}>
      {!history ? (
        <>
          <Skills rows={q.data?.skills || []} />
          <Card title="تقدمك عبر الزمن">
            <Timeline rows={q.data?.timeline || []} />
          </Card>
        </>
      ) : (
        <Card title="جلساتك التدريبية">
          <Table
            rows={q.data?.sessions || []}
            columns={[
              {
                key: "mode",
                label: "التدريب",
                render: (r) => <Status value={r.mode} />,
              },
              {
                key: "status",
                label: "الحالة",
                render: (r) => <Status value={r.status} />,
              },
              {
                key: "created_at",
                label: "التاريخ",
                render: (r) => date(r.created_at),
              },
            ]}
            actions={(r) => (
              <Btn secondary onClick={() => start(r.id)}>
                {r.status === "completed" ? "عرض النتيجة" : "استكمال"}
              </Btn>
            )}
          />
        </Card>
      )}
    </QueryState>
  );
}
function Practice({
  sessionId,
  close,
}: {
  sessionId: string;
  close: () => void;
}) {
  const q = useData<Row>("/practice/" + sessionId),
    action = useAction(),
    [index, setIndex] = useState(0),
    [selected, setSelected] = useState<number | null>(null),
    [feedback, setFeedback] = useState<Row | null>(null),
    [note, setNote] = useState(""),
    [cause, setCause] = useState("concept"),
    [finishOpen, setFinishOpen] = useState(false),
    [clock, setClock] = useState(0),
    [started] = useState(Date.now);
  const s = q.data,
    question = s?.questions?.[index],
    answer = s?.answers?.find((a: Row) => a.question_id === question?.id);
  useEffect(() => {
    setSelected(answer?.selected ?? null);
    if (s?.status !== "completed") setFeedback(null);
  }, [question?.id]);
  useEffect(() => setClock(0), [s?.elapsed]);
  useEffect(() => {
    const t = setInterval(() => setClock((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsedNow = (s?.elapsed || 0) + (s?.status === "active" ? clock : 0),
    remaining = s?.timeLimit ? Math.max(0, s.timeLimit - elapsedNow) : null;
  useEffect(() => {
    if (s?.status === "active" && remaining === 0 && !action.busy)
      void action.run(
        () => api("/practice/" + sessionId, "PATCH", { action: "complete" }),
        "انتهى الوقت؛ حُفظت الإجابات.",
      );
  }, [remaining, s?.status]);
  return (
    <>
      <div className="edu-toolbar">
        <Btn secondary onClick={close}>
          العودة لمساحتي
        </Btn>
        <span className="edu-tag">
          {remaining !== null
            ? "الوقت المتبقي: " + fmt(remaining) + " ثانية"
            : "تدريب دون مؤقت"}
        </span>
        <Status value={s?.status || "active"} />
      </div>
      <Notice action={action} />
      <Dialog open={finishOpen} onOpenChange={setFinishOpen}>
        <DialogContent dir="rtl">
          <DialogTitle>إنهاء التدريب؟</DialogTitle>
          <DialogDescription>
            ستُحفظ إجاباتك وتظهر النتيجة مع الشرح. يمكنك العودة لنتيجتك من
            تدريباتك السابقة.
          </DialogDescription>
          <DialogFooter>
            <Btn secondary onClick={() => setFinishOpen(false)}>
              أكمل التدريب
            </Btn>
            <Btn
              disabled={action.busy}
              onClick={() => {
                setFinishOpen(false);
                void action.run(
                  () =>
                    api("/practice/" + sessionId, "PATCH", {
                      action: "complete",
                    }),
                  "اكتمل التدريب.",
                );
              }}
            >
              تأكيد التسليم
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <QueryState query={q}>
        {s?.status === "completed" ? (
          <>
            <div className="edu-kpis">
              <Card>
                <strong className="edu-question">
                  {fmt(s.score.correct)} / {fmt(s.score.total)}
                </strong>
                <p>إجابات صحيحة</p>
              </Card>
              <Card>
                <strong className="edu-question">
                  {s.score.total
                    ? fmt(Math.round((s.score.correct * 100) / s.score.total)) +
                      "٪"
                    : "—"}
                </strong>
                <p>دقة هذا التدريب</p>
              </Card>
            </div>
            <Card title="مراجعة الإجابات">
              {s.questions.map((question: Row) => {
                const solution = s.solutions.find(
                    (x: Row) => x.id === question.id,
                  ),
                  answer = s.answers.find(
                    (x: Row) => x.question_id === question.id,
                  );
                return (
                  <div className="edu-card" key={question.id}>
                    <h3>{question.text}</h3>
                    <Status
                      value={
                        answer?.correct
                          ? "completed"
                          : answer
                            ? "تحتاج مراجعة"
                            : "لم تجب"
                      }
                    />
                    <p>الإجابة: {question.options[solution.answer]}</p>
                    <p>{solution.explanation}</p>
                    <div className="edu-actions">
                      <Btn
                        secondary
                        disabled={!question.canSave}
                        onClick={() =>
                          void action.run(() =>
                            api("/personal", "POST", {
                              kind: "bookmark",
                              questionId: question.id,
                              data: { title: "سؤال محفوظ" },
                            }),
                          )
                        }
                      >
                        حفظ السؤال
                      </Btn>
                      {answer && !answer.correct && (
                        <Btn
                          secondary
                          disabled={!question.canSave}
                          onClick={() => {
                            setIndex(s.questions.indexOf(question));
                            setFeedback({ questionId: question.id });
                          }}
                        >
                          إضافة إلى دفتر الأخطاء
                        </Btn>
                      )}
                    </div>
                  </div>
                );
              })}
            </Card>
            {feedback?.questionId && (
              <Card title="لماذا حدث الخطأ؟">
                <Field label="تصنيف الخطأ">
                  <select
                    value={cause}
                    onChange={(e) => setCause(e.target.value)}
                  >
                    {["concept", "calculation", "reading", "time", "other"].map(
                      (v) => (
                        <option value={v} key={v}>
                          {labels[v]}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
                <Field label="ملاحظتك الخاصة">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
                <div className="edu-actions">
                  <Btn
                    onClick={() =>
                      void action.run(
                        () =>
                          api("/personal", "POST", {
                            kind: "mistake",
                            questionId: feedback.questionId,
                            data: { title: "مراجعة السؤال", note, cause },
                          }),
                        "أضيف إلى دفتر أخطائك الخاص.",
                      )
                    }
                  >
                    حفظ الملاحظة
                  </Btn>
                </div>
              </Card>
            )}
          </>
        ) : s?.status === "paused" ? (
          <Card title="التدريب محفوظ">
            <p>يمكنك العودة لاحقًا واستكمال الأسئلة.</p>
            <Btn
              onClick={() =>
                void action.run(
                  () =>
                    api("/practice/" + sessionId, "PATCH", {
                      action: "resume",
                    }),
                  "استؤنف التدريب.",
                )
              }
            >
              استكمال الآن
            </Btn>
          </Card>
        ) : (
          question && (
            <Card>
              <div className="edu-row">
                <span className="edu-eyebrow">
                  {labels[s?.mode]} • السؤال {fmt(index + 1)} من{" "}
                  {fmt(s?.questions.length)}
                </span>
                <Status value={question.difficulty} />
              </div>
              <div className="edu-progress">
                <span
                  style={{
                    width:
                      ((s?.answers.length || 0) * 100) /
                        (s?.questions.length || 1) +
                      "%",
                  }}
                />
              </div>
              {question.passage && <p>{question.passage}</p>}
              <h2 className="edu-question">{question.text}</h2>
              <div role="group" aria-label="اختيارات الإجابة">
                {question.options.map((o: string, i: number) => (
                  <button
                    type="button"
                    disabled={!!answer || action.busy}
                    className="edu-option"
                    key={i}
                    aria-pressed={selected === i}
                    onClick={() => setSelected(i)}
                  >
                    {fmt(i + 1)}. {o}
                  </button>
                ))}
              </div>
              {feedback && (
                <p className="edu-notice">
                  {feedback.correct
                    ? "إجابة صحيحة."
                    : "راجع الشرح ثم أكمل التعلم."}{" "}
                  {feedback.explanation} {feedback.optionExplanation}
                </p>
              )}
              <div className="edu-actions">
                <Btn
                  disabled={selected === null || !!answer || action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      const r = await api<Row>(
                        "/practice/" + sessionId + "/answer",
                        "POST",
                        {
                          questionId: question.id,
                          selected,
                          seconds: Math.floor((Date.now() - started) / 1000),
                        },
                      );
                      setFeedback(r);
                      return r;
                    }, "حُفظت الإجابة.")
                  }
                >
                  تأكيد الإجابة
                </Btn>
                <Btn
                  secondary
                  disabled={!index}
                  onClick={() => setIndex(index - 1)}
                >
                  السابق
                </Btn>
                <Btn
                  secondary
                  disabled={index >= s!.questions.length - 1}
                  onClick={() => setIndex(index + 1)}
                >
                  التالي
                </Btn>
                {!s?.timeLimit && (
                  <Btn
                    secondary
                    onClick={() =>
                      void action.run(
                        () =>
                          api("/practice/" + sessionId, "PATCH", {
                            action: "pause",
                          }),
                        "حُفظ التدريب للاستكمال.",
                      )
                    }
                  >
                    إيقاف وحفظ
                  </Btn>
                )}
                <Btn secondary onClick={() => setFinishOpen(true)}>
                  إنهاء التدريب
                </Btn>
              </div>
            </Card>
          )
        )}
      </QueryState>
    </>
  );
}
function Personal({ section }: { section: string }) {
  const [cards,setCards]=useState(false);
  const q = useData<Row[]>("/personal"),
    progress = useData<Row>("/progress"),
    action = useAction();
  const kind =
    section === "mistakes"
      ? "mistake"
      : section === "bookmarks"
        ? "bookmark"
        : "goal";
  const rows = (q.data || []).filter(
    (p) => p.kind === kind || (section === "goals" && p.kind === "plan"),
  );
  const attempts = (progress.data?.timeline || [])
    .filter((r: Row) => new Date(r.day).getTime() >= Date.now() - 7 * 86400000)
    .reduce((total: number, r: Row) => total + r.attempts, 0);
  return (
    <>
      <Notice action={action} />
      {section==="bookmarks"&&<><button className="edu-button secondary" aria-pressed={cards} onClick={()=>setCards(v=>!v)}>{cards?"عرض القائمة":"بطاقات المراجعة السريعة (Flashcards)"}</button>{cards&&<MistakeFlashcardsView initialSource="saved"/>}</>}
      {section === "goals" && (
        <Card title="هدف أسبوعي وخطة قبل الاختبار">
          <Form
            fields={[
              { name: "title", label: "الهدف" },
              {
                name: "note",
                label: "خطوات صغيرة قابلة للتنفيذ",
                type: "textarea",
              },
              {
                name: "buildSchedule",
                label: "إنشاء جدول مراجعة من الموعد والوقت اليومي",
                type: "checkbox",
              },
              {
                name: "target",
                label: "عدد محاولات هذا الأسبوع",
                type: "number",
                min: 1,
                max: 500,
              },
              {
                name: "dueAt",
                label: "موعد الاختبار أو الهدف",
                type: "datetime-local",
                required: false,
              },
              {
                name: "dailyMinutes",
                label: "الوقت اليومي بالدقائق",
                type: "number",
                min: 5,
                max: 240,
              },
            ]}
            initial={{ target: 10, dailyMinutes: 20, buildSchedule: true }}
            action={action}
            submit={(v) =>
              action.run(() =>
                api("/personal", "POST", {
                  kind: "goal",
                  data: {
                    ...v,
                    dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : null,
                    steps: String(v.note || "")
                      .split("\n")
                      .filter(Boolean)
                      .slice(0, 30),
                  },
                }),
              )
            }
          />
          <p className="edu-note">
            قسّم وقتك بين مراجعة الشرح والتدريب. عدّل الخطة حسب وقتك؛ لا توجد
            عقوبة على توقف السلسلة.
          </p>
        </Card>
      )}
      <Card
        title={
          kind === "mistake"
            ? "دفتر أخطائك الخاص"
            : kind === "bookmark"
              ? "أسئلتك المحفوظة"
              : "الأهداف والخطط المحفوظة"
        }
      >
        <QueryState query={q}>
          {!rows.length ? (
            <Empty>
              {kind === "mistake"
                ? "أضف ملاحظة من نتيجة تدريب أخطأت فيه."
                : kind === "bookmark"
                  ? "احفظ سؤالًا من شاشة نتيجة التدريب."
                  : "ضع هدفك الأول، أو انتظر خطة معلمك."}
            </Empty>
          ) : (
            rows.map((p) => (
              <article className="edu-card" key={p.id}>
                <h3>{p.text || p.data.title}</h3>
                <p>{p.data.note}</p>
                {kind === "mistake" && <Status value={p.data.cause} />}
                <small className="edu-note">{date(p.created_at)}</small>
                {section === "goals" && (
                  <>
                    <div className="edu-progress">
                      <span
                        style={{
                          width:
                            Math.min(100, (attempts * 100) / p.data.target) +
                            "%",
                        }}
                      />
                    </div>
                    <p>
                      {fmt(attempts)} محاولة فعلية هذا الأسبوع · الهدف{" "}
                      {fmt(p.data.target)}. خصص {fmt(p.data.dailyMinutes)} دقيقة
                      يوميًا.
                    </p>
                    {p.data.dueAt && <p>الموعد: {date(p.data.dueAt)}</p>}
                    {!!p.data.steps?.length && (
                      <ol>
                        {p.data.steps.map((step: string, i: number) => (
                          <li className="edu-note" key={i}>
                            {step}
                          </li>
                        ))}
                      </ol>
                    )}
                    <details>
                      <summary className="edu-note">
                        تعديل الهدف أو الخطة
                      </summary>
                      <Form
                        fields={[
                          { name: "title", label: "العنوان" },
                          { name: "note", label: "الخطة", type: "textarea" },
                          {
                            name: "target",
                            label: "الهدف العددي",
                            type: "number",
                            min: 1,
                            max: 500,
                          },
                          {
                            name: "dailyMinutes",
                            label: "الوقت اليومي بالدقائق",
                            type: "number",
                            min: 5,
                            max: 240,
                          },
                        ]}
                        initial={{
                          title: p.data.title,
                          note: p.data.note,
                          target: p.data.target,
                          dailyMinutes: p.data.dailyMinutes,
                        }}
                        action={action}
                        submit={(v) =>
                          action.run(() =>
                            api("/personal/" + p.id, "PATCH", { data: v }),
                          )
                        }
                      />
                    </details>
                    <Status value={p.data.completed ? "completed" : "active"} />
                  </>
                )}
                <div className="edu-actions">
                  {section === "goals" && (
                    <Btn
                      secondary
                      onClick={() =>
                        void action.run(() =>
                          api("/personal/" + p.id, "PATCH", {
                            completed: !p.data.completed,
                          }),
                        )
                      }
                    >
                      {p.data.completed ? "إعادة فتح" : "وضع علامة إتمام"}
                    </Btn>
                  )}
                  <Btn
                    secondary
                    onClick={() => {
                      if (confirm("أرشفة هذا العنصر من قائمتك؟"))
                        void action.run(() =>
                          api("/personal/" + p.id, "PATCH", { archived: true }),
                        );
                    }}
                  >
                    أرشفة
                  </Btn>
                  {kind === "mistake" && (
                    <Btn
                      secondary
                      onClick={() => {
                        const note = prompt(
                          "عدّل ملاحظتك الخاصة:",
                          p.data.note,
                        );
                        if (note !== null)
                          void action.run(() =>
                            api("/personal/" + p.id, "PATCH", { note }),
                          );
                      }}
                    >
                      تعديل الملاحظة
                    </Btn>
                  )}
                </div>
              </article>
            ))
          )}
        </QueryState>
      </Card>
    </>
  );
}
