import { getStoreAccess } from './staff-access';
import type { StaffPermission } from './staff-policy';
import { and, eq, gt } from "drizzle-orm";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db, sessionsTable, storesTable, usersTable } from "@workspace/db";
import { CSRF_COOKIE, SESSION_COOKIE, safeStringEqual, sha256 } from "./security";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: string;
        accountType: string | null;
        sessionId: string;
        csrfHash: string;
      };
    }
  }
}

export const requireAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const rawToken = req.cookies?.[SESSION_COOKIE];
    if (typeof rawToken !== "string" || rawToken.length < 32) {
      res.status(401).json({ error: "يجب تسجيل الدخول للمتابعة." });
      return;
    }

    const [row] = await db
      .select({
        sessionId: sessionsTable.id,
        csrfHash: sessionsTable.csrfHash,
        userId: usersTable.id,
        role: usersTable.role,
        accountType: usersTable.accountType,
      })
      .from(sessionsTable)
      .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
      .where(
        and(
          eq(sessionsTable.tokenHash, sha256(rawToken)),
          gt(sessionsTable.expiresAt, new Date()),
          eq(usersTable.isDeleted, false),
        ),
      )
      .limit(1);

    if (!row) {
      res.clearCookie(SESSION_COOKIE, { path: "/" });
      res.status(401).json({ error: "يجب تسجيل الدخول للمتابعة." });
      return;
    }

    req.auth = {
      userId: row.userId,
      role: row.role,
      accountType: row.accountType,
      sessionId: row.sessionId,
      csrfHash: row.csrfHash,
    };
    const apiPath = req.originalUrl.split('?')[0].replace(/^\/api/, '');
    if (row.role !== 'SUPERADMIN' && row.accountType !== 'merchant' &&
        !/^\/(auth|account|teacher|admin)(\/|$)/.test(apiPath)) {
      res.status(403).json({ error: 'هذه الأدوات متاحة لحساب التاجر فقط.' });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const requireTeacher: RequestHandler = (req, res, next): void => {
  if (!req.auth) { res.status(401).json({ error: 'يجب تسجيل الدخول للمتابعة.' }); return; }
  if (req.auth.accountType !== 'teacher' && req.auth.role !== 'SUPERADMIN') {
    res.status(403).json({ error: 'هذه الأدوات متاحة لحساب المعلم فقط.' }); return;
  }
  next();
};

export const requireSuperAdmin: RequestHandler = (req, res, next): void => {
  if (!req.auth) {
    res.status(401).json({ error: "يجب تسجيل الدخول للمتابعة." });
    return;
  }
  if (req.auth.role !== "SUPERADMIN") {
    res.status(403).json({ error: "لا تملك صلاحية الوصول إلى هذه الصفحة." });
    return;
  }
  next();
};

export const requireCsrf: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get("x-csrf-token");
  const matchesCookie =
    typeof cookieToken === "string" &&
    typeof headerToken === "string" &&
    safeStringEqual(cookieToken, headerToken);
  const matchesSession =
    !req.auth ||
    (typeof cookieToken === "string" &&
      safeStringEqual(sha256(cookieToken), req.auth.csrfHash));

  if (!matchesCookie || !matchesSession) {
    res.status(403).json({ error: "تعذر التحقق من الطلب. حدّث الصفحة وحاول مجددًا." });
    return;
  }
  next();
};

export async function getOwnedStore(
  storeId: string,
  ownerId: string,
  permission: StaffPermission | 'owner' = 'owner',
): Promise<{ id: string; name: string; currency: string } | undefined> {
  const access = await getStoreAccess(storeId, ownerId, permission);
  if (!access) return undefined;
  const [store] = await db
    .select({
      id: storesTable.id,
      name: storesTable.name,
      currency: storesTable.currency,
    })
    .from(storesTable)
    .where(
      and(
        eq(storesTable.id, storeId),
        eq(storesTable.isDeleted, false),
      ),
    )
    .limit(1);
  return store;
}

export function publicUser(user: {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}
