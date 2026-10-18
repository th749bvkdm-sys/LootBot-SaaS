/** Uses only the disposable teacher-ui-server fixture; never production data. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
const base = "http://127.0.0.1:5190";
const modules = path.join(
  process.env.USERPROFILE,
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules",
);
const { chromium } = createRequire(path.join(modules, "__qa.cjs"))(
  "playwright",
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({
  locale: "ar-SA",
  timezoneId: "Asia/Riyadh",
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await ctx.newPage(),
  out = path.resolve("artifacts/lootbot/test-results/classroom");
await mkdir(out, { recursive: true });
const results = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => void d.accept());
page.setDefaultTimeout(15000);
let projector,
  cls,
  students,
  owner,
  lesson,
  questionIds = [];
async function api(endpoint, data) {
  const csrf = (await (await ctx.request.get(base + "/api/auth/csrf")).json())
    .token;
  const r = await ctx.request[data ? "post" : "get"](
    base + "/api" + endpoint,
    data ? { headers: { "x-csrf-token": csrf }, data } : {},
  );
  assert.ok(r.ok(), endpoint + " " + r.status() + " " + (await r.text()));
  return r.json();
}
async function check(name, fn) {
  console.log("RUN " + name);
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, passed: false, error: e.message });
    throw e;
  }
}
const control = () => page.locator(".cr-controller").first();
async function mode(label, game = false) {
  await page
    .locator(game ? ".cr-game-grid" : ".cr-toolbar")
    .first()
    .getByRole("button", { name: label, exact: !game })
    .click();
  await control().getByRole("heading", { level: 2 }).first().waitFor();
}
async function stored() {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    `lootbot_classroom_live_state:${owner}:${cls.id}`,
  );
}
async function synced(mode) {
  await projector.waitForFunction(
    (m) => document.querySelector(".cr-projector")?.dataset.mode === m,
    mode,
  );
}
async function noOverflow(target, label) {
  const result = await target.evaluate(() => ({
    width: innerWidth,
    total: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("body *")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width && (r.right > innerWidth + 1 || r.left < -1);
      })
      .slice(0, 10)
      .map((e) => e.className),
  }));
  assert.ok(result.total <= result.width + 1, label + JSON.stringify(result));
}
try {
  await check(
    "teacher login, real active roster, class period and separate projector",
    async () => {
      await api("/auth/login", {
        email: "teacher@example.invalid",
        password: "Local-Fixture-Only-2026!",
      });
      cls = (await api("/teacher/classes"))[0];
      students = await api("/teacher/students?classId=" + cls.id);
      owner = (await api("/teacher/classroom?classId=" + cls.id)).ownerId;
      for (let i = 0; i < 6; i++) {
        const q = await api("/teacher/questions", {
          text: "سؤال اللعبة المحلي " + (i + 1),
          kind: "multiple-choice",
          options: ["جواب صحيح " + i, "خيار ثان", "خيار ثالث", "خيار رابع"],
          answer: "جواب صحيح " + i,
          explanation: "شرح المعلم الخاص",
          marks: 1,
          subject: "العلوم",
          tags: [],
        });
        questionIds.push(q.id);
      }
      lesson = await api("/teacher/lessons", {
        title: "مفردات درس محلي",
        classId: cls.id,
        date: "2026-10-18",
        content: "الخلية | تلميح خاص لا يظهر على شاشة الطالب",
        objectives: "التبخر | تلميح ثان كتبه المعلم",
      });
      await page.goto(base + "/teacher/classroom?class=" + cls.id);
      await page
        .getByRole("heading", { name: "مركز الحصة والبروجكتر", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("combobox", { name: "الفصل", exact: true })
          .first()
          .inputValue(),
        cls.id,
      );
      await page
        .getByRole("combobox", { name: "الحصة الحالية", exact: true })
        .selectOption({ label: "الحصة الثالثة" });
      const popup = page.waitForEvent("popup");
      await page
        .getByRole("link", { name: "📺 فتح شاشة البروجكتر", exact: true })
        .click();
      projector = await popup;
      projector.on("pageerror", (e) => errors.push(e.message));
      await projector.locator(".cr-projector-header").waitFor();
      await projector.getByText("الحصة الثالثة", { exact: false }).waitFor();
      assert.equal(await projector.locator(".tw-sidebar").count(), 0);
      assert.ok(
        (await projector.locator(".cr-projector-header").innerText()).includes(
          cls.name,
        ),
      );
      await page.screenshot({
        path: path.join(out, "hub-desktop.png"),
        fullPage: true,
      });
    },
  );
  await check(
    "early small-screen check covers every tool and a rotated name wheel",
    async () => {
      await page.setViewportSize({ width: 320, height: 844 });
      await projector.setViewportSize({ width: 320, height: 844 });
      for (const [label, game] of [
        ["الكرسي الساخن", true],
        ["سباق السيارة", true],
        ["سباق السلم", true],
        ["عجلة الأسماء", true],
        ["المسابقة", true],
        ["التصويت", false],
        ["المؤقت", false],
        ["مقياس الهدوء", false],
        ["لوحة الشرف", false],
      ]) {
        await mode(label, game);
        if (label === "عجلة الأسماء") {
          await control()
            .getByRole("button", { name: "أدر العجلة 🔀", exact: true })
            .click();
          await page.waitForTimeout(100);
        }
        await synced((await stored()).mode);
        await noOverflow(page, label);
        await noOverflow(projector, "projector " + label);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await projector.setViewportSize({ width: 1440, height: 1000 });
    },
  );
  await check(
    "hot seat authored hint is private, guessing, skip, time and reward replay",
    async () => {
      await page.goto(base + "/teacher/lessons?class=" + cls.id);
      await page
        .getByRole("link", {
          name: "🔥 أضف مفردات الدرس للكرسي الساخن",
          exact: true,
        })
        .click();
      await page.waitForURL("**/teacher/classroom?**");
      await control()
        .getByLabel("طالب الكرسي الساخن", { exact: true })
        .selectOption(students[0].id);
      await control()
        .getByRole("button", { name: "بلا مؤقت", exact: true })
        .click();
      await control()
        .getByRole("button", { name: "ابدأ ▶", exact: true })
        .click();
      await synced("hot-seat");
      await control()
        .getByText("تلميح خاص لا يظهر على شاشة الطالب", { exact: true })
        .waitFor();
      await projector
        .locator(".cr-hot-word")
        .filter({ hasText: "الخلية" })
        .waitFor();
      assert.equal(
        (await projector.locator("body").innerText()).includes(
          "تلميح خاص لا يظهر",
        ),
        false,
      );
      assert.equal(
        JSON.stringify(await stored()).includes("تلميح خاص لا يظهر"),
        false,
      );
      await control()
        .getByRole("button", { name: "جابها! ✓", exact: true })
        .click();
      await projector
        .locator(".cr-word-badges")
        .getByText("✓ الخلية", { exact: true })
        .waitFor();
      await control()
        .getByRole("button", { name: "تخطي ⬅", exact: true })
        .click();
      await control()
        .getByRole("button", {
          name: "حفظ نقاط هذا الدور في لوحة الشرف",
          exact: true,
        })
        .click();
      await page
        .getByText("حُفظت النقاط في سجل الفصل.", { exact: true })
        .waitFor();
      await control()
        .getByRole("button", {
          name: "حفظ نقاط هذا الدور في لوحة الشرف",
          exact: true,
        })
        .click();
      await page.waitForTimeout(200);
      assert.equal(
        (await api("/teacher/classroom?classId=" + cls.id)).scores.find(
          (s) => s.id === students[0].id,
        ).points,
        1,
      );
      await projector.screenshot({
        path: path.join(out, "projector-hot-seat.png"),
        fullPage: true,
      });
    },
  );
  await check(
    "car five bumps, backward floor, reveal only after judging and victory",
    async () => {
      await page.goto(base + "/teacher/classroom?class=" + cls.id);
      await mode("سباق السيارة", true);
      await control()
        .getByRole("button", { name: "ابدأ ▶", exact: true })
        .click();
      await synced("car-race");
      assert.equal(
        (await stored()).carRace.currentQuestion.correctIndex,
        undefined,
      );
      assert.equal(await projector.locator(".is-correct").count(), 0);
      await control()
        .getByRole("button", { name: "خاطئة ✕", exact: true })
        .click();
      assert.equal((await stored()).carRace.currentBump, 1);
      await projector
        .getByText("إجابة خاطئة — نعود للخلف", { exact: true })
        .waitFor();
      for (let i = 0; i < 5; i++) {
        await control()
          .getByRole("button", { name: "السؤال التالي", exact: true })
          .click();
        await control()
          .getByRole("button", { name: "صحيحة ✓", exact: true })
          .click();
      }
      assert.equal((await stored()).carRace.currentBump, 6);
      await projector
        .getByText("انتصرتم! وصلت السيارة إلى خط النهاية", { exact: true })
        .waitFor();
      await control()
        .getByRole("button", { name: "حفظ نقطة الفوز للفصل", exact: true })
        .click();
      await page.waitForTimeout(200);
      assert.equal(
        (await api("/teacher/classroom?classId=" + cls.id)).classPoints,
        1,
      );
      await projector.screenshot({
        path: path.join(out, "projector-car-victory.png"),
        fullPage: true,
      });
    },
  );
  await check(
    "ladder real distinct players, lower bound, five steps, automatic reward once",
    async () => {
      await mode("سباق السلم", true);
      await control()
        .getByLabel("الطالب الأول", { exact: true })
        .selectOption(students[0].id);
      await control()
        .getByLabel("الطالب الثاني", { exact: true })
        .selectOption(students[0].id);
      await control()
        .getByRole("button", { name: "ابدأ ▶", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "اختر طالبين مختلفين" })
        .waitFor();
      await control()
        .getByLabel("الطالب الثاني", { exact: true })
        .selectOption(students[1].id);
      await control()
        .getByLabel("حفظ نقطة الفوز تلقائيًا في لوحة الشرف", { exact: true })
        .check();
      await control()
        .getByRole("button", { name: "ابدأ ▶", exact: true })
        .click();
      await synced("ladder-race");
      await control()
        .getByRole("button", { name: "▼ نزول", exact: true })
        .first()
        .click();
      assert.equal((await stored()).ladderRace.player1.step, 0);
      for (let i = 0; i < 5; i++)
        await control()
          .getByRole("button", { name: "▲ صعود", exact: true })
          .first()
          .click();
      await page.waitForTimeout(350);
      assert.equal(
        (await api("/teacher/classroom?classId=" + cls.id)).scores.find(
          (s) => s.id === students[0].id,
        ).points,
        2,
      );
      await control()
        .getByRole("button", {
          name: "حفظ نقطة الفوز في لوحة الشرف",
          exact: true,
        })
        .click();
      await page.waitForTimeout(200);
      assert.equal(
        (await api("/teacher/classroom?classId=" + cls.id)).scores.find(
          (s) => s.id === students[0].id,
        ).points,
        2,
      );
      await projector.screenshot({
        path: path.join(out, "projector-ladder.png"),
        fullPage: true,
      });
    },
  );
  await check(
    "named vote uses actual roster and retains voters after skip; anonymous custom vote",
    async () => {
      await mode("التصويت");
      await control()
        .getByRole("button", { name: "بدء تصويت جديد", exact: true })
        .click();
      await synced("voting");
      await control()
        .getByRole("button", { name: "الأحد", exact: true })
        .click();
      await control()
        .getByRole("button", { name: "تخطي ⏭", exact: true })
        .click();
      await control()
        .getByRole("button", { name: "الإثنين", exact: true })
        .click();
      await control()
        .getByRole("button", { name: "العودة لأول طالب لم يصوت", exact: true })
        .click();
      await control()
        .getByRole("button", { name: "الأحد", exact: true })
        .click();
      await control()
        .getByRole("button", { name: "عرض النتيجة على البروجكتر", exact: true })
        .click();
      await projector
        .locator(".cr-vote-results")
        .getByText(students[2].name, { exact: true })
        .waitFor();
      assert.equal(Object.keys((await stored()).voting.votes).length, 3);
      await projector.screenshot({
        path: path.join(out, "projector-voting.png"),
        fullPage: true,
      });
      await control()
        .getByRole("button", {
          name: "إنهاء التصويت وتغيير الإعدادات",
          exact: true,
        })
        .click();
      await control()
        .getByLabel("تصويت بالأسماء — تظهر أسماء المصوتين في العرض", {
          exact: true,
        })
        .uncheck();
      await control()
        .getByLabel("موضوع التصويت", { exact: true })
        .selectOption("مخصص");
      await control()
        .getByLabel("خيارات مخصصة، كل خيار بسطر", { exact: true })
        .fill("خيار أول\nخيار ثان");
      await control()
        .getByRole("button", { name: "بدء تصويت جديد", exact: true })
        .click();
      await control()
        .getByRole("button", { name: "خيار أول", exact: true })
        .click();
      await control()
        .getByRole("button", { name: "عرض النتيجة على البروجكتر", exact: true })
        .click();
      assert.equal(
        Object.values((await stored()).voting.anonymousCounts).reduce(
          (a, b) => a + b,
          0,
        ),
        1,
      );
      assert.equal(Object.keys((await stored()).voting.votes).length, 0);
    },
  );
  await check(
    "directions create, hide, complete, show and delete in projector",
    async () => {
      await mode("ماذا نفعل؟");
      await control()
        .getByRole("button", { name: "📝 نص حر", exact: true })
        .click();
      await control()
        .getByLabel("تفصيل التوجيه", { exact: true })
        .fill("أخرجوا كتاب النشاط");
      await control().getByLabel("رقم الصفحة", { exact: true }).fill("12");
      await control()
        .getByRole("button", { name: "إضافة +", exact: true })
        .click();
      await synced("what-to-do");
      await projector
        .getByRole("heading", { name: "أخرجوا كتاب النشاط", exact: true })
        .waitFor();
      await control()
        .getByRole("button", { name: "إخفاء", exact: true })
        .click();
      await projector
        .getByRole("heading", { name: "ماذا نفعل الآن؟", exact: true })
        .waitFor();
      await control()
        .getByRole("button", { name: "إظهار", exact: true })
        .click();
      await control()
        .getByRole("button", { name: "✓ اكتمل", exact: true })
        .click();
      await control().getByRole("button", { name: "حذف", exact: true }).click();
      assert.equal((await stored()).whatToDo.items.length, 0);
    },
  );
  await check(
    "quiet meter manual fallback, loud pause, quiet accumulation and goal",
    async () => {
      await mode("مقياس الهدوء");
      await synced("quiet-meter");
      await control()
        .getByLabel("هدف الهدوء", { exact: true })
        .selectOption("60");
      await control()
        .getByLabel("محاكاة مستوى الصوت", { exact: true })
        .fill("90");
      await control()
        .getByRole("button", { name: "بدء هدف الهدوء", exact: true })
        .click();
      await page.waitForTimeout(1100);
      assert.equal((await stored()).quietMeter.quietElapsedSeconds, 0);
      await projector
        .getByRole("heading", { name: "🔊 صوت مرتفع", exact: true })
        .waitFor();
      await control()
        .getByLabel("محاكاة مستوى الصوت", { exact: true })
        .fill("10");
      await page.waitForTimeout(1100);
      assert.ok((await stored()).quietMeter.quietElapsedSeconds > 0);
      await projector
        .getByRole("heading", { name: "🔈 هدوء ممتاز", exact: true })
        .waitFor();
      // Wait the actual configured one-minute goal; no accelerated or fabricated success state.
      await control()
        .getByRole("button", {
          name: "مكافأة الفصل بيوم استمرارية",
          exact: true,
        })
        .waitFor({ state: "visible" });
      await page.waitForFunction(
        () =>
          !Array.from(document.querySelectorAll("button")).find((b) =>
            b.textContent.includes("مكافأة الفصل بيوم استمرارية"),
          )?.disabled,
        {},
        { timeout: 65000 },
      );
      await control()
        .getByRole("button", {
          name: "مكافأة الفصل بيوم استمرارية",
          exact: true,
        })
        .click();
      await page.waitForTimeout(200);
      assert.equal(
        (await api("/teacher/classroom?classId=" + cls.id)).streakDays,
        1,
      );
      await projector.screenshot({
        path: path.join(out, "projector-quiet.png"),
        fullPage: true,
      });
    },
  );
  await check(
    "timer pause, plus 30, reload persistence and actual finish synchronize",
    async () => {
      await mode("المؤقت");
      await control().getByLabel("المدة بالثواني", { exact: true }).fill("65");
      await control()
        .getByRole("button", { name: "تشغيل ▶", exact: true })
        .click();
      await synced("timer");
      await control()
        .getByRole("button", { name: "+30 ثانية", exact: true })
        .click();
      assert.ok((await stored()).timer.remainingSeconds >= 94);
      await control()
        .getByRole("button", { name: "إيقاف مؤقت ⏸", exact: true })
        .click();
      const paused = (await stored()).timer.remainingSeconds;
      await page.waitForTimeout(1100);
      assert.equal((await stored()).timer.remainingSeconds, paused);
      await control().getByLabel("المدة بالثواني", { exact: true }).fill("3");
      await control()
        .getByRole("button", { name: "تشغيل ▶", exact: true })
        .click();
      await page.reload();
      await projector
        .getByText("انتهى وقت النشاط!", { exact: true })
        .first()
        .waitFor();
    },
  );
  await check(
    "wheel no-repeat actual names, points persist and explicit grade import is repeat-safe",
    async () => {
      await mode("عجلة الأسماء", true);
      const selected = [];
      for (let i = 0; i < 5; i++) {
        await control()
          .getByRole("button", { name: "أدر العجلة 🔀", exact: true })
          .click();
        await page.waitForTimeout(100);
        const wheel = (await stored()).wheel;
        assert.ok(students.some((s) => s.id === wheel.selectedId));
        const order = [...students].sort(
            (a, b) =>
              a.name.localeCompare(b.name, "ar") || a.id.localeCompare(b.id),
          ),
          index = order.findIndex((s) => s.id === wheel.selectedId);
        assert.ok(
          Math.abs(
            (wheel.rotation % 360) -
              ((360 - (index * 360) / order.length) % 360),
          ) < 1e-8,
          "wheel pointer must match selected name",
        );
        selected.push(wheel.selectedId);
      }
      assert.equal(new Set(selected).size, 5);
      await mode("لوحة الشرف");
      await control()
        .getByRole("button", { name: "+2", exact: true })
        .first()
        .click();
      await page.waitForTimeout(200);
      const scores = await api("/teacher/classroom?classId=" + cls.id);
      assert.ok(scores.scores.some((s) => s.points >= 2));
      assert.equal((await api("/teacher/grades")).length, 0);
      await control()
        .getByRole("button", {
          name: "ترحيل نقاط اليوم إلى درجات المشاركة",
          exact: true,
        })
        .click();
      await page.waitForTimeout(200);
      const grades = await api("/teacher/grades");
      assert.ok(grades.length > 0);
      await control()
        .getByRole("button", {
          name: "ترحيل نقاط اليوم إلى درجات المشاركة",
          exact: true,
        })
        .click();
      await page.waitForTimeout(200);
      assert.equal((await api("/teacher/grades")).length, grades.length);
      await page.reload();
      await control()
        .getByRole("heading", { name: "لوحة الشرف والاستمرارية", exact: true })
        .waitFor();
      await projector.screenshot({
        path: path.join(out, "projector-honor.png"),
        fullPage: true,
      });
    },
  );
  await check(
    "question basket routes selected teacher questions to car game; lesson link already verified",
    async () => {
      await page.goto(base + "/teacher/questions?class=" + cls.id);
      for (let i = 0; i < 6; i++)
        await page
          .getByLabel("تحديد السؤال سؤال اللعبة المحلي " + (i + 1), {
            exact: true,
          })
          .check();
      await page
        .getByRole("button", { name: "🎮 شغّل في سباق السيارة", exact: true })
        .click();
      await page.waitForURL("**/teacher/classroom?**");
      await control()
        .getByText(/استخدام 6 من أسئلة سلة البنك/)
        .waitFor();
      await control()
        .getByRole("button", { name: "ابدأ ▶", exact: true })
        .click();
      assert.ok(
        questionIds.includes((await stored()).carRace.currentQuestion.id),
      );
    },
  );
  await check(
    "team quiz first five wins and rejects additional scoring",
    async () => {
      await mode("المسابقة", true);
      await control()
        .getByRole("button", { name: "ابدأ ▶", exact: true })
        .click();
      await synced("team-quiz");
      for (let i = 0; i < 5; i++) {
        if (i)
          await control()
            .getByRole("button", { name: "السؤال التالي", exact: true })
            .click();
        await control()
          .getByRole("button", { name: "صحيحة ✓", exact: true })
          .first()
          .click();
      }
      assert.equal((await stored()).teamQuiz.scores[0], 5);
      assert.ok((await stored()).teamQuiz.winner);
      assert.equal(
        await control()
          .getByRole("button", { name: "صحيحة ✓", exact: true })
          .first()
          .isDisabled(),
        true,
      );
    },
  );
  await check(
    "quick tools stay on page, overlays close, all three themes and five widths fit",
    async () => {
      await page.goto(base + "/teacher/students?class=" + cls.id);
      await page
        .getByRole("button", { name: "المؤقت السريع", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      assert.ok(page.url().includes("/teacher/students"));
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "إغلاق", exact: true })
        .click();
      await page.goto(base + "/teacher/classroom?class=" + cls.id);
      await mode("ماذا نفعل؟");
      await page
        .getByRole("button", { name: "عرض كامل داخل الصفحة", exact: false })
        .click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(await page.getByRole("dialog").count(), 0);
      for (const theme of ["dark", "light", "glass"]) {
        await page
          .getByRole("combobox", { name: "مظهر غرفة المعلم", exact: true })
          .selectOption(theme);
        for (const width of [320, 375, 390, 820, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          await noOverflow(page, theme + " " + width);
          await projector.setViewportSize({ width, height: 1000 });
          await noOverflow(projector, "projector " + width);
        }
      }
      for (const [label, game] of [
        ["الكرسي الساخن", true],
        ["سباق السيارة", true],
        ["سباق السلم", true],
        ["عجلة الأسماء", true],
        ["المسابقة", true],
        ["التصويت", false],
        ["المؤقت", false],
        ["مقياس الهدوء", false],
        ["لوحة الشرف", false],
      ]) {
        await mode(label, game);
        await synced((await stored()).mode);
        for (const width of [320, 820, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          await noOverflow(page, label + " " + width);
          await projector.setViewportSize({ width, height: 1000 });
          await noOverflow(projector, "projector " + label + " " + width);
        }
      }
      await mode("الكرسي الساخن", true);
      await control()
        .getByRole("button", { name: "طالب جديد 🔀", exact: true })
        .click();
      await page.screenshot({
        path: path.join(out, "hub-glass-desktop.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: path.join(out, "hub-glass-mobile.png"),
        fullPage: true,
      });
    },
  );
  await check(
    "storage events synchronize two windows when BroadcastChannel is unavailable",
    async () => {
      await ctx.addInitScript(() => {
        globalThis.BroadcastChannel = undefined;
      });
      await page.reload();
      await projector.reload();
      await page.locator(".cr-controller").waitFor();
      await projector.locator(".cr-projector-header").waitFor();
      await mode("ماذا نفعل؟");
      await control()
        .getByRole("button", { name: "📝 نص حر", exact: true })
        .click();
      await control()
        .getByLabel("تفصيل التوجيه", { exact: true })
        .fill("مزامنة عبر التخزين المحلي");
      await control()
        .getByRole("button", { name: "إضافة +", exact: true })
        .click();
      await projector
        .getByRole("heading", {
          name: "مزامنة عبر التخزين المحلي",
          exact: true,
        })
        .waitFor();
    },
  );
  await check(
    "projector requires a teacher session and owned class; no page exceptions",
    async () => {
      const guest = await browser.newContext(),
        p = await guest.newPage();
      await p.goto(base + "/teacher/projector?class=" + cls.id);
      await p
        .getByRole("heading", { name: "سجّل الدخول للمتابعة", exact: true })
        .waitFor();
      assert.equal(await p.locator(".cr-projector").count(), 0);
      assert.equal(
        (
          await guest.request.get(
            base + "/api/teacher/classroom?classId=" + cls.id,
          )
        ).status(),
        401,
      );
      await guest.close();
      const bad = await ctx.newPage();
      await bad.goto(
        base + "/teacher/projector?class=00000000-0000-4000-8000-000000000000",
      );
      await bad
        .getByRole("heading", { name: "افتح العرض من مركز الحصة", exact: true })
        .waitFor();
      await bad.close();
      assert.deepEqual(errors, []);
    },
  );
} catch (e) {
  console.error((await page.locator("body").innerText()).slice(-7000));
  await page.screenshot({
    path: path.join(out, "failure.png"),
    fullPage: true,
  });
  throw e;
} finally {
  await writeFile(
    path.join(out, "browser-results.json"),
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
}
