import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import app from "../src/app";
import { pool } from "@workspace/db";
import { passwordHash, sha256 } from "../src/lib/security";

test("all login methods, roles, student credentials and session revocation use real HTTP", async (t) => {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1");
  assert.match(
    process.env.TEACHER_TEST_SCHEMA || "",
    /^teacher_qa_[a-f0-9]{32}$/,
  );
  app.set("trust proxy", 1);
  const password = "Qa-" + randomUUID(),
    hash = await passwordHash(password);
  const admin = randomUUID(),
    teacher = randomUUID(),
    merchant = randomUUID(),
    manager = randomUUID(),
    outsider = randomUUID();
  const tokens = new Map<string, { cookie: string; csrf: string }>();
  for (const uid of [admin, teacher, merchant, manager, outsider]) {
    await pool.query(
      "INSERT INTO users(id,name,email,password_hash,role,account_type) VALUES($1,$2,$3,$4,$5,$6)",
      [
        uid,
        "Local login QA",
        uid + "@example.invalid",
        hash,
        uid === admin ? "SUPERADMIN" : "OWNER",
        uid === teacher ? "teacher" : "merchant",
      ],
    );
  }
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  let nextIp = 1;
  async function request(
    path: string,
    uid: string | null = null,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    csrf = true,
    ip?: string,
  ) {
    let auth = uid ? tokens.get(uid) : undefined;
    if (!uid && body !== undefined && csrf) {
      const pre = await fetch(base + "/auth/csrf");
      const token = (await pre.json()).token;
      auth = { cookie: `lootbot_csrf=${token}`, csrf: token };
    }
    const response = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip || `192.0.2.${(nextIp++ % 250) + 1}`,
        ...(auth
          ? {
              cookie: auth.cookie,
              ...(csrf ? { "x-csrf-token": auth.csrf } : {}),
            }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json(),
      cookies = response.headers.getSetCookie();
    return { status: response.status, data, cookies };
  }
  async function login(uid: string) {
    const r = await request("/auth/login", null, {
      email: (uid + "@example.invalid").toUpperCase(),
      password,
    });
    assert.equal(r.status, 200);
    tokens.set(uid, {
      cookie: r.cookies.map((c) => c.split(";")[0]).join("; "),
      csrf: r.data.csrfToken,
    });
    return r;
  }
  let school = "",
    classroom = "",
    access: any,
    student = "";
  try {
    await t.test(
      "merchant, teacher, Super Admin and school manager retain their roles and permissions",
      async () => {
        for (const uid of [admin, teacher, merchant, manager, outsider]) {
          const signed = await login(uid);
          assert.equal(signed.data.user.id, uid);
          assert.ok(
            signed.cookies.some(
              (c) =>
                c.startsWith("lootbot_session=") &&
                /HttpOnly/i.test(c) &&
                /SameSite=Strict/i.test(c),
            ),
          );
          assert.equal((await request("/auth/me", uid)).data.id, uid);
        }
        assert.equal(
          (await request("/account/workspace", teacher)).data.accountType,
          "teacher",
        );
        assert.equal(
          (await request("/account/workspace", merchant)).data.accountType,
          "merchant",
        );
        assert.equal((await request("/admin/overview", merchant)).status, 403);
        assert.equal((await request("/admin/overview", teacher)).status, 403);
        assert.equal((await request("/admin/overview", admin)).status, 200);
        assert.equal(
          (await request("/account/type", merchant, { accountType: "teacher" }))
            .status,
          409,
        );
        school = (
          await request("/education/schools", admin, {
            name: "Isolated authentication QA",
          })
        ).data.id;
        for (const [uid, role] of [
          [manager, "SCHOOL_ADMIN"],
          [teacher, "TEACHER"],
        ])
          assert.equal(
            (
              await request("/education/grants", admin, {
                userId: uid,
                role,
                scope: school,
              })
            ).status,
            200,
          );
        assert.equal(
          (await request("/account/workspace", manager)).data.educationRole,
          "SCHOOL_ADMIN",
        );
        classroom = (
          await request("/education/classes", admin, {
            schoolId: school,
            ownerId: teacher,
            name: "QA class",
            grade: "Third",
          })
        ).data.id;
        assert.ok(classroom);
      },
    );
    await t.test(
      "registration starts without privileges, forbids duplicate email and requires CSRF",
      async () => {
        const email = randomUUID() + "@example.invalid";
        assert.equal(
          (
            await request(
              "/auth/register",
              null,
              { name: "QA", email, password },
              "POST",
              false,
            )
          ).status,
          403,
        );
        const created = await request("/auth/register", null, {
          name: "QA",
          email,
          password,
          role: "SUPERADMIN",
          accountType: "teacher",
        });
        assert.equal(created.status, 201);
        assert.equal(created.data.user.role, "OWNER");
        const uid = created.data.user.id;
        tokens.set(uid, {
          cookie: created.cookies.map((c) => c.split(";")[0]).join("; "),
          csrf: created.data.csrfToken,
        });
        assert.equal(
          (await request("/account/workspace", uid)).data.accountType,
          null,
        );
        assert.equal(
          (
            await request("/auth/register", null, {
              name: "QA",
              email,
              password,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              "/auth/login",
              null,
              { email, password },
              "POST",
              false,
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "wrong, malformed, deleted and suspended credentials do not create sessions",
      async () => {
        assert.equal(
          (
            await request("/auth/login", null, {
              email: merchant + "@example.invalid",
              password: "invalid-password",
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await request("/auth/login", null, {
              email: "invalid-email",
              password,
            })
          ).status,
          400,
        );
        await pool.query("UPDATE users SET suspended=true WHERE id=$1", [
          outsider,
        ]);
        assert.equal(
          (
            await request("/auth/login", null, {
              email: outsider + "@example.invalid",
              password,
            })
          ).status,
          401,
        );
        assert.equal((await request("/auth/me", outsider)).status, 401);
        await pool.query(
          "UPDATE users SET suspended=false,is_deleted=true WHERE id=$1",
          [outsider],
        );
        assert.equal(
          (
            await request("/auth/login", null, {
              email: outsider + "@example.invalid",
              password,
            })
          ).status,
          401,
        );
        await pool.query(
          "UPDATE users SET is_deleted=false,password_hash='malformed' WHERE id=$1",
          [outsider],
        );
        assert.equal(
          (
            await request("/auth/login", null, {
              email: outsider + "@example.invalid",
              password,
            })
          ).status,
          401,
        );
      },
    );
    await t.test(
      "password lockout and IP throttling reject repeated attempts",
      async () => {
        await pool.query(
          "UPDATE users SET failed_login_attempts=0,locked_until=NULL WHERE id=$1",
          [merchant],
        );
        for (let i = 0; i < 5; i++)
          assert.equal(
            (
              await request("/auth/login", null, {
                email: merchant + "@example.invalid",
                password: "wrong-password",
              })
            ).status,
            401,
          );
        assert.equal(
          (
            await request("/auth/login", null, {
              email: merchant + "@example.invalid",
              password,
            })
          ).status,
          429,
        );
        await pool.query(
          "UPDATE users SET locked_until=now()-interval '1 minute' WHERE id=$1",
          [merchant],
        );
        await login(merchant);
        for (let i = 0; i < 5; i++)
          assert.equal(
            (
              await request(
                "/auth/login",
                null,
                { email: randomUUID() + "@example.invalid", password },
                "POST",
                true,
                "198.51.100.1",
              )
            ).status,
            401,
          );
        assert.equal(
          (
            await request(
              "/auth/login",
              null,
              { email: admin + "@example.invalid", password },
              "POST",
              true,
              "198.51.100.1",
            )
          ).status,
          429,
        );
      },
    );
    await t.test(
      "personal student code signs into the correct account without email or password",
      async () => {
        access = (
          await request("/education/student-access", teacher, {
            classId: classroom,
            name: "Student QA",
            days: 7,
          })
        ).data;
        assert.match(access.code, /^[A-F0-9]{32}$/);
        const row = (
          await pool.query(
            "SELECT a.code_hash,e.user_id FROM education_student_access a JOIN education_enrollments e ON e.id=a.enrollment_id WHERE a.id=$1",
            [access.id],
          )
        ).rows[0];
        student = row.user_id;
        assert.notEqual(row.code_hash, access.code);
        assert.equal(
          (
            await request(
              "/auth/student-code",
              null,
              { code: access.code },
              "POST",
              false,
            )
          ).status,
          403,
        );
        const signed = await request("/auth/student-code", null, {
          code: access.code
            .toLowerCase()
            .match(/.{1,8}/g)!
            .join("-"),
        });
        assert.equal(signed.status, 200);
        assert.equal(signed.data.redirect, "/student");
        tokens.set(student, {
          cookie: signed.cookies.map((c) => c.split(";")[0]).join("; "),
          csrf: signed.data.csrfToken,
        });
        assert.equal((await request("/auth/me", student)).data.id, student);
        assert.equal(
          (await request("/account/workspace", student)).data.accountType,
          "student",
        );
        assert.equal(
          (await request("/education/student-home", student)).status,
          200,
        );
        for (const path of ["/admin/overview", "/teacher/profile", "/stores"])
          assert.equal((await request(path, student)).status, 403);
        assert.equal(
          (
            await request("/education/student-access", merchant, {
              classId: classroom,
              name: "No access",
            })
          ).status,
          404,
        );
        assert.equal(
          (await request("/auth/student-code", null, { code: "not-valid" }))
            .status,
          401,
        );
        assert.equal(
          (
            await request("/auth/login", null, {
              email: `student.${student}@accounts.lootbot.invalid`,
              password,
            })
          ).status,
          401,
        );
      },
    );
    await t.test(
      "independent teacher classes issue codes without manual school setup and stay isolated",
      async () => {
        const independent = randomUUID(),
          archived = randomUUID();
        for (const [cid, isArchived] of [
          [independent, false],
          [archived, true],
        ] as const)
          await pool.query(
            "INSERT INTO teacher_classes(id,owner_id,name,data,archived) VALUES($1,$2,$3,'{}'::jsonb,$4)",
            [cid, teacher, "Independent QA", isArchived],
          );
        const grantsBefore = (
          await pool.query(
            "SELECT count(*)::int AS n FROM education_grants WHERE user_id=$1",
            [teacher],
          )
        ).rows[0].n;
        assert.equal(
          (
            await request("/education/student-access", merchant, {
              classId: independent,
              name: "Forbidden",
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await request("/education/student-access", teacher, {
              classId: archived,
              name: "Archived",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request("/education/student-access", teacher, {
              classId: independent,
              name: "  ",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT 1 FROM education_school_classes WHERE class_id=$1",
              [independent],
            )
          ).rowCount,
          0,
        );
        const first = await request("/education/student-access", teacher, {
          classId: independent,
          name: "طالب مستقل",
        });
        assert.equal(first.status, 201);
        assert.equal(first.data.days, 30);
        const scoped = (
          await pool.query(
            "SELECT school_id FROM education_school_classes WHERE class_id=$1",
            [independent],
          )
        ).rows[0].school_id;
        assert.notEqual(scoped, school);
        const second = await request("/education/student-access", teacher, {
          classId: independent,
          name: "طالب ثانٍ",
        });
        assert.equal(second.status, 201);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM education_schools WHERE data->>'independentClassId'=$1",
              [independent],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM education_grants WHERE user_id=$1",
              [teacher],
            )
          ).rows[0].n,
          grantsBefore,
        );
        const signed = await request("/auth/student-code", null, {
          code: first.data.code,
        });
        assert.equal(signed.status, 200);
        const independentStudent = (
          await pool.query(
            "SELECT user_id FROM education_enrollments WHERE id=$1",
            [first.data.enrollmentId],
          )
        ).rows[0].user_id;
        tokens.set(independentStudent, {
          cookie: signed.cookies.map((c) => c.split(";")[0]).join("; "),
          csrf: signed.data.csrfToken,
        });
        const home = await request(
          "/education/student-home",
          independentStudent,
        );
        assert.equal(home.status, 200);
        assert.equal(home.data.memberships[0].class_id, independent);
        assert.equal(home.data.memberships[0].school_id, scoped);
        assert.equal(
          (
            await request("/education/student-access", teacher, {
              classId: classroom,
              enrollmentId: first.data.enrollmentId,
            })
          ).status,
          404,
        );
      },
    );
    await t.test(
      "rotating/revoking student credentials immediately invalidates old sessions and codes",
      async () => {
        const fresh = await request("/education/student-access", teacher, {
          classId: classroom,
          enrollmentId: access.enrollmentId,
          days: 7,
        });
        assert.equal(fresh.status, 201);
        assert.equal((await request("/auth/me", student)).status, 401);
        assert.equal(
          (await request("/auth/student-code", null, { code: access.code }))
            .status,
          401,
        );
        const signed = await request("/auth/student-code", null, {
          code: fresh.data.code,
        });
        assert.equal(signed.status, 200);
        tokens.set(student, {
          cookie: signed.cookies.map((c) => c.split(";")[0]).join("; "),
          csrf: signed.data.csrfToken,
        });
        assert.equal(
          (
            await request(
              "/education/student-access/" + access.enrollmentId,
              teacher,
              undefined,
              "DELETE",
            )
          ).status,
          200,
        );
        assert.equal((await request("/auth/me", student)).status, 401);
        assert.equal(
          (await request("/auth/student-code", null, { code: fresh.data.code }))
            .status,
          401,
        );
      },
    );
    await t.test(
      "expired and forged sessions fail; logout requires CSRF and destroys the valid session",
      async () => {
        const forged = randomUUID();
        tokens.set(forged, {
          cookie: "lootbot_session=" + randomUUID() + randomUUID(),
          csrf: "invalid",
        });
        assert.equal((await request("/auth/me", forged)).status, 401);
        assert.equal((await request("/account/workspace")).status, 401);
        assert.equal(
          (await request("/auth/logout", teacher, {}, "POST", false)).status,
          403,
        );
        assert.equal((await request("/auth/logout", teacher, {})).status, 200);
        assert.equal((await request("/auth/me", teacher)).status, 401);
        await login(teacher);
        await pool.query(
          "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
          [teacher],
        );
        assert.equal((await request("/auth/me", teacher)).status, 401);
      },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
});
