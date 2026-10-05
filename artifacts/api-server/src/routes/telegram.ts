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
  assertBotTokenAvailable,
  botLifecycleVersion,
  assertBotLifecycleCurrent,
} from "../lib/telegram-bot-manager";
import { decryptBotToken, encryptBotToken, sha256 } from "../lib/security";
import { createLoginRateLimiter } from "../lib/login-rate-limit";
import { getPlanCatalog, getStorePlan, featureGate } from "../lib/store-plans";
import { isFeatureAvailable } from "../lib/plans";
import { DEFAULT_TELEGRAM_DESIGNER, parseTelegramDesignerSettings } from "../lib/telegram-designer";
import { parseHomeConfiguration, readHomeStudio, renderConfiguredHome } from "../lib/telegram-home-configuration";
import { businessStudioRouter } from "./telegram-business-studio";
import { previewStoreScreen } from '../lib/telegram-preview';
import { canPreviewCustomer } from '../lib/studio-access';
import { renderStoreHome } from '../lib/telegram-home-data';
import { parseStudioPreviewInput } from '../lib/studio-preview-input';
import { studioOptionsRouter } from './telegram-studio-options';
import { withBotConnectionChange } from '../lib/bot-connection-lock';

const router: IRouter = Router();
router.use(studioOptionsRouter);
router.use(businessStudioRouter);
const connectionTests = createLoginRateLimiter({ windowMs: 60_000, maxAttempts: 3 });
const reconnectAttempts = createLoginRateLimiter({ windowMs: 60_000, maxAttempts: 3 });

router.post('/stores/:storeId/telegram/reconnect', requireAuth, requireCsrf, async (req, res): Promise<void> => {
  const params = ConnectStoreBotParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: 'معرّف المتجر غير صالح.' }); return; }
  const storeId = params.data.storeId;
  const version=botLifecycleVersion();
  if (!await getOwnedStore(storeId, req.auth!.userId)) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  await featureGate.require(storeId, 'telegram.basic');
  if (reconnectAttempts.isLimited(storeId)) { res.status(429).json({ error: 'انتظر دقيقة قبل إعادة محاولة استئناف الاتصال.' }); return; }
  await withBotConnectionChange(storeId, async () => {
    try { assertBotLifecycleCurrent(version); }
    catch { res.status(409).json({error:'تغيّر استقبال البوت أثناء الطلب. حدّث الصفحة وأعد المحاولة.'});return; }
    const [snapshot] = await db.select().from(telegramBotsTable).where(eq(telegramBotsTable.storeId, storeId)).limit(1);
    if (!snapshot || snapshot.status === 'disconnected' || !snapshot.encryptedToken) { res.status(409).json({ error: 'لا يوجد اتصال محفوظ يمكن استئنافه. اربط البوت أولًا.' }); return; }
    let token: string;
    try { token = decryptBotToken(snapshot.encryptedToken); }
    catch { res.status(409).json({ error: 'تعذر استخدام رمز الاتصال المحفوظ. أعد ربط البوت برمزه الحالي.' }); return; }
    if (sha256(token) !== snapshot.tokenHash) { res.status(409).json({ error: 'تغيّر رمز الاتصال المحفوظ. أعد ربط البوت.' }); return; }
    try {
      const { bot, webhookUrl } = await validateTelegramBotToken(token);
      assertBotLifecycleCurrent(version);
      if (webhookUrl) { res.status(409).json({ error: 'يوجد Webhook مفعّل. عطّله قبل استئناف استقبال البوت هنا.' }); return; }
      if (!bot.is_bot || String(bot.id) !== snapshot.telegramBotId) { res.status(409).json({ error: 'هوية البوت المحفوظ لا تطابق الاتصال. أعد ربط البوت.' }); return; }
      assertBotTokenAvailable(storeId,token);
      const saved = await db.transaction(async tx => {
        const [currentStore] = await tx.select({id:storesTable.id}).from(storesTable).where(and(eq(storesTable.id,storeId),eq(storesTable.ownerId,req.auth!.userId),eq(storesTable.isDeleted,false))).for('update');
        if (!currentStore) return null;
        await featureGate.require(storeId,'telegram.basic');
        const [current] = await tx.select().from(telegramBotsTable).where(eq(telegramBotsTable.storeId,storeId)).for('update');
        if (!current || current.status==='disconnected' || current.encryptedToken!==snapshot.encryptedToken || current.tokenHash!==snapshot.tokenHash || current.telegramBotId!==snapshot.telegramBotId) return null;
        const [duplicate] = await tx.select({storeId:telegramBotsTable.storeId}).from(telegramBotsTable).where(and(eq(telegramBotsTable.tokenHash,snapshot.tokenHash),ne(telegramBotsTable.storeId,storeId))).limit(1);
        if (duplicate) throw new TelegramFailure('Duplicate bot connection',undefined,true);
        assertBotTokenAvailable(storeId,token);
        assertBotLifecycleCurrent(version);
        const [next] = await tx.update(telegramBotsTable).set({status:'connected',lastError:null,username:bot.username??null,firstName:bot.first_name,lastConnectionTestAt:new Date(),lastConnectionTestError:null,updatedAt:new Date()}).where(eq(telegramBotsTable.storeId,storeId)).returning();
        await tx.update(storesTable).set({botStatus:'connected',updatedAt:new Date()}).where(eq(storesTable.id,storeId));
        return next;
      });
      if (!saved) { res.status(409).json({ error: 'تغيّر المتجر أو اتصال البوت أثناء التحقق. حدّث الصفحة وأعد المحاولة.' }); return; }
      try { assertBotLifecycleCurrent(version);startBotForStore({storeId,token,lastUpdateId:saved.lastUpdateId}); }
      catch (error) {
        if(botLifecycleVersion()===version){
          const changed=await db.update(telegramBotsTable).set({status:'error',lastError:'تعذر استئناف استقبال البوت.'}).where(and(eq(telegramBotsTable.storeId,storeId),eq(telegramBotsTable.tokenHash,snapshot.tokenHash),eq(telegramBotsTable.encryptedToken,snapshot.encryptedToken))).returning({storeId:telegramBotsTable.storeId});
          if(changed.length)await db.update(storesTable).set({botStatus:'error'}).where(and(eq(storesTable.id,storeId),eq(storesTable.isDeleted,false)));
        }
        throw error;
      }
      await writeAuditEvent({userId:req.auth!.userId,storeId,action:'telegram.reconnected',summary:'تم استئناف اتصال البوت المحفوظ',details:{username:saved.username}});
      res.json(ConnectStoreBotResponse.parse({connected:true,username:saved.username,firstName:saved.firstName,status:'connected',lastError:null}));
    } catch (error) {
      if (error instanceof TelegramFailure) { res.status(error.conflict?409:502).json({ error: error.conflict?'يتعارض اتصال البوت مع متجر أو استقبال آخر. تحقق من اتصاله وأعد المحاولة.':'تعذر التحقق من Telegram. لم يُستأنف الاتصال؛ أعد المحاولة.' }); return; }
      if ((error as {code?:string}).code==='23505') { res.status(409).json({error:'هذا البوت مرتبط بمتجر آخر.'});return; }
      throw error;
    }
  });
});

router.get("/stores/:storeId/telegram/health", requireAuth, async (req, res): Promise<void> => {
  const storeId = req.params.storeId;
  if (typeof storeId !== "string" || !(await getOwnedStore(storeId, req.auth!.userId, 'overview.read') || await getOwnedStore(storeId, req.auth!.userId, 'telegram.design'))) { res.status(404).json({ error: "المتجر غير موجود." }); return; }
  const [bot] = await db.select({ username:telegramBotsTable.username, status: telegramBotsTable.status, lastError: telegramBotsTable.lastError,
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
  const store = await getOwnedStore(storeId, req.auth!.userId, 'telegram.design');
  if (!store) { res.status(404).json({ error: "المتجر غير موجود." }); return; }
  const [row] = await db.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, storeId)).limit(1);
  const studio = readHomeStudio(row?.settings.telegramHomeStudio);
  res.json({ ...studio, enabled: await featureGate.can(storeId, "telegram.advanced"), preview: await renderStoreHome(store,studio.draft,"اسم العميل") });
});

router.post("/stores/:storeId/telegram/studio/:action", requireAuth, requireCsrf, async (req, res): Promise<void> => {
  const storeId = req.params.storeId; const action = req.params.action;
  if (typeof storeId !== "string" || !["draft", "preview", "publish"].includes(String(action))) { res.status(400).json({ error: "طلب غير صالح." }); return; }
  const store = await getOwnedStore(storeId, req.auth!.userId, 'telegram.design');
  if (!store) { res.status(404).json({ error: "المتجر غير موجود." }); return; }
  await featureGate.require(storeId, "telegram.advanced");
  const configuration = parseHomeConfiguration(req.body?.configuration);
  if (action !== "publish" && !configuration) { res.status(400).json({ error: "إعدادات الصفحة الرئيسية غير صالحة." }); return; }
  if (action === "preview") {
    const input = parseStudioPreviewInput(req.body);
    if (!input) { res.status(400).json({ error: 'سياق المعاينة غير صالح.' }); return; }
    if(!await canPreviewCustomer(storeId,req.auth!.userId,input.customerId,input.callbackData)){res.status(403).json({error:'معاينة بيانات العميل تتطلب صلاحيات العملاء والطلبات المناسبة.'});return;}
    const preview = await previewStoreScreen(store, configuration!, { callback: input.callbackData, customerId: input.customerId, search: input.search,state:input.state });
    if (!preview) { res.status(400).json({ error: 'هذا الإجراء غير متاح في المعاينة. المعاينة لا تنشئ طلبات.' }); return; }
    res.json({ preview }); return;
  }
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
  res.json({ ...result, enabled: true, preview: await renderStoreHome(store,result.draft,"اسم العميل") });
});

router.get("/stores/:storeId/telegram/designer", requireAuth, async (req, res): Promise<void> => {
  const storeId = req.params.storeId;
  if (typeof storeId !== "string" || !storeId) { res.status(400).json({ error: "معرّف المتجر غير صالح." }); return; }
  const store = await getOwnedStore(storeId, req.auth!.userId, 'telegram.design');
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
  const store = await getOwnedStore(storeId, req.auth!.userId, 'telegram.design');
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
    const version=botLifecycleVersion();
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

    await withBotConnectionChange(store.id, async () => {
    if (!await getOwnedStore(store.id,req.auth!.userId)) { res.status(404).json({error:"المتجر غير موجود."}); return; }
    try {
      assertBotLifecycleCurrent(version);
      const { bot, webhookUrl } = await validateTelegramBotToken(parsed.data.token);
      if (webhookUrl) {
        res.status(409).json({
          error: "للبوت Webhook مفعّل. عطّله في Telegram قبل استخدام وضع Polling.",
        });
        return;
      }

      assertBotLifecycleCurrent(version);
      assertBotTokenAvailable(store.id,parsed.data.token);
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
      assertBotLifecycleCurrent(version);
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
    });
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
    await withBotConnectionChange(store.id,async () => {
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
    });
  },
);

export default router;
