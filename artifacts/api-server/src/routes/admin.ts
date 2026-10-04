import { and, count, desc, eq, sql, sum } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { auditLogsTable, db, ordersTable, productsTable, storeSettingsTable, storesTable, telegramBotsTable, usersTable } from "@workspace/db";
import { requireAuth, requireCsrf, requireSuperAdmin } from "../lib/auth-middleware";
import { isPlanCode, PLAN_CATALOG, readPlanCode } from "../lib/plans";
import { writeAuditEvent } from "../lib/audit";
import { getRecentSystemErrors } from "../lib/system-health";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/admin/health", requireAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  let database: "healthy" | "unavailable" = "healthy";
  try {
    await db.execute(sql`select 1`);
  } catch (error) {
    database = "unavailable";
    logger.error(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      "Super Admin database health check failed.",
    );
  }
  const [connectedBots, errorBots] = await Promise.all([
    db.select({ value: count() }).from(telegramBotsTable).where(eq(telegramBotsTable.status, "connected")),
    db.select({ value: count() }).from(telegramBotsTable).where(eq(telegramBotsTable.status, "error")),
  ]).catch(() => [[], []] as const);
  res.json({
    api: "healthy",
    database,
    telegramBots: {
      connected: Number(connectedBots[0]?.value ?? 0),
      withErrors: Number(errorBots[0]?.value ?? 0),
    },
    recentErrors: getRecentSystemErrors(),
    checkedAt: new Date().toISOString(),
  });
});

router.get("/admin/overview", requireAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  const [userCount, storeCount, orderCount, productCount, activeStoreCount, botCount, paidRevenue, users, stores, events] = await Promise.all([
    db.select({ value: count() }).from(usersTable).where(eq(usersTable.isDeleted, false)),
    db.select({ value: count() }).from(storesTable).where(eq(storesTable.isDeleted, false)),
    db.select({ value: count() }).from(ordersTable),
    db.select({ value: count() }).from(productsTable).where(eq(productsTable.isDeleted, false)),
    db.select({ value: count() }).from(telegramBotsTable).where(eq(telegramBotsTable.status, "connected")),
    db.select({ value: count() }).from(storesTable).where(and(eq(storesTable.isDeleted, false), eq(storesTable.botStatus, "connected"))),
    db.select({ currency: ordersTable.currency, value: sum(ordersTable.total) }).from(ordersTable).where(eq(ordersTable.paymentStatus, "paid")).groupBy(ordersTable.currency),
    db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt })
      .from(usersTable).where(eq(usersTable.isDeleted, false)).orderBy(desc(usersTable.createdAt)).limit(50),
    db.select({ id: storesTable.id, name: storesTable.name, slug: storesTable.slug, currency: storesTable.currency, botStatus: storesTable.botStatus, createdAt: storesTable.createdAt, updatedAt: storesTable.updatedAt, ownerName: usersTable.name, ownerEmail: usersTable.email, settings: storeSettingsTable.settings })
      .from(storesTable).innerJoin(usersTable, eq(storesTable.ownerId, usersTable.id)).leftJoin(storeSettingsTable, eq(storeSettingsTable.storeId, storesTable.id))
      .where(eq(storesTable.isDeleted, false)).orderBy(desc(storesTable.createdAt)).limit(50),
    db.select({ id: auditLogsTable.id, action: auditLogsTable.action, summary: auditLogsTable.summary, createdAt: auditLogsTable.createdAt })
      .from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).limit(10),
  ]);

  res.json({
    stats: { users: Number(userCount[0]?.value ?? 0), stores: Number(storeCount[0]?.value ?? 0), activeStores: Number(activeStoreCount[0]?.value ?? 0), connectedBots: Number(botCount[0]?.value ?? 0), orders: Number(orderCount[0]?.value ?? 0), products: Number(productCount[0]?.value ?? 0) },
    recordedRevenueByCurrency: paidRevenue.map((row) => ({ currency: row.currency, amount: Number(row.value ?? 0) })),
    users,
    stores: stores.map(({ settings, ...store }) => ({ ...store, plan: readPlanCode(settings) })),
    events,
  });
});

router.patch(
  "/admin/stores/:storeId/plan",
  requireAuth,
  requireSuperAdmin,
  requireCsrf,
  async (req, res): Promise<void> => {
    const storeId = req.params.storeId;
    const planCode = req.body?.plan;
    if (typeof storeId !== "string" || !storeId || !isPlanCode(planCode)) {
      res.status(400).json({ error: "اختر باقة صالحة للمتجر." });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [store] = await tx
        .select({ id: storesTable.id, name: storesTable.name })
        .from(storesTable)
        .where(and(eq(storesTable.id, storeId), eq(storesTable.isDeleted, false)))
        .for("update")
        .limit(1);
      if (!store) return null;

      const [currentSettings] = await tx
        .select({ settings: storeSettingsTable.settings })
        .from(storeSettingsTable)
        .where(eq(storeSettingsTable.storeId, store.id))
        .limit(1);
      const previousPlan = readPlanCode(currentSettings?.settings);
      const previousSettings = currentSettings?.settings ?? {};
      await tx
        .insert(storeSettingsTable)
        .values({
          storeId: store.id,
          settings: {
            ...previousSettings,
            plan: { code: planCode, source: "manual_admin", assignedAt: new Date().toISOString() },
          },
        })
        .onConflictDoUpdate({
          target: storeSettingsTable.storeId,
          set: {
            settings: {
              ...previousSettings,
              plan: { code: planCode, source: "manual_admin", assignedAt: new Date().toISOString() },
            },
            updatedAt: new Date(),
          },
        });
      return { store, previousPlan };
    });
    if (!result) {
      res.status(404).json({ error: "لم يتم العثور على المتجر." });
      return;
    }
    const { store, previousPlan } = result;
    await writeAuditEvent({
      userId: req.auth!.userId,
      storeId: store.id,
      action: "admin.store_plan.updated",
      summary: `تم تعيين باقة ${PLAN_CATALOG[planCode].name} للمتجر ${store.name}`,
      details: { previousPlan, plan: planCode },
    });
    res.json({ storeId: store.id, plan: planCode, planName: PLAN_CATALOG[planCode].name });
  },
);

export default router;
