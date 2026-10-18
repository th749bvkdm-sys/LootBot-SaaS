/** Simulated Web Audio lifecycle. Never requests a real microphone. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
const base = "http://127.0.0.1:5190",
  runtime = path.join(
    process.env.USERPROFILE,
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules",
  );
const { chromium } = createRequire(path.join(runtime, "__qa.cjs"))(
  "playwright",
);
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "ar-SA",
    reducedMotion: "reduce",
  }),
  page = await ctx.newPage();
const out = path.resolve("artifacts/lootbot/test-results/classroom");
await mkdir(out, { recursive: true });
const errors = [],
  results = [];
page.on("pageerror", (e) => errors.push(e.message));
async function check(name, fn) {
  await fn();
  results.push({ name, passed: true });
  console.log("PASS " + name);
}
let key;
async function state() {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
}
async function mock(denied = false) {
  await page.evaluate((denied) => {
    window.__microphoneQa = {
      calls: 0,
      stops: 0,
      reads: 0,
      amplitude: 2,
      suspended: false,
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const q = window.__microphoneQa;
        q.calls++;
        if (denied) throw new DOMException("Denied in test", "NotAllowedError");
        return {
          getTracks: () => [
            {
              stop() {
                q.stops++;
              },
            },
          ],
        };
      },
    });
    window.AudioContext = class {
      state = "running";
      createAnalyser() {
        return {
          fftSize: 1024,
          getByteTimeDomainData(data) {
            const q = window.__microphoneQa;
            q.reads++;
            data.fill(128 + q.amplitude);
          },
        };
      }
      createMediaStreamSource() {
        return { connect() {} };
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        this.state = "closed";
        return Promise.resolve();
      }
    };
  }, denied);
}
try {
  const csrf = (await (await ctx.request.get(base + "/api/auth/csrf")).json())
    .token;
  assert.ok(
    (
      await ctx.request.post(base + "/api/auth/login", {
        headers: { "x-csrf-token": csrf },
        data: {
          email: "teacher@example.invalid",
          password: "Local-Fixture-Only-2026!",
        },
      })
    ).ok(),
  );
  const cls = (
      await (await ctx.request.get(base + "/api/teacher/classes")).json()
    )[0],
    summary = await (
      await ctx.request.get(base + "/api/teacher/classroom?classId=" + cls.id)
    ).json();
  key = "lootbot_classroom_live_state:" + summary.ownerId + ":" + cls.id;
  await page.goto(
    base + "/teacher/classroom?class=" + cls.id + "&tool=quiet-meter",
  );
  const controls = page.locator(".cr-controller");
  await controls
    .getByRole("heading", { name: "مقياس الهدوء", exact: true })
    .waitFor();
  await check(
    "microphone requires an explicit click and consumes actual analyser samples in background",
    async () => {
      await mock();
      assert.equal(await page.evaluate(() => window.__microphoneQa.calls), 0);
      await controls
        .getByRole("button", { name: "تشغيل الميكروفون", exact: true })
        .click();
      await page.waitForTimeout(700);
      const s = await state();
      assert.equal(s.quietMeter.source, "microphone");
      assert.equal(s.quietMeter.noiseLevel, 16);
      assert.ok(s.quietMeter.quietElapsedSeconds > 0);
      const background = await ctx.newPage();
      await background.goto(base + "/teacher/projector?class=" + cls.id);
      await background.bringToFront();
      const reads = await page.evaluate(() => window.__microphoneQa.reads);
      await page.waitForTimeout(1400);
      assert.ok(
        (await page.evaluate(() => window.__microphoneQa.reads)) > reads,
      );
      await background.close();
      await page.bringToFront();
    },
  );
  await check(
    "stopping, changing tool and reloading release or pause microphone measurement",
    async () => {
      await controls
        .getByRole("button", { name: "إيقاف الميكروفون", exact: true })
        .click();
      assert.equal(await page.evaluate(() => window.__microphoneQa.stops), 1);
      const reads = await page.evaluate(() => window.__microphoneQa.reads);
      await page.waitForTimeout(350);
      assert.equal(
        await page.evaluate(() => window.__microphoneQa.reads),
        reads,
      );
      assert.equal((await state()).quietMeter.running, false);
      await controls
        .getByRole("button", { name: "تشغيل الميكروفون", exact: true })
        .click();
      await page
        .locator(".cr-toolbar")
        .getByRole("button", { name: "المؤقت", exact: true })
        .click();
      assert.equal(await page.evaluate(() => window.__microphoneQa.stops), 2);
      assert.equal((await state()).quietMeter.running, false);
      await page
        .locator(".cr-toolbar")
        .getByRole("button", { name: "مقياس الهدوء", exact: true })
        .click();
      await controls
        .getByRole("button", { name: "تشغيل الميكروفون", exact: true })
        .click();
      await page.reload();
      await controls
        .getByRole("heading", { name: "مقياس الهدوء", exact: true })
        .waitFor();
      assert.equal((await state()).quietMeter.running, false);
    },
  );
  await check(
    "permission denial leaves the manual fallback usable at mobile sizes",
    async () => {
      await mock(true);
      await controls
        .getByRole("button", { name: "تشغيل الميكروفون", exact: true })
        .click();
      await page.getByRole("alert").filter({ hasText: "محاكاة" }).waitFor();
      await controls
        .getByLabel("محاكاة مستوى الصوت", { exact: true })
        .fill("90");
      assert.equal((await state()).quietMeter.source, "manual");
      for (const width of [320, 375, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
      }
      assert.deepEqual(errors, []);
    },
  );
  await check(
    "a delayed permission response is discarded after leaving the microphone tool",
    async () => {
      await page.evaluate(() => {
        window.__microphoneQa.calls = 0;
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
          configurable: true,
          value: () => {
            window.__microphoneQa.calls++;
            return new Promise((resolve) => {
              window.__permissionResolve = () =>
                resolve({
                  getTracks: () => [
                    {
                      stop() {
                        window.__microphoneQa.stops++;
                      },
                    },
                  ],
                });
            });
          },
        });
      });
      await controls
        .getByRole("button", { name: "تشغيل الميكروفون", exact: true })
        .click();
      assert.equal(
        await controls
          .getByRole("button", { name: "بانتظار إذن الميكروفون…", exact: true })
          .isDisabled(),
        true,
      );
      await page
        .locator(".cr-toolbar")
        .getByRole("button", { name: "المؤقت", exact: true })
        .click();
      await page.evaluate(() => window.__permissionResolve());
      await page.waitForFunction(() => window.__microphoneQa.stops === 1);
      assert.equal((await state()).quietMeter.running, false);
      assert.equal((await state()).mode, "timer");
      assert.equal(await page.evaluate(() => window.__microphoneQa.calls), 1);
      assert.deepEqual(errors, []);
    },
  );
} catch (e) {
  results.push({
    name: "microphone lifecycle",
    passed: false,
    error: e.message,
  });
  await page.screenshot({
    path: path.join(out, "microphone-failure.png"),
    fullPage: true,
  });
  throw e;
} finally {
  await writeFile(
    path.join(out, "microphone-results.json"),
    JSON.stringify(
      { results, errors, hardware: "simulated Web Audio only" },
      null,
      2,
    ),
  );
  await browser.close();
}
