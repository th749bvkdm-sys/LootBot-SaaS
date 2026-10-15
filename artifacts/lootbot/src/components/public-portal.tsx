import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import {
  ArrowUpLeft,
  BookOpen,
  GraduationCap,
  ShieldCheck,
  KeyRound,
  Layers,
  Target,
  Store,
  ChevronLeft,
  Check,
  Compass,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import { teacherApi } from "../lib/teacher-api";
import "./public-portal.css";
type Props = { locale: "ar" | "en"; toggleLocale: () => void };
export function PublicLanding({ locale, toggleLocale }: Props) {
  const ar = locale === "ar";
  const spaces = [
    {
      icon: GraduationCap,
      title: ar ? "غرفة الطالب" : "Student room",
      text: ar
        ? "ادخل برمزك الشخصي، وافتح أنشطتك وخطة تعلمك."
        : "Use your personal code to open activities and learning plans.",
      href: "/student-entry",
      cta: ar ? "التسجيل كطالب" : "Student access",
    },
    {
      icon: BookOpen,
      title: ar ? "مساحة المعلم" : "Teacher workspace",
      text: ar
        ? "نظّم فصولك وأنشطتك، وتابع التقدم من الإجابات الفعلية."
        : "Organize classes and activities, and follow actual learning progress.",
      href: "/login",
      cta: ar ? "دخول المعلم" : "Teacher sign in",
    },
    {
      icon: Store,
      title: ar ? "إدارة المتجر" : "Store management",
      text: ar
        ? "إدارة المنتجات والطلبات وربط بوت تيليجرام في مساحة واحدة."
        : "Manage products, orders and your Telegram bot in one workspace.",
      href: "/register",
      cta: ar ? "إنشاء حساب" : "Create an account",
    },
  ];
  return (
    <main className="portal" dir={ar ? "rtl" : "ltr"}>
      <header className="portal-header">
        <Link className="portal-brand" href="/">
          <BrandMark />
          <span>
            LootBot
            <small>{ar ? "مساحات مترابطة" : "Connected workspaces"}</small>
          </span>
        </Link>
        <nav aria-label={ar ? "التنقل الرئيسي" : "Main navigation"}>
          <button className="portal-locale" onClick={toggleLocale}>
            {ar ? "EN" : "العربية"}
          </button>
          <Link className="portal-nav-link" href="/login">
            {ar ? "تسجيل الدخول" : "Sign in"}
          </Link>
          <Link className="portal-button small" href="/student-entry">
            {ar ? "التسجيل كطالب" : "Student access"}
            <KeyRound size={16} />
          </Link>
        </nav>
      </header>
      <section className="portal-hero">
        <div className="portal-intro">
          <div className="portal-eyebrow">
            <span />
            {ar
              ? "التعلّم والتنظيم، في مساحة واحدة"
              : "Learning and organization, together"}
          </div>
          <h1>
            {ar ? (
              <>
                خطوتك القادمة،
                <br />
                <em>تبدأ هنا.</em>
              </>
            ) : (
              <>
                Your next chapter
                <br />
                <em>starts here.</em>
              </>
            )}
          </h1>
          <p>
            {ar
              ? "مساحة للطالب يتعلم فيها، وللمعلم ينظّم فيها، ولصاحب المتجر يدير منها عمله. اختر مساحتك وابدأ رحلتك."
              : "A space to learn, teach and manage your work. Choose your workspace and begin your next chapter."}
          </p>
          <div className="portal-cta">
            <Link href="/student-entry" className="portal-button">
              {ar ? "ابدأ كطالب" : "Enter as a student"}
              <ArrowUpLeft size={19} />
            </Link>
            <Link href="/login" className="portal-button secondary">
              {ar ? "الدخول إلى حسابي" : "Sign in to my account"}
            </Link>
          </div>
          <div className="portal-trust">
            <ShieldCheck size={18} />
            {ar
              ? "رمز الطالب شخصي. بيانات كل حساب تبقى في مساحته."
              : "Personal student access. Each account has its own workspace."}
          </div>
        </div>
        <div
          className="portal-scene"
          aria-label={
            ar ? "استكشف مساحات المنصة" : "Explore platform workspaces"
          }
        >
          <div className="portal-orbit" aria-hidden="true" />
          <div className="portal-glass-window">
            <div className="portal-window-top">
              <span className="portal-window-dots">
                <i />
                <i />
                <i />
              </span>
              <span>{ar ? "مساحتك • رحلتك" : "Your space • your journey"}</span>
              <Layers size={18} />
            </div>
            <div className="portal-window-heading">
              <div className="portal-floating-icon">
                <GraduationCap size={39} />
              </div>
              <div>
                <small>{ar ? "LOOTBOT للتعليم" : "LOOTBOT EDUCATION"}</small>
                <h2>
                  {ar
                    ? "معرفة أعمق. خطوة أوضح."
                    : "Learn deeper. Move forward."}
                </h2>
              </div>
            </div>
            <div className="portal-path">
              <span>
                <Compass size={17} />
                {ar ? "اختر مساحتك" : "Choose your space"}
              </span>
              <ChevronLeft size={15} />
              <span>
                <KeyRound size={17} />
                {ar ? "ادخل بأمان" : "Enter securely"}
              </span>
              <ChevronLeft size={15} />
              <span>
                <Check size={17} />
                {ar ? "ابدأ رحلتك" : "Begin your journey"}
              </span>
            </div>
            <div className="portal-scene-grid">
              <Link href="/student-entry">
                <BookOpen />
                <strong>
                  {ar ? "أنشطتك التعليمية" : "Learning activities"}
                </strong>
                <small>
                  {ar
                    ? "المحتوى الذي يشاركك معلمك"
                    : "Content shared by your teacher"}
                </small>
                <ArrowUpLeft size={17} />
              </Link>
              <Link href="/student-entry">
                <Target />
                <strong>{ar ? "مركز القدرات" : "Aptitude practice"}</strong>
                <small>
                  {ar
                    ? "تدريب كمي ولفظي ومراجعة"
                    : "Quantitative and verbal practice"}
                </small>
                <ArrowUpLeft size={17} />
              </Link>
            </div>
            <div className="portal-scene-note">
              <ShieldCheck size={18} />
              <p>
                {ar
                  ? "مساحتك التعليمية خاصة بك. افتح أنشطتك وتابع تقدمك بعد الدخول."
                  : "Your learning space is private. Sign in to open activities and follow your progress."}
              </p>
            </div>
          </div>
          <div className="portal-floating-label">
            <KeyRound size={20} />
            <div>
              <b>{ar ? "للطالب: رمز واحد فقط" : "Students: just one code"}</b>
              <small>
                {ar
                  ? "يجهّزه المعلم أو المدرسة"
                  : "Provided by your teacher or school"}
              </small>
            </div>
          </div>
        </div>
      </section>
      <section className="portal-spaces" id="spaces">
        <div className="portal-section-title">
          <span>{ar ? "مساحة لكل رحلة" : "A space for every journey"}</span>
          <h2>{ar ? "اختر ما يناسبك." : "Find your workspace."}</h2>
        </div>
        <div className="portal-space-grid">
          {spaces.map((s) => (
            <article className="portal-space-card" key={s.href}>
              <div className="portal-card-icon">
                <s.icon size={27} />
              </div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <Link href={s.href}>
                {s.cta}
                <ArrowUpLeft size={18} />
              </Link>
            </article>
          ))}
        </div>
      </section>
      <section className="portal-bottom">
        <div>
          <span>
            {ar
              ? "بداية بسيطة. مساحة خاصة."
              : "A simple start. Your own space."}
          </span>
          <h2>{ar ? "وصلك رمز من معلمك؟" : "Got a code from your teacher?"}</h2>
          <p>
            {ar
              ? "اضغط التسجيل كطالب والصق الرمز. لا تحتاج إلى بريد أو كلمة مرور."
              : "Choose student access and paste the code. No email or password required."}
          </p>
        </div>
        <Link className="portal-button" href="/student-entry">
          {ar ? "افتح غرفة الطالب" : "Open the student room"}
          <ArrowUpLeft size={18} />
        </Link>
      </section>
      <footer className="portal-footer">
        <Link className="portal-brand" href="/">
          <BrandMark small />
          <b>LootBot</b>
        </Link>
        <span>
          {ar
            ? "التعلّم والتنظيم يبدأان بخطوة."
            : "Learning and organization start with a step."}
        </span>
        <Link href="/login">{ar ? "تسجيل الدخول" : "Sign in"}</Link>
      </footer>
    </main>
  );
}
export function StudentCodeEntry({ locale, toggleLocale }: Props) {
  const ar = locale === "ar",
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await teacherApi("/auth/student-code", "POST", { code });
      window.location.assign("/student");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : ar
            ? "تعذر الدخول. حاول مجددًا."
            : "Unable to sign in. Please try again.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="portal portal-entry" dir={ar ? "rtl" : "ltr"}>
      <header className="portal-header">
        <Link className="portal-brand" href="/">
          <BrandMark />
          <b>LootBot</b>
        </Link>
        <button className="portal-locale" onClick={toggleLocale}>
          {ar ? "EN" : "العربية"}
        </button>
      </header>
      <div className="portal-entry-grid">
        <section className="portal-entry-story">
          <span className="portal-eyebrow">
            {ar ? "غرفة الطالب" : "STUDENT ROOM"}
          </span>
          <h1>
            {ar ? (
              <>
                رحلتك تبدأ
                <br />
                <em>برمز واحد.</em>
              </>
            ) : (
              <>
                One code.
                <br />
                <em>Your next chapter.</em>
              </>
            )}
          </h1>
          <p>
            {ar
              ? "معلمك يجهّز حسابك وفصلك. أنت تدخل الرمز، وتكمل التعلم من حيث توقفت."
              : "Your teacher prepares your account and class. Enter your code and continue learning."}
          </p>
          <div className="portal-entry-benefits">
            <p>
              <Check size={18} />
              {ar ? "دون بريد إلكتروني أو كلمة مرور" : "No email or password"}
            </p>
            <p>
              <Check size={18} />
              {ar
                ? "أنشطتك وخطتك في مكان واحد"
                : "Activities and plans in one place"}
            </p>
            <p>
              <ShieldCheck size={18} />
              {ar
                ? "رمز شخصي، ونتائج خاصة بك"
                : "Personal code, private results"}
            </p>
          </div>
        </section>
        <section className="portal-entry-card">
          <div className="portal-card-icon">
            <KeyRound size={29} />
          </div>
          <h2>{ar ? "التسجيل كطالب" : "Student access"}</h2>
          <p>
            {ar
              ? "لأول دخول أو للعودة إلى حسابك: الصق رمز الدخول الشخصي الذي أعطاك معلمك أو مدرستك."
              : "For your first visit or to return: paste the personal access code from your teacher or school."}
          </p>
          <form onSubmit={submit}>
            <label htmlFor="personal-student-code">
              {ar ? "رمز الدخول الشخصي" : "Personal access code"}
            </label>
            <input
              id="personal-student-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              maxLength={100}
              dir="ltr"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            />
            <span className="portal-input-hint">
              {ar
                ? "هذا الرمز خاص بك؛ رمز انضمام الفصل العام لا يصلح للدخول."
                : "Use your personal code, not a shared classroom join code."}
            </span>
            {error && (
              <p className="portal-error" role="alert">
                {error}
              </p>
            )}
            <button className="portal-button" disabled={busy || !code.trim()}>
              {busy
                ? ar
                  ? "جار فتح غرفتك…"
                  : "Opening your room…"
                : ar
                  ? "ادخل إلى غرفتي"
                  : "Open my room"}
              <ArrowUpLeft size={18} />
            </button>
          </form>
          <div className="portal-entry-help">
            <p>
              {ar
                ? "ما عندك رمز؟ اطلب من معلمك تجهيز حسابك أو تجديد رمزك."
                : "No code? Ask your teacher to prepare your account or renew your code."}
            </p>
            <Link href="/login">
              {ar
                ? "دخول المعلم أو الحساب العادي"
                : "Teacher or regular account sign in"}
            </Link>
            <Link href="/">{ar ? "العودة إلى الرئيسية" : "Back to home"}</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
