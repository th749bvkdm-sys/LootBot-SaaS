import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import {
  teacherApi,
  TeacherApiError,
  uploadTeacherAsset,
  type TeacherClass,
  type TeacherProfile,
} from "../lib/teacher-api";
import {
  newLessonStep,
  lessonErrors,
  attemptOutcome,
  type StepLesson,
  type StepLessonContent,
  type LessonStep,
  type ActivityAssignment,
  type StudentStep,
} from "../lib/step-lesson-model";
import { learningCopy as c } from "../lib/learning-copy";
import { teacherExtraCopy as extra } from "../lib/teacher-extra-copy";
import "./teacher-learning.css";
import {
  ChemistryWorkbench,
  type Simulation,
  type ChemistryResult,
} from "./chemistry-lab";
import {useActiveTeacherClass} from "./teacher-navigation-shell";
const base = "/teacher/learning";
function containTab(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab") return;
  const items = [
    ...e.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
    ),
  ].filter((el) => el.offsetParent !== null);
  const first = items[0],
    last = items.at(-1);
  if (!first) {
    e.preventDefault();
    return;
  }
  if (
    e.shiftKey &&
    (document.activeElement === first ||
      document.activeElement === e.currentTarget)
  ) {
    e.preventDefault();
    last?.focus();
  } else if (
    !e.shiftKey &&
    (document.activeElement === last ||
      document.activeElement === e.currentTarget)
  ) {
    e.preventDefault();
    first.focus();
  }
}
function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="tl-error">
      {error instanceof Error ? error.message : String(error)}
    </p>
  ) : null;
}
function Field({
  label,
  value,
  onChange,
  large = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  large?: boolean;
}) {
  return (
    <label className="tl-field">
      {label}
      {large ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
export function TeacherLearning() {
  const qc = useQueryClient();
  const lessons = useQuery({
    queryKey: ["step-lessons"],
    queryFn: () => teacherApi<StepLesson[]>(base + "/activities"),
  });
  const classes = useQuery({
    queryKey: ["teacher", "classes"],
    queryFn: () => teacherApi<TeacherClass[]>("/teacher/classes"),
  });
  const profile = useQuery({
    queryKey: ["teacher", "profile"],
    queryFn: () => teacherApi<TeacherProfile>("/teacher/profile"),
  });
  const assignments = useQuery({
    queryKey: ["learning-assignments"],
    queryFn: () => teacherApi<ActivityAssignment[]>(base + "/assignments"),
  });
  const [draft, setDraft] = useState<StepLesson | null>(null),
    [tab, setTab] = useState("editor"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [saved, setSaved] = useState(false),
    [preview, setPreview] = useState(false),
    [present, setPresent] = useState(false),
    [resultId, setResultId] = useState(""),
    [classId, setClassId] = useActiveTeacherClass();
  const bank = useQuery({
    queryKey: ["question-versions"],
    queryFn: () =>
      teacherApi<
        {
          id: string;
          content: {
            text: string;
            options: string[];
            answer: string;
            kind: string;
          };
        }[]
      >(base + "/question-versions"),
  });
  function patch(p: Partial<StepLessonContent>) {
    if (draft) setDraft({ ...draft, ...p });
    setSaved(false);
  }
  function updateStep(index: number, p: Partial<LessonStep>) {
    if (draft)
      patch({
        steps: draft.steps.map((s, i) => (i === index ? { ...s, ...p } : s)),
      });
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft) return;
    const { id, revision, ...content } = draft;
    const value = id
      ? await teacherApi<StepLesson>(base + "/activities/" + id, "PUT", {
          revision,
          content,
        })
      : await teacherApi<StepLesson>(base + "/activities", "POST", content);
    setDraft(value);
    setSaved(true);
    await qc.invalidateQueries({ queryKey: ["step-lessons"] });
    return value;
  }
  function create() {
    setDraft({
      id: "",
      revision: 1,
      status: "draft",
      currentVersionId: null,
      title: "",
      subject: profile.data?.subjects[0] || "",
      grade: profile.data?.stage || "",
      objective: "",
      description: "",
      steps: [newLessonStep()],
    });
    setSaved(false);
    setError(null);
  }
  const chosenClass =
    classId || classes.data?.find((cl) => !cl.archived)?.id || "";
  return (
    <section className="tl" dir="rtl">
      <div className="tl-toolbar">
        <button
          onClick={() => setTab("editor")}
          aria-pressed={tab === "editor"}
        >
          {c.title}
        </button>
        <button
          onClick={() => setTab("access")}
          aria-pressed={tab === "access"}
        >
          {c.access}
        </button>
        <button
          onClick={() => setTab("results")}
          aria-pressed={tab === "results"}
        >
          {c.results}
        </button>
        <Link href="/learn">{c.entry}</Link>
      </div>
      <ErrorMessage
        error={error || lessons.error || classes.error || assignments.error}
      />
      {tab === "access" ? (
        <>
          <label className="tl-field">
            {c.class}
            <select
              value={chosenClass}
              onChange={(e) => setClassId(e.target.value)}
            >
              <option value="">{c.class}</option>
              {classes.data
                ?.filter((cl) => !cl.archived)
                .map((cl) => (
                  <option key={cl.id} value={cl.id}>
                    {cl.name}
                  </option>
                ))}
            </select>
          </label>
          {chosenClass && (
            <StudentAccess key={chosenClass} classId={chosenClass} />
          )}
        </>
      ) : tab === "results" ? (
        <>
          <div className="tl-cards">
            {assignments.data?.map((a) => (
              <article key={a.id}>
                <h3>{a.title}</h3>
                <p>
                  {a.className} · {a.mode === "learn" ? c.learn : c.assessed}
                </p>
                <p>
                  {a.completed} / {a.started}
                </p>
                <button onClick={() => setResultId(a.id)}>{c.results}</button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await teacherApi(base + "/assignments/" + a.id, "PATCH", {
                        archived: !a.archived,
                      });
                      await qc.invalidateQueries({
                        queryKey: ["learning-assignments"],
                      });
                    })
                  }
                >
                  {a.archived ? "استعادة الإسناد" : "إيقاف الإسناد"}
                </button>
              </article>
            ))}
          </div>
          {resultId && <LessonResults id={resultId} />}
        </>
      ) : (
        <div className="tl-layout">
          <aside>
            <button onClick={create}>{c.newLesson}</button>
            {lessons.isLoading && <p role="status">{c.loading}</p>}
            {lessons.data?.length === 0 && <p>{c.noLessons}</p>}
            {lessons.data?.map((l) => (
              <button
                key={l.id}
                aria-pressed={draft?.id === l.id}
                onClick={() => {
                  if (
                    draft &&
                    !saved &&
                    draft.id !== l.id &&
                    !confirm("ترك التعديلات غير المحفوظة؟")
                  )
                    return;
                  setDraft(structuredClone(l));
                  setSaved(true);
                }}
              >
                {l.title || c.draft}
                <small>
                  {l.status === "published" ? c.published : c.draft}
                </small>
              </button>
            ))}
          </aside>
          <div>
            {!draft ? (
              <p>{c.chooseLesson}</p>
            ) : (
              <>
                <div className="tl-toolbar">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await save();
                      })
                    }
                  >
                    {busy ? c.loading : c.save}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const errors = lessonErrors(draft);
                        if (errors.length) throw Error(errors.join("\n"));
                        if (!confirm(c.publishConfirm)) return;
                        const saved = await save();
                        if (saved) {
                          const published = await teacherApi<StepLesson>(
                            base + "/activities/" + saved.id + "/publish",
                            "POST",
                            { revision: saved.revision },
                          );
                          setDraft(published);
                          setSaved(true);
                          await qc.invalidateQueries({
                            queryKey: ["step-lessons"],
                          });
                        }
                      })
                    }
                  >
                    {c.publish}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const copy = await teacherApi<StepLesson>(
                          base + "/activities",
                          "POST",
                          {
                            ...draft,
                            title: draft.title + " — نسخة",
                            steps: draft.steps.map((s) => ({
                              ...s,
                              id: crypto.randomUUID(),
                              options: s.options.map((o) => ({
                                ...o,
                                id: crypto.randomUUID(),
                              })),
                            })),
                          },
                        );
                        setDraft(copy);
                        setSaved(true);
                        await qc.invalidateQueries({
                          queryKey: ["step-lessons"],
                        });
                      })
                    }
                  >
                    {c.duplicate}
                  </button>
                  <button onClick={() => setPreview(true)}>{c.preview}</button>
                  <button onClick={() => setPresent(true)}>{c.present}</button>
                </div>
                {saved && <p role="status">{c.saved}</p>}
                <p>{c.readonly}</p>
                <div className="tl-grid">
                  <Field
                    label={c.titleField}
                    value={draft.title}
                    onChange={(v) => patch({ title: v })}
                  />
                  <Field
                    label={c.subject}
                    value={draft.subject}
                    onChange={(v) => patch({ subject: v })}
                  />
                  <Field
                    label={c.grade}
                    value={draft.grade}
                    onChange={(v) => patch({ grade: v })}
                  />
                  <Field
                    label={c.objective}
                    value={draft.objective}
                    onChange={(v) => patch({ objective: v })}
                  />
                </div>
                <Field
                  label={c.description}
                  value={draft.description}
                  onChange={(v) => patch({ description: v })}
                  large
                />
                {draft.steps.map((s, i) => (
                  <article className="tl-step-editor" key={s.id}>
                    <h3>
                      {c.stepLabel} {i + 1}
                    </h3>
                    <div className="tl-toolbar">
                      <button
                        disabled={i === 0}
                        onClick={() => {
                          const steps = [...draft.steps];
                          [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
                          patch({ steps });
                        }}
                      >
                        {c.up}
                      </button>
                      <button
                        disabled={i === draft.steps.length - 1}
                        onClick={() => {
                          const steps = [...draft.steps];
                          [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]];
                          patch({ steps });
                        }}
                      >
                        {c.down}
                      </button>
                      <button
                        onClick={() =>
                          patch({
                            steps: [
                              ...draft.steps.slice(0, i + 1),
                              {
                                ...structuredClone(s),
                                id: crypto.randomUUID(),
                                options: s.options.map((o) => ({
                                  ...o,
                                  id: crypto.randomUUID(),
                                })),
                              },
                              ...draft.steps.slice(i + 1),
                            ],
                          })
                        }
                      >
                        {c.duplicate}
                      </button>
                      <button
                        onClick={() =>
                          patch({
                            steps: draft.steps.filter((_, n) => n !== i),
                          })
                        }
                      >
                        {c.remove}
                      </button>
                    </div>
                    <Field
                      label={c.stepTitle}
                      value={s.title}
                      onChange={(v) => updateStep(i, { title: v })}
                    />
                    <Field
                      label={c.explanation}
                      value={s.explanation}
                      onChange={(v) => updateStep(i, { explanation: v })}
                      large
                    />
                    <Field
                      label={c.altExplanation}
                      value={s.altExplanation}
                      onChange={(v) => updateStep(i, { altExplanation: v })}
                      large
                    />
                    {(["imageAssetId", "altImageAssetId"] as const).map(
                      (key, k) => (
                        <label className="tl-field" key={key}>
                          {k ? c.altImage : c.image}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={busy}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file)
                                void action(async () => {
                                  const asset = await uploadTeacherAsset(file);
                                  updateStep(i, { [key]: asset.id });
                                });
                            }}
                          />
                          {s[key] && (
                            <>
                              <img
                                alt={k ? c.altImage : c.image}
                                src={"/api/teacher/assets/" + s[key]}
                              />
                              <button
                                onClick={() => updateStep(i, { [key]: null })}
                              >
                                {c.remove}
                              </button>
                            </>
                          )}
                        </label>
                      ),
                    )}
                    <label className="tl-field">
                      {c.bank}
                      <select
                        value=""
                        onChange={(e) => {
                          const v = bank.data?.find(
                            (b) => b.id === e.target.value,
                          );
                          if (!v) return;
                          updateStep(i, {
                            question: v.content.text,
                            questionVersionId: v.id,
                            options: v.content.options.map((text) => ({
                              id: crypto.randomUUID(),
                              text,
                              isCorrect: text === v.content.answer,
                            })),
                          });
                        }}
                      >
                        <option value="">{c.bank}</option>
                        {bank.data
                          ?.filter(
                            (v) =>
                              v.content.kind === "multiple-choice" &&
                              v.content.options.length >= 2 &&
                              v.content.options.filter(
                                (o) => o === v.content.answer,
                              ).length === 1,
                          )
                          .map((v) => (
                            <option value={v.id} key={v.id}>
                              {v.content.text}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Field
                      label={c.questionField}
                      value={s.question}
                      onChange={(v) =>
                        updateStep(i, { question: v, questionVersionId: null })
                      }
                      large
                    />
                    <fieldset>
                      <legend>{c.correctOption}</legend>
                      {s.options.map((o) => (
                        <div className="tl-option-edit" key={o.id}>
                          <label>
                            <input
                              type="radio"
                              name={"correct-" + s.id}
                              checked={o.isCorrect}
                              onChange={() =>
                                updateStep(i, {
                                  options: s.options.map((x) => ({
                                    ...x,
                                    isCorrect: x.id === o.id,
                                  })),
                                })
                              }
                            />
                            {c.correctOption}
                          </label>
                          <input
                            aria-label={c.optionLabel}
                            value={o.text}
                            onChange={(e) =>
                              updateStep(i, {
                                options: s.options.map((x) =>
                                  x.id === o.id
                                    ? { ...x, text: e.target.value }
                                    : x,
                                ),
                                questionVersionId: null,
                              })
                            }
                          />
                          <button
                            disabled={s.options.length <= 2}
                            onClick={() =>
                              updateStep(i, {
                                options: s.options.filter((x) => x.id !== o.id),
                                questionVersionId: null,
                              })
                            }
                          >
                            {c.remove}
                          </button>
                        </div>
                      ))}
                    </fieldset>
                    <button
                      disabled={s.options.length >= 6}
                      onClick={() =>
                        updateStep(i, {
                          options: [
                            ...s.options,
                            {
                              id: crypto.randomUUID(),
                              text: "",
                              isCorrect: false,
                            },
                          ],
                          questionVersionId: null,
                        })
                      }
                    >
                      {c.addOption}
                    </button>
                    <Field
                      label={c.hint}
                      value={s.hint}
                      onChange={(v) => updateStep(i, { hint: v })}
                    />
                    <Field
                      label={c.correctExplanation}
                      value={s.correctExplanation}
                      onChange={(v) => updateStep(i, { correctExplanation: v })}
                      large
                    />
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          if (
                            !s.question ||
                            s.options.filter((o) => o.isCorrect).length !== 1
                          )
                            throw Error("راجع السؤال والإجابة أولًا.");
                          await teacherApi("/teacher/questions", "POST", {
                            text: s.question,
                            subject: draft.subject,
                            grade: draft.grade,
                            kind: "multiple-choice",
                            options: s.options.map((o) => o.text),
                            answer: s.options.find((o) => o.isCorrect)!.text,
                            marks: 1,
                            tags: [draft.objective].filter(Boolean),
                          });
                          await qc.invalidateQueries({
                            queryKey: ["question-versions"],
                          });
                        })
                      }
                    >
                      {c.saveBank}
                    </button>
                  </article>
                ))}
                <button
                  onClick={() =>
                    patch({ steps: [...draft.steps, newLessonStep()] })
                  }
                >
                  {c.addStep}
                </button>
                {draft.currentVersionId && (
                  <AssignmentForm
                    versionId={draft.currentVersionId}
                    classes={classes.data ?? []}
                    onSaved={() =>
                      void qc.invalidateQueries({
                        queryKey: ["learning-assignments"],
                      })
                    }
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
      {preview && draft && (
        <div
          className="tl-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={c.preview}
          onKeyDown={(e) => {
            containTab(e);
            if (e.key === "Escape") setPreview(false);
          }}
        >
          <button autoFocus onClick={() => setPreview(false)}>
            {c.close}
          </button>
          <PreviewLesson content={draft} />
        </div>
      )}
      {present && draft && (
        <PresentLesson content={draft} onExit={() => setPresent(false)} />
      )}
    </section>
  );
}
function AssignmentForm({
  versionId,
  classes,
  onSaved,
}: {
  versionId: string;
  classes: TeacherClass[];
  onSaved: () => void;
}) {
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirm(c.assignConfirm)) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await teacherApi(base + "/assignments", "POST", {
        versionId,
        classId: fd.get("classId"),
        mode: fd.get("mode"),
        allowedAttempts: Number(fd.get("attempts")),
        hints: fd.has("hints"),
        explanations: fd.get("explanations"),
        dueAt: fd.get("dueAt")
          ? new Date(String(fd.get("dueAt"))).toISOString()
          : null,
      });
      setSuccess(true);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="tl-step-editor" onSubmit={(e) => void submit(e)}>
      <h3>{c.assign}</h3>
      <label className="tl-field">
        {c.class}
        <select required name="classId">
          {classes
            .filter((cl) => !cl.archived)
            .map((cl) => (
              <option key={cl.id} value={cl.id}>
                {cl.name}
              </option>
            ))}
        </select>
      </label>
      <label className="tl-field">
        {c.mode}
        <select name="mode">
          <option value="learn">{c.learn}</option>
          <option value="assessed">{c.assessed}</option>
        </select>
      </label>
      <label className="tl-field">
        {c.attempts}
        <input
          type="number"
          name="attempts"
          defaultValue={3}
          min={1}
          max={10}
          required
        />
      </label>
      <label>
        <input type="checkbox" name="hints" defaultChecked />
        {c.hints}
      </label>
      <label className="tl-field">
        {c.due}
        <input type="datetime-local" name="dueAt" />
      </label>
      <label className="tl-field">
        {c.correctExplanation}
        <select name="explanations">
          <option value="immediate">{c.immediate}</option>
          <option value="after">{c.after}</option>
        </select>
      </label>
      <ErrorMessage error={error} />
      {success && <p role="status">{c.saved}</p>}
      <button disabled={busy || !classes.length}>
        {busy ? c.loading : c.assign}
      </button>
    </form>
  );
}
function StudentAccess({ classId }: { classId: string }) {
  const q = useQuery({
    queryKey: ["student-access", classId],
    queryFn: () =>
      teacherApi<{
        classEnabled: boolean;
        students: { id: string; name: string; enabled: boolean }[];
      }>(base + "/access/" + classId),
  });
  const [codes, setCodes] = useState<Record<string, string>>({}),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  async function generate(studentId?: string, enabled = true) {
    if (
      !confirm(
        studentId
          ? enabled
            ? "تجديد رمز الطالب وإنهاء جلساته السابقة؟"
            : c.confirmRevoke
          : c.accessWarning,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const value = await teacherApi<{ code: string | null }>(
        base + "/access/" + (studentId ? "student" : "class"),
        "POST",
        { classId, studentId, enabled },
      );
      setCodes((old) => ({
        ...old,
        [studentId || "class"]: value.code || "أُلغي",
      }));
      await q.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="tl-access">
      <h2>{c.credentials}</h2>
      <p>{c.copyCodes}</p>
      <Link href="/learn">{c.entry}</Link>
      <button disabled={busy} onClick={() => void generate()}>
        {c.classGenerate}
      </button>
      <button
        disabled={busy || !q.data?.classEnabled}
        onClick={() => void generate(undefined, false)}
      >
        {c.revoke}
      </button>
      {codes.class && (
        <p>
          {c.classCode}: <bdi>{codes.class}</bdi>
        </p>
      )}
      <ErrorMessage error={error || q.error} />
      {q.isLoading && <p>{c.loading}</p>}
      <div className="tl-cards">
        {q.data?.students.map((s) => (
          <article key={s.id}>
            <h3>{s.name}</h3>
            <p>{s.enabled ? "دخول مفعّل" : "دخول غير مفعّل"}</p>
            <button disabled={busy} onClick={() => void generate(s.id)}>
              {c.regenerate}
            </button>
            <button
              disabled={busy || !s.enabled}
              onClick={() => void generate(s.id, false)}
            >
              {c.revoke}
            </button>
            {codes[s.id] && (
              <p>
                {c.studentCode}: <bdi>{codes[s.id]}</bdi>
              </p>
            )}
          </article>
        ))}
      </div>
      {Object.keys(codes).length > 0 && (
        <button onClick={() => window.print()}>{c.print}</button>
      )}
    </article>
  );
}
interface Results {
  classId: string;
  objective: string;
  checks: {
    id: string;
    title: string;
    createdAt: string;
    started: number;
    completed: number;
    attempts: number;
    correct: number;
    firstTryRate: number | null;
  }[];
  simulation?: {
    runs: number;
    students: number;
    predictionsMatching: number;
    balanced: number;
  };
  title: string;
  mode: string;
  started: number;
  completed: number;
  steps: {
    stepId: string;
    title: string;
    reached: number;
    firstTryRate: number | null;
    averageAttempts: number;
    helpStudents: number;
    difficult: boolean;
    options: { id: string; text: string; count: number; students: number }[];
  }[];
  students: {
    id: string;
    name: string;
    completed: boolean;
    supportSteps: number;
  }[];
}
function LessonResults({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["lesson-results", id],
    queryFn: () => teacherApi<Results>(base + "/results/" + id),
  });
  if (q.isLoading) return <p role="status">{c.loading}</p>;
  if (q.error)
    return (
      <>
        <ErrorMessage error={q.error} />
        <button onClick={() => void q.refetch()}>{c.retry}</button>
      </>
    );
  if (!q.data) return null;
  const r = q.data;
  return (
    <article>
      <h2>{r.title}</h2>
      <p>
        بدأوا: {r.started} · أكملوا: {r.completed}
      </p>
      {r.mode === "learn" && <p>{c.noScore}</p>}
      {r.checks.length > 1 && (
        <section>
          <h3>{extra.laterChecks}</h3>
          <p>{extra.laterChecksHint}</p>
          <div className="tl-table">
            <table>
              <thead>
                <tr>
                  <th>{c.title}</th>
                  <th>{extra.checkDate}</th>
                  <th>{extra.checkCompletion}</th>
                  <th>{extra.checkEvidence}</th>
                  <th>{c.firstTry}</th>
                </tr>
              </thead>
              <tbody>
                {r.checks.map((check) => (
                  <tr key={check.id}>
                    <th>{check.title}</th>
                    <td>
                      {new Date(check.createdAt).toLocaleDateString("ar-SA", {
                        calendar: "gregory",
                      })}
                    </td>
                    <td>
                      {check.completed} / {check.started}
                    </td>
                    <td>
                      {check.correct} / {check.attempts}
                    </td>
                    <td>
                      {check.firstTryRate === null
                        ? "—"
                        : Math.round(check.firstTryRate * 100) + "%"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {r.simulation && (
        <section>
          <h3>{extra.simulationReport}</h3>
          <p>
            {extra.simulationRuns}: {r.simulation.runs} ·{" "}
            {extra.simulationStudents}: {r.simulation.students}
          </p>
          <p>
            {extra.matchingPredictions}: {r.simulation.predictionsMatching} ·{" "}
            {extra.balancedRuns}: {r.simulation.balanced}
          </p>
        </section>
      )}
      {!r.started ? (
        <p>{c.noResults}</p>
      ) : (
        <>
          <div className="tl-table">
            <table>
              <thead>
                <tr>
                  <th>{c.stepLabel}</th>
                  <th>{c.reached}</th>
                  <th>{c.firstTry}</th>
                  <th>{c.average}</th>
                  <th>{c.helpCount}</th>
                  <th>{c.status}</th>
                </tr>
              </thead>
              <tbody>
                {r.steps.map((s) => (
                  <tr key={s.stepId}>
                    <th>
                      {s.title}
                      <details>
                        <summary>توزيع الاختيارات</summary>
                        {s.options.map((o) => (
                          <p key={o.id}>
                            {o.text}: {o.students} طالبًا · {o.count} محاولة
                          </p>
                        ))}
                      </details>
                    </th>
                    <td>{s.reached}</td>
                    <td>
                      {s.firstTryRate === null
                        ? "—"
                        : Math.round(s.firstTryRate * 100) + "%"}
                    </td>
                    <td>{s.averageAttempts.toFixed(2)}</td>
                    <td>{s.helpStudents}</td>
                    <td>{s.difficult ? "⚠ " + c.difficult : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>{extra.attemptHistory}</p>
          {r.steps.some((s) => s.difficult) && <p>{c.support}</p>}
          <ResultFollowup results={r} />
          <ul>
            {r.students.map((s) => (
              <li key={s.id}>
                {s.name} · {s.completed ? "مكتمل" : "قيد التعلم"} ·{" "}
                {c.helpCount}: {s.supportSteps}
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
function ResultFollowup({ results: r }: { results: Results }) {
  const struggling = r.steps.filter(
    (s) =>
      s.helpStudents > 0 || (s.firstTryRate !== null && s.firstTryRate < 0.5),
  );
  const [body, setBody] = useState(() =>
      struggling
        .map(
          (s) =>
            s.title +
            ": " +
            s.helpStudents +
            " طلبوا توضيحًا، والصحة من أول محاولة " +
            (s.firstTryRate === null
              ? "غير متاحة"
              : Math.round(s.firstTryRate * 100) + "%") +
            ". راجع الشرح البديل ثم تحقق بسؤال قصير.",
        )
        .join("\n"),
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  if (!struggling.length) return null;
  return (
    <section>
      <h3>{extra.followup}</h3>
      <p>{extra.review}</p>
      <Field label={extra.followupBody} value={body} onChange={setBody} large />
      <button
        disabled={!body.trim() || busy}
        onClick={() => {
          if (!confirm(extra.review)) return;
          setBusy(true);
          void teacherApi("/teacher/tasks", "POST", {
            title: "متابعة — " + r.title,
            classId: r.classId,
            kind: "task",
            notes: body,
            status: "pending",
            studentCompletion: [],
          })
            .then(() => setMessage(extra.saved))
            .catch((e) => setMessage(e.message))
            .finally(() => setBusy(false));
        }}
      >
        {extra.saveFollowup}
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
function PreviewLesson({ content }: { content: StepLessonContent }) {
  const [index, setIndex] = useState(0),
    [selected, setSelected] = useState(""),
    [number, setNumber] = useState(0),
    [feedback, setFeedback] = useState<ReturnType<
      typeof attemptOutcome
    > | null>(null),
    [help, setHelp] = useState(false);
  const s = content.steps[index];
  if (!s) return <p>{c.noLessons}</p>;
  const move = (next: number) => {
    setIndex(next);
    setSelected("");
    setNumber(0);
    setFeedback(null);
    setHelp(false);
  };
  return (
    <div className="tl-player">
      <p>{c.noRecording}</p>
      <p>
        {c.stepLabel} {index + 1} / {content.steps.length}
      </p>
      <h2>{s.title}</h2>
      <p>{s.explanation}</p>
      {s.imageAssetId && (
        <img alt={c.image} src={"/api/teacher/assets/" + s.imageAssetId} />
      )}
      <h3>{s.question}</h3>
      <div className="tl-options">
        {s.options.map((o) => (
          <button
            key={o.id}
            aria-pressed={selected === o.id}
            onClick={() => setSelected(o.id)}
            disabled={Boolean(feedback?.canAdvance)}
          >
            {o.text}
          </button>
        ))}
      </div>
      <button
        disabled={!selected || Boolean(feedback?.canAdvance)}
        onClick={() => {
          setNumber(number + 1);
          setFeedback(
            attemptOutcome(
              Boolean(s.options.find((o) => o.id === selected)?.isCorrect),
              number + 1,
              "assessed",
              3,
            ),
          );
        }}
      >
        {c.check}
      </button>
      <button onClick={() => setHelp(true)}>{c.help}</button>
      {help && (
        <p className="tl-support">{s.altExplanation || c.helpMissing}</p>
      )}
      {feedback && (
        <p role="status">
          {feedback.correct
            ? c.correct
            : feedback.exhausted
              ? c.exhausted
              : c.wrong}
          {feedback.canAdvance ? " " + s.correctExplanation : " " + s.hint}
        </p>
      )}
      <div className="tl-toolbar">
        <button disabled={!index} onClick={() => move(index - 1)}>
          {c.previous}
        </button>
        <button
          disabled={!feedback?.canAdvance || index === content.steps.length - 1}
          onClick={() => move(index + 1)}
        >
          {c.next}
        </button>
      </div>
    </div>
  );
}
export function PresentLesson({
  content,
  onExit,
}: {
  content: StepLessonContent;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0),
    [question, setQuestion] = useState(false),
    [answer, setAnswer] = useState(false),
    [alt, setAlt] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const navigate = (n: number) => {
    setIndex(Math.max(0, Math.min(content.steps.length - 1, n)));
    setQuestion(false);
    setAnswer(false);
    setAlt(false);
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      previous?.focus();
      if (document.fullscreenElement)
        void document.exitFullscreen?.().catch(() => {});
    };
  }, []);
  const s = content.steps[index];
  return (
    <div
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={c.present}
      className="tl-present"
      dir="rtl"
      onKeyDown={(e) => {
        containTab(e);
        if ((e.target as HTMLElement).tagName === "BUTTON" && e.key === " ")
          return;
        if (e.key === "ArrowLeft" || e.key === " ") {
          e.preventDefault();
          navigate(index + 1);
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          navigate(index - 1);
        }
        if (e.key === "Escape") onExit();
      }}
    >
      <div className="tl-toolbar">
        <button onClick={onExit}>{c.close}</button>
        <button
          onClick={() => {
            if (!document.fullscreenElement)
              void panel.current?.requestFullscreen?.().catch(() => {});
            else void document.exitFullscreen();
          }}
        >
          ملء الشاشة
        </button>
        <p>{c.noRecording}</p>
      </div>
      <p>
        {c.stepLabel} {index + 1} / {content.steps.length}
      </p>
      {s ? (
        <>
          <h1>{s.title}</h1>
          <p>{s.explanation}</p>
          {s.imageAssetId && (
            <img alt={c.image} src={"/api/teacher/assets/" + s.imageAssetId} />
          )}
          <button onClick={() => setQuestion(true)}>{c.question}</button>
          {question && (
            <>
              <h2>{s.question}</h2>
              <ul>
                {s.options.map((o) => (
                  <li
                    className={answer && o.isCorrect ? "tl-correct" : ""}
                    key={o.id}
                  >
                    {answer && o.isCorrect ? "✓ " : ""}
                    {o.text}
                  </li>
                ))}
              </ul>
              <p>توقفوا للتوقع قبل كشف الإجابة.</p>
              <button onClick={() => setAnswer(true)}>{c.reveal}</button>
            </>
          )}
          {answer && <p>{s.correctExplanation}</p>}
          <button onClick={() => setAlt(!alt)}>{c.alternative}</button>
          {alt && (
            <>
              <p>{s.altExplanation || c.helpMissing}</p>
              {s.altImageAssetId && (
                <img
                  alt={c.altImage}
                  src={"/api/teacher/assets/" + s.altImageAssetId}
                />
              )}
            </>
          )}
        </>
      ) : (
        <p>{c.noLessons}</p>
      )}
      <div className="tl-toolbar">
        <button disabled={!index} onClick={() => navigate(index - 1)}>
          {c.previous} →
        </button>
        <button
          disabled={index >= content.steps.length - 1}
          onClick={() => navigate(index + 1)}
        >
          ← {c.next}
        </button>
      </div>
    </div>
  );
}
interface StudentView {
  simulation?: Simulation;
  simulationResult?: ChemistryResult;
  assignment: {
    id: string;
    title: string;
    objective: string;
    mode: "learn" | "assessed";
    allowedAttempts: number;
  };
  step: StudentStep;
  position: number;
  total: number;
  progress: { completed: boolean; run: number; reachedIds: string[] };
  feedback: {
    correct: boolean;
    exhausted: boolean;
    canAdvance: boolean;
    number: number;
    optionId: string;
    correctOptionId?: string;
    hint?: string;
    explanation?: string;
  } | null;
  firstTryCorrect: number;
  support?: { alternative: string; imageAssetId: string | null };
  review?: { id: string; title: string; explanation: string }[];
}
let studentCsrf = "";
async function studentApi<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const enrollment=new URLSearchParams(window.location.search).get('enrollmentId');
  const response = await fetch("/api/student" + path + (enrollment ? (path.includes('?')?'&':'?')+'enrollmentId='+encodeURIComponent(enrollment) : ''), {
    credentials: "include",
    method,
    headers: {
      "Content-Type": "application/json",
      "x-student-entry": "1",
      ...(method !== "GET" ? { "x-student-csrf": studentCsrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw new TeacherApiError(result.error || c.offline, response.status);
  return result as T;
}
export function StudentLearning({embedded=false,assignmentId='',onExit}:{embedded?:boolean;assignmentId?:string;onExit?:()=>void}={}) {
  const [, routeParams] = useRoute("/learn/:id");
  const [, navigatePage] = useLocation();
  const [embeddedId,setEmbeddedId]=useState(assignmentId);
  useEffect(()=>setEmbeddedId(assignmentId),[assignmentId]);
  const params=embedded?(embeddedId?{id:embeddedId}:null):routeParams;
  const Surface=embedded?'section':'main';
  const navigate=(to:string)=>{if(!embedded){navigatePage(to);return;}const match=/^\/learn\/([^?]+)/.exec(to);setEmbeddedId(match?decodeURIComponent(match[1]):'');if(!match)onExit?.();};
  const [authenticated, setAuthenticated] = useState<boolean | null>(null),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [assignments, setAssignments] = useState<
      {
        id: string;
        title: string;
        objective: string;
        mode: string;
        completedAt: string | null;
      }[]
    >([]),
    [view, setView] = useState<StudentView | null>(null),
    [selected, setSelected] = useState(""),
    [support, setSupport] = useState<StudentView["support"]>();
  const pending = useRef<{
    action: string;
    body: Record<string, unknown>;
  } | null>(null);
  async function load() {
    setError(null);
    try {
      const session = await studentApi<{ csrf: string }>("/session");
      studentCsrf = session.csrf;
      setAuthenticated(true);
      if (params?.id) {
        const v = await studentApi<StudentView>("/assignments/" + params.id);
        setView(v);
        setSelected("");
        setSupport(undefined);
      } else {
        setView(null);
        setAssignments(await studentApi("/assignments"));
      }
    } catch (e) {
      setError(e);
      if (e instanceof TeacherApiError && e.status === 401)
        setAuthenticated(false);
      else setAuthenticated((old) => (old === null ? false : old));
    }
  }
  useEffect(() => {
    void load();
  }, [params?.id]);
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const s = await studentApi<{ csrf: string }>("/entry", "POST", {
        classCode: fd.get("classCode"),
        studentCode: fd.get("studentCode"),
      });
      studentCsrf = s.csrf;
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!view || busy) return;
    setBusy(true);
    setError(null);
    const prior = pending.current;
    const body =
      prior?.action === action
        ? prior.body
        : { requestKey: crypto.randomUUID(), stepId: view.step.id, ...extra };
    pending.current = { action, body };
    try {
      const next = await studentApi<StudentView>(
        "/assignments/" + view.assignment.id + "/" + action,
        "POST",
        body,
      );
      setView(next);
      if (action === "support") setSupport(next.support);
      else {
        setSupport(undefined);
        setSelected("");
      }
      pending.current = null;
    } catch (e) {
      setError(e instanceof TypeError ? Error(c.offline) : e);
    } finally {
      setBusy(false);
    }
  }
  const s = view?.step;
  return (
    <Surface className="tl tl-student" dir="rtl">
      <h1>{view?.assignment.title || c.entry}</h1>
      <ErrorMessage error={error} />
      {Boolean(error) && !pending.current && (
        <button disabled={busy} onClick={() => void load()}>
          {c.retry}
        </button>
      )}
      {authenticated === null ? (
        <p role="status">{c.loading}</p>
      ) : !authenticated ? (
        <form onSubmit={(e) => void login(e)}>
          <p>احصل على الرمزين من معلمك؛ لا يلزم بريد أو رقم هاتف.</p>
          <label className="tl-field">
            {c.classCode}
            <input
              autoComplete="off"
              name="classCode"
              dir="ltr"
              required
              minLength={8}
              maxLength={40}
            />
          </label>
          <label className="tl-field">
            {c.studentCode}
            <input
              autoComplete="off"
              name="studentCode"
              type="password"
              dir="ltr"
              required
              minLength={8}
              maxLength={40}
            />
          </label>
          <button disabled={busy}>{busy ? c.loading : c.enter}</button>
        </form>
      ) : (
        <>
          <div className="tl-toolbar">
            {embedded?<button onClick={()=>navigate('/learn')}>{c.back}</button>:<Link href="/learn">{c.back}</Link>}
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void studentApi("/logout", "POST", {})
                  .then(() => {
                    studentCsrf = "";
                    setAuthenticated(false);
                    setView(null);
                    navigate("/learn");
                  })
                  .catch(setError)
                  .finally(() => setBusy(false));
              }}
            >
              {c.signOut}
            </button>
          </div>
          {!view ? (
            <div className="tl-cards">
              {assignments.length === 0 && <p>{c.noAssignments}</p>}
              {assignments.map((a) => (
                <article key={a.id}>
                  <h2>{a.title}</h2>
                  <p>{a.objective}</p>
                  <p>{a.mode === "learn" ? c.learn : c.assessed}</p>
                  {embedded?<button onClick={()=>navigate('/learn/'+a.id)}>{a.completedAt?c.finish:c.start}</button>:<Link href={"/learn/" + a.id}>{a.completedAt ? c.finish : c.start}</Link>}
                </article>
              ))}
            </div>
          ) : view.progress.completed ? (
            <article>
              <h2>{c.finish}</h2>
              <p>
                {c.finalSummary}: {view.firstTryCorrect} / {view.total}
              </p>
              {view.assignment.mode === "learn" && <p>{c.noScore}</p>}
              {view.review?.map((r) => (
                <section key={r.id}>
                  <h3>{r.title}</h3>
                  <p>{r.explanation}</p>
                </section>
              ))}
              <button disabled={busy} onClick={() => void act("restart")}>
                {c.restart}
              </button>
              {embedded?<button onClick={()=>navigate('/learn')}>{c.back}</button>:<Link href="/learn">{c.back}</Link>}
            </article>
          ) : (
            s && (
              <article className="tl-player">
                {view.simulation && (
                  <ChemistryWorkbench
                    key={
                      view.assignment.id +
                      view.simulation.reactionId +
                      view.progress.run
                    }
                    simulation={view.simulation}
                    result={view.simulationResult}
                    busy={busy}
                    onRun={(predictsReaction, coefficients) =>
                      void act("simulation", { predictsReaction, coefficients })
                    }
                  />
                )}
                <p>
                  {view.assignment.mode === "learn"
                    ? c.learn
                    : c.assessed + " · " + view.assignment.allowedAttempts}
                </p>
                <p>{view.assignment.objective}</p>
                <p>
                  {c.stepLabel} {view.position} من {view.total}
                </p>
                <progress
                  value={view.position}
                  max={view.total}
                  aria-label="تقدم الدرس"
                />
                <h2>{s.title}</h2>
                <p>{s.explanation}</p>
                {s.imageAssetId && (
                  <img
                    alt={c.image}
                    src={
                      "/api/student/assignments/" +
                      view.assignment.id +
                      "/assets/" +
                      s.imageAssetId
                    }
                  />
                )}
                <h3>{s.question}</h3>
                <div
                  className="tl-options"
                  role="group"
                  aria-label={c.questionField}
                >
                  {s.options.map((o) => (
                    <button
                      key={o.id}
                      disabled={busy || Boolean(view.feedback?.canAdvance)}
                      aria-pressed={selected === o.id}
                      className={
                        view.feedback?.correctOptionId === o.id
                          ? "tl-correct"
                          : view.feedback?.optionId === o.id &&
                              !view.feedback.correct
                            ? "tl-wrong"
                            : ""
                      }
                      onClick={() => {
                        pending.current = null;
                        setSelected(o.id);
                      }}
                    >
                      {view.feedback?.correctOptionId === o.id ? "✓ " : ""}
                      {o.text}
                    </button>
                  ))}
                </div>
                <div className="tl-toolbar">
                  <button
                    disabled={
                      busy || !selected || Boolean(view.feedback?.canAdvance)
                    }
                    onClick={() => void act("attempt", { optionId: selected })}
                  >
                    {busy ? c.loading : c.check}
                  </button>
                  <button disabled={busy} onClick={() => void act("support")}>
                    {c.help}
                  </button>
                </div>
                {view.feedback && (
                  <div role="status" className="tl-feedback">
                    <p>
                      {view.feedback.correct
                        ? c.correct
                        : view.feedback.exhausted
                          ? c.exhausted
                          : c.wrong}
                    </p>
                    {view.feedback.hint && <p>{view.feedback.hint}</p>}
                    {view.feedback.explanation && (
                      <p>{view.feedback.explanation}</p>
                    )}
                  </div>
                )}
                {support && (
                  <div className="tl-support">
                    <p>{support.alternative}</p>
                    {support.imageAssetId && (
                      <img
                        alt={c.altImage}
                        src={
                          "/api/student/assignments/" +
                          view.assignment.id +
                          "/assets/" +
                          support.imageAssetId
                        }
                      />
                    )}
                  </div>
                )}
                <div className="tl-toolbar">
                  <button
                    disabled={busy || view.position <= 1}
                    onClick={() =>
                      void act("advance", {
                        targetStepId:
                          view.progress.reachedIds[view.position - 2],
                      })
                    }
                  >
                    {c.previous}
                  </button>
                  <button
                    disabled={busy || !view.feedback?.canAdvance}
                    onClick={() => void act("advance")}
                  >
                    {view.position === view.total ? c.finish : c.next}
                  </button>
                </div>
                <p>{c.savedResume}</p>
                {Boolean(error) && pending.current && (
                  <button
                    disabled={busy}
                    onClick={() => void act(pending.current!.action)}
                  >
                    {c.retry}
                  </button>
                )}
              </article>
            )
          )}
        </>
      )}
    </Surface>
  );
}
