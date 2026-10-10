import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import app from "../src/app";
import { db, pool, sessionsTable, usersTable } from "@workspace/db";
import { passwordHash, sha256 } from "../src/lib/security";
import { runTeacherRules } from "../src/lib/teacher-worker";
import {
  createExamDocument,
  newQuestion,
} from "../../lootbot/src/lib/teacher-exam-model";

test("teacher account, privacy, roster, exam and scheduled rules persist through real HTTP", async (t) => {
  delete process.env.TEACHER_OCR_PROVIDER; // Acceptance never sends private fixtures to external OCR.
  assert.match(process.env.TEACHER_TEST_SCHEMA || "", /^teacher_qa_[a-f0-9]+$/);
  const schema = (await pool.query("SHOW search_path")).rows[0].search_path;
  assert.ok(
    schema.includes(process.env.TEACHER_TEST_SCHEMA!),
    "Teacher acceptance only runs in its disposable schema.",
  );
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const [first, second, merchant, newUser] = ids;
  const cookies = new Map<string, { cookie: string; csrf: string }>();
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    for (const [index, id] of ids.entries()) {
      const token = randomUUID() + randomUUID(),
        csrf = randomUUID() + randomUUID();
      await db.insert(usersTable).values({
        id,
        name: "حساب تجريبي",
        email: `teacher-${id}@example.invalid`,
        passwordHash: await passwordHash("Test-" + randomUUID()),
        accountType: index < 2 ? "teacher" : index === 2 ? "merchant" : null,
      });
      await db.insert(sessionsTable).values({
        id: randomUUID(),
        userId: id,
        tokenHash: sha256(token),
        csrfHash: sha256(csrf),
        expiresAt: new Date(Date.now() + 3600000),
      });
      cookies.set(id, {
        cookie: `lootbot_session=${token}; lootbot_csrf=${csrf}`,
        csrf,
      });
    }
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const port = (server.address() as { port: number }).port;
    const request = async (
      path: string,
      user: string | null = first,
      body?: unknown,
      method = body === undefined ? "GET" : "POST",
      csrf = true,
    ) => {
      const auth = user ? cookies.get(user) : undefined;
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(auth
            ? {
                cookie: auth.cookie,
                ...(csrf ? { "x-csrf-token": auth.csrf } : {}),
              }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json() };
    };
    const upload = async (user: string, bytes: Buffer, mime = "image/png") => {
      const auth = cookies.get(user)!;
      const response = await fetch(
        `http://127.0.0.1:${port}/api/teacher/assets`,
        {
          method: "POST",
          headers: {
            cookie: auth.cookie,
            "x-csrf-token": auth.csrf,
            "content-type": mime,
          },
          body: new Uint8Array(bytes),
        },
      );
      return { status: response.status, data: await response.json() };
    };
    let classId = "",
      secondClass = "",
      studentId = "",
      assetId = "",
      examId = "",
      ruleId = "";
    await t.test(
      "actual registration begins without a role and the selected teacher role survives logout and login",
      async () => {
        const anonymous = await fetch(`http://127.0.0.1:${port}/api/auth/csrf`);
        const csrf = (await anonymous.json()).token;
        const cookie = anonymous.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
        const email = `signup-${randomUUID()}@example.invalid`,
          password = `Test-${randomUUID()}`;
        const registered = await fetch(
          `http://127.0.0.1:${port}/api/auth/register`,
          {
            method: "POST",
            headers: {
              cookie,
              "x-csrf-token": csrf,
              "content-type": "application/json",
            },
            body: JSON.stringify({ name: "معلم تجريبي جديد", email, password }),
          },
        );
        assert.equal(registered.status, 201);
        const created = await registered.json();
        const id = created.user.id;
        ids.push(id);
        cookies.set(id, {
          cookie: registered.headers
            .getSetCookie()
            .map((value) => value.split(";")[0])
            .join("; "),
          csrf: created.csrfToken,
        });
        assert.equal(
          (await request("/account/workspace", id)).data.accountType,
          null,
        );
        assert.equal(
          (await request("/account/type", id, { accountType: "teacher" }))
            .status,
          200,
        );
        assert.equal((await request("/auth/logout", id, {})).status, 200);
        assert.equal((await request("/account/workspace", id)).status, 401);
        const loginCsrf = await fetch(`http://127.0.0.1:${port}/api/auth/csrf`);
        const token = (await loginCsrf.json()).token;
        const signedIn = await fetch(
          `http://127.0.0.1:${port}/api/auth/login`,
          {
            method: "POST",
            headers: {
              cookie: loginCsrf.headers
                .getSetCookie()
                .map((value) => value.split(";")[0])
                .join("; "),
              "x-csrf-token": token,
              "content-type": "application/json",
            },
            body: JSON.stringify({ email, password }),
          },
        );
        assert.equal(signedIn.status, 200);
        const login = await signedIn.json();
        cookies.set(id, {
          cookie: signedIn.headers
            .getSetCookie()
            .map((value) => value.split(";")[0])
            .join("; "),
          csrf: login.csrfToken,
        });
        assert.equal(
          (await request("/account/workspace", id)).data.accountType,
          "teacher",
        );
        assert.equal((await request("/teacher/profile", id)).status, 200);
      },
    );
    await t.test(
      "server enforces separate account type and CSRF while preserving merchant access",
      async () => {
        assert.equal((await request("/teacher/profile", null)).status, 401);
        assert.equal((await request("/teacher/profile", merchant)).status, 403);
        assert.equal((await request("/stores", first)).status, 403);
        assert.equal((await request("/stores", merchant)).status, 200);
        assert.equal(
          (await request("/account/workspace", newUser)).data.accountType,
          null,
        );
        assert.equal(
          (
            await request(
              "/account/type",
              newUser,
              { accountType: "teacher" },
              "POST",
              false,
            )
          ).status,
          403,
        );
        assert.equal(
          (await request("/account/type", newUser, { accountType: "teacher" }))
            .status,
          200,
        );
        assert.equal(
          (await request("/account/workspace", newUser)).data.accountType,
          "teacher",
        );
        assert.equal(
          (await request("/account/type", newUser, { accountType: "merchant" }))
            .status,
          409,
        );
        assert.equal((await request("/teacher/profile", newUser)).status, 200);
      },
    );
    await t.test(
      "saveable setup validates completion and scopes private school details",
      async () => {
        assert.equal(
          (
            await request(
              "/teacher/profile",
              first,
              { teacherName: "معلم تجريبي", onboardingStep: 2 },
              "PUT",
            )
          ).status,
          200,
        );
        assert.equal(
          (await request("/teacher/profile")).data.onboardingStep,
          2,
        );
        assert.equal(
          (await request("/teacher/profile", first, { complete: true }, "PUT"))
            .status,
          400,
        );
        assert.equal(
          (
            await request(
              "/teacher/profile",
              first,
              {
                teacherName: "معلم تجريبي",
                schoolName: "مدرسة تجريبية",
                subjects: ["الرياضيات"],
                classes: ["الثاني أ"],
                complete: true,
              },
              "PUT",
            )
          ).status,
          200,
        );
        assert.equal(
          (await request("/account/workspace")).data.profileComplete,
          true,
        );
        assert.equal(
          (await request("/teacher/profile", second)).data.schoolName,
          "",
        );
      },
    );
    await t.test(
      "class and import preview prevent malformed and duplicate roster writes",
      async () => {
        classId = (
          await request("/teacher/classes", first, {
            name: "الفصل التجريبي أ",
            grade: "الثاني",
            year: "1448",
            subject: "الرياضيات",
          })
        ).data.id;
        secondClass = (
          await request("/teacher/classes", first, { name: "الفصل التجريبي ب" })
        ).data.id;
        const invalid = [
          { name: "", internalId: "1" },
          { name: "طالب تجريبي", internalId: "٠٢" },
          { name: "طالب آخر", internalId: "02" },
        ];
        const preview = await request(
          "/teacher/students/import/preview",
          first,
          { classId, rows: invalid },
        );
        assert.equal(preview.status, 200);
        assert.equal(preview.data.totals.invalid, 2);
        assert.ok(preview.data.rows[2].errors.length);
        assert.equal(
          (
            await request("/teacher/students/import", first, {
              classId,
              rows: invalid,
              mode: "add",
            })
          ).status,
          400,
        );
        assert.equal((await request("/teacher/students")).data.length, 0);
        const valid = [
          {
            name: "طالب تجريبي أول",
            internalId: "٠١",
            notes: "ملاحظة تجريبية",
          },
        ];
        assert.equal(
          (
            await request("/teacher/students/import", first, {
              classId,
              rows: valid,
              mode: "add",
            })
          ).data.added,
          1,
        );
        const roster = (await request("/teacher/students")).data;
        studentId = roster[0].id;
        assert.equal(roster[0].internalId, "01");
        assert.equal(
          (
            await request("/teacher/students/import", first, {
              classId,
              rows: valid,
              mode: "add",
            })
          ).data.skipped,
          1,
        );
        assert.equal(
          (
            await request("/teacher/students/import", first, {
              classId,
              rows: [{ ...valid[0], notes: "تحديث مقصود" }],
              mode: "update",
            })
          ).data.updated,
          1,
        );
        assert.equal(
          (await request("/teacher/students", second)).data.length,
          0,
        );
        assert.equal(
          (
            await request("/teacher/students/import", second, {
              classId,
              rows: valid,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await request("/teacher/students/search", first, {
              search: "تجريبي",
              page: 1,
              pageSize: 10,
            })
          ).data.total,
          1,
        );
      },
    );
    await t.test(
      "attendance and grade records are safe, editable and retain history on a class move",
      async () => {
        const day = new Date().toISOString().slice(0, 10);
        const entry = {
          classId,
          date: day,
          entries: [{ studentId, status: "absent", note: "تجريبي" }],
        };
        assert.equal(
          (await request("/teacher/attendance", first, entry)).status,
          200,
        );
        assert.equal(
          (await request("/teacher/attendance", first, entry)).status,
          200,
        );
        assert.equal((await request("/teacher/attendance")).data.length, 1);
        assert.equal(
          (await request("/teacher/attendance", second, entry)).status,
          400,
        );
        const grade = {
          classId,
          studentId,
          title: "تقييم تجريبي",
          date: day,
          totalMarks: 10,
          marks: 11,
        };
        assert.equal(
          (await request("/teacher/grades", first, grade)).status,
          400,
        );
        assert.equal(
          (await request("/teacher/grades", first, { ...grade, marks: null }))
            .status,
          201,
        );
        assert.equal(
          (
            await request("/teacher/tasks", first, {
              title: "واجب تجريبي",
              classId,
              kind: "assignment",
              studentCompletion: [studentId],
              dueAt: new Date(Date.now() + 3600000).toISOString(),
            })
          ).status,
          201,
        );
        const before = await request(`/teacher/students/${studentId}/profile`);
        assert.equal(before.data.attendance.length, 1);
        assert.equal(before.data.grades.length, 1);
        assert.equal(before.data.assignments.length, 1);
        assert.equal(
          (await request(`/teacher/students/${studentId}/profile`, second))
            .status,
          404,
        );
        assert.equal(
          (
            await request(
              `/teacher/students/${studentId}`,
              first,
              { ...before.data.student, classId: secondClass },
              "PUT",
            )
          ).status,
          200,
        );
        const after = await request(`/teacher/students/${studentId}/profile`);
        assert.equal(after.data.student.classId, secondClass);
        assert.equal(after.data.attendance[0].classId, classId);
        assert.equal(after.data.grades.length, 1);
        assert.equal((await request(`/teacher/grades/${after.data.grades[0].id}`,first,{...after.data.grades[0],note:'تحديث سجل تاريخي بعد النقل'},'PUT')).status,200);
        assert.equal((await request(`/teacher/tasks/${after.data.assignments[0].id}`,first,{...after.data.assignments[0],notes:'تحديث واجب تاريخي بعد النقل'},'PUT')).status,200);
        assert.equal((await request('/teacher/attendance',first,{...entry,classId:secondClass})).status,409);
        assert.equal(
          (
            await request(
              `/teacher/students/${studentId}`,
              first,
              undefined,
              "DELETE",
            )
          ).status,
          200,
        );
        assert.equal((await request("/teacher/students")).data.length, 0);
        assert.equal((await request('/teacher/students/search',first,{archived:true})).data.items[0].removed,true);
        assert.equal(
          (
            await request(
              `/teacher/students/${studentId}`,
              first,
              { ...after.data.student, archived: false, removed: false },
              "PUT",
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "private validated images support honest manual OCR and ownership protection",
      async () => {
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/fV8AAAAASUVORK5CYII=",
          "base64",
        );
        assert.equal((await upload(first, png, "image/jpeg")).status, 400);
        assert.equal((await upload(first, Buffer.from("<svg/>"))).status, 400);
        const uploaded = await upload(first, png);
        assert.equal(uploaded.status, 201);
        assetId = uploaded.data.id;
        const response = await fetch(
          `http://127.0.0.1:${port}/api/teacher/assets/${assetId}`,
          { headers: { cookie: cookies.get(first)!.cookie } },
        );
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(
          (
            await fetch(
              `http://127.0.0.1:${port}/api/teacher/assets/${assetId}`,
              { headers: { cookie: cookies.get(second)!.cookie } },
            )
          ).status,
          404,
        );
        const ocr = await request(`/teacher/assets/${assetId}/ocr`, first, {});
        assert.equal(ocr.data.status, "manual");
        assert.deepEqual(ocr.data.blocks, []);
      },
    );
    await t.test(
      "editable exams, optimistic save and reusable templates preserve the source",
      async () => {
        const document = createExamDocument("formal", {
          schoolName: "مدرسة تجريبية",
          teacherName: "معلم تجريبي",
          subjects: ["الرياضيات"],
        });
        document.sections[0].questions.push(
          newQuestion("سؤال تجريبي لا يحتوي معلومات حقيقية"),
        );
        const created = await request("/teacher/exams", first, {
          title: "اختبار تجريبي",
          document,
          sourceAssetId: assetId,
        });
        assert.equal(created.status, 201);
        examId = created.data.id;
        assert.equal(
          (await request(`/teacher/exams/${examId}`, second)).status,
          404,
        );
        const edited = {
          ...document,
          layout: { ...document.layout, style: "minimal" },
        };
        const saved = await request(
          `/teacher/exams/${examId}`,
          first,
          {
            title: "اختبار معدل",
            document: edited,
            sourceAssetId: assetId,
            expectedVersion: 1,
          },
          "PUT",
        );
        assert.equal(saved.status, 200);
        assert.equal(saved.data.version, 2);
        assert.equal(
          (
            await request(
              `/teacher/exams/${examId}`,
              first,
              { title: "نسخة قديمة", document, expectedVersion: 1 },
              "PUT",
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request("/teacher/exams", second, {
              title: "غير مصرح",
              document,
              sourceAssetId: assetId,
            })
          ).status,
          400,
        );
        const clone = await request(`/teacher/exams/${examId}/clone`, first, {
          isTemplate: true,
          title: "قالب تجريبي",
        });
        assert.equal(clone.status, 201);
        assert.equal(clone.data.isTemplate, true);
        assert.equal(clone.data.sourceAssetId, assetId);
        assert.equal(
          clone.data.document.sections[0].questions[0].text,
          document.sections[0].questions[0].text,
        );
        assert.equal(
          (await request("/teacher/exams?templates=true")).data.length,
          1,
        );
      },
    );
    await t.test(
      "real scheduled rules are idempotent and use saved counts without guardian messaging",
      async () => {
        const made = await request("/teacher/automations", first, {
          name: "متابعة الغياب التجريبي",
          type: "absence",
          config: { threshold: 1 },
          enabled: true,
        });
        assert.equal(made.status, 201);
        ruleId = made.data.id;
        await pool.query(
          "UPDATE teacher_rules SET next_run_at=now()-interval '1 minute' WHERE id=$1",
          [ruleId],
        );
        await runTeacherRules(first);
        await pool.query(
          "UPDATE teacher_rules SET next_run_at=now()-interval '1 minute' WHERE id=$1",
          [ruleId],
        );
        await runTeacherRules(first);
        const followups = (await request("/teacher/tasks")).data.filter(
          (row: { title: string }) => row.title === "متابعة غياب متكرر",
        );
        assert.equal(followups.length, 1);
        const rules = await request("/teacher/automations");
        assert.ok(rules.data[0].lastRunAt);
        assert.ok(rules.data[0].lastResult);
        assert.equal(rules.data[0].error, null);
        assert.equal(
          (await request(`/teacher/automations/${ruleId}/runs`, second)).data
            .length,
          0,
        );
        const reminders = (await request("/teacher/reminders")).data;
        const absence = reminders.filter(
          (r: { title: string }) => r.title === "متابعة الغياب",
        );
        assert.equal(absence.length, 1);
        assert.equal(
          (
            await request(
              `/teacher/reminders/${absence[0].id}`,
              first,
              { read: true },
              "PUT",
            )
          ).data.read,
          true,
        );
        const dashboard = await request("/teacher/dashboard");
        assert.equal(dashboard.status, 200);
        assert.equal(dashboard.data.counts.classes, 2);
        assert.equal(dashboard.data.counts.students, 1);
        assert.equal(dashboard.data.counts.exams, 1);
        assert.equal(dashboard.data.counts.ungraded, 1);
      },
    );
    await t.test(
      "bulk grading rolls back invalid entries and persists default class templates",
      async () => {
        const classes = (await request("/teacher/classes")).data;
        assert.deepEqual(
          classes.find((c: { id: string }) => c.id === classId)
            .gradebookTemplate,
          [
            { title: "المشاركة", totalMarks: 10 },
            { title: "الواجبات", totalMarks: 10 },
            { title: "اختبار قصير", totalMarks: 20 },
          ],
        );
        const data = {
          classId: secondClass,
          title: "المشاركة",
          totalMarks: 10,
          date: new Date().toISOString().slice(0, 10),
          entries: [{ studentId, marks: 8, note: "تجريبي" }],
        };
        assert.equal(
          (
            await request("/teacher/grades/bulk", first, {
              ...data,
              entries: [
                ...data.entries,
                { studentId: randomUUID(), marks: 11 },
              ],
            })
          ).status,
          400,
        );
        assert.equal(
          (await request("/teacher/grades")).data.filter(
            (g: { title: string }) => g.title === "المشاركة",
          ).length,
          0,
        );
        const saved = await request("/teacher/grades/bulk", first, data);
        assert.equal(saved.status, 200);
        assert.equal(saved.data.saved, 1);
        const updated = await request("/teacher/grades/bulk", first, {
          ...data,
          entries: [{ studentId, marks: 9 }],
        });
        assert.equal(updated.data.entries[0].id, saved.data.entries[0].id);
        assert.equal(
          (await request("/teacher/grades")).data.filter(
            (g: { title: string }) => g.title === "المشاركة",
          ).length,
          1,
        );
        assert.equal(
          (await request("/teacher/grades/bulk", second, data)).status,
          400,
        );
      },
    );
    await t.test(
      "all other scheduled rule types execute against saved data and pause or duplicate safely",
      async () => {
        const past = new Date(Date.now() - 3600000).toISOString();
        const ids: string[] = [];
        for (const type of [
          "upcoming",
          "grading",
          "weekly",
          "draft",
          "recurring",
        ]) {
          const created = await request("/teacher/automations", first, {
            name: `قاعدة ${type} تجريبية`,
            type,
            enabled: true,
            config: {
              daysBefore: 2,
              dueAt: past,
              title: "تذكير تجريبي",
              intervalDays: 7,
            },
          });
          assert.equal(created.status, 201);
          ids.push(created.data.id);
        }
        await pool.query(
          "UPDATE teacher_rules SET next_run_at=now()-interval '1 minute' WHERE id=ANY($1::text[])",
          [ids],
        );
        await runTeacherRules(first);
        const rules = (await request("/teacher/automations")).data.filter(
          (r: { id: string }) => ids.includes(r.id),
        );
        assert.equal(rules.length, 5);
        assert.ok(
          rules.every(
            (r: { lastRunAt: string; error: string | null }) =>
              r.lastRunAt && r.error === null,
          ),
        );
        const reminders = (await request("/teacher/reminders")).data;
        for (const title of [
          "موعد واجب أو مهمة قريب",
          "تقييم يحتاج رصد الدرجة",
          "ملخص الأسبوع",
          "مسودة اختبار تحتاج مراجعة",
          "تذكير تجريبي",
        ])
          assert.ok(
            reminders.some((r: { title: string }) => r.title === title),
            title,
          );
        const copy = await request(
          `/teacher/automations/${ids[4]}/clone`,
          first,
          {},
        );
        assert.equal(copy.status, 201);
        assert.equal(copy.data.enabled, false);
        assert.equal(copy.data.nextRunAt, null);
        const paused = await request(
          `/teacher/automations/${ids[4]}`,
          first,
          {
            ...rules.find((r: { id: string }) => r.id === ids[4]),
            enabled: false,
          },
          "PUT",
        );
        assert.equal(paused.status, 200);
        assert.equal(paused.data.nextRunAt, null);
        assert.equal(
          (
            await request(
              `/teacher/automations/${copy.data.id}`,
              first,
              undefined,
              "DELETE",
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "class-scoped upcoming rules remind only tasks while global rules include saved exams",
      async () => {
        const day = (await pool.query("SELECT to_char(CURRENT_DATE,'YYYY-MM-DD') AS day")).rows[0].day;
        const exam = (await request(`/teacher/exams/${examId}`)).data;
        const saved = await request(`/teacher/exams/${examId}`, first, {
          title: exam.title,
          document: { ...exam.document, metadata: { ...exam.document.metadata, date: day } },
          sourceAssetId: exam.sourceAssetId,
          expectedVersion: exam.version,
        }, "PUT");
        assert.equal(saved.status, 200);
        const ruleIds: string[] = [];
        for (const scoped of [true, false]) {
          const created = await request("/teacher/automations", first, {
            name: scoped ? "تنبيه فصل تجريبي" : "تنبيه عام تجريبي",
            type: "upcoming",
            enabled: true,
            config: { daysBefore: 2, ...(scoped ? { classId } : {}) },
          });
          assert.equal(created.status, 201);
          ruleIds.push(created.data.id);
        }
        await pool.query("UPDATE teacher_rules SET next_run_at=now()-interval '1 minute' WHERE id=ANY($1::text[])", [ruleIds]);
        await runTeacherRules(first);
        const reminders = (await request("/teacher/reminders")).data;
        const scopedReminders = reminders.filter((r: { ruleId: string }) => r.ruleId === ruleIds[0]);
        const globalReminders = reminders.filter((r: { ruleId: string }) => r.ruleId === ruleIds[1]);
        assert.ok(scopedReminders.some((r: { title: string }) => r.title === "موعد واجب أو مهمة قريب"));
        assert.ok(!scopedReminders.some((r: { title: string }) => r.title === "موعد اختبار قريب"));
        assert.ok(globalReminders.some((r: { title: string; body: string }) => r.title === "موعد اختبار قريب" && r.body.includes(exam.title)));
        await runTeacherRules(first);
        assert.equal((await request("/teacher/reminders")).data.filter((r: { ruleId: string }) => ruleIds.includes(r.ruleId)).length,
          scopedReminders.length + globalReminders.length);
      },
    );
  } finally {
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pool.query("DELETE FROM users WHERE id=ANY($1::text[])", [ids]);
    await pool.end();
  }
});
