import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateStoreBody,
  CreateStoreResponse,
  DeleteStoreParams,
  DeleteStoreResponse,
  GetStoreParams,
  GetStoreResponse,
  ListStoresResponse,
  UpdateStoreBody,
  UpdateStoreParams,
  UpdateStoreResponse,
} from "@workspace/api-zod";
import { db, storeSettingsTable, storesTable } from "@workspace/db";
import { requireAuth, requireCsrf, getOwnedStore } from "../lib/auth-middleware";
import { writeAuditEvent } from "../lib/audit";
import { createId } from "../lib/security";
import { stopBotForStore } from "../lib/telegram-bot-manager";

const router: IRouter = Router();
function isSupportedCurrency(value: string): boolean {
  if (!/^[a-zA-Z]{3}$/.test(value)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function makeSlug(name: string): string {
  const base =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 42) || "store";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

router.get("/stores", requireAuth, async (req, res): Promise<void> => {
  const stores = await db
    .select()
    .from(storesTable)
    .where(
      and(
        eq(storesTable.ownerId, req.auth!.userId),
        eq(storesTable.isDeleted, false),
      ),
    )
    .orderBy(storesTable.createdAt);
  res.json(ListStoresResponse.parse(stores));
});

router.post(
  "/stores",
  requireAuth,
  requireCsrf,
  async (req, res): Promise<void> => {
    const parsed = CreateStoreBody.safeParse(req.body);
    if (
      !parsed.success ||
      !parsed.data.name.trim() ||
      !isSupportedCurrency(parsed.data.currency)
    ) {
      res.status(400).json({ error: "تحقق من اسم المتجر والعملة." });
      return;
    }

    const id = createId();
    const store = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(storesTable)
        .values({
          id,
          ownerId: req.auth!.userId,
          name: parsed.data.name.trim(),
          slug: makeSlug(parsed.data.name),
          currency: parsed.data.currency.toUpperCase(),
        })
        .returning();
      await tx.insert(storeSettingsTable).values({ storeId: id });
      return created;
    });

    await writeAuditEvent({
      userId: req.auth!.userId,
      storeId: id,
      action: "store.created",
      summary: `تم إنشاء المتجر ${store.name}`,
    });
    res.status(201).json(CreateStoreResponse.parse(store));
  },
);

router.get(
  "/stores/:storeId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = GetStoreParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "معرّف المتجر غير صالح." });
      return;
    }
    const [store] = await db
      .select()
      .from(storesTable)
      .where(
        and(
          eq(storesTable.id, params.data.storeId),
          eq(storesTable.ownerId, req.auth!.userId),
          eq(storesTable.isDeleted, false),
        ),
      )
      .limit(1);
    if (!store) {
      res.status(404).json({ error: "لم يتم العثور على المتجر." });
      return;
    }
    res.json(GetStoreResponse.parse(store));
  },
);

router.patch(
  "/stores/:storeId",
  requireAuth,
  requireCsrf,
  async (req, res): Promise<void> => {
    const params = UpdateStoreParams.safeParse(req.params);
    const parsed = UpdateStoreBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "تحقق من بيانات المتجر." });
      return;
    }
    if (parsed.data.currency && !isSupportedCurrency(parsed.data.currency)) {
      res.status(400).json({ error: "العملة المختارة غير مدعومة حاليًا." });
      return;
    }
    if (parsed.data.name !== undefined && !parsed.data.name.trim()) {
      res.status(400).json({ error: "يجب كتابة اسم للمتجر." });
      return;
    }

    const current = await getOwnedStore(params.data.storeId, req.auth!.userId);
    if (!current) {
      res.status(404).json({ error: "لم يتم العثور على المتجر." });
      return;
    }
    const updates: Partial<typeof storesTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();
    if (parsed.data.currency !== undefined) {
      updates.currency = parsed.data.currency.toUpperCase();
    }

    const [store] = await db
      .update(storesTable)
      .set(updates)
      .where(
        and(
          eq(storesTable.id, params.data.storeId),
          eq(storesTable.ownerId, req.auth!.userId),
          eq(storesTable.isDeleted, false),
        ),
      )
      .returning();
    if (!store) {
      res.status(404).json({ error: "لم يتم العثور على المتجر." });
      return;
    }
    await writeAuditEvent({
      userId: req.auth!.userId,
      storeId: store.id,
      action: "store.updated",
      summary: `تم تحديث المتجر ${store.name}`,
    });
    res.json(UpdateStoreResponse.parse(store));
  },
);

router.delete(
  "/stores/:storeId",
  requireAuth,
  requireCsrf,
  async (req, res): Promise<void> => {
    const params = DeleteStoreParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "معرّف المتجر غير صالح." });
      return;
    }
    const [store] = await db
      .update(storesTable)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(
        and(
          eq(storesTable.id, params.data.storeId),
          eq(storesTable.ownerId, req.auth!.userId),
          eq(storesTable.isDeleted, false),
        ),
      )
      .returning();
    if (!store) {
      res.status(404).json({ error: "لم يتم العثور على المتجر." });
      return;
    }
    stopBotForStore(store.id);
    await writeAuditEvent({
      userId: req.auth!.userId,
      storeId: store.id,
      action: "store.archived",
      summary: `تم أرشفة المتجر ${store.name}`,
    });
    res.json(DeleteStoreResponse.parse({ success: true }));
  },
);

export default router;