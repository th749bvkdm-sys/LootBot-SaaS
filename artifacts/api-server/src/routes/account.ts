import { Router } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, teacherProfilesTable, usersTable } from "@workspace/db";
import { requireAuth, requireCsrf } from "../lib/auth-middleware";
export const accountRouter = Router();
accountRouter.use("/account", requireAuth);
accountRouter.get("/account/workspace", async (req, res) => {
  const [profile] = await db
    .select({ complete: teacherProfilesTable.complete })
    .from(teacherProfilesTable)
    .where(eq(teacherProfilesTable.ownerId, req.auth!.userId))
    .limit(1);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    accountType: req.auth!.accountType,
    role: req.auth!.role,
    profileComplete: profile?.complete ?? false,
  });
});
accountRouter.post("/account/type", requireCsrf, async (req, res) => {
  const accountType = req.body?.accountType;
  if (accountType !== "merchant" && accountType !== "teacher") {
    res.status(400).json({ error: "اختر نوع الحساب." });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ accountType, updatedAt: new Date() })
    .where(
      and(eq(usersTable.id, req.auth!.userId), isNull(usersTable.accountType)),
    )
    .returning({ accountType: usersTable.accountType });
  if (!updated && req.auth!.accountType !== accountType) {
    res
      .status(409)
      .json({
        error:
          "نوع الحساب محفوظ. تبديل الأدوار غير متاح حاليًا لحماية بياناتك.",
      });
    return;
  }
  res.json({ accountType, role: req.auth!.role, profileComplete: false });
});
