import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { categoriesTable, db, orderItemsTable, ordersTable, productsTable } from "@workspace/db";
import { createSearchContexts, navigationFooter, paginationButtons, type BotButton, type NavigationAction } from "./telegram-navigation";
import { type ScreenStyleMap } from './telegram-presentation';
import { commerceAvailability, commerceHome } from './customer-commerce';

const searchContexts = createSearchContexts();
const searchQueries = createSearchContexts();
const productParents = createSearchContexts();
const PAGE_SIZE = 6;
const orderStatus: Record<string, string> = { pending: "قيد الانتظار", confirmed: "مؤكد", fulfilled: "مكتمل", processing: "قيد التجهيز", completed: "مكتمل", cancelled: "ملغي", shipped: "تم الشحن", delivered: "تم التسليم" };
const paymentStatus: Record<string, string> = { unpaid: "غير مدفوع", paid: "مدفوع", refunded: "مسترد", pending: "قيد الانتظار" };
export type ScreenContext = {
  storeId: string; storeName: string; currency: string; chatId: number; privateChat: boolean;
  userId: number; customerName: string;
  styles?:ScreenStyleMap;
  send: (text: string, buttons: BotButton[][], screen?: string, media?:string[]) => Promise<void>;
  product: (code: string, parent: string, galleryIndex?: number) => Promise<void>;
};

export function captureSearchMessage(context: ScreenContext, text: string): string | null {
  const command = /^\/search(?:@\w+)?\s+(.+)$/s.exec(text.trim());
  if (command) return command[1].trim().slice(0, 120);
  if (!text.startsWith("/") && searchContexts.get(context.storeId, context.userId, context.chatId) === "") return text.trim().slice(0, 120);
  return null;
}

export function clearPendingSearch(context: ScreenContext): void {
  if (searchContexts.get(context.storeId, context.userId, context.chatId) === "") searchContexts.clear(context.storeId, context.userId, context.chatId);
}

export function rememberProductParent(context: Pick<ScreenContext, "storeId" | "userId" | "chatId">, parent: string): string {
  const ref = randomBytes(6).toString("hex");
  productParents.set(`${context.storeId}:${ref}`, context.userId, context.chatId, parent); return ref;
}

export function resolveProductParent(context: Pick<ScreenContext, "storeId" | "userId" | "chatId">, ref?: string): string {
  if (!ref || !/^[a-f0-9]{12}$/.test(ref)) return 'lb:home';
  return productParents.get(`${context.storeId}:${ref}`, context.userId, context.chatId) || 'lb:home';
}

export async function renderStoreScreen(context: ScreenContext, action: NavigationAction, searchText?: string): Promise<void> {
  const { storeId, userId, chatId } = context;
  const send = (text: string, buttons: BotButton[][], screen: string = action.kind) => context.send(text, buttons, screen);
  if (action.kind === "searchClear") {
    searchContexts.set(storeId, userId, chatId, "");
    await send("🔎 تم مسح البحث. اكتب كلمة بحث جديدة.", navigationFooter()); return;
  }
  if (action.kind === "product" || action.kind === "gallery") {
    await context.product(action.code, action.parentRef ? resolveProductParent(context, action.parentRef) : "lb:products:1", action.kind === "gallery" ? action.index : 0); return;
  }
  if (action.kind === "close") { await send("تم إغلاق القائمة. أرسل /start للعودة إلى المتجر.", []); return; }
  if (action.kind === "categories") {
    const rows = await db.select().from(categoriesTable).where(and(eq(categoriesTable.storeId, storeId), eq(categoriesTable.isDeleted, false)))
      .orderBy(asc(categoriesTable.createdAt), asc(categoriesTable.id)).limit(PAGE_SIZE + 1).offset((action.page - 1) * PAGE_SIZE);
    const style=context.styles?.categories;const items=rows.slice(0,PAGE_SIZE);const variant=style?.variant;
    const content=items.map(row=>`${variant==='emoji-grid'?(row.emoji||'📂')+' ':''}${row.name}`).join(variant==='compact'?' · ':variant==='emoji-grid'?'   ':'\n');
    await context.send(rows.length ? `📂 تصنيفات ${context.storeName}\nالصفحة ${action.page}\n\n${content}` : "لا توجد تصنيفات متاحة الآن.", [
      ...items.map(row => [{ text: `${variant==='emoji-grid'?row.emoji+' ':''}${row.name}`.slice(0, 60), callback_data: `lb:category:${row.id}:1:${action.page}` }]),
      ...paginationButtons("lb:categories", action.page, rows.length > PAGE_SIZE), ...navigationFooter("lb:home", `lb:categories:${action.page}`),
    ], rows.length ? 'categories' : 'empty',variant==='image-grid'?items.filter(r=>r.imageUrl).map(r=>r.imageUrl!):undefined); return;
  }
  if (action.kind === "products" || action.kind === "offers" || action.kind === "category" || action.kind === "search") {
    const filters = [eq(productsTable.storeId, storeId), eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true)];
    let title = "🛍 المنتجات"; let prefix = "lb:products"; let parent = "lb:home"; let suffix = "";
    if (action.kind === 'offers') { filters.push(sql`${productsTable.oldPrice}>${productsTable.price}`); title = '🔥 عروض المتجر'; prefix = 'lb:offers'; }
    if (action.kind === "category") {
      const [category] = await db.select({ name: categoriesTable.name }).from(categoriesTable).where(and(eq(categoriesTable.id, action.id), eq(categoriesTable.storeId, storeId), eq(categoriesTable.isDeleted, false))).limit(1);
      parent = `lb:categories:${action.parentPage ?? 1}`;
      if (!category) { await send("هذا التصنيف لم يعد متاحًا.", navigationFooter(parent),'error'); return; }
      filters.push(eq(productsTable.categoryId, action.id)); title = `📂 ${category.name}`; prefix = `lb:category:${action.id}`; suffix = `:${action.parentPage ?? 1}`;
    }
    if (action.kind === "search") {
      if (searchText !== undefined) searchContexts.set(storeId, userId, chatId, searchText);
      const query = action.queryRef ? searchQueries.get(`${storeId}:${action.queryRef}`, userId, chatId) : searchContexts.get(storeId, userId, chatId);
      if (!query) {
        searchContexts.set(storeId, userId, chatId, "");
        await send("🔎 اكتب اسم المنتج أو أرسل /search كلمة_البحث. ينتهي سياق البحث بعد 15 دقيقة.", navigationFooter()); return;
      }
      const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      filters.push(or(ilike(productsTable.name, pattern), ilike(productsTable.description, pattern), ilike(productsTable.sku, pattern))!);
      title = `🔎 نتائج البحث: ${query}`; prefix = "lb:search";
      const queryRef = action.queryRef ?? randomBytes(6).toString("hex");
      searchQueries.set(`${storeId}:${queryRef}`, userId, chatId, query); suffix = `:${queryRef}`;
    }
    const rows = await db.select().from(productsTable).where(and(...filters)).orderBy(asc(productsTable.createdAt), asc(productsTable.id))
      .limit(PAGE_SIZE + 1).offset((action.page - 1) * PAGE_SIZE);
    const parentRef = rememberProductParent(context, `${prefix}:${action.page}${suffix}`);
    const items = rows.slice(0, PAGE_SIZE);
    const style=context.styles?.[action.kind==='category'?'products':action.kind];
    const offer=action.kind==='offers';const variant=style?.variant;
    const text = items.length ? `${title}\nالصفحة ${action.page}\n\n${items.map(row => `${offer&&variant==='flash-offer'?'⚡ عرض متاح حاليًا\n':''}${row.name.slice(0, 120)} — ${Number(row.price).toFixed(2)} ${context.currency}${offer?`\nسابقًا: ${row.oldPrice} · خصم ${Math.round((1-Number(row.price)/Number(row.oldPrice))*100)}%`:''}${offer&&variant==='featured-product'?`\n${row.description.slice(0,200)}`:''}`).join(variant==='compact'?' · ':"\n\n")}` : `${title}\nلا توجد منتجات مطابقة الآن.`;
    await context.send(text, [...items.map(row => [{ text: row.name.slice(0, 60), callback_data: `lb:product:${row.id.replaceAll("-", "").slice(0, 12)}:${parentRef}` }]),
      ...paginationButtons(prefix, action.page, rows.length > PAGE_SIZE, suffix),
      ...(action.kind === "search" ? [[{ text: "🔎 بحث جديد", callback_data: "lb:search:clear" }]] : []),
      ...navigationFooter(parent, `${prefix}:${action.page}${suffix}`)], items.length ? action.kind === 'category' ? 'products' : action.kind : 'empty',offer&&['banner','featured-product'].includes(variant??'')?items.filter(p=>p.imageUrl).slice(0,variant==='banner'?1:3).map(p=>p.imageUrl!):undefined); return;
  }
  if (action.kind === "orders" || action.kind === "order" || action.kind === "account") {
    if (!context.privateChat) { await send("افتح محادثة خاصة مع البوت لعرض بيانات حسابك وطلباتك.", navigationFooter()); return; }
    const filters = [eq(ordersTable.storeId, storeId), eq(ordersTable.telegramUserId, String(userId))];
    if (action.kind === "order") {
      const [order] = await db.select().from(ordersTable).where(and(...filters, eq(ordersTable.id, action.id))).limit(1);
      const parent = `lb:orders:${action.parentPage ?? 1}`;
      if (!order) { await send("الطلب غير متاح لهذا الحساب.", navigationFooter(parent),'error'); return; }
      const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id)).limit(30);
      const available=await commerceAvailability(storeId);
      const current = `lb:order:${order.id}:${action.parentPage ?? 1}`;
      const supportParent = available.support ? rememberProductParent(context, current) : undefined;
      await send(`📦 طلب ${order.id.slice(0, 8)}\nالحالة: ${orderStatus[order.status] ?? order.status}\nالدفع: ${paymentStatus[order.paymentStatus] ?? order.paymentStatus}\nالتاريخ: ${order.createdAt.toISOString().slice(0, 10)}\nالإجمالي: ${order.total} ${order.currency}\n\n${items.map(item => `${item.productName.slice(0, 100)} × ${item.quantity}`).join("\n")}`, [...(available.support?[[{text:'💬 دعم الطلب',callback_data:`lb:commerce:support:${supportParent}`}]]:[]),...navigationFooter(parent, current)]); return;
    }
    if (action.kind === "account") {
      const available = await commerceAvailability(storeId);
      const accountParent = rememberProductParent(context, 'lb:account');
      const commerce = (await commerceHome(storeId)).map(row => row.map(button => ({ ...button, ...(button.callback_data ? { callback_data: `${button.callback_data}:${accountParent}` } : {}) })));
      await send(`👤 حسابي\nالاسم: ${context.customerName}\nمعرّف Telegram: ${userId}\nالمتجر: ${context.storeName}`, [
        [{ text: "📦 طلباتي", callback_data: "lb:orders:1" }], ...(available.notifications ? [[{ text: '🔔 إشعاراتي', callback_data: `lb:commerce:notifications:${accountParent}` }]] : []), ...commerce, ...navigationFooter("lb:home", "lb:account"),
      ]); return;
    }
    const rows = await db.select().from(ordersTable).where(and(...filters)).orderBy(desc(ordersTable.createdAt), desc(ordersTable.id))
      .limit(PAGE_SIZE + 1).offset((action.page - 1) * PAGE_SIZE);
    await send(rows.length ? `📦 طلباتي — الصفحة ${action.page}` : "لم تسجل طلبات في هذا المتجر بعد.", [
      ...rows.slice(0, PAGE_SIZE).map(order => [{ text: `${order.id.slice(0, 8)} · ${order.total} ${order.currency} · ${orderStatus[order.status] ?? order.status}`, callback_data: `lb:order:${order.id}:${action.page}` }]),
      ...paginationButtons("lb:orders", action.page, rows.length > PAGE_SIZE), ...navigationFooter("lb:home", `lb:orders:${action.page}`),
    ],rows.length?'orders':'empty');
  }
}
