import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ListOrdersQueryParams,
  ListOrdersResponse,
  UpdateOrderStatusBody,
  UpdateOrderStatusParams,
  UpdateOrderStatusResponse,
} from "@workspace/api-zod";
import {
  db,
  orderItemsTable,
  ordersTable,
  productsTable,
  storesTable,
} from "@workspace/db";
import { getOwnedStore, requireAuth, requireCsrf } from "../lib/auth-middleware";
import { writeAuditEvent } from "../lib/audit";
import { notifyTelegramOrderStatus } from "../lib/telegram-bot-manager";

const router: IRouter = Router();
const PAGE_SIZES = new Set([10, 25, 50, 100]);

router.get("/orders", requireAuth, async (req, res): Promise<void> => {
  const parsed = ListOrdersQueryParams.safeParse(req.query);
  if (!parsed.success || !PAGE_SIZES.has(parsed.data.pageSize)) {
    res.status(400).json({ error: "خيارات عرض الطلبات غير صالحة." });
    return;
  }

  const store = await getOwnedStore(parsed.data.storeId, req.auth!.userId);
  if (!store) {
    res.status(404).json({ error: "لم يتم العثور على المتجر." });
    return;
  }

  const filters = [eq(ordersTable.storeId, store.id)];
  if (parsed.data.status) {
    filters.push(eq(ordersTable.status, parsed.data.status));
  }
  const where = and(...filters);
  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: ordersTable.id,
        storeId: ordersTable.storeId,
        customerName: ordersTable.customerName,
        telegramUsername: ordersTable.telegramUsername,
        status: ordersTable.status,
        currency: ordersTable.currency,
        total: ordersTable.total,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .where(where)
      .orderBy(desc(ordersTable.createdAt))
      .limit(parsed.data.pageSize)
      .offset(offset),
    db.select({ value: count() }).from(ordersTable).where(where),
  ]);

  const orderIds = rows.map((row) => row.id);
  const lineRows = orderIds.length
    ? await db
        .select({
          orderId: orderItemsTable.orderId,
          productName: orderItemsTable.productName,
          quantity: orderItemsTable.quantity,
          unitPrice: orderItemsTable.unitPrice,
          lineTotal: orderItemsTable.lineTotal,
        })
        .from(orderItemsTable)
        .where(inArray(orderItemsTable.orderId, orderIds))
    : [];
  const itemsByOrder = new Map<string, typeof lineRows>();
  for (const line of lineRows) {
    const items = itemsByOrder.get(line.orderId) ?? [];
    items.push(line);
    itemsByOrder.set(line.orderId, items);
  }

  res.json(
    ListOrdersResponse.parse({
      items: rows.map((row) => ({
        ...row,
        total: Number(row.total),
        items: (itemsByOrder.get(row.id) ?? []).map(
          ({ orderId: _orderId, ...item }) => ({
            ...item,
            unitPrice: Number(item.unitPrice),
            lineTotal: Number(item.lineTotal),
          }),
        ),
      })),
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total: Number(totalRow?.value ?? 0),
    }),
  );
});

router.patch(
  "/orders/:orderId",
  requireAuth,
  requireCsrf,
  async (req, res): Promise<void> => {
    const params = UpdateOrderStatusParams.safeParse(req.params);
    const parsed = UpdateOrderStatusBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "تحقق من بيانات الطلب." });
      return;
    }

    const [order] = await db
      .select({
        id: ordersTable.id,
        storeId: ordersTable.storeId,
        customerName: ordersTable.customerName,
        telegramUsername: ordersTable.telegramUsername,
        telegramChatId: ordersTable.telegramChatId,
        status: ordersTable.status,
        currency: ordersTable.currency,
        total: ordersTable.total,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .innerJoin(storesTable, eq(storesTable.id, ordersTable.storeId))
      .where(
        and(
          eq(ordersTable.id, params.data.orderId),
          eq(storesTable.ownerId, req.auth!.userId),
          eq(storesTable.isDeleted, false),
        ),
      )
      .limit(1);

    if (!order) {
      res.status(404).json({ error: "لم يتم العثور على الطلب." });
      return;
    }

    const target = parsed.data.status;
    const allowed: Record<string, string[]> = {
      pending: ["confirmed", "cancelled"],
      confirmed: ["fulfilled", "cancelled"],
    };
    if (!allowed[order.status]?.includes(target)) {
      res.status(409).json({ error: "لا يمكن تغيير حالة الطلب من هذه المرحلة." });
      return;
    }

    const lineRows = await db
      .select({
        productId: orderItemsTable.productId,
        quantity: orderItemsTable.quantity,
        productName: orderItemsTable.productName,
        unitPrice: orderItemsTable.unitPrice,
        lineTotal: orderItemsTable.lineTotal,
      })
      .from(orderItemsTable)
      .where(eq(orderItemsTable.orderId, order.id));

    const updated = await db.transaction(async (tx) => {
      const [changed] = await tx
        .update(ordersTable)
        .set({ status: target, updatedAt: new Date() })
        .where(
          and(
            eq(ordersTable.id, order.id),
            eq(ordersTable.storeId, order.storeId),
            eq(ordersTable.status, order.status),
          ),
        )
        .returning();

      if (!changed) return undefined;

      if (target === "cancelled") {
        for (const line of lineRows) {
          if (!line.productId) continue;
          await tx
            .update(productsTable)
            .set({
              stock: sql`${productsTable.stock} + ${line.quantity}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(productsTable.id, line.productId),
                eq(productsTable.storeId, order.storeId),
              ),
            );
        }
      }
      return changed;
    });

    if (!updated) {
      res.status(409).json({ error: "تم تحديث الطلب من جلسة أخرى. أعد تحميل القائمة." });
      return;
    }

    await writeAuditEvent({
      userId: req.auth!.userId,
      storeId: order.storeId,
      action: `order.${target}`,
      summary: `تم تحديث حالة الطلب ${order.id.slice(0, 8)}`,
      details: { orderId: order.id, status: target },
    });

    void notifyTelegramOrderStatus({
      storeId: order.storeId,
      chatId: order.telegramChatId,
      orderId: order.id,
      status: target,
    });

    res.json(
      UpdateOrderStatusResponse.parse({
        id: updated.id,
        storeId: updated.storeId,
        customerName: updated.customerName,
        telegramUsername: order.telegramUsername,
        status: updated.status,
        currency: updated.currency,
        total: Number(updated.total),
        createdAt: updated.createdAt,
        items: lineRows.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          lineTotal: Number(item.lineTotal),
        })),
      }),
    );
  },
);

export default router;