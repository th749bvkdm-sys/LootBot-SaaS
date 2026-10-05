import { and, asc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import {
  db,
  orderItemsTable,
  ordersTable,
  productImagesTable,
  productsTable,
  storeSettingsTable,
  storesTable,
  telegramBotsTable,
} from "@workspace/db";
import { writeAuditEvent } from "./audit";
import { logger } from "./logger";
import { createId, decryptBotToken, sha256 } from "./security";
import { isFeatureAvailable, isPlanLimitReached, planLimitMessage, readPlanCode } from "./plans";
import { getPlanCatalog, getStorePlan } from "./store-plans";
import { readTelegramDesignerSettings } from "./telegram-designer";
import { productMediaRequest } from "./telegram-product-media";
import { defaultHomeKeyboard, navigationFooter, parseNavigationCallback, type BotButton } from "./telegram-navigation";
import { captureSearchMessage, clearPendingSearch, rememberProductParent, renderStoreScreen, type ScreenContext } from "./telegram-store-screens";
import { createLoginRateLimiter } from "./login-rate-limit";
import { readHomeStudio, renderConfiguredHome } from "./telegram-home-configuration";
import { readBusinessStudio, renderBusinessScreen } from "./telegram-business-configuration";
import { businessViewerData } from './telegram-business-data';
import { createBusinessNavigation } from "./telegram-business-navigation";
import { commerceAvailability, commerceHome, renderCommerce, setCustomerCoupon, recordReview, registerCustomerReferral, productReviewSummary } from './customer-commerce';
import { customerFacts, enqueueGrowthEvent, touchCustomer } from "./growth-service";
import { presentTelegramScreen, themeDefaults, type ScreenStyleMap } from './telegram-presentation';
import { renderStoreHome } from './telegram-home-data';
import { productCardText } from './telegram-product-card';
import { productButtons, productInstructions } from './telegram-product-buttons';
import { withBotConnectionChange } from './bot-connection-lock';

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
  callback_query?: {
    id: string; data?: string;
    from: { id: number; first_name: string; username?: string; is_bot?: boolean };
    message?: { message_id: number; text?: string; chat: { id: number; type?: string } };
  };
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
const callbackRateLimiter = createLoginRateLimiter({ windowMs: 60_000, maxAttempts: 40 });
const businessNavigation = createBusinessNavigation();
let lifecycleVersion=0;
let draining=false;
export const botLifecycleVersion=()=>lifecycleVersion;
export function assertBotLifecycleCurrent(version:number):void {
  if(draining||version!==lifecycleVersion)throw new TelegramFailure('Bot lifecycle changed',undefined,true);
}

export function assertBotTokenAvailable(storeId: string, token: string): void {
  const existingStore = activeStoreByToken.get(sha256(token));
  if (existingStore && existingStore !== storeId) throw new TelegramFailure('هذا البوت مرتبط بمتجر آخر.', undefined, true);
}

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

async function activeBotCall<T>(bot: ActiveBot, method: string, body?: Record<string,unknown>): Promise<T> {
  if (bot.controller.signal.aborted) throw new TelegramFailure('Bot reception stopped');
  return telegramCall<T>(bot.token,method,body,AbortSignal.any([bot.controller.signal,AbortSignal.timeout(25_000)]));
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
  buttons?: BotButton[][],
): Promise<void> {
  await activeBotCall(bot, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export async function handleTelegramUpdate(
  storeId: string,
  bot: ActiveBot,
  update: TelegramUpdate,
  productParent = "lb:products:1",
  galleryIndex = 0,
  businessParent?: string,
  businessOrigin?: string,
): Promise<void> {
  if (bot.controller.signal.aborted) return;
  const callback = update.callback_query;
  const message = callback?.message ? { ...callback.message, from: callback.from, text: callback.message.text ?? "" } : update.message;
  if (!message || message.from?.is_bot) return;
  const text = message.text ?? "";
  const command = text.trim().split(/\s+/, 1)[0]?.split("@", 1)[0];
  let action = callback ? parseNavigationCallback(callback.data) : null;
  if (callback) {
    if (callbackRateLimiter.isLimited(`${storeId}:${callback.from.id}`)) {
      await activeBotCall(bot, "answerCallbackQuery", { callback_query_id: callback.id, text: "انتظر قليلًا ثم حاول مجددًا." }); return;
    }
    await activeBotCall(bot, "answerCallbackQuery", { callback_query_id: callback.id,
      ...(!action ? { text: "هذه القائمة قديمة. أرسل /start لتحديثها." } : {}),
    });
    if (!action) return;
    if (action.kind === "close" && callback.message) {
      await activeBotCall(bot, "editMessageReplyMarkup", { chat_id: callback.message.chat.id, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
      return;
    }
  }

  const [store] = await db
    .select({
      ownerId: storesTable.ownerId,
      name: storesTable.name,
      currency: storesTable.currency,
      manualPaymentInstructions: storesTable.manualPaymentInstructions,
      botUsername: telegramBotsTable.username,
      settings: storeSettingsTable.settings,
    })
    .from(storesTable)
    .leftJoin(storeSettingsTable, eq(storeSettingsTable.storeId, storesTable.id))
    .leftJoin(telegramBotsTable, eq(telegramBotsTable.storeId, storesTable.id))
    .where(and(eq(storesTable.id, storeId), eq(storesTable.isDeleted, false)))
    .limit(1);
  if (!store) return;
  const plan = await getStorePlan(storeId);
  const designer = isFeatureAvailable(plan, "telegram.advanced", await getPlanCatalog())
    ? readTelegramDesignerSettings(store.settings)
    : readTelegramDesignerSettings(null);
  const formatMessage = (value: string) => value.replace(/\{\{(?:store|customer)\}\}/g,
    token => token === "{{store}}" ? store.name : message.from?.first_name?.slice(0, 80) ?? "");

  if (!isFeatureAvailable(plan, "telegram.basic", await getPlanCatalog())) {
    await sendText(bot, message.chat.id, "المتجر غير متاح الآن."); return;
  }
  let customerProfile: Awaited<ReturnType<typeof touchCustomer>> | undefined;
  if (message.from && message.chat.type === "private") {
    customerProfile = await touchCustomer({ storeId, userId: message.from.id, chatId: message.chat.id, name: message.from.first_name, username: message.from.username,
      ...(!callback && command === "/start" ? { optIn: true } : !callback && command === "/stop" ? { optIn: false } : {}) });
    const referral = !callback && /^\/start(?:@\w+)?\s+(ref_[a-f0-9]{32})\s*$/i.exec(text.trim());
    if (referral && customerProfile) await registerCustomerReferral(customerProfile, referral[1]);
    if (!callback && command === "/stop") { await sendText(bot, message.chat.id, "تم إيقاف الرسائل التسويقية. أرسل /start لإعادة تفعيلها."); return; }
  }
  const proPresentation = isFeatureAvailable(plan, "telegram.advanced", await getPlanCatalog()) ? readHomeStudio(store.settings?.telegramHomeStudio).published : null;
  const business = store.settings?.telegramHomeMode !== "pro" && isFeatureAvailable(plan, "telegram.studio", await getPlanCatalog()) ? readBusinessStudio(store.settings?.telegramBusinessStudio).published : null;
  const presentationTheme=business?.theme??proPresentation?.theme;
  const context: ScreenContext | null = message.from ? {
    storeId, storeName: store.name, currency: store.currency, userId: message.from.id,
    chatId: message.chat.id, privateChat: message.chat.type === "private", customerName: message.from.first_name.slice(0, 80),
    styles:proPresentation?.screenStyles,
    send: async (content, buttons, screen = 'products', media = []) => {
      const styled = presentTelegramScreen(presentationTheme, proPresentation?.screenStyles?.[screen as keyof ScreenStyleMap], content, buttons, store.name, message.from!.first_name);
      for(const photo of media.slice(0,6)) await activeBotCall(bot,'sendPhoto',{chat_id:message.chat.id,photo}).catch(()=>undefined);
      if (styled.imageUrl && styled.imagePlacement==='before') await activeBotCall(bot, 'sendPhoto', { chat_id: message.chat.id, photo: styled.imageUrl }).catch(() => undefined);
      await sendText(bot, message.chat.id, styled.text, businessParent && business ? businessNavigation.wrap(storeId, message.from!.id, message.chat.id, businessParent, styled.keyboard, {revision:sha256(JSON.stringify(business)),origin:businessOrigin}) : styled.keyboard);
      if (styled.imageUrl && styled.imagePlacement==='after') await activeBotCall(bot, 'sendPhoto', { chat_id: message.chat.id, photo: styled.imageUrl }).catch(() => undefined);
    },
    product: async (code, parent, index) => {
      await handleTelegramUpdate(storeId, bot, { update_id: update.update_id, message: { ...message, text: `/product ${code}` } }, parent, index, businessParent, businessOrigin);
    },
  } : null;
  const searchText = context && !callback ? captureSearchMessage(context, text) : null;
  const businessViewer = async (screenId = 'home') => {
    if (!business) return { storeName: store.name, customerName: message.from?.first_name ?? '', returning: false, now: Date.now() };
    return businessViewerData({ id: storeId, name: store.name, currency: store.currency }, business, screenId, customerProfile);
  };
  if (action?.kind === "contextual") {
    const saved = context ? businessNavigation.read(storeId, context.userId, context.chatId, action.ref) : null;
    const current = saved && business ? renderBusinessScreen(business, saved.source, await businessViewer(saved.source)) : null;
    if (!saved || !business || saved.revision!==sha256(JSON.stringify(business)) || !current || !current.keyboard.flat().some(b=>b.callback_data===saved.origin)) {
      await sendText(bot, message.chat.id, "هذه القائمة انتهت أو لم تعد متاحة. أرسل /start لتحديثها.", navigationFooter()); return;
    }
    businessParent = saved.source; businessOrigin = saved.origin; action = parseNavigationCallback(saved.callback);
  }
  if (context && businessParent && (action?.kind === "search" || action?.kind === "searchClear")) {
    if(business)businessNavigation.rememberSearchOrigin(storeId, context.userId, context.chatId, businessParent,{revision:sha256(JSON.stringify(business)),origin:businessOrigin});
  }
  if (context && searchText !== null && !businessParent) {
    const saved = businessNavigation.searchPolicy(storeId, context.userId, context.chatId);
    const source=saved?.source;const rendered=source&&business?renderBusinessScreen(business,source,await businessViewer(source)):null;
    if (source && business && saved?.revision===sha256(JSON.stringify(business)) && rendered?.keyboard.flat().some(b=>b.callback_data===saved.origin)) {businessParent = source;businessOrigin=saved.origin;}
    else if(source){clearPendingSearch(context);businessNavigation.clearSearchOrigin(storeId,context.userId,context.chatId);await context.send('هذه القائمة انتهت أو لم تعد متاحة. أرسل /start لتحديثها.',navigationFooter(),'error');return;}
  }
  const sendBusinessScreen = async (screenId: string) => {
    const viewer = business ? await businessViewerData({ id: storeId, name: store.name, currency: store.currency }, business, screenId, customerProfile, true) : null;
    const rendered = business && viewer ? renderBusinessScreen(business, screenId, viewer) : null;
    if (rendered) {
      for (const image of rendered.images) await activeBotCall(bot, 'sendPhoto', {chat_id: message.chat.id, photo:image}).catch(() => undefined);
      await sendText(bot, message.chat.id, rendered.text, context && business ? businessNavigation.wrap(storeId, context.userId, context.chatId, screenId, rendered.keyboard,{revision:sha256(JSON.stringify(business))}) : rendered.keyboard);
    }
    else await sendText(bot, message.chat.id, "هذه الشاشة غير متاحة الآن.", navigationFooter());
  };
  if (action?.kind === "screen") {
    if (context) { clearPendingSearch(context); businessNavigation.clearSearchOrigin(storeId, context.userId, context.chatId); }
    await sendBusinessScreen(action.id); return;
  }
  if (action?.kind === 'message') {
    const messageAction = action;
    const screen = business?.screens.find(s => s.id === messageAction.screenId);
    const button = screen?.buttons.find(b => b.id === (action as {buttonId:string}).buttonId) ?? screen?.blocks.filter(b=>b.type==='CUSTOM_BUTTON').map(b=>({...b, action:b.action!, title:b.title||b.text, target:b.target||null})).find(b=>b.id===(action as {buttonId:string}).buttonId);
    const rendered = business ? renderBusinessScreen(business, action.screenId, await businessViewer(action.screenId)) : null;
    if (button?.action !== 'SEND_MESSAGE' || !rendered?.keyboard.flat().some(b => b.callback_data === callback?.data || b.callback_data === `lb:msg:${action.screenId}:${action.buttonId}`)) {
      await sendText(bot, message.chat.id, 'هذا الزر لم يعد متاحًا.', navigationFooter()); return;
    }
    await sendText(bot, message.chat.id, formatMessage(button.target!), navigationFooter(`lb:screen:${action.screenId}`)); return;
  }
  if (context && action?.kind === 'commerce') { await renderCommerce(context, customerProfile, action.feature, action.code, String(update.update_id), store.botUsername ?? undefined, false, action.page??1,action.parentRef); return; }
  if (context && customerProfile && !callback && ['/coupon', '/review'].includes(command)) {
    try {
      if (command === '/coupon') { const code = /^\/coupon(?:@\w+)?\s+([A-Z0-9_-]{3,24})\s*$/i.exec(text.trim())?.[1]; if (!code) throw Error('أرسل /coupon رمز_الكوبون'); await setCustomerCoupon(customerProfile, code); }
      else { const match = /^\/review(?:@\w+)?\s+([a-f0-9]{12})\s+([1-5])\s*$/i.exec(text.trim()); if (!match) throw Error('أرسل /review رمز_المنتج تقييم_من_1_إلى_5'); await recordReview(customerProfile, match[1], Number(match[2])); }
      await context.send('تم الحفظ بنجاح.', navigationFooter(), 'success');
    } catch (e) { await context.send(e instanceof Error ? e.message : 'تعذر الحفظ.', navigationFooter(), 'error'); } return;
  }
  if (action?.kind === "buy") {
    await handleTelegramUpdate(storeId, bot, { update_id: update.update_id, message: { ...message, text: `/order ${action.code} 1` } }); return;
  }
  if (action?.kind === "home" || (!callback && command === "/start")) {
    if (context) { clearPendingSearch(context); businessNavigation.clearSearchOrigin(storeId, context.userId, context.chatId); }
    const productLink = !callback && /^\/start(?:@\w+)?\s+product_([a-f0-9]{12})\s*$/i.exec(text.trim());
    if (productLink && context) { await context.product(productLink[1].toLowerCase(), "lb:home"); return; }
    const screenLink = !callback && /^\/start(?:@\w+)?\s+screen_([a-z][a-z0-9_-]{0,23})\s*$/.exec(text.trim());
    if (screenLink) { await sendBusinessScreen(screenLink[1]); return; }
    if (business) { await sendBusinessScreen("home"); return; }
    const published = isFeatureAvailable(plan, "telegram.advanced", await getPlanCatalog()) ? readHomeStudio(store.settings?.telegramHomeStudio).published : null;
    if (published) {
      const home = await renderStoreHome({id:storeId,name:store.name,currency:store.currency},published,message.from?.first_name ?? '');
      if (home.imageUrl) await activeBotCall(bot, 'sendPhoto', { chat_id: message.chat.id, photo: home.imageUrl }).catch(() => undefined);
      await sendText(bot, message.chat.id, home.text, home.keyboard); return;
    }
    const welcome = designer.welcomeMessage ? formatMessage(designer.welcomeMessage) : `أهلًا ${message.from?.first_name?.slice(0, 80) ?? ""} في ${store.name}.\nاختر من قائمة المتجر:`;
    await sendText(bot, message.chat.id, welcome, [...defaultHomeKeyboard(), ...await commerceHome(storeId)]); return;
  }
  if (context && action) { await renderStoreScreen(context, action); return; }
  const screens = { "/products": "products", "/categories": "categories", "/search": "search", "/orders": "orders", "/account": "account" } as const;
  const screen = screens[command as keyof typeof screens];
  if (context && (screen || searchText !== null)) {
    await renderStoreScreen(context, screen === "account" ? { kind: "account" } : { kind: screen ?? "search", page: 1 }, searchText ?? undefined); return;
  }
  if (!["/help", "/catalog", "/order", "/product"].includes(command)) return;

  if (command === "/product") {
    const code = /^\/product(?:@\w+)?\s+([a-f0-9]{12})\s*$/i.exec(text.trim())?.[1]?.toLowerCase();
    if (!code) { await sendText(bot, message.chat.id, "لعرض تفاصيل المنتج أرسل: /product رمز_المنتج من /catalog"); return; }
    const [product] = await db.select().from(productsTable).where(and(
      eq(productsTable.storeId, storeId), eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true),
      sql`substring(replace(${productsTable.id}, '-', '') from 1 for 12) = ${code}`,
    )).limit(1);
    if (!product) { if (context) await context.send("المنتج غير متاح.", navigationFooter(productParent),'error'); else await sendText(bot, message.chat.id, "المنتج غير متاح.", navigationFooter(productParent)); return; }
    const galleryEnabled = isFeatureAvailable(plan, "catalog.multipleImages", await getPlanCatalog());
    const storedImages = galleryEnabled ? await db.select({ imageUrl: productImagesTable.imageUrl }).from(productImagesTable)
      .where(eq(productImagesTable.productId, product.id)).orderBy(productImagesTable.sortOrder).limit(10) : [];
    const images = storedImages.length ? storedImages : product.imageUrl ? [{ imageUrl: product.imageUrl }] : [];
    const caption = `${product.name}\n${Number(product.price).toFixed(2)} ${store.currency}`;
    const index = galleryIndex < images.length ? galleryIndex : 0;
    const imageCounter = images.length ? `\nالصورة ${index + 1} من ${images.length}` : "";
    const media = productMediaRequest(message.chat.id, images.slice(index, index + 1), caption + imageCounter);
    if (media) await activeBotCall(bot, media.method, media.body)
      .catch(async () => { await sendText(bot, message.chat.id, "تعذر عرض الصور الآن."); });
    const parentRef = context ? rememberProductParent(context, productParent) : null;
    const galleryButtons: BotButton[] = [];
    if (parentRef && index > 0) galleryButtons.push({ text: "◀ الصورة السابقة", callback_data: `lb:gallery:${code}:${index - 1}:${parentRef}` });
    if (parentRef && index + 1 < images.length) galleryButtons.push({ text: "الصورة التالية ▶", callback_data: `lb:gallery:${code}:${index + 1}:${parentRef}` });
    const oldPrice = product.oldPrice && Number(product.oldPrice) > Number(product.price) ? `\nالسعر السابق: ${product.oldPrice} ${store.currency} · خصم ${Math.round((1 - Number(product.price) / Number(product.oldPrice)) * 100)}%` : '';
    const available = await commerceAvailability(storeId);
    const rating = available.reviews ? await productReviewSummary(storeId, product.id) : null;
    const style=proPresentation?.screenStyles?.product;
    const productText = productCardText(product,store.currency,proPresentation?.productCardStyle??themeDefaults(presentationTheme).productCardStyle,rating??undefined,{index,total:images.length},style?.badgeStyle)+productInstructions(code,store.botUsername);
    const productButtonRows = productButtons({code,stock:product.stock,parent:productParent,parentRef,galleryIndex:index,galleryCount:images.length,available,botUsername:store.botUsername,productName:product.name,galleryStyle:style?.galleryStyle,buttonPlacement:style?.buttonPlacement});
    if (context) await context.send(productText, productButtonRows, 'product'); else await sendText(bot, message.chat.id, productText, productButtonRows);
    return;
  }

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
              `[${product.id.replaceAll("-", "").slice(0, 12)}] ${product.name} — ${Number(product.price).toFixed(2)} ${store.currency}${designer.showStock ? (product.stock < 1 ? " (نفد المخزون)" : ` (المخزون: ${product.stock})`) : ""}`,
            )
            .join("\n");
    const orderInstructions =
      products.length > 0
        ? "\n\nللتفاصيل والصور: /product رمز_المنتج\nلطلب منتج أرسل:\n/order رمز_المنتج الكمية\nانسخ الرمز بين الأقواس من قائمة المنتجات.\nلا يتم الدفع داخل البوت."
        : "";
    const intro = designer.catalogIntro ? `${formatMessage(designer.catalogIntro)}\n\n` : "";
    await sendText(bot, message.chat.id, `${intro}${store.name}\n\n${content}${orderInstructions}`);
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
    const match = /^\/order(?:@\w+)?\s+([a-f0-9]{12})(?:\s+(\d+))?\s*$/i.exec(text.trim());
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

    const [selected] = await db
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
          sql`substring(replace(${productsTable.id},'-','') from 1 for 12)=${productCode}`,
        ),
      )
      .orderBy(asc(productsTable.createdAt), asc(productsTable.id))
      .limit(1);
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
      await enqueueGrowthEvent(tx, { storeId, telegramUserId: String(message.from!.id), trigger: "ORDER_CREATED", eventId: orderId, orderId, orderValue: Number(lineTotal) });
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
    const success=`تم تسجيل طلبك رقم ${orderId.slice(0, 8)} بانتظار تأكيد المتجر.\nالإجمالي: ${result.order.total} ${store.currency}\nلم يتم استلام الدفع عبر LootBot.${store.manualPaymentInstructions?.trim() ? `\n\nتعليمات الدفع خارج التطبيق:\n${store.manualPaymentInstructions.trim()}` : "\n\nرتّب الدفع خارج التطبيق بالتواصل مع المتجر."}`;
    if(context)await context.send(success,[[{text:'عرض الطلب',callback_data:`lb:order:${orderId}:1`}],...navigationFooter()],'success');else await sendText(bot,message.chat.id,success);
    return;
  }

  const helpText = command === "/start"
    ? (designer.welcomeMessage
      ? formatMessage(designer.welcomeMessage)
      : `أهلًا بك في ${store.name}.\nاستخدم /catalog لاستعراض المنتجات أو /help للمساعدة.`)
    : (designer.helpMessage
      ? formatMessage(designer.helpMessage)
      : `أوامر ${store.name}:\n/start — بدء المحادثة\n/catalog — استعراض المنتجات\n/order رمز_المنتج الكمية — تسجيل طلب\n/help — عرض المساعدة`);
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
  tokenHash?: string,
  encryptedToken?: string,
): Promise<void> {
  const safeMessage =
    code === 409
      ? 'يوجد استقبال آخر أو Webhook للبوت. أوقف الخدمة الأخرى قبل استئناف الاتصال.'
      : code === 403
      ? "البوت محظور أو لا يملك الإذن المطلوب."
      : "تعذر الاتصال بالبوت.";
  const saved = await db
    .update(telegramBotsTable)
    .set({ status: "error", lastError: safeMessage, updatedAt: new Date() })
    .where(and(eq(telegramBotsTable.storeId, storeId),ne(telegramBotsTable.status,'disconnected'),sql`exists(select 1 from ${storesTable} where ${storesTable.id}=${storeId} and ${storesTable.isDeleted}=false)`, ...(tokenHash ? [eq(telegramBotsTable.tokenHash, tokenHash)] : []), ...(encryptedToken?[eq(telegramBotsTable.encryptedToken,encryptedToken)]:[]))).returning({storeId:telegramBotsTable.storeId});
  if (!saved.length) return;
  await db
    .update(storesTable)
    .set({ botStatus: "error", updatedAt: new Date() })
    .where(and(eq(storesTable.id, storeId), eq(storesTable.isDeleted,false), sql`exists(select 1 from ${telegramBotsTable} where ${telegramBotsTable.storeId}=${storeId} and ${telegramBotsTable.status}='error' ${tokenHash?sql`and ${telegramBotsTable.tokenHash}=${tokenHash}`:sql``})`));
  logger.warn(
    { storeId, telegramCode: code, errorType: message },
    "Telegram bot connection reported an error.",
  );
}

async function poll(storeId: string, bot: ActiveBot): Promise<void> {
  let lastHealthWrite = 0;
  while (!bot.controller.signal.aborted) {
    try {
      const updates = await telegramCall<TelegramUpdate[]>(
        bot.token,
        `getUpdates?timeout=20&allowed_updates=%5B%22message%22%2C%22callback_query%22%5D&offset=${bot.nextOffset}`,
        undefined,
        AbortSignal.any([
          bot.controller.signal,
          AbortSignal.timeout(25_000),
        ]),
      );
      if (bot.controller.signal.aborted) return;
      if (Date.now() - lastHealthWrite >= 60_000) {
        await withBotConnectionChange(storeId,async()=>{
        if(bot.controller.signal.aborted||activeByStore.get(storeId)!==bot)return;
        await db.update(telegramBotsTable).set({ lastSuccessfulPollAt: new Date(), status: "connected", lastError: null })
          .where(and(eq(telegramBotsTable.storeId, storeId), eq(telegramBotsTable.tokenHash, bot.tokenHash),ne(telegramBotsTable.status,'disconnected'),sql`exists(select 1 from ${storesTable} where ${storesTable.id}=${storeId} and ${storesTable.isDeleted}=false)`));
        await db.update(storesTable).set({ botStatus: "connected" }).where(and(eq(storesTable.id, storeId),eq(storesTable.isDeleted,false),sql`exists(select 1 from ${telegramBotsTable} where ${telegramBotsTable.storeId}=${storeId} and ${telegramBotsTable.tokenHash}=${bot.tokenHash} and ${telegramBotsTable.status}='connected')`));
        lastHealthWrite = Date.now();
        });
      }
      for (const update of updates) {
        if (bot.controller.signal.aborted) return;
        bot.nextOffset = Math.max(bot.nextOffset, update.update_id + 1);
        await withBotConnectionChange(storeId,async()=>{
        if(bot.controller.signal.aborted||activeByStore.get(storeId)!==bot)return;
        try {
          await handleTelegramUpdate(storeId, bot, update);
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
          const chatId = update.callback_query?.message?.chat.id ?? update.message?.chat.id;
          if (chatId !== undefined) {
            await sendText(bot, chatId, "تعذر إكمال الطلب الآن. أرسل /start للمحاولة مجددًا.").catch(() => undefined);
          }
        }
        if (bot.controller.signal.aborted) return;
        await db
          .update(telegramBotsTable)
          .set({
            lastUpdateId: String(bot.nextOffset),
            updatedAt: new Date(),
          })
          .where(and(eq(telegramBotsTable.storeId, storeId),eq(telegramBotsTable.tokenHash,bot.tokenHash),ne(telegramBotsTable.status,'disconnected'),sql`exists(select 1 from ${storesTable} where ${storesTable.id}=${storeId} and ${storesTable.isDeleted}=false)`));
        });
      }
    } catch (error) {
      if (bot.controller.signal.aborted) return;
      const telegramCode =
        error instanceof TelegramFailure ? error.telegramCode : undefined;
      await withBotConnectionChange(storeId,async()=>{
      if(bot.controller.signal.aborted||activeByStore.get(storeId)!==bot)return;
      await recordBotError(
        storeId,
        error instanceof Error ? error.name : "UnknownError",
        telegramCode,
        bot.tokenHash,
      );
      });
      await pause(5_000, bot.controller.signal);
    }
  }
}

export function startBotForStore(input: {
  storeId: string;
  token: string;
  lastUpdateId?: string | null;
}): void {
  if(draining)throw new TelegramFailure('Bot reception is shutting down',undefined,true);
  const tokenHash = sha256(input.token);
  assertBotTokenAvailable(input.storeId,input.token);
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

export function stopAllBots(options: { shutdown?: boolean } = {}): void {
  if(options.shutdown)draining=true;
  lifecycleVersion++;
  for (const storeId of activeByStore.keys()) {
    stopBotForStore(storeId);
  }
}

export async function startActiveStoreBots(storeIds?: readonly string[]): Promise<void> {
  if(storeIds?.length===0)return;
  const version=lifecycleVersion;
  const active = await db
    .select({
      storeId: telegramBotsTable.storeId,
      encryptedToken: telegramBotsTable.encryptedToken,
      lastUpdateId: telegramBotsTable.lastUpdateId,
      tokenHash: telegramBotsTable.tokenHash,
    })
    .from(telegramBotsTable)
    .innerJoin(storesTable, eq(storesTable.id, telegramBotsTable.storeId))
    .where(
      and(
        eq(storesTable.isDeleted, false),
        eq(telegramBotsTable.status, "connected"),
        ...(storeIds?[inArray(telegramBotsTable.storeId,[...storeIds])]:[]),
      ),
    );

  for (const record of active) {
    await withBotConnectionChange(record.storeId,async () => {
    if(draining||version!==lifecycleVersion)return;
    const [current] = await db.select({encryptedToken:telegramBotsTable.encryptedToken,tokenHash:telegramBotsTable.tokenHash,status:telegramBotsTable.status,lastUpdateId:telegramBotsTable.lastUpdateId}).from(telegramBotsTable).innerJoin(storesTable,eq(storesTable.id,telegramBotsTable.storeId)).where(and(eq(telegramBotsTable.storeId,record.storeId),eq(storesTable.isDeleted,false))).limit(1);
    if (!current || current.status!=='connected' || current.encryptedToken!==record.encryptedToken || current.tokenHash!==record.tokenHash) return;
    try {
      const token = decryptBotToken(record.encryptedToken);
      const { webhookUrl } = await validateTelegramBotToken(token);
      if(draining||version!==lifecycleVersion)return;
      if (webhookUrl) {
        await recordBotError(record.storeId, "Webhook configured", 409,record.tokenHash,record.encryptedToken);
        return;
      }
      startBotForStore({
        storeId: record.storeId,
        token,
        lastUpdateId: current.lastUpdateId,
      });
    } catch (error) {
      if(draining||version!==lifecycleVersion)return;
      await recordBotError(
        record.storeId,
        error instanceof Error ? error.name : "UnknownError",
        error instanceof TelegramFailure ? error.telegramCode : undefined,
        record.tokenHash,
        record.encryptedToken,
      );
    }
    });
  }
  logger.info({ count: active.length }, "Loaded active Telegram bots.");
}
