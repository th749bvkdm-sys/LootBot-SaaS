import {
  useState,
  useEffect,
  useRef,
  cloneElement,
  isValidElement,
  type FormEvent,
  type ReactElement,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { createPortal } from "react-dom";
import {
  teacherApi,
  type TeacherClass,
  type TeacherProfile,
  type TeacherLesson,
  type TeacherStudent,
  type TeacherGrade,
} from "../lib/teacher-api";
import { toolsCopy as c, documentTypes } from "../lib/tools-copy";
import { teacherExtraCopy as extra } from "../lib/teacher-extra-copy";
import {
  blueprintIssues,
  rubricScore,
  type Blueprint,
  type BankQuestion,
} from "../../../../lib/api-zod/src/teacher-tools";
import {
  downloadTeacherCsv,
  parseRosterCsv,
  normalizeTeacherDigits,
} from "./teacher-roster-utils";
import "./teacher-learning.css";
import "./teacher-tools.css";
type Kind =
  | "blueprints"
  | "rubrics"
  | "feedback"
  | "documents"
  | "resources"
  | "calendar";
interface ToolRecord {
  id: string;
  revision: number;
  title: string;
  [key: string]: unknown;
}
interface Section {
  heading: string;
  body: string;
  answer?: string;
}
interface Criterion {
  name: string;
  max: number;
  weight: number;
  description: string;
}
interface Resource {
  id: string;
  type: string;
  title: string;
}
const labels: {
  key: Kind | "planner" | "grades" | "privacy";
  label: string;
}[] = [
  { key: "blueprints", label: c.blueprints },
  { key: "rubrics", label: c.rubrics },
  { key: "feedback", label: c.feedback },
  { key: "documents", label: c.documents },
  { key: "resources", label: c.resources },
  { key: "calendar", label: c.calendar },
  { key: "planner", label: c.planner },
  { key: "grades", label: c.grades },
  { key: "privacy", label: c.privacy },
];
const today = () => new Date().toLocaleDateString("en-CA");
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="tl-field">
      {label}
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ "aria-label"?: string }>, {
            "aria-label": label,
          })
        : children}
    </label>
  );
}
function errorText(e: unknown) {
  return e instanceof Error ? e.message : c.unavailable;
}
function useResources() {
  return useQuery({
    queryKey: ["teacher-resource-options"],
    queryFn: async () => {
      const [exams, lessons, activities, questions, assets] = await Promise.all(
        [
          teacherApi<{ id: string; title: string }[]>("/teacher/exams"),
          teacherApi<TeacherLesson[]>("/teacher/lessons"),
          teacherApi<{ id: string; title: string }[]>(
            "/teacher/learning/activities",
          ),
          teacherApi<{ id: string; content: BankQuestion }[]>(
            "/teacher/learning/question-versions",
          ),
          teacherApi<Resource[]>("/teacher/tools/assets"),
        ],
      );
      return [
        ...assets,
        ...exams.map((r) => ({ ...r, type: "exam" })),
        ...lessons.map((r) => ({ ...r, type: "lesson_plan" })),
        ...activities.map((r) => ({ ...r, type: "activity" })),
        ...questions.map((r) => ({
          id: r.id,
          title: r.content.text,
          type: "question",
        })),
      ] as Resource[];
    },
  });
}
export function TeacherTools() {
  const [tab, setTab] = useState<Kind | "planner" | "grades" | "privacy">(
    "blueprints",
  );
  return (
    <section className="tl" dir="rtl">
      <nav className="tl-toolbar">
        {labels.map((t) => (
          <button
            key={t.key}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === "privacy" ? (
        <TeacherPrivacy />
      ) : tab === "planner" ? (
        <WeeklyPlanner />
      ) : tab === "grades" ? (
        <GradeAnalysis />
      ) : (
        <RecordTools key={tab} kind={tab} />
      )}
    </section>
  );
}
function defaultRecord(kind: Kind, profile?: TeacherProfile): ToolRecord {
  const base = { id: "", revision: 1, title: "" };
  switch (kind) {
    case "blueprints":
      return { ...base, totalMarks: 10, questionCount: 1, items: [] };
    case "rubrics":
      return {
        ...base,
        criteria: [{ name: "", max: 5, weight: 1, description: "" }],
      };
    case "feedback":
      return { ...base, skill: "", tone: "neutral", body: "" };
    case "documents":
      return {
        ...base,
        type: "preparation",
        classId: null,
        date: today(),
        sections: [
          { heading: "الهدف", body: "" },
          { heading: "خطوات التنفيذ", body: "" },
          { heading: "التقييم والتأمل", body: "" },
        ],
        refs: [],
        reviewed: false,
        schoolName: profile?.schoolName,
      };
    case "resources":
      return {
        ...base,
        type: "exam",
        refId: "",
        tags: [],
        folder: "",
        notes: "",
      };
    case "calendar":
      return {
        ...base,
        title: "تقويم مدرستي",
        calendar: "gregory",
        holidays: [],
        schedule: [],
      };
  }
}
function RecordTools({ kind }: { kind: Kind }) {
  const qc = useQueryClient();
  const q = useQuery({
      queryKey: ["teacher-tools", kind],
      queryFn: () => teacherApi<ToolRecord[]>("/teacher/tools/" + kind),
    }),
    profile = useQuery({
      queryKey: ["teacher", "profile"],
      queryFn: () => teacherApi<TeacherProfile>("/teacher/profile"),
    }),
    classes = useQuery({
      queryKey: ["teacher", "classes"],
      queryFn: () => teacherApi<TeacherClass[]>("/teacher/classes"),
    }),
    bank = useQuery({
      queryKey: ["question-versions"],
      queryFn: () =>
        teacherApi<{ id: string; content: BankQuestion }[]>(
          "/teacher/learning/question-versions",
        ),
    }),
    resources = useResources();
  const [editing, setEditing] = useState<ToolRecord | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [preview, setPreview] = useState<ToolRecord | null>(null),
    [scores, setScores] = useState<number[]>([]),
    [score, setScore] = useState<number | null>(null);
  function patch(v: Partial<ToolRecord>) {
    setEditing((old) => (old ? { ...old, ...v } : old));
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["teacher-tools"] });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    await action(async () => {
      const result = await teacherApi<ToolRecord>(
        "/teacher/tools/" + kind + (editing.id ? "/" + editing.id : ""),
        editing.id ? "PUT" : "POST",
        editing,
      );
      setEditing(result);
    });
  }
  const sections = editing?.sections as Section[] | undefined,
    criteria = editing?.criteria as Criterion[] | undefined,
    items = editing?.items as Blueprint["items"] | undefined;
  return (
    <>
      <div className="tl-toolbar">
        <button
          onClick={() => {
            setEditing(defaultRecord(kind, profile.data));
            setError("");
            setScores([]);
            setScore(null);
          }}
        >
          {c.new}
        </button>
        <input
          aria-label={c.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={c.search}
        />
      </div>
      {error && (
        <p role="alert" className="tl-error">
          {error}
        </p>
      )}
      {q.error && (
        <p role="alert">
          {errorText(q.error)}
          <button onClick={() => void q.refetch()}>{c.retry}</button>
        </p>
      )}
      {q.isLoading && <p>{c.loading}</p>}
      <div className="tl-cards">
        {q.data
          ?.filter((r) =>
            [r.title, ...((r.tags as string[]) || [])]
              .join(" ")
              .includes(search),
          )
          .map((r) => (
            <article key={r.id}>
              <h3>{r.title}</h3>
              <p>إصدار {r.revision}</p>
              {Boolean(r.templateSource) && (
                <p>
                  {String((r.templateSource as { author: string }).author)} ·
                  إصدار المصدر{" "}
                  {String((r.templateSource as { version: number }).version)} ·{" "}
                  {String(
                    (r.templateSource as { sharedAt: string }).sharedAt,
                  ).slice(0, 10)}
                </p>
              )}
              {kind === "resources" && r.type === "asset" && (
                <img
                  loading="lazy"
                  alt={r.title}
                  src={"/api/teacher/assets/" + String(r.refId)}
                />
              )}
              {kind === "resources" && r.type !== "asset" && (
                <Link
                  href={
                    r.type === "exam"
                      ? "/teacher/exams"
                      : r.type === "lesson_plan"
                        ? "/teacher/lessons"
                        : r.type === "activity"
                          ? "/teacher/activities"
                          : "/teacher/questions"
                  }
                >
                  فتح مساحة المورد
                </Link>
              )}
              {kind === "resources" && <ResourceUses id={r.id} />}
              <div className="tl-toolbar">
                <button onClick={() => setEditing(structuredClone(r))}>
                  {c.edit}
                </button>
                <button
                  onClick={() =>
                    setEditing({
                      ...structuredClone(r),
                      id: "",
                      revision: 1,
                      title: r.title + " — نسخة",
                    })
                  }
                >
                  {c.duplicate}
                </button>
                <button onClick={() => setPreview(r)}>{c.print}</button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (confirm("أرشفة هذا السجل؟"))
                      void action(async () => {
                        await teacherApi(
                          "/teacher/tools/" + kind + "/" + r.id,
                          "DELETE",
                        );
                      });
                  }}
                >
                  {c.delete}
                </button>
              </div>
              {kind === "blueprints" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const generated = await teacherApi<ToolRecord>(
                        "/teacher/tools/blueprints/" + r.id + "/forms",
                        "POST",
                        {},
                      );
                      setEditing(generated);
                      setPreview(generated);
                    })
                  }
                >
                  {c.generate}
                </button>
              )}
            </article>
          ))}
      </div>
      {q.data?.length === 0 && <p>{c.empty}</p>}
      {kind === "documents" && <SchoolPackets />}
      {kind === "documents" && <WorksheetBuilder />}
      {(kind === "documents" || kind === "rubrics") && (
        <TemplateSharing records={q.data ?? []} />
      )}
      {editing && (
        <form className="tl-step-editor" onSubmit={(e) => void save(e)}>
          <h2>{c.edit}</h2>
          <Field label={c.titleField}>
            <input
              required
              maxLength={300}
              value={editing.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </Field>
          {kind === "blueprints" && (
            <>
              <div className="tl-grid">
                <Field label={c.total}>
                  <input
                    type="number"
                    step="any"
                    min={0.1}
                    required
                    value={Number(editing.totalMarks)}
                    onChange={(e) =>
                      patch({ totalMarks: Number(e.target.value) })
                    }
                  />
                </Field>
                <Field label={c.count}>
                  <input
                    type="number"
                    step="any"
                    min={1}
                    required
                    value={Number(editing.questionCount)}
                    onChange={(e) =>
                      patch({ questionCount: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>
              <Field label={c.question}>
                <select
                  value=""
                  onChange={(e) => {
                    const version = bank.data?.find(
                      (q) => q.id === e.target.value,
                    );
                    if (version)
                      patch({
                        items: [
                          ...(items || []),
                          {
                            versionId: version.id,
                            marks: version.content.marks,
                            objective: version.content.objective || "",
                            difficulty: version.content.difficulty || "medium",
                          },
                        ],
                        forms: undefined,
                      });
                  }}
                >
                  <option value="">اختر نسخة سؤال ثابتة</option>
                  {bank.data?.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.content.text}
                    </option>
                  ))}
                </select>
              </Field>
              {items?.map((item, i) => (
                <div key={i} className="tl-grid">
                  <p>
                    {bank.data?.find((q) => q.id === item.versionId)?.content
                      .text || item.versionId}
                  </p>
                  <Field label={c.marks}>
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={item.marks}
                      onChange={(e) =>
                        patch({
                          items: items.map((x, n) =>
                            n === i
                              ? { ...x, marks: Number(e.target.value) }
                              : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label={extra.objective}>
                    <input
                      value={item.objective}
                      onChange={(e) =>
                        patch({
                          items: items.map((x, n) =>
                            n === i ? { ...x, objective: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label={extra.difficulty}>
                    <select
                      value={item.difficulty}
                      onChange={(e) =>
                        patch({
                          items: items.map((x, n) =>
                            n === i
                              ? {
                                  ...x,
                                  difficulty: e.target
                                    .value as typeof x.difficulty,
                                }
                              : x,
                          ),
                        })
                      }
                    >
                      <option value="easy">{extra.easy}</option>
                      <option value="medium">{extra.medium}</option>
                      <option value="hard">{extra.hard}</option>
                    </select>
                  </Field>
                  <button
                    type="button"
                    onClick={() =>
                      patch({ items: items.filter((_, n) => n !== i) })
                    }
                  >
                    {c.remove}
                  </button>
                </div>
              ))}
              {blueprintIssues(editing as unknown as Blueprint).map((issue) => (
                <p key={issue} role="status">
                  ⚠ {issue}
                </p>
              ))}
            </>
          )}
          {kind === "rubrics" && (
            <>
              {criteria?.map((criterion, i) => (
                <article key={i}>
                  <Field label={c.name}>
                    <input
                      required
                      value={criterion.name}
                      onChange={(e) =>
                        patch({
                          criteria: criteria.map((x, n) =>
                            n === i ? { ...x, name: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label={c.max}>
                    <input
                      type="number"
                      step="any"
                      min={0.1}
                      value={criterion.max}
                      onChange={(e) =>
                        patch({
                          criteria: criteria.map((x, n) =>
                            n === i ? { ...x, max: Number(e.target.value) } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label={c.weight}>
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={criterion.weight}
                      onChange={(e) =>
                        patch({
                          criteria: criteria.map((x, n) =>
                            n === i
                              ? { ...x, weight: Number(e.target.value) }
                              : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label={c.description}>
                    <textarea
                      value={criterion.description}
                      onChange={(e) =>
                        patch({
                          criteria: criteria.map((x, n) =>
                            n === i ? { ...x, description: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label={c.marks}>
                    <input
                      type="number"
                      step="any"
                      min={0}
                      max={criterion.max}
                      value={scores[i] ?? 0}
                      onChange={(e) =>
                        setScores((old) =>
                          criteria.map((_, n) =>
                            n === i ? Number(e.target.value) : (old[n] ?? 0),
                          ),
                        )
                      }
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={() =>
                      patch({ criteria: criteria.filter((_, n) => n !== i) })
                    }
                  >
                    {c.remove}
                  </button>
                </article>
              ))}
              <button
                type="button"
                onClick={() =>
                  patch({
                    criteria: [
                      ...(criteria || []),
                      { name: "", max: 5, weight: 1, description: "" },
                    ],
                  })
                }
              >
                {c.add}
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    setScore(
                      rubricScore(
                        criteria || [],
                        (criteria || []).map((_, i) => scores[i] ?? 0),
                      ),
                    );
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                {c.score}
              </button>
              {score !== null && <p role="status">{score.toFixed(2)}%</p>}
            </>
          )}
          {kind === "feedback" && (
            <>
              <Field label={c.skill}>
                <input
                  value={String(editing.skill)}
                  onChange={(e) => patch({ skill: e.target.value })}
                />
              </Field>
              <Field label={c.tone}>
                <select
                  value={String(editing.tone)}
                  onChange={(e) => patch({ tone: e.target.value })}
                >
                  <option value="neutral">محايد</option>
                  <option value="encouraging">مشجع</option>
                  <option value="next_step">خطوة تالية</option>
                </select>
              </Field>
              <Field label={c.body}>
                <textarea
                  value={String(editing.body)}
                  onChange={(e) => patch({ body: e.target.value })}
                />
              </Field>
            </>
          )}
          {kind === "documents" && (
            <>
              <p>{c.draft}</p>
              <Field label={c.type}>
                <select
                  value={String(editing.type)}
                  onChange={(e) => {
                    const type = e.target.value;
                    patch({
                      type,
                      sections:
                        type === "differentiated"
                          ? c.diff.map((heading) => ({ heading, body: "" }))
                          : sections,
                    });
                  }}
                >
                  {Object.entries(documentTypes).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={c.class}>
                <select
                  value={String(editing.classId || "")}
                  onChange={(e) => patch({ classId: e.target.value || null })}
                >
                  <option value="">دون فصل</option>
                  {classes.data?.map((cl) => (
                    <option key={cl.id} value={cl.id}>
                      {cl.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={c.date}>
                <input
                  type="date"
                  required
                  value={String(editing.date)}
                  onChange={(e) => patch({ date: e.target.value })}
                />
              </Field>
              <Field label={extra.objective}>
                <input
                  value={String(editing.objective || "")}
                  onChange={(e) => patch({ objective: e.target.value })}
                />
              </Field>
              {editing.type === "differentiated" && <p>{c.reviewDiff}</p>}
              {sections?.map((section, i) => (
                <article key={i}>
                  <Field label={c.heading}>
                    <input
                      required
                      value={section.heading}
                      onChange={(e) =>
                        patch({
                          sections: sections.map((s, n) =>
                            n === i ? { ...s, heading: e.target.value } : s,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label={c.body}>
                    <textarea
                      value={section.body}
                      onChange={(e) =>
                        patch({
                          sections: sections.map((s, n) =>
                            n === i ? { ...s, body: e.target.value } : s,
                          ),
                        })
                      }
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={() =>
                      patch({ sections: sections.filter((_, n) => n !== i) })
                    }
                  >
                    {c.remove}
                  </button>
                  <Field label={extra.key}>
                    <textarea
                      value={section.answer || ""}
                      onChange={(e) =>
                        patch({
                          sections: sections.map((s, n) =>
                            n === i ? { ...s, answer: e.target.value } : s,
                          ),
                        })
                      }
                    />
                  </Field>
                </article>
              ))}
              <button
                type="button"
                onClick={() =>
                  patch({
                    sections: [...(sections || []), { heading: "", body: "" }],
                  })
                }
              >
                {c.add}
              </button>
              <Field label={c.resource}>
                <select
                  value=""
                  onChange={(e) => {
                    const r = resources.data?.find(
                      (r) => r.id === e.target.value,
                    );
                    if (r)
                      patch({
                        refs: [
                          ...((editing.refs as {
                            id: string;
                            type: string;
                          }[]) || []),
                          { id: r.id, type: r.type },
                        ],
                      });
                  }}
                >
                  <option value="">أضف موردًا مرتبطًا</option>
                  {resources.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </Field>
              <ul>
                {((editing.refs as { id: string; type: string }[]) || []).map(
                  (r, i) => (
                    <li key={i}>
                      {resources.data?.find((x) => x.id === r.id)?.title}
                      <button
                        type="button"
                        onClick={() =>
                          patch({
                            refs: (
                              editing.refs as { id: string; type: string }[]
                            ).filter((_, n) => n !== i),
                          })
                        }
                      >
                        {c.remove}
                      </button>
                    </li>
                  ),
                )}
              </ul>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(editing.reviewed)}
                  onChange={(e) => patch({ reviewed: e.target.checked })}
                />
                {c.reviewed}
              </label>
            </>
          )}
          {kind === "resources" && (
            <>
              <p>{c.resourceWarning}</p>
              <Field label={c.resource}>
                <select
                  required
                  value={String(editing.refId)}
                  onChange={(e) => {
                    const r = resources.data?.find(
                      (r) => r.id === e.target.value,
                    );
                    if (r)
                      patch({
                        refId: r.id,
                        type: r.type,
                        title: editing.title || r.title,
                      });
                  }}
                >
                  <option value="">اختر ملفًا محفوظًا</option>
                  {resources.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={c.tags}>
                <input
                  value={((editing.tags as string[]) || []).join(",")}
                  onChange={(e) =>
                    patch({
                      tags: e.target.value
                        .split(/[,،]/)
                        .map((x) => x.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
              <Field label={c.folder}>
                <input
                  value={String(editing.folder || "")}
                  onChange={(e) => patch({ folder: e.target.value })}
                />
              </Field>
              <Field label={c.notes}>
                <textarea
                  value={String(editing.notes || "")}
                  onChange={(e) => patch({ notes: e.target.value })}
                />
              </Field>
            </>
          )}
          {kind === "calendar" && (
            <>
              <Field label={c.schoolCalendar}>
                <select
                  value={String(editing.calendar)}
                  onChange={(e) => patch({ calendar: e.target.value })}
                >
                  <option value="gregory">{c.gregory}</option>
                  <option value="islamic-umalqura">{c.hijri}</option>
                </select>
              </Field>
              <Field label={c.holidays}>
                <textarea
                  value={((editing.holidays as string[]) || []).join("\n")}
                  onChange={(e) =>
                    patch({
                      holidays: e.target.value.split("\n").filter(Boolean),
                    })
                  }
                />
              </Field>
              {(
                (editing.schedule as {
                  day: number;
                  time: string;
                  classId: string;
                  label: string;
                }[]) || []
              ).map((slot, i, slots) => (
                <div className="tl-grid" key={i}>
                  <Field label={c.day}>
                    <input
                      type="number"
                      step="any"
                      min={0}
                      max={6}
                      value={slot.day}
                      onChange={(e) =>
                        patch({
                          schedule: slots.map((s, n) =>
                            n === i ? { ...s, day: Number(e.target.value) } : s,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label={c.time}>
                    <input
                      type="time"
                      required
                      value={slot.time}
                      onChange={(e) =>
                        patch({
                          schedule: slots.map((s, n) =>
                            n === i ? { ...s, time: e.target.value } : s,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label={c.class}>
                    <select
                      required
                      value={slot.classId}
                      onChange={(e) =>
                        patch({
                          schedule: slots.map((s, n) =>
                            n === i ? { ...s, classId: e.target.value } : s,
                          ),
                        })
                      }
                    >
                      <option value="">اختر الفصل</option>
                      {classes.data?.map((cl) => (
                        <option key={cl.id} value={cl.id}>
                          {cl.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button
                    type="button"
                    onClick={() =>
                      patch({ schedule: slots.filter((_, n) => n !== i) })
                    }
                  >
                    {c.remove}
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  patch({
                    schedule: [
                      ...((editing.schedule as object[]) || []),
                      {
                        day: 0,
                        time: "08:00",
                        classId: classes.data?.[0]?.id || "",
                        label: "",
                      },
                    ],
                  })
                }
              >
                {c.add}
              </button>
            </>
          )}
          <div className="tl-toolbar">
            <button disabled={busy}>{busy ? c.loading : c.save}</button>
            <button type="button" onClick={() => setPreview(editing)}>
              {c.print}
            </button>
          </div>
        </form>
      )}
      {preview && (
        <ToolPrint
          record={preview}
          kind={kind}
          profile={profile.data}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
function ToolPrint({
  record,
  kind,
  profile,
  onClose,
}: {
  record: ToolRecord;
  kind: Kind;
  profile?: TeacherProfile;
  onClose: () => void;
}) {
  const resources = useResources();
  const panel = useRef<HTMLDivElement>(null);
  const [variant, setVariant] = useState(0),
    [answerKey, setAnswerKey] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    return () => previous?.focus();
  }, []);
  return createPortal(
    <div
      ref={panel}
      className="tt-print"
      role="dialog"
      aria-label={c.print}
      aria-modal="true"
      dir="rtl"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Tab") {
          const nodes = [
            ...e.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled),a[href],select:not(:disabled),input:not(:disabled)",
            ),
          ];
          const first = nodes[0],
            last = nodes.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div className="tt-no-print tl-toolbar">
        <button onClick={() => window.print()}>{c.print}</button>
        <button autoFocus onClick={onClose}>
          إغلاق
        </button>
        <p>{c.ink}</p>
        {kind === "documents" && record.type === "differentiated" && (
          <select
            aria-label="نسخة ورقة العمل"
            value={variant}
            onChange={(e) => setVariant(Number(e.target.value))}
          >
            {(record.sections as Section[]).map((s, i) => (
              <option key={i} value={i}>
                {s.heading}
              </option>
            ))}
          </select>
        )}
        {(kind === "documents" || kind === "blueprints") && (
          <label>
            <input
              type="checkbox"
              checked={answerKey}
              onChange={(e) => setAnswerKey(e.target.checked)}
            />
            {extra.key}
          </label>
        )}
      </div>
      <article className="tt-paper">
        <header>
          <p>
            {profile?.schoolName} · {profile?.teacherName} · {profile?.term} /{" "}
            {profile?.year}
          </p>
          <h1>{record.title}</h1>
          <p>{String(record.date || today())}</p>
          <p>{profile?.subjects.join("، ")}</p>
          {Boolean(record.objective) && (
            <p>
              {extra.objective}: {String(record.objective)}
            </p>
          )}
          <small>{c.draft}</small>
        </header>
        {kind === "documents" &&
          ((record.sections as Section[]) || [])
            .filter((_, i) => record.type !== "differentiated" || i === variant)
            .map((s, i) => (
              <section key={i}>
                <h2>{s.heading}</h2>
                <p>{s.body}</p>
                {answerKey && (
                  <p>
                    <strong>{extra.key}: </strong>
                    {s.answer || "لم يحدد المعلم إجابة."}
                  </p>
                )}
              </section>
            ))}
        {kind === "rubrics" &&
          ((record.criteria as Criterion[]) || []).map((r, i) => (
            <section key={i}>
              <h2>
                {r.name} ({r.max}) — الوزن {r.weight}
              </h2>
              <p>{r.description}</p>
            </section>
          ))}
        {kind === "feedback" && <p>{String(record.body || "")}</p>}
        {kind === "blueprints" &&
          (
            (record.forms as {
              label: string;
              items: {
                versionId: string;
                marks: number;
                question: BankQuestion;
              }[];
            }[]) || []
          ).map((form) => (
            <section className="tt-form" key={form.label}>
              <h2>نموذج {form.label}</h2>
              {!answerKey &&
                form.items.map((item, i) => (
                  <section key={item.versionId}>
                    <p>
                      {i + 1}. {item.question.text} ({item.marks})
                    </p>
                    <ol>
                      {item.question.options.map((o, n) => (
                        <li key={n}>{o}</li>
                      ))}
                    </ol>
                    <details className="tt-no-print">
                      <summary>{c.answer}</summary>
                      {item.question.answer}
                    </details>
                  </section>
                ))}
              {answerKey && (
                <div className="tt-key">
                  <h2>
                    {c.answer} — {form.label}
                  </h2>
                  {form.items.map((item, i) => (
                    <p key={i}>
                      {i + 1}. {item.question.answer || "لم يحدد المعلم إجابة"}
                    </p>
                  ))}
                </div>
              )}
            </section>
          ))}
        {kind === "resources" && (
          <>
            <p>{String(record.folder || "")}</p>
            <p>{String(record.notes || "")}</p>
          </>
        )}
        {kind === "calendar" && (
          <p>{((record.holidays as string[]) || []).join("، ")}</p>
        )}
        {kind === "documents" &&
          ((record.refs as { id: string; type: string }[]) || []).length >
            0 && (
            <section>
              <h2>{c.resource}</h2>
              <ul>
                {(record.refs as { id: string; type: string }[]).map((ref) => {
                  const r = resources.data?.find(
                    (r) => r.id === ref.id && r.type === ref.type,
                  );
                  return <li key={ref.id}>{r?.title || extra.open}</li>;
                })}
              </ul>
            </section>
          )}
      </article>
    </div>,
    document.body,
  );
}
function WeeklyPlanner() {
  const qc = useQueryClient(),
    q = useQuery({
      queryKey: ["teacher", "lessons"],
      queryFn: () => teacherApi<TeacherLesson[]>("/teacher/lessons"),
    }),
    calendar = useQuery({
      queryKey: ["teacher-tools", "calendar"],
      queryFn: () => teacherApi<ToolRecord[]>("/teacher/tools/calendar"),
    }),
    classes = useQuery({
      queryKey: ["teacher", "classes"],
      queryFn: () => teacherApi<TeacherClass[]>("/teacher/classes"),
    });
  const [week, setWeek] = useState(today()),
    [days, setDays] = useState(7),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const weekValid =
    /^\d{4}-\d{2}-\d{2}$/.test(week) &&
    Number.isFinite(Date.parse(week + "T12:00:00Z"));
  const dates = Array.from({ length: weekValid ? 7 : 0 }, (_, i) => {
    const d = new Date(week + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  async function shift(duplicate: boolean) {
    if (!selected.length) return;
    if (!confirm("تطبيق التغيير على الخطط المحددة؟")) return;
    setBusy(true);
    setError("");
    try {
      await teacherApi("/teacher/tools/planner/shift", "POST", {
        ids: selected,
        days,
        duplicate,
      });
      await qc.invalidateQueries({ queryKey: ["teacher", "lessons"] });
      setSelected([]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article>
      <div className="tl-toolbar tt-no-print">
        <Field label={c.week}>
          <input
            type="date"
            value={week}
            onChange={(e) => setWeek(e.target.value)}
          />
        </Field>
        <Field label={c.days}>
          <input
            type="number"
            step="any"
            min={-365}
            max={365}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </Field>
        <button
          disabled={busy || !selected.length}
          onClick={() => void shift(true)}
        >
          {c.copyWeek}
        </button>
        <button
          disabled={busy || !selected.length}
          onClick={() => void shift(false)}
        >
          {c.shift}
        </button>
        <button onClick={() => window.print()}>{c.print}</button>
        <Link href="/teacher/lessons">تحرير خطط الدروس</Link>
      </div>
      {error && <p role="alert">{error}</p>}
      {q.error && <p role="alert">{errorText(q.error)}</p>}
      {!weekValid && <p role="alert">اختر تاريخ بداية الأسبوع.</p>}
      {dates.map((date) => (
        <section key={date}>
          <h3>
            {new Intl.DateTimeFormat("ar-SA", {
              dateStyle: "full",
              calendar: String(calendar.data?.[0]?.calendar || "gregory"),
            }).format(new Date(date + "T12:00:00Z"))}
          </h3>
          {((calendar.data?.[0]?.holidays as string[]) || []).includes(date) ? (
            <p>إجازة حسب تقويم المدرسة</p>
          ) : (
            <>
              {(
                (calendar.data?.[0]?.schedule as {
                  day: number;
                  time: string;
                  classId: string;
                }[]) || []
              )
                .filter(
                  (s) => s.day === new Date(date + "T12:00:00Z").getUTCDay(),
                )
                .map((s, i) => (
                  <p key={i}>
                    {s.time} ·{" "}
                    {classes.data?.find((c) => c.id === s.classId)?.name}
                  </p>
                ))}
              {q.data
                ?.filter((l) => l.date === date)
                .map((l) => (
                  <div key={l.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(l.id)}
                        onChange={() =>
                          setSelected((old) =>
                            old.includes(l.id)
                              ? old.filter((id) => id !== l.id)
                              : [...old, l.id],
                          )
                        }
                      />
                      {l.title}
                    </label>
                    <p>{l.objectives}</p>
                    <p>{l.content}</p>
                    <p>{l.homework}</p>
                  </div>
                ))}
            </>
          )}
        </section>
      ))}
      <RosterSnapshots />
    </article>
  );
}
function WorksheetBuilder() {
  const qc = useQueryClient(),
    q = useQuery({
      queryKey: ["question-versions"],
      queryFn: () =>
        teacherApi<{ id: string; content: BankQuestion }[]>(
          "/teacher/learning/question-versions",
        ),
    });
  const [versionId, setVersionId] = useState(""),
    [objective, setObjective] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [ticket, setTicket] = useState(false);
  return (
    <article>
      <h3>{extra.worksheets}</h3>
      <p>{extra.draft}</p>
      <Field label={extra.source}>
        <select
          value={versionId}
          onChange={(e) => {
            setVersionId(e.target.value);
            setObjective(
              q.data?.find((v) => v.id === e.target.value)?.content.objective ||
                "",
            );
          }}
        >
          <option value="">{extra.source}</option>
          {q.data?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.content.text}
            </option>
          ))}
        </select>
      </Field>
      <Field label={extra.objective}>
        <input
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
        />
      </Field>
      <button
        disabled={!versionId || !objective || busy}
        onClick={() => {
          setBusy(true);
          setError("");
          void teacherApi("/teacher/tools/worksheets", "POST", {
            versionId,
            objective,
          })
            .then(() => {
              setSaved(true);
              return qc.invalidateQueries({
                queryKey: ["teacher-tools", "documents"],
              });
            })
            .catch((e) => setError(errorText(e)))
            .finally(() => setBusy(false));
        }}
      >
        {extra.createWorksheets}
      </button>
      <button
        disabled={!versionId || !objective || busy}
        onClick={() => {
          setBusy(true);
          setError("");
          void teacherApi("/teacher/tools/exit-ticket", "POST", {
            versionId,
            objective,
          })
            .then(() => setTicket(true))
            .catch((e) => setError(errorText(e)))
            .finally(() => setBusy(false));
        }}
      >
        {extra.exitTicket}
      </button>
      {ticket && (
        <p role="status">
          {extra.exitSaved}{" "}
          <Link href="/teacher/activities">الدروس التفاعلية</Link>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">{c.success}</p>}
    </article>
  );
}
function ResourceUses({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["resource-uses", id],
    queryFn: () =>
      teacherApi<{ id: string; kind: string; title: string }[]>(
        "/teacher/tools/resources/" + id + "/uses",
      ),
    enabled: open,
  });
  return (
    <div>
      <button onClick={() => setOpen(!open)} aria-expanded={open}>
        {extra.usage}
      </button>
      {open &&
        (q.isLoading ? (
          <p>{c.loading}</p>
        ) : q.error ? (
          <p role="alert">{errorText(q.error)}</p>
        ) : q.data?.length ? (
          <ul>
            {q.data.map((r) => (
              <li key={r.id}>
                <Link
                  href={
                    r.kind === "lessons" ? "/teacher/lessons" : "/teacher/tools"
                  }
                >
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>{extra.none}</p>
        ))}
    </div>
  );
}
function GradeAnalysis() {
  const classes = useQuery({
    queryKey: ["teacher", "classes"],
    queryFn: () => teacherApi<TeacherClass[]>("/teacher/classes"),
  });
  const [classId, setClassId] = useState("");
  const selected = classId || classes.data?.[0]?.id || "";
  const q = useQuery({
    queryKey: ["grade-summary", selected],
    queryFn: () =>
      teacherApi<
        {
          id: string;
          name: string;
          percent: number | null;
          missing: number;
          formula: string;
          records: TeacherGrade[];
        }[]
      >("/teacher/tools/grade-summary/" + selected),
    enabled: !!selected,
  });
  return (
    <article>
      <Field label={c.class}>
        <select value={selected} onChange={(e) => setClassId(e.target.value)}>
          {classes.data?.map((cl) => (
            <option key={cl.id} value={cl.id}>
              {cl.name}
            </option>
          ))}
        </select>
      </Field>
      <Link href="/teacher/grades">رصد وتحرير الدرجات</Link>
      <button
        disabled={!q.data?.some((s) => s.records.length)}
        onClick={() =>
          downloadTeacherCsv("درجات.csv", [
            [...extra.gradeHeaders],
            ...(q.data || []).flatMap((s) =>
              s.records.map((g) => [
                s.name,
                g.title,
                g.date,
                g.marks === null ? "" : String(g.marks),
                String(g.totalMarks),
                g.status || "graded",
                String(g.weight ?? g.totalMarks),
                g.note,
              ]),
            ),
          ])
        }
      >
        {extra.exportGrades}
      </button>
      {q.error && <p role="alert">{errorText(q.error)}</p>}
      <div className="tl-table">
        <table>
          <thead>
            <tr>
              <th>{c.student}</th>
              <th>نسبة موزونة</th>
              <th>{c.missing}</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((s) => (
              <tr key={s.id}>
                <th>{s.name}</th>
                <td>{s.percent === null ? "—" : s.percent + "%"}</td>
                <td>{s.missing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>{q.data?.[0]?.formula}</p>
      {selected && <GradeCsv classId={selected} key={selected} />}
      {selected && (
        <ExtendedGradeGrid classId={selected} key={"grid-" + selected} />
      )}
    </article>
  );
}
function GradeCsv({ classId }: { classId: string }) {
  const qc = useQueryClient(),
    students = useQuery({
      queryKey: ["grade-import-students", classId],
      queryFn: () =>
        teacherApi<TeacherStudent[]>("/teacher/students?classId=" + classId),
    });
  const [rows, setRows] = useState<string[][]>([]),
    [title, setTitle] = useState(""),
    [date, setDate] = useState(today()),
    [total, setTotal] = useState(20),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [summary, setSummary] = useState("");
  const seen = new Set<string>();
  const parsed = rows.slice(1).map((row, i) => {
    const id = normalizeTeacherDigits(row[0]?.trim() || ""),
      matched =
        students.data?.filter((s) => s.internalId === id && !s.removed) || [],
      marks = row[1]?.trim() ? Number(normalizeTeacherDigits(row[1])) : null;
    const errors: string[] = [];
    if (!id || matched.length !== 1)
      errors.push("رقم داخلي غير مطابق أو غير فريد");
    if (seen.has(id)) errors.push("صف مكرر");
    seen.add(id);
    if (
      marks !== null &&
      (!Number.isFinite(marks) || marks < 0 || marks > total)
    )
      errors.push("درجة غير صالحة");
    if (row.length !== rows[0]?.length) errors.push("عدد الأعمدة غير متسق");
    return {
      row: i + 2,
      name: matched[0]?.name || "",
      studentId: matched[0]?.id,
      marks,
      errors,
    };
  });
  const valid = parsed.length > 0 && parsed.every((r) => !r.errors.length);
  return (
    <section>
      <h3>{c.csv}</h3>
      <p>أعمدة القالب: الرقم الداخلي، الدرجة. المعاينة لا تحفظ شيئًا.</p>
      <button
        onClick={() =>
          downloadTeacherCsv("قالب-درجات.csv", [
            ["الرقم الداخلي", "الدرجة"],
            ...(students.data || [])
              .filter((s) => s.internalId && !s.removed)
              .map((s) => [s.internalId, ""]),
          ])
        }
      >
        {c.sample}
      </button>
      <Field label={c.titleField}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={c.date}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      <Field label={c.total}>
        <input
          type="number"
          step="any"
          min={0.1}
          value={total}
          onChange={(e) => setTotal(Number(e.target.value))}
        />
      </Field>
      <input
        type="file"
        accept=".csv,.tsv"
        aria-label={c.csv}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && file.size > 1024 * 1024) {
            setError("الملف أكبر من 1MB.");
            return;
          }
          if (file)
            void file
              .text()
              .then((text) => {
                if (file.size > 1024 * 1024) throw Error("الملف أكبر من 1MB.");
                setRows(parseRosterCsv(text));
                setSummary("");
              })
              .catch((e) => setError(errorText(e)));
        }}
      />
      {rows.length > 0 && (
        <div className="tl-table">
          <table>
            <thead>
              <tr>
                <th>السطر</th>
                <th>{c.student}</th>
                <th>{c.marks}</th>
                <th>الأخطاء</th>
              </tr>
            </thead>
            <tbody>
              {parsed.map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td>
                  <td>{r.name}</td>
                  <td>{r.marks ?? "مفقود"}</td>
                  <td>{r.errors.join("، ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {summary && <p role="status">{summary}</p>}
      <button
        disabled={!valid || !title || busy}
        onClick={() => {
          if (
            !confirm(
              "حفظ الدرجات المعروضة؟ قد يحدث تحديث لتقييم بالعنوان والتاريخ نفسيهما.",
            )
          )
            return;
          setBusy(true);
          setError("");
          void teacherApi("/teacher/grades/bulk", "POST", {
            classId,
            title,
            date,
            totalMarks: total,
            entries: parsed.map((r) => ({
              studentId: r.studentId,
              marks: r.marks,
              note: "",
            })),
          })
            .then(() => {
              setSummary("تم حفظ " + parsed.length + " درجة.");
              void qc.invalidateQueries({ queryKey: ["grade-summary"] });
            })
            .catch((e) => setError(errorText(e)))
            .finally(() => setBusy(false));
        }}
      >
        {c.commit}
      </button>
    </section>
  );
}
function ExtendedGradeGrid({ classId }: { classId: string }) {
  const qc = useQueryClient(),
    students = useQuery({
      queryKey: ["grade-grid-students", classId],
      queryFn: () =>
        teacherApi<TeacherStudent[]>("/teacher/students?classId=" + classId),
    }),
    grades = useQuery({
      queryKey: ["grade-grid-records", classId],
      queryFn: () =>
        teacherApi<TeacherGrade[]>("/teacher/grades?classId=" + classId),
    }),
    feedback = useQuery({
      queryKey: ["teacher-tools", "feedback"],
      queryFn: () => teacherApi<ToolRecord[]>("/teacher/tools/feedback"),
    });
  const [title, setTitle] = useState(""),
    [date, setDate] = useState(today()),
    [total, setTotal] = useState(20),
    [rows, setRows] = useState<
      Record<
        string,
        { marks: string; status: string; weight: number; note: string }
      >
    >({}),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [feedbackId, setFeedbackId] = useState("");
  const history = useRef<(typeof rows)[]>([]);
  useEffect(() => {
    const matching =
      grades.data?.filter((g) => g.title === title && g.date === date) || [];
    setRows(
      Object.fromEntries(
        matching.map((g) => [
          g.studentId,
          {
            marks: g.marks === null ? "" : String(g.marks),
            status: g.status || "graded",
            weight: g.weight ?? g.totalMarks,
            note: g.note,
          },
        ]),
      ),
    );
    if (matching[0]) setTotal(matching[0].totalMarks);
    history.current = [];
  }, [grades.data]);
  function change(studentId: string, patch: Partial<(typeof rows)[string]>) {
    history.current.push(structuredClone(rows));
    if (history.current.length > 20) history.current.shift();
    setRows((old) => ({
      ...old,
      [studentId]: {
        ...(old[studentId] ?? {
          marks: "",
          status: "graded",
          weight: total,
          note: "",
        }),
        ...patch,
      },
    }));
  }
  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    try {
      const entries = (students.data || [])
        .filter((s) => !s.removed && !s.archived)
        .map((s) => {
          const row = rows[s.id];
          const marks = row?.marks.trim()
            ? Number(normalizeTeacherDigits(row.marks))
            : null;
          if (
            marks !== null &&
            (!Number.isFinite(marks) || marks < 0 || marks > total)
          )
            throw Error("درجة غير صالحة: " + s.name);
          return {
            studentId: s.id,
            marks:
              row?.status === "absent" ||
              row?.status === "exempt" ||
              row?.status === "missing"
                ? null
                : marks,
            status: row?.status || "graded",
            weight: row?.weight ?? total,
            note: row?.note || "",
          };
        });
      await teacherApi("/teacher/grades/bulk", "POST", {
        classId,
        title,
        date,
        totalMarks: total,
        entries,
      });
      setMessage(c.success);
      await qc.invalidateQueries({ queryKey: ["grade-grid-records"] });
      await qc.invalidateQueries({ queryKey: ["grade-summary"] });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>شبكة درجات: الحالة والأوزان والتعليقات</h3>
      <p>
        Enter أو السهم لأسفل ينتقل للطالب التالي. المعفى خارج حساب النسبة؛
        الغائب والمفقود صفر مؤقتًا.
      </p>
      <Field label="تقييم محفوظ">
        <select
          value=""
          onChange={(e) => {
            const value = JSON.parse(e.target.value);
            setTitle(value.title);
            setDate(value.date);
            const matching =
              grades.data?.filter(
                (g) => g.title === value.title && g.date === value.date,
              ) || [];
            setRows(
              Object.fromEntries(
                matching.map((g) => [
                  g.studentId,
                  {
                    marks: g.marks === null ? "" : String(g.marks),
                    status: g.status || "graded",
                    weight: g.weight ?? g.totalMarks,
                    note: g.note,
                  },
                ]),
              ),
            );
            if (matching[0]) setTotal(matching[0].totalMarks);
            history.current = [];
          }}
        >
          <option value="">اختر تقييمًا أو اكتب عنوانًا جديدًا</option>
          {[
            ...new Map(
              (grades.data || []).map((g) => [
                JSON.stringify({ title: g.title, date: g.date }),
                g,
              ]),
            ).entries(),
          ].map(([key, g]) => (
            <option value={key} key={key}>
              {g.title} — {g.date}
            </option>
          ))}
        </select>
      </Field>
      <Field label={c.titleField}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={c.date}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      <Field label={c.total}>
        <input
          type="number"
          step="any"
          min={0.1}
          value={total}
          onChange={(e) => setTotal(Number(e.target.value))}
        />
      </Field>
      <div className="tl-table">
        <table>
          <thead>
            <tr>
              <th>اختيار</th>
              <th>{c.student}</th>
              <th>{c.marks}</th>
              <th>الحالة</th>
              <th>{c.weight}</th>
              <th>{c.notes}</th>
            </tr>
          </thead>
          <tbody>
            {students.data
              ?.filter((s) => !s.removed && !s.archived)
              .map((s, i) => (
                <tr key={s.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={"تحديد " + s.name}
                      checked={selected.includes(s.id)}
                      onChange={() =>
                        setSelected((old) =>
                          old.includes(s.id)
                            ? old.filter((id) => id !== s.id)
                            : [...old, s.id],
                        )
                      }
                    />
                  </td>
                  <th>{s.name}</th>
                  <td>
                    <input
                      data-grade-index={i}
                      aria-label={"درجة " + s.name}
                      inputMode="decimal"
                      value={rows[s.id]?.marks || ""}
                      onChange={(e) => change(s.id, { marks: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "ArrowDown") {
                          e.preventDefault();
                          document
                            .querySelector<HTMLInputElement>(
                              `[data-grade-index="${i + 1}"]`,
                            )
                            ?.focus();
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          document
                            .querySelector<HTMLInputElement>(
                              `[data-grade-index="${i - 1}"]`,
                            )
                            ?.focus();
                        }
                      }}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={"حالة " + s.name}
                      value={rows[s.id]?.status || "graded"}
                      onChange={(e) => change(s.id, { status: e.target.value })}
                    >
                      <option value="graded">{c.graded}</option>
                      <option value="missing">{c.missingStatus}</option>
                      <option value="absent">{c.absent}</option>
                      <option value="exempt">{c.exempt}</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="any"
                      min={0}
                      max={10000}
                      aria-label={"وزن " + s.name}
                      value={rows[s.id]?.weight ?? total}
                      onChange={(e) =>
                        change(s.id, { weight: Number(e.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={"تعليق " + s.name}
                      value={rows[s.id]?.note || ""}
                      onChange={(e) => change(s.id, { note: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <button
        disabled={!history.current.length}
        onClick={() => {
          const old = history.current.pop();
          if (old) setRows(old);
        }}
      >
        {c.undo}
      </button>
      <button
        disabled={busy || !title || !students.data?.length}
        onClick={() => {
          if (confirm("حفظ الحالات والأوزان والدرجات المعروضة؟")) void save();
        }}
      >
        {c.save}
      </button>
      <Field label={c.feedback}>
        <select
          value={feedbackId}
          onChange={(e) => setFeedbackId(e.target.value)}
        >
          <option value="">اختر تعليقًا محفوظًا</option>
          {feedback.data?.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
            </option>
          ))}
        </select>
      </Field>
      <button
        disabled={busy || !selected.length || !feedbackId || !title}
        onClick={() => {
          if (
            !confirm(
              "تطبيق التعليق على " +
                selected.length +
                " طالبًا في التقييم المحفوظ؟ سيستبدل التعليق السابق دون تغيير الدرجة.",
            )
          )
            return;
          setBusy(true);
          void teacherApi<{ updated: number }>(
            "/teacher/tools/feedback/apply",
            "POST",
            {
              classId,
              studentIds: selected,
              feedbackId,
              title,
              date,
              confirmed: true,
            },
          )
            .then((r) => {
              setMessage("حُدث " + r.updated + " تعليق.");
              void qc.invalidateQueries({ queryKey: ["grade-grid-records"] });
            })
            .catch((e) => setError(errorText(e)))
            .finally(() => setBusy(false));
        }}
      >
        تطبيق التعليق بعد التأكيد
      </button>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
export function TeacherPrivacy() {
  const [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <article>
      <h2>{c.privacy}</h2>
      <p>{c.deleteWarning}</p>
      <a
        href="/api/teacher/tools/export"
        download="teacher-private-export.json"
      >
        {c.export}
      </a>
      <Field label={c.confirmation}>
        <input
          dir="ltr"
          autoComplete="off"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </Field>
      <button
        disabled={confirmation !== "DELETE_TEACHER_DATA" || busy}
        onClick={() => {
          if (!confirm(c.deleteWarning)) return;
          setBusy(true);
          void teacherApi("/teacher/tools/delete-data", "POST", {
            confirmation,
          })
            .then(() => {
              setMessage(c.dataDeleteDone);
              location.assign("/teacher/onboarding");
            })
            .catch((e) => setMessage(errorText(e)))
            .finally(() => setBusy(false));
        }}
      >
        {c.deleteAll}
      </button>
      {message && <p role="status">{message}</p>}
    </article>
  );
}
function TemplateSharing({ records }: { records: ToolRecord[] }) {
  const qc = useQueryClient(),
    shares = useQuery({
      queryKey: ["teacher-shares"],
      queryFn: () =>
        teacherApi<{ id: string; enabled: boolean; kind: string }[]>(
          "/teacher/tools/shares",
        ),
    });
  const [selected, setSelected] = useState(""),
    [token, setToken] = useState(""),
    [newToken, setNewToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["teacher-shares"] });
      await qc.invalidateQueries({ queryKey: ["teacher-tools"] });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article>
      <h3>{c.share}</h3>
      <p>
        {c.shareWarning} المشاركة تنقل الهيكل والأوزان فقط؛ تُفرغ النصوص
        والموارد والفصل وتستبدل العناوين بأسماء عامة.
      </p>
      <Field label={c.titleField}>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">اختر قالبًا محفوظًا</option>
          {records.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
      </Field>
      <button
        disabled={busy || !selected}
        onClick={() => {
          if (!confirm(c.shareWarning)) return;
          void run(async () => {
            const r = await teacherApi<{ token: string }>(
              "/teacher/tools/shares",
              "POST",
              { recordId: selected, reviewed: true },
            );
            setNewToken(r.token);
          });
        }}
      >
        {c.share}
      </button>
      {newToken && (
        <p>
          {c.token}: <bdi>{newToken}</bdi>
        </p>
      )}
      <Field label={c.token}>
        <input
          dir="ltr"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </Field>
      <button
        disabled={busy || token.length < 32}
        onClick={() =>
          void run(async () => {
            await teacherApi("/teacher/tools/shares/import", "POST", { token });
            setToken("");
          })
        }
      >
        {c.importShare}
      </button>
      {shares.data
        ?.filter((s) => s.enabled)
        .map((s, i) => (
          <p key={s.id}>
            مشاركة {i + 1}{" "}
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await teacherApi("/teacher/tools/shares/" + s.id, "DELETE");
                })
              }
            >
              {c.revoke}
            </button>
          </p>
        ))}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
function SchoolPackets() {
  const qc = useQueryClient(),
    classes = useQuery({
      queryKey: ["teacher", "classes"],
      queryFn: () => teacherApi<TeacherClass[]>("/teacher/classes"),
    });
  const [classId, setClassId] = useState(""),
    [studentId, setStudentId] = useState(""),
    [type, setType] = useState("absence_pack"),
    [from, setFrom] = useState(today()),
    [to, setTo] = useState(today()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const students = useQuery({
    queryKey: ["packet-students", classId],
    queryFn: () =>
      teacherApi<TeacherStudent[]>("/teacher/students?classId=" + classId),
    enabled: !!classId,
  });
  return (
    <article>
      <h3>حزمة من السجلات الفعلية</h3>
      <p>{c.draft}</p>
      <Field label={c.type}>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="absence_pack">{documentTypes.absence_pack}</option>
          <option value="substitute">{documentTypes.substitute}</option>
        </select>
      </Field>
      <Field label={c.class}>
        <select
          value={classId}
          onChange={(e) => {
            setClassId(e.target.value);
            setStudentId("");
          }}
        >
          <option value="">اختر الفصل</option>
          {classes.data?.map((cl) => (
            <option key={cl.id} value={cl.id}>
              {cl.name}
            </option>
          ))}
        </select>
      </Field>
      {type === "absence_pack" && (
        <Field label={c.student}>
          <select
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          >
            <option value="">اختر الطالب</option>
            {students.data
              ?.filter((s) => !s.removed)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      <Field label="من">
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </Field>
      <Field label="إلى">
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </Field>
      <button
        disabled={busy || !classId || (type === "absence_pack" && !studentId)}
        onClick={() => {
          setBusy(true);
          setError("");
          void teacherApi("/teacher/tools/packets", "POST", {
            type,
            classId,
            studentId: type === "absence_pack" ? studentId : undefined,
            from,
            to,
          })
            .then(() =>
              qc.invalidateQueries({
                queryKey: ["teacher-tools", "documents"],
              }),
            )
            .catch((e) => setError(errorText(e)))
            .finally(() => setBusy(false));
        }}
      >
        تجميع مسودة قابلة للمراجعة
      </button>
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
export function RosterSnapshots() {
  const qc = useQueryClient(),
    classes = useQuery({
      queryKey: ["teacher", "classes"],
      queryFn: () => teacherApi<TeacherClass[]>("/teacher/classes"),
    }),
    snapshots = useQuery({
      queryKey: ["roster-snapshots"],
      queryFn: () =>
        teacherApi<
          {
            id: string;
            classId: string;
            term: string;
            students: { id: string; name: string; internal_id: string }[];
          }[]
        >("/teacher/tools/roster-snapshots"),
    });
  const [classId, setClassId] = useState(""),
    [term, setTerm] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <article>
      <h3>{c.snapshot}</h3>
      <Field label={c.class}>
        <select
          value={classId}
          onChange={(e) => {
            setClassId(e.target.value);
            setTerm(
              classes.data?.find((c) => c.id === e.target.value)?.term || "",
            );
          }}
        >
          <option value="">اختر الفصل</option>
          {classes.data?.map((cl) => (
            <option key={cl.id} value={cl.id}>
              {cl.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={c.term}>
        <input value={term} onChange={(e) => setTerm(e.target.value)} />
      </Field>
      <button
        disabled={busy || !classId || !term}
        onClick={() => {
          setBusy(true);
          setError("");
          void teacherApi("/teacher/tools/roster-snapshots", "POST", {
            classId,
            term,
          })
            .then(() =>
              qc.invalidateQueries({ queryKey: ["roster-snapshots"] }),
            )
            .catch((e) => setError(errorText(e)))
            .finally(() => setBusy(false));
        }}
      >
        {c.snapshot}
      </button>
      {error && <p role="alert">{error}</p>}
      {snapshots.data?.map((s) => (
        <details key={s.id}>
          <summary>
            {classes.data?.find((c) => c.id === s.classId)?.name} — {s.term} (
            {s.students.length})
          </summary>
          {s.students.map((student) => (
            <p key={student.id}>
              {student.name} — {student.internal_id}
            </p>
          ))}
        </details>
      ))}
    </article>
  );
}
