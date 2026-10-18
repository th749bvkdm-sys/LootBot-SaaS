import { z } from "zod";
import { useMemo, useSyncExternalStore } from "react";
export const classroomModes = [
  "idle",
  "hot-seat",
  "car-race",
  "ladder-race",
  "wheel",
  "team-quiz",
  "voting",
  "what-to-do",
  "quiet-meter",
  "timer",
  "honor-board",
] as const;
export type ClassroomToolMode = (typeof classroomModes)[number];
export type ProjectorHeaderInfo = {
  dayName: string;
  dateFormatted: string;
  periodLabel: string;
  className: string;
  subjectName: string;
  schoolName: string;
  logoAssetId: string | null;
};
export type PublicGameQuestion = {
  id: string;
  text: string;
  options: string[];
  revealedAnswer: boolean;
  correctIndex?: number;
};
export type ClassroomLiveState = {
  schemaVersion: 1;
  mode: ClassroomToolMode;
  updatedAt: number;
  roundId: string;
  header: ProjectorHeaderInfo;
  celebration: { active: boolean; title: string; subtitle?: string } | null;
  hotSeat: {
    roundId: string;
    status: "setup" | "playing" | "finished";
    studentId: string | null;
    studentName: string;
    durationSec: number;
    remainingSec: number;
    deadline: number | null;
    currentWord: {
      id?: string;
      word: string;
      subject: string;
      unit: string;
    } | null;
    guessedWords: string[];
    skippedCount: number;
  };
  carRace: {
    roundId: string;
    status: "setup" | "playing" | "won";
    currentBump: number;
    completedBumps: number[];
    lastOutcome: "correct" | "wrong" | null;
    currentQuestion: PublicGameQuestion | null;
  };
  ladderRace: {
    roundId: string;
    status: "setup" | "playing" | "won";
    maxSteps: number;
    player1: { id: string | null; name: string; step: number; color: "blue" };
    player2: { id: string | null; name: string; step: number; color: "green" };
    winnerName: string | null;
    currentQuestion: PublicGameQuestion | null;
  };
  voting: {
    topic: string;
    question: string;
    namedMode: boolean;
    showResults: boolean;
    options: { id: string; label: string; color: string }[];
    currentStudentIndex: number;
    roster: { id: string; name: string }[];
    votes: Record<string, { optionId: string; studentName: string }>;
    anonymousCounts: Record<string, number>;
  };
  whatToDo: {
    items: {
      id: string;
      kind: string;
      title: string;
      subtitle: string;
      active: boolean;
      completed: boolean;
    }[];
    focusedItemId: string | null;
  };
  quietMeter: {
    running: boolean;
    noiseLevel: number;
    goalSeconds: number;
    quietElapsedSeconds: number;
    goalAchieved: boolean;
    source: "manual" | "microphone";
    threshold: number;
    lastSampleAt: number;
  };
  timer: {
    running: boolean;
    totalSeconds: number;
    remainingSeconds: number;
    warnAtOneMinute: boolean;
    deadline: number | null;
  };
  honorBoard: {
    streakDays: number;
    classPoints: number;
    scores: Record<string, { studentName: string; points: number }>;
  };
  wheel: {
    spinning: boolean;
    selectedId: string | null;
    selectedName: string;
    rotation: number;
  };
  teamQuiz: {
    scores: [number, number];
    names: [string, string];
    target: number;
    currentQuestion: PublicGameQuestion | null;
    winner: string | null;
  };
};
export function initialClassroomState(): ClassroomLiveState {
  return {
    schemaVersion: 1,
    mode: "idle",
    updatedAt: 0,
    roundId: "",
    header: {
      dayName: "",
      dateFormatted: "",
      periodLabel: "الحصة الأولى",
      className: "",
      subjectName: "",
      schoolName: "",
      logoAssetId: null,
    },
    celebration: null,
    hotSeat: {
      roundId: "",
      status: "setup",
      studentId: null,
      studentName: "",
      durationSec: 60,
      remainingSec: 60,
      deadline: null,
      currentWord: null,
      guessedWords: [],
      skippedCount: 0,
    },
    carRace: {
      roundId: "",
      status: "setup",
      currentBump: 1,
      completedBumps: [],
      lastOutcome: null,
      currentQuestion: null,
    },
    ladderRace: {
      roundId: "",
      status: "setup",
      maxSteps: 5,
      player1: { id: null, name: "الطالب الأول", step: 0, color: "blue" },
      player2: { id: null, name: "الطالب الثاني", step: 0, color: "green" },
      winnerName: null,
      currentQuestion: null,
    },
    voting: {
      topic: "أيام الأسبوع",
      question: "ما اليوم المناسب للاختبار؟",
      namedMode: true,
      showResults: false,
      options: ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس"].map(
        (label, i) => ({
          id: String(i),
          label,
          color: ["#34d399", "#22d3ee", "#fb923c", "#60a5fa", "#c084fc"][i],
        }),
      ),
      currentStudentIndex: 0,
      roster: [],
      votes: {},
      anonymousCounts: {},
    },
    whatToDo: { items: [], focusedItemId: null },
    quietMeter: {
      running: false,
      noiseLevel: 0,
      goalSeconds: 180,
      quietElapsedSeconds: 0,
      goalAchieved: false,
      source: "manual",
      threshold: 45,
      lastSampleAt: 0,
    },
    timer: {
      running: false,
      totalSeconds: 120,
      remainingSeconds: 120,
      warnAtOneMinute: true,
      deadline: null,
    },
    honorBoard: { streakDays: 0, classPoints: 0, scores: {} },
    wheel: { spinning: false, selectedId: null, selectedName: "", rotation: 0 },
    teamQuiz: {
      scores: [0, 0],
      names: ["الفريق الأزرق", "الفريق الأخضر"],
      target: 5,
      currentQuestion: null,
      winner: null,
    },
  };
}
const text = z.string().max(20000),
  name = z.string().max(500),
  finite = z.number().finite(),
  nonnegative = finite.min(0),
  deadline = nonnegative.nullable();
const questionSchema = z
  .object({
    id: name,
    text,
    options: z.array(text).min(2).max(12),
    revealedAnswer: z.boolean(),
    correctIndex: z.number().int().min(0).max(11).optional(),
  })
  .nullable();
const player = <T extends "blue" | "green">(color: T) =>
  z.object({
    id: name.nullable(),
    name,
    step: z.number().int().min(0).max(5),
    color: z.literal(color),
  });
const stateSchema: z.ZodType<ClassroomLiveState> = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(classroomModes),
  updatedAt: nonnegative,
  roundId: name,
  header: z.object({
    dayName: name,
    dateFormatted: name,
    periodLabel: name,
    className: name,
    subjectName: name,
    schoolName: name,
    logoAssetId: name.nullable(),
  }),
  celebration: z
    .object({ active: z.boolean(), title: name, subtitle: name.optional() })
    .nullable(),
  hotSeat: z.object({
    roundId: name,
    status: z.enum(["setup", "playing", "finished"]),
    studentId: name.nullable(),
    studentName: name,
    durationSec: z.union([
      z.literal(0),
      z.literal(30),
      z.literal(60),
      z.literal(90),
    ]),
    remainingSec: nonnegative.max(90),
    deadline,
    currentWord: z
      .object({ id: name.optional(), word: name, subject: name, unit: name })
      .nullable(),
    guessedWords: z.array(name).max(500),
    skippedCount: nonnegative,
  }),
  carRace: z.object({
    roundId: name,
    status: z.enum(["setup", "playing", "won"]),
    currentBump: z.number().int().min(1).max(6),
    completedBumps: z.array(z.number().int().min(1).max(5)).max(5),
    lastOutcome: z.enum(["correct", "wrong"]).nullable(),
    currentQuestion: questionSchema,
  }),
  ladderRace: z.object({
    roundId: name,
    status: z.enum(["setup", "playing", "won"]),
    maxSteps: z.literal(5),
    player1: player("blue"),
    player2: player("green"),
    winnerName: name.nullable(),
    currentQuestion: questionSchema,
  }),
  voting: z.object({
    topic: name,
    question: name,
    namedMode: z.boolean(),
    showResults: z.boolean(),
    options: z
      .array(
        z.object({
          id: name,
          label: name,
          color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
        }),
      )
      .max(12),
    currentStudentIndex: z.number().int().min(0),
    roster: z.array(z.object({ id: name, name })).max(1000),
    votes: z.record(
      z.string(),
      z.object({ optionId: name, studentName: name }),
    ),
    anonymousCounts: z.record(z.string(), nonnegative),
  }),
  whatToDo: z.object({
    items: z
      .array(
        z.object({
          id: name,
          kind: name,
          title: name,
          subtitle: name,
          active: z.boolean(),
          completed: z.boolean(),
        }),
      )
      .max(100),
    focusedItemId: name.nullable(),
  }),
  quietMeter: z.object({
    running: z.boolean(),
    noiseLevel: nonnegative.max(100),
    goalSeconds: nonnegative.max(600),
    quietElapsedSeconds: nonnegative.max(600),
    goalAchieved: z.boolean(),
    source: z.enum(["manual", "microphone"]),
    threshold: nonnegative.max(100),
    lastSampleAt: nonnegative,
  }),
  timer: z.object({
    running: z.boolean(),
    totalSeconds: nonnegative,
    remainingSeconds: nonnegative,
    warnAtOneMinute: z.boolean(),
    deadline,
  }),
  honorBoard: z.object({
    streakDays: nonnegative,
    classPoints: nonnegative,
    scores: z.record(
      z.string(),
      z.object({ studentName: name, points: nonnegative }),
    ),
  }),
  wheel: z.object({
    spinning: z.boolean(),
    selectedId: name.nullable(),
    selectedName: name,
    rotation: finite,
  }),
  teamQuiz: z.object({
    scores: z.tuple([nonnegative, nonnegative]),
    names: z.tuple([name, name]),
    target: nonnegative,
    currentQuestion: questionSchema,
    winner: name.nullable(),
  }),
});
/** Strict public projection: unknown fields, private hints and unrevealed keys never leave the controller. */
export function publicClassroomState(
  value: ClassroomLiveState,
): ClassroomLiveState {
  const s = stateSchema.parse(value);
  for (const q of [
    s.carRace.currentQuestion,
    s.ladderRace.currentQuestion,
    s.teamQuiz.currentQuestion,
  ])
    if (q && !q.revealedAnswer) delete q.correctIndex;
  return s;
}
export function classroomRemaining(
  deadline: number | null,
  stored: number,
  now = Date.now(),
) {
  return deadline === null
    ? stored
    : Math.max(0, Math.ceil((deadline - now) / 1000));
}
export function carRaceMove(bump: number, correct: boolean) {
  return Math.min(6, Math.max(1, bump + (correct ? 1 : -1)));
}
export function ladderMove(step: number, delta: number, max = 5) {
  return Math.max(0, Math.min(max, step + delta));
}
export function classroomWheelRoster<T extends { id: string; name: string }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) => a.name.localeCompare(b.name, "ar") || a.id.localeCompare(b.id),
  );
}
/** Labels start at twelve o'clock; land the selected label under that pointer. */
export function wheelSpinRotation(
  previous: number,
  index: number,
  count: number,
) {
  const size = Math.max(1, Math.floor(count)),
    position = ((Math.floor(index) % size) + size) % size;
  return (
    Math.ceil(Math.max(0, previous) / 360) * 360 +
    1080 +
    ((360 - (position * 360) / size) % 360)
  );
}
export function validClassroomState(
  value: unknown,
): value is ClassroomLiveState {
  return stateSchema.safeParse(value).success;
}
type Update = (draft: ClassroomLiveState) => void | false;
const stores = new Map<string, ReturnType<typeof makeStore>>();
function makeStore(ownerId: string, classId: string) {
  const scope = ownerId + ":" + classId,
    key = "lootbot_classroom_live_state:" + scope,
    channelName = "lootbot_classroom_projector_v1:" + scope;
  let state = initialClassroomState(),
    channel: BroadcastChannel | null = null;
  const listeners = new Set<() => void>();
  let started = false,
    storageWarning = false;
  const emit = () => listeners.forEach((fn) => fn());
  const receive = (v: unknown) => {
    if (validClassroomState(v) && v.updatedAt > state.updatedAt) {
      state = publicClassroomState(v);
      emit();
    }
  };
  const storage = (e: StorageEvent) => {
    if (e.key === key && e.newValue) {
      try {
        receive(JSON.parse(e.newValue));
      } catch {
        /* Ignore invalid browser storage. */
      }
    }
  };
  function start() {
    if (started || !ownerId || !classId) return;
    started = true;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (validClassroomState(saved) && Date.now() - saved.updatedAt < 86400000)
        state = publicClassroomState(saved);
    } catch {
      storageWarning = true;
    }
    window.addEventListener("storage", storage);
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(channelName);
      channel.onmessage = (e) => {
        if (e.data?.type === "request")
          channel?.postMessage({ type: "state", value: state });
        else if (e.data?.type === "state") receive(e.data.value);
      };
      channel.postMessage({ type: "request" });
    }
  }
  function stop() {
    window.removeEventListener("storage", storage);
    channel?.close();
    channel = null;
    started = false;
  }
  return {
    get: () => state,
    subscribe: (fn: () => void) => {
      start();
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
        if (!listeners.size) stop();
      };
    },
    update: (fn: Update) => {
      const next = structuredClone(state);
      if (fn(next) === false) return;
      next.updatedAt = Math.max(Date.now(), state.updatedAt + 1);
      state = publicClassroomState(next);
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {
        storageWarning = true;
      }
      channel?.postMessage({ type: "state", value: state });
      emit();
    },
    warning: () => storageWarning,
  };
}
export function useClassroomProjectorSync(ownerId: string, classId: string) {
  const store = useMemo(() => {
    const key = ownerId + ":" + classId;
    if (!stores.has(key)) stores.set(key, makeStore(ownerId, classId));
    return stores.get(key)!;
  }, [ownerId, classId]);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  return { state, update: store.update, storageUnavailable: store.warning() };
}
