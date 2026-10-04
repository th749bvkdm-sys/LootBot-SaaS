import { and, asc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  orderItemsTable,
  ordersTable,
  productsTable,
  storeSettingsTable,
  storesTable,
  telegramBotsTable,
} from "@workspace/db";
import { writeAuditEvent } from "./audit";
import { logger } from "./logger";
import { createId, decryptBotToken, sha256 } from "./security";
import { isPlanLimitReached, planLimitMessage, readPlanCode } from "./plans";
import { getPlanCatalog } from "./store-plans";

interface TelegramBotUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type?: string };
    from?: { id: number; first_name: string; username?: string; is_bot?: boolean };
  };
}

export class TelegramFailure extends Error {
  constructor(
    message: string,
    readonly telegramCode?: number,
    readonly conflict = false,
  ) {
    super(message);
    this.name = "TelegramFailure";
  }
}

interface ActiveBot {
  tokenHash: string;
  token: string;
  controller: AbortController;
  nextOffset: number;
}

const activeByStore = new Map<string, ActiveBot>();
const activeStoreByToken = new Map<string, string>();

async function telegramCall<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ?? AbortSignal.timeout(25_000),
  });

  let payload: TelegramEnvelope<T>;
  try {
    payload = (await response.json()) as TelegramEnvelope<T>;
  } catch {
    throw new TelegramFailure("تعذر قراءة استجابة Telegram.");
  }
  if (!response.ok || !payload.ok || payload.result === undefined) {
    throw new TelegramFailure(
      "تعذر الاتصال بالبوت.",
      payload.error_code ?? response.status,
      payload.error_code === 409,
    );
  }
  return payload.result;
}

export async function validateTelegramBotToken(
  token: string,
): Promise<{ bot: TelegramBotUser; webhookUrl: string }> {
  let bot: TelegramBotUser;
  try {
    bot = await telegramCall<TelegramBotUser>(token, "getMe");
    const webhook = await telegramCall<{ url?: string }>(
      token,
      "getWebhookInfo",
    );
    return { bot, webhookUrl: webhook.url ?? "" };
  } catch (error) {
    if (error instanceof TelegramFailure) throw error;
    throw new TelegramFailure("تعذر الاتصال بالبوت.");
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

async function sendText(
  bot: ActiveBot,
  chatId: number,
  text: string,
): Promise<void> {
  await telegramCall(bot.token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

async function handleUpdate(
  storeId: string,
  bot: ActiveBot,
  update: TelegramUpdate,
): Promise<void> {
  const message = update.message;
  if (!message?.text) return;
  const command = message.text.trim().split(/\s+/, 1)[0]?.split("@", 1)[0];
  if (!command || !["/start", "/help", "/catalog", "/order"].includes(command)) return;

  const [store] = await db
    .select({
      ownerId: storesTable.ownerId,
      name: storesTable.name,
      currency: storesTable.currency,
      manualPaymentInstructions: storesTable.manualPaymentInstructions,
    })
    .from(storesTable)
    .where(and(eq(storesTable.id, storeId), eq(storesTable.isDeleted, false)))
    .limit(1);
  if (!store) return;

  if (command === "/catalog") {
    const products = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        price: productsTable.price,
        stock: productsTable.stock,
      })
      .from(productsTable)
      .where(
        and(
          eq(productsTable.storeId, storeId),
          eq(productsTable.isPublished, true),
          eq(productsTable.isDeleted, false),
        ),
      )
      .orderBy(asc(productsTable.createdAt), asc(productsTable.id))
      .limit(20);
    const content =
      products.length === 0
        ? "لا توجد منتجات متاحة للطلب الآن."
        : products
            .map((product, index) =>
              `[${product.id.replaceAll("-", "").slice(0, 12)}] ${product.name} — ${Number(product.price).toFixed(2)} ${store.currency}${product.stock < 1 ? " (نفد المخزون)" : ""}`,
            )
            .join("\n");
    const orderInstructions =
      products.length > 0
        ? "\n\nلطلب منتج أرسل:\n/order رمز_المنتج الكمية\nانسخ الرمز بين الأقواس من قائمة المنتجات.\nلا يتم الدفع داخل البوت."
        : "";
    await sendText(bot, message.chat.id, `${store.name}\n\n${content}${orderInstructions}`);
    return;
  }

  if (command === "/order") {
    if (message.chat.type !== "private") {
      await sendText(bot, message.chat.id, "للطلب، ابدأ محادثة خاصة مع البوت ثم أرسل /catalog.");
      return;
    }
    if (!message.from || message.from.is_bot) {
      await sendText(bot, message.chat.id, "تعذر التحقق من حساب Telegram.");
      return;
    }
    const match = /^\/order(?:@\w+)?\s+([a-f0-9]{12})(?:\s+(\d+))?\s*$/i.exec(message.text.trim());
    const productCode = match?.[1]?.toLowerCase();
    const quantity = Number(match?.[2] ?? 1);
    if (!match || !productCode ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      await sendText(bot, message.chat.id, "صيغة الطلب: /order رمز_المنتج الكمية\nانسخ رمز المنتج من /catalog.");
      return;
    }

    const prior = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.storeId, storeId),
          eq(ordersTable.telegramUpdateId, String(update.update_id)),
        ),
      )
      .limit(1);
    if (prior[0]) {
      await sendText(bot, message.chat.id, `تم تسجيل هذا الطلب مسبقًا. رقم الطلب: ${prior[0].id.slice(0, 8)}.`);
      return;
    }

    const listedProducts = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        price: productsTable.price,
        stock: productsTable.stock,
      })
      .from(productsTable)
      .where(
        and(
          eq(productsTable.storeId, storeId),
          eq(productsTable.isPublished, true),
          eq(productsTable.isDeleted, false),
        ),
      )
      .orderBy(asc(productsTable.createdAt), asc(productsTable.id))
      .limit(20);
    const selected = listedProducts.find(
      (product) => product.id.replaceAll("-", "").slice(0, 12).toLowerCase() === productCode,
    );
    if (!selected) {
      await sendText(bot, message.chat.id, "رمز المنتج غير متاح. أرسل /catalog لعرض المنتجات.");
      return;
    }
    if (selected.stock < quantity) {
      await sendText(bot, message.chat.id, "الكمية المطلوبة غير متوفرة. أرسل /catalog للتحقق من المخزون.");
      return;
    }

    const orderId = createId();
    const monthStart = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
    );
    const planCatalog = await getPlanCatalog();
    const result = await db.transaction(async (tx) => {
      await tx
        .select({ id: storesTable.id })
        .from(storesTable)
        .where(eq(storesTable.id, storeId))
        .for("update");
      const [settings] = await tx
        .select({ settings: storeSettingsTable.settings })
        .from(storeSettingsTable)
        .where(eq(storeSettingsTable.storeId, storeId))
        .limit(1);
      const plan = readPlanCode(settings?.settings);
      const [monthlyOrderCount] = await tx
        .select({ value: sql<number>`count(*)` })
        .from(ordersTable)
        .where(
          and(
            eq(ordersTable.storeId, storeId),
            gte(ordersTable.createdAt, monthStart),
          ),
        );
      const monthlyUsage = Number(monthlyOrderCount?.value ?? 0);
      if (isPlanLimitReached(plan, "ordersPerMonth", monthlyUsage, planCatalog)) {
        return { planLimit: plan };
      }

      const [reserved] = await tx
        .update(productsTable)
        .set({
          stock: sql`${productsTable.stock} - ${quantity}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productsTable.id, selected.id),
            eq(productsTable.storeId, storeId),
            eq(productsTable.isPublished, true),
            eq(productsTable.isDeleted, false),
            gte(productsTable.stock, quantity),
          ),
        )
        .returning({
          id: productsTable.id,
          name: productsTable.name,
          price: productsTable.price,
        });
      if (!reserved) return { order: undefined };

      const unitPriceCents = Math.round(Number(reserved.price) * 100);
      const lineTotal = ((unitPriceCents * quantity) / 100).toFixed(2);
      await tx.insert(ordersTable).values({
        id: orderId,
        storeId,
        telegramUpdateId: String(update.update_id),
        telegramChatId: String(message.chat.id),
        telegramUserId: String(message.from!.id),
        telegramUsername: message.from!.username ?? null,
        customerName: message.from!.first_name.slice(0, 80) || "Telegram customer",
        status: "pending",
        currency: store.currency,
        total: lineTotal,
      });
      await tx.insert(orderItemsTable).values({
        id: createId(),
        orderId,
        productId: reserved.id,
        productName: reserved.name,
        unitPrice: (unitPriceCents / 100).toFixed(2),
        quantity,
        lineTotal,
      });
      return { order: { total: lineTotal } };
    });

    if (result.planLimit) {
      await sendText(
        bot,
        message.chat.id,
        planLimitMessage(result.planLimit, "ordersPerMonth"),
      );
      return;
    }
    if (!result.order) {
      await sendText(bot, message.chat.id, "الكمية المطلوبة غير متوفرة. أرسل /catalog للتحقق من المخزون.");
      return;
    }
    try {
      await writeAuditEvent({
        userId: store.ownerId,
        storeId,
        action: "order.created",
        summary: `تم تسجيل طلب جديد #${orderId.slice(0, 8)}`,
        details: { orderId },
      });
    } catch (error) {
      logger.warn(
        { storeId, errorType: error instanceof Error ? error.name : "UnknownError" },
        "Could not add an audit entry for a Telegram order.",
      );
    }
    await sendText(
      bot,
      message.chat.id,
      `تم تسجيل طلبك رقم ${orderId.slice(0, 8)} بانتظار تأكيد المتجر.\nالإجمالي: ${result.order.total} ${store.currency}\nلم يتم استلام الدفع عبر LootBot.${store.manualPaymentInstructions?.trim() ? `\n\nتعليمات الدفع خارج التطبيق:\n${store.manualPaymentInstructions.trim()}` : "\n\nرتّب الدفع خارج التطبيق بالتواصل مع المتجر."}`,
    );
    return;
  }

  const helpText =
    command === "/start"
      ? `أهلًا بك في ${store.name}.\nاستخدم /catalog لاستعراض المنتجات أو /help للمساعدة.`
      : `أوامر ${store.name}:\n/start — بدء المحادثة\n/catalog — استعراض المنتجات\n/order رمز_المنتج الكمية — تسجيل طلب\n/help — عرض المساعدة`;
  await sendText(bot, message.chat.id, helpText);
}

export async function notifyTelegramOrderStatus(input: {
  storeId: string;
  chatId: string;
  orderId: string;
  status: string;
}): Promise<void> {
  const messages: Record<string, string> = {
    confirmed: "تم تأكيد طلبك من المتجر.",
    fulfilled: "تم تجهيز طلبك.",
    cancelled: "أُلغي طلبك وأُعيدت الكمية إلى المخزون.",
    paid: "سجّل المتجر استلام دفعتك يدويًا.",
    refunded: "سجّل المتجر إعادة المبلغ إليك يدويًا.",
  };
  const message = messages[input.status];
  if (!message) return;
  try {
    const [bot] = await db
      .select({ encryptedToken: telegramBotsTable.encryptedToken })
      .from(telegramBotsTable)
      .where(
        and(
          eq(telegramBotsTable.storeId, input.storeId),
          eq(telegramBotsTable.status, "connected"),
        ),
      )
      .limit(1);
    if (!bot) return;
    await telegramCall(decryptBotToken(bot.encryptedToken), "sendMessage", {
      chat_id: input.chatId,
      text: `${message}\nرقم الطلب: ${input.orderId.slice(0, 8)}.`,
      disable_web_page_preview: true,
    });
  } catch (error) {
    logger.warn(
      {
        storeId: input.storeId,
        telegramCode: error instanceof TelegramFailure ? error.telegramCode : undefined,
        errorType: error instanceof Error ? error.name : "UnknownError",
      },
      "Could not send the order status notification to the Telegram customer.",
    );
  }
}

async function recordBotError(
  storeId: string,
  message: string,
  code?: number,
): Promise<void> {
  const safeMessage =
    code === 403
      ? "البوت محظور أو لا يملك الإذن المطلوب."
      : "تعذر الاتصال بالبوت.";
  await db
    .update(telegramBotsTable)
    .set({ status: "error", lastError: safeMessage, updatedAt: new Date() })
    .where(eq(telegramBotsTable.storeId, storeId));
  await db
    .update(storesTable)
    .set({ botStatus: "error", updatedAt: new Date() })
    .where(eq(storesTable.id, storeId));
  logger.warn(
    { storeId, telegramCode: code, errorType: message },
    "Telegram bot connection reported an error.",
  );
}

async function poll(storeId: string, bot: ActiveBot): Promise<void> {
  while (!bot.controller.signal.aborted) {
    try {
      const updates = await telegramCall<TelegramUpdate[]>(
        bot.token,
        `getUpdates?timeout=20&allowed_updates=%5B%22message%22%5D&offset=${bot.nextOffset}`,
        undefined,
        AbortSignal.any([
          bot.controller.signal,
          AbortSignal.timeout(25_000),
        ]),
      );
      for (const update of updates) {
        bot.nextOffset = Math.max(bot.nextOffset, update.update_id + 1);
        try {
          await handleUpdate(storeId, bot, update);
        } catch (error) {
          const code =
            error instanceof TelegramFailure ? error.telegramCode : undefined;
          logger.warn(
            {
              storeId,
              telegramCode: code,
              errorType: error instanceof Error ? error.name : "UnknownError",
            },
            "Telegram bot could not respond to a customer.",
          );
        }
        await db
          .update(telegramBotsTable)
          .set({
            lastUpdateId: String(bot.nextOffset),
            updatedAt: new Date(),
          })
          .where(eq(telegramBotsTable.storeId, storeId));
      }
    } catch (error) {
      if (bot.controller.signal.aborted) return;
      const telegramCode =
        error instanceof TelegramFailure ? error.telegramCode : undefined;
      await recordBotError(
        storeId,
        error instanceof Error ? error.name : "UnknownError",
        telegramCode,
      );
      await pause(5_000, bot.controller.signal);
    }
  }
}

export function startBotForStore(input: {
  storeId: string;
  token: string;
  lastUpdateId?: string | null;
}): void {
  const tokenHash = sha256(input.token);
  const existingStore = activeStoreByToken.get(tokenHash);
  if (existingStore && existingStore !== input.storeId) {
    throw new TelegramFailure("هذا البوت مرتبط بمتجر آخر.", undefined, true);
  }
  stopBotForStore(input.storeId);
  const bot: ActiveBot = {
    tokenHash,
    token: input.token,
    controller: new AbortController(),
    nextOffset:
      input.lastUpdateId && Number.isFinite(Number(input.lastUpdateId))
        ? Number(input.lastUpdateId)
        : 0,
  };
  activeByStore.set(input.storeId, bot);
  activeStoreByToken.set(tokenHash, input.storeId);
  void poll(input.storeId, bot);
}

export function stopBotForStore(storeId: string): void {
  const bot = activeByStore.get(storeId);
  if (!bot) return;
  bot.controller.abort();
  activeByStore.delete(storeId);
  if (activeStoreByToken.get(bot.tokenHash) === storeId) {
    activeStoreByToken.delete(bot.tokenHash);
  }
}

export function stopAllBots(): void {
  for (const storeId of activeByStore.keys()) {
    stopBotForStore(storeId);
  }
}

export async function startActiveStoreBots(): Promise<void> {
  const active = await db
    .select({
      storeId: telegramBotsTable.storeId,
      encryptedToken: telegramBotsTable.encryptedToken,
      lastUpdateId: telegramBotsTable.lastUpdateId,
    })
    .from(telegramBotsTable)
    .innerJoin(storesTable, eq(storesTable.id, telegramBotsTable.storeId))
    .where(
      and(
        eq(storesTable.isDeleted, false),
        eq(telegramBotsTable.status, "connected"),
      ),
    );

  for (const record of active) {
    try {
      const token = decryptBotToken(record.encryptedToken);
      const { webhookUrl } = await validateTelegramBotToken(token);
      if (webhookUrl) {
        await recordBotError(record.storeId, "Webhook configured", 409);
        continue;
      }
      startBotForStore({
        storeId: record.storeId,
        token,
        lastUpdateId: record.lastUpdateId,
      });
    } catch (error) {
      await recordBotError(
        record.storeId,
        error instanceof Error ? error.name : "UnknownError",
        error instanceof TelegramFailure ? error.telegramCode : undefined,
      );
    }
  }
  logger.info({ count: active.length }, "Loaded active Telegram bots.");
}
