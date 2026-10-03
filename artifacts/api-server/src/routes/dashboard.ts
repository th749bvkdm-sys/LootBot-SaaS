import { and, count, desc, eq, sum } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetDashboardActivityQueryParams,
  GetDashboardActivityResponse,
  GetDashboardSummaryQueryParams,
  GetDashboardSummaryResponse,
} from "@workspace/api-zod";
import {
  auditLogsTable,
  categoriesTable,
  db,
  ordersTable,
  productsTable,
  storesTable,
} from "@workspace/db";
import { requireAuth, getOwnedStore } from "../lib/auth-middleware";

const router: IRouter = Router();

router.get(
  "/dashboard/summary",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = GetDashboardSummaryQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "معرّف المتجر غير صالح." });
      return;
    }
    const store = await getOwnedStore(parsed.data.storeId, req.auth!.userId);
    if (!store) {
      res.status(404).json({ error: "لم يتم العثور على المتجر." });
      return;
    }

    const [products, categories, published, orders, revenue] = await Promise.all([
      db
        .select({ value: count() })
        .from(productsTable)
        .where(
          and(
            eq(productsTable.storeId, store.id),
            eq(productsTable.isDeleted, false),
          ),
        ),
      db
        .select({ value: count() })
        .from(categoriesTable)
        .where(
          and(
            eq(categoriesTable.storeId, store.id),
            eq(categoriesTable.isDeleted, false),
          ),
        ),
      db
        .select({ value: count() })
        .from(productsTable)
        .where(
          and(
            eq(productsTable.storeId, store.id),
            eq(productsTable.isDeleted, false),
            eq(productsTable.isPublished, true),
          ),
        ),
      db
        .select({ value: count() })
        .from(ordersTable)
        .where(eq(ordersTable.storeId, store.id)),
      db
        .select({ value: sum(ordersTable.total) })
        .from(ordersTable)
        .where(
          and(
            eq(ordersTable.storeId, store.id),
            eq(ordersTable.paymentStatus, "paid"),
          ),
        ),
    ]);

    const [record] = await db
      .select({ botStatus: storesTable.botStatus })
      .from(storesTable)
      .where(
        and(
          eq(storesTable.id, store.id),
          eq(storesTable.ownerId, req.auth!.userId),
          eq(storesTable.isDeleted, false),
        ),
      )
      .limit(1);
    res.json(
      GetDashboardSummaryResponse.parse({
        storeId: store.id,
        productCount: Number(products[0]?.value ?? 0),
        categoryCount: Number(categories[0]?.value ?? 0),
        publishedProductCount: Number(published[0]?.value ?? 0),
        orderCount: Number(orders[0]?.value ?? 0),
        revenue: Number(revenue[0]?.value ?? 0),
        botStatus: record?.botStatus ?? "disconnected",
      }),
    );
  },
);

router.get(
  "/dashboard/activity",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = GetDashboardActivityQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "معرّف المتجر غير صالح." });
      return;
    }
    const store = await getOwnedStore(parsed.data.storeId, req.auth!.userId);
    if (!store) {
      res.status(404).json({ error: "لم يتم العثور على المتجر." });
      return;
    }
    const rows = await db
      .select({
        id: auditLogsTable.id,
        action: auditLogsTable.action,
        summary: auditLogsTable.summary,
        createdAt: auditLogsTable.createdAt,
      })
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.storeId, store.id),
          eq(auditLogsTable.userId, req.auth!.userId),
        ),
      )
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(parsed.data.limit ?? 10);
    res.json(GetDashboardActivityResponse.parse(rows));
  },
);

export default router;