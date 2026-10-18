import { useEffect, useState, type RefObject } from "react";
import { Maximize, Minimize } from "lucide-react";

/** Shared shortcuts intentionally ignore forms, dialogs, and modified key presses. */
export function useExamShortcuts({
  enabled,
  choose,
  previous,
  next,
  flag,
  scratch,
}: {
  enabled: boolean;
  choose: (index: number) => void;
  previous: () => void;
  next: () => void;
  flag: () => void;
  scratch: () => void;
}) {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !enabled ||
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"],canvas',
        ) ||
        document.querySelector('[role="dialog"][data-state="open"]')
      )
        return;
      const option =
        ["1", "2", "3", "4"].indexOf(event.key) >= 0
          ? Number(event.key) - 1
          : ["أ", "ب", "ج", "د"].indexOf(event.key);
      if (option >= 0) {
        event.preventDefault();
        choose(option);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        previous();
      } else if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        flag();
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        scratch();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [enabled, choose, previous, next, flag, scratch]);
}
export function ExamZenMode({
  target,
  enabled = true,
}: {
  target: RefObject<HTMLElement | null>;
  enabled?: boolean;
}) {
  const [zen, setZen] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (!enabled) {
      setZen(false);
      if (document.fullscreenElement === document.documentElement)
        void document.exitFullscreen?.().catch(() => {});
    }
  }, [enabled]);
  useEffect(() => {
    document.body.classList.toggle("ws-exam-zen", zen);
    return () => document.body.classList.remove("ws-exam-zen");
  }, [zen]);
  useEffect(() => {
    const exit = () => {
      if (!document.fullscreenElement) setZen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZen(false);
    };
    document.addEventListener("fullscreenchange", exit);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("fullscreenchange", exit);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(
    () => () => {
      if (document.fullscreenElement === document.documentElement)
        void document.exitFullscreen?.().catch(() => {});
    },
    [],
  );
  async function toggle() {
    setMessage("");
    if (zen) {
      setZen(false);
      if (document.fullscreenElement)
        await document.exitFullscreen?.().catch(() => {});
      return;
    }
    setZen(true);
    try {
      if (target.current && document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen();
      else
        setMessage(
          "وضع التركيز مفعّل داخل الصفحة؛ ملء الشاشة غير متاح في هذا المتصفح.",
        );
    } catch {
      setMessage("وضع التركيز مفعّل داخل الصفحة؛ تعذر تشغيل ملء الشاشة.");
    }
  }
  return enabled ? (
    <div className="ws-exam-tools">
      <button
        className="edu-button secondary"
        aria-pressed={zen}
        onClick={() => void toggle()}
      >
        {zen ? <Minimize size={17} /> : <Maximize size={17} />}{" "}
        {zen ? "الخروج من وضع التركيز" : "وضع التركيز الكامل (ملء الشاشة)"}
      </button>
      <small>
        1–4 أو أ–د: إجابة · ← التالي · → السابق · M مراجعة · S مسودة · Esc خروج
      </small>
      {message && <p role="status">{message}</p>}
    </div>
  ) : null;
}
export function QuestionMapFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="edu-tabs" role="group" aria-label="تصفية خريطة الأسئلة">
      {[
        ["all", "الكل"],
        ["unanswered", "غير مجاب"],
        ["flagged", "معلّم للمراجعة"],
      ].map(([id, label]) => (
        <button
          key={id}
          className="edu-button secondary"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
