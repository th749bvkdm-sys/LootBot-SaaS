import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  Flame,
  LogOut,
  Plus,
  RotateCcw,
  Target,
  Trash2,
  Trophy,
  Users,
} from "lucide-react";
import {
  studyApi,
  useStudy,
  useAcademy,
  studentNumber as n,
  type AcademyRow as Row,
} from "./student-academy-api";
import { StudentLoading, Listening } from "./student-academy";
export function StudentStudy({
  view,
}: {
  view: "plan" | "rooms" | "achievements";
}) {
  const overview = useStudy("/overview"),
    qc = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [room, setRoom] = useState(
      new URLSearchParams(window.location.search).get("studyRoom") || "",
    ),
    [invite, setInvite] = useState("");
  async function act(fn: () => Promise<unknown>, success = "تم الحفظ.") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fn();
      await qc.invalidateQueries({ queryKey: ["student-study"] });
      setMessage(success);
      return r as Row;
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  function selectRoom(id: string) {
    setRoom(id);
    setInvite("");
    const u = new URL(window.location.href);
    if (id) u.searchParams.set("studyRoom", id);
    else u.searchParams.delete("studyRoom");
    window.history.replaceState(null, "", u);
  }
  const d = overview.data;
  return (
    <div className="sa-workspace">
      {error && (
        <p className="edu-notice edu-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="edu-notice" role="status">
          {message}
        </p>
      )}
      <StudentLoading query={overview}>
        {d && (
          <>
            {view === "plan" ? (
              <>
                <FocusPanel
                  data={d}
                  dataUpdatedAt={overview.dataUpdatedAt}
                  busy={busy}
                  act={act}
                />
                <Planner data={d} busy={busy} act={act} />
              </>
            ) : view === "achievements" ? (
              <>
                <section className="edu-card">
                  <span className="sa-overline">
                    <Flame size={17} />
                    مسافة قطعتها بنفسك
                  </span>
                  <h2>كل يوم تعلّم يُحسب.</h2>
                  <div className="sa-metrics">
                    {[
                      [d.stats.streakDays, "أيام السلسلة الحالية"],
                      [d.stats.totalFocusSessions, "جلسات تركيز مكتملة"],
                      [d.stats.totalAnswered, "إجابات فعلية"],
                      [d.stats.focusMinutesToday, "دقائق تركيز اليوم"],
                    ].map(([value, title]) => (
                      <article key={String(title)}>
                        <strong>{n(value)}</strong>
                        <span>{String(title)}</span>
                      </article>
                    ))}
                  </div>
                  <p>
                    تُحسب السلسلة من أيام الإجابات أو جلسات التركيز المكتملة
                    بتوقيت الرياض. لا تُخصم نقاط ولا توجد عقوبة على انقطاعها.
                  </p>
                </section>
                <div className="sa-badge-grid">
                  {d.badges.map((b: Row) => (
                    <article
                      className="edu-card sa-badge"
                      data-earned={b.earned}
                      key={b.id}
                    >
                      <Trophy />
                      <h3>{b.title}</h3>
                      <p>{b.description}</p>
                      <span className="sa-pill">
                        {b.earned ? "استحققتها" : "في طريقك إليها"}
                      </span>
                    </article>
                  ))}
                </div>
              </>
            ) : room ? (
              <RoomView
                id={room}
                back={() => selectRoom("")}
                act={act}
                busy={busy}
              />
            ) : (
              <>
                <section className="edu-card">
                  <span className="sa-overline">
                    <Users size={17} />
                    معًا، بتركيز أعلى
                  </span>
                  <h2>غرف مذاكرة خاصة</h2>
                  <p>
                    أنشئ غرفة داخل مدرستك وشارك رمزها مع زملائك. مؤقت مشترك
                    وتحديات من تمارين LootBot الأصلية، بأسماء مستعارة ومن دون
                    محادثة عامة.
                  </p>
                  <p className="edu-note">
                    لا تظهر الغرفة في دليل عام، ولا تُعرض أرقام الطلاب أو عناوين
                    البريد.
                  </p>
                </section>
                <div className="sa-dashboard-grid">
                  <section className="edu-card">
                    <h2>أنشئ غرفتك</h2>
                    <form
                      className="edu-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        const r = await act(
                          () =>
                            studyApi("/rooms", "POST", {
                              title: f.get("title"),
                              nickname: f.get("nickname"),
                              capacity: Number(f.get("capacity")),
                            }),
                          "غرفتك جاهزة.",
                        );
                        if (r) {
                          setRoom(r.room.id);
                          setInvite(r.inviteCode);
                          const u = new URL(window.location.href);
                          u.searchParams.set("studyRoom", r.room.id);
                          window.history.replaceState(null, "", u);
                        }
                      }}
                    >
                      <label className="edu-wide">
                        عنوان الغرفة
                        <input
                          name="title"
                          required
                          maxLength={80}
                          placeholder="مراجعة المساء"
                        />
                      </label>
                      <label>
                        اسمك المستعار
                        <input
                          name="nickname"
                          required
                          maxLength={24}
                          placeholder="متعلّم"
                          autoComplete="off"
                        />
                      </label>
                      <label>
                        سعة الغرفة
                        <select name="capacity" defaultValue="6">
                          {[2, 4, 6, 8, 12].map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </label>
                      <button className="edu-button" disabled={busy}>
                        <Plus size={17} />
                        إنشاء غرفة خاصة
                      </button>
                    </form>
                  </section>
                  <section className="edu-card">
                    <h2>انضم إلى زملائك</h2>
                    <form
                      className="edu-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        const r = await act(
                          () =>
                            studyApi("/rooms/join", "POST", {
                              code: f.get("code"),
                              nickname: f.get("nickname"),
                            }),
                          "انضممت إلى الغرفة.",
                        );
                        if (r) selectRoom(r.room?.id || r.id);
                      }}
                    >
                      <label className="edu-wide">
                        رمز الغرفة
                        <input
                          name="code"
                          required
                          autoComplete="off"
                          dir="ltr"
                          placeholder="الرمز من صاحب الغرفة"
                        />
                      </label>
                      <label className="edu-wide">
                        اسمك المستعار
                        <input name="nickname" required maxLength={24} />
                      </label>
                      <button className="edu-button secondary" disabled={busy}>
                        انضمام
                        <ArrowLeft size={16} />
                      </button>
                    </form>
                  </section>
                </div>
                <section className="edu-card">
                  <h2>غرفي</h2>
                  {d.rooms.length ? (
                    d.rooms.map((r: Row) => (
                      <div className="edu-row" key={r.id}>
                        <div>
                          <b>{r.title}</b>
                          <small>
                            {n(r.memberCount)} / {n(r.capacity)} مشاركين ·{" "}
                            {r.isHost ? "أنت المضيف" : "عضو"}
                          </small>
                        </div>
                        <button
                          className="edu-button secondary"
                          onClick={() => selectRoom(r.id)}
                        >
                          فتح الغرفة
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="edu-empty">
                      ابدأ غرفة أو أدخل رمز دعوة للانضمام.
                    </p>
                  )}
                </section>
              </>
            )}
            {invite && (
              <section className="edu-card">
                <h2>رمز دعوة غرفتك</h2>
                <p className="edu-note">
                  انسخه الآن وشاركه مع زملائك في المدرسة فقط. لن يظهر في قوائم
                  الغرف.
                </p>
                <p className="sa-room-code">{invite}</p>
                <button
                  className="edu-button secondary"
                  onClick={() => {
                    if (navigator.clipboard)
                      void navigator.clipboard
                        .writeText(invite)
                        .then(() => setMessage("نُسخ رمز الغرفة."))
                        .catch(() => setMessage("حدّد الرمز وانسخه يدويًا."));
                    else setMessage("حدّد الرمز وانسخه يدويًا.");
                  }}
                >
                  <Copy size={16} />
                  نسخ رمز الغرفة
                </button>
              </section>
            )}
          </>
        )}
      </StudentLoading>
    </div>
  );
}
type Act = (
  fn: () => Promise<unknown>,
  success?: string,
) => Promise<Row | undefined>;
function FocusPanel({
  data,
  dataUpdatedAt,
  busy,
  act,
}: {
  data: Row;
  dataUpdatedAt: number;
  busy: boolean;
  act: Act;
}) {
  const [minutes, setMinutes] = useState(25),
    [goal, setGoal] = useState(data.dailyGoalMinutes),
    [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setGoal(data.dailyGoalMinutes), [data.dailyGoalMinutes]);
  const focus = data.activeFocus;
  const offset = new Date(data.serverNow).getTime() - dataUpdatedAt;
  const left = focus
    ? Math.max(
        0,
        Math.ceil((new Date(focus.endsAt).getTime() - tick - offset) / 1000),
      )
    : minutes * 60;
  return (
    <div className="sa-dashboard-grid">
      <section className="edu-card">
        <div className="sa-section-head">
          <div>
            <span className="sa-overline">جلسة لك وحدك</span>
            <h2>مساحة التركيز</h2>
          </div>
          <Clock size={25} />
        </div>
        <div className="sa-focus-ring">
          <strong>
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </strong>
          <span>
            {focus
              ? left
                ? "خذ نفسًا، وواصل بهدوء"
                : "أتممت الوقت، سجّل الجلسة"
              : "ابدأ عندما تكون جاهزًا"}
          </span>
        </div>
        <div className="sa-focus-controls">
          {focus ? (
            <>
              <button
                className="edu-button"
                disabled={busy || left > 0}
                onClick={() =>
                  void act(
                    () => studyApi(`/focus/${focus.id}/complete`, "POST", {}),
                    "أحسنت، سُجّلت جلسة التركيز.",
                  )
                }
              >
                <Check size={17} />
                تسجيل الجلسة
              </button>
              <button
                className="edu-button secondary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => studyApi(`/focus/${focus.id}/cancel`, "POST", {}),
                    "أوقفت الجلسة. يمكنك البدء عندما يناسبك.",
                  )
                }
              >
                إيقاف
              </button>
            </>
          ) : (
            <>
              <label>
                مدة الجلسة
                <select
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                >
                  {[1, 5, 15, 25, 45, 60].map((v) => (
                    <option key={v} value={v}>
                      {n(v)} دقيقة
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="edu-button"
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      studyApi("/focus/start", "POST", {
                        minutes,
                        requestId: crypto.randomUUID(),
                      }),
                    "بدأت جلسة التركيز.",
                  )
                }
              >
                ابدأ التركيز
                <Clock size={16} />
              </button>
            </>
          )}
        </div>
        <p className="edu-note">
          الوقت محفوظ على الخادم ويستمر عند تحديث الصفحة. لا تُحسب الجلسة قبل
          اكتمال مدتها وتسجيلها.
        </p>
      </section>
      <section className="edu-card">
        <Target size={26} />
        <h2>هدف يناسب يومك</h2>
        <p>
          تقدمك اليوم: {n(data.stats.focusMinutesToday)} من{" "}
          {n(data.dailyGoalMinutes)} دقيقة.
        </p>
        <div className="edu-progress">
          <span
            style={{
              width:
                Math.min(
                  100,
                  (data.stats.focusMinutesToday / data.dailyGoalMinutes) * 100,
                ) + "%",
            }}
          />
        </div>
        <form
          className="edu-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () => studyApi("/goal", "PUT", { dailyGoalMinutes: goal }),
              "حُدّث هدفك اليومي.",
            );
          }}
        >
          <label className="edu-wide">
            هدف التركيز اليومي بالدقائق
            <input
              type="number"
              min="5"
              max="240"
              value={goal}
              onChange={(e) => setGoal(Number(e.target.value))}
            />
          </label>
          <button className="edu-button secondary" disabled={busy}>
            حفظ الهدف
          </button>
        </form>
        <p className="edu-note">
          خطط لوقت مريح واستراحات قصيرة. الهدف أداة تنظيم شخصية.
        </p>
      </section>
    </div>
  );
}
function Planner({ data, busy, act }: { data: Row; busy: boolean; act: Act }) {
  const [title, setTitle] = useState(""),
    [date, setDate] = useState(""),
    [showDone, setShowDone] = useState(false);
  return (
    <section className="edu-card">
      <div className="sa-section-head">
        <div>
          <span className="sa-overline">شيء واحد في كل مرة</span>
          <h2>خطة مذاكرتي</h2>
        </div>
        <span className="sa-pill">
          {n(data.tasks.filter((t: Row) => t.done).length)} /{" "}
          {n(data.tasks.length)} مكتملة
        </span>
      </div>
      <form
        className="edu-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(
            () =>
              studyApi("/tasks", "POST", {
                title,
                dueDate:
                  String(new FormData(e.currentTarget).get("dueDate") || "") ||
                  null,
              }),
            "أضيفت المهمة.",
          );
          if (r) {
            setTitle("");
            setDate("");
          }
        }}
      >
        <label>
          مهمتك القادمة
          <input
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مراجعة درس النسب وحل تمارينه"
          />
        </label>
        <label>
          اليوم (اختياري)
          <input
            type="date"
            name="dueDate"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button className="edu-button" disabled={busy}>
          <Plus size={16} />
          أضف إلى خطتي
        </button>
      </form>
      <label className="sa-check edu-note" style={{ marginTop: 20 }}>
        <input
          type="checkbox"
          checked={showDone}
          onChange={(e) => setShowDone(e.target.checked)}
        />
        إظهار المهام المكتملة
      </label>
      {data.tasks
        .filter((t: Row) => showDone || !t.done)
        .map((t: Row) => (
          <div className="sa-task" data-done={t.done} key={t.id}>
            <input
              aria-label={`إكمال ${t.title}`}
              type="checkbox"
              disabled={busy}
              checked={t.done}
              onChange={() =>
                void act(
                  () => studyApi(`/tasks/${t.id}`, "PATCH", { done: !t.done }),
                  "حُدّثت المهمة.",
                )
              }
            />
            <div>
              <b>{t.title}</b>
              <small>
                {t.dueDate
                  ? new Date(t.dueDate + "T12:00:00").toLocaleDateString(
                      "ar-SA",
                    )
                  : "دون موعد محدد"}
              </small>
            </div>
            <button
              aria-label={`إزالة ${t.title}`}
              className="edu-button secondary"
              disabled={busy}
              onClick={() =>
                void act(
                  () => studyApi(`/tasks/${t.id}`, "DELETE"),
                  "أُزيلت المهمة من قائمتك.",
                )
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      {!data.tasks.filter((t: Row) => showDone || !t.done).length && (
        <p className="edu-empty">مساحتك جاهزة. اكتب مهمة صغيرة للبدء.</p>
      )}
    </section>
  );
}
function RoomView({
  id,
  back,
  act,
  busy,
}: {
  id: string;
  back: () => void;
  act: Act;
  busy: boolean;
}) {
  const q = useStudy("/rooms/" + id, true, 15000),
    [minutes, setMinutes] = useState(25),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const t = setInterval(() => {
      void studyApi(`/rooms/${id}/heartbeat`, "POST", {}).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [id]);
  const r = q.data;
  const offset = r ? new Date(r.serverNow).getTime() - q.dataUpdatedAt : 0;
  const left = r?.focus
    ? Math.max(
        0,
        Math.ceil((new Date(r.focus.endsAt).getTime() - now - offset) / 1000),
      )
    : 0;
  return (
    <StudentLoading query={q}>
      {r && (
        <>
          <section className="edu-card">
            <div className="sa-section-head">
              <div>
                <span className="sa-overline">
                  غرفة خاصة · {r.isHost ? "أنت المضيف" : "مرحبًا بزميلنا"}
                </span>
                <h2>{r.title}</h2>
              </div>
              <button className="edu-button secondary" onClick={back}>
                غرفي
                <ArrowLeft size={16} />
              </button>
            </div>
            <div className="sa-room-members">
              {r.members.map((m: Row, i: number) => (
                <div className="sa-room-member" key={i}>
                  <Users size={18} style={{ margin: "auto" }} />
                  <b>{m.nickname}</b>
                  <small>
                    {m.isYou ? "أنت" : m.isHost ? "المضيف" : "زميل مذاكرة"}
                  </small>
                </div>
              ))}
            </div>
            {r.focus && (
              <div className="sa-focus-ring">
                <strong>
                  {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
                </strong>
                <span>{left ? "نذاكر في الوقت نفسه" : "اكتمل وقت الغرفة"}</span>
              </div>
            )}
            {r.isHost && (
              <form
                className="sa-focus-controls"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(
                    () => studyApi(`/rooms/${id}/focus`, "POST", { minutes }),
                    "بدأ مؤقت الغرفة المشترك.",
                  );
                }}
              >
                <label>
                  دقائق التركيز
                  <select
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  >
                    {[1, 5, 15, 25, 45].map((v) => (
                      <option key={v} value={v}>
                        {n(v)} دقيقة
                      </option>
                    ))}
                  </select>
                </label>
                <button className="edu-button" disabled={busy}>
                  ابدأ مؤقتًا مشتركًا
                </button>
              </form>
            )}
            <p className="edu-note">
              مؤقت الغرفة للتنسيق بينكم. لتسجيل دقائقك الشخصية ابدأ جلستك في
              «خطة اليوم». يُحدّث حضور الزملاء كل نصف دقيقة أثناء فتح الغرفة.
            </p>
            <button
              className="edu-button secondary"
              disabled={busy}
              onClick={async () => {
                const result = await act(
                  () => studyApi(`/rooms/${id}/leave`, "POST", {}),
                  "غادرت الغرفة.",
                );
                if (result) back();
              }}
            >
              <LogOut size={16} />
              مغادرة الغرفة
            </button>
          </section>
          <RoomChallenge room={r} id={id} busy={busy} act={act} />
        </>
      )}
    </StudentLoading>
  );
}
function RoomChallenge({
  id,
  room,
  busy,
  act,
}: {
  id: string;
  room: Row;
  busy: boolean;
  act: Act;
}) {
  const q = useStudy(`/rooms/${id}/challenge`, true, 12000),
    catalog = useAcademy("/catalog"),
    [track, setTrack] = useState(""),
    [duration, setDuration] = useState(300),
    [answers, setAnswers] = useState<Record<string, number>>({}),
    [now, setNow] = useState(Date.now());
  const c = q.data;
  useEffect(() => {
    setAnswers(c?.answers || {});
  }, [c?.id]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const deadline = c?.endsAt || c?.deadlineAt;
  const offset = c?.serverNow
    ? new Date(c.serverNow).getTime() - q.dataUpdatedAt
    : 0;
  const left = deadline
    ? Math.max(
        0,
        Math.ceil((new Date(deadline).getTime() - now - offset) / 1000),
      )
    : 0;
  const active = c?.id && !c.revealed && c.participating && !c.submitted;
  return (
    <section className="edu-card">
      <div className="sa-section-head">
        <div>
          <span className="sa-overline">
            <Trophy size={17} />
            نفس الأسئلة، هدف مشترك
          </span>
          <h2>تحدي الغرفة</h2>
        </div>
        {deadline && (
          <span className="sa-pill" role="timer">
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </span>
        )}
      </div>
      <p>أسئلة تأسيس أصلية، وتصحيح على الخادم. النتائج داخل الغرفة فقط.</p>
      {q.error && (
        <p className="edu-notice edu-error" role="alert">
          {q.error.message}
        </p>
      )}
      {room.isHost && (!c?.id || c.revealed) && (
        <form
          className="edu-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () =>
                studyApi(`/rooms/${id}/challenge`, "POST", {
                  trackId: track || catalog.data?.tracks?.[0]?.id,
                  count: 5,
                  durationSec: duration,
                }),
              "بدأ تحدي الغرفة.",
            );
          }}
        >
          <label>
            مسار التحدي
            <select value={track} onChange={(e) => setTrack(e.target.value)}>
              <option value="">اختر المسار الأول</option>
              {catalog.data?.tracks?.map((t: Row) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            المدة
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              {[60, 180, 300, 600].map((v) => (
                <option key={v} value={v}>
                  {n(v / 60)} دقائق
                </option>
              ))}
            </select>
          </label>
          <button className="edu-button" disabled={busy || catalog.isPending}>
            إنشاء تحدي من ٥ أسئلة
          </button>
        </form>
      )}
      {!c?.id && !q.error && (
        <p className="edu-empty">ينشئ المضيف تحديًا عند استعداد المجموعة.</p>
      )}
      {active && (
        <>
          <p className="edu-note">
            اختر الإجابات ثم احفظها أو سلّم التحدي. لا يظهر الحل أثناء المنافسة.
          </p>
          {c.questions?.map((question: Row, i: number) => (
            <fieldset className="sa-notebook-item" key={question.id}>
              <legend>
                {n(i + 1)}. {question.text}
              </legend>
              {question.passage && <p>{question.passage}</p>}
              {question.audioScript && (
                <Listening script={question.audioScript} />
              )}
              {question.options.map((o: string, j: number) => (
                <label className="edu-option sa-check" key={j}>
                  <input
                    type="radio"
                    name={question.id}
                    checked={answers[question.id] === j}
                    disabled={busy || left === 0}
                    onChange={() =>
                      setAnswers((a) => ({ ...a, [question.id]: j }))
                    }
                  />
                  {o}
                </label>
              ))}
            </fieldset>
          ))}
          <div className="edu-actions">
            <button
              className="edu-button secondary"
              disabled={busy || left === 0}
              onClick={() =>
                void act(
                  () =>
                    studyApi(`/rooms/${id}/challenge/answers`, "PUT", {
                      answers,
                      challengeId: c?.id,
                    }),
                  "حُفظت إجابات التحدي.",
                )
              }
            >
              حفظ الإجابات
            </button>
            <button
              className="edu-button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  if (left > 0)
                    await studyApi(`/rooms/${id}/challenge/answers`, "PUT", {
                      answers,
                      challengeId: c?.id,
                    });
                  return studyApi(`/rooms/${id}/challenge/submit`, "POST", {
                    challengeId: c?.id,
                  });
                }, "تم تسليم التحدي.")
              }
            >
              تسليم التحدي <Check size={16} />
            </button>
          </div>
        </>
      )}
      {c?.id && !c.participating && (
        <p className="edu-notice">
          بدأ هذا التحدي قبل انضمامك. شارك في التحدي التالي عند استعداد
          المجموعة.
        </p>
      )}
      {c?.revealed && (
        <details className="sa-notebook-item">
          <summary>مراجعة حلول التحدي</summary>
          {c.questions.map((item: Row) => (
            <article className="sa-review" key={item.id}>
              <h3>{item.text}</h3>
              <p>الإجابة الصحيحة: {item.options[item.answer]}</p>
              <p>{item.explanation}</p>
            </article>
          ))}
        </details>
      )}
      {c?.submitted && (
        <p className="edu-notice">
          سُلّمت إجاباتك. تظهر المقارنة بعد انتهاء التحدي وفق سياسة الغرفة.
        </p>
      )}
      {c?.standings?.length > 0 && (
        <div className="sa-challenge-board" aria-label="نتائج تحدي الغرفة">
          {(c?.standings || []).map((r: Row, i: number) => (
            <div key={i}>
              <span>{n(i + 1)}</span>
              <b>{r.nickname}</b>
              <span>
                {r.correct == null
                  ? r.submitted
                    ? "تم التسليم"
                    : "قيد الحل"
                  : `${n(r.correct)} / ${n(r.total || c?.questions?.length || 5)}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
