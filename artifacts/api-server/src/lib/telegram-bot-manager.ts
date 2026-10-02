import { and, eq } from "drizzle-orm";
import { db, productsTable, storesTable, telegramBotsTable } from "@workspace/db";
import { logger } from "./logger";
import { decryptBotToken, sha256 } from "./security";

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
    chat: { id: number };
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
  if (!command || !["/start", "/help", "/catalog"].includes(command)) return;

  const [store] = await db
    .select({ name: storesTable.name, currency: storesTable.currency })
    .from(storesTable)
    .where(and(eq(storesTable.id, storeId), eq(storesTable.isDeleted, false)))
    .limit(1);
  if (!store) return;

  if (command === "/catalog") {
    const products = await db
      .select({
        name: productsTable.name,
        price: productsTable.price,
        description: productsTable.description,
      })
      .from(productsTable)
      .where(
        and(
          eq(productsTable.storeId, storeId),
          eq(productsTable.isPublished, true),
          eq(productsTable.isDeleted, false),
        ),
      )
      .limit(10);
    const content =
      products.length === 0
        ? "المتجر يجهّز منتجاته الآن. تفضل بزيارتنا قريبًا."
        : products
            .map(
              (product) =>
                `• ${product.name} — ${Number(product.price).toFixed(2)} ${store.currency}`,
            )
            .join("\n");
    await sendText(bot, message.chat.id, `${store.name}\n\n${content}`);
    return;
  }

  const helpText =
    command === "/start"
      ? `أهلًا بك في ${store.name}.\nاستخدم /catalog لاستعراض المنتجات أو /help للمساعدة.`
      : `أوامر ${store.name}:\n/start — بدء المحادثة\n/catalog — استعراض المنتجات\n/help — عرض المساعدة`;
  await sendText(bot, message.chat.id, helpText);
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
        await db
          .update(telegramBotsTable)
          .set({
            lastUpdateId: String(bot.nextOffset),
            updatedAt: new Date(),
          })
          .where(eq(telegramBotsTable.storeId, storeId));
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