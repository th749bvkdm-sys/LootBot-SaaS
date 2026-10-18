/** Local-only acceptance of the redesigned rooms. Never uses a production database. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const root = process.cwd(),
  base = "http://127.0.0.1:5197",
  out = path.join(root, "artifacts/lootbot/test-results/redesign");
const runtime = path.join(
  process.env.USERPROFILE,
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules",
);
const { chromium } = createRequire(path.join(runtime, "__qa.cjs"))(
  "playwright",
);
await mkdir(out, { recursive: true });
const results = [],
  errors = [];
let browser, page;
const fixture = spawn(
  process.execPath,
  ["tests/run-teacher-local.mjs", "tests/education-ui-server.ts", "--serve"],
  {
    cwd: path.join(root, "artifacts/api-server"),
    env: {
      ...process.env,
      EDUCATION_PREVIEW_PORT: "5197",
      WORKSPACE_REDESIGN_QA: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  },
);
const closed = new Promise((r) => fixture.once("exit", r));
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, passed: false, error: e.message });
    throw e;
  }
};
async function api(context, resource, method = "GET", data) {
  const headers = {};
  if (method !== "GET") {
    const csrf = await (
      await context.request.get(base + "/api/auth/csrf")
    ).json();
    headers["x-csrf-token"] = csrf.token;
  }
  const response = await context.request.fetch(base + "/api" + resource, {
    method,
    headers,
    ...(data === undefined ? {} : { data }),
  });
  assert.ok(
    response.ok(),
    resource + ": " + response.status() + " " + (await response.text()),
  );
  return response.json();
}
async function noOverflow(label) {
  const details = await page.evaluate(() => ({
    width: innerWidth,
    total: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll("body *")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return (
          r.width &&
          r.right > innerWidth + 1 &&
          !e.closest("[hidden],[aria-hidden=true]")
        );
      })
      .slice(0, 8)
      .map((e) => ({
        tag: e.tagName,
        class: e.className,
        width: e.getBoundingClientRect().width,
        right: e.getBoundingClientRect().right,
      })),
  }));
  assert.ok(
    details.total <= details.width + 1,
    label + " " + JSON.stringify(details),
  );
}
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Local fixture startup timeout")),
      60000,
    );
    fixture.stdout.on("data", (b) => {
      if (b.toString().includes("EDUCATION_PREVIEW_READY")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    fixture.stderr.on("data", (b) => process.stderr.write(b));
    fixture.once("exit", (c) => {
      clearTimeout(timeout);
      reject(Error("Fixture exited " + c));
    });
  });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "ar-SA",
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => void d.accept());
  await page.goto(base + "/__preview/teacher");
  await page.locator(".tw-page").waitFor();
  const classes = (await api(context, "/teacher/classes")).filter(
      (c) => !c.archived,
    ),
    roster = await api(context, "/teacher/students"),
    classId = roster[0].classId;
  await api(context, "/teacher/students", "POST", {
    classId,
    name: "طالب ثان لاختبار عدم التكرار",
    internalId: "redesign-2",
    notes: "",
    archived: false,
  });
  await check(
    "shared class persists across attendance, grades, tasks, reports and education",
    async () => {
      await page.goto(base + "/teacher/students");
      const select = page
        .getByRole("combobox", { name: "الفصل", exact: true })
        .first();
      await select.selectOption(classId);
      for (const section of [
        "attendance",
        "grades",
        "tasks",
        "reports",
        "education",
      ]) {
        await page.goto(base + "/teacher/" + section);
        await page.getByRole('combobox',{name:'الفصل',exact:true}).first().waitFor();
        await assert.doesNotReject(() =>
          page.waitForFunction(
            (id) =>
              document.querySelector(".ws-context-bar select")?.value === id,
            classId,
          ),
        );
      }
      await page.reload();
      await page.waitForFunction(
        (id) => document.querySelector(".ws-context-bar select")?.value === id,
        classId,
      );
    },
  );
  await check(
    "live attendance, unique random picker, saved participation and real lesson presenter",
    async () => {
      await page.goto(base + "/teacher/live");
      await page.locator(".ws-student-chips button").first().waitFor();
      const before = await api(
        context,
        "/teacher/attendance?classId=" + classId,
      );
      await page.locator(".ws-student-chips button").first().click();
      await page.getByText("حُفظ الحضور.", { exact: true }).waitFor();
      const after = await api(
        context,
        "/teacher/attendance?classId=" + classId,
      );
      assert.ok(after.length >= before.length);
      await page
        .getByRole("button", { name: "اختيار طالب", exact: true })
        .click();
      const first = await page.locator(".ws-timer").nth(1).textContent();
      await page
        .getByRole("button", { name: "+1 مشاركة", exact: true })
        .click();
      await page.getByText(/حُفظت نقطة المشاركة/).waitFor();
      assert.ok(
        (await api(context, "/teacher/grades?classId=" + classId)).some((g) =>
          g.title.startsWith("مشاركة الحصة"),
        ),
      );
      await page
        .getByRole("button", { name: "اختيار طالب", exact: true })
        .click();
      assert.notEqual(
        await page.locator(".ws-timer").nth(1).textContent(),
        first,
      );
      await page
        .getByRole("button", { name: "بدء المؤقت", exact: true })
        .click();
      await page.reload();
      await page
        .getByRole("button", { name: "إيقاف مؤقت", exact: true })
        .waitFor();
      const lesson = page.getByLabel("الدرس المحفوظ", { exact: true });
      await lesson.selectOption({ index: 1 });
      await page
        .getByRole("button", { name: "عرض الدرس", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "question basket creates editable exam and valid exit ticket",
    async () => {
      await api(context, "/teacher/questions", "POST", {
        text: "ما ناتج ٢ + ٣؟",
        kind: "multiple-choice",
        options: ["٥", "٦"],
        answer: "٥",
        marks: 2,
        subject: "رياضيات",
        grade: "الثالث",
        tags: [],
        explanation: "نجمع ٢ مع ٣ فيكون الناتج ٥.",
      });
      await page.goto(base + "/teacher/questions");
      await page
        .getByRole("checkbox", { name: /تحديد السؤال/ })
        .first()
        .check();
      await page
        .getByRole("button", { name: "تحويل إلى اختبار", exact: true })
        .click();
      await page.locator(".exam-editor-grid").waitFor();
      assert.ok(new URL(page.url()).searchParams.get("exam"));
      const exam = await api(
        context,
        "/teacher/exams/" + new URL(page.url()).searchParams.get("exam"),
      );
      assert.equal(exam.document.sections[0].questions[0].kind, "choice");
      assert.equal(exam.document.metadata.totalMarks, 2);
      await page.goto(base + "/teacher/questions");
      await page
        .getByRole("checkbox", { name: /تحديد السؤال/ })
        .first()
        .check();
      await page
        .getByRole("button", { name: "بطاقة خروج", exact: true })
        .click();
      await page.waitForURL("**/teacher/activities");
      assert.ok(
        (await api(context, "/teacher/learning/activities")).some((l) =>
          l.title.startsWith("بطاقة خروج"),
        ),
      );
    },
  );
  await check(
    "Ctrl+K searches real students and opens private profile",
    async () => {
      await page.goto(base + "/teacher");
      await page.keyboard.press("Control+k");
      const search = page.getByLabel("البحث عن أداة في غرفة المعلم");
      await search.fill("طالب");
      await page
        .locator(".ws-command-results button")
        .filter({ hasText: "طالب" })
        .first()
        .click();
      await page
        .getByRole("dialog")
        .getByRole("heading", { name: "ملاحظات خاصة", exact: true })
        .waitFor();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "إغلاق", exact: true })
        .click();
    },
  );
  await check(
    "teacher routes, three themes and five viewport widths",
    async () => {
      for (const width of [320, 375, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const section of [
          "",
          "live",
          "students",
          "attendance",
          "grades",
          "reports",
          "education",
          "activities",
          "tools",
          "chemistry",
        ]) {
          await page.goto(base + "/teacher" + (section ? "/" + section : ""));
          await page.locator(".tw-page").waitFor();
          await noOverflow("teacher/" + section + " " + width);
        }
        await page.screenshot({
          path: path.join(out, "teacher-" + width + ".png"),
          fullPage: true,
        });
      }
      await page.goto(base + "/teacher/live");
      for (const theme of ["dark", "light", "glass"]) {
        await page.locator(".tw-theme-select").selectOption(theme);
        await noOverflow("teacher " + theme);
        await page.screenshot({
          path: path.join(out, "teacher-live-" + theme + ".png"),
          fullPage: true,
        });
      }
    },
  );
  await page.goto(base + "/__preview/student");
  await page.locator(".edu-main").waitFor();
  await check(
    "student hubs, quick labels, four KPIs and browser back/forward",
    async () => {
      await page.locator('.ws-kpis>article').nth(3).waitFor();
      await page.locator('.ws-hub-nav>button').nth(4).waitFor();
      assert.equal(await page.locator(".ws-kpis>article").count(), 4);
      assert.equal(await page.locator(".ws-hub-nav>button").count(), 5);
      await page
        .locator(".ws-quick-nav")
        .getByRole("button", { name: "مسارات التأسيس", exact: true })
        .click();
      await page.getByText("اختر مسارك", { exact: true }).waitFor();
      await page
        .locator(".ws-quick-nav")
        .getByRole("button", { name: "دفتر أخطائي", exact: true })
        .click();
      await page.goBack();
      await page.getByText("اختر مسارك", { exact: true }).waitFor();
      await page.goForward();
      await page
        .getByRole("button", { name: "قائمة الأخطاء", exact: true })
        .waitFor();
    },
  );
  await check(
    "persistent server focus timer survives navigation and cannot complete early",
    async () => {
      await page
        .getByRole("button", { name: "ابدأ 25 دقيقة تركيز", exact: true })
        .click();
      await page.getByLabel("الوقت المتبقي للتركيز", { exact: true }).waitFor();
      await page
        .locator(".ws-quick-nav")
        .getByRole("button", { name: "أقسام المفكر", exact: true })
        .click();
      assert.ok(
        await page
          .getByRole("button", { name: "إتمام الجلسة", exact: true })
          .isDisabled(),
      );
      await page.reload();
      await page.getByLabel("الوقت المتبقي للتركيز", { exact: true }).waitFor();
      await page
        .locator(".ws-focus-bar")
        .getByRole("button", { name: "إلغاء", exact: true })
        .click();
      await page
        .getByRole("button", { name: "ابدأ 25 دقيقة تركيز", exact: true })
        .waitFor();
    },
  );
  await check(
    "academy zen, keyboard choices/flags/scratch, map filtering and guarded typing",
    async () => {
      const catalog = await api(context, "/student-academy/catalog");
      const attempt = await api(context, "/student-academy/attempts", "POST", {
        trackId: catalog.tracks[0].id,
        mode: "untimed",
        count: 5,
      });
      await page.goto(
        base +
          "/student?studentTab=academy&academyAttempt=" +
          attempt.attemptId,
      );
      await page.locator(".sa-question").waitFor();
      await page.keyboard.press("1");
      await page.waitForFunction(
        () =>
          document.querySelector(".sa-options button[aria-pressed=true]") !==
          null,
      );
      await page.keyboard.press("m");
      await page
        .getByRole("button", { name: "إزالة علامة المراجعة", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "معلّم للمراجعة", exact: true })
        .click();
      assert.equal(await page.locator(".sa-question-map button").count(), 1);
      await page.keyboard.press("s");
      await page.getByLabel("مسودة الحل", { exact: true }).fill("1m");
      assert.equal(await page.locator(".sa-question-map button").count(), 1);
      await page.getByLabel("مسودة الحل", { exact: true }).blur();
      await page.keyboard.press("ArrowLeft");
      await page
        .getByRole("button", { name: "علّم للمراجعة", exact: true })
        .waitFor();
      await page
        .getByRole("button", {
          name: "وضع التركيز الكامل (ملء الشاشة)",
          exact: true,
        })
        .click();
      assert.ok(await page.locator(".edu-sidebar").isHidden());
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", {
          name: "وضع التركيز الكامل (ملء الشاشة)",
          exact: true,
        })
        .waitFor();
      await page
        .getByRole("button", { name: "تسليم وعرض النتيجة", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "تأكيد التسليم", exact: true })
        .click();
      await page
        .getByRole("heading", {
          name: "هذه نتيجتك، وخطوتك التالية.",
          exact: true,
        })
        .waitFor();
      assert.equal(await page.locator(".ws-exam-tools").count(), 0);
    },
  );
  await check(
    "interactive weak skill training, flashcards and saved original explanation only",
    async () => {
      await page.goto(base + "/student?studentTab=foundation-progress");
      await page.locator(".ws-skill-card").first().waitFor();
      const weak = page
        .getByRole("button", { name: /تدرّب على هذه المهارة الآن/ })
        .first();
      if (await weak.count()) {
        await weak.click();
        await page.locator(".sa-question").waitFor();
        assert.ok((await page.locator(".sa-question-map button").count()) <= 5);
      }
      await page.goto(base + "/student?studentTab=mistakes");
      await page
        .getByRole("button", {
          name: "بطاقات المراجعة السريعة (Flashcards)",
          exact: true,
        })
        .click();
      await page
        .getByLabel("مصدر البطاقات", { exact: true })
        .selectOption("academy");
      await page.locator(".ws-flashcard").waitFor();
      await page
        .getByRole("button", { name: "اكشف فكرة الحل", exact: true })
        .click();
      await page
        .getByText("الإجابة والشرح الأصلي للتأسيس", { exact: true })
        .waitFor();
    },
  );
  await check(
    "quant keyboard uses real saved answers, review flags, scratch and return policy",
    async () => {
      const tests = await api(context, "/quant/tests");
      assert.ok(tests.length >= 2);
      const main = tests.find((t) => t.allowReturn),
        locked = tests.find((t) => !t.allowReturn);
      assert.ok(main && locked);
      const attempt = await api(
        context,
        "/quant/tests/" + main.id + "/attempts",
        "POST",
        {},
      );
      await page.goto(
        base + "/student?studentTab=aptitude&quantAttempt=" + attempt.attemptId,
      );
      await page.locator(".quant-choice").first().waitFor();
      await page.keyboard.press("1");
      await page.waitForFunction(
        () =>
          document.querySelector(".quant-choice[aria-pressed=true]") !== null,
      );
      await page.getByText("تم الحفظ في الخادم", { exact: true }).waitFor();
      await page.keyboard.press("m");
      await page
        .getByRole("button", { name: "إزالة علامة المراجعة", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "معلّم للمراجعة", exact: true })
        .click();
      assert.equal(
        await page.locator(".quant-question-grid button").count(),
        1,
      );
      await page.getByText("تم الحفظ في الخادم", { exact: true }).waitFor();
      const saved = await api(context, "/quant/attempts/" + attempt.attemptId);
      assert.ok(saved.responses.some((r) => r.flagged && r.choiceKey));
      await page.keyboard.press("ArrowLeft");
      await page.waitForFunction(() =>
        document
          .querySelector(".quant-question-meta")
          ?.textContent.includes("٢"),
      );
      await page.keyboard.press("s");
      assert.equal(
        await page
          .locator(".quant-mobile-tabs button[aria-pressed=true]")
          .textContent(),
        "الحل بالقلم",
      );
      await page
        .getByRole("button", { name: "تسليم الاختبار", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "تأكيد التسليم", exact: true })
        .click();
      await page.locator(".quant-attempt").waitFor({ state: "hidden" });
      const second = await api(
        context,
        "/quant/tests/" + locked.id + "/attempts",
        "POST",
        {},
      );
      await page.goto(
        base + "/student?studentTab=aptitude&quantAttempt=" + second.attemptId,
      );
      await page.locator(".quant-choice").first().waitFor();
      await page.keyboard.press("ArrowLeft");
      await page.waitForFunction(() =>
        document
          .querySelector(".quant-question-meta")
          ?.textContent.includes("٢"),
      );
      await page.keyboard.press("ArrowRight");
      assert.equal(
        (await api(context, "/quant/attempts/" + second.attemptId)).attempt
          .currentIndex,
        1,
      );
      assert.ok(
        await page
          .getByRole("button", { name: "السابق", exact: true })
          .isDisabled(),
      );
    },
  );
  await check(
    "assigned teacher activity stays inside student room, with real enrollment auth",
    async () => {
      await page.goto(base + "/student?studentTab=class-activities");
      await page
        .getByRole("button", { name: "فتح النشاط داخل غرفتي", exact: true })
        .first()
        .click();
      await page.getByRole("button", { name: "40", exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/student");
      await page.getByRole("button", { name: "40", exact: true }).click();
      await page.getByRole("button", { name: "تحقق", exact: true }).click();
      await page.getByText("200 × 20 ÷ 100 = 40.", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "العودة لأنشطة الفصل", exact: true })
        .click();
    },
  );
  await check(
    "all student routes, five widths, three themes and no page errors",
    async () => {
      for (const width of [320, 375, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const section of [
          "home",
          "academy",
          "aptitude",
          "foundation-history",
          "foundation-progress",
          "mistakes",
          "bookmarks",
          "plan",
          "rooms",
          "achievements",
          "downloads",
          "goals",
          "help",
          "class-activities",
          "flashcards",
        ]) {
          await page.goto(base + "/student?studentTab=" + section);
          await page.locator(".edu-main").waitFor();
          await noOverflow("student/" + section + " " + width);
        }
        await page.goto(base + "/student");
        await page.locator(".ws-kpis").waitFor();
        await page.screenshot({
          path: path.join(out, "student-" + width + ".png"),
          fullPage: true,
        });
      }
      for (const theme of ["dark", "light", "glass"]) {
        await page.locator(".tw-theme-select").selectOption(theme);
        await page.reload();
        await page.locator(".ws-kpis").waitFor();
        assert.equal(
          await page.locator("html").getAttribute("data-theme"),
          theme,
        );
        await noOverflow("student " + theme);
        await page.screenshot({
          path: path.join(out, "student-" + theme + ".png"),
          fullPage: true,
        });
      }
      assert.deepEqual(errors, []);
    },
  );
  await check(
    "all themes at each requested width and touch navigation",
    async () => {
      for (const width of [320, 375, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const theme of ["dark", "light", "glass"]) {
          await page.locator(".tw-theme-select").selectOption(theme);
          await noOverflow("student theme " + theme + " " + width);
        }
      }
      const touch = await browser.newContext({
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
          locale: "ar-SA",
        }),
        mobile = await touch.newPage();
      await mobile.goto(base + "/__preview/student");
      await mobile
        .locator(".ws-student-dock")
        .getByRole("button", { name: "المزيد", exact: true })
        .tap();
      await mobile
        .getByRole("dialog")
        .getByRole("button", { name: "الأهداف والخطة", exact: true })
        .tap();
      await mobile
        .getByRole("heading", { name: "مساحة التركيز", exact: true })
        .waitFor();
      assert.equal(
        new URL(mobile.url()).searchParams.get("studentTab"),
        "goals",
      );
      await touch.close();
    },
  );
} catch (e) {
  if (page)
    await page
      .screenshot({ path: path.join(out, "failure.png"), fullPage: true })
      .catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify({ localOnly: true, results, errors }, null, 2),
  );
  await browser?.close();
  fixture.stdin.write("stop\n");
  await closed;
}
