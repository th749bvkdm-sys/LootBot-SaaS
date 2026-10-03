import { count, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { auditLogsTable, db, ordersTable, productsTable, storesTable, usersTable } from "@workspace/db";
import { requireAuth, requireSuperAdmin } from "../lib/auth-middleware";

const router: IRouter = Router();

router.get("/admin/overview", requireAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  const [userCount, storeCount, orderCount, productCount, users, stores, events] = await Promise.all([
    db.select({ value: count() }).from(usersTable).where(eq(usersTable.isDeleted, false)),
    db.select({ value: count() }).from(storesTable).where(eq(storesTable.isDeleted, false)),
    db.select({ value: count() }).from(ordersTable),
    db.select({ value: count() }).from(productsTable).where(eq(productsTable.isDeleted, false)),
    db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt })
      .from(usersTable).where(eq(usersTable.isDeleted, false)).orderBy(desc(usersTable.createdAt)).limit(50),
    db.select({ id: storesTable.id, name: storesTable.name, slug: storesTable.slug, currency: storesTable.currency, botStatus: storesTable.botStatus, createdAt: storesTable.createdAt, ownerName: usersTable.name, ownerEmail: usersTable.email })
      .from(storesTable).innerJoin(usersTable, eq(storesTable.ownerId, usersTable.id))
      .where(eq(storesTable.isDeleted, false)).orderBy(desc(storesTable.createdAt)).limit(50),
    db.select({ id: auditLogsTable.id, action: auditLogsTable.action, summary: auditLogsTable.summary, createdAt: auditLogsTable.createdAt })
      .from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).limit(10),
  ]);

  res.json({
    stats: { users: Number(userCount[0]?.value ?? 0), stores: Number(storeCount[0]?.value ?? 0), orders: Number(orderCount[0]?.value ?? 0), products: Number(productCount[0]?.value ?? 0) },
    users,
    stores,
    events,
  });
});

export default router;
