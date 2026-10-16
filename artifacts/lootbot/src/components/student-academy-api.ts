import { useQuery } from "@tanstack/react-query";
import { teacherApi } from "../lib/teacher-api";
export type AcademyRow = Record<string, any>;
export const academyApi = <T = AcademyRow>(
  path: string,
  method = "GET",
  body?: unknown,
) => teacherApi<T>("/student-academy" + path, method, body);
export const studyApi = <T = AcademyRow>(
  path: string,
  method = "GET",
  body?: unknown,
) => teacherApi<T>("/student-study" + path, method, body);
export function useAcademy<T = AcademyRow>(path: string, enabled = true) {
  return useQuery({
    queryKey: ["student-academy", path],
    queryFn: () => academyApi<T>(path),
    enabled,
    retry: false,
  });
}
export function useStudy<T = AcademyRow>(
  path: string,
  enabled = true,
  poll?: number,
) {
  return useQuery({
    queryKey: ["student-study", path],
    queryFn: () => studyApi<T>(path),
    enabled,
    retry: false,
    refetchInterval: poll,
  });
}
export const studentNumber = (n: unknown) =>
  Number(n || 0).toLocaleString("ar-SA");
export const studentPercent = (n: unknown) =>
  `${studentNumber(Math.round(Number(n || 0)))}٪`;
export function saveDownload(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
