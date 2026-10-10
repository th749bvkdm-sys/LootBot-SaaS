import {
  Children,
  cloneElement,
  isValidElement,
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  Archive,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Download,
  FileQuestion,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  ShoppingBag,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  teacherApi,
  uploadTeacherAsset,
  type AccountWorkspace,
  type AttendanceEntry,
  type RosterPreview,
  type TeacherClass,
  type TeacherDashboard,
  type TeacherGrade,
  type TeacherLesson,
  type TeacherProfile,
  type TeacherQuestion,
  type TeacherReminder,
  type TeacherRule,
  type TeacherTask,
  type TeacherStudent,
} from "../lib/teacher-api";
import { BrandMark } from "./brand-mark";
import {
  downloadTeacherCsv,
  normalizeTeacherDigits,
  parseRosterCsv,
  rosterImportPreview,
} from "./teacher-roster-utils";
import "./teacher-workspace.css";

const TeacherExams = lazy(() =>
  import("./teacher-exam-editor").then((module) => ({
    default: module.TeacherExams,
  })),
);
type Icon = typeof Users;
const modules: {
  key: string;
  label: string;
  icon: Icon;
  description: string;
}[] = [
  {
    key: "",
    label: "لوحة المعلم",
    icon: LayoutDashboard,
    description: "نظرة واضحة على يومك وبياناتك المحفوظة.",
  },
  {
    key: "classes",
    label: "فصولي",
    icon: GraduationCap,
    description: "نظّم الفصول والمواد والفصل الدراسي.",
  },
  {
    key: "students",
    label: "كشوف الطلاب",
    icon: Users,
    description: "كشوف خاصة، واستيراد بمراجعة واضحة قبل الحفظ.",
  },
  {
    key: "attendance",
    label: "الحضور والغياب",
    icon: ClipboardCheck,
    description: "سجّل حضور كل فصل واحفظ السجل حسب التاريخ.",
  },
  {
    key: "grades",
    label: "الدرجات والتقييم",
    icon: BarChart3,
    description: "درجات وتقييمات مرتبطة بكل طالب وفصل.",
  },
  {
    key: "exams",
    label: "الاختبارات وأوراق الأسئلة",
    icon: FileQuestion,
    description: "صمّم اختبارًا قابلًا للتعديل والطباعة.",
  },
  {
    key: "tasks",
    label: "الواجبات والمهام",
    icon: CheckCircle2,
    description: "تابع المواعيد والتسليم والتصحيح.",
  },
  {
    key: "lessons",
    label: "التحضير والخطط الدراسية",
    icon: BookOpen,
    description: "خطط محفوظة، قابلة للتعديل والتكرار.",
  },
  {
    key: "questions",
    label: "بنك الأسئلة",
    icon: FileText,
    description: "أسئلتك ووسومك وإجاباتك المرجعية في مكان واحد.",
  },
  {
    key: "reports",
    label: "التقارير والطباعة",
    icon: Printer,
    description: "اطبع الكشوف والحضور والدرجات من بياناتك الفعلية.",
  },
  {
    key: "templates",
    label: "القوالب والتصاميم",
    icon: Copy,
    description: "قوالب طباعة رسمية وابتدائية واقتصادية.",
  },
  {
    key: "automations",
    label: "الأتمتة والتذكيرات",
    icon: Zap,
    description: "قواعد وتذكيرات داخل التطبيق، مع سجل نتيجة التنفيذ.",
  },
  {
    key: "settings",
    label: "إعدادات المعلم",
    icon: Settings2,
    description: "المدرسة والمواد وتفضيلات أوراق الطباعة.",
  },
];
const today = () => new Date().toLocaleDateString("en-CA");
const formatDate = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString("ar-SA", {
        year: "numeric",
        month: "short",
        day: "numeric",
        calendar: "gregory",
      })
    : "غير محدد";
const number = (value: number) => new Intl.NumberFormat("ar-SA").format(value);
const localDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "تعذر إتمام العملية.";
const teacherPath = (key: string) => `/teacher${key ? `/${key}` : ""}`;

function useTeacherData<T>(resource: string, params = "", enabled = true) {
  return useQuery({
    queryKey: ["teacher", resource, params],
    queryFn: () => teacherApi<T>(`/teacher/${resource}${params}`),
    enabled,
    staleTime: 10_000,
  });
}
function useTeacherAction() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  async function run(action: () => Promise<unknown>, message = "تم الحفظ.") {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await action();
      await qc.invalidateQueries({ queryKey: ["teacher"] });
      setSuccess(message);
      return true;
    } catch (caught) {
      setError(errorText(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    run,
    busy,
    error,
    success,
    clear: () => {
      setError("");
      setSuccess("");
    },
  };
}
function Messages({ action }: { action: ReturnType<typeof useTeacherAction> }) {
  return (
    <>
      {action.error && (
        <div role="alert" className="tw-error">
          {action.error}
        </div>
      )}
      {action.success && (
        <div role="status" className="tw-success">
          {action.success}
        </div>
      )}
    </>
  );
}
function Loading() {
  return (
    <div
      className="tw-skeleton-grid"
      aria-label="جار تحميل البيانات"
      aria-busy="true"
    >
      {[0, 1, 2, 3].map((key) => (
        <div className="tw-skeleton" key={key} />
      ))}
    </div>
  );
}
function QueryError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div role="alert" className="tw-error">
      <p>{errorText(error)}</p>
      <button className="tw-button tw-spaced" onClick={retry}>
        <RefreshCw size={16} />
        إعادة المحاولة
      </button>
    </div>
  );
}
function Empty({
  icon: IconComponent = FileText,
  title,
  children,
}: {
  icon?: Icon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="tw-empty">
      <IconComponent size={34} />
      <strong>{title}</strong>
      {children}
    </div>
  );
}
function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  let linked = false;
  const controls = Children.map(children, (child) => {
    if (
      !linked &&
      isValidElement<{ id?: string; "aria-describedby"?: string }>(child) &&
      (child.type === ClassSelect ||
        (typeof child.type === "string" &&
          ["input", "select", "textarea"].includes(child.type)))
    ) {
      linked = true;
      return cloneElement(child, {
        id,
        "aria-describedby": hint ? `${id}-hint` : undefined,
      });
    }
    return child;
  });
  return (
    <div className={`tw-field${wide ? " wide" : ""}`}>
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      {controls}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const id = useId(),
    ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current
      ?.querySelector<HTMLElement>("input,button,select,textarea")
      ?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const controls = Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ) ?? [],
      );
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = priorOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="tw-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className={`tw-modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        ref={ref}
      >
        <header className="tw-modal-header">
          <h2 id={id}>{title}</h2>
          <button
            type="button"
            aria-label="إغلاق"
            className="tw-button tw-icon-button ghost"
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function ClassSelect({
  classes,
  value,
  setValue,
  allowAll = false,
  required = false,
  id,
  "aria-describedby": describedBy,
}: {
  classes: TeacherClass[];
  value: string;
  setValue: (value: string) => void;
  allowAll?: boolean;
  required?: boolean;
  id?: string;
  "aria-describedby"?: string;
}) {
  return (
    <select
      id={id}
      aria-describedby={describedBy}
      required={required}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      aria-label="الفصل"
    >
      <option value="">{allowAll ? "كل الفصول" : "اختر فصلًا"}</option>
      {classes
        .filter((item) => !item.archived)
        .map((item) => (
          <option value={item.id} key={item.id}>
            {item.name} · {item.subject || item.grade}
          </option>
        ))}
    </select>
  );
}

export function AccountSelection() {
  const [, navigate] = useLocation(),
    qc = useQueryClient(),
    action = useTeacherAction();
  const account = useQuery({
    queryKey: ["account-workspace"],
    queryFn: () => teacherApi<AccountWorkspace>("/account/workspace"),
    retry: false,
  });
  useEffect(() => {
    if (account.data?.role === "SUPERADMIN") navigate("/admin");
    else if (account.data?.accountType)
      navigate(
        account.data.accountType === "teacher"
          ? account.data.profileComplete
            ? "/teacher"
            : "/teacher/onboarding"
          : "/dashboard",
      );
  }, [account.data, navigate]);
  const choose = async (accountType: "merchant" | "teacher") => {
    const okay = await action.run(
      () => teacherApi("/account/type", "POST", { accountType }),
      "تم اختيار مساحة العمل.",
    );
    if (!okay) return;
    await qc.invalidateQueries({ queryKey: ["account-workspace"] });
    await qc.invalidateQueries({ queryKey: ["teacher-account"] });
    navigate(accountType === "teacher" ? "/teacher/onboarding" : "/dashboard");
  };
  if (
    account.isLoading ||
    account.data?.accountType ||
    account.data?.role === "SUPERADMIN"
  )
    return (
      <div className="teacher-room tw-onboarding" dir="rtl">
        <div role="status">جار فتح مساحة العمل…</div>
      </div>
    );
  if (account.error)
    return (
      <div className="teacher-room tw-onboarding" dir="rtl">
        <section className="tw-card">
          <h1>سجّل الدخول لاختيار مساحة العمل</h1>
          <p className="tw-muted tw-spaced">{errorText(account.error)}</p>
          <Link href="/login" className="tw-button primary tw-spaced">
            تسجيل الدخول
          </Link>
        </section>
      </div>
    );
  return (
    <div className="teacher-room tw-onboarding" dir="rtl">
      <div className="tw-onboarding-content">
        <div className="tw-brand">
          <BrandMark />
          <div>
            <strong>LootBot</strong>
            <small>مساحة عملك، كما تحتاجها</small>
          </div>
        </div>
        <p className="tw-eyebrow">ابدأ بخيار يناسب عملك</p>
        <h1 style={{ fontSize: "clamp(26px,4vw,38px)", fontWeight: 600 }}>
          كيف ترغب في استخدام LootBot SaaS؟
        </h1>
        <p className="tw-muted tw-spaced">
          يُحفظ الاختيار في حسابك وتظهر لك الأدوات المناسبة عند كل دخول.
        </p>
        <Messages action={action} />
        <div className="tw-choice-grid">
          <button
            className="tw-choice"
            disabled={action.busy}
            onClick={() => void choose("merchant")}
          >
            <ShoppingBag />
            <strong>تاجر</strong>
            <p>إدارة المتجر والبوتات والمنتجات والطلبات.</p>
            <span>
              الانتقال إلى لوحة المتجر <ArrowLeft size={16} />
            </span>
          </button>
          <button
            className="tw-choice"
            disabled={action.busy}
            onClick={() => void choose("teacher")}
          >
            <GraduationCap />
            <strong>معلم</strong>
            <p>أدوات لتنظيم الفصول وكشوف الطلاب والاختبارات والتحضير.</p>
            <span>
              تجهيز غرفة المعلم <ArrowLeft size={16} />
            </span>
          </button>
        </div>
        <p className="tw-muted tw-small tw-spaced">
          لكل حساب مساحة عمل واحدة حاليًا. لا يحذف اختيار المساحة أي بيانات.
        </p>
      </div>
    </div>
  );
}

const initialProfile: TeacherProfile = {
  teacherName: "",
  schoolName: "",
  stage: "ابتدائي",
  subjects: [],
  classes: [],
  term: "",
  year: "",
  city: "",
  printStyle: "formal",
  digits: "arabic",
  paperSize: "A4",
  logoAssetId: null,
  signature: "",
  onboardingStep: 0,
  complete: false,
};
function ProfileForm({ onboarding = false }: { onboarding?: boolean }) {
  const profileQuery = useTeacherData<TeacherProfile>("profile"),
    action = useTeacherAction(),
    [, navigate] = useLocation();
  const qc = useQueryClient();
  const [profile, setProfile] = useState(initialProfile),
    [step, setStep] = useState(0),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (profileQuery.data && !loaded) {
      setProfile(profileQuery.data);
      setStep(Math.min(2, profileQuery.data.onboardingStep));
      setLoaded(true);
    }
  }, [profileQuery.data, loaded]);
  const patch = <K extends keyof TeacherProfile>(
    key: K,
    value: TeacherProfile[K],
  ) => setProfile((previous) => ({ ...previous, [key]: value }));
  const save = async (nextStep: number, complete = false) => {
    if (
      complete &&
      (!profile.teacherName.trim() || !profile.schoolName.trim())
    ) {
      await action.run(async () => {
        throw new Error("أدخل اسم المعلم واسم المدرسة لإتمام الإعداد.");
      });
      return;
    }
    const next = {
      ...profile,
      subjects: profile.subjects.map((value) => value.trim()).filter(Boolean),
      classes: profile.classes.map((value) => value.trim()).filter(Boolean),
      onboardingStep: nextStep,
      complete: complete || profile.complete,
    };
    if (
      await action.run(
        () => teacherApi("/teacher/profile", "PUT", next),
        complete
          ? "اكتمل إعداد غرفة المعلم."
          : "حُفظت بياناتك ويمكنك المتابعة لاحقًا.",
      )
    ) {
      setProfile(next);
      setStep(nextStep);
      if (complete) {
        qc.setQueryData<AccountWorkspace>(["account-workspace"], (previous) =>
          previous ? { ...previous, profileComplete: true } : previous,
        );
        await qc.invalidateQueries({ queryKey: ["account-workspace"] });
      }
      if (complete && onboarding) navigate("/teacher");
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save(
      onboarding ? Math.min(step + 1, 2) : step,
      !onboarding || step === 2,
    );
  };
  if (profileQuery.isLoading) return <Loading />;
  if (profileQuery.error)
    return (
      <QueryError
        error={profileQuery.error}
        retry={() => void profileQuery.refetch()}
      />
    );
  return (
    <form onSubmit={submit} className="tw-card">
      <div className="tw-toolbar">
        <h2>
          {onboarding
            ? ["المعلم والمدرسة", "المواد والفصول", "تفضيلات الطباعة"][step]
            : "ملف المعلم والمدرسة"}
        </h2>
        {onboarding && (
          <span className="tw-status">الخطوة {number(step + 1)} من ٣</span>
        )}
      </div>
      {onboarding && (
        <div className="tw-stepper" aria-label={`الخطوة ${step + 1} من 3`}>
          {[0, 1, 2].map((value) => (
            <span className={value <= step ? "active" : ""} key={value} />
          ))}
        </div>
      )}
      <Messages action={action} />
      <div className="tw-form-grid">
        {(!onboarding || step === 0) && (
          <>
            <Field label="اسم المعلم أو المعلمة *">
              <input
                required
                maxLength={150}
                autoComplete="name"
                value={profile.teacherName}
                onChange={(event) => patch("teacherName", event.target.value)}
              />
            </Field>
            <Field label="اسم المدرسة *">
              <input
                required
                maxLength={200}
                value={profile.schoolName}
                onChange={(event) => patch("schoolName", event.target.value)}
              />
            </Field>
            <Field label="المرحلة الدراسية">
              <select
                value={profile.stage}
                onChange={(event) => patch("stage", event.target.value)}
              >
                {["ابتدائي", "متوسط", "ثانوي", "أخرى"].map((stage) => (
                  <option key={stage}>{stage}</option>
                ))}
              </select>
            </Field>
            <Field label="المدينة (اختياري)">
              <input
                maxLength={120}
                value={profile.city}
                onChange={(event) => patch("city", event.target.value)}
              />
            </Field>
          </>
        )}
        {(!onboarding || step === 1) && (
          <>
            <Field
              label="المواد"
              hint="افصل المواد بفاصلة، مثل: رياضيات، علوم."
            >
              <input
                value={profile.subjects.join("، ")}
                onChange={(event) =>
                  patch(
                    "subjects",
                    event.target.value
                      .split(/[,،]/)
                      .map((value) => value.trim()),
                  )
                }
                maxLength={2000}
              />
            </Field>
            <Field
              label="الفصول التي تدرّسها"
              hint="تُحفظ هنا كتفضيلات. أنشئ الكشوف من صفحة فصولي."
            >
              <input
                value={profile.classes.join("، ")}
                onChange={(event) =>
                  patch(
                    "classes",
                    event.target.value
                      .split(/[,،]/)
                      .map((value) => value.trim()),
                  )
                }
                maxLength={2000}
              />
            </Field>
            <Field label="الفصل الدراسي">
              <input
                value={profile.term}
                onChange={(event) => patch("term", event.target.value)}
                maxLength={80}
                placeholder="الفصل الأول"
              />
            </Field>
            <Field label="العام الدراسي">
              <input
                value={profile.year}
                onChange={(event) =>
                  patch("year", normalizeTeacherDigits(event.target.value))
                }
                maxLength={80}
                placeholder="١٤٤٨ / ١٤٤٩"
              />
            </Field>
          </>
        )}
        {(!onboarding || step === 2) && (
          <>
            <Field label="تصميم الطباعة الافتراضي">
              <select
                value={profile.printStyle}
                onChange={(event) =>
                  patch(
                    "printStyle",
                    event.target.value as TeacherProfile["printStyle"],
                  )
                }
              >
                <option value="formal">رسمي</option>
                <option value="primary">مناسب للمرحلة الابتدائية</option>
                <option value="minimal">اقتصادي للطباعة</option>
              </select>
            </Field>
            <Field label="صيغة الأرقام">
              <select
                value={profile.digits}
                onChange={(event) =>
                  patch(
                    "digits",
                    event.target.value as TeacherProfile["digits"],
                  )
                }
              >
                <option value="arabic">١٢٣ — أرقام عربية</option>
                <option value="western">123 — أرقام غربية</option>
              </select>
            </Field>
            <Field label="مقاس الورق">
              <select value="A4" disabled>
                <option>A4</option>
              </select>
            </Field>
            <Field label="اسم أو سطر التوقيع (اختياري)">
              <input
                value={profile.signature}
                onChange={(event) => patch("signature", event.target.value)}
                maxLength={200}
              />
            </Field>
            <Field
              label="شعار المدرسة (اختياري)"
              hint="صورة PNG أو JPEG أو WebP، حتى ٨ ميغابايت. تُحفظ بصورة خاصة."
            >
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={action.busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    void action.run(async () => {
                      if (file.size > 8 * 1024 * 1024)
                        throw new Error("الصورة أكبر من ٨ ميغابايت.");
                      const asset = await uploadTeacherAsset(file);
                      patch("logoAssetId", asset.id);
                    }, "رُفع الشعار. احفظ الملف لتثبيت التغيير.");
                }}
              />
              {profile.logoAssetId && (
                <div className="tw-toolbar tw-spaced">
                  <img
                    src={`/api/teacher/assets/${encodeURIComponent(profile.logoAssetId)}`}
                    alt="شعار المدرسة"
                    style={{
                      width: 65,
                      height: 65,
                      objectFit: "contain",
                      background: "#fff",
                      borderRadius: 8,
                    }}
                  />
                  <button
                    type="button"
                    className="tw-button ghost"
                    onClick={() => patch("logoAssetId", null)}
                  >
                    إزالة من الملف
                  </button>
                </div>
              )}
            </Field>
          </>
        )}
      </div>
      <div className="tw-modal-footer">
        {onboarding && step > 0 && (
          <button
            type="button"
            className="tw-button"
            onClick={() => void save(step - 1)}
            disabled={action.busy}
          >
            السابق
          </button>
        )}
        <button
          type="button"
          className="tw-button"
          onClick={() => void save(step)}
          disabled={action.busy}
        >
          حفظ التقدم
        </button>
        <button
          className="tw-button primary"
          type="submit"
          disabled={action.busy}
        >
          {action.busy
            ? "جار الحفظ…"
            : onboarding && step < 2
              ? "حفظ ومتابعة"
              : onboarding
                ? "فتح غرفة المعلم"
                : "حفظ التغييرات"}
          <ArrowLeft size={16} />
        </button>
      </div>
      <p className="tw-muted tw-small tw-spaced">
        تفضيلات الطباعة تخص المستندات، ويمكن تغييرها لكل اختبار. بياناتك لا
        تُعرض لأي حساب آخر.
      </p>
    </form>
  );
}
export function TeacherOnboarding() {
  return (
    <div className="teacher-room tw-onboarding" dir="rtl">
      <div className="tw-onboarding-content">
        <div className="tw-brand">
          <BrandMark />
          <div>
            <strong>LootBot</strong>
            <small>غرفة المعلم</small>
          </div>
        </div>
        <header className="tw-heading">
          <div>
            <p className="tw-eyebrow">بداية منظمة</p>
            <h1>لنجهّز غرفة المعلم</h1>
            <p>ثلاث خطوات قصيرة، مع إمكانية حفظ التقدم والعودة لاحقًا.</p>
          </div>
        </header>
        <ProfileForm onboarding />
      </div>
    </div>
  );
}

export function TeacherWorkspace({ section }: { section?: string } = {}) {
  const [path, navigate] = useLocation();
  const key = section ?? path.replace(/^\/teacher\/?/, "").split("/")[0];
  const current = modules.find((module) => module.key === key),
    [menu, setMenu] = useState(false),
    [search, setSearch] = useState("");
  const profile = useTeacherData<TeacherProfile>("profile"),
    reminders = useTeacherData<TeacherReminder[]>("reminders");
  const action = useTeacherAction();
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!menu) return;
    const previous = document.activeElement as HTMLElement | null;
    sidebarRef.current
      ?.querySelector<HTMLElement>(".tw-sidebar-close")
      ?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
      if (event.key !== "Tab") return;
      const controls = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          "a[href],button:not(:disabled)",
        ) ?? [],
      );
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === controls.at(-1)
      ) {
        event.preventDefault();
        controls[0]?.focus();
      }
    };
    const resize = () => {
      if (window.innerWidth >= 800) setMenu(false);
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", resize);
      previous?.focus();
    };
  }, [menu]);
  useEffect(() => {
    setMenu(false);
    setSearch("");
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
    document.title = `${current?.label ?? "غرفة المعلم"} | LootBot`;
  }, [path, current?.label]);
  const logout = async () => {
    if (
      await action.run(
        () => teacherApi("/auth/logout", "POST", {}),
        "تم تسجيل الخروج.",
      )
    ) {
      window.location.assign("/login");
    }
  };
  return (
    <div className="teacher-room" dir="rtl">
      <a href="#teacher-content" className="sr-only focus:not-sr-only">
        انتقل إلى المحتوى
      </a>
      <div className="tw-shell">
        {menu && (
          <button
            aria-label="إغلاق القائمة من الخلفية"
            className="tw-mobile-overlay"
            onClick={() => setMenu(false)}
          />
        )}
        <aside
          ref={sidebarRef}
          className={`tw-sidebar${menu ? " open" : ""}`}
          aria-label="تنقل غرفة المعلم"
        >
          <Link href="/teacher" className="tw-brand">
            <BrandMark />
            <div>
              <strong>LootBot</strong>
              <small>غرفة المعلم</small>
            </div>
          </Link>
          <button
            className="tw-button tw-icon-button tw-menu-button tw-sidebar-close"
            aria-label="إغلاق القائمة"
            onClick={() => setMenu(false)}
          >
            <X size={18} />
          </button>
          <nav className="tw-nav">
            {modules.map((module) => (
              <Link
                key={module.key}
                href={teacherPath(module.key)}
                aria-current={module.key === key ? "page" : undefined}
              >
                <module.icon size={17} />
                <span>{module.label}</span>
              </Link>
            ))}
          </nav>
          <div className="tw-sidebar-bottom">
            <p className="tw-muted tw-small" style={{ padding: "0 12px 10px" }}>
              مساحة خاصة للتعليم والتنظيم
            </p>
            <button
              className="tw-button ghost"
              style={{ width: "100%", justifyContent: "flex-start" }}
              disabled={action.busy}
              onClick={() => void logout()}
            >
              <LogOut size={16} />
              تسجيل الخروج
            </button>
          </div>
        </aside>
        <main id="teacher-content" className="tw-content">
          <header className="tw-topbar" style={{ position: "relative" }}>
            <button
              className="tw-button tw-icon-button tw-menu-button"
              aria-label="فتح القائمة"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Menu size={21} />
            </button>
            <div className="tw-search">
              <Search size={16} />
              <input
                aria-label="البحث عن أداة في غرفة المعلم"
                placeholder="ابحث عن أداة…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setSearch("");
                }}
              />
            </div>
            {search && (
              <div className="tw-module-search">
                {modules
                  .filter((module) => module.label.includes(search))
                  .map((module) => (
                    <Link href={teacherPath(module.key)} key={module.key}>
                      {module.label}
                    </Link>
                  ))}
                {!modules.some((module) => module.label.includes(search)) && (
                  <p className="tw-muted" style={{ padding: 12 }}>
                    لا توجد أداة بهذا الاسم.
                  </p>
                )}
              </div>
            )}
            <Link
              href="/teacher/automations"
              className="tw-button tw-icon-button"
              aria-label={`التذكيرات: ${reminders.data?.filter((item) => !item.read).length ?? 0} غير مقروءة`}
            >
              <Bell size={18} />
            </Link>
            <div className="tw-account">
              <div>
                <strong className="tw-small">
                  {profile.data?.teacherName || "غرفة المعلم"}
                </strong>
                <small
                  className="tw-muted"
                  style={{ display: "block", fontSize: 10 }}
                >
                  {profile.data?.schoolName}
                </small>
              </div>
              <div className="tw-avatar" aria-hidden="true">
                {profile.data?.teacherName?.charAt(0) || "م"}
              </div>
            </div>
          </header>
          <Messages action={action} />
          <div className="tw-page">
            <header className="tw-heading">
              <div>
                <p className="tw-eyebrow">
                  غرفة المعلم / {current?.label ?? "صفحة غير موجودة"}
                </p>
                <h1>
                  {key === ""
                    ? `أهلًا ${profile.data?.teacherName || "بك"}، يومٌ منظم يبدأ هنا`
                    : current?.label}
                </h1>
                <p>
                  {key === ""
                    ? new Date().toLocaleDateString("ar-SA", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        calendar: "gregory",
                      })
                    : current?.description}
                </p>
              </div>
              {key === "" && (
                <Link href="/teacher/exams" className="tw-button primary">
                  <Plus size={17} />
                  تصميم اختبار
                </Link>
              )}
            </header>
            {key === "" ? (
              <Dashboard />
            ) : key === "classes" ? (
              <Classes />
            ) : key === "students" ? (
              <Students />
            ) : key === "attendance" ? (
              <Attendance />
            ) : key === "grades" ? (
              <Grades />
            ) : key === "tasks" ? (
              <Tasks />
            ) : key === "lessons" ? (
              <Lessons />
            ) : key === "questions" ? (
              <QuestionBank />
            ) : key === "reports" ? (
              <Reports />
            ) : key === "settings" ? (
              <ProfileForm />
            ) : key === "automations" ? (
              <Automations />
            ) : key === "exams" || key === "templates" ? (
              <Suspense fallback={<Loading />}>
                <TeacherExams templatesOnly={key === "templates"} />
              </Suspense>
            ) : (
              <Empty title="هذه الصفحة غير موجودة">
                <button
                  className="tw-button"
                  onClick={() => navigate("/teacher")}
                >
                  العودة إلى لوحة المعلم
                </button>
              </Empty>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function Dashboard() {
  const dashboard = useTeacherData<TeacherDashboard>("dashboard");
  if (dashboard.isLoading) return <Loading />;
  if (dashboard.error)
    return (
      <QueryError
        error={dashboard.error}
        retry={() => void dashboard.refetch()}
      />
    );
  const data = dashboard.data;
  if (!data) return null;
  const kpis = [
    { title: "الفصول النشطة", value: data.counts.classes, icon: GraduationCap },
    { title: "الطلاب", value: data.counts.students, icon: Users },
    {
      title: "الاختبارات المحفوظة",
      value: data.counts.exams,
      icon: FileQuestion,
    },
    { title: "المهام المعلقة", value: data.counts.tasks, icon: CheckCircle2 },
  ];
  const maximum = Math.max(
    1,
    data.weekly.attendance,
    data.weekly.grades,
    data.weekly.tasksCompleted,
  );
  return (
    <>
      <div className="tw-kpis">
        {kpis.map((item) => (
          <section className="tw-card tw-kpi" key={item.title}>
            <item.icon size={23} />
            <strong>{number(item.value)}</strong>
            <p>{item.title}</p>
          </section>
        ))}
      </div>
      <div className="tw-quick-actions">
        <Link href="/teacher/classes">
          <Plus size={20} />
          إنشاء فصل
        </Link>
        <Link href="/teacher/students">
          <Upload size={20} />
          إضافة أو استيراد كشف
        </Link>
        <Link href="/teacher/exams">
          <FileQuestion size={20} />
          تحويل صورة اختبار إلى ورقة قابلة للتعديل
        </Link>
      </div>
      {data.counts.classes === 0 && (
        <section className="tw-card">
          <h2>جهّز فصلك الأول</h2>
          <p className="tw-muted tw-spaced">
            ابدأ بإنشاء الفصل، ثم أضف الطلاب وسجّل أول كشف حضور. ستظهر إحصاءاتك
            الفعلية هنا.
          </p>
          <Link href="/teacher/classes" className="tw-button primary tw-spaced">
            إنشاء فصل <ArrowLeft size={16} />
          </Link>
        </section>
      )}
      <div className="tw-grid tw-spaced">
        <section className="tw-card">
          <h2>المهام والمواعيد القادمة</h2>
          {data.tasks.length ? (
            <div className="tw-list">
              {data.tasks.slice(0, 5).map((task) => (
                <Link
                  href="/teacher/tasks"
                  className="tw-list-item"
                  key={task.id}
                >
                  <div>
                    <strong>{task.title}</strong>
                    <p>
                      {task.kind === "assignment" ? "واجب" : "مهمة"} ·{" "}
                      {formatDate(task.dueAt)}
                    </p>
                  </div>
                  <ChevronLeft size={17} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty icon={CalendarDays} title="لا توجد مهام قادمة">
              <Link href="/teacher/tasks" className="tw-button">
                إضافة مهمة
              </Link>
            </Empty>
          )}
          {data.upcomingExams.length > 0 && (
            <div className="tw-list">
              {data.upcomingExams.map((exam) => (
                <Link
                  href="/teacher/exams"
                  className="tw-list-item"
                  key={exam.id}
                >
                  <span>{exam.title}</span>
                  <span className="tw-status">اختبار قادم</span>
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="tw-card">
          <h2>العمل المحفوظ هذا الأسبوع</h2>
          <p className="tw-muted tw-small tw-spaced">
            يعتمد على السجلات الفعلية، خلال آخر سبعة أيام.
          </p>
          <div className="tw-meter">
            {[
              { title: "سجلات حضور", value: data.weekly.attendance },
              { title: "درجات مسجلة", value: data.weekly.grades },
              { title: "مهام مكتملة", value: data.weekly.tasksCompleted },
            ].map((item) => (
              <div className="tw-meter-item" key={item.title}>
                <span>{item.title}</span>
                <div className="tw-progress">
                  <span style={{ width: `${(item.value / maximum) * 100}%` }} />
                </div>
                <strong>{number(item.value)}</strong>
              </div>
            ))}
          </div>
          <div className="tw-list">
            <Link href="/teacher/grades" className="tw-list-item">
              <span>درجات تحتاج إلى رصد</span>
              <strong>{number(data.counts.ungraded)}</strong>
            </Link>
            <Link href="/teacher/attendance" className="tw-list-item">
              <span>سجلات غياب للمراجعة</span>
              <strong>{number(data.counts.absences)}</strong>
            </Link>
          </div>
        </section>
        <section className="tw-card">
          <h2>آخر المستندات</h2>
          {data.recentFiles.length ? (
            <div className="tw-list">
              {data.recentFiles.map((file) => (
                <Link
                  href="/teacher/exams"
                  className="tw-list-item"
                  key={file.id}
                >
                  <div>
                    <strong>{file.title}</strong>
                    <p>آخر تعديل: {formatDate(file.updatedAt)}</p>
                  </div>
                  <FileText size={19} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="لم تحفظ مستندًا بعد">
              <Link href="/teacher/exams" className="tw-button">
                تصميم أول اختبار
              </Link>
            </Empty>
          )}
        </section>
        <section className="tw-card">
          <h2>تذكيراتك</h2>
          {data.reminders.length ? (
            <div className="tw-list">
              {data.reminders.slice(0, 5).map((item) => (
                <Link
                  href="/teacher/automations"
                  className="tw-list-item"
                  key={item.id}
                >
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.body}</p>
                  </div>
                  <Bell size={18} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty icon={Bell} title="لا توجد تذكيرات جديدة">
              <p>أضف قاعدة من الأتمتة لتخفيف العمل المتكرر.</p>
              <Link href="/teacher/automations" className="tw-button">
                إدارة الأتمتة
              </Link>
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}

function Classes() {
  const query = useTeacherData<TeacherClass[]>("classes"),
    profile = useTeacherData<TeacherProfile>("profile"),
    action = useTeacherAction();
  const [editing, setEditing] = useState<Partial<TeacherClass> | null>(null),
    [archived, setArchived] = useState(false);
  const list = query.data?.filter((item) => item.archived === archived) ?? [];
  const defaults = [
    { title: "المشاركة", totalMarks: 10 },
    { title: "الواجبات", totalMarks: 10 },
    { title: "اختبار قصير", totalMarks: 20 },
  ];
  const create = () =>
    setEditing({
      name: "",
      grade: "",
      section: "",
      subject: profile.data?.subjects[0] ?? "",
      year: profile.data?.year ?? "",
      term: profile.data?.term ?? "",
      notes: "",
      archived: false,
      gradebookTemplate: defaults,
    });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      editing &&
      (await action.run(() =>
        teacherApi(
          `/teacher/classes${editing.id ? `/${editing.id}` : ""}`,
          editing.id ? "PUT" : "POST",
          editing,
        ),
      ))
    )
      setEditing(null);
  };
  return (
    <>
      <div className="tw-toolbar">
        <button className="tw-button primary" onClick={create}>
          <Plus size={16} />
          إنشاء فصل
        </button>
        <button
          className="tw-button"
          onClick={() =>
            setEditing({
              name: profile.data?.classes[0] || "فصل جديد",
              grade: profile.data?.stage || "",
              section: "",
              subject: profile.data?.subjects[0] || "",
              year: profile.data?.year || "",
              term: profile.data?.term || "",
              notes: "",
              archived: false,
              gradebookTemplate: defaults,
            })
          }
        >
          <Copy size={16} />
          قالب فصل من ملف المعلم
        </button>
        <label className="tw-check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />
          عرض الأرشيف
        </label>
      </div>
      <Messages action={action} />
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <QueryError error={query.error} retry={() => void query.refetch()} />
      ) : list.length ? (
        <div className="tw-grid">
          {list.map((item) => (
            <section className="tw-card" key={item.id}>
              <div className="tw-toolbar">
                <GraduationCap size={23} />
                <h2>{item.name}</h2>
                <span className="tw-status">
                  {item.grade || "مرحلة غير محددة"}
                </span>
              </div>
              <p className="tw-muted">
                {[item.subject, item.section, item.term, item.year]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {item.notes && (
                <p className="tw-muted tw-small tw-spaced">{item.notes}</p>
              )}
              <div className="tw-toolbar tw-spaced">
                <Link
                  href={`/teacher/students?class=${encodeURIComponent(item.id)}`}
                  className="tw-button"
                >
                  كشف الطلاب
                </Link>
                <button
                  className="tw-button tw-icon-button"
                  aria-label={`تعديل ${item.name}`}
                  onClick={() => setEditing(item)}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="tw-button"
                  disabled={action.busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        item.archived
                          ? "استعادة هذا الفصل؟"
                          : "أرشفة الفصل؟ ستبقى سجلات الطلاب والحضور والدرجات محفوظة.",
                      )
                    )
                      void action.run(
                        () =>
                          teacherApi(`/teacher/classes/${item.id}`, "PUT", {
                            ...item,
                            archived: !item.archived,
                          }),
                        item.archived ? "استُعيد الفصل." : "أُرشف الفصل.",
                      );
                  }}
                >
                  <Archive size={16} />
                  {item.archived ? "استعادة" : "أرشفة"}
                </button>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty
          icon={GraduationCap}
          title={archived ? "لا توجد فصول مؤرشفة" : "أنشئ فصلك الأول"}
        >
          <p>رتّب بيانات العام والمادة ثم أضف كشف الطلاب.</p>
          <button className="tw-button primary" onClick={create}>
            إنشاء فصل
          </button>
        </Empty>
      )}
      {editing && (
        <Modal
          title={editing.id ? "تعديل الفصل" : "إنشاء فصل جديد"}
          close={() => setEditing(null)}
        >
          <form onSubmit={save}>
            <div className="tw-form-grid">
              {(
                [
                  { key: "name", label: "اسم الفصل *", required: true },
                  { key: "grade", label: "الصف" },
                  { key: "section", label: "الشعبة" },
                  { key: "subject", label: "المادة" },
                  { key: "year", label: "العام الدراسي" },
                  { key: "term", label: "الفصل الدراسي" },
                ] as const
              ).map((field) => (
                <Field label={field.label} key={field.key}>
                  <input
                    required={"required" in field && field.required}
                    maxLength={200}
                    value={editing[field.key] ?? ""}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        [field.key]: event.target.value,
                      })
                    }
                  />
                </Field>
              ))}
              <Field label="ملاحظات" wide>
                <textarea
                  maxLength={4000}
                  value={editing.notes ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, notes: event.target.value })
                  }
                />
              </Field>
            </div>
            <section className="tw-card">
              <h2>قالب دفتر الدرجات لهذا الفصل</h2>
              <p className="tw-muted tw-small tw-spaced">
                تفضيلات محفوظة تقترح عناوين التقييم ودرجاته؛ لا تُنشئ درجات أو
                طلابًا تلقائيًا.
              </p>
              <div className="tw-list">
                {(editing.gradebookTemplate ?? defaults).map(
                  (preset, index) => (
                    <div className="tw-form-grid" key={index}>
                      <Field label={`عنوان التقييم ${index + 1}`}>
                        <input
                          required
                          maxLength={180}
                          value={preset.title}
                          onChange={(event) => {
                            const next = [
                              ...(editing.gradebookTemplate ?? defaults),
                            ];
                            next[index] = {
                              ...preset,
                              title: event.target.value,
                            };
                            setEditing({ ...editing, gradebookTemplate: next });
                          }}
                        />
                      </Field>
                      <div className="tw-toolbar">
                        <Field label="الدرجة الكلية">
                          <input
                            required
                            type="number"
                            min={0.1}
                            max={10000}
                            step="any"
                            value={preset.totalMarks}
                            onChange={(event) => {
                              const next = [
                                ...(editing.gradebookTemplate ?? defaults),
                              ];
                              next[index] = {
                                ...preset,
                                totalMarks: Number(event.target.value),
                              };
                              setEditing({
                                ...editing,
                                gradebookTemplate: next,
                              });
                            }}
                          />
                        </Field>
                        <button
                          type="button"
                          className="tw-button tw-icon-button danger"
                          aria-label={`إزالة قالب ${preset.title}`}
                          onClick={() =>
                            setEditing({
                              ...editing,
                              gradebookTemplate: (
                                editing.gradebookTemplate ?? defaults
                              ).filter((_, itemIndex) => itemIndex !== index),
                            })
                          }
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ),
                )}
              </div>
              <button
                type="button"
                className="tw-button tw-spaced"
                disabled={(editing.gradebookTemplate ?? defaults).length >= 20}
                onClick={() =>
                  setEditing({
                    ...editing,
                    gradebookTemplate: [
                      ...(editing.gradebookTemplate ?? defaults),
                      { title: "تقييم جديد", totalMarks: 10 },
                    ],
                  })
                }
              >
                <Plus size={15} />
                إضافة قالب تقييم
              </button>
            </section>
            <Messages action={action} />
            <div className="tw-modal-footer">
              <button
                type="button"
                className="tw-button"
                onClick={() => setEditing(null)}
              >
                إلغاء
              </button>
              <button className="tw-button primary" disabled={action.busy}>
                حفظ الفصل
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Students() {
  const classes = useTeacherData<TeacherClass[]>("classes"),
    action = useTeacherAction();
  const [classId, setClassId] = useState(
      () => new URLSearchParams(window.location.search).get("class") ?? "",
    ),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [page, setPage] = useState(1),
    [sort, setSort] = useState("name"),
    [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Partial<TeacherStudent> | null>(null),
    [importing, setImporting] = useState(false),
    [viewId, setViewId] = useState(""),
    [moveTarget, setMoveTarget] = useState(""),
    [moving, setMoving] = useState(false);
  const query = useQuery({
    queryKey: [
      "teacher",
      "students-search",
      classId,
      search,
      archived,
      page,
      sort,
    ],
    queryFn: () =>
      teacherApi<{
        items: TeacherStudent[];
        total: number;
        page: number;
        pageSize: number;
      }>("/teacher/students/search", "POST", {
        classId: classId || undefined,
        search,
        archived,
        page,
        pageSize: 20,
        sort,
      }),
    staleTime: 10_000,
  });
  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [classId, search, archived, sort]);
  const list = query.data?.items ?? [],
    className = (id: string) =>
      classes.data?.find((item) => item.id === id)?.name ?? "الفصل";
  const toggle = (id: string) =>
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id],
    );
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      editing &&
      (await action.run(() =>
        teacherApi(
          `/teacher/students${editing.id ? `/${editing.id}` : ""}`,
          editing.id ? "PUT" : "POST",
          editing,
        ),
      ))
    )
      setEditing(null);
  };
  const bulkArchive = async () => {
    if (
      !window.confirm(
        `${archived ? "استعادة" : "أرشفة"} ${number(selected.length)} طالب؟ تحتفظ الأرشفة بجميع السجلات.`,
      )
    )
      return;
    if (
      await action.run(
        () =>
          teacherApi("/teacher/students/bulk", "POST", {
            ids: selected,
            action: archived ? "restore" : "archive",
          }),
        "تم تحديث الطلاب المحددين.",
      )
    )
      setSelected([]);
  };
  const exportRoster = async () =>
    action.run(async () => {
      const all = await teacherApi<TeacherStudent[]>(
        `/teacher/students?archived=${archived}${classId ? `&classId=${encodeURIComponent(classId)}` : ""}`,
      );
      downloadTeacherCsv("كشف-الطلاب.csv", [
        ["اسم الطالب", "الرقم الداخلي", "الفصل", "ملاحظات"],
        ...all.map((item) => [
          item.name,
          item.internalId,
          className(item.classId),
          item.notes,
        ]),
      ]);
    }, "تم إعداد ملف الكشف.");
  return (
    <>
      <div className="tw-toolbar">
        <div className="tw-search">
          <Search size={16} />
          <input
            aria-label="بحث في كشف الطلاب"
            placeholder="ابحث بالاسم أو الرقم الداخلي"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Field label="الفصل">
          <ClassSelect
            classes={classes.data ?? []}
            value={classId}
            setValue={setClassId}
            allowAll
          />
        </Field>
        <button
          className="tw-button primary"
          onClick={() =>
            setEditing({
              name: "",
              internalId: "",
              classId,
              notes: "",
              archived: false,
            })
          }
        >
          <Plus size={16} />
          إضافة طالب
        </button>
        <button className="tw-button" onClick={() => setImporting(true)}>
          <Upload size={16} />
          استيراد كشف
        </button>
        <button
          className="tw-button"
          disabled={action.busy}
          onClick={() => void exportRoster()}
        >
          <Download size={16} />
          تصدير CSV
        </button>
        <Link
          href={`/teacher/reports${classId ? `?class=${encodeURIComponent(classId)}` : ""}`}
          className="tw-button"
        >
          <Printer size={16} />
          طباعة
        </Link>
      </div>
      <div className="tw-toolbar">
        <label className="tw-check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />
          عرض المؤرشفين والمحذوفين
        </label>
        <Field label="الترتيب">
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="name">الاسم تصاعديًا</option>
            <option value="newest">الأحدث إضافة</option>
            <option value="internalId">الرقم الداخلي</option>
          </select>
        </Field>
        {selected.length > 0 && (
          <>
            <span className="tw-status">{number(selected.length)} محدد</span>
            <button
              className="tw-button"
              disabled={action.busy}
              onClick={() => void bulkArchive()}
            >
              <Archive size={15} />
              {archived ? "استعادة المحددين" : "أرشفة المحددين"}
            </button>
            <button className="tw-button" onClick={() => setMoving(true)}>
              نقل إلى فصل
            </button>
          </>
        )}
      </div>
      <Messages action={action} />
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <QueryError error={query.error} retry={() => void query.refetch()} />
      ) : list.length ? (
        <>
          <div className="tw-table-wrap">
            <table className="tw-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="تحديد كل طلاب الصفحة"
                      checked={
                        list.length > 0 &&
                        list.every((item) => selected.includes(item.id))
                      }
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? list.map((item) => item.id)
                            : [],
                        )
                      }
                    />
                  </th>
                  <th>اسم الطالب</th>
                  <th>الرقم الداخلي</th>
                  <th>الفصل</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {list.map((student) => (
                  <tr key={student.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`تحديد ${student.name}`}
                        checked={selected.includes(student.id)}
                        onChange={() => toggle(student.id)}
                      />
                    </td>
                    <td>
                      <button
                        className="tw-button ghost"
                        onClick={() => setViewId(student.id)}
                      >
                        {student.name}
                      </button>
                    </td>
                    <td>{student.internalId || "—"}</td>
                    <td>{className(student.classId)}</td>
                    <td>
                      <span
                        className={`tw-status ${student.archived ? "" : "good"}`}
                      >
                        {student.removed
                          ? "محذوف قابل للاستعادة"
                          : student.archived
                            ? "مؤرشف"
                            : "نشط"}
                      </span>
                    </td>
                    <td>
                      <div className="tw-toolbar" style={{ margin: 0 }}>
                        <button
                          className="tw-button tw-icon-button"
                          aria-label={`تعديل ${student.name}`}
                          onClick={() => setEditing(student)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="tw-button tw-icon-button"
                          aria-label={
                            archived
                              ? `استعادة ${student.name}`
                              : `أرشفة ${student.name}`
                          }
                          disabled={action.busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                archived
                                  ? "استعادة الطالب؟"
                                  : "أرشفة الطالب مع الاحتفاظ بسجلاته؟",
                              )
                            )
                              void action.run(() =>
                                teacherApi(
                                  `/teacher/students/${student.id}`,
                                  "PUT",
                                  {
                                    ...student,
                                    archived: !archived,
                                    removed: false,
                                  },
                                ),
                              );
                          }}
                        >
                          <Archive size={15} />
                        </button>
                        {!archived && (
                          <button
                            className="tw-button tw-icon-button danger"
                            aria-label={`حذف ${student.name}`}
                            disabled={action.busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "إزالة الطالب من الكشف النشط؟ يمكنك استعادته من الأرشيف، وتبقى سجلاته محفوظة.",
                                )
                              )
                                void action.run(() =>
                                  teacherApi(
                                    `/teacher/students/${student.id}`,
                                    "DELETE",
                                  ),
                                );
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tw-pagination">
            <span>
              {number(query.data?.total ?? 0)} طالب · الصفحة {number(page)}
            </span>
            <div>
              <button
                className="tw-button"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                السابق
              </button>
              <button
                className="tw-button"
                disabled={page * 20 >= (query.data?.total ?? 0)}
                onClick={() => setPage(page + 1)}
              >
                التالي
              </button>
            </div>
          </div>
        </>
      ) : (
        <Empty
          icon={Users}
          title={
            search
              ? "لا توجد نتائج مطابقة"
              : archived
                ? "الأرشيف فارغ"
                : "الكشف فارغ"
          }
        >
          <p>أضف طالبًا أو استورد ملف CSV بعد مراجعته.</p>
          <button
            className="tw-button"
            onClick={() =>
              setEditing({
                name: "",
                internalId: "",
                classId,
                notes: "",
                archived: false,
              })
            }
          >
            إضافة طالب
          </button>
        </Empty>
      )}
      {editing && (
        <Modal
          title={editing.id ? "تعديل الطالب" : "إضافة طالب"}
          close={() => setEditing(null)}
        >
          <form onSubmit={save}>
            <div className="tw-form-grid">
              <Field label="اسم الطالب *">
                <input
                  required
                  maxLength={150}
                  value={editing.name ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, name: event.target.value })
                  }
                />
              </Field>
              <Field
                label="الرقم الداخلي (اختياري)"
                hint="رقم مدرسي داخلي. لا تُدخل رقم الهوية."
              >
                <input
                  maxLength={80}
                  value={editing.internalId ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      internalId: normalizeTeacherDigits(event.target.value),
                    })
                  }
                />
              </Field>
              <Field label="الفصل *">
                <ClassSelect
                  required
                  classes={classes.data ?? []}
                  value={editing.classId ?? ""}
                  setValue={(value) =>
                    setEditing({ ...editing, classId: value })
                  }
                />
              </Field>
              <Field label="ملاحظات خاصة بالمعلم" wide>
                <textarea
                  maxLength={4000}
                  value={editing.notes ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, notes: event.target.value })
                  }
                />
              </Field>
            </div>
            {editing.id && (
              <p className="tw-notice">
                عند تغيير الفصل، يحتفظ الطالب بنفس المعرّف وتبقى سجلاته السابقة
                مرتبطة به.
              </p>
            )}
            <Messages action={action} />
            <div className="tw-modal-footer">
              <button
                type="button"
                className="tw-button"
                onClick={() => setEditing(null)}
              >
                إلغاء
              </button>
              <button className="tw-button primary" disabled={action.busy}>
                حفظ الطالب
              </button>
            </div>
          </form>
        </Modal>
      )}
      {importing && (
        <RosterImport
          classes={classes.data ?? []}
          initialClassId={classId}
          close={() => setImporting(false)}
        />
      )}
      {viewId && (
        <StudentProfile studentId={viewId} close={() => setViewId("")} />
      )}
      {moving && (
        <Modal title="نقل الطلاب إلى فصل" close={() => setMoving(false)}>
          <Field label="الفصل الجديد">
            <ClassSelect
              classes={classes.data ?? []}
              value={moveTarget}
              setValue={setMoveTarget}
              required
            />
          </Field>
          <p className="tw-notice">
            يبقى تاريخ الحضور والدرجات والواجبات محفوظًا. لا يُنشأ سجل طالب
            جديد.
          </p>
          <Messages action={action} />
          <div className="tw-modal-footer">
            <button className="tw-button" onClick={() => setMoving(false)}>
              إلغاء
            </button>
            <button
              className="tw-button primary"
              disabled={!moveTarget || action.busy}
              onClick={() => {
                if (
                  window.confirm(
                    `نقل ${number(selected.length)} طالب إلى الفصل المحدد؟`,
                  )
                )
                  void action
                    .run(
                      () =>
                        teacherApi("/teacher/students/bulk", "POST", {
                          ids: selected,
                          action: "move",
                          classId: moveTarget,
                          confirm: true,
                        }),
                      "نُقل الطلاب مع الاحتفاظ بسجلاتهم.",
                    )
                    .then((okay) => {
                      if (okay) {
                        setMoving(false);
                        setSelected([]);
                      }
                    });
              }}
            >
              تأكيد النقل
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function RosterImport({
  classes,
  initialClassId,
  close,
}: {
  classes: TeacherClass[];
  initialClassId: string;
  close: () => void;
}) {
  const [classId, setClassId] = useState(initialClassId),
    [rows, setRows] = useState<string[][]>([]),
    [columns, setColumns] = useState({ name: 0, internalId: 1, notes: 2 }),
    [preview, setPreview] = useState<RosterPreview | null>(null),
    [mode, setMode] = useState<"add" | "update">("add");
  const action = useTeacherAction();
  const mapped = useMemo(
    () =>
      rosterImportPreview(rows, columns, []).map((row) => ({
        name: row.name,
        internalId: row.internalId,
        notes: row.notes,
      })),
    [rows, columns],
  );
  const sample = () =>
    downloadTeacherCsv("نموذج-كشف-الطلاب.csv", [
      ["اسم الطالب", "الرقم الداخلي", "ملاحظات"],
      ["طالب تجريبي أول", "001", "بيانات مثال فقط"],
      ["طالب تجريبي ثان", "002", ""],
    ]);
  const load = async (file?: File) => {
    if (!file) return;
    setPreview(null);
    await action.run(async () => {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("الملف أكبر من ٥ ميغابايت.");
      if (!/\.(csv|tsv)$/i.test(file.name))
        throw new Error(
          "استخدم ملف CSV أو TSV. يمكنك حفظ ورقة Excel بصيغة CSV UTF-8.",
        );
      const parsed = parseRosterCsv(await file.text());
      if (parsed.length < 2) throw new Error("الملف لا يحتوي على صفوف طلاب.");
      setRows(parsed);
      const headers = parsed[0];
      setColumns({
        name: Math.max(
          0,
          headers.findIndex((header) => /اسم|name/i.test(header)),
        ),
        internalId: headers.findIndex((header) => /رقم|معرّف|id/i.test(header)),
        notes: headers.findIndex((header) => /ملاحظ|notes/i.test(header)),
      });
    }, "قُرئ الملف محليًا. اختر الأعمدة ثم راجع الصفوف.");
  };
  const validate = async () =>
    action.run(
      async () =>
        setPreview(
          await teacherApi<RosterPreview>(
            "/teacher/students/import/preview",
            "POST",
            { classId, rows: mapped },
          ),
        ),
      "اكتملت المراجعة. لم يُحفظ أي طالب بعد.",
    );
  const commit = async () => {
    if (
      !preview ||
      preview.totals.invalid ||
      !window.confirm(
        `حفظ الاستيراد بوضع ${mode === "add" ? "إضافة الطلاب الجدد فقط" : "تحديث المطابقين وإضافة الجدد"}؟`,
      )
    )
      return;
    if (
      await action.run(
        () =>
          teacherApi("/teacher/students/import", "POST", {
            classId,
            rows: mapped,
            mode,
          }),
        "حُفظ الاستيراد بنجاح.",
      )
    )
      close();
  };
  return (
    <Modal title="استيراد كشف الطلاب — مراجعة قبل الحفظ" close={close} wide>
      <p className="tw-muted">
        الملفات مدعومة بصيغة CSV وTSV. من Excel، استخدم «حفظ باسم CSV UTF-8»؛ لا
        تُرفع مصنفات Excel مباشرة.
      </p>
      <div className="tw-toolbar tw-spaced">
        <button className="tw-button" onClick={sample}>
          <Download size={16} />
          نموذج عربي
        </button>
        <Field label="الفصل المستهدف *">
          <ClassSelect
            classes={classes}
            value={classId}
            setValue={(value) => {
              setClassId(value);
              setPreview(null);
            }}
            required
          />
        </Field>
        <Field label="الملف">
          <input
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            disabled={action.busy}
            onChange={(event) => void load(event.target.files?.[0])}
          />
        </Field>
      </div>
      {rows.length > 0 && (
        <>
          <div className="tw-form-grid">
            {(
              [
                { key: "name", label: "عمود اسم الطالب *" },
                { key: "internalId", label: "عمود الرقم الداخلي" },
                { key: "notes", label: "عمود الملاحظات" },
              ] as const
            ).map((field) => (
              <Field label={field.label} key={field.key}>
                <select
                  value={columns[field.key]}
                  onChange={(event) => {
                    setColumns({
                      ...columns,
                      [field.key]: Number(event.target.value),
                    });
                    setPreview(null);
                  }}
                >
                  {field.key !== "name" && (
                    <option value={-1}>غير موجود</option>
                  )}
                  {rows[0].map((header, index) => (
                    <option value={index} key={index}>
                      {header || `عمود ${index + 1}`}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <button
            className="tw-button primary"
            disabled={!classId || action.busy}
            onClick={() => void validate()}
          >
            <Check size={16} />
            فحص الصفوف والمطابقات
          </button>
        </>
      )}
      {preview && (
        <>
          <div className="tw-import-totals">
            <span>إجمالي: {number(preview.rows.length)}</span>
            <span>صحيح: {number(preview.totals.valid)}</span>
            <span>بحاجة لتصحيح: {number(preview.totals.invalid)}</span>
            <span>مطابق موجود: {number(preview.totals.matched)}</span>
          </div>
          <div className="tw-table-wrap">
            <table className="tw-table">
              <thead>
                <tr>
                  <th>الصف</th>
                  <th>الاسم</th>
                  <th>الرقم</th>
                  <th>النتيجة</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row}>
                    <td>{number(row.row)}</td>
                    <td>{row.student.name || "اسم فارغ"}</td>
                    <td>{row.student.internalId || "—"}</td>
                    <td>
                      {row.errors.length ? (
                        <span style={{ color: "#ffc7d1" }}>
                          {row.errors.join("، ")}
                        </span>
                      ) : row.matchedStudentId ? (
                        <span className="tw-status warn">
                          مطابق لطالب موجود
                        </span>
                      ) : (
                        <span className="tw-status good">طالب جديد</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tw-section-tabs tw-spaced">
            <button
              aria-pressed={mode === "add"}
              className="tw-button"
              onClick={() => setMode("add")}
            >
              إضافة الجدد فقط
            </button>
            <button
              aria-pressed={mode === "update"}
              className="tw-button"
              onClick={() => setMode("update")}
            >
              تحديث المطابقين وإضافة الجدد
            </button>
          </div>
          <p className="tw-notice">
            {mode === "add"
              ? "لن تتغير سجلات الطلاب الموجودين؛ تُتخطّى المطابقات."
              : "سيُحدّث الاسم والملاحظات والرقم للطلاب المطابقين بعد تأكيدك. تبقى سجلات الحضور والدرجات."}{" "}
            {preview.totals.invalid > 0 &&
              "صحّح الصفوف غير الصالحة في الملف وأعد رفعه قبل الحفظ."}
          </p>
        </>
      )}
      <Messages action={action} />
      <div className="tw-modal-footer">
        <button className="tw-button" onClick={close}>
          إلغاء
        </button>
        <button
          className="tw-button primary"
          disabled={!preview || preview.totals.invalid > 0 || action.busy}
          onClick={() => void commit()}
        >
          تأكيد وحفظ الكشف
        </button>
      </div>
    </Modal>
  );
}

function StudentProfile({
  studentId,
  close,
}: {
  studentId: string;
  close: () => void;
}) {
  const query = useTeacherData<{
    student: TeacherStudent;
    attendance: AttendanceEntry[];
    grades: TeacherGrade[];
    assignments: TeacherTask[];
  }>(`students/${encodeURIComponent(studentId)}/profile`);
  return (
    <Modal title="ملف الطالب — خاص بالمعلم" close={close} wide>
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <QueryError error={query.error} retry={() => void query.refetch()} />
      ) : (
        query.data && (
          <>
            <h2>{query.data.student.name}</h2>
            <p className="tw-muted">
              الرقم الداخلي: {query.data.student.internalId || "غير محدد"}
            </p>
            <div className="tw-kpis tw-spaced">
              <div className="tw-card tw-kpi">
                <strong>
                  {number(
                    query.data.attendance.filter(
                      (item) => item.status === "absent",
                    ).length,
                  )}
                </strong>
                <p>أيام غياب</p>
              </div>
              <div className="tw-card tw-kpi">
                <strong>{number(query.data.grades.length)}</strong>
                <p>تقييمات</p>
              </div>
              <div className="tw-card tw-kpi">
                <strong>
                  {number(
                    query.data.assignments.filter((task) =>
                      task.studentCompletion.includes(studentId),
                    ).length,
                  )}
                </strong>
                <p>واجبات مكتملة</p>
              </div>
            </div>
            <section className="tw-card">
              <h2>ملاحظات خاصة</h2>
              <p
                className="tw-muted tw-spaced"
                style={{ whiteSpace: "pre-wrap" }}
              >
                {query.data.student.notes || "لا توجد ملاحظات."}
              </p>
            </section>
            <section className="tw-card">
              <h2>الدرجات</h2>
              {query.data.grades.length ? (
                <div className="tw-list">
                  {query.data.grades.map((grade) => (
                    <div className="tw-list-item" key={grade.id}>
                      <div>
                        <strong>{grade.title}</strong>
                        <p>{formatDate(grade.date)}</p>
                      </div>
                      <span>
                        {grade.marks === null
                          ? "لم ترصد"
                          : `${number(grade.marks)} / ${number(grade.totalMarks)}`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="tw-muted tw-spaced">لا توجد درجات مسجلة.</p>
              )}
            </section>
            <section className="tw-card">
              <h2>سجل الحضور</h2>
              <div className="tw-list">
                {query.data.attendance.map((entry, index) => (
                  <div className="tw-list-item" key={entry.id ?? index}>
                    <span>{formatDate(entry.date)}</span>
                    <span className="tw-status">
                      {attendanceLabels[entry.status]}
                    </span>
                  </div>
                ))}
                {!query.data.attendance.length && (
                  <p className="tw-muted">لا يوجد سجل حضور.</p>
                )}
              </div>
            </section>
            <section className="tw-card">
              <h2>الواجبات والتسليم</h2>
              {query.data.assignments.length ? (
                <div className="tw-list">
                  {query.data.assignments.map((task) => (
                    <div className="tw-list-item" key={task.id}>
                      <div>
                        <strong>{task.title}</strong>
                        <p>{formatDate(task.dueAt)}</p>
                      </div>
                      <span
                        className={`tw-status ${task.studentCompletion.includes(studentId) ? "good" : "warn"}`}
                      >
                        {task.studentCompletion.includes(studentId)
                          ? "تسليم مسجل"
                          : "لم يسلم"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="tw-muted tw-spaced">
                  لا توجد واجبات مسجلة لهذا الطالب.
                </p>
              )}
            </section>
          </>
        )
      )}
    </Modal>
  );
}

const attendanceLabels = {
  present: "حاضر",
  absent: "غائب",
  late: "متأخر",
  excused: "غياب بعذر",
};
function Attendance() {
  const classes = useTeacherData<TeacherClass[]>("classes"),
    action = useTeacherAction();
  const [classId, setClassId] = useState(""),
    [date, setDate] = useState(today()),
    [entries, setEntries] = useState<Record<string, AttendanceEntry>>({}),
    [dirty, setDirty] = useState(false);
  const students = useTeacherData<TeacherStudent[]>(
      "students",
      `?classId=${encodeURIComponent(classId)}&archived=false`,
      !!classId,
    ),
    query = useTeacherData<AttendanceEntry[]>(
      "attendance",
      `?classId=${encodeURIComponent(classId)}&date=${date}`,
      !!classId,
    );
  useEffect(() => {
    if (query.data && students.data) {
      const saved = new Map(query.data.map((item) => [item.studentId, item]));
      setEntries(
        Object.fromEntries(
          students.data.map((student) => [
            student.id,
            saved.get(student.id) ?? {
              studentId: student.id,
              status: "present",
              note: "",
            },
          ]),
        ),
      );
      setDirty(false);
    }
  }, [query.data, students.data]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  const change = (studentId: string, patch: Partial<AttendanceEntry>) => {
    setEntries((previous) => ({
      ...previous,
      [studentId]: { ...previous[studentId], ...patch },
    }));
    setDirty(true);
  };
  return (
    <>
      <div className="tw-toolbar">
        <Field label="الفصل">
          <ClassSelect
            classes={classes.data ?? []}
            value={classId}
            setValue={(value) => {
              if (
                !dirty ||
                window.confirm("توجد تغييرات غير محفوظة. الانتقال إلى فصل آخر؟")
              ) {
                setClassId(value);
                setDirty(false);
              }
            }}
          />
        </Field>
        <Field label="التاريخ">
          <input
            type="date"
            value={date}
            onChange={(event) => {
              if (
                !dirty ||
                window.confirm("توجد تغييرات غير محفوظة. تغيير التاريخ؟")
              ) {
                setDate(event.target.value);
                setDirty(false);
              }
            }}
          />
        </Field>
        <button
          className="tw-button primary"
          disabled={
            !classId ||
            !students.data?.length ||
            action.busy ||
            query.isLoading ||
            students.isLoading
          }
          onClick={() =>
            void action
              .run(
                () =>
                  teacherApi("/teacher/attendance", "POST", {
                    classId,
                    date,
                    entries: Object.values(entries),
                  }),
                "حُفظ كشف الحضور.",
              )
              .then((okay) => {
                if (okay) setDirty(false);
              })
          }
        >
          <Check size={16} />
          حفظ الحضور
        </button>
        <Link
          className="tw-button"
          href={`/teacher/reports?type=attendance&class=${encodeURIComponent(classId)}&date=${date}`}
        >
          <Printer size={16} />
          طباعة
        </Link>
        {dirty && <span className="tw-status warn">تغييرات غير محفوظة</span>}
      </div>
      <Messages action={action} />
      {!classId ? (
        <Empty icon={ClipboardCheck} title="اختر الفصل لتسجيل الحضور">
          <p>السجلات مرتبطة بالفصل والتاريخ، ويمكن إعادة فتحها وتعديلها.</p>
        </Empty>
      ) : students.isLoading || query.isLoading ? (
        <Loading />
      ) : students.error || query.error ? (
        <QueryError
          error={students.error || query.error}
          retry={() => {
            void students.refetch();
            void query.refetch();
          }}
        />
      ) : students.data?.length ? (
        <section className="tw-card">
          <div className="tw-toolbar">
            <h2>كشف {formatDate(date)}</h2>
            <button
              className="tw-button"
              onClick={() => {
                if (
                  window.confirm(
                    "تعيين جميع طلاب الكشف حاضرًا؟ ثم احفظ لتثبيت التغيير.",
                  )
                ) {
                  setEntries((previous) =>
                    Object.fromEntries(
                      Object.entries(previous).map(([id, entry]) => [
                        id,
                        { ...entry, status: "present" },
                      ]),
                    ),
                  );
                  setDirty(true);
                }
              }}
            >
              تعيين الكل حاضرًا
            </button>
            <span className="tw-status">
              {number(
                Object.values(entries).filter(
                  (entry) => entry.status === "absent",
                ).length,
              )}{" "}
              غائب
            </span>
          </div>
          <div className="tw-table-wrap">
            <table className="tw-table">
              <thead>
                <tr>
                  <th>الطالب</th>
                  <th>الحالة</th>
                  <th>ملاحظة خاصة</th>
                </tr>
              </thead>
              <tbody>
                {students.data.map((student) => (
                  <tr key={student.id}>
                    <td>{student.name}</td>
                    <td>
                      <select
                        className="tw-input"
                        aria-label={`حضور ${student.name}`}
                        value={entries[student.id]?.status ?? "present"}
                        onChange={(event) =>
                          change(student.id, {
                            status: event.target
                              .value as AttendanceEntry["status"],
                          })
                        }
                      >
                        {Object.entries(attendanceLabels).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                    </td>
                    <td>
                      <input
                        className="tw-input"
                        aria-label={`ملاحظة حضور ${student.name}`}
                        maxLength={500}
                        value={entries[student.id]?.note ?? ""}
                        onChange={(event) =>
                          change(student.id, { note: event.target.value })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <Empty title="لا يوجد طلاب نشطون في هذا الفصل">
          <Link
            className="tw-button"
            href={`/teacher/students?class=${encodeURIComponent(classId)}`}
          >
            إضافة الطلاب
          </Link>
        </Empty>
      )}
    </>
  );
}

function Grades() {
  const classes = useTeacherData<TeacherClass[]>("classes"),
    action = useTeacherAction();
  const [classId, setClassId] = useState(""),
    [title, setTitle] = useState(""),
    [totalMarks, setTotalMarks] = useState(20),
    [date, setDate] = useState(today()),
    [marks, setMarks] = useState<Record<string, string>>({}),
    [assessment, setAssessment] = useState("");
  const students = useTeacherData<TeacherStudent[]>(
      "students",
      `?classId=${encodeURIComponent(classId)}&archived=false`,
      !!classId,
    ),
    grades = useTeacherData<TeacherGrade[]>(
      "grades",
      `?classId=${encodeURIComponent(classId)}`,
      !!classId,
    );
  const assessments = [
    ...new Map(
      (grades.data ?? []).map((grade) => [
        JSON.stringify([grade.title, grade.date]),
        { title: grade.title, date: grade.date },
      ]),
    ).entries(),
  ];
  useEffect(() => {
    if (!assessment) {
      return;
    }
    const selected =
      grades.data?.filter(
        (item) => JSON.stringify([item.title, item.date]) === assessment,
      ) ?? [];
    setTitle(selected[0]?.title ?? "");
    setTotalMarks(selected[0]?.totalMarks ?? 20);
    setDate(selected[0]?.date ?? today());
    setMarks(
      Object.fromEntries(
        selected.map((item) => [
          item.studentId,
          item.marks === null ? "" : String(item.marks),
        ]),
      ),
    );
  }, [assessment, grades.data]);
  const save = async () => {
    const okay = await action.run(async () => {
      if (!title.trim()) throw new Error("أدخل عنوان التقييم.");
      for (const student of students.data ?? []) {
        const value = marks[student.id]?.trim() ?? "",
          numeric = value === "" ? null : Number(normalizeTeacherDigits(value));
        if (
          numeric !== null &&
          (!Number.isFinite(numeric) || numeric < 0 || numeric > totalMarks)
        )
          throw new Error("توجد درجة غير صالحة أو أكبر من الدرجة الكلية.");
      }
      await teacherApi("/teacher/grades/bulk", "POST", {
        classId,
        title: title.trim(),
        totalMarks,
        date,
        entries: (students.data ?? []).map((student) => ({
          studentId: student.id,
          marks: !marks[student.id]?.trim()
            ? null
            : Number(normalizeTeacherDigits(marks[student.id])),
          note:
            grades.data?.find(
              (item) =>
                item.title === title.trim() &&
                item.date === date &&
                item.studentId === student.id,
            )?.note ?? "",
        })),
      });
    }, "حُفظت درجات التقييم. الحقول الفارغة تبقى «لم ترصد».");
    if (okay) setAssessment(JSON.stringify([title.trim(), date]));
  };
  return (
    <>
      <div className="tw-toolbar">
        <Field label="الفصل">
          <ClassSelect
            classes={classes.data ?? []}
            value={classId}
            setValue={(value) => {
              setClassId(value);
              setAssessment("");
              setTitle("");
              setMarks({});
            }}
          />
        </Field>
        <Field label="تقييم محفوظ">
          <select
            value={assessment}
            onChange={(event) => {
              setAssessment(event.target.value);
              if (!event.target.value) {
                setTitle("");
                setMarks({});
              }
            }}
          >
            <option value="">تقييم جديد</option>
            {assessments.map(([value, item]) => (
              <option key={value} value={value}>
                {item.title} · {formatDate(item.date)}
              </option>
            ))}
          </select>
        </Field>
        <Link
          className="tw-button"
          href={`/teacher/reports?type=grades&class=${encodeURIComponent(classId)}`}
        >
          <Printer size={16} />
          تقرير الدرجات
        </Link>
      </div>
      <Messages action={action} />
      {!classId ? (
        <Empty icon={BarChart3} title="اختر فصلًا لرصد درجاته" />
      ) : students.isLoading || grades.isLoading ? (
        <Loading />
      ) : students.error || grades.error ? (
        <QueryError
          error={students.error || grades.error}
          retry={() => {
            void students.refetch();
            void grades.refetch();
          }}
        />
      ) : students.data?.length ? (
        <section className="tw-card">
          <Field label="ابدأ من قالب دفتر الدرجات">
            <select
              value=""
              onChange={(event) => {
                const preset = classes.data?.find((item) => item.id === classId)
                  ?.gradebookTemplate?.[Number(event.target.value)];
                if (preset) {
                  setAssessment("");
                  setTitle(preset.title);
                  setTotalMarks(preset.totalMarks);
                  setMarks({});
                }
              }}
            >
              <option value="">اختر قالبًا أو اكتب تقييمًا جديدًا</option>
              {classes.data
                ?.find((item) => item.id === classId)
                ?.gradebookTemplate?.map((preset, index) => (
                  <option value={index} key={index}>
                    {preset.title} · {number(preset.totalMarks)} درجة
                  </option>
                ))}
            </select>
          </Field>
          <div className="tw-form-grid">
            <Field label="عنوان التقييم *">
              <input
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                placeholder="اختبار الوحدة الأولى"
              />
            </Field>
            <Field label="الدرجة الكلية">
              <input
                type="number"
                min={0.1}
                max={10000}
                step="any"
                value={totalMarks}
                onChange={(event) => setTotalMarks(Number(event.target.value))}
              />
            </Field>
            <Field label="تاريخ التقييم">
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
          </div>
          <div className="tw-table-wrap">
            <table className="tw-table">
              <thead>
                <tr>
                  <th>الطالب</th>
                  <th>الدرجة</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {students.data.map((student) => (
                  <tr key={student.id}>
                    <td>{student.name}</td>
                    <td>
                      <div className="tw-inline-grades">
                        <input
                          aria-label={`درجة ${student.name}`}
                          className="tw-input"
                          inputMode="decimal"
                          value={marks[student.id] ?? ""}
                          onChange={(event) =>
                            setMarks({
                              ...marks,
                              [student.id]: normalizeTeacherDigits(
                                event.target.value,
                              ),
                            })
                          }
                        />
                        <span>/ {number(totalMarks)}</span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`tw-status ${marks[student.id]?.trim() ? "good" : "warn"}`}
                      >
                        {marks[student.id]?.trim() ? "مرصودة" : "لم ترصد"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tw-modal-footer">
            <button
              className="tw-button primary"
              disabled={action.busy || !title.trim() || totalMarks <= 0}
              onClick={() => void save()}
            >
              حفظ الدرجات
            </button>
          </div>
        </section>
      ) : (
        <Empty title="أضف الطلاب أولًا">
          <Link href="/teacher/students" className="tw-button">
            كشف الطلاب
          </Link>
        </Empty>
      )}
    </>
  );
}

function Tasks() {
  const query = useTeacherData<TeacherTask[]>("tasks"),
    classes = useTeacherData<TeacherClass[]>("classes"),
    action = useTeacherAction();
  const [editing, setEditing] = useState<Partial<TeacherTask> | null>(null),
    [status, setStatus] = useState("pending"),
    [completion, setCompletion] = useState<TeacherTask | null>(null);
  const students = useTeacherData<TeacherStudent[]>(
    "students",
    `?classId=${encodeURIComponent(completion?.classId ?? "")}&archived=false`,
    !!completion?.classId,
  );
  const list =
    query.data?.filter(
      (task) => !task.archived && (status === "all" || task.status === status),
    ) ?? [];
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      editing &&
      (await action.run(() =>
        teacherApi(
          `/teacher/tasks${editing.id ? `/${editing.id}` : ""}`,
          editing.id ? "PUT" : "POST",
          editing,
        ),
      ))
    )
      setEditing(null);
  };
  return (
    <>
      <div className="tw-toolbar">
        <button
          className="tw-button primary"
          onClick={() =>
            setEditing({
              title: "",
              classId: null,
              kind: "assignment",
              dueAt: null,
              status: "pending",
              notes: "",
              studentCompletion: [],
            })
          }
        >
          <Plus size={16} />
          إضافة واجب أو مهمة
        </button>
        <div className="tw-section-tabs" style={{ margin: 0 }}>
          {[
            { value: "pending", label: "المعلقة" },
            { value: "completed", label: "المكتملة" },
            { value: "all", label: "الكل" },
          ].map((item) => (
            <button
              className="tw-button"
              aria-pressed={status === item.value}
              onClick={() => setStatus(item.value)}
              key={item.value}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <Messages action={action} />
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <QueryError error={query.error} retry={() => void query.refetch()} />
      ) : list.length ? (
        <div className="tw-grid">
          {list.map((task) => (
            <section className="tw-card" key={task.id}>
              <div className="tw-toolbar">
                <span
                  className={`tw-status ${task.status === "completed" ? "good" : "warn"}`}
                >
                  {task.status === "completed" ? "مكتمل" : "قيد المتابعة"}
                </span>
                <span className="tw-muted tw-small">
                  {task.kind === "assignment" ? "واجب" : "مهمة"}
                </span>
              </div>
              <h2>{task.title}</h2>
              <p className="tw-muted tw-small tw-spaced">
                {task.classId
                  ? classes.data?.find((item) => item.id === task.classId)?.name
                  : "مهمة شخصية"}{" "}
                · الموعد: {formatDate(task.dueAt)}
              </p>
              {task.notes && (
                <p
                  className="tw-muted tw-small tw-spaced"
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {task.notes}
                </p>
              )}
              {task.kind === "assignment" && (
                <p className="tw-small tw-spaced">
                  {number(task.studentCompletion.length)} تسليم مسجل
                </p>
              )}
              <div className="tw-toolbar tw-spaced">
                <button
                  className="tw-button"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(() =>
                      teacherApi(`/teacher/tasks/${task.id}`, "PUT", {
                        ...task,
                        status:
                          task.status === "completed" ? "pending" : "completed",
                      }),
                    )
                  }
                >
                  <CheckCircle2 size={16} />
                  {task.status === "completed" ? "إعادة فتح" : "إكمال"}
                </button>
                {task.kind === "assignment" && task.classId && (
                  <button
                    className="tw-button"
                    onClick={() => setCompletion(task)}
                  >
                    رصد التسليم
                  </button>
                )}
                <button
                  className="tw-button tw-icon-button"
                  aria-label={`تعديل ${task.title}`}
                  onClick={() => setEditing(task)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="tw-button tw-icon-button danger"
                  aria-label={`أرشفة ${task.title}`}
                  disabled={action.busy}
                  onClick={() => {
                    if (window.confirm("أرشفة هذه المهمة؟"))
                      void action.run(() =>
                        teacherApi(`/teacher/tasks/${task.id}`, "DELETE"),
                      );
                  }}
                >
                  <Archive size={15} />
                </button>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty icon={CheckCircle2} title="لا توجد مهام في هذه الحالة">
          <p>أضف واجبًا لفصل أو مهمة شخصية مع موعد للمتابعة.</p>
        </Empty>
      )}
      {editing && (
        <Modal
          title={editing.id ? "تعديل المهمة" : "إضافة واجب أو مهمة"}
          close={() => setEditing(null)}
        >
          <form onSubmit={save}>
            <div className="tw-form-grid">
              <Field label="العنوان *" wide>
                <input
                  required
                  maxLength={200}
                  value={editing.title ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, title: event.target.value })
                  }
                />
              </Field>
              <Field label="النوع">
                <select
                  value={editing.kind}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      kind: event.target.value as TeacherTask["kind"],
                    })
                  }
                >
                  <option value="assignment">واجب</option>
                  <option value="task">مهمة شخصية</option>
                </select>
              </Field>
              <Field label="الفصل (اختياري)">
                <ClassSelect
                  classes={classes.data ?? []}
                  value={editing.classId ?? ""}
                  setValue={(value) =>
                    setEditing({
                      ...editing,
                      classId: value || null,
                      studentCompletion: [],
                    })
                  }
                />
              </Field>
              <Field label="الموعد (اختياري)">
                <input
                  type="datetime-local"
                  value={localDateTime(editing.dueAt)}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      dueAt: event.target.value
                        ? new Date(event.target.value).toISOString()
                        : null,
                    })
                  }
                />
              </Field>
              <Field label="الحالة">
                <select
                  value={editing.status}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      status: event.target.value as TeacherTask["status"],
                    })
                  }
                >
                  <option value="pending">قيد المتابعة</option>
                  <option value="completed">مكتمل</option>
                </select>
              </Field>
              <Field label="تفاصيل وملاحظات" wide>
                <textarea
                  maxLength={4000}
                  value={editing.notes ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, notes: event.target.value })
                  }
                />
              </Field>
            </div>
            <Messages action={action} />
            <div className="tw-modal-footer">
              <button
                type="button"
                className="tw-button"
                onClick={() => setEditing(null)}
              >
                إلغاء
              </button>
              <button className="tw-button primary" disabled={action.busy}>
                حفظ المهمة
              </button>
            </div>
          </form>
        </Modal>
      )}
      {completion && (
        <Modal
          title={`رصد تسليم: ${completion.title}`}
          close={() => setCompletion(null)}
        >
          {students.isLoading ? (
            <Loading />
          ) : students.error ? (
            <QueryError
              error={students.error}
              retry={() => void students.refetch()}
            />
          ) : students.data?.length ? (
            <div className="tw-list">
              {students.data.map((student) => (
                <label key={student.id} className="tw-list-item tw-check">
                  <input
                    type="checkbox"
                    checked={completion.studentCompletion.includes(student.id)}
                    onChange={(event) =>
                      setCompletion({
                        ...completion,
                        studentCompletion: event.target.checked
                          ? [...completion.studentCompletion, student.id]
                          : completion.studentCompletion.filter(
                              (id) => id !== student.id,
                            ),
                      })
                    }
                  />
                  <span>{student.name}</span>
                  <span className="tw-status">
                    {completion.studentCompletion.includes(student.id)
                      ? "سُلّم"
                      : "لم يسلم"}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="tw-muted">لا يوجد طلاب في هذا الفصل.</p>
          )}
          <Messages action={action} />
          <div className="tw-modal-footer">
            <button className="tw-button" onClick={() => setCompletion(null)}>
              إلغاء
            </button>
            <button
              className="tw-button primary"
              disabled={action.busy}
              onClick={() =>
                void action
                  .run(
                    () =>
                      teacherApi(
                        `/teacher/tasks/${completion.id}`,
                        "PUT",
                        completion,
                      ),
                    "حُفظ رصد التسليم.",
                  )
                  .then((okay) => {
                    if (okay) setCompletion(null);
                  })
              }
            >
              حفظ الرصد
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Lessons() {
  const query = useTeacherData<TeacherLesson[]>("lessons"),
    classes = useTeacherData<TeacherClass[]>("classes"),
    profile = useTeacherData<TeacherProfile>("profile"),
    action = useTeacherAction();
  const [editing, setEditing] = useState<Partial<TeacherLesson> | null>(null),
    [classId, setClassId] = useState(""),
    [printLesson, setPrintLesson] = useState<TeacherLesson | null>(null);
  const list =
    query.data?.filter(
      (item) => !item.archived && (!classId || item.classId === classId),
    ) ?? [];
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      editing &&
      (await action.run(() =>
        teacherApi(
          `/teacher/lessons${editing.id ? `/${editing.id}` : ""}`,
          editing.id ? "PUT" : "POST",
          editing,
        ),
      ))
    )
      setEditing(null);
  };
  const duplicateWeek = async () => {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    const previous = list.filter(
      (lesson) =>
        new Date(lesson.date) >= start &&
        new Date(lesson.date) < new Date(today()),
    );
    if (!previous.length) {
      await action.run(async () => {
        throw new Error("لا توجد خطط محفوظة في الأسبوع السابق لهذا الفصل.");
      });
      return;
    }
    if (
      !window.confirm(
        `إنشاء ${number(previous.length)} نسخة من خطط آخر سبعة أيام، بتواريخ متقدمة أسبوعًا؟`,
      )
    )
      return;
    await action.run(async () => {
      for (const lesson of previous) {
        const date = new Date(lesson.date);
        date.setDate(date.getDate() + 7);
        await teacherApi("/teacher/lessons", "POST", {
          ...lesson,
          id: undefined,
          date: date.toISOString().slice(0, 10),
          title: `${lesson.title} — نسخة`,
        });
      }
    }, "أُنشئت نسخ الأسبوع القادم. راجعها قبل الاستخدام.");
  };
  const print = (lesson: TeacherLesson) => {
    setPrintLesson(lesson);
    setTimeout(() => window.print(), 100);
  };
  return (
    <>
      <div className="tw-toolbar">
        <button
          className="tw-button primary"
          onClick={() =>
            setEditing({
              title: "",
              classId: classId || null,
              date: today(),
              objectives: "",
              content: "",
              homework: "",
            })
          }
        >
          <Plus size={16} />
          تحضير جديد
        </button>
        <Field label="الفصل">
          <ClassSelect
            classes={classes.data ?? []}
            value={classId}
            setValue={setClassId}
            allowAll
          />
        </Field>
        <button
          className="tw-button"
          disabled={action.busy}
          onClick={() => void duplicateWeek()}
        >
          <Copy size={16} />
          تكرار خطط الأسبوع السابق
        </button>
      </div>
      <Messages action={action} />
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <QueryError error={query.error} retry={() => void query.refetch()} />
      ) : list.length ? (
        <div className="tw-grid">
          {list.map((lesson) => (
            <section className="tw-card" key={lesson.id}>
              <p className="tw-eyebrow">
                {formatDate(lesson.date)} ·{" "}
                {classes.data?.find((item) => item.id === lesson.classId)
                  ?.name ?? "خطة عامة"}
              </p>
              <h2>{lesson.title}</h2>
              <p
                className="tw-muted tw-spaced"
                style={{ whiteSpace: "pre-wrap" }}
              >
                {lesson.objectives || "لم تُضف أهداف الدرس."}
              </p>
              <div className="tw-toolbar tw-spaced">
                <button
                  className="tw-button"
                  onClick={() => setEditing(lesson)}
                >
                  <Pencil size={15} />
                  تعديل
                </button>
                <button
                  className="tw-button"
                  onClick={() =>
                    setEditing({
                      ...lesson,
                      id: undefined,
                      title: `${lesson.title} — نسخة`,
                      date: today(),
                    })
                  }
                >
                  <Copy size={15} />
                  نسخة جديدة
                </button>
                <button
                  className="tw-button tw-icon-button"
                  aria-label={`طباعة ${lesson.title}`}
                  onClick={() => print(lesson)}
                >
                  <Printer size={15} />
                </button>
                <button
                  className="tw-button tw-icon-button danger"
                  aria-label={`أرشفة ${lesson.title}`}
                  disabled={action.busy}
                  onClick={() => {
                    if (window.confirm("أرشفة هذا التحضير؟"))
                      void action.run(() =>
                        teacherApi(`/teacher/lessons/${lesson.id}`, "DELETE"),
                      );
                  }}
                >
                  <Archive size={15} />
                </button>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty icon={BookOpen} title="ابدأ بتحضير درسك الأول">
          <p>أهداف، خطوات، واجب، وتاريخ؛ كلها محفوظة وقابلة للتعديل.</p>
        </Empty>
      )}
      {editing && (
        <Modal
          title={editing.id ? "تعديل التحضير" : "تحضير جديد"}
          close={() => setEditing(null)}
          wide
        >
          <form onSubmit={save}>
            <div className="tw-form-grid">
              <Field label="عنوان الدرس *">
                <input
                  required
                  maxLength={200}
                  value={editing.title ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, title: event.target.value })
                  }
                />
              </Field>
              <Field label="الفصل">
                <ClassSelect
                  classes={classes.data ?? []}
                  value={editing.classId ?? ""}
                  setValue={(value) =>
                    setEditing({ ...editing, classId: value || null })
                  }
                />
              </Field>
              <Field label="التاريخ">
                <input
                  type="date"
                  required
                  value={editing.date ?? today()}
                  onChange={(event) =>
                    setEditing({ ...editing, date: event.target.value })
                  }
                />
              </Field>
              <Field label="أهداف الدرس" wide>
                <textarea
                  maxLength={12000}
                  value={editing.objectives ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, objectives: event.target.value })
                  }
                />
              </Field>
              <Field label="الخطوات والأنشطة والتقويم" wide>
                <textarea
                  maxLength={20000}
                  value={editing.content ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, content: event.target.value })
                  }
                  style={{ minHeight: 180 }}
                />
              </Field>
              <Field label="الواجب أو المتابعة" wide>
                <textarea
                  maxLength={12000}
                  value={editing.homework ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, homework: event.target.value })
                  }
                />
              </Field>
            </div>
            <Messages action={action} />
            <div className="tw-modal-footer">
              <button
                type="button"
                className="tw-button"
                onClick={() => setEditing(null)}
              >
                إلغاء
              </button>
              <button className="tw-button primary" disabled={action.busy}>
                حفظ التحضير
              </button>
            </div>
          </form>
        </Modal>
      )}
      {printLesson && (
        <div className="tw-print-view" data-active="true">
          <h1>تحضير درس: {printLesson.title}</h1>
          <p>
            المدرسة: {profile.data?.schoolName} · المعلم:{" "}
            {profile.data?.teacherName}
          </p>
          <p>
            الفصل:{" "}
            {classes.data?.find((item) => item.id === printLesson.classId)
              ?.name ?? "خطة عامة"}{" "}
            · العام: {profile.data?.year} · الفصل الدراسي: {profile.data?.term}
          </p>
          <p>التاريخ: {formatDate(printLesson.date)}</p>
          <h2>الأهداف</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{printLesson.objectives}</p>
          <h2>الخطوات والأنشطة</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{printLesson.content}</p>
          <h2>الواجب</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{printLesson.homework}</p>
          <p className="print-note">
            {profile.data?.signature ||
              "توقيع المعلم: .........................."}
          </p>
        </div>
      )}
    </>
  );
}

function QuestionBank() {
  const query = useTeacherData<TeacherQuestion[]>("questions"),
    profile = useTeacherData<TeacherProfile>("profile"),
    action = useTeacherAction();
  const [editing, setEditing] = useState<Partial<TeacherQuestion> | null>(null),
    [search, setSearch] = useState(""),
    [subject, setSubject] = useState("");
  const list =
    query.data?.filter(
      (item) =>
        !item.archived &&
        (!subject || item.subject === subject) &&
        [item.text, ...item.tags].join(" ").includes(search),
    ) ?? [];
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      editing &&
      (await action.run(() =>
        teacherApi(
          `/teacher/questions${editing.id ? `/${editing.id}` : ""}`,
          editing.id ? "PUT" : "POST",
          editing,
        ),
      ))
    )
      setEditing(null);
  };
  return (
    <>
      <div className="tw-toolbar">
        <div className="tw-search">
          <Search size={16} />
          <input
            placeholder="ابحث بالنص أو الوسم"
            aria-label="بحث في بنك الأسئلة"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Field label="المادة">
          <select
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          >
            <option value="">كل المواد</option>
            {[
              ...new Set(
                query.data?.map((item) => item.subject).filter(Boolean),
              ),
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <button
          className="tw-button primary"
          onClick={() =>
            setEditing({
              text: "",
              subject: profile.data?.subjects[0] ?? "",
              grade: "",
              kind: "text",
              options: [],
              answer: "",
              marks: 1,
              tags: [],
            })
          }
        >
          <Plus size={16} />
          إضافة سؤال
        </button>
      </div>
      <Messages action={action} />
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <QueryError error={query.error} retry={() => void query.refetch()} />
      ) : list.length ? (
        <div className="tw-grid">
          {list.map((question) => (
            <section className="tw-card" key={question.id}>
              <div className="tw-toolbar">
                <span className="tw-status">
                  {question.subject || "مادة غير محددة"}
                </span>
                <span className="tw-status">
                  {question.kind === "multiple-choice"
                    ? "اختيار متعدد"
                    : question.kind === "true-false"
                      ? "صح أو خطأ"
                      : "سؤال نصي"}
                </span>
                <span className="tw-muted tw-small">
                  {number(question.marks)} درجة
                </span>
              </div>
              <h2 style={{ whiteSpace: "pre-wrap" }}>{question.text}</h2>
              {question.options.length > 0 && (
                <ol
                  className="tw-muted tw-small tw-spaced"
                  style={{ paddingInlineStart: 24 }}
                >
                  {question.options.map((option, index) => (
                    <li key={index}>{option}</li>
                  ))}
                </ol>
              )}
              {question.answer && (
                <details className="tw-small tw-spaced">
                  <summary>الإجابة المرجعية — خاصة بالمعلم</summary>
                  <p
                    className="tw-muted tw-spaced"
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    {question.answer}
                  </p>
                </details>
              )}
              <div className="tw-toolbar tw-spaced">
                {question.tags.map((tag) => (
                  <span className="tw-status" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <div className="tw-toolbar">
                <button
                  className="tw-button"
                  onClick={() => setEditing(question)}
                >
                  <Pencil size={15} />
                  تعديل
                </button>
                <button
                  className="tw-button"
                  onClick={() => setEditing({ ...question, id: undefined })}
                >
                  <Copy size={15} />
                  نسخة
                </button>
                <button
                  className="tw-button danger tw-icon-button"
                  aria-label="أرشفة السؤال"
                  disabled={action.busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "أرشفة السؤال؟ لن تتغير الاختبارات المحفوظة سابقًا.",
                      )
                    )
                      void action.run(() =>
                        teacherApi(
                          `/teacher/questions/${question.id}`,
                          "DELETE",
                        ),
                      );
                  }}
                >
                  <Archive size={15} />
                </button>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty icon={FileQuestion} title="لا توجد أسئلة مطابقة">
          <p>احفظ أسئلتك مع خياراتها ودرجاتها وإجابتها المرجعية.</p>
        </Empty>
      )}
      {editing && (
        <Modal
          title={editing.id ? "تعديل السؤال" : "إضافة سؤال"}
          close={() => setEditing(null)}
          wide
        >
          <form onSubmit={save}>
            <div className="tw-form-grid">
              <Field label="نص السؤال *" wide>
                <textarea
                  required
                  maxLength={12000}
                  value={editing.text ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, text: event.target.value })
                  }
                />
              </Field>
              <Field label="المادة">
                <input
                  maxLength={200}
                  value={editing.subject ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, subject: event.target.value })
                  }
                />
              </Field>
              <Field label="الصف">
                <input
                  maxLength={200}
                  value={editing.grade ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, grade: event.target.value })
                  }
                />
              </Field>
              <Field label="نوع السؤال">
                <select
                  value={editing.kind}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      kind: event.target.value as TeacherQuestion["kind"],
                    })
                  }
                >
                  <option value="text">نصي</option>
                  <option value="multiple-choice">اختيار متعدد</option>
                  <option value="true-false">صح أو خطأ</option>
                </select>
              </Field>
              <Field label="الدرجة">
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step="0.5"
                  value={editing.marks ?? 1}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      marks: Number(event.target.value),
                    })
                  }
                />
              </Field>
              {editing.kind === "multiple-choice" && (
                <Field label="الخيارات — كل خيار في سطر" wide>
                  <textarea
                    value={editing.options?.join("\n") ?? ""}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        options: event.target.value.split("\n"),
                      })
                    }
                    maxLength={12000}
                  />
                </Field>
              )}
              <Field label="الإجابة المرجعية (اختياري)" wide>
                <textarea
                  value={editing.answer ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, answer: event.target.value })
                  }
                  maxLength={12000}
                />
              </Field>
              <Field
                label="الوسوم"
                hint="افصلها بفاصلة، مثل: الوحدة الأولى، مراجعة."
              >
                <input
                  value={editing.tags?.join("، ") ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      tags: event.target.value
                        .split(/[,،]/)
                        .map((value) => value.trim()),
                    })
                  }
                  maxLength={2000}
                />
              </Field>
            </div>
            <Messages action={action} />
            <div className="tw-modal-footer">
              <button
                type="button"
                className="tw-button"
                onClick={() => setEditing(null)}
              >
                إلغاء
              </button>
              <button className="tw-button primary" disabled={action.busy}>
                حفظ السؤال
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Reports() {
  const classes = useTeacherData<TeacherClass[]>("classes"),
    profile = useTeacherData<TeacherProfile>("profile");
  const [classId, setClassId] = useState(
      () => new URLSearchParams(window.location.search).get("class") ?? "",
    ),
    [type, setType] = useState(
      () => new URLSearchParams(window.location.search).get("type") ?? "roster",
    ),
    [date, setDate] = useState(
      () => new URLSearchParams(window.location.search).get("date") ?? today(),
    ),
    [print, setPrint] = useState(false),
    [printStyle, setPrintStyle] = useState<TeacherProfile["printStyle"] | "">(
      "",
    );
  const students = useTeacherData<TeacherStudent[]>(
      "students",
      `?classId=${encodeURIComponent(classId)}&archived=false`,
      !!classId,
    ),
    attendance = useTeacherData<AttendanceEntry[]>(
      "attendance",
      `?classId=${encodeURIComponent(classId)}&date=${date}`,
      !!classId && type === "attendance",
    ),
    grades = useTeacherData<TeacherGrade[]>(
      "grades",
      `?classId=${encodeURIComponent(classId)}`,
      !!classId && type === "grades",
    );
  const activeClass = classes.data?.find((item) => item.id === classId),
    heading =
      type === "attendance"
        ? "كشف الحضور والغياب"
        : type === "grades"
          ? "كشف الدرجات"
          : "كشف الطلاب";
  const headers = [
    "م",
    "اسم الطالب",
    "الرقم الداخلي",
    ...(type === "attendance"
      ? ["الحالة"]
      : type === "grades"
        ? ["التقييم", "الدرجة"]
        : ["الفصل"]),
  ];
  const rows: (string | number)[][] =
    type === "grades"
      ? (grades.data ?? []).map((grade, index) => [
          index + 1,
          students.data?.find((student) => student.id === grade.studentId)
            ?.name ?? "طالب مؤرشف أو منقول",
          students.data?.find((student) => student.id === grade.studentId)
            ?.internalId ?? "",
          grade.title,
          grade.marks === null
            ? "لم ترصد"
            : `${grade.marks} / ${grade.totalMarks}`,
        ])
      : (students.data ?? []).map((student, index) => [
          index + 1,
          student.name,
          student.internalId,
          type === "attendance"
            ? attendance.data?.find((entry) => entry.studentId === student.id)
              ? attendanceLabels[
                  attendance.data.find(
                    (entry) => entry.studentId === student.id,
                  )!.status
                ]
              : "غير مسجل"
            : (activeClass?.name ?? ""),
        ]);
  const table = (
    <table className="tw-table">
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header}>{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, column) => (
              <td key={column}>
                {typeof cell === "number" ? number(cell) : cell || "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  const isLoading =
      students.isLoading ||
      (type === "attendance" && attendance.isLoading) ||
      (type === "grades" && grades.isLoading),
    error =
      students.error ||
      (type === "attendance" && attendance.error) ||
      (type === "grades" && grades.error);
  useEffect(() => {
    const after = () => setPrint(false);
    window.addEventListener("afterprint", after);
    return () => window.removeEventListener("afterprint", after);
  }, []);
  return (
    <>
      <div className="tw-toolbar">
        <Field label="نوع التقرير">
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="roster">كشف الطلاب</option>
            <option value="attendance">الحضور والغياب</option>
            <option value="grades">الدرجات والتقييم</option>
          </select>
        </Field>
        <Field label="الفصل">
          <ClassSelect
            classes={classes.data ?? []}
            value={classId}
            setValue={setClassId}
          />
        </Field>
        {type === "attendance" && (
          <Field label="التاريخ">
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
        )}
        <Field label="تصميم الطباعة">
          <select
            value={printStyle || profile.data?.printStyle || "formal"}
            onChange={(event) =>
              setPrintStyle(event.target.value as TeacherProfile["printStyle"])
            }
          >
            <option value="formal">رسمي</option>
            <option value="primary">مناسب للمرحلة الابتدائية</option>
            <option value="minimal">اقتصادي للطباعة</option>
          </select>
        </Field>
        <button
          className="tw-button primary"
          disabled={!classId || !rows.length || isLoading || !!error}
          onClick={() => {
            setPrint(true);
            setTimeout(() => window.print(), 100);
          }}
        >
          <Printer size={16} />
          طباعة / حفظ PDF من المتصفح
        </button>
        <button
          className="tw-button"
          disabled={!classId || !rows.length || isLoading || !!error}
          onClick={() =>
            downloadTeacherCsv(`${heading}.csv`, [headers, ...rows])
          }
        >
          <Download size={16} />
          تصدير CSV
        </button>
      </div>
      <p className="tw-notice">
        المعاينة تعتمد على سجلاتك المحفوظة. اختيار «حفظ PDF» يتم داخل نافذة
        الطباعة إذا كان المتصفح يدعمه. لا يشمل الكشف ملاحظات الطلاب الخاصة.
      </p>
      {!classId ? (
        <Empty icon={Printer} title="اختر فصلًا لإعداد التقرير" />
      ) : isLoading ? (
        <Loading />
      ) : error ? (
        <QueryError
          error={error}
          retry={() => {
            void students.refetch();
            void attendance.refetch();
            void grades.refetch();
          }}
        />
      ) : rows.length ? (
        <section className="tw-card">
          <div className="tw-heading">
            <div>
              <h2>{heading}</h2>
              <p>
                {activeClass?.name} · {activeClass?.subject} ·{" "}
                {formatDate(type === "attendance" ? date : today())}
              </p>
            </div>
            <span className="tw-status">{number(rows.length)} سجل</span>
          </div>
          <div className="tw-table-wrap">
            <div className="tw-table">{table}</div>
          </div>
        </section>
      ) : (
        <Empty title="لا توجد سجلات لهذا التقرير" />
      )}
      <div
        className="tw-print-view"
        data-active={print ? "true" : "false"}
        data-style={printStyle || profile.data?.printStyle || "formal"}
      >
        {profile.data?.logoAssetId && (
          <img
            src={`/api/teacher/assets/${encodeURIComponent(profile.data.logoAssetId)}`}
            alt="شعار المدرسة"
            style={{
              width: 65,
              height: 65,
              objectFit: "contain",
              float: "left",
            }}
          />
        )}
        <h1>{heading}</h1>
        <div className="print-meta">
          <span>المدرسة: {profile.data?.schoolName}</span>
          <span>المعلم: {profile.data?.teacherName}</span>
        </div>
        <p>
          الفصل: {activeClass?.name} · المادة: {activeClass?.subject} · العام:{" "}
          {activeClass?.year} · الفصل الدراسي: {activeClass?.term}
        </p>
        <p>التاريخ: {formatDate(type === "attendance" ? date : today())}</p>
        {table}
        <p className="print-note">
          {profile.data?.signature ||
            "توقيع المعلم: .........................."}
        </p>
      </div>
    </>
  );
}

const ruleLabels: Record<TeacherRule["type"], string> = {
  upcoming: "تذكير بمواعيد الاختبارات والواجبات",
  absence: "متابعة الغياب المتكرر",
  grading: "درجات لم ترصد قرب الموعد",
  weekly: "ملخص أسبوعي من السجلات",
  draft: "مسودة تحتاج إلى إكمال",
  recurring: "تذكير دوري داخل التطبيق",
};
function Automations() {
  const rules = useTeacherData<TeacherRule[]>("automations"),
    reminders = useTeacherData<TeacherReminder[]>("reminders"),
    classes = useTeacherData<TeacherClass[]>("classes"),
    action = useTeacherAction();
  const [editing, setEditing] = useState<Partial<TeacherRule> | null>(null),
    [showRead, setShowRead] = useState(false);
  const config = editing?.config ?? {};
  const patchConfig = (patch: Partial<TeacherRule["config"]>) =>
    setEditing((previous) => ({
      ...previous,
      config: { ...previous?.config, ...patch },
    }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      editing &&
      (await action.run(() =>
        teacherApi(
          `/teacher/automations${editing.id ? `/${editing.id}` : ""}`,
          editing.id ? "PUT" : "POST",
          editing,
        ),
      ))
    )
      setEditing(null);
  };
  return (
    <>
      <div className="tw-toolbar">
        <button
          className="tw-button primary"
          onClick={() =>
            setEditing({
              name: "",
              type: "upcoming",
              enabled: true,
              config: { daysBefore: 2, hour: 8 },
            })
          }
        >
          <Plus size={16} />
          قاعدة جديدة
        </button>
        <button
          className="tw-button"
          disabled={action.busy}
          onClick={() =>
            void action.run(
              () => teacherApi("/teacher/automations/run", "POST", {}),
              "اكتملت مراجعة القواعد. راجع النتائج والتذكيرات.",
            )
          }
        >
          <RefreshCw size={16} />
          فحص القواعد الآن
        </button>
      </div>
      <p className="tw-notice">
        التذكيرات داخل حساب المعلم فقط. يظهر وقت التنفيذ القادم ونتيجة كل قاعدة؛
        لا تُرسل رسائل لأولياء الأمور أو الطلاب.
      </p>
      <Messages action={action} />
      <section className="tw-card">
        <h2>قواعدك</h2>
        {rules.isLoading ? (
          <Loading />
        ) : rules.error ? (
          <QueryError error={rules.error} retry={() => void rules.refetch()} />
        ) : rules.data?.length ? (
          <div className="tw-list">
            {rules.data.map((rule) => (
              <div className="tw-list-item" key={rule.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="tw-toolbar" style={{ margin: 0 }}>
                    <strong>{rule.name}</strong>
                    <span className={`tw-status ${rule.enabled ? "good" : ""}`}>
                      {rule.enabled ? "مفعّلة" : "متوقفة"}
                    </span>
                  </div>
                  <div className="tw-rule-meta">
                    <span>المحفّز: {rule.type === "upcoming" && rule.config.classId ? "تذكير بمواعيد واجبات الفصل ومهامه" : ruleLabels[rule.type]}</span>
                    {rule.config.classId && ["upcoming", "absence", "grading", "weekly"].includes(rule.type) && <span>الفصل: {classes.data?.find((item) => item.id === rule.config.classId)?.name || "فصل محفوظ"}</span>}
                    <span>
                      الشروط:{" "}
                      {rule.type === "absence"
                        ? `الغياب ${rule.config.threshold ?? 3} مرات`
                        : rule.type === "recurring"
                          ? `كل ${rule.config.intervalDays ?? 1} يوم`
                          : rule.type === "weekly"
                            ? `اليوم ${["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"][rule.config.weekDay ?? 0]}`
                            : `قبل الموعد بـ ${rule.config.daysBefore ?? 2} يوم`}{" "}
                      · الإجراء: تذكير داخل التطبيق
                    </span>
                    <span>
                      التنفيذ القادم:{" "}
                      {rule.nextRunAt
                        ? new Date(rule.nextRunAt).toLocaleString("ar-SA", {
                            calendar: "gregory",
                          })
                        : "غير مجدول"}
                    </span>
                    <span>
                      آخر تنفيذ: {formatDate(rule.lastRunAt)} ·{" "}
                      {rule.lastResult || "لم تنفذ بعد"}
                    </span>
                    {rule.error && (
                      <span style={{ color: "#ffc4cf" }}>
                        خطأ: {rule.error}
                      </span>
                    )}
                  </div>
                </div>
                <div className="tw-actions">
                  <button
                    className="tw-button"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(
                        () =>
                          teacherApi(`/teacher/automations/${rule.id}`, "PUT", {
                            ...rule,
                            enabled: !rule.enabled,
                          }),
                        rule.enabled ? "أُوقفت القاعدة." : "فُعّلت القاعدة.",
                      )
                    }
                  >
                    {rule.enabled ? "إيقاف" : "تفعيل"}
                  </button>
                  <button
                    className="tw-button tw-icon-button"
                    aria-label={`تعديل ${rule.name}`}
                    onClick={() => setEditing(rule)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="tw-button tw-icon-button"
                    aria-label={`نسخ ${rule.name}`}
                    onClick={() =>
                      setEditing({
                        ...rule,
                        id: undefined,
                        name: `${rule.name} — نسخة`,
                      })
                    }
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    className="tw-button tw-icon-button danger"
                    aria-label={`حذف ${rule.name}`}
                    disabled={action.busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "حذف القاعدة وإيقاف تذكيراتها المستقبلية؟ تبقى التذكيرات السابقة.",
                        )
                      )
                        void action.run(() =>
                          teacherApi(
                            `/teacher/automations/${rule.id}`,
                            "DELETE",
                          ),
                        );
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon={Zap} title="لا توجد قواعد بعد">
            <p>ابدأ بتذكير يومي أو بمتابعة الغياب المتكرر.</p>
          </Empty>
        )}
      </section>
      <section className="tw-card">
        <div className="tw-toolbar">
          <h2>التذكيرات</h2>
          <label className="tw-check">
            <input
              type="checkbox"
              checked={showRead}
              onChange={(event) => setShowRead(event.target.checked)}
            />
            عرض المقروءة
          </label>
        </div>
        {reminders.isLoading ? (
          <Loading />
        ) : reminders.error ? (
          <QueryError
            error={reminders.error}
            retry={() => void reminders.refetch()}
          />
        ) : reminders.data?.filter((item) => showRead || !item.read).length ? (
          <div className="tw-list">
            {reminders.data
              .filter((item) => showRead || !item.read)
              .map((item) => (
                <div className="tw-list-item" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.body}</p>
                    <p>{formatDate(item.createdAt)}</p>
                  </div>
                  <button
                    className="tw-button"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(() =>
                        teacherApi(`/teacher/reminders/${item.id}`, "PUT", {
                          read: !item.read,
                        }),
                      )
                    }
                  >
                    {item.read ? "غير مقروء" : "تمت المراجعة"}
                  </button>
                </div>
              ))}
          </div>
        ) : (
          <Empty icon={Bell} title="لا توجد تذكيرات في هذه الحالة" />
        )}
      </section>
      {editing && (
        <Modal
          title={editing.id ? "تعديل قاعدة الأتمتة" : "قاعدة جديدة"}
          close={() => setEditing(null)}
        >
          <form onSubmit={save}>
            <div className="tw-form-grid">
              <Field label="اسم القاعدة *" wide>
                <input
                  required
                  maxLength={200}
                  value={editing.name ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, name: event.target.value })
                  }
                />
              </Field>
              <Field label="المحفّز" wide>
                <select
                  value={editing.type}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      type: event.target.value as TeacherRule["type"],
                      config: {
                        daysBefore: 2,
                        threshold: 3,
                        hour: 8,
                        intervalDays: 1,
                        weekDay: 0,
                      },
                    })
                  }
                >
                  {Object.entries(ruleLabels).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              {["upcoming", "absence", "grading", "weekly"].includes(editing.type ?? "") && <Field label="الفصل (اختياري)" hint={editing.type === "upcoming" ? "عند اختيار فصل تُفحص واجباته ومهامه فقط. اختر جميع الفصول ليشمل التذكير الاختبارات أيضًا." : undefined}>
                <ClassSelect
                  classes={classes.data ?? []}
                  value={config.classId ?? ""}
                  setValue={(value) =>
                    patchConfig({ classId: value || undefined })
                  }
                  allowAll
                />
              </Field>}
              {editing.type === "absence" ? (
                <Field label="عدد مرات الغياب">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={config.threshold ?? 3}
                    onChange={(event) =>
                      patchConfig({ threshold: Number(event.target.value) })
                    }
                  />
                </Field>
              ) : editing.type === "recurring" ? (
                <>
                  <Field label="التكرار كل عدد أيام">
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={config.intervalDays ?? 1}
                      onChange={(event) =>
                        patchConfig({
                          intervalDays: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="نص التذكير" wide>
                    <input
                      required
                      maxLength={500}
                      value={config.title ?? ""}
                      onChange={(event) =>
                        patchConfig({ title: event.target.value })
                      }
                    />
                  </Field>
                </>
              ) : editing.type === "weekly" ? (
                <Field label="يوم الملخص">
                  <select
                    value={config.weekDay ?? 0}
                    onChange={(event) =>
                      patchConfig({ weekDay: Number(event.target.value) })
                    }
                  >
                    {[
                      "الأحد",
                      "الاثنين",
                      "الثلاثاء",
                      "الأربعاء",
                      "الخميس",
                      "الجمعة",
                      "السبت",
                    ].map((label, value) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="عدد الأيام قبل الموعد">
                  <input
                    type="number"
                    min={0}
                    max={90}
                    value={config.daysBefore ?? 2}
                    onChange={(event) =>
                      patchConfig({ daysBefore: Number(event.target.value) })
                    }
                  />
                </Field>
              )}
              {editing.type === "draft" && (
                <Field label="موعد إكمال المسودة">
                  <input
                    type="datetime-local"
                    value={localDateTime(config.dueAt)}
                    onChange={(event) =>
                      patchConfig({
                        dueAt: event.target.value
                          ? new Date(event.target.value).toISOString()
                          : undefined,
                      })
                    }
                  />
                </Field>
              )}
              <Field
                label="ساعة المراجعة (UTC)"
                hint="تُعرض مواعيد التنفيذ في الواجهة بتوقيت جهازك."
              >
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={config.hour ?? 8}
                  onChange={(event) =>
                    patchConfig({ hour: Number(event.target.value) })
                  }
                />
              </Field>
              <label className="tw-check">
                <input
                  type="checkbox"
                  checked={editing.enabled ?? true}
                  onChange={(event) =>
                    setEditing({ ...editing, enabled: event.target.checked })
                  }
                />
                تفعيل القاعدة
              </label>
            </div>
            <Messages action={action} />
            <div className="tw-modal-footer">
              <button
                type="button"
                className="tw-button"
                onClick={() => setEditing(null)}
              >
                إلغاء
              </button>
              <button className="tw-button primary" disabled={action.busy}>
                حفظ القاعدة
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
