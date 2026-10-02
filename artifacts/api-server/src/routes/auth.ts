import { and, eq, lt } from "drizzle-orm";
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
import { db, sessionsTable, usersTable } from "@workspace/db";
import { requireAuth, requireCsrf, publicUser } from "../lib/auth-middleware";
import { writeAuditEvent } from "../lib/audit";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createId,
  newOpaqueToken,
  passwordHash,
  sha256,
  verifyPassword,
} from "../lib/security";

const router: IRouter = Router();
const IP_WINDOW_MS = 60_000;
const IP_ATTEMPT_LIMIT = 5;
const ACCOUNT_LOCK_MS = 15 * 60_000;
const failedAttemptsByIp = new Map<string, number[]>();

function cookieOptions(httpOnly: boolean, maxAge: number) {
  return {
    httpOnly,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}

async function issueSession(
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

  res.cookie(SESSION_COOKIE, sessionToken, cookieOptions(true, SESSION_TTL_MS));
  res.cookie(CSRF_COOKIE, csrfToken, cookieOptions(false, SESSION_TTL_MS));
  return csrfToken;
}

const rateLimitLogin: RequestHandler = (req, res, next): void => {
  const now = Date.now();
  const key = req.ip || "unknown";
  const recent = (failedAttemptsByIp.get(key) ?? []).filter(
    (timestamp) => now - timestamp < IP_WINDOW_MS,
  );
  if (recent.length >= IP_ATTEMPT_LIMIT) {
    res.status(429).json({ error: "محاولات كثيرة. حاول مجددًا بعد دقيقة." });
    return;
  }
  recent.push(now);
  failedAttemptsByIp.set(key, recent);
  if (failedAttemptsByIp.size > 10_000) {
    for (const [ip, attempts] of failedAttemptsByIp) {
      if (attempts.every((timestamp) => now - timestamp >= IP_WINDOW_MS)) {
        failedAttemptsByIp.delete(ip);
      }
    }
  }
  next();
};

router.get("/auth/csrf", (_req, res): void => {
  const token = newOpaqueToken();
  res.cookie(CSRF_COOKIE, token, cookieOptions(false, 30 * 60_000));
  res.json(GetCsrfTokenResponse.parse({ token }));
});

router.post("/auth/register", requireCsrf, async (req, res): Promise<void> => {
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
    })
    .returning();
  const csrfToken = await issueSession(user.id, res);
  await writeAuditEvent({
    userId: user.id,
    action: "user.registered",
    summary: "تم إنشاء حساب مالك جديد",
  });
  res.status(201).json(
    RegisterUserResponse.parse({ user: publicUser(user), csrfToken }),
  );
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
    if (!user) {
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
      const attempts = user.failedLoginAttempts + 1;
      const lockedUntil =
        attempts >= IP_ATTEMPT_LIMIT
          ? new Date(Date.now() + ACCOUNT_LOCK_MS)
          : null;
      await db
        .update(usersTable)
        .set({ failedLoginAttempts: attempts, lockedUntil, updatedAt: new Date() })
        .where(eq(usersTable.id, user.id));
      res.status(401).json({ error: "تعذر تسجيل الدخول. تحقق من البيانات." });
      return;
    }

    await db
      .update(usersTable)
      .set({ failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));
    failedAttemptsByIp.delete(req.ip || "unknown");
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
    await db.delete(sessionsTable).where(eq(sessionsTable.id, req.auth!.sessionId));
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
    .where(and(eq(usersTable.id, req.auth!.userId), eq(usersTable.isDeleted, false)))
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "يجب تسجيل الدخول للمتابعة." });
    return;
  }
  res.json(GetCurrentUserResponse.parse(user));
});

export default router;