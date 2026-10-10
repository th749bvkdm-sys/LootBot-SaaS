// Browser acceptance uses only the disposable local fixture. No production URLs or data.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = process.env.TEACHER_QA_URL ?? "http://127.0.0.1:5190";
if (!["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname))
  throw new Error("Teacher browser acceptance only permits a local fixture.");
const bundledModules =
  process.env.TEACHER_QA_NODE_MODULES ??
  path.join(
    process.env.USERPROFILE ?? "",
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules",
  );
let playwright;
if (process.env.PLAYWRIGHT_MODULE) {
  playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
} else {
  try {
    playwright = createRequire(import.meta.url)("playwright");
  } catch {
    playwright = createRequire(path.join(bundledModules, "__acceptance__.cjs"))(
      "playwright",
    );
  }
}
const output = path.resolve("artifacts/lootbot/test-results/teacher");
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : { channel: process.env.TEACHER_QA_BROWSER_CHANNEL ?? "msedge" }),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "ar-SA",
  timezoneId: "Asia/Riyadh",
  reducedMotion: "reduce",
});
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const errors = [],
  results = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => void dialog.accept());
const email = `teacher-ui-${Date.now()}@example.invalid`,
  password = "Local-Fixture-Only-2026!";
const className = "فصل اختبار الواجهة",
  studentName = "طالب اختبار أول",
  secondStudent = "طالب اختبار ثان";
let classId;
async function check(name, action) {
  const started = Date.now();
  try {
    await action();
    results.push({ name, passed: true, milliseconds: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: error.message,
      milliseconds: Date.now() - started,
    });
    throw error;
  }
}
async function open(section) {
  await page.goto(`${baseUrl}/teacher${section ? "/" + section : ""}`);
  await page.locator(".tw-page").waitFor();
}
async function closeModal() {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "إغلاق", exact: true })
    .click();
}
async function selectClass() {
  await page
    .getByRole("combobox", { name: "الفصل", exact: true })
    .first()
    .selectOption(classId);
}
async function api(resource) {
  const response = await context.request.get(
    `${baseUrl}/api/teacher/${resource}`,
  );
  assert.equal(response.status(), 200, resource);
  return response.json();
}

try {
  await check(
    "Arabic registration, persisted role choice, saved and resumable profile wizard",
    async () => {
      await page.goto(`${baseUrl}/register`);
      await page.locator('input[name="name"]').fill("معلم اختبار الواجهة");
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByTestId("button-submit").click();
      await page.getByRole("button", { name: /^معلم/ }).click();
      await page.getByLabel(/اسم المعلم أو المعلمة/).fill("معلم تجريبي");
      await page.getByLabel(/اسم المدرسة/).fill("مدرسة اختبار الواجهة");
      await page
        .getByRole("button", { name: "حفظ ومتابعة", exact: true })
        .click();
      await page.getByLabel(/^المواد/).fill("رياضيات، علوم");
      await page.getByLabel(/^الفصول التي تدرّسها/).fill("الأول أ، الثاني ب");
      await page
        .getByLabel("العام الدراسي", { exact: true })
        .fill("١٤٤٨ / ١٤٤٩");
      await page
        .getByLabel("الفصل الدراسي", { exact: true })
        .fill("الفصل الأول");
      await page
        .getByRole("button", { name: "حفظ التقدم", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "حُفظت بياناتك" })
        .waitFor();
      await page.reload();
      assert.equal(
        await page.getByLabel(/^المواد/).inputValue(),
        "رياضيات، علوم",
      );
      await page
        .getByRole("button", { name: "حفظ ومتابعة", exact: true })
        .click();
      await page
        .getByLabel("تصميم الطباعة الافتراضي", { exact: true })
        .selectOption("minimal");
      await page
        .getByRole("button", { name: "فتح غرفة المعلم", exact: true })
        .click();
      await page.waitForURL(`${baseUrl}/teacher`);
      await page.locator(".tw-page").waitFor();
      const profile = await api("profile");
      assert.equal(profile.complete, true);
      assert.deepEqual(profile.subjects, ["رياضيات", "علوم"]);
      assert.equal(profile.printStyle, "minimal");
      const account = await context.request.get(
        `${baseUrl}/api/account/workspace`,
      );
      assert.equal((await account.json()).accountType, "teacher");
    },
  );
  await check(
    "Class creation and saved editable gradebook templates survive refresh",
    async () => {
      await open("classes");
      await page
        .getByRole("button", { name: "إنشاء فصل", exact: true })
        .first()
        .click();
      const modal = page.getByRole("dialog");
      await modal.getByLabel(/اسم الفصل/).fill(className);
      await modal.getByLabel("الصف", { exact: true }).fill("الأول");
      await modal.getByLabel("الشعبة", { exact: true }).fill("أ");
      await modal
        .getByLabel("عنوان التقييم 1", { exact: true })
        .fill("المشاركة التجريبية");
      await modal
        .getByRole("button", { name: "حفظ الفصل", exact: true })
        .click();
      await modal.waitFor({ state: "hidden" });
      await page.reload();
      await page
        .getByRole("heading", { name: className, exact: true })
        .waitFor();
      const classes = await api("classes");
      const created = classes.find((item) => item.name === className);
      assert.ok(created);
      classId = created.id;
      assert.equal(created.subject, "رياضيات");
      assert.equal(created.year, "1448 / 1449");
      assert.equal(created.gradebookTemplate.length, 3);
      assert.equal(created.gradebookTemplate[0].title, "المشاركة التجريبية");
    },
  );
  await check(
    "Manual student creation, keyboard dialog focus, private profile and persistence",
    async () => {
      await open("students");
      await selectClass();
      await page
        .getByRole("button", { name: "إضافة طالب", exact: true })
        .first()
        .click();
      const modal = page.getByRole("dialog");
      await modal.getByLabel(/اسم الطالب/).fill(studentName);
      await modal.getByLabel(/الرقم الداخلي/).fill("٠٠١");
      await modal
        .getByLabel("ملاحظات خاصة بالمعلم", { exact: true })
        .fill("ملاحظة تجريبية خاصة");
      await modal
        .getByRole("button", { name: "حفظ الطالب", exact: true })
        .click();
      await modal.waitFor({ state: "hidden" });
      await page.reload();
      await selectClass();
      await page
        .getByRole("button", { name: studentName, exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByText("ملاحظة تجريبية خاصة", { exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      const students = await api(`students?classId=${classId}`);
      assert.equal(students[0].internalId, "001");
    },
  );
  await check(
    "CSV column mapping, row errors, explicit add mode, existing matches and import summary",
    async () => {
      await page
        .getByRole("button", { name: "استيراد كشف", exact: true })
        .click();
      const modal = page.getByRole("dialog");
      const upload = modal.locator("input[type=file]");
      await upload.setInputFiles({
        name: "bad.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          `اسم الطالب,الرقم الداخلي,ملاحظات\n${studentName},001,ملاحظة مختلفة\n${secondStudent},002,\nطالب مكرر,002,`,
        ),
      });
      await modal
        .getByRole("button", { name: "فحص الصفوف والمطابقات", exact: true })
        .click();
      await modal.getByText(/صف مكرر|مكرر داخل/).waitFor();
      assert.equal(
        await modal
          .getByRole("button", { name: "تأكيد وحفظ الكشف", exact: true })
          .isEnabled(),
        false,
      );
      await upload.setInputFiles({
        name: "good.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          `اسم الطالب,الرقم الداخلي,ملاحظات\n${studentName},001,ملاحظة مختلفة\n${secondStudent},002,`,
        ),
      });
      await modal
        .getByRole("button", { name: "فحص الصفوف والمطابقات", exact: true })
        .click();
      await modal.getByText("مطابق لطالب موجود", { exact: true }).waitFor();
      await modal
        .getByRole("button", { name: "إضافة الجدد فقط", exact: true })
        .click();
      await modal
        .getByRole("button", { name: "تأكيد وحفظ الكشف", exact: true })
        .click();
      await modal.waitFor({ state: "hidden" });
      const students = await api(`students?classId=${classId}`);
      assert.equal(students.length, 2);
      assert.equal(
        students.find((item) => item.name === studentName).notes,
        "ملاحظة تجريبية خاصة",
      );
      assert.ok(
        (await api("reminders")).some(
          (item) => item.title === "ملخص استيراد الكشف",
        ),
      );
      await page
        .getByRole("button", { name: "استيراد كشف", exact: true })
        .click();
      const updateModal = page.getByRole("dialog");
      await updateModal
        .locator("input[type=file]")
        .setInputFiles({
          name: "update.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(
            `اسم الطالب,الرقم الداخلي,ملاحظات\n${studentName},001,ملاحظة بعد التحديث`,
          ),
        });
      await updateModal
        .getByRole("button", { name: "فحص الصفوف والمطابقات", exact: true })
        .click();
      await updateModal
        .getByText("مطابق لطالب موجود", { exact: true })
        .waitFor();
      await updateModal
        .getByRole("button", {
          name: "تحديث المطابقين وإضافة الجدد",
          exact: true,
        })
        .click();
      await updateModal
        .getByRole("button", { name: "تأكيد وحفظ الكشف", exact: true })
        .click();
      await updateModal.waitFor({ state: "hidden" });
      assert.equal(
        (await api(`students?classId=${classId}`)).find(
          (item) => item.name === studentName,
        ).notes,
        "ملاحظة بعد التحديث",
      );
    },
  );
  await check(
    "Student archive, restore, recoverable removal and removed archive visibility",
    async () => {
      await page
        .getByRole("button", { name: `أرشفة ${studentName}`, exact: true })
        .click();
      await page.getByRole("status").filter({ hasText: "تم الحفظ" }).waitFor();
      await page
        .getByLabel("عرض المؤرشفين والمحذوفين", { exact: true })
        .check();
      await page
        .getByRole("button", { name: `استعادة ${studentName}`, exact: true })
        .click();
      await page
        .getByLabel("عرض المؤرشفين والمحذوفين", { exact: true })
        .uncheck();
      await page
        .getByRole("button", { name: `حذف ${studentName}`, exact: true })
        .click();
      await page
        .getByLabel("عرض المؤرشفين والمحذوفين", { exact: true })
        .check();
      await page.getByText("محذوف قابل للاستعادة", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: `استعادة ${studentName}`, exact: true })
        .click();
      await page
        .getByLabel("عرض المؤرشفين والمحذوفين", { exact: true })
        .uncheck();
      assert.equal(
        (await api(`students?classId=${classId}&archived=false`)).length,
        2,
      );
    },
  );
  await check(
    "Attendance saved by class and date and reopened after reload",
    async () => {
      await open("attendance");
      await selectClass();
      await page
        .getByRole("combobox", { name: `حضور ${studentName}`, exact: true })
        .selectOption("absent");
      await page
        .getByRole("button", { name: "حفظ الحضور", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "حُفظ كشف الحضور" })
        .waitFor();
      await page.reload();
      await selectClass();
      assert.equal(
        await page
          .getByRole("combobox", { name: `حضور ${studentName}`, exact: true })
          .inputValue(),
        "absent",
      );
      assert.equal((await api(`attendance?classId=${classId}`)).length, 2);
    },
  );
  await check(
    "Gradebook preset, Arabic digits, atomic grades and saved assessment reopening",
    async () => {
      await open("grades");
      await selectClass();
      await page
        .getByLabel("ابدأ من قالب دفتر الدرجات", { exact: true })
        .selectOption("2");
      assert.equal(
        await page.getByLabel(/عنوان التقييم/).inputValue(),
        "اختبار قصير",
      );
      await page
        .getByRole("textbox", { name: `درجة ${studentName}`, exact: true })
        .fill("١٨");
      await page
        .getByRole("button", { name: "حفظ الدرجات", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "حُفظت درجات التقييم" })
        .waitFor();
      await page.reload();
      await selectClass();
      await page
        .getByLabel("تقييم محفوظ", { exact: true })
        .selectOption({ index: 1 });
      assert.equal(
        await page
          .getByRole("textbox", { name: `درجة ${studentName}`, exact: true })
          .inputValue(),
        "18",
      );
      const grades = await api(`grades?classId=${classId}`);
      assert.equal(grades.length, 2);
      assert.equal(grades.filter((grade) => grade.marks === null).length, 1);
    },
  );
  await check("Persisted assignment and student completion", async () => {
    await open("tasks");
    await page
      .getByRole("button", { name: "إضافة واجب أو مهمة", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    await modal.getByLabel(/العنوان/).fill("واجب اختبار الواجهة");
    await modal
      .getByRole("combobox", { name: "الفصل", exact: true })
      .selectOption(classId);
    await modal
      .getByRole("button", { name: "حفظ المهمة", exact: true })
      .click();
    await modal.waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "رصد التسليم", exact: true })
      .click();
    await page.getByRole("dialog").getByLabel(new RegExp(studentName)).check();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "حفظ الرصد", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal((await api("tasks"))[0].studentCompletion.length, 1);
  });
  await check(
    "Lesson preparation saved, duplicated and actual question-bank content saved",
    async () => {
      await open("lessons");
      await page
        .getByRole("button", { name: "تحضير جديد", exact: true })
        .click();
      let modal = page.getByRole("dialog");
      await modal.getByLabel(/عنوان الدرس/).fill("تحضير اختبار الواجهة");
      await modal
        .getByLabel("أهداف الدرس", { exact: true })
        .fill("هدف تعليمي تجريبي");
      await modal
        .getByLabel("الخطوات والأنشطة والتقويم", { exact: true })
        .fill("نشاط افتتاحي ومراجعة");
      await modal
        .getByRole("button", { name: "حفظ التحضير", exact: true })
        .click();
      await modal.waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "نسخة جديدة", exact: true })
        .click();
      modal = page.getByRole("dialog");
      await modal
        .getByRole("button", { name: "حفظ التحضير", exact: true })
        .click();
      await modal.waitFor({ state: "hidden" });
      assert.equal((await api("lessons")).length, 2);
      await open("questions");
      await page
        .getByRole("button", { name: "إضافة سؤال", exact: true })
        .click();
      modal = page.getByRole("dialog");
      await modal.getByLabel(/نص السؤال/).fill("ما ناتج ٢ + ٢؟");
      await modal
        .getByLabel("نوع السؤال", { exact: true })
        .selectOption("multiple-choice");
      await modal.getByLabel(/الخيارات/).fill("٣\n٤\n٥");
      await modal.getByLabel(/الإجابة المرجعية/).fill("٤");
      await modal
        .getByRole("button", { name: "حفظ السؤال", exact: true })
        .click();
      await modal.waitFor({ state: "hidden" });
      assert.deepEqual((await api("questions"))[0].options, ["٣", "٤", "٥"]);
    },
  );
  await check(
    "Automation rule, persisted schedule and repeated review without duplicate reminders",
    async () => {
      await open("automations");
      await page
        .getByRole("button", { name: "قاعدة جديدة", exact: true })
        .click();
      const modal = page.getByRole("dialog");
      await modal.getByLabel(/اسم القاعدة/).fill("تذكير اختبار يومي");
      await modal
        .getByLabel("المحفّز", { exact: true })
        .selectOption("recurring");
      await modal
        .getByLabel("نص التذكير", { exact: true })
        .fill("راجع دفتر الاختبارات");
      await modal
        .getByRole("button", { name: "حفظ القاعدة", exact: true })
        .click();
      await modal.waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "فحص القواعد الآن", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "اكتملت مراجعة القواعد" })
        .waitFor();
      const count = (await api("reminders")).length;
      await page
        .getByRole("button", { name: "فحص القواعد الآن", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "اكتملت مراجعة القواعد" })
        .waitFor();
      assert.equal((await api("reminders")).length, count);
      const rules = await api("automations");
      assert.ok(rules[0].nextRunAt);
      assert.equal(rules[0].enabled, true);
    },
  );
  await check(
    "Real report print surface, A4 PDF, Arabic RTL and private-note exclusion",
    async () => {
      await open("reports");
      await selectClass();
      await page.evaluate(() => {
        window.print = () => {};
      });
      await page
        .getByRole("button", {
          name: "طباعة / حفظ PDF من المتصفح",
          exact: true,
        })
        .click();
      await page
        .locator(".tw-print-view[data-active=true]")
        .waitFor({ state: "attached" });
      await page.emulateMedia({ media: "print" });
      assert.equal(
        await page.locator(".tw-print-view[data-active=true]").isVisible(),
        true,
      );
      assert.equal(await page.locator(".tw-sidebar").isVisible(), false);
      assert.equal(
        await page
          .locator(".tw-print-view")
          .getByText("ملاحظة بعد التحديث")
          .count(),
        0,
      );
      await page.screenshot({
        path: path.join(output, "report-print.png"),
        fullPage: true,
      });
      await page.pdf({
        path: path.join(output, "roster-a4.pdf"),
        format: "A4",
        printBackground: false,
      });
      await page.emulateMedia({ media: "screen" });
    },
  );
  await check(
    "Bulk student move preserves the same ID and attendance, grade and assignment history",
    async () => {
      await open("classes");
      await page
        .getByRole("button", { name: "إنشاء فصل", exact: true })
        .first()
        .click();
      const modal = page.getByRole("dialog");
      await modal.getByLabel(/اسم الفصل/).fill("فصل نقل تجريبي");
      await modal
        .getByRole("button", { name: "حفظ الفصل", exact: true })
        .click();
      await modal.waitFor({ state: "hidden" });
      const targetId = (await api("classes")).find(
        (item) => item.name === "فصل نقل تجريبي",
      ).id;
      const original = (await api(`students?classId=${classId}`)).find(
        (item) => item.name === studentName,
      );
      const before = await api(`students/${original.id}/profile`);
      const move = async (from, to) => {
        await open("students");
        await page
          .getByRole("combobox", { name: "الفصل", exact: true })
          .first()
          .selectOption(from);
        await page
          .getByRole("checkbox", { name: `تحديد ${studentName}`, exact: true })
          .check();
        await page
          .getByRole("button", { name: "نقل إلى فصل", exact: true })
          .click();
        const moveModal = page.getByRole("dialog");
        await moveModal
          .getByRole("combobox", { name: "الفصل", exact: true })
          .selectOption(to);
        await moveModal
          .getByRole("button", { name: "تأكيد النقل", exact: true })
          .click();
        await moveModal.waitFor({ state: "hidden" });
      };
      await move(classId, targetId);
      const moved = (await api(`students?classId=${targetId}`)).find(
        (item) => item.name === studentName,
      );
      assert.equal(moved.id, original.id);
      const after = await api(`students/${original.id}/profile`);
      assert.equal(after.attendance.length, before.attendance.length);
      assert.equal(after.grades.length, before.grades.length);
      assert.equal(after.assignments.length, before.assignments.length);
      await move(targetId, classId);
    },
  );
  await check(
    "All teacher module routes, RTL, mobile/tablet/desktop and reduced motion",
    async () => {
      const sections = [
        "",
        "classes",
        "students",
        "attendance",
        "grades",
        "tasks",
        "lessons",
        "questions",
        "reports",
        "automations",
        "settings",
      ];
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: width < 800 ? 850 : 1100 });
        for (const section of sections) {
          await open(section);
          assert.equal(
            await page.locator(".teacher-room").getAttribute("dir"),
            "rtl",
          );
          assert.ok(await page.locator(".tw-page").isVisible());
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          assert.ok(
            overflow <= 1,
            `${section || "dashboard"} width ${width} overflow ${overflow}`,
          );
        }
        await open("");
        await page.screenshot({
          path: path.join(output, `dashboard-${width}.png`),
          fullPage: true,
        });
        if (width < 800) {
          await page
            .getByRole("button", { name: "فتح القائمة", exact: true })
            .click();
          await page.locator(".tw-sidebar.open").waitFor();
          assert.equal(
            await page.locator(".tw-sidebar.open").isVisible(),
            true,
          );
          await page
            .getByRole("button", { name: "إغلاق القائمة", exact: true })
            .click();
        }
      }
      assert.deepEqual(errors, []);
    },
  );
} catch (error) {
  console.error(`FAIL ${error.message}`);
  await page
    .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        fixture: baseUrl,
        fakeDataOnly: true,
        browser: "Edge Chromium",
        results,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  await context.close();
  await browser.close();
}
