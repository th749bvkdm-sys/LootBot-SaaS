import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { teacherApi } from "../lib/teacher-api";
import { chemistryCopy as c } from "../lib/chemistry-copy";
import "./teacher-learning.css";
interface Species {
  formula: string;
  coefficient: number;
  phase: string;
}
export interface ChemistryResult {
  supported: boolean;
  message?: string;
  reaction?: {
    title: string;
    reactants: Species[];
    products: Species[];
    observation: string;
    explanation: string;
  };
  equation?: string;
  predictionCorrect?: boolean;
  balanced?: boolean;
  coefficients?: number[];
  before?: Record<string, number>;
  after?: Record<string, number>;
  source?: string;
  review?: string;
}
export interface Simulation {
  reactionId: string;
  title: string;
  reactants: string[];
  condition: string;
  scope: string;
}
export function ChemistryWorkbench({
  simulation,
  result,
  onRun,
  busy = false,
}: {
  simulation: Simulation;
  result?: ChemistryResult;
  onRun: (prediction: boolean, coefficients?: number[]) => void;
  busy?: boolean;
}) {
  const [prediction, setPrediction] = useState<boolean | null>(null),
    [coefficients, setCoefficients] = useState<number[]>([]);
  return (
    <section className="tl-step-editor">
      <h2>{simulation.title}</h2>
      <p>{c.scope}</p>
      <p>{c.objective}</p>
      <p>{c.noGrade}</p>
      <p>
        {c.reactants}: <bdi>{simulation.reactants.join(" + ")}</bdi>
      </p>
      <p>
        {c.condition}: {c.aqueous}
      </p>
      <div className="tl-toolbar">
        <button
          disabled={busy}
          aria-pressed={prediction === true}
          onClick={() => setPrediction(true)}
        >
          {c.yes}
        </button>
        <button
          disabled={busy}
          aria-pressed={prediction === false}
          onClick={() => setPrediction(false)}
        >
          {c.no}
        </button>
        <button
          disabled={busy || prediction === null}
          onClick={() =>
            onRun(prediction!, coefficients.length ? coefficients : result?.coefficients)
          }
        >
          {busy ? c.loading : c.run}
        </button>
      </div>
      {result && (
        <>
          {result.supported && result.reaction ? (
            <>
              <p role="status">
                {result.predictionCorrect ? c.correct : c.wrong}
              </p>
              <h3>{c.explain}</h3>
              <p>{result.reaction.observation}</p>
              <p>{result.reaction.explanation}</p>
              <p dir="ltr">{result.equation}</p>
              <p>{result.balanced ? c.balanced : c.unbalanced}</p>
              <p>{c.particles}</p>
              <div className="tl-grid">
                <AtomView title={c.before} totals={result.before || {}} />
                <AtomView title={c.after} totals={result.after || {}} />
              </div>
              <fieldset>
                <legend>{c.coefficients}</legend>
                {[
                  ...result.reaction.reactants,
                  ...result.reaction.products,
                ].map((s, i) => (
                  <label key={i}>
                    {s.formula}
                    <input
                      type="number"
                      aria-label={"معامل " + s.formula + " " + i}
                      min={1}
                      max={20}
                      value={
                        coefficients[i] ??
                        result.coefficients?.[i] ??
                        s.coefficient
                      }
                      onChange={(e) =>
                        setCoefficients((old) =>
                          [
                            ...result.reaction!.reactants,
                            ...result.reaction!.products,
                          ].map((_, n) =>
                            n === i
                              ? Number(e.target.value)
                              : (old[n] ??
                                result.coefficients?.[n] ??
                                [
                                  ...result.reaction!.reactants,
                                  ...result.reaction!.products,
                                ][n].coefficient),
                          ),
                        )
                      }
                    />
                  </label>
                ))}
              </fieldset>
              <a href={result.source} target="_blank" rel="noreferrer">
                {c.source}
              </a>
              <p>{result.review}</p>
            </>
          ) : (
            <p role="status">{result.message || c.unsupported}</p>
          )}
        </>
      )}
    </section>
  );
}
function AtomView({
  title,
  totals,
}: {
  title: string;
  totals: Record<string, number>;
}) {
  const atoms = Object.entries(totals).flatMap(([element, count]) =>
    Array.from({ length: count }, () => element),
  );
  return (
    <figure>
      <figcaption>{title}</figcaption>
      <svg
        viewBox="0 0 300 150"
        role="img"
        aria-label={Object.entries(totals)
          .map(([e, n]) => e + ": " + n)
          .join("، ")}
      >
        {atoms.slice(0, 20).map((element, i) => (
          <g
            key={i}
            transform={`translate(${30 + (i % 5) * 58},${25 + Math.floor(i / 5) * 35})`}
          >
            <circle r="16" fill="#53668b" stroke="#c7d2f8" />
            <text textAnchor="middle" y="5" fill="white" fontSize="12">
              {element}
            </text>
          </g>
        ))}
      </svg>
      <p dir="ltr">
        {Object.entries(totals)
          .map(([e, n]) => e + ": " + n)
          .join(" | ")}
      </p>
    </figure>
  );
}
export function TeacherChemistry() {
  const q = useQuery({
    queryKey: ["chemistry-catalog"],
    queryFn: () =>
      teacherApi<{
        reactions: (Omit<Simulation, "reactants"> & {
          id: string;
          reactants: Species[];
        })[];
        substances: { id: string; name: string }[];
        version: string;
        scope: string;
        review: string;
      }>("/teacher/chemistry/catalog"),
  });
  const [reactionId, setReactionId] = useState(""),
    [result, setResult] = useState<ChemistryResult>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [resetEpoch, setResetEpoch] = useState(0),
    [left, setLeft] = useState(""),
    [right, setRight] = useState("");
  const reaction =
    q.data?.reactions.find((r) => r.id === reactionId) || q.data?.reactions[0];
  async function run(prediction: boolean, coefficients?: number[]) {
    setBusy(true);
    setError("");
    try {
      setResult(
        await teacherApi("/teacher/chemistry/check", "POST", {
          reactants:
            left || right
              ? [left, right].filter(Boolean)
              : reaction?.reactants.map((r) => r.formula),
          condition: "aqueous",
          predictsReaction: prediction,
          coefficients,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : c.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="tl" dir="rtl">
      <h2>{c.title}</h2>
      <p>{c.review}</p>
      {q.isLoading && <p>{c.loading}</p>}
      {(error || q.error) && (
        <p role="alert" className="tl-error">
          {error || c.error}
        </p>
      )}
      {q.data && reaction && (
        <>
          <label className="tl-field">
            نموذج موثق
            <select
              aria-label="نموذج موثق"
              value={reaction.id}
              onChange={(e) => {
                setReactionId(e.target.value);
                setResult(undefined);
                setLeft("");
                setRight("");
              }}
            >
              {q.data.reactions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </label>
          <div className="tl-grid">
            {[left, right].map((value, i) => (
              <label className="tl-field" key={i}>
                {c.reactants} {i + 1}
                <select
                  aria-label={c.reactants + " " + (i + 1)}
                  value={value}
                  onChange={(e) => {
                    if (i) setRight(e.target.value);
                    else setLeft(e.target.value);
                    setResult(undefined);
                  }}
                >
                  <option value="">استخدم النموذج المختار</option>
                  {q.data?.substances.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.id}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <ChemistryWorkbench
            key={reaction.id + left + right + resetEpoch}
            simulation={{
              reactionId: reaction.id,
              title: reaction.title,
              reactants:
                left || right
                  ? [left, right].filter(Boolean)
                  : reaction.reactants.map((r) => r.formula),
              condition: "aqueous",
              scope: q.data.scope,
            }}
            result={result}
            busy={busy}
            onRun={(p, coeff) => void run(p, coeff)}
          />
          <div className="tl-toolbar">
            <button
              onClick={() => {
                setResult(undefined);
                setLeft("");
                setRight("");
                setResetEpoch((n) => n + 1);
              }}
            >
              {c.reset}
            </button>
            <button disabled={!result} onClick={() => setResult(undefined)}>
              {c.undo}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (!confirm("إنشاء نشاط ثابت من النموذج الموثق؟")) return;
                setBusy(true);
                void teacherApi("/teacher/chemistry/activity", "POST", {
                  reactionId: reaction.id,
                })
                  .then(() => setSaved(true))
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              {c.assign}
            </button>
          </div>
          {saved && (
            <p role="status">
              {c.saved} <Link href="/teacher/activities">الدروس التفاعلية</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
