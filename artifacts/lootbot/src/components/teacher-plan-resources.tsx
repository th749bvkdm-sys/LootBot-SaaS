import { useQuery } from "@tanstack/react-query";
import { teacherApi } from "../lib/teacher-api";
import { teacherExtraCopy as c } from "../lib/teacher-extra-copy";
export function PlanResourcePicker({
  ids,
  onChange,
}: {
  ids: string[];
  onChange?: (ids: string[]) => void;
}) {
  const q = useQuery({
    queryKey: ["teacher-tools", "resources"],
    queryFn: () =>
      teacherApi<{ id: string; title: string; type: string; refId: string }[]>(
        "/teacher/tools/resources",
      ),
  });
  return (
    <div className="tw-field wide">
      <strong>{c.resource}</strong>
      {q.error && <p role="alert">{q.error.message}</p>}
      {onChange && (
        <select
          aria-label={c.resource}
          value=""
          onChange={(e) => {
            if (e.target.value && !ids.includes(e.target.value))
              onChange([...ids, e.target.value]);
          }}
        >
          <option value="">{c.source}</option>
          {q.data
            ?.filter((r) => !ids.includes(r.id))
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
        </select>
      )}
      <ul>
        {ids.map((id) => {
          const r = q.data?.find((r) => r.id === id);
          return (
            <li key={id}>
              {r ? (
                <a
                  href={
                    r.type === "asset"
                      ? "/api/teacher/assets/" + r.refId
                      : r.type === "exam"
                        ? "/teacher/exams"
                        : r.type === "activity"
                          ? "/teacher/activities"
                          : r.type === "lesson_plan"
                            ? "/teacher/lessons"
                            : "/teacher/questions"
                  }
                >
                  {r.title}
                </a>
              ) : (
                c.open
              )}
              {onChange && (
                <button
                  type="button"
                  className="tw-button"
                  onClick={() => onChange(ids.filter((v) => v !== id))}
                >
                  {c.remove}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
