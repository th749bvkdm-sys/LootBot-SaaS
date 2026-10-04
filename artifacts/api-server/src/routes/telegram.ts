import { and, eq, ne } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ConnectStoreBotBody,
  ConnectStoreBotParams,
  ConnectStoreBotResponse,
  DisconnectStoreBotParams,
  DisconnectStoreBotResponse,
  GetStoreBotParams,
  GetStoreBotResponse,
} from "@workspace/api-zod";
import { db, storeSettingsTable, storesTable, telegramBotsTable } from "@workspace/db";
import { requireAuth, requireCsrf, getOwnedStore } from "../lib/auth-middleware";
import { writeAuditEvent } from "../lib/audit";
import {
  startBotForStore,
  stopBotForStore,
  TelegramFailure,
  validateTelegramBotToken,
} from "../lib/telegram-bot-manager";
import { encryptBotToken, sha256 } from "../lib/security";
import { getPlanCatalog, getStorePlan } from "../lib/store-plans";
import { isFeatureAvailable } from "../lib/plans";
import { DEFAULT_TELEGRAM_DESIGNER, parseTelegramDesignerSettings } from "../lib/telegram-designer";

const router: IRouter = Router();

router.get("/stores/:storeId/telegram/designer", requireAuth, async (req, res): Promise<void> => {
  const storeId = req.params.storeId;
  if (typeof storeId !== "string" || !storeId) { res.status(400).json({ error: "معرّف المتجر غير صالح." }); return; }
  const store = await getOwnedStore(storeId, req.auth!.userId);
  if (!store) { res.status(404).json({ error: "لم يتم العثور على المتجر." }); return; }
  const [row] = await db.select({ settings: storeSettingsTable.settings }).from(storeSettingsTable).where(eq(storeSettingsTable.storeId, store.id)).limit(1);
  const raw = row?.settings?.telegramDesigner;
  const settings = parseTelegramDesignerSettings(raw) ?? DEFAULT_TELEGRAM_DESIGNER;
  const plan = await getStorePlan(store.id);
  const catalog = await getPlanCatalog();
  res.json({ settings, enabled: isFeatureAvailable(plan, "telegram.advanced", catalog), requiredPlan: "PRO" });
});

router.patch("/stores/:storeId/telegram/designer", requireAuth, requireCsrf, async (req, res): Promise<void> => {
  const storeId = req.params.storeId;
  if (typeof storeId !== "string" || !storeId) { res.status(400).json({ error: "معرّف المتجر غير صالح." }); return; }
  const store = await getOwnedStore(storeId, req.auth!.userId);
  if (!store) { res.status(404).json({ error: "لم يتم العثور على المتجر." }); return; }
  const settings = parseTelegramDesignerSettings(req.body);
  if (!settings) { res.status(400).json({ error: "تحقق من الرسائل. الحد الأقصى 400 حرف لكل رسالة." }); return; }
  const plan = await getStorePlan(store.id);
  const catalog = await getPlanCatalog();
  if (!isFeatureAvailable(plan, "telegram.advanced", catalog)) {
    res.status(403).json({ code: "PLAN_FEATURE_UNAVAILABLE", feature: "telegram.advanced", requiredPlan: "PRO", error: "تخصيص رسائل البوت متاح في باقة Pro أو Business." });
    return;
  }
  const [current] = await db.select({ settings: storeSettingsTable.settings }).from(storeSettingsTable).where(eq(storeSettingsTable.storeId, store.id)).limit(1);
  const previousSettings = current?.settings ?? {};
  await db.insert(storeSettingsTable).values({ storeId: store.id, settings: { ...previousSettings, telegramDesigner: settings } }).onConflictDoUpdate({ target: storeSettingsTable.storeId, set: { settings: { ...previousSettings, telegramDesigner: settings }, updatedAt: new Date() } });
  await writeAuditEvent({ userId: req.auth!.userId, storeId: store.id, action: "telegram.designer.updated", summary: "تم تحديث رسائل بوت Telegram" });
  res.json({ settings });
});

router.get(
  "/stores/:storeId/bot",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = GetStoreBotParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "معرّف المتجر غير صالح." });
      return;
    }
    const store = await getOwnedStore(params.data.storeId, req.auth!.userId);
    if (!store) {
      res.status(404).json({ error: "لم يتم العثور على المتجر." });
      return;
    }
    const [bot] = await db
      .select({
        username: telegramBotsTable.username,
        firstName: telegramBotsTable.firstName,
        status: telegramBotsTable.status,
        lastError: telegramBotsTable.lastError,
      })
      .from(telegramBotsTable)
      .where(eq(telegramBotsTable.storeId, store.id))
      .limit(1);
    const connected = bot?.status === "connected";
    res.json(
      GetStoreBotResponse.parse({
        connected,
        username: bot?.username ?? null,
        firstName: bot?.firstName ?? null,
        status: bot?.status ?? "disconnected",
        lastError: bot?.lastError ?? null,
      }),
    );
  },
);

router.post(
  "/stores/:storeId/bot",
  requireAuth,
  requireCsrf,
  async (req, res): Promise<void> => {
    const params = ConnectStoreBotParams.safeParse(req.params);
    const parsed = ConnectStoreBotBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "تحقق من رمز البوت." });
      return;
    }
    const store = await getOwnedStore(params.data.storeId, req.auth!.userId);
    if (!store) {
      res.status(404).json({ error: "لم يتم العثور على المتجر." });
      return;
    }

    try {
      const { bot, webhookUrl } = await validateTelegramBotToken(parsed.data.token);
      if (webhookUrl) {
        res.status(409).json({
          error: "للبوت Webhook مفعّل. عطّله في Telegram قبل استخدام وضع Polling.",
        });
        return;
      }

      const tokenHash = sha256(parsed.data.token);
      const [alreadyConnected] = await db
        .select({ storeId: telegramBotsTable.storeId })
        .from(telegramBotsTable)
        .where(
          and(
            eq(telegramBotsTable.tokenHash, tokenHash),
            ne(telegramBotsTable.storeId, store.id),
          ),
        )
        .limit(1);
      if (alreadyConnected) {
        res.status(409).json({ error: "هذا البوت مرتبط بمتجر آخر." });
        return;
      }

      const [saved] = await db
        .insert(telegramBotsTable)
        .values({
          storeId: store.id,
          encryptedToken: encryptBotToken(parsed.data.token),
          tokenHash,
          telegramBotId: String(bot.id),
          username: bot.username ?? null,
          firstName: bot.first_name,
          status: "connected",
          lastError: null,
        })
        .onConflictDoUpdate({
          target: telegramBotsTable.storeId,
          set: {
            encryptedToken: encryptBotToken(parsed.data.token),
            tokenHash,
            telegramBotId: String(bot.id),
            username: bot.username ?? null,
            firstName: bot.first_name,
            status: "connected",
            lastError: null,
            lastUpdateId: null,
            updatedAt: new Date(),
          },
        })
        .returning({
          username: telegramBotsTable.username,
          firstName: telegramBotsTable.firstName,
          status: telegramBotsTable.status,
          lastError: telegramBotsTable.lastError,
          lastUpdateId: telegramBotsTable.lastUpdateId,
        });
      await db
        .update(storesTable)
        .set({ botStatus: "connected", updatedAt: new Date() })
        .where(eq(storesTable.id, store.id));
      startBotForStore({
        storeId: store.id,
        token: parsed.data.token,
        lastUpdateId: saved.lastUpdateId,
      });
      await writeAuditEvent({
        userId: req.auth!.userId,
        storeId: store.id,
        action: "telegram.connected",
        summary: "تم ربط بوت Telegram",
        details: { username: saved.username },
      });

      res.json(
        ConnectStoreBotResponse.parse({
          connected: true,
          username: saved.username,
          firstName: saved.firstName,
          status: saved.status,
          lastError: saved.lastError,
        }),
      );
    } catch (error) {
      if (error instanceof TelegramFailure) {
        const status = error.conflict ? 409 : 502;
        res.status(status).json({
          error: error.conflict
            ? "تعذر تشغيل البوت. تحقق من اتصال Telegram."
            : "تعذر الاتصال بالبوت.",
        });
        return;
      }
      const pgError = error as { code?: string };
      if (pgError.code === "23505") {
        res.status(409).json({ error: "هذا البوت مرتبط بمتجر آخر." });
        return;
      }
      throw error;
    }
  },
);

router.delete(
  "/stores/:storeId/bot",
  requireAuth,
  requireCsrf,
  async (req, res): Promise<void> => {
    const params = DisconnectStoreBotParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "معرّف المتجر غير صالح." });
      return;
    }
    const store = await getOwnedStore(params.data.storeId, req.auth!.userId);
    if (!store) {
      res.status(404).json({ error: "لم يتم العثور على المتجر." });
      return;
    }
    stopBotForStore(store.id);
    await db
      .delete(telegramBotsTable)
      .where(eq(telegramBotsTable.storeId, store.id));
    await db
      .update(storesTable)
      .set({ botStatus: "disconnected", updatedAt: new Date() })
      .where(eq(storesTable.id, store.id));
    await writeAuditEvent({
      userId: req.auth!.userId,
      storeId: store.id,
      action: "telegram.disconnected",
      summary: "تم فصل بوت Telegram",
    });
    res.json(DisconnectStoreBotResponse.parse({ success: true }));
  },
);

export default router;
