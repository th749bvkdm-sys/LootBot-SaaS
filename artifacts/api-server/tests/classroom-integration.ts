/** Classroom acceptance only uses a disposable in-memory database. */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import app from "../src/app";
import { pool } from "@workspace/db";
import { sha256 } from "../src/lib/security";

test("classroom rewards, roster, ownership, CSRF, streaks and privacy", async (t) => {
  assert.match(process.env.TEACHER_TEST_SCHEMA || "", /^teacher_qa_/);
  const owner = randomUUID(),
    other = randomUUID(),
    merchant = randomUUID(),
    studentUser = randomUUID();
  const cid = randomUUID(),
    otherClass = randomUUID(),
    secondClass = randomUUID();
  const sid = randomUUID(),
    removed = randomUUID(),
    archived = randomUUID(),
    foreignStudent = randomUUID();
  const auth = new Map<string, { cookie: string; csrf: string }>();
  for (const [id, type] of [
    [owner, "teacher"],
    [other, "teacher"],
    [merchant, "merchant"],
    [studentUser, "student"],
  ]) {
    const token = randomUUID() + randomUUID(),
      csrf = randomUUID() + randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,password_hash,account_type) VALUES($1,$2,$3,$4,$5)",
      [id, "اختبار محلي", id + "@example.invalid", "fixture", type],
    );
    await pool.query(
      "INSERT INTO sessions(id,user_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",
      [randomUUID(), id, sha256(token), sha256(csrf)],
    );
    auth.set(id, {
      cookie: `lootbot_session=${token}; lootbot_csrf=${csrf}`,
      csrf,
    });
  }
  for (const [id, user] of [
    [cid, owner],
    [otherClass, other],
    [secondClass, owner],
  ])
    await pool.query(
      "INSERT INTO teacher_classes(id,owner_id,name,data) VALUES($1,$2,$3,$4)",
      [id, user, "فصل اختبار", JSON.stringify({ subject: "العلوم" })],
    );
  for (const [id, cls, user, name] of [
    [sid, cid, owner, "طالب مشارك"],
    [removed, cid, owner, "طالب محذوف"],
    [archived, cid, owner, "طالب مؤرشف"],
    [foreignStudent, otherClass, other, "طالب آخر"],
  ])
    await pool.query(
      "INSERT INTO teacher_students(id,owner_id,class_id,name,internal_id,removed,archived) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, user, cls, name, id, id === removed, id === archived],
    );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  async function req(
    path: string,
    body?: unknown,
    user: string | null = owner,
    csrf = true,
  ) {
    const a = user ? auth.get(user) : undefined;
    const response = await fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(a
          ? { cookie: a.cookie, ...(csrf ? { "x-csrf-token": a.csrf } : {}) }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      data: await response.json(),
      cache: response.headers.get("cache-control"),
    };
  }
  const reward = {
    eventId: randomUUID(),
    classId: cid,
    studentIds: [sid],
    points: 2,
    reason: "مشاركة محلية",
  };
  try {
    await t.test(
      "authentication, teacher role, ownership and CSRF are required",
      async () => {
        assert.equal(
          (await req("/teacher/classroom?classId=" + cid, undefined, null))
            .status,
          401,
        );
        for (const id of [merchant, studentUser])
          assert.equal(
            (await req("/teacher/classroom?classId=" + cid, undefined, id))
              .status,
            403,
          );
        assert.equal(
          (await req("/teacher/classroom?classId=" + cid, undefined, other))
            .status,
          404,
        );
        assert.equal((await req("/teacher/classroom?classId=bad")).status, 400);
        assert.equal(
          (await req("/teacher/classroom/rewards", reward, owner, false))
            .status,
          403,
        );
        assert.equal(
          (
            await req(
              "/teacher/classroom/streak",
              { classId: cid },
              owner,
              false,
            )
          ).status,
          403,
        );
        assert.equal(
          (await req("/teacher/classroom/rewards", reward, other)).status,
          404,
        );
      },
    );
    await t.test(
      "only the active owned roster is returned without access secrets",
      async () => {
        const result = await req("/teacher/classroom?classId=" + cid);
        assert.equal(result.status, 200);
        assert.equal(result.cache, "no-store");
        assert.deepEqual(
          result.data.scores.map((s: any) => s.id),
          [sid],
        );
        assert.equal(result.data.subject, "العلوم");
        assert.equal(result.data.ownerId, owner);
        assert.equal(result.data.classPoints, 0);
        assert.equal(result.data.streakDays, 0);
        assert.equal(JSON.stringify(result.data).includes("password"), false);
      },
    );
    await t.test(
      "rewards persist once across replays and concurrent submissions",
      async () => {
        const pair = await Promise.all([
          req("/teacher/classroom/rewards", reward),
          req("/teacher/classroom/rewards", reward),
        ]);
        assert.deepEqual(pair.map((r) => r.status).sort(), [200, 201]);
        assert.equal(pair.filter((r) => r.data.replayed).length, 1);
        assert.equal(
          (await req("/teacher/classroom/rewards", reward)).data.replayed,
          true,
        );
        assert.equal(
          (await req("/teacher/classroom/rewards", { ...reward, points: 5 }))
            .status,
          409,
        );
        assert.equal(
          (
            await req("/teacher/classroom/rewards", {
              ...reward,
              classId: secondClass,
              studentIds: [],
            })
          ).status,
          409,
        );
        const result = await req("/teacher/classroom?classId=" + cid);
        assert.equal(result.data.scores[0].points, 2);
        assert.equal(result.data.scores[0].todayPoints, 2);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM teacher_classroom_events WHERE id=$1",
              [reward.eventId],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "rejects foreign, removed, archived or repeated students and malformed point values",
      async () => {
        for (const id of [foreignStudent, removed, archived])
          assert.equal(
            (
              await req("/teacher/classroom/rewards", {
                ...reward,
                eventId: randomUUID(),
                studentIds: [id],
              })
            ).status,
            400,
          );
        for (const points of [0, -1, 1.5, 1001, "2"])
          assert.equal(
            (
              await req("/teacher/classroom/rewards", {
                ...reward,
                eventId: randomUUID(),
                points,
              })
            ).status,
            400,
          );
        assert.equal(
          (
            await req("/teacher/classroom/rewards", {
              ...reward,
              eventId: randomUUID(),
              studentIds: [sid, sid],
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await req("/teacher/classroom/rewards", {
              ...reward,
              eventId: randomUUID(),
              ownerId: other,
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "class points are separate; calendar streaks are server-dated and idempotent",
      async () => {
        assert.equal(
          (
            await req("/teacher/classroom/rewards", {
              ...reward,
              eventId: randomUUID(),
              studentIds: [],
              points: 5,
            })
          ).status,
          201,
        );
        const saved = await req("/teacher/classroom/streak", { classId: cid });
        assert.equal(saved.status, 200);
        await req("/teacher/classroom/streak", { classId: cid });
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM teacher_classroom_days WHERE class_id=$1",
              [cid],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await req("/teacher/classroom/streak", {
              classId: cid,
              day: "2020-01-01",
            })
          ).status,
          400,
        );
        await pool.query(
          "INSERT INTO teacher_classroom_days(owner_id,class_id,day) VALUES($1,$2,$3::date-1),($1,$2,$3::date-3)",
          [owner, cid, saved.data.day],
        );
        const s = (await req("/teacher/classroom?classId=" + cid)).data;
        assert.equal(s.streakDays, 2);
        assert.equal(s.creditedToday, true);
        assert.equal(s.classPoints, 5);
        assert.equal(s.scores[0].points, 2);
      },
    );
    await t.test(
      "grade import is explicit, assessment-scoped and repeat-safe",
      async () => {
        assert.equal((await req("/teacher/grades")).data.length, 0);
        const date = (await req("/teacher/classroom?classId=" + cid)).data
          .today;
        const body = {
          classId: cid,
          title: "مشاركة الألعاب الصفية",
          date,
          totalMarks: 10,
          entries: [{ studentId: sid, marks: 2, status: "graded", weight: 1 }],
        };
        assert.equal((await req("/teacher/grades/bulk", body)).status, 200);
        assert.equal((await req("/teacher/grades/bulk", body)).status, 200);
        const grades = (await req("/teacher/grades")).data;
        assert.equal(grades.length, 1);
        assert.equal(grades[0].marks, 2);
        assert.equal(
          (await req("/teacher/grades/bulk", { ...body, classId: otherClass }))
            .status,
          400,
        );
      },
    );
    await t.test(
      "private export includes classroom history, deletion is owner-scoped",
      async () => {
        const exported = await req("/teacher/tools/export");
        assert.equal(exported.status, 200);
        assert.equal(exported.data.teacher_classroom_events.length, 2);
        assert.equal(exported.data.teacher_classroom_days.length, 3);
        assert.equal(
          (
            await req(
              "/teacher/classroom/streak",
              { classId: otherClass },
              other,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await req("/teacher/tools/delete-data", {
              confirmation: "DELETE_TEACHER_DATA",
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM teacher_classroom_events WHERE owner_id=$1",
              [owner],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM teacher_classroom_days WHERE owner_id=$1",
              [owner],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM teacher_classroom_days WHERE owner_id=$1",
              [other],
            )
          ).rows[0].n,
          1,
        );
      },
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
  }
});
