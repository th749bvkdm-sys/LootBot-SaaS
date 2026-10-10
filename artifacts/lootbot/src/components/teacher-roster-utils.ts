/** CSV import and export are local: names and private notes never enter a URL. */
export type RosterImportRow = {
  row: number;
  name: string;
  internalId: string;
  notes: string;
  errors: string[];
  matchedId?: string;
};

export function normalizeTeacherDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x6f0 ? code - 0x6f0 : code - 0x660);
  });
}

export function parseRosterCsv(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const delimiter = firstLine.includes("\t")
    ? "\t"
    : (firstLine.match(/;/g)?.length ?? 0) >
        (firstLine.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (quoted || field.length === 0) quoted = !quoted;
      else field += char;
    } else if (!quoted && char === delimiter) {
      row.push(field);
      field = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (quoted)
    throw new Error("علامة اقتباس غير مغلقة في الملف. راجع تنسيق CSV.");
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length > 2001)
    throw new Error("الحد الأقصى ٢٠٠٠ طالب في الاستيراد الواحد.");
  return rows.filter((values) => values.some((value) => value.trim()));
}

export function rosterImportPreview(
  rows: string[][],
  columns: { name: number; internalId: number; notes: number },
  existing: { id: string; name: string; internalId?: string | null }[],
): RosterImportRow[] {
  const seen = new Set<string>();
  const normalizedName = (value: string) =>
    value.trim().replace(/\s+/g, " ").normalize("NFKC");
  return rows.slice(1).map((values, index) => {
    const name = normalizedName(values[columns.name] ?? "");
    const internalId = normalizeTeacherDigits(
      (values[columns.internalId] ?? "").trim(),
    );
    const notes = (values[columns.notes] ?? "").trim();
    const errors: string[] = [];
    if (!name) errors.push("اسم الطالب فارغ");
    if (name.length > 150) errors.push("الاسم أطول من ١٥٠ حرفًا");
    if (internalId.length > 80) errors.push("الرقم الداخلي أطول من ٨٠ حرفًا");
    if (notes.length > 4000) errors.push("الملاحظات أطول من الحد المسموح");
    const key = internalId ? `id:${internalId}` : `name:${name}`;
    if (seen.has(key)) errors.push("صف مكرر داخل الملف");
    seen.add(key);
    const matches = existing.filter((student) =>
      internalId
        ? normalizeTeacherDigits(student.internalId ?? "") === internalId
        : normalizedName(student.name) === name,
    );
    if (matches.length > 1)
      errors.push("أكثر من طالب مطابق؛ راجع الرقم الداخلي");
    return {
      row: index + 2,
      name,
      internalId,
      notes,
      errors,
      matchedId: matches.length === 1 ? matches[0].id : undefined,
    };
  });
}

export function safeCsvCell(value: unknown): string {
  const string = String(value ?? "").replace(/\u0000/g, "");
  // Excel may treat leading whitespace followed by a formula sigil as executable.
  const safe = /^[\s\uFEFF]*[=+@-]/.test(string) ? `'${string}` : string;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildTeacherCsv(rows: unknown[][]): string {
  return (
    "\uFEFF" + rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n")
  );
}

export function downloadTeacherCsv(filename: string, rows: unknown[][]): void {
  const url = URL.createObjectURL(
    new Blob([buildTeacherCsv(rows)], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
