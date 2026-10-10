import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTeacherCsv,
  normalizeTeacherDigits,
  parseRosterCsv,
  rosterImportPreview,
  safeCsvCell,
} from "./teacher-roster-utils.ts";

test("Arabic and Persian digits normalize without changing connected Arabic names", () => {
  assert.equal(normalizeTeacherDigits("طلاب ١٢٣ / ۴۵۶"), "طلاب 123 / 456");
});
test("CSV supports Arabic BOM, quoted commas, escaped quotes, and quoted line breaks", () => {
  assert.deepEqual(
    parseRosterCsv(
      '\uFEFFاسم الطالب,الرقم,ملاحظات\r\n"طالب، تجريبي",001,"نص ""مقتبس""\nسطر ثان"',
    ),
    [
      ["اسم الطالب", "الرقم", "ملاحظات"],
      ["طالب، تجريبي", "001", 'نص "مقتبس"\nسطر ثان'],
    ],
  );
  assert.deepEqual(parseRosterCsv("اسم;رقم\nطالب;1"), [
    ["اسم", "رقم"],
    ["طالب", "1"],
  ]);
  assert.deepEqual(parseRosterCsv("اسم\tرقم\nطالب\t1"), [
    ["اسم", "رقم"],
    ["طالب", "1"],
  ]);
});
test("unclosed quoting and excessive imports fail visibly", () => {
  assert.throws(() => parseRosterCsv('اسم,رقم\n"طالب,1'), /غير مغلقة/);
  assert.throws(() => parseRosterCsv("اسم\n" + "طالب\n".repeat(2001)), /٢٠٠٠/);
});
test("preview detects duplicate names, blank fields, matched IDs and never changes originals", () => {
  const existing = [
    { id: "fake-student-1", name: "طالب تجريبي", internalId: "12" },
  ];
  const preview = rosterImportPreview(
    [
      ["اسم", "رقم", "ملاحظات"],
      ["طالب تجريبي", "١٢", "ملاحظة"],
      ["طالب آخر", "١٢", ""],
      ["", "", ""],
    ],
    { name: 0, internalId: 1, notes: 2 },
    existing,
  );
  assert.equal(preview[0].matchedId, "fake-student-1");
  assert.equal(preview[0].internalId, "12");
  assert.match(preview[1].errors.join(" "), /مكرر/);
  assert.match(preview[2].errors.join(" "), /فارغ/);
  assert.deepEqual(existing, [
    { id: "fake-student-1", name: "طالب تجريبي", internalId: "12" },
  ]);
});
test("export neutralizes formulas, including hidden leading whitespace, and quotes all values", () => {
  for (const text of [
    "=1+1",
    "+SUM(1)",
    "@command",
    "-1+2",
    ' \t=HYPERLINK("evil")',
    "\r=1",
  ])
    assert.ok(safeCsvCell(text).startsWith("\"'"), text);
  assert.equal(safeCsvCell('طالب "تجريبي"'), '"طالب ""تجريبي"""');
  assert.equal(
    buildTeacherCsv([
      ["اسم", "رقم"],
      ["طالب تجريبي", "١٢"],
    ]),
    '\uFEFF"اسم","رقم"\r\n"طالب تجريبي","١٢"',
  );
});
