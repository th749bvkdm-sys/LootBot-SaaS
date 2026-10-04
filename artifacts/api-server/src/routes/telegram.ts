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
import { decryptBotToken, encryptBotToken, sha256 } from "../lib/security";
import { createLoginRateLimiter } from "../lib/login-rate-limit";
import { getPlanCatalog, getStorePlan, featureGate } from "../lib/store-plans";
import { isFeatureAvailable } from "../lib/plans";
import { DEFAULT_TELEGRAM_DESIGNER, parseTelegramDesignerSettings } from "../lib/telegram-designer";
import { parseHomeConfiguration, readHomeStudio, renderConfiguredHome } from "../lib/telegram-home-configuration";
import { businessStudioRouter } from "./telegram-business-studio";

const router: IRouter = Router();
router.use(businessStudioRouter);
const connectionTests = createLoginRateLimiter({ windowMs: 60_000, maxAttempts: 3 });

router.get("/stores/:storeId/telegram/health", requireAuth, async (req, res): Promise<void> => {
  const storeId = req.params.storeId;
  if (typeof storeId !== "string" || !await getOwnedStore(storeId, req.auth!.userId)) { res.status(404).json({ error: "المتجر غير موجود." }); return; }
  const [bot] = await db.select({ status: telegramBotsTable.status, lastError: telegramBotsTable.lastError,
    lastSuccessfulPollAt: telegramBotsTable.lastSuccessfulPollAt, lastConnectionTestAt: telegramBotsTable.lastConnectionTestAt,
    lastConnectionTestError: telegramBotsTable.lastConnectionTestError }).from(telegramBotsTable).where(eq(telegramBotsTable.storeId, storeId)).limit(1);
  res.json(bot ?? { status: "disconnected", lastError: null, lastSuccessfulPollAt: null, lastConnectionTestAt: null, lastConnectionTestError: null });
});

router.post("/stores/:storeId/telegram/test-connection", requireAuth, requireCsrf, async (req, res): Promise<void> => {
  const storeId = req.params.storeId;
  if (typeof storeId !== "string" || !await getOwnedStore(storeId, req.auth!.userId)) { res.status(404).json({ error: "المتجر غير موجود." }); return; }
  await featureGate.require(storeId, "telegram.basic");
  if (connectionTests.isLimited(storeId)) { res.status(429).json({ error: "انتظر دقيقة قبل إعادة اختبار الاتصال." }); return; }
  const [bot] = await db.select().from(telegramBotsTable).where(eq(telegramBotsTable.storeId, storeId)).limit(1);
  if (!bot || bot.status === "disconnected") { res.status(409).json({ error: "اربط البوت أولًا." }); return; }
  let error: string | null = null;
  try {
    const result = await validateTelegramBotToken(decryptBotToken(bot.encryptedToken));
    if (result.webhookUrl) error = "يوجد Webhook مفعّل يمنع استقبال الرسائل في وضع Polling.";
  } catch { error = "تعذر الاتصال بـ Telegram. تحقق من رمز البوت وأعد المحاولة."; }
  const testedAt = new Date();
  const saved = await db.update(telegramBotsTable).set({ lastConnectionTestAt: testedAt, lastConnectionTestError: error })
    .where(and(eq(telegramBotsTable.storeId, storeId), eq(telegramBotsTable.tokenHash, bot.tokenHash))).returning({ storeId: telegramBotsTable.storeId });
  if (!saved.length) { res.status(409).json({ error: "تغيّر اتصال البوت أثناء الاختبار. أعد المحاولة." }); return; }
  await writeAuditEvent({ userId: req.auth!.userId, storeId, action: "telegram.connection.test", summary: error ? "فشل اختبار اتصال Telegram" : "نجح اختبار اتصال Telegram" });
  res.json({ ok: error === null, testedAt, error });
});

router.get("/stores/:storeId/telegram/studio", requireAuth, async (req, res): Promise<void> => {
  const storeId = req.params.storeId;
  if (typeof storeId !== "string") { res.status(400).json({ error: "معرّف المتجر غير صالح." }); return; }
  const store = await getOwnedStore(storeId, req.auth!.userId);
  if (!store) { res.status(404).json({ error: "المتجر غير موجود." }); return; }
  const [row] = await db.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, storeId)).limit(1);
  const studio = readHomeStudio(row?.settings.telegramHomeStudio);
  res.json({ ...studio, enabled: await featureGate.can(storeId, "telegram.advanced"), preview: renderConfiguredHome(studio.draft, store.name, "اسم العميل") });
});

router.post("/stores/:storeId/telegram/studio/:action", requireAuth, requireCsrf, async (req, res): Promise<void> => {
  const storeId = req.params.storeId; const action = req.params.action;
  if (typeof storeId !== "string" || !["draft", "preview", "publish"].includes(String(action))) { res.status(400).json({ error: "طلب غير صالح." }); return; }
  const store = await getOwnedStore(storeId, req.auth!.userId);
  if (!store) { res.status(404).json({ error: "المتجر غير موجود." }); return; }
  await featureGate.require(storeId, "telegram.advanced");
  const configuration = parseHomeConfiguration(req.body?.configuration);
  if (action !== "publish" && !configuration) { res.status(400).json({ error: "إعدادات الصفحة الرئيسية غير صالحة." }); return; }
  if (action === "preview") { res.json({ preview: renderConfiguredHome(configuration!, store.name, "اسم العميل") }); return; }
  const revision = req.body?.revision;
  if (!Number.isSafeInteger(revision) || revision < 0) { res.status(400).json({ error: "إصدار الإعدادات غير صالح." }); return; }
  const result = await db.transaction(async tx => {
    await tx.select({ id: storesTable.id }).from(storesTable).where(eq(storesTable.id, storeId)).for("update");
    const [row] = await tx.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, storeId)).limit(1);
    const studio = readHomeStudio(row?.settings.telegramHomeStudio);
    if (studio.revision !== revision) return null;
    const next = { draft: action === "draft" ? configuration! : studio.draft, published: action === "publish" ? studio.draft : studio.published, revision: revision + 1 };
    const settings = { ...row?.settings, telegramHomeStudio: next, ...(action === "publish" ? { telegramHomeMode: "pro" } : {}) };
    await tx.insert(storeSettingsTable).values({ storeId, settings }).onConflictDoUpdate({ target: storeSettingsTable.storeId, set: { settings, updatedAt: new Date() } });
    return next;
  });
  if (!result) { res.status(409).json({ error: "تم تعديل التصميم من جلسة أخرى. أعد تحميل الصفحة." }); return; }
  await writeAuditEvent({ userId: req.auth!.userId, storeId, action: `telegram.home.${action}`, summary: action === "publish" ? "تم نشر الصفحة الرئيسية للبوت" : "تم حفظ مسودة الصفحة الرئيسية للبوت", details: { revision: result.revision } });
  res.json({ ...result, enabled: true, preview: renderConfiguredHome(result.draft, store.name, "اسم العميل") });
});

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
  await db.transaction(async tx => {
    await tx.select({ id: storesTable.id }).from(storesTable).where(eq(storesTable.id, store.id)).for("update");
    const [current] = await tx.select({ settings: storeSettingsTable.settings }).from(storeSettingsTable).where(eq(storeSettingsTable.storeId, store.id)).limit(1);
    const next = { ...current?.settings, telegramDesigner: settings };
    await tx.insert(storeSettingsTable).values({ storeId: store.id, settings: next }).onConflictDoUpdate({ target: storeSettingsTable.storeId, set: { settings: next, updatedAt: new Date() } });
  });
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
            lastSuccessfulPollAt: null,
            lastConnectionTestAt: null,
            lastConnectionTestError: null,
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
