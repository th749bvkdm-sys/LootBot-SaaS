import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {AccountLogoutButton} from "./account-logout";
import {
  Presentation,
  Timer,
  Volume2,
  ListChecks,
  Vote,
  Trophy,
  Flame,
  Armchair,
  Car,
  Footprints,
  Shuffle,
  Gamepad2,
  Maximize,
  Minimize,
  X,
} from "lucide-react";
import {
  teacherApi,
  type TeacherClass,
  type TeacherProfile,
  type TeacherStudent,
  type TeacherQuestion,
  type TeacherLesson,
} from "../lib/teacher-api";
import {
  starterWords,
  starterQuestions,
  teacherGameQuestions,
  customWords,
  wordsFromLesson,
  type GameQuestion,
  type GameWord,
} from "../lib/classroom-game-content";
import {
  useClassroomProjectorSync,
  classroomModes,
  classroomRemaining,
  carRaceMove,
  ladderMove,
  classroomWheelRoster,
  wheelSpinRotation,
  type ClassroomLiveState,
  type ClassroomToolMode,
  type PublicGameQuestion,
} from "../lib/classroom-projector-sync";
import {
  useActiveTeacherClass,
  teacherClassPath,
  useClassPeriod,
  CLASS_PERIODS,
} from "./teacher-navigation-shell";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { BrandMark } from "./brand-mark";
import "./teacher-classroom-hub.css";
type Summary = {
  ownerId: string;
  classId: string;
  className: string;
  subject: string;
  today: string;
  classPoints: number;
  streakDays: number;
  creditedToday: boolean;
  scores: { id: string; name: string; points: number; todayPoints: number }[];
};
type Reward = {
  eventId: string;
  classId: string;
  studentIds: string[];
  points: number;
  reason: string;
};
const tools: [ClassroomToolMode, string, typeof Timer][] = [
  ["voting", "التصويت", Vote],
  ["what-to-do", "ماذا نفعل؟", ListChecks],
  ["quiet-meter", "مقياس الهدوء", Volume2],
  ["timer", "المؤقت", Timer],
  ["honor-board", "لوحة الشرف", Trophy],
  ["honor-board", "الاستمرارية", Flame],
];
const games: [ClassroomToolMode, string, typeof Car, string][] = [
  ["hot-seat", "الكرسي الساخن", Armchair, "خمن المفردة بمساعدة زملائك"],
  ["car-race", "سباق السيارة", Car, "خمسة مطبات، وهدف واحد"],
  ["ladder-race", "سباق السلم: طالبين", Footprints, "تحدٍ نحو الكأس"],
  ["wheel", "عجلة الأسماء", Shuffle, "فرصة مشاركة لكل طالب"],
  ["team-quiz", "المسابقة", Gamepad2, "مسابقة بين فريقين"],
];
const labels = Object.fromEntries(
  [...tools, ...games].map(([key, title]) => [key, title]),
);
labels["honor-board"] = "لوحة الشرف والاستمرارية";
const num = (n: number) => n.toLocaleString("ar-SA");
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
function useRecords<T>(resource: string, enabled = true) {
  return useQuery({
    queryKey: ["teacher", "classroom-" + resource],
    queryFn: () => teacherApi<T>("/teacher/" + resource),
    enabled,
    retry: false,
  });
}
function useSummary(classId: string) {
  return useQuery({
    queryKey: ["teacher", "classroom", classId],
    queryFn: () =>
      teacherApi<Summary>(
        "/teacher/classroom?classId=" + encodeURIComponent(classId),
      ),
    enabled: !!classId,
    retry: false,
  });
}
function questionView(
  q: GameQuestion | undefined,
  reveal = false,
): PublicGameQuestion | null {
  return q
    ? {
        id: q.id,
        text: q.text,
        options: q.options,
        revealedAnswer: reveal,
        ...(reveal ? { correctIndex: q.correctIndex } : {}),
      }
    : null;
}
function wordView(w: GameWord | undefined) {
  return w
    ? { id: w.id, word: w.word, subject: w.subject, unit: w.unit }
    : null;
}
export function TeacherClassroomHub({
  initialMode,
  compact = false,
}: { initialMode?: ClassroomToolMode; compact?: boolean } = {}) {
  const [classId] = useActiveTeacherClass(),
    summary = useSummary(classId),
    profile = useRecords<TeacherProfile>("profile");
  if (!classId)
    return (
      <section className="tw-card">
        <h2>اختر الفصل لبدء الحصة</h2>
        <p>تستخدم الألعاب كشف الفصل النشط ونقاطه الخاصة.</p>
      </section>
    );
  if (summary.isPending || profile.isPending)
    return <p role="status">جار تجهيز مركز الحصة…</p>;
  if (summary.error || profile.error)
    return (
      <p role="alert" className="tw-error">
        {summary.error?.message || profile.error?.message}
        <button
          className="tw-button"
          onClick={() => {
            void summary.refetch();
            void profile.refetch();
          }}
        >
          إعادة المحاولة
        </button>
      </p>
    );
  return (
    <ClassroomController
      key={classId}
      summary={summary.data!}
      profile={profile.data!}
      initialMode={initialMode}
      compact={compact}
    />
  );
}
function ClassroomController({
  summary,
  profile,
  initialMode,
  compact,
}: {
  summary: Summary;
  profile: TeacherProfile;
  initialMode?: ClassroomToolMode;
  compact: boolean;
}) {
  const {
      state: s,
      update,
      storageUnavailable,
    } = useClassroomProjectorSync(summary.ownerId, summary.classId),
    qc = useQueryClient();
  const questions = useRecords<TeacherQuestion[]>("questions"),
    lessons = useRecords<TeacherLesson[]>("lessons");
  const [period, setPeriod] = useClassPeriod();
  const requestedLesson =
    new URLSearchParams(location.search).get("lesson") || "";
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>(() => {
    try {
      const ids = JSON.parse(
        sessionStorage.getItem(
          "classroom-question-selection:" + summary.classId,
        ) || "[]",
      );
      return Array.isArray(ids)
        ? ids.filter((id) => typeof id === "string").slice(0, 500)
        : [];
    } catch {
      return [];
    }
  });
  const [subject, setSubject] = useState(requestedLesson ? "تحضير المعلم" : ""),
    [source, setSource] = useState(requestedLesson ? "teacher" : "all"),
    [unit, setUnit] = useState(""),
    [term, setTerm] = useState(""),
    [lessonId, setLessonId] = useState(
      new URLSearchParams(location.search).get("lesson") || "",
    ),
    [custom, setCustom] = useState(""),
    [studentId, setStudentId] = useState(""),
    [studentName, setStudentName] = useState(""),
    [used, setUsed] = useState<string[]>([]),
    [noRepeat, setNoRepeat] = useState(true),
    [hidden, setHidden] = useState(false),
    [overlay, setOverlay] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState<Reward | null>(null),
    [autoAward, setAutoAward] = useState(false),
    [activityTitle, setActivityTitle] = useState(""),
    [activityKind, setActivityKind] = useState("read"),
    [pageNumber, setPageNumber] = useState(""),
    [sensitivity, setSensitivity] = useState(2),
    [microphone, setMicrophone] = useState(false),
    [micPending, setMicPending] = useState(false),
    [gradeMax, setGradeMax] = useState(10),
    [anonymousOptions, setAnonymousOptions] = useState("");
  const mic = useRef<{
      stream: MediaStream;
      context: AudioContext;
      timerId: number;
    } | null>(null),
    disposed = useRef(false),
    requestingMic = useRef(false),
    currentMode = useRef(s.mode),
    sound = useRef<AudioContext | null>(null),
    autoRef = useRef(""),
    spinTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageKey =
    "classroom-pending-reward:" + summary.ownerId + ":" + summary.classId;
  const roster = summary.scores;
  const allQuestions = useMemo(
    () => [...teacherGameQuestions(questions.data ?? []), ...starterQuestions],
    [questions.data],
  );
  const bank = useMemo(
    () =>
      allQuestions.filter(
        (q) =>
          (!subject || q.subject === subject) &&
          (source === "all" || q.origin === source) &&
          (!selectedQuestions.length || selectedQuestions.includes(q.id)),
      ),
    [allQuestions, subject, source, selectedQuestions],
  );
  const words = useMemo(
    () =>
      [
        ...starterWords,
        ...(lessons.data
          ?.filter(
            (l) =>
              !l.archived &&
              (!l.classId || l.classId === summary.classId) &&
              (!lessonId || l.id === lessonId),
          )
          .flatMap(wordsFromLesson) ?? []),
        ...customWords(custom),
      ]
        .filter(
          (w) =>
            (!subject || w.subject === subject) &&
            (!unit || w.unit === unit) &&
            (!term || w.term === term) &&
            (source === "all" || w.origin === source),
        )
        .slice(0, 500),
    [
      lessons.data,
      lessonId,
      custom,
      subject,
      source,
      unit,
      term,
      summary.classId,
    ],
  );
  const currentWord = words.find((w) => w.id === s.hotSeat.currentWord?.id),
    mode = s.mode;
  currentMode.current = mode;
  const roundActive =
    mode === "hot-seat"
      ? s.hotSeat.status === "playing"
      : mode === "car-race"
        ? s.carRace.status === "playing"
        : mode === "ladder-race"
          ? s.ladderRace.status === "playing"
          : mode === "team-quiz"
            ? !!s.teamQuiz.currentQuestion && !s.teamQuiz.winner
            : false;
  useEffect(() => {
    update((d) => {
      // A saved microphone level is not a live microphone after a reload.
      if (d.quietMeter.source === "microphone") d.quietMeter.running = false;
      d.header = {
        dayName: new Intl.DateTimeFormat("ar-SA", { weekday: "long" }).format(
          new Date(),
        ),
        dateFormatted:
          new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(new Date()) + "م",
        periodLabel: period,
        className: summary.className,
        subjectName: summary.subject,
        schoolName: profile.schoolName,
        logoAssetId: profile.logoAssetId || null,
      };
    });
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved?.classId === summary.classId) setPending(saved);
    } catch {
      /* A pending write can still be retried in this tab. */
    }
    return () => {
      if (spinTimeout.current) clearTimeout(spinTimeout.current);
    };
  }, [summary.classId]);
  useEffect(() => {
    update((d) => {
      d.header.periodLabel = period;
    });
  }, [period]);
  useEffect(() => {
    update((d) => {
      d.honorBoard = {
        streakDays: summary.streakDays,
        classPoints: summary.classPoints,
        scores: Object.fromEntries(
          summary.scores
            .filter((x) => x.points > 0)
            .map((x) => [x.id, { studentName: x.name, points: x.points }]),
        ),
      };
    });
  }, [summary]);
  useEffect(() => {
    try {
      if (pending) sessionStorage.setItem(storageKey, JSON.stringify(pending));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* The retry button remains available. */
    }
  }, [pending, storageKey]);
  useEffect(() => {
    const requested =
      initialMode || new URLSearchParams(location.search).get("tool");
    if (requested && classroomModes.includes(requested as ClassroomToolMode))
      selectMode(requested as ClassroomToolMode);
    const action = (e: Event) => selectMode((e as CustomEvent).detail);
    window.addEventListener("classroom:quick", action);
    return () => window.removeEventListener("classroom:quick", action);
  }, [initialMode]);
  function selectMode(mode: ClassroomToolMode) {
    if (!classroomModes.includes(mode)) return;
    update((d) => {
      d.mode = mode;
      d.celebration = null;
    });
    setError("");
  }
  function stopMic() {
    const active = mic.current;
    if (active) {
      clearInterval(active.timerId);
      active.stream.getTracks().forEach((t) => t.stop());
      void active.context.close();
      mic.current = null;
    }
    if (!disposed.current) setMicrophone(false);
  }
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      const active = mic.current;
      if (active) {
        clearInterval(active.timerId);
        active.stream.getTracks().forEach((t) => t.stop());
        void active.context.close();
      }
      update((d) => {
        if (!d.quietMeter.running) return false;
        d.quietMeter.running = false;
        return;
      });
      void sound.current?.close();
    };
  }, []);
  useEffect(() => {
    if (mode !== "quiet-meter") {
      stopMic();
      update((d) => {
        if (!d.quietMeter.running) return false;
        d.quietMeter.running = false;
        return;
      });
    }
  }, [mode]);
  async function startMic() {
    if (requestingMic.current) return;
    if (mic.current) {
      stopMic();
      update((d) => {
        d.quietMeter.running = false;
      });
      return;
    }
    setError("");
    requestingMic.current = true;
    setMicPending(true);
    let pendingStream: MediaStream | null = null;
    let pendingContext: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error("الميكروفون غير متاح؛ استخدم المحاكاة اليدوية.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      pendingStream = stream;
      if (disposed.current || currentMode.current !== "quiet-meter") {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const context = new AudioContext();
      pendingContext = context;
      const analyser = context.createAnalyser(),
        input = context.createMediaStreamSource(stream);
      analyser.fftSize = 1024;
      input.connect(analyser);
      await context.resume();
      if (disposed.current || currentMode.current !== "quiet-meter") {
        stream.getTracks().forEach((t) => t.stop());
        void context.close();
        return;
      }
      const data = new Uint8Array(analyser.fftSize);
      const active = { stream, context, timerId: 0 };
      mic.current = active;
      pendingStream = null;
      pendingContext = null;
      const read = () => {
        if (mic.current !== active) return;
        if (context.state !== "running") {
          stopMic();
          update((d) => {
            d.quietMeter.running = false;
          });
          setNotice("توقف قياس الميكروفون. أعد تشغيله لاستكمال هدف الهدوء.");
          return;
        }
        analyser.getByteTimeDomainData(data);
        const rms = Math.sqrt(
            data.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) /
              data.length,
          ),
          level = Math.min(100, Math.round(rms * 500 * sensitivity));
        update((d) => {
          d.quietMeter.noiseLevel = level;
          d.quietMeter.source = "microphone";
        });
      };
      // Sampling must keep working when the projector is the foreground tab.
      active.timerId = window.setInterval(read, 120);
      setMicrophone(true);
      update((d) => {
        d.quietMeter.running = true;
        d.quietMeter.lastSampleAt = Date.now();
        d.quietMeter.source = "microphone";
      });
    } catch (e) {
      pendingStream?.getTracks().forEach((t) => t.stop());
      void pendingContext?.close();
      stopMic();
      if (!disposed.current && currentMode.current === "quiet-meter")
        setError(
          (e as Error).message + " يمكنك استخدام منزلق المحاكاة اليدوي.",
        );
    } finally {
      requestingMic.current = false;
      if (!disposed.current) setMicPending(false);
    }
  }
  // Wall-clock deadlines keep timers accurate even when the controller is in another tab.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      update((d) => {
        if (
          !d.timer.running &&
          !(d.hotSeat.status === "playing" && d.hotSeat.durationSec > 0) &&
          !d.quietMeter.running
        )
          return false;
        const before = JSON.stringify(d);
        if (d.timer.running) {
          const left = classroomRemaining(
              d.timer.deadline,
              d.timer.remainingSeconds,
              now,
            ),
            prior = d.timer.remainingSeconds;
          d.timer.remainingSeconds = left;
          if (prior > 60 && left <= 60 && d.timer.warnAtOneMinute) beep();
          if (left === 0) {
            d.timer.running = false;
            d.timer.deadline = null;
            d.celebration = { active: true, title: "انتهى وقت النشاط!" };
            beep();
          }
        }
        if (d.hotSeat.status === "playing" && d.hotSeat.durationSec > 0) {
          d.hotSeat.remainingSec = classroomRemaining(
            d.hotSeat.deadline,
            d.hotSeat.remainingSec,
            now,
          );
          if (!d.hotSeat.remainingSec) {
            d.hotSeat.status = "finished";
            d.celebration = {
              active: true,
              title: `أحسنت ${d.hotSeat.studentName}`,
              subtitle: `${d.hotSeat.guessedWords.length} كلمات صحيحة`,
            };
          }
        }
        if (
          d.quietMeter.running &&
          !d.quietMeter.goalAchieved &&
          d.quietMeter.noiseLevel < d.quietMeter.threshold
        ) {
          d.quietMeter.quietElapsedSeconds = Math.min(
            d.quietMeter.goalSeconds,
            d.quietMeter.quietElapsedSeconds +
              Math.min(
                2,
                Math.max(0, (now - d.quietMeter.lastSampleAt) / 1000),
              ),
          );
          if (d.quietMeter.quietElapsedSeconds >= d.quietMeter.goalSeconds) {
            d.quietMeter.goalAchieved = true;
            d.quietMeter.running = false;
            d.celebration = {
              active: true,
              title: "أحسنتم! حققتم هدف الهدوء",
              subtitle: clock(d.quietMeter.goalSeconds),
            };
          }
        }
        if (d.quietMeter.running) d.quietMeter.lastSampleAt = now;
        if (JSON.stringify(d) === before) return false;
        return;
      });
    }, 500);
    return () => clearInterval(timer);
  }, []);
  function beep() {
    if (!sound.current) return;
    try {
      const o = sound.current.createOscillator(),
        g = sound.current.createGain();
      g.gain.value = 0.025;
      o.frequency.value = 660;
      o.connect(g);
      g.connect(sound.current.destination);
      o.start();
      o.stop(sound.current.currentTime + 0.18);
    } catch {
      /* The visual notification remains available. */
    }
  }
  async function saveReward(payload: Reward) {
    setPending(payload);
    setBusy(true);
    setError("");
    try {
      await teacherApi("/teacher/classroom/rewards", "POST", payload);
      setPending(null);
      await qc.invalidateQueries({
        queryKey: ["teacher", "classroom", summary.classId],
      });
      setNotice("حُفظت النقاط في سجل الفصل.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const award = (
    points: number,
    ids: string[],
    reason: string,
    eventId: string = crypto.randomUUID(),
  ) => {
    if (pending) {
      setError("أعد حفظ المكافأة المعلّقة أولًا.");
      return;
    }
    void saveReward({
      eventId,
      classId: summary.classId,
      studentIds: ids,
      points,
      reason,
    });
  };
  async function creditDay() {
    setBusy(true);
    setError("");
    try {
      await teacherApi("/teacher/classroom/streak", "POST", {
        classId: summary.classId,
      });
      await qc.invalidateQueries({
        queryKey: ["teacher", "classroom", summary.classId],
      });
      setNotice("حُفظ يوم التفاعل؛ لا يحتسب اليوم نفسه مرتين.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const winningId =
    s.ladderRace.player1.step >= 5
      ? s.ladderRace.player1.id
      : s.ladderRace.player2.id;
  useEffect(() => {
    if (
      autoAward &&
      s.ladderRace.status === "won" &&
      winningId &&
      autoRef.current !== s.ladderRace.roundId
    ) {
      autoRef.current = s.ladderRace.roundId;
      award(1, [winningId], "فوز سباق السلم", s.ladderRace.roundId);
    }
  }, [s.ladderRace.status, s.ladderRace.roundId, autoAward]);
  function chooseStudent() {
    const available = roster.filter((r) => !noRepeat || !used.includes(r.id));
    if (!available.length) {
      setNotice("شارك جميع الطلاب؛ ابدأ دورة جديدة.");
      return null;
    }
    const selected = available[Math.floor(Math.random() * available.length)];
    setStudentId(selected.id);
    setStudentName(selected.name);
    setUsed((u) => [...u, selected.id]);
    return selected;
  }
  function startHot() {
    if (!words.length) {
      setError("أضف مفردات أو اختر بنكًا متاحًا.");
      return;
    }
    const typedName = studentName.trim().replace(/\s+/g, " ");
    const student =
      roster.find((r) => r.id === studentId) ||
      (typedName ? { id: null, name: typedName } : null);
    if (!student) {
      setError("اكتب اسم الطالب أو اختره من كشف الفصل.");
      return;
    }
    setError("");
    update((d) => {
      d.roundId = crypto.randomUUID();
      d.celebration = null;
      d.hotSeat = {
        ...d.hotSeat,
        roundId: d.roundId,
        status: "playing",
        studentId: student.id,
        studentName: student.name,
        currentWord: wordView(words[0]),
        guessedWords: [],
        skippedCount: 0,
        remainingSec: d.hotSeat.durationSec,
        deadline: d.hotSeat.durationSec
          ? Date.now() + d.hotSeat.durationSec * 1000
          : null,
      };
    });
  }
  function hotNext(correct: boolean) {
    if (s.hotSeat.status !== "playing") return;
    const next = words.findIndex((w) => w.id === s.hotSeat.currentWord?.id) + 1;
    update((d) => {
      if (correct && d.hotSeat.currentWord)
        d.hotSeat.guessedWords.push(d.hotSeat.currentWord.word);
      else d.hotSeat.skippedCount++;
      if (next >= words.length) {
        d.hotSeat.status = "finished";
        d.celebration = {
          active: true,
          title: "اكتملت مفردات الجولة",
          subtitle: `${d.hotSeat.guessedWords.length} كلمات صحيحة`,
        };
      } else d.hotSeat.currentWord = wordView(words[next]);
    });
  }
  function startRace(mode: "car-race" | "ladder-race" | "team-quiz") {
    if (bank.length < (mode === "car-race" ? 5 : 1)) {
      setError(
        "يلزم خمسة أسئلة متاحة لسباق السيارة؛ غيّر الفلتر أو أضف أسئلة.",
      );
      return;
    }
    if (mode === "ladder-race") {
      const { player1, player2 } = s.ladderRace;
      const names = [player1, player2].map((player) =>
        player.name.trim().replace(/\s+/g, " "),
      );
      if (
        names.some(
          (name) =>
            !name ||
            ["الطالب الأول", "الطالب الثاني", "اختر طالبًا"].includes(name),
        ) ||
        (player1.id && player1.id === player2.id) ||
        ((!player1.id || !player2.id) && names[0] === names[1])
      ) {
        setError("اكتب اسمين مختلفين أو اختر طالبين من كشف الفصل.");
        return;
      }
    }
    setError("");
    update((d) => {
      d.roundId = crypto.randomUUID();
      d.celebration = null;
      if (mode === "car-race")
        d.carRace = {
          roundId: d.roundId,
          status: "playing",
          currentBump: 1,
          completedBumps: [],
          lastOutcome: null,
          currentQuestion: questionView(bank[0]),
        };
      if (mode === "ladder-race")
        d.ladderRace = {
          ...d.ladderRace,
          roundId: d.roundId,
          status: "playing",
          player1: { ...d.ladderRace.player1, step: 0 },
          player2: { ...d.ladderRace.player2, step: 0 },
          winnerName: null,
          currentQuestion: questionView(bank[0]),
        };
      if (mode === "team-quiz")
        d.teamQuiz = {
          ...d.teamQuiz,
          scores: [0, 0],
          winner: null,
          currentQuestion: questionView(bank[0]),
        };
    });
  }
  function nextQuestion() {
    const next =
      (bank.findIndex((q) => q.id === activeQuestion?.id) + 1) %
      Math.max(1, bank.length);
    update((d) => {
      if (mode === "car-race") {
        d.carRace.currentQuestion = questionView(bank[next]);
        d.carRace.lastOutcome = null;
      }
      if (mode === "ladder-race")
        d.ladderRace.currentQuestion = questionView(bank[next]);
      if (mode === "team-quiz")
        d.teamQuiz.currentQuestion = questionView(bank[next]);
    });
  }
  function judge(correct: boolean, player?: 0 | 1) {
    const game =
      mode === "car-race"
        ? s.carRace
        : mode === "ladder-race"
          ? s.ladderRace
          : s.teamQuiz;
    if (
      !roundActive ||
      !game.currentQuestion ||
      game.currentQuestion.revealedAnswer
    )
      return;
    update((d) => {
      const question = allQuestions.find(
        (q) => q.id === game.currentQuestion?.id,
      );
      if (!question) return;
      if (mode === "car-race") {
        const old = d.carRace.currentBump;
        d.carRace.currentQuestion = questionView(question, true);
        d.carRace.lastOutcome = correct ? "correct" : "wrong";
        d.carRace.currentBump = carRaceMove(old, correct);
        d.carRace.completedBumps = correct
          ? [...new Set([...d.carRace.completedBumps, old])]
          : d.carRace.completedBumps.filter((n) => n < d.carRace.currentBump);
        if (d.carRace.currentBump === 6) {
          d.carRace.status = "won";
          d.celebration = {
            active: true,
            title: "انتصرتم! وصلت السيارة إلى خط النهاية",
          };
        }
      }
      if (mode === "ladder-race" && player !== undefined) {
        const p = player === 0 ? d.ladderRace.player1 : d.ladderRace.player2;
        p.step = ladderMove(p.step, correct ? 1 : -1);
        d.ladderRace.currentQuestion = questionView(question, true);
        if (p.step === 5) {
          d.ladderRace.status = "won";
          d.ladderRace.winnerName = p.name;
          d.celebration = {
            active: true,
            title: "🏆 " + p.name,
            subtitle: "بطل سباق السلم",
          };
        }
      }
      if (mode === "team-quiz" && player !== undefined) {
        d.teamQuiz.scores[player] = Math.max(
          0,
          d.teamQuiz.scores[player] + (correct ? 1 : -1),
        );
        d.teamQuiz.currentQuestion = questionView(question, true);
        if (d.teamQuiz.scores[player] >= d.teamQuiz.target) {
          d.teamQuiz.winner = d.teamQuiz.names[player];
          d.celebration = { active: true, title: "🏆 " + d.teamQuiz.winner };
        }
      }
    });
  }
  function moveLadder(player: 0 | 1, delta: number) {
    if (s.ladderRace.status !== "playing") return;
    update((d) => {
      const p = player === 0 ? d.ladderRace.player1 : d.ladderRace.player2;
      p.step = ladderMove(p.step, delta);
      if (p.step === 5) {
        d.ladderRace.status = "won";
        d.ladderRace.winnerName = p.name;
        d.celebration = { active: true, title: "🏆 " + p.name };
      }
    });
  }
  function spin() {
    if (s.wheel.spinning) return;
    const selected = chooseStudent();
    if (!selected) return;
    const ordered = classroomWheelRoster(roster);
    update((d) => {
      d.wheel = {
        spinning: true,
        selectedId: null,
        selectedName: "",
        rotation: wheelSpinRotation(
          d.wheel.rotation,
          ordered.findIndex((r) => r.id === selected.id),
          ordered.length,
        ),
      };
    });
    spinTimeout.current = setTimeout(
      () =>
        update((d) => {
          d.wheel.spinning = false;
          d.wheel.selectedId = selected.id;
          d.wheel.selectedName = selected.name;
        }),
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 50 : 1400,
    );
  }
  function cast(optionId: string) {
    update((d) => {
      if (d.voting.namedMode) {
        const student = d.voting.roster[d.voting.currentStudentIndex];
        if (!student) return;
        d.voting.votes[student.id] = { optionId, studentName: student.name };
        d.voting.currentStudentIndex++;
      } else
        d.voting.anonymousCounts[optionId] =
          (d.voting.anonymousCounts[optionId] ?? 0) + 1;
    });
  }
  const activeQuestion =
    mode === "car-race"
      ? s.carRace.currentQuestion
      : mode === "ladder-race"
        ? s.ladderRace.currentQuestion
        : s.teamQuiz.currentQuestion;
  const privateQuestion = allQuestions.find((q) => q.id === activeQuestion?.id);
  return (
    <section
      className={"cr-hub" + (compact ? " cr-compact" : "")}
      aria-label="مركز الحصة والبروجكتر"
    >
      <header className="cr-hub-header">
        <div>
          <p className="tw-eyebrow">أدوات الحصة • فصل واحد وشاشتان</p>
          <h2>مركز الحصة والبروجكتر</h2>
          <p className="tw-muted">
            التحكم والتلميحات هنا؛ شاشة العرض للطلاب فقط.
          </p>
        </div>
        <div className="tw-toolbar">
          <a
            className="tw-button cr-project-button"
            href={teacherClassPath("projector", summary.classId)}
            target="_blank"
            rel="noopener"
          >
            📺 فتح شاشة البروجكتر
          </a>
          <button className="tw-button" onClick={() => setOverlay(true)}>
            <Maximize size={17} />
            عرض كامل داخل الصفحة
          </button>
        </div>
      </header>
      <div
        className="cr-toolbar"
        role="group"
        aria-label="أدوات الإدارة الصفية"
      >
        {tools.map(([id, label, Icon], i) => (
          <button
            key={label}
            aria-pressed={mode === id}
            onClick={() => selectMode(id)}
          >
            <Icon size={22} />
            {label}
          </button>
        ))}
      </div>
      <div className="cr-game-grid">
        {games.map(([id, title, Icon, description]) => (
          <button
            className={"cr-game-card cr-game-" + id}
            key={id}
            aria-pressed={mode === id}
            onClick={() => selectMode(id)}
          >
            <Icon size={32} />
            <strong>{title}</strong>
            <small>{description}</small>
          </button>
        ))}
      </div>
      <div className="cr-session-settings">
        <label>
          حصة شاشة العرض
          <select
            aria-label="حصة شاشة العرض"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {CLASS_PERIODS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <p>
          المزامنة بين نوافذ المتصفح على الجهاز نفسه. استخدم المعاينة المدمجة
          لشاشة واحدة.
        </p>
      </div>
      {storageUnavailable && (
        <p className="tw-notice">
          التخزين المحلي غير متاح؛ أبقِ شاشة التحكم مفتوحة واستخدم المعاينة
          المدمجة.
        </p>
      )}
      {(questions.error || lessons.error) && (
        <p role="status">تعذر تحميل بعض مصادر المعلم. البنك التأسيسي متاح.</p>
      )}
      {error && (
        <p role="alert" className="tw-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="tw-notice">
          {notice}
        </p>
      )}
      {pending && !busy && (
        <button
          className="tw-button primary"
          onClick={() => void saveReward(pending)}
        >
          إعادة حفظ المكافأة المعلقة
        </button>
      )}
      <div className="cr-dual-layout">
        <section className="cr-controller tw-card">
          <div className="cr-control-heading">
            <h2>{labels[mode] || "اختر أداة أو لعبة"}</h2>
            <button
              className="tw-button"
              aria-expanded={!hidden}
              onClick={() => setHidden((v) => !v)}
            >
              {hidden ? "إظهار الخيارات" : "إخفاء الخيارات"}
            </button>
          </div>
          {!hidden &&
            ["hot-seat", "car-race", "ladder-race", "team-quiz"].includes(
              mode,
            ) && (
              <fieldset className="cr-bank-settings" disabled={roundActive}>
                <label>
                  مصدر المحتوى
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="all">بنك المعلم والتأسيسي</option>
                    <option value="teacher">بنك المعلم فقط</option>
                    <option value="starter">تأسيسي أصلي</option>
                  </select>
                </label>
                <label>
                  المادة
                  <select
                    value={subject}
                    onChange={(e) => {
                      setSubject(e.target.value);
                      setUnit("");
                    }}
                  >
                    <option value="">كل المواد</option>
                    {[
                      ...new Set([
                        ...starterWords.map((w) => w.subject),
                        ...teacherGameQuestions(questions.data ?? []).map(
                          (q) => q.subject,
                        ),
                        "تحضير المعلم",
                        "مفرداتي",
                      ]),
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                {mode === "hot-seat" && (
                  <>
                    <label>
                      الفصل الدراسي
                      <select
                        value={term}
                        onChange={(e) => setTerm(e.target.value)}
                      >
                        <option value="">الجميع</option>
                        <option>عام</option>
                      </select>
                    </label>
                    <label>
                      وحدة المفردات
                      <select
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                      >
                        <option value="">كل الوحدات</option>
                        {[...new Set(words.map((w) => w.unit))].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      الدرس المحفوظ
                      <select
                        aria-label="مصدر مفردات الدرس"
                        value={lessonId}
                        onChange={(e) => setLessonId(e.target.value)}
                      >
                        <option value="">كل تحضيراتي المتاحة</option>
                        {lessons.data
                          ?.filter(
                            (l) =>
                              !l.archived &&
                              (!l.classId || l.classId === summary.classId),
                          )
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.title}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="cr-wide">
                      مفردات مخصصة: كلمة | تلميح خاص بالمعلم
                      <textarea
                        aria-label="مفردات مخصصة"
                        placeholder="مثال: التبخر | تحول السائل إلى غاز"
                        value={custom}
                        maxLength={20000}
                        onChange={(e) => setCustom(e.target.value)}
                      />
                    </label>
                  </>
                )}
                <p className="cr-wide">
                  {mode === "hot-seat"
                    ? `الكلمات المتاحة: ${words.length}`
                    : `الأسئلة المتاحة: ${bank.length}`}{" "}
                  · البنك التأسيسي محتوى أصلي للتأسيس، وليس نسخة من كتاب مدرسي.
                  مفردات التحضير تؤخذ كما كتبها المعلم، دون توليد تعريفات.
                </p>
                {selectedQuestions.length > 0 && (
                  <p className="cr-wide">
                    استخدام {selectedQuestions.length} من أسئلة سلة البنك{" "}
                    <button
                      onClick={() => {
                        setSelectedQuestions([]);
                        try {
                          sessionStorage.removeItem(
                            "classroom-question-selection:" + summary.classId,
                          );
                        } catch {
                          /* Continue in memory. */
                        }
                      }}
                    >
                      إلغاء تقييد السلة
                    </button>
                  </p>
                )}
              </fieldset>
            )}
          {mode === "hot-seat" && (
            <>
              <label>
                اكتب اسم الطالب
                <input
                  aria-label="اسم طالب الكرسي الساخن"
                  placeholder="مثال: أنس محمد"
                  maxLength={120}
                  value={studentName}
                  disabled={s.hotSeat.status === "playing"}
                  onChange={(e) => {
                    setStudentName(e.target.value);
                    setStudentId("");
                  }}
                />
              </label>
              <label>
                أو اختر من كشف الفصل
                <select
                  aria-label="طالب الكرسي الساخن"
                  value={studentId}
                  disabled={s.hotSeat.status === "playing"}
                  onChange={(e) => {
                    setStudentId(e.target.value);
                    setStudentName(
                      roster.find((r) => r.id === e.target.value)?.name || "",
                    );
                  }}
                >
                  <option value="">اختر طالبًا</option>
                  {roster.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              {!studentId && studentName.trim() && (
                <p>
                  الاسم للّعب والعرض فقط. لحفظ النقاط، اختر الطالب من كشف الفصل.
                </p>
              )}
              <div className="cr-options" aria-label="وقت كل طالب">
                {[0, 30, 60, 90].map((v) => (
                  <button
                    key={v}
                    aria-pressed={s.hotSeat.durationSec === v}
                    disabled={s.hotSeat.status === "playing"}
                    onClick={() =>
                      update((d) => {
                        d.hotSeat.durationSec = v;
                        d.hotSeat.remainingSec = v;
                      })
                    }
                  >
                    {v ? v + " ث" : "بلا مؤقت"}
                  </button>
                ))}
              </div>
              {s.hotSeat.status === "setup" ? (
                <p>أجلس طالبًا وظهره للشاشة، ثم ابدأ.</p>
              ) : (
                <p>
                  الطالب: {s.hotSeat.studentName} ·{" "}
                  {s.hotSeat.status === "finished"
                    ? `انتهى الدور: ${s.hotSeat.guessedWords.length} إجابات`
                    : "الجولة جارية"}
                </p>
              )}
              <div className="cr-actions">
                {s.hotSeat.status !== "playing" ? (
                  <button className="cr-positive" onClick={startHot}>
                    ابدأ ▶
                  </button>
                ) : (
                  <>
                    <button
                      className="cr-positive"
                      onClick={() => hotNext(true)}
                    >
                      جابها! ✓
                    </button>
                    <button
                      className="cr-warning"
                      onClick={() => hotNext(false)}
                    >
                      تخطي ⬅
                    </button>
                    <button
                      className="cr-negative"
                      aria-label="إيقاف الجولة"
                      onClick={() =>
                        update((d) => {
                          d.hotSeat.status = "finished";
                          d.celebration = {
                            active: true,
                            title: "انتهى دور " + d.hotSeat.studentName,
                            subtitle:
                              d.hotSeat.guessedWords.length + " كلمات صحيحة",
                          };
                        })
                      }
                    >
                      ⏹
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    chooseStudent();
                    update((d) => {
                      d.hotSeat.status = "setup";
                      d.celebration = null;
                    });
                  }}
                >
                  طالب جديد 🔀
                </button>
              </div>
              <aside className="cr-private-hint" aria-label="تلميح خاص بالمعلم">
                <strong>💡 معنى الكلمة — تلميح لك فقط</strong>
                <h3>{currentWord?.word || "ابدأ الجولة"}</h3>
                <p>{currentWord?.hint || "لم يُضف تلميح لهذه المفردة."}</p>
              </aside>
              {s.hotSeat.status === "finished" &&
                s.hotSeat.studentId &&
                s.hotSeat.guessedWords.length > 0 && (
                  <button
                    className="tw-button"
                    disabled={busy || !!pending}
                    onClick={() =>
                      award(
                        s.hotSeat.guessedWords.length,
                        [s.hotSeat.studentId!],
                        "الكرسي الساخن",
                        s.hotSeat.roundId,
                      )
                    }
                  >
                    حفظ نقاط هذا الدور في لوحة الشرف
                  </button>
                )}
            </>
          )}
          {mode === "ladder-race" && (
            <>
              <div className="cr-two-players">
                {[0, 1].map((p) => (
                  <label key={p}>
                    الطالب {p === 0 ? "الأول (أزرق)" : "الثاني (أخضر)"}
                    <input
                      aria-label={
                        p === 0 ? "اسم الطالب الأول" : "اسم الطالب الثاني"
                      }
                      placeholder="اكتب الاسم، مثل أنس محمد"
                      maxLength={120}
                      disabled={s.ladderRace.status === "playing"}
                      value={(() => {
                        const player =
                          p === 0 ? s.ladderRace.player1 : s.ladderRace.player2;
                        return !player.id &&
                          [
                            "الطالب الأول",
                            "الطالب الثاني",
                            "اختر طالبًا",
                          ].includes(player.name)
                          ? ""
                          : player.name;
                      })()}
                      onChange={(e) =>
                        update((d) => {
                          const player =
                            p === 0
                              ? d.ladderRace.player1
                              : d.ladderRace.player2;
                          player.id = null;
                          player.name = e.target.value;
                        })
                      }
                    />
                    <select
                      aria-label={p === 0 ? "الطالب الأول" : "الطالب الثاني"}
                      disabled={s.ladderRace.status === "playing"}
                      value={
                        (p === 0 ? s.ladderRace.player1 : s.ladderRace.player2)
                          .id || ""
                      }
                      onChange={(e) => {
                        const row = roster.find((r) => r.id === e.target.value);
                        update((d) => {
                          const player =
                            p === 0
                              ? d.ladderRace.player1
                              : d.ladderRace.player2;
                          player.id = row?.id || null;
                          player.name = row?.name || "اختر طالبًا";
                        });
                      }}
                    >
                      <option value="">أو اختر من كشف الفصل</option>
                      {roster.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {(!s.ladderRace.player1.id || !s.ladderRace.player2.id) && (
                <p>
                  يمكن اللعب بالأسماء المكتوبة مباشرة. تُحفظ نقطة الفوز فقط
                  للطالب المختار من كشف الفصل.
                </p>
              )}
              <button
                className="tw-button"
                disabled={
                  roster.length < 2 || s.ladderRace.status === "playing"
                }
                onClick={() => {
                  const pool = [...roster];
                  const first = pool.splice(
                      Math.floor(Math.random() * pool.length),
                      1,
                    )[0],
                    second = pool[Math.floor(Math.random() * pool.length)];
                  update((d) => {
                    d.ladderRace.player1 = {
                      id: first.id,
                      name: first.name,
                      step: 0,
                      color: "blue",
                    };
                    d.ladderRace.player2 = {
                      id: second.id,
                      name: second.name,
                      step: 0,
                      color: "green",
                    };
                  });
                }}
              >
                🔀 اختر طالبين عشوائيًا
              </button>
              <label className="cr-check">
                <input
                  type="checkbox"
                  checked={autoAward}
                  onChange={(e) => setAutoAward(e.target.checked)}
                />
                حفظ نقطة الفوز تلقائيًا في لوحة الشرف
              </label>
              <div className="cr-two-players">
                {[0, 1].map((p) => (
                  <div key={p}>
                    <strong>
                      {p === 0
                        ? s.ladderRace.player1.name
                        : s.ladderRace.player2.name}
                    </strong>
                    <div className="cr-actions">
                      <button
                        disabled={s.ladderRace.status !== "playing"}
                        className="cr-positive"
                        onClick={() => moveLadder(p as 0 | 1, 1)}
                      >
                        ▲ صعود
                      </button>
                      <button
                        disabled={s.ladderRace.status !== "playing"}
                        className="cr-negative"
                        onClick={() => moveLadder(p as 0 | 1, -1)}
                      >
                        ▼ نزول
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {s.ladderRace.status === "won" && winningId && (
                <button
                  className="tw-button"
                  disabled={busy || !!pending}
                  onClick={() =>
                    award(
                      1,
                      [winningId],
                      "فوز سباق السلم",
                      s.ladderRace.roundId,
                    )
                  }
                >
                  حفظ نقطة الفوز في لوحة الشرف
                </button>
              )}
            </>
          )}
          {["car-race", "ladder-race", "team-quiz"].includes(mode) && (
            <>
              <div className="cr-actions">
                <button
                  className="cr-positive"
                  onClick={() =>
                    startRace(mode as "car-race" | "ladder-race" | "team-quiz")
                  }
                >
                  ابدأ ▶
                </button>
                <button disabled={!activeQuestion} onClick={nextQuestion}>
                  السؤال التالي
                </button>
              </div>
              {activeQuestion && (
                <aside className="cr-private-hint">
                  <strong>مفتاح السؤال — للمعلم فقط</strong>
                  <p>
                    {privateQuestion?.options[privateQuestion.correctIndex] ||
                      "المصدر الحالي غير متاح؛ اختر سؤالًا من البنك."}
                  </p>
                </aside>
              )}
              {activeQuestion && (
                <div className="cr-options">
                  {activeQuestion.options.map((option, i) => (
                    <button
                      key={i}
                      disabled={
                        activeQuestion.revealedAnswer ||
                        !roundActive ||
                        !privateQuestion
                      }
                      onClick={() =>
                        judge(
                          i === privateQuestion?.correctIndex,
                          mode === "car-race" ? undefined : 0,
                        )
                      }
                    >
                      {String.fromCharCode(65 + i)} · {option}
                    </button>
                  ))}
                </div>
              )}
              {mode === "car-race" ? (
                <>
                  <p>
                    المطب {Math.min(5, s.carRace.currentBump)} من 5 — تحكم في
                    إجابة الفصل
                  </p>
                  <div className="cr-actions">
                    <button
                      className="cr-positive"
                      disabled={
                        !activeQuestion ||
                        activeQuestion.revealedAnswer ||
                        s.carRace.status !== "playing"
                      }
                      onClick={() => judge(true)}
                    >
                      صحيحة ✓
                    </button>
                    <button
                      className="cr-negative"
                      disabled={
                        !activeQuestion ||
                        activeQuestion.revealedAnswer ||
                        s.carRace.status !== "playing"
                      }
                      onClick={() => judge(false)}
                    >
                      خاطئة ✕
                    </button>
                  </div>
                  {s.carRace.status === "won" && (
                    <button
                      className="tw-button"
                      disabled={busy || !!pending}
                      onClick={() =>
                        award(
                          1,
                          [],
                          "فوز الفصل في سباق السيارة",
                          s.carRace.roundId,
                        )
                      }
                    >
                      حفظ نقطة الفوز للفصل
                    </button>
                  )}
                </>
              ) : (
                <div className="cr-two-players">
                  {[0, 1].map((p) => (
                    <div key={p}>
                      <p>
                        {mode === "ladder-race"
                          ? p === 0
                            ? s.ladderRace.player1.name
                            : s.ladderRace.player2.name
                          : s.teamQuiz.names[p]}
                      </p>
                      <div className="cr-actions">
                        <button
                          className="cr-positive"
                          disabled={
                            !activeQuestion ||
                            activeQuestion.revealedAnswer ||
                            !roundActive ||
                            !privateQuestion
                          }
                          onClick={() => judge(true, p as 0 | 1)}
                        >
                          صحيحة ✓
                        </button>
                        <button
                          className="cr-negative"
                          disabled={
                            !activeQuestion ||
                            activeQuestion.revealedAnswer ||
                            !roundActive ||
                            !privateQuestion
                          }
                          onClick={() => judge(false, p as 0 | 1)}
                        >
                          خاطئة ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="tw-muted">
                بعد الحسم، اضغط «السؤال التالي». الحركة تغيّر موقع اللاعب؛ بنك
                الأسئلة لا يتغير.
              </p>
            </>
          )}
          {mode === "voting" && (
            <>
              <label>
                موضوع التصويت
                <select
                  aria-label="موضوع التصويت"
                  disabled={
                    !!s.voting.roster.length ||
                    Object.keys(s.voting.anonymousCounts).length > 0
                  }
                  value={s.voting.topic}
                  onChange={(e) => {
                    const topic = e.target.value;
                    const options =
                      topic === "أيام الأسبوع"
                        ? ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس"]
                        : topic === "نعم / لا"
                          ? ["نعم", "لا"]
                          : topic === "تقييم فهم الدرس"
                            ? ["فهمت جيدًا", "أحتاج مثالًا", "أحتاج مساعدة"]
                            : ["أ", "ب", "ج", "د"];
                    update((d) => {
                      d.voting.topic = topic;
                      d.voting.question =
                        topic === "أيام الأسبوع"
                          ? "ما اليوم المناسب للاختبار؟"
                          : topic === "نعم / لا"
                            ? "هل توافق على الاقتراح؟"
                            : topic === "تقييم فهم الدرس"
                              ? "كيف كان فهمك للدرس؟"
                              : topic === "مخصص"
                                ? "اكتب سؤال التصويت"
                                : "ما إجابتك؟";
                      d.voting.options = options.map((label, i) => ({
                        id: String(i),
                        label,
                        color: [
                          "#34d399",
                          "#22d3ee",
                          "#fb923c",
                          "#60a5fa",
                          "#c084fc",
                        ][i],
                      }));
                    });
                  }}
                >
                  {[
                    "أيام الأسبوع",
                    "نعم / لا",
                    "تقييم فهم الدرس",
                    "خيارات أ/ب/ج/د",
                    "مخصص",
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                نص السؤال
                <input
                  aria-label="نص سؤال التصويت"
                  maxLength={300}
                  value={s.voting.question}
                  onChange={(e) =>
                    update((d) => {
                      d.voting.question = e.target.value;
                    })
                  }
                />
              </label>
              {s.voting.topic === "مخصص" && (
                <label>
                  خيارات مخصصة، كل خيار بسطر
                  <textarea
                    maxLength={2000}
                    value={anonymousOptions}
                    onChange={(e) => setAnonymousOptions(e.target.value)}
                  />
                </label>
              )}
              <label className="cr-check">
                <input
                  type="checkbox"
                  checked={s.voting.namedMode}
                  disabled={!!s.voting.roster.length}
                  onChange={(e) =>
                    update((d) => {
                      d.voting.namedMode = e.target.checked;
                    })
                  }
                />
                تصويت بالأسماء — تظهر أسماء المصوتين في العرض
              </label>
              <div className="cr-actions">
                <button
                  className="cr-positive"
                  disabled={
                    s.voting.topic === "مخصص" &&
                    anonymousOptions
                      .split("\n")
                      .map((v) => v.trim())
                      .filter(Boolean).length < 2
                  }
                  onClick={() =>
                    update((d) => {
                      d.voting.roster = d.voting.namedMode
                        ? roster.map((r) => ({ id: r.id, name: r.name }))
                        : [];
                      d.voting.votes = {};
                      d.voting.anonymousCounts = {};
                      d.voting.currentStudentIndex = 0;
                      d.voting.showResults = false;
                      if (d.voting.topic === "مخصص")
                        d.voting.options = anonymousOptions
                          .split("\n")
                          .map((x) => x.trim())
                          .filter(Boolean)
                          .slice(0, 12)
                          .map((label, i) => ({
                            id: String(i),
                            label,
                            color: ["#34d399", "#60a5fa", "#fb923c", "#c084fc"][
                              i % 4
                            ],
                          }));
                    })
                  }
                >
                  بدء تصويت جديد
                </button>
                <button
                  onClick={() =>
                    update((d) => {
                      d.voting.showResults = true;
                    })
                  }
                >
                  عرض النتيجة على البروجكتر
                </button>
                <button
                  onClick={() =>
                    update((d) => {
                      d.voting.roster = [];
                      d.voting.votes = {};
                      d.voting.anonymousCounts = {};
                      d.voting.currentStudentIndex = 0;
                      d.voting.showResults = false;
                    })
                  }
                >
                  إنهاء التصويت وتغيير الإعدادات
                </button>
              </div>
              <p>
                {s.voting.namedMode
                  ? s.voting.roster[s.voting.currentStudentIndex]
                    ? "دور: " +
                      s.voting.roster[s.voting.currentStudentIndex].name
                    : Object.keys(s.voting.votes).length ===
                          s.voting.roster.length && s.voting.roster.length
                      ? "✓ صوت جميع الطلاب"
                      : "اختر بدء تصويت جديد، أو عُد للطلاب الذين تخطيتهم"
                  : "تصويت عام يدوي؛ كل نقرة تسجل صوتًا."}
              </p>
              <p>
                {s.voting.namedMode
                  ? `صوت ${Object.keys(s.voting.votes).length} من ${s.voting.roster.length}`
                  : `الأصوات: ${Object.values(s.voting.anonymousCounts).reduce((sum, n) => sum + n, 0)}`}
              </p>
              <div className="cr-options">
                {s.voting.options.map((o) => (
                  <button
                    key={o.id}
                    style={{ borderColor: o.color }}
                    onClick={() => cast(o.id)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="cr-actions">
                <button
                  onClick={() =>
                    update((d) => {
                      d.voting.currentStudentIndex++;
                    })
                  }
                >
                  تخطي ⏭
                </button>
                <button
                  onClick={() =>
                    update((d) => {
                      const next = d.voting.roster.findIndex(
                        (r) => !d.voting.votes[r.id],
                      );
                      if (next >= 0) d.voting.currentStudentIndex = next;
                    })
                  }
                >
                  العودة لأول طالب لم يصوت
                </button>
              </div>
            </>
          )}
          {mode === "what-to-do" && (
            <>
              <div className="cr-options">
                {[
                  ["exercise", "✏️ حل تدريب"],
                  ["read", "📖 اقرأ"],
                  ["question", "❓ حل سؤال"],
                  ["memorize", "🧠 احفظ"],
                  ["custom", "📝 نص حر"],
                ].map(([id, title]) => (
                  <button
                    key={id}
                    aria-pressed={activityKind === id}
                    onClick={() => setActivityKind(id)}
                  >
                    {title}
                  </button>
                ))}
              </div>
              <label>
                {activityKind === "custom" || activityKind === "memorize"
                  ? "النص المطلوب"
                  : "رقم التدريب أو السؤال / الفقرة"}
                <input
                  aria-label="تفصيل التوجيه"
                  maxLength={300}
                  value={activityTitle}
                  onChange={(e) => setActivityTitle(e.target.value)}
                />
              </label>
              <label>
                رقم الصفحة
                <input
                  aria-label="رقم الصفحة"
                  maxLength={30}
                  value={pageNumber}
                  onChange={(e) => setPageNumber(e.target.value)}
                />
              </label>
              <button
                className="cr-positive"
                disabled={
                  s.whatToDo.items.length >= 100 ||
                  (["custom", "memorize"].includes(activityKind) &&
                    !activityTitle.trim())
                }
                onClick={() => {
                  const id = crypto.randomUUID(),
                    prefix = (
                      {
                        exercise: "حل تدريب",
                        read: "اقرأ",
                        question: "حل سؤال",
                        memorize: "احفظ",
                        custom: "",
                      } as Record<string, string>
                    )[activityKind];
                  update((d) => {
                    d.whatToDo.items.push({
                      id,
                      kind: activityKind,
                      title: [prefix, activityTitle].filter(Boolean).join(" "),
                      subtitle: pageNumber ? "صفحة " + pageNumber : "",
                      active: true,
                      completed: false,
                    });
                    d.whatToDo.focusedItemId = id;
                  });
                  setActivityTitle("");
                }}
              >
                إضافة +
              </button>
              <div className="cr-directions-list">
                {s.whatToDo.items.map((item) => (
                  <article key={item.id}>
                    <strong>
                      {item.title} {item.subtitle}
                    </strong>
                    <div className="cr-actions">
                      <button
                        onClick={() =>
                          update((d) => {
                            d.whatToDo.focusedItemId = item.id;
                          })
                        }
                      >
                        عرض الآن
                      </button>
                      <button
                        aria-pressed={item.completed}
                        onClick={() =>
                          update((d) => {
                            const row = d.whatToDo.items.find(
                              (i) => i.id === item.id,
                            )!;
                            row.completed = !row.completed;
                          })
                        }
                      >
                        {item.completed ? "إعادة للمهام" : "✓ اكتمل"}
                      </button>
                      <button
                        onClick={() =>
                          update((d) => {
                            const row = d.whatToDo.items.find(
                              (i) => i.id === item.id,
                            )!;
                            row.active = !row.active;
                          })
                        }
                      >
                        {item.active ? "إخفاء" : "إظهار"}
                      </button>
                      <button
                        onClick={() =>
                          update((d) => {
                            d.whatToDo.items = d.whatToDo.items.filter(
                              (i) => i.id !== item.id,
                            );
                          })
                        }
                      >
                        حذف
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
          {mode === "quiet-meter" && (
            <>
              <p>
                مستوى نسبي للصوت، وليس قياسًا معايرًا بالديسيبل. لا يُسجل الصوت
                ولا يُرفع إلى الخادم.
              </p>
              <button
                className="tw-button"
                disabled={micPending}
                onClick={() => void startMic()}
              >
                {micPending
                  ? "بانتظار إذن الميكروفون…"
                  : microphone
                    ? "إيقاف الميكروفون"
                    : "تشغيل الميكروفون"}
              </button>
              <label>
                حساسية الميكروفون
                <input
                  aria-label="حساسية الميكروفون"
                  type="range"
                  min={0.5}
                  max={5}
                  step={0.1}
                  value={sensitivity}
                  onChange={(e) => {
                    setSensitivity(Number(e.target.value));
                    if (microphone) {
                      stopMic();
                      update((d) => {
                        d.quietMeter.running = false;
                      });
                      setNotice(
                        "اضغط تشغيل الميكروفون لتطبيق الحساسية الجديدة.",
                      );
                    }
                  }}
                />
              </label>
              <label>
                محاكاة مستوى الصوت يدويًا
                <input
                  aria-label="محاكاة مستوى الصوت"
                  type="range"
                  min={0}
                  max={100}
                  value={s.quietMeter.noiseLevel}
                  onChange={(e) => {
                    stopMic();
                    update((d) => {
                      d.quietMeter.source = "manual";
                      d.quietMeter.noiseLevel = Number(e.target.value);
                    });
                  }}
                />
              </label>
              <label>
                هدف الهدوء
                <select
                  aria-label="هدف الهدوء"
                  value={s.quietMeter.goalSeconds}
                  onChange={(e) =>
                    update((d) => {
                      d.quietMeter.goalSeconds = Number(e.target.value);
                      d.quietMeter.quietElapsedSeconds = 0;
                      d.quietMeter.goalAchieved = false;
                      d.quietMeter.lastSampleAt = Date.now();
                      d.celebration = null;
                    })
                  }
                >
                  {[60, 120, 180, 300, 600].map((v) => (
                    <option key={v} value={v}>
                      {v / 60} دقائق
                    </option>
                  ))}
                </select>
              </label>
              <div className="cr-actions">
                <button
                  className="cr-positive"
                  onClick={() =>
                    update((d) => {
                      d.quietMeter.running = !d.quietMeter.running;
                      d.quietMeter.lastSampleAt = Date.now();
                    })
                  }
                >
                  {s.quietMeter.running
                    ? "إيقاف القياس مؤقتًا"
                    : "بدء هدف الهدوء"}
                </button>
                <button
                  onClick={() =>
                    update((d) => {
                      d.quietMeter.quietElapsedSeconds = 0;
                      d.quietMeter.goalAchieved = false;
                      d.celebration = null;
                    })
                  }
                >
                  تصفير الوقت
                </button>
                <button
                  disabled={!s.quietMeter.goalAchieved || busy || !!pending}
                  onClick={() => void creditDay()}
                >
                  مكافأة الفصل بيوم استمرارية
                </button>
              </div>
              <small>
                عند إغلاق شاشة التحكم يتوقف جمع زمن الهدوء، ويستمر المؤقت الصفي
                حسب توقيته المحفوظ.
              </small>
            </>
          )}
          {mode === "timer" && (
            <>
              <div className="cr-options">
                {[60, 120, 180, 300, 600, 900].map((v) => (
                  <button
                    key={v}
                    disabled={s.timer.running}
                    onClick={() =>
                      update((d) => {
                        d.timer.totalSeconds = v;
                        d.timer.remainingSeconds = v;
                        d.timer.deadline = null;
                        d.celebration = null;
                      })
                    }
                  >
                    {v / 60} د
                  </button>
                ))}
              </div>
              <label>
                المدة بالثواني
                <input
                  type="number"
                  aria-label="المدة بالثواني"
                  min={1}
                  max={7200}
                  disabled={s.timer.running}
                  value={s.timer.totalSeconds}
                  onChange={(e) => {
                    const value = Math.max(
                      1,
                      Math.min(7200, Number(e.target.value) || 1),
                    );
                    update((d) => {
                      d.timer.totalSeconds = value;
                      d.timer.remainingSeconds = value;
                      d.timer.deadline = null;
                    });
                  }}
                />
              </label>
              <label className="cr-check">
                <input
                  type="checkbox"
                  checked={s.timer.warnAtOneMinute}
                  onChange={(e) =>
                    update((d) => {
                      d.timer.warnAtOneMinute = e.target.checked;
                    })
                  }
                />
                تنبيه قبل الانتهاء بدقيقة
              </label>
              <div className="cr-actions">
                <button
                  className="cr-positive"
                  onClick={() => {
                    try {
                      sound.current ??= new AudioContext();
                      void sound.current.resume().catch(() => {});
                    } catch {
                      /* Visual timer works without Web Audio. */
                    }
                    update((d) => {
                      d.timer.running = !d.timer.running;
                      d.timer.deadline = d.timer.running
                        ? Date.now() + d.timer.remainingSeconds * 1000
                        : null;
                      d.celebration = null;
                    });
                  }}
                >
                  {s.timer.running ? "إيقاف مؤقت ⏸" : "تشغيل ▶"}
                </button>
                <button
                  onClick={() =>
                    update((d) => {
                      d.timer.remainingSeconds += 30;
                      d.timer.totalSeconds += 30;
                      if (d.timer.deadline) d.timer.deadline += 30000;
                    })
                  }
                >
                  +30 ثانية
                </button>
                <button
                  onClick={() =>
                    update((d) => {
                      d.timer.running = false;
                      d.timer.deadline = null;
                      d.timer.remainingSeconds = d.timer.totalSeconds;
                      d.celebration = null;
                    })
                  }
                >
                  إعادة ضبط ↺
                </button>
              </div>
            </>
          )}
          {mode === "wheel" && (
            <>
              <label className="cr-check">
                <input
                  type="checkbox"
                  checked={noRepeat}
                  onChange={(e) => setNoRepeat(e.target.checked)}
                />
                استبعاد الطالب الذي شارك حتى يشارك الجميع
              </label>
              <p>
                القائمة: {roster.length} طالبًا · اختير {used.length} في هذه
                الدورة.
              </p>
              <div className="cr-actions">
                <button
                  className="cr-positive"
                  disabled={s.wheel.spinning || !roster.length}
                  onClick={spin}
                >
                  أدر العجلة 🔀
                </button>
                <button
                  onClick={() => {
                    setUsed([]);
                    setNotice("بدأت دورة اختيار جديدة.");
                  }}
                >
                  دورة جديدة
                </button>
                {s.wheel.selectedId && (
                  <button
                    disabled={busy || !!pending}
                    onClick={() =>
                      award(1, [s.wheel.selectedId!], "مشاركة عجلة الأسماء")
                    }
                  >
                    +1 مشاركة للطالب المختار
                  </button>
                )}
              </div>
            </>
          )}
          {mode === "honor-board" && (
            <>
              <p>
                نقاط حقيقية محفوظة في سجل الفصل. أيام الاستمرارية تحسب مرة واحدة
                لكل يوم تفاعل موثق يدويًا.
              </p>
              <label>
                الطالب المستفيد
                <select
                  aria-label="الطالب المستفيد من النقاط"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                >
                  <option value="">الفصل كاملًا</option>
                  {roster.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="cr-actions">
                {[1, 2, 5].map((points) => (
                  <button
                    key={points}
                    disabled={busy || !!pending}
                    onClick={() =>
                      award(points, studentId ? [studentId] : [], "مشاركة صفية")
                    }
                  >
                    +{points}
                  </button>
                ))}
                <button
                  disabled={busy || summary.creditedToday}
                  onClick={() => void creditDay()}
                >
                  توثيق يوم تفاعل للفصل
                </button>
              </div>
              <p>
                استمرارية: {summary.streakDays} أيام · نقاط الفصل:{" "}
                {summary.classPoints}
              </p>
              <label>
                الدرجة الكلية للمشاركة
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={gradeMax}
                  onChange={(e) =>
                    setGradeMax(
                      Math.max(1, Math.min(1000, Number(e.target.value) || 1)),
                    )
                  }
                />
              </label>
              <p>
                ترحيل نقاط اليوم إلى تقييم منفصل: «مشاركة الألعاب الصفية». تُقيد
                درجة كل طالب بالدرجة الكلية المختارة؛ لا تتغير التقييمات الأخرى.
              </p>
              <ul>
                {roster
                  .filter((r) => r.todayPoints > 0)
                  .map((r) => (
                    <li key={r.id}>
                      {r.name}: {r.todayPoints} نقطة ←{" "}
                      {Math.min(gradeMax, r.todayPoints)} / {gradeMax}
                    </li>
                  ))}
              </ul>
              <button
                className="tw-button primary"
                disabled={busy || !roster.some((r) => r.todayPoints > 0)}
                onClick={async () => {
                  if (
                    !window.confirm(
                      "حفظ الدرجات المعروضة في تقييم مشاركة منفصل لهذا اليوم؟",
                    )
                  )
                    return;
                  setBusy(true);
                  try {
                    await teacherApi("/teacher/grades/bulk", "POST", {
                      classId: summary.classId,
                      date: summary.today,
                      title: "مشاركة الألعاب الصفية",
                      totalMarks: gradeMax,
                      entries: roster
                        .filter((r) => r.todayPoints > 0)
                        .map((r) => ({
                          studentId: r.id,
                          marks: Math.min(gradeMax, r.todayPoints),
                        })),
                    });
                    await qc.invalidateQueries({ queryKey: ["teacher"] });
                    setNotice(
                      "حُفظ تقييم المشاركة دون تكرار التقييم عند إعادة الترحيل.",
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                ترحيل نقاط اليوم إلى درجات المشاركة
              </button>
            </>
          )}
        </section>
        <aside className="cr-preview">
          <div className="cr-preview-title">
            <strong>معاينة شاشة الطلاب</strong>
            <button className="tw-button" onClick={() => setOverlay(true)}>
              <Maximize size={16} />
              تكبير
            </button>
          </div>
          <ProjectorDisplay state={s} preview roster={roster} />
          <p className="tw-small tw-muted">
            لا تظهر هنا تلميحات المعلم أو الإجابة قبل الحسم.
          </p>
        </aside>
      </div>
      <Dialog open={overlay} onOpenChange={setOverlay}>
        <DialogContent className="cr-display-dialog" dir="rtl">
          <DialogTitle className="sr-only">شاشة البروجكتر</DialogTitle>
          <DialogDescription className="sr-only">
            عرض الطلاب، دون تلميحات المعلم.
          </DialogDescription>
          <button
            className="cr-overlay-close"
            onClick={() => setOverlay(false)}
          >
            إغلاق
          </button>
          <ProjectorDisplay state={s} roster={roster} />
        </DialogContent>
      </Dialog>
    </section>
  );
}
export function QuickClassroomDock() {
  const [open, setOpen] = useState<ClassroomToolMode | null>(null),
    [path] = useLocation();
  const [classId] = useActiveTeacherClass();
  function launch(mode: ClassroomToolMode) {
    if (path === "/teacher/classroom")
      window.dispatchEvent(
        new CustomEvent("classroom:quick", { detail: mode }),
      );
    else setOpen(mode);
  }
  return (
    <>
      <div className="cr-quick-dock" aria-label="اختصارات الحصة">
        <a
          className="cr-project-button"
          href={teacherClassPath("projector", classId)}
          target="_blank"
          rel="noopener"
        >
          <Presentation size={17} />
          شاشة العرض
        </a>
        {[
          [Timer, "timer", "المؤقت السريع"],
          [Volume2, "quiet-meter", "مقياس الهدوء السريع"],
          [ListChecks, "what-to-do", "ماذا نفعل الآن؟"],
        ].map(([Icon, mode, label]) => {
          const Glyph = Icon as typeof Timer;
          return (
            <button
              key={String(mode)}
              aria-label={String(label)}
              title={String(label)}
              onClick={() => launch(mode as ClassroomToolMode)}
            >
              <Glyph size={18} />
            </button>
          );
        })}
      </div>
      <Dialog
        open={!!open}
        onOpenChange={(value) => {
          if (!value) setOpen(null);
        }}
      >
        <DialogContent className="teacher-room cr-quick-dialog" dir="rtl">
          <DialogTitle>أدوات الحصة السريعة</DialogTitle>
          <DialogDescription>
            تحكم بالفصل النشط وابقَ في صفحة عملك.
          </DialogDescription>
          <button className="tw-button" onClick={() => setOpen(null)}>
            إغلاق
          </button>
          {open && <TeacherClassroomHub compact initialMode={open} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function ClassroomLaunchCard() {
  const [classId] = useActiveTeacherClass();
  return (
    <section className="tw-card cr-launch-card">
      <Gamepad2 size={32} />
      <div>
        <h2>حصة تفاعلية تبدأ من هنا</h2>
        <p>ألعاب، تصويت، مؤقت، ولوحة شرف من كشف فصلك.</p>
      </div>
      <Link
        className="tw-button primary"
        href={teacherClassPath("classroom", classId)}
      >
        فتح مركز الحصة والبروجكتر
      </Link>
    </section>
  );
}
export function TeacherProjectorScreen() {
  const classes = useRecords<TeacherClass[]>("classes"),
    profile = useRecords<TeacherProfile>("profile");
  const requested = new URLSearchParams(location.search).get("class") || "";
  const cls = classes.data?.find((c) => c.id === requested && !c.archived);
  const summary = useSummary(cls?.id || "");
  if (classes.isPending || profile.isPending || (summary.isPending && !!cls))
    return (
      <main className="cr-projector">
        <p role="status">جار ربط شاشة العرض…</p>
      </main>
    );
  if (!cls || !summary.data || !profile.data)
    return (
      <main className="cr-projector">
        <h1>افتح العرض من مركز الحصة</h1>
        <p role="alert">
          {classes.error?.message ||
            summary.error?.message ||
            "اختر فصلًا تملكه من شاشة التحكم."}
        </p>
        <Link href="/teacher/classroom">مركز الحصة والبروجكتر</Link>
      </main>
    );
  return <ConnectedProjector summary={summary.data} />;
}
function ConnectedProjector({ summary }: { summary: Summary }) {
  const { state } = useClassroomProjectorSync(summary.ownerId, summary.classId);
  return <ProjectorDisplay state={state} roster={summary.scores} standalone />;
}
function ProjectorQuestion({
  question,
}: {
  question: PublicGameQuestion | null;
}) {
  if (!question)
    return (
      <p className="cr-projector-empty">ابدأ الجولة من شاشة تحكم المعلم.</p>
    );
  return (
    <section className="cr-projector-question">
      <h2>{question.text}</h2>
      <div className="cr-projector-options">
        {question.options.map((option, i) => (
          <div
            className={
              question.revealedAnswer && question.correctIndex === i
                ? "is-correct"
                : ""
            }
            key={i}
          >
            <b>{["أ", "ب", "ج", "د", "هـ", "و"][i]}</b>
            {option}
          </div>
        ))}
      </div>
    </section>
  );
}
export function ProjectorDisplay({
  state: s,
  preview = false,
  standalone = false,
  roster = [],
}: {
  state: ClassroomLiveState;
  preview?: boolean;
  standalone?: boolean;
  roster?: { id: string; name: string }[];
}) {
  const [now, setNow] = useState(Date.now()),
    [fullscreen, setFullscreen] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    const change = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const wheelRoster = classroomWheelRoster(roster);
  const hotLeft = classroomRemaining(
      s.hotSeat.deadline,
      s.hotSeat.remainingSec,
      now,
    ),
    timerLeft = classroomRemaining(
      s.timer.deadline,
      s.timer.remainingSeconds,
      now,
    ),
    voteCounts = s.voting.options.map((o) => ({
      ...o,
      voters: Object.values(s.voting.votes).filter((v) => v.optionId === o.id),
      count: s.voting.namedMode
        ? Object.values(s.voting.votes).filter((v) => v.optionId === o.id)
            .length
        : s.voting.anonymousCounts[o.id] || 0,
    }));
  const focused =
    s.whatToDo.items.find(
      (i) => i.id === s.whatToDo.focusedItemId && i.active,
    ) || s.whatToDo.items.find((i) => i.active && !i.completed);
  return (
    <div
      ref={surface}
      className={
        "cr-projector" +
        (preview ? " is-preview" : "") +
        (standalone ? " is-standalone" : "")
      }
      dir="rtl"
      data-mode={s.mode}
    >
      <header className="cr-projector-header">
        <strong>{s.header.dayName}</strong>
        <div>
          <time>{s.header.dateFormatted}</time>
          <p>
            {[s.header.periodLabel, s.header.className, s.header.subjectName]
              .filter(Boolean)
              .join(" — ")}
          </p>
        </div>
        <div className="cr-school-logo">
          {s.header.logoAssetId ? (
            <img
              src={"/api/teacher/assets/" + s.header.logoAssetId}
              alt="شعار المدرسة"
            />
          ) : (
            <BrandMark />
          )}
          <small>{s.header.schoolName}</small>
        </div>
      </header>
      {standalone && !!document.fullscreenEnabled && (
        <button
          className="cr-fullscreen-button"
          aria-label={fullscreen ? "إنهاء ملء الشاشة" : "ملء الشاشة"}
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void surface.current?.requestFullscreen?.().catch(() => {});
          }}
        >
          {fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
        </button>
      )}
      {standalone && <AccountLogoutButton className="account-logout--projector"/>}
      <div className="cr-projector-content">
        {s.mode === "idle" && (
          <section className="cr-idle">
            <Presentation size={70} />
            <h1>حصة نتعلّم فيها معًا</h1>
            <p>بانتظار اختيار المعلم للأداة أو اللعبة.</p>
          </section>
        )}
        {s.mode === "hot-seat" && (
          <section className="cr-hot-seat-view">
            <Armchair className="cr-hot-chair" size={60} />
            <h1>الكرسي الساخن</h1>
            <p>{s.hotSeat.studentName}</p>
            <div className="cr-hot-word">
              {s.hotSeat.currentWord?.word || "استعد للجولة"}
            </div>
            <output
              className={
                "cr-round-clock" +
                (hotLeft <= 5 && s.hotSeat.durationSec ? " is-urgent" : "")
              }
            >
              <svg
                className="cr-countdown-ring"
                viewBox="0 0 130 130"
                aria-hidden="true"
              >
                <circle cx="65" cy="65" r="56" className="cr-ring-track" />
                <circle
                  cx="65"
                  cy="65"
                  r="56"
                  pathLength="100"
                  strokeDasharray="100"
                  strokeDashoffset={
                    s.hotSeat.durationSec
                      ? 100 * (1 - hotLeft / s.hotSeat.durationSec)
                      : 0
                  }
                />
              </svg>
              {s.hotSeat.durationSec ? hotLeft : "∞"}
            </output>
            <div className="cr-word-badges">
              {s.hotSeat.guessedWords.map((word, i) => (
                <span key={i}>✓ {word}</span>
              ))}
            </div>
            {(s.hotSeat.status === "finished" ||
              (s.hotSeat.status === "playing" &&
                s.hotSeat.durationSec > 0 &&
                hotLeft === 0)) && (
              <p>انتهى الدور: {s.hotSeat.guessedWords.length} كلمات صحيحة</p>
            )}
          </section>
        )}
        {s.mode === "car-race" && (
          <>
            <div className="cr-bumps-progress">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <span
                  key={n}
                  className={
                    s.carRace.currentBump === n
                      ? "is-active"
                      : s.carRace.completedBumps.includes(n)
                        ? "is-done"
                        : ""
                  }
                >
                  {n === 6
                    ? "🏁"
                    : s.carRace.completedBumps.includes(n)
                      ? "✓"
                      : n}
                </span>
              ))}
            </div>
            <CarScene bump={s.carRace.currentBump} />
            {s.carRace.lastOutcome && (
              <p className={"cr-outcome " + s.carRace.lastOutcome}>
                {s.carRace.lastOutcome === "correct"
                  ? "إجابة صحيحة — إلى الأمام!"
                  : "إجابة خاطئة — نعود للخلف"}
              </p>
            )}
            {s.carRace.status !== "won" && (
              <ProjectorQuestion question={s.carRace.currentQuestion} />
            )}
          </>
        )}
        {s.mode === "ladder-race" && (
          <>
            <section className="cr-ladder-scene">
              <div className="cr-cup">🏆</div>
              {[s.ladderRace.player1, s.ladderRace.player2].map((p, i) => (
                <div className={"cr-ladder-player " + p.color} key={i}>
                  <div className="cr-ladder">
                    <div
                      className="cr-climber"
                      style={{ bottom: (p.step / 5) * 72 + "%" }}
                    >
                      <Person
                        color={p.color === "blue" ? "#60a5fa" : "#34d399"}
                      />
                    </div>
                  </div>
                  <strong>{p.name}</strong>
                  <span>{p.step} / 5</span>
                </div>
              ))}
            </section>
            {s.ladderRace.status !== "won" && (
              <ProjectorQuestion question={s.ladderRace.currentQuestion} />
            )}
          </>
        )}
        {s.mode === "voting" && (
          <section className="cr-voting-view">
            <Vote size={48} />
            <h1>{s.voting.question || "التصويت"}</h1>
            {s.voting.showResults ? (
              <div className="cr-vote-results">
                {[...voteCounts]
                  .sort((a, b) => b.count - a.count)
                  .map((o) => (
                    <article key={o.id}>
                      <strong>
                        {o.label} · {o.count}
                      </strong>
                      <div className="cr-vote-bar">
                        <i
                          style={{
                            width:
                              (o.count /
                                Math.max(
                                  1,
                                  ...voteCounts.map((v) => v.count),
                                )) *
                                100 +
                              "%",
                            background: o.color,
                          }}
                        />
                      </div>
                      {s.voting.namedMode && (
                        <p>
                          {o.voters.map((v) => v.studentName).join("، ") ||
                            "لا أصوات"}
                        </p>
                      )}
                    </article>
                  ))}
              </div>
            ) : (
              <>
                <p>
                  {s.voting.namedMode &&
                  s.voting.roster[s.voting.currentStudentIndex]
                    ? "دور: " +
                      s.voting.roster[s.voting.currentStudentIndex].name
                    : s.voting.namedMode
                      ? "انتهى مرور الكشف"
                      : "تصويت عام"}
                </p>
                <p>
                  {s.voting.namedMode
                    ? `صوت ${Object.keys(s.voting.votes).length} من ${s.voting.roster.length}`
                    : `الأصوات: ${Object.values(s.voting.anonymousCounts).reduce((sum, n) => sum + n, 0)}`}
                </p>
                <div className="cr-vote-choices">
                  {s.voting.options.map((o) => (
                    <div
                      key={o.id}
                      style={{ borderColor: o.color, color: o.color }}
                    >
                      {o.label}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
        {s.mode === "what-to-do" && (
          <section className="cr-directions-view">
            <ListChecks size={60} />
            <h1>{focused?.title || "ماذا نفعل الآن؟"}</h1>
            <p>{focused?.subtitle}</p>
            <div className="cr-directions-badges">
              {s.whatToDo.items
                .filter((i) => i.active)
                .map((i) => (
                  <span key={i.id}>
                    {i.completed ? "✓ " : ""}
                    {i.title} {i.subtitle}
                  </span>
                ))}
            </div>
          </section>
        )}
        {s.mode === "quiet-meter" && (
          <section className="cr-quiet-view">
            <h1>نتعلّم بهدوء</h1>
            <p>{s.quietMeter.running ? "القياس جارٍ" : "القياس متوقف"}</p>
            <svg
              className="cr-gauge"
              viewBox="0 0 300 185"
              role="img"
              aria-label={"مستوى الصوت " + Math.round(s.quietMeter.noiseLevel)}
            >
              <path
                d="M30 150 A120 120 0 0 1 150 30"
                fill="none"
                stroke="#34d399"
                strokeWidth="22"
              />
              <path
                d="M150 30 A120 120 0 0 1 270 150"
                fill="none"
                stroke="#fb7185"
                strokeWidth="22"
              />
              <g
                style={{
                  transform: `rotate(${s.quietMeter.noiseLevel * 1.8 - 90}deg)`,
                  transformOrigin: "150px 150px",
                }}
              >
                <path
                  d="M150 150 L150 48"
                  stroke="white"
                  strokeWidth="6"
                  strokeLinecap="round"
                />
              </g>
              <circle cx="150" cy="150" r="13" fill="white" />
            </svg>
            <h2
              className={
                s.quietMeter.noiseLevel < s.quietMeter.threshold
                  ? "cr-mint"
                  : "cr-red"
              }
            >
              {s.quietMeter.noiseLevel < s.quietMeter.threshold
                ? "🔈 هدوء ممتاز"
                : "🔊 صوت مرتفع"}
            </h2>
            <p>
              {s.quietMeter.source === "manual"
                ? "محاكاة يدوية"
                : "قياس نسبي من الميكروفون"}{" "}
              · هدف الهدوء: {clock(s.quietMeter.goalSeconds)}
            </p>
            <progress
              max={s.quietMeter.goalSeconds}
              value={s.quietMeter.quietElapsedSeconds}
            />
            <p>وقت الهدوء: {clock(s.quietMeter.quietElapsedSeconds)}</p>
          </section>
        )}
        {s.mode === "timer" && (
          <section className="cr-timer-view">
            <Timer size={55} />
            <h1>وقت النشاط</h1>
            <output
              className={
                timerLeft <= 60 && s.timer.warnAtOneMinute ? "is-urgent" : ""
              }
            >
              {clock(timerLeft)}
            </output>
            <p>
              {timerLeft === 0
                ? "انتهى وقت النشاط!"
                : s.timer.running
                  ? "ركز… كل خطوة تقرّبك"
                  : "جاهزون للبدء؟"}
            </p>
          </section>
        )}
        {s.mode === "wheel" && (
          <section className="cr-wheel-view">
            <h1>فرصة لكل اسم</h1>
            <div className="cr-wheel-pointer">▼</div>
            <div className="cr-wheel-frame">
              <div
                className="cr-wheel"
                style={{ transform: `rotate(${s.wheel.rotation}deg)` }}
              >
                {wheelRoster.length <= 24 &&
                  wheelRoster.map((p, i) => (
                    <span
                      key={p.id}
                      style={{
                        transform: `translate(-50%,-50%) rotate(${(i * 360) / wheelRoster.length}deg) translateY(-85px)`,
                      }}
                    >
                      {p.name}
                    </span>
                  ))}
              </div>
            </div>
            <p>اختيار من كشف الفصل: {wheelRoster.length} طالبًا</p>
            <h2>
              {s.wheel.spinning
                ? "…"
                : s.wheel.selectedName || "من سيشارك الآن؟"}
            </h2>
          </section>
        )}
        {s.mode === "honor-board" && (
          <section className="cr-honor-view">
            <Trophy size={60} />
            <h1>لوحة شرف الفصل</h1>
            <div className="cr-honor-facts">
              <span>🔥 {s.honorBoard.streakDays} أيام تفاعل متتابعة</span>
              <span>⭐ {s.honorBoard.classPoints} نقاط للفصل</span>
            </div>
            <ol>
              {Object.entries(s.honorBoard.scores)
                .sort(([, a], [, b]) => b.points - a.points)
                .slice(0, 12)
                .map(([id, row], i) => (
                  <li key={id}>
                    <b>{i === 0 ? "🏆" : i + 1}</b>
                    <strong>{row.studentName}</strong>
                    <span>{row.points} نقاط</span>
                  </li>
                ))}
            </ol>
            {!Object.keys(s.honorBoard.scores).length && (
              <p>تظهر النقاط بعد حفظ مشاركات الطلاب.</p>
            )}
          </section>
        )}
        {s.mode === "team-quiz" && (
          <>
            <h1>تحدي الفريقين</h1>
            <div className="cr-team-scores">
              {s.teamQuiz.names.map((name, i) => (
                <article key={i}>
                  <strong>{name}</strong>
                  <b>{s.teamQuiz.scores[i]}</b>
                  <span>الهدف: {s.teamQuiz.target}</span>
                </article>
              ))}
            </div>
            <ProjectorQuestion question={s.teamQuiz.currentQuestion} />
          </>
        )}
      </div>
      {s.celebration?.active && (
        <div className="cr-celebration" role="status">
          <Confetti />
          <h2>{s.celebration.title}</h2>
          <p>{s.celebration.subtitle}</p>
        </div>
      )}
    </div>
  );
}
function Person({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 70 100" aria-hidden="true">
      <circle cx="35" cy="16" r="13" fill="#efc4a4" />
      <path d="M20 33 Q35 25 50 33 L54 66 H16Z" fill={color} />
      <path d="M22 65 L18 96 M48 65 L52 96" stroke="#1f2937" strokeWidth="12" />
      <path
        d="M20 36 L7 58 M50 36 L63 58"
        stroke="#efc4a4"
        strokeWidth="9"
        strokeLinecap="round"
      />
    </svg>
  );
}
function CarScene({ bump }: { bump: number }) {
  return (
    <svg
      viewBox="0 0 900 260"
      className="cr-car-scene"
      role="img"
      aria-label={`السيارة عند ${bump === 6 ? "خط النهاية" : "المطب " + bump}`}
    >
      <defs>
        <linearGradient id="cr-sky" x2="0" y2="1">
          <stop stopColor="#8ad8f5" />
          <stop offset="1" stopColor="#e3f3f8" />
        </linearGradient>
        <pattern
          id="cr-flag"
          width="16"
          height="16"
          patternUnits="userSpaceOnUse"
        >
          <rect width="16" height="16" fill="white" />
          <path d="M0 0H8V8H0ZM8 8H16V16H8Z" fill="#17263c" />
        </pattern>
      </defs>
      <rect width="900" height="260" fill="url(#cr-sky)" />
      <path d="M0 160 Q180 100 360 152 T900 132 V260 H0Z" fill="#ddb67b" />
      {[50, 320, 620, 860].map((x) => (
        <g transform={`translate(${x},100)`} key={x}>
          <path d="M0 70 L3 0" stroke="#896849" strokeWidth="9" />
          <path
            d="M3 2Q-40-35-48 2M3 2Q35-40 50-7M3 2Q-12-50-20-45M3 2Q14-40 28-32"
            stroke="#268763"
            strokeWidth="10"
            fill="none"
          />
        </g>
      ))}
      <rect y="188" width="900" height="72" fill="#35404b" />
      <path
        d="M0 230 H900"
        stroke="#f8e2a0"
        strokeWidth="4"
        strokeDasharray="35 20"
      />
      {[1, 2, 3, 4, 5].map((n, i) => (
        <g key={n} transform={`translate(${120 + i * 135},0)`}>
          <path
            d="M-18 188 Q0 164 18 188"
            fill="#f7ca50"
            stroke="#222"
            strokeWidth="5"
          />
          <rect x="-18" y="104" width="36" height="35" rx="5" fill="#2873ad" />
          <text y="128" textAnchor="middle" fill="white" fontSize="24">
            {n}
          </text>
          <path d="M0 139V177" stroke="#68717d" strokeWidth="4" />
        </g>
      ))}
      <path d="M830 58 V191" stroke="#17263c" strokeWidth="6" />
      <rect x="830" y="58" width="55" height="45" fill="url(#cr-flag)" />
      <g
        className="cr-car-moving"
        style={{
          transform: `translate(${bump === 6 ? 790 : 80 + (bump - 1) * 135}px,166px)`,
        }}
      >
        <path
          d="M0 25 L12 7 H48 L66 25 H78 V44 H-7V28Z"
          fill="#ef4444"
          stroke="#9f1239"
          strokeWidth="3"
        />
        <path d="M18 11H43L55 25H8Z" fill="#b8e3f7" />
        <circle cx="10" cy="44" r="12" fill="#182431" />
        <circle cx="60" cy="44" r="12" fill="#182431" />
        <circle cx="10" cy="44" r="5" fill="#a3b7c7" />
        <circle cx="60" cy="44" r="5" fill="#a3b7c7" />
      </g>
    </svg>
  );
}
function Confetti() {
  return (
    <div className="cr-confetti" aria-hidden="true">
      {Array.from({ length: 24 }, (_, i) => (
        <i
          key={i}
          style={{
            left: ((i * 37) % 100) + "%",
            background: ["#a78bfa", "#34d399", "#fbbf24", "#60a5fa", "#fb7185"][
              i % 5
            ],
            animationDelay: -(i * 0.13) + "s",
            transform: `rotate(${i * 31}deg)`,
          }}
        />
      ))}
    </div>
  );
}
