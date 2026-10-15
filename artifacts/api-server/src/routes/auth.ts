import { and, eq, gt, lt } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  GetCurrentUserResponse,
  GetCsrfTokenResponse,
  LoginUserBody,
  LoginUserResponse,
  LogoutUserResponse,
  RegisterUserBody,
  RegisterUserResponse,
} from "@workspace/api-zod";
import { db, pool, sessionsTable, usersTable } from "@workspace/db";
import { requireAuth, requireCsrf, publicUser } from "../lib/auth-middleware";
import { writeAuditEvent } from "../lib/audit";
import { createLoginRateLimiter } from "../lib/login-rate-limit";
import { settings, codeHash, transaction } from "../lib/education";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createId,
  newOpaqueToken,
  passwordHash,
  safeStringEqual,
  sha256,
  verifyPassword,
} from "../lib/security";

const router: IRouter = Router();
const IP_ATTEMPT_LIMIT = 5;
const ACCOUNT_LOCK_MS = 15 * 60_000;
const loginRateLimiter = createLoginRateLimiter({
  maxAttempts: IP_ATTEMPT_LIMIT,
});

function cookieOptions(httpOnly: boolean, maxAge: number) {
  return {
    httpOnly,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}

function setSessionCookies(
  res: Parameters<RequestHandler>[1],
  sessionToken: string,
  csrfToken: string,
  maxAge = SESSION_TTL_MS,
) {
  res.cookie(SESSION_COOKIE, sessionToken, cookieOptions(true, maxAge));
  res.cookie(CSRF_COOKIE, csrfToken, cookieOptions(false, maxAge));
  res.clearCookie("lootbot_student", { path: "/" });
  res.clearCookie("lootbot_student_csrf", { path: "/" });
}

export async function issueSession(
  userId: string,
  res: Parameters<RequestHandler>[1],
): Promise<string> {
  const sessionToken = newOpaqueToken();
  const csrfToken = newOpaqueToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.delete(sessionsTable).where(lt(sessionsTable.expiresAt, new Date()));
  await db.insert(sessionsTable).values({
    id: createId(),
    userId,
    tokenHash: sha256(sessionToken),
    csrfHash: sha256(csrfToken),
    expiresAt,
  });

  setSessionCookies(res, sessionToken, csrfToken);
  return csrfToken;
}

const rateLimitLogin: RequestHandler = (req, res, next): void => {
  const key = req.ip || "unknown";
  if (loginRateLimiter.isLimited(key)) {
    res.status(429).json({ error: "محاولات كثيرة. حاول مجددًا بعد دقيقة." });
    return;
  }
  next();
};
router.post("/auth/student-code", requireCsrf, async (req, res, next) => {
  res.set('Cache-Control','no-store');
  try {
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    const normalized = code.replace(/[\s-]/g, "").toUpperCase();
    const limits = await pool.query(
      `INSERT INTO teacher_entry_limits(key,attempts,expires_at) VALUES($1,1,now()+interval '10 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN teacher_entry_limits.expires_at<=now() THEN 1 ELSE teacher_entry_limits.attempts+1 END,expires_at=CASE WHEN teacher_entry_limits.expires_at<=now() THEN now()+interval '10 minutes' ELSE teacher_entry_limits.expires_at END RETURNING attempts`,
      ["student-login:" + sha256(req.ip || "unknown")],
    );
    if (limits.rows[0].attempts > 10) {
      res
        .status(429)
        .json({ error: "محاولات كثيرة. انتظر عشر دقائق ثم حاول مجددًا." });
      return;
    }
    if (!/^[A-F0-9]{32}$/.test(normalized)) {
      res
        .status(401)
        .json({ error: "تعذر الدخول بهذا الرمز. تحقق منه أو راجع معلمك." });
      return;
    }
    const policy = await settings();
    if (
      process.env.EDUCATION_DISABLED === "true" ||
      policy.maintenance ||
      !policy.studentRoom
    ) {
      res.status(403).json({ error: "غرفة الطالب غير متاحة حاليًا." });
      return;
    }
    const sessionToken = newOpaqueToken();
    const csrfToken = newOpaqueToken();
    const access = await transaction(async (tx) => {
      // Serialize account suspension and joins, then lock enrollment before credential.
      const candidate = (
        await tx.query("SELECT a.enrollment_id,e.user_id FROM education_student_access a JOIN education_enrollments e ON e.id=a.enrollment_id WHERE a.code_hash=$1", [codeHash(normalized)])
      ).rows[0];
      if (!candidate) return null;
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [candidate.user_id]);
      await tx.query("SELECT id FROM education_enrollments WHERE id=$1 FOR UPDATE", [candidate.enrollment_id]);
      const found = (
        await tx.query(
          `SELECT a.id,a.expires_at,e.user_id,e.school_id FROM education_student_access a JOIN education_enrollments e ON e.id=a.enrollment_id JOIN users u ON u.id=e.user_id JOIN education_schools s ON s.id=e.school_id JOIN teacher_classes c ON c.id=e.class_id JOIN teacher_students st ON st.id=e.roster_id WHERE a.code_hash=$1 AND NOT a.revoked AND a.expires_at>now() AND e.status='active' AND u.account_type='student' AND u.role='OWNER' AND u.student_code_managed AND NOT u.suspended AND NOT u.is_deleted AND s.status='active' AND NOT c.archived AND NOT st.archived AND NOT st.removed FOR UPDATE OF a`,
          [codeHash(normalized)],
        )
      ).rows[0];
      if (!found) return null;
      const scoped = await settings(found.school_id, tx);
      if (!scoped.studentRoom || scoped.maintenance) return null;
      await tx.query(
        "UPDATE education_student_access SET last_used_at=now() WHERE id=$1",
        [found.id],
      );
      const expiresAt = new Date(Math.min(Date.now() + SESSION_TTL_MS, new Date(found.expires_at).getTime()));
      await tx.query(
        "INSERT INTO sessions(id,user_id,token_hash,csrf_hash,expires_at,student_access_id) VALUES($1,$2,$3,$4,$5,$6)",
        [createId(), found.user_id, sha256(sessionToken), sha256(csrfToken), expiresAt, found.id],
      );
      return { ...found, expiresAt };
    });
    if (!access) {
      res
        .status(401)
        .json({ error: "تعذر الدخول بهذا الرمز. تحقق منه أو راجع معلمك." });
      return;
    }
    setSessionCookies(res, sessionToken, csrfToken, Math.max(0, access.expiresAt.getTime() - Date.now()));
    await pool.query("DELETE FROM teacher_entry_limits WHERE key=$1", [
      "student-login:" + sha256(req.ip || "unknown"),
    ]);
    await writeAuditEvent({
      userId: access.user_id,
      action: "auth.student-code.login",
      summary: "دخول الطالب برمزه الشخصي",
    });
    res.json({ ok: true, csrfToken, redirect: "/student" });
  } catch (e) {
    next(e);
  }
});

router.get("/auth/csrf", async (req, res): Promise<void> => {
  const sessionToken = req.cookies?.[SESSION_COOKIE];
  const cookieToken = req.cookies?.[CSRF_COOKIE];

  if (typeof sessionToken === "string" && sessionToken.length >= 32) {
    const [session] = await db
      .select({
        id: sessionsTable.id,
        csrfHash: sessionsTable.csrfHash,
        expiresAt: sessionsTable.expiresAt,
      })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.tokenHash, sha256(sessionToken)),
          gt(sessionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (session) {
      if (
        typeof cookieToken === "string" &&
        safeStringEqual(sha256(cookieToken), session.csrfHash)
      ) {
        res.json(GetCsrfTokenResponse.parse({ token: cookieToken }));
        return;
      }

      const token = newOpaqueToken();
      await db
        .update(sessionsTable)
        .set({ csrfHash: sha256(token) })
        .where(eq(sessionsTable.id, session.id));
      const maxAge = Math.max(0, session.expiresAt.getTime() - Date.now());
      res.cookie(CSRF_COOKIE, token, cookieOptions(false, maxAge));
      res.json(GetCsrfTokenResponse.parse({ token }));
      return;
    }
  }

  const token = newOpaqueToken();
  res.cookie(CSRF_COOKIE, token, cookieOptions(false, 30 * 60_000));
  res.json(GetCsrfTokenResponse.parse({ token }));
});

router.post("/auth/register", requireCsrf, async (req, res): Promise<void> => {
  if (!(await settings()).registration) {
    res.status(403).json({ error: "التسجيل موقوف حاليًا." });
    return;
  }
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.name.trim()) {
    res.status(400).json({ error: "تحقق من الاسم والبريد وكلمة المرور." });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "تعذر إنشاء الحساب بهذه البيانات." });
    return;
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      id: createId(),
      name: parsed.data.name.trim(),
      email,
      passwordHash: await passwordHash(parsed.data.password),
      accountType: null,
    })
    .returning();
  const csrfToken = await issueSession(user.id, res);
  await writeAuditEvent({
    userId: user.id,
    action: "user.registered",
    summary: "تم إنشاء حساب جديد",
  });
  res
    .status(201)
    .json(RegisterUserResponse.parse({ user: publicUser(user), csrfToken }));
});

router.post(
  "/auth/login",
  rateLimitLogin,
  requireCsrf,
  async (req, res): Promise<void> => {
    const parsed = LoginUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "تعذر تسجيل الدخول. تحقق من البيانات." });
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const [user] = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.email, email), eq(usersTable.isDeleted, false)))
      .limit(1);
    if (!user || user.suspended || user.studentCodeManaged) {
      res.status(401).json({ error: "تعذر تسجيل الدخول. تحقق من البيانات." });
      return;
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      res.status(429).json({ error: "الحساب مقفل مؤقتًا. حاول لاحقًا." });
      return;
    }

    const passwordMatches = await verifyPassword(
      parsed.data.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      const attempts =
        (user.lockedUntil && user.lockedUntil.getTime() <= Date.now()
          ? 0
          : user.failedLoginAttempts) + 1;
      const lockedUntil =
        attempts >= IP_ATTEMPT_LIMIT
          ? new Date(Date.now() + ACCOUNT_LOCK_MS)
          : null;
      await db
        .update(usersTable)
        .set({
          failedLoginAttempts: attempts,
          lockedUntil,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, user.id));
      res.status(401).json({ error: "تعذر تسجيل الدخول. تحقق من البيانات." });
      return;
    }

    await db
      .update(usersTable)
      .set({ failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));
    loginRateLimiter.clear(req.ip || "unknown");
    const csrfToken = await issueSession(user.id, res);
    await writeAuditEvent({
      userId: user.id,
      action: "user.login",
      summary: "تم تسجيل الدخول",
    });
    res.json(LoginUserResponse.parse({ user: publicUser(user), csrfToken }));
  },
);

router.post(
  "/auth/logout",
  requireAuth,
  requireCsrf,
  async (req, res): Promise<void> => {
    await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.id, req.auth!.sessionId));
    await writeAuditEvent({
      userId: req.auth!.userId,
      action: "user.logout",
      summary: "تم تسجيل الخروج",
    });
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.clearCookie(CSRF_COOKIE, { path: "/" });
    res.json(LogoutUserResponse.parse({ success: true }));
  },
);

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(
      and(eq(usersTable.id, req.auth!.userId), eq(usersTable.isDeleted, false)),
    )
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "يجب تسجيل الدخول للمتابعة." });
    return;
  }
  res.json(GetCurrentUserResponse.parse(user));
});

export default router;
