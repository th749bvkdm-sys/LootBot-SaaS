import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, ordersTable } from "@workspace/db";
import { requireAuth, getOwnedStore } from "../lib/auth-middleware";
import { isFeatureAvailable } from "../lib/plans";
import { getPlanCatalog, getStorePlan } from "../lib/store-plans";

const router: IRouter = Router();
function csvCell(value: string | number): string {
  const safe = String(value).replace(/[\r\n]+/g, " ");
  const guarded = /^[=+\-@\t]/.test(safe) ? `'${safe}` : safe;
  return `"${guarded.replace(/"/g, '""')}"`;
}

router.get("/stores/:storeId/reports/orders.csv", requireAuth, async (req, res): Promise<void> => {
  const storeId = req.params.storeId;
  if (typeof storeId !== "string" || !storeId) { res.status(400).json({ error: "معرّف المتجر غير صالح." }); return; }
  const store = await getOwnedStore(storeId, req.auth!.userId);
  if (!store) { res.status(404).json({ error: "لم يتم العثور على المتجر." }); return; }
  const plan = await getStorePlan(store.id);
  const catalog = await getPlanCatalog();
  if (!isFeatureAvailable(plan, "analytics.reports", catalog)) {
    res.status(403).json({ code: "PLAN_FEATURE_UNAVAILABLE", feature: "analytics.reports", requiredPlan: "BUSINESS", error: "تقرير الطلبات بصيغة CSV متاح في باقة Business." });
    return;
  }
  const dateFrom = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const dateTo = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
  if ((dateFrom && Number.isNaN(dateFrom.getTime())) || (dateTo && Number.isNaN(dateTo.getTime())) || (dateFrom && dateTo && dateFrom > dateTo)) {
    res.status(400).json({ error: "نطاق التاريخ غير صالح." });
    return;
  }
  const conditions = [eq(ordersTable.storeId, store.id)];
  if (dateFrom) conditions.push(gte(ordersTable.createdAt, dateFrom));
  if (dateTo) conditions.push(lte(ordersTable.createdAt, dateTo));
  const orders = await db.select({ id: ordersTable.id, status: ordersTable.status, paymentStatus: ordersTable.paymentStatus, currency: ordersTable.currency, total: ordersTable.total, createdAt: ordersTable.createdAt })
    .from(ordersTable).where(and(...conditions)).orderBy(desc(ordersTable.createdAt)).limit(5000);
  const header = ["order_id", "status", "payment_status", "currency", "total", "created_at"];
  const lines = [header, ...orders.map((order) => [order.id, order.status, order.paymentStatus, order.currency, order.total, order.createdAt.toISOString()])]
    .map((row) => row.map(csvCell).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="lootbot-orders-${store.id}.csv"`);
  res.send(`\uFEFF${lines.join("\r\n")}`);
});

export default router;
