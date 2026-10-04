export type NavigationAction =
  | { kind: "home" } | { kind: "account" } | { kind: "close" } | { kind: "searchClear" }
  | { kind: "products"; page: number } | { kind: "categories"; page: number } | { kind: "orders"; page: number }
  | { kind: "category"; id: string; page: number; parentPage?: number }
  | { kind: "product"; code: string; parentRef?: string }
  | { kind: "gallery"; code: string; index: number; parentRef: string }
  | { kind: "buy"; code: string }
  | { kind: "order"; id: string; parentPage?: number }
  | { kind: "search"; page: number; queryRef?: string };

export type BotButton = { text: string; callback_data: string };
export function parseNavigationCallback(value: unknown): NavigationAction | null {
  if (typeof value !== "string" || Buffer.byteLength(value) > 64) return null;
  if (value === "lb:home") return { kind: "home" };
  if (value === "lb:account") return { kind: "account" };
  if (value === "lb:close") return { kind: "close" };
  if (value === "lb:search:clear") return { kind: "searchClear" };
  const search = /^lb:search:(\d{1,5}):([a-f0-9]{12})$/i.exec(value);
  if (search && Number(search[1]) >= 1) return { kind: "search", page: Number(search[1]), queryRef: search[2].toLowerCase() };
  const page = /^lb:(products|categories|orders|search):(\d{1,5})$/.exec(value);
  if (page && Number(page[2]) >= 1) return { kind: page[1] as "products" | "categories" | "orders" | "search", page: Number(page[2]) };
  const category = /^lb:category:([a-f0-9-]{36}):(\d{1,5})(?::(\d{1,5}))?$/i.exec(value);
  if (category && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(category[1]) && Number(category[2]) >= 1 && (!category[3] || Number(category[3]) >= 1)) return { kind: "category", id: category[1], page: Number(category[2]), ...(category[3] ? { parentPage: Number(category[3]) } : {}) };
  const product = /^lb:product:([a-f0-9]{12})(?::([a-f0-9]{12}))?$/i.exec(value);
  if (product) return { kind: "product", code: product[1].toLowerCase(), ...(product[2] ? { parentRef: product[2] } : {}) };
  const gallery = /^lb:gallery:([a-f0-9]{12}):([0-9]):([a-f0-9]{12})$/i.exec(value);
  if (gallery) return { kind: "gallery", code: gallery[1].toLowerCase(), index: Number(gallery[2]), parentRef: gallery[3].toLowerCase() };
  const buy = /^lb:buy:([a-f0-9]{12})$/i.exec(value);
  if (buy) return { kind: "buy", code: buy[1].toLowerCase() };
  const order = /^lb:order:([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?::(\d{1,5}))?$/i.exec(value);
  return order && (!order[2] || Number(order[2]) >= 1) ? { kind: "order", id: order[1], ...(order[2] ? { parentPage: Number(order[2]) } : {}) } : null;
}

export function defaultHomeKeyboard(): BotButton[][] {
  return [
    [{ text: "🛍 المنتجات", callback_data: "lb:products:1" }, { text: "📂 التصنيفات", callback_data: "lb:categories:1" }],
    [{ text: "🔎 البحث", callback_data: "lb:search:1" }, { text: "📦 طلباتي", callback_data: "lb:orders:1" }],
    [{ text: "👤 حسابي", callback_data: "lb:account" }],
  ];
}

export function navigationFooter(parent = "lb:home", current?: string): BotButton[][] {
  return [[{ text: "↩️ رجوع", callback_data: parent }, { text: "🏠 الرئيسية", callback_data: "lb:home" }],
    ...(current ? [[{ text: "🔄 تحديث", callback_data: current }, { text: "✖ إغلاق", callback_data: "lb:close" }]] : [])];
}

export function paginationButtons(prefix: string, page: number, hasNext: boolean, suffix = ""): BotButton[][] {
  const row: BotButton[] = [];
  if (page > 1) row.push({ text: "◀️ السابق", callback_data: `${prefix}:${page - 1}${suffix}` });
  if (hasNext && page < 99999) row.push({ text: "التالي ▶️", callback_data: `${prefix}:${page + 1}${suffix}` });
  return row.length ? [row] : [];
}

// Search is conversational state, never shared across stores, users or chats.
export function createSearchContexts(now: () => number = Date.now) {
  const contexts = new Map<string, { query: string; expiresAt: number }>();
  const key = (storeId: string, userId: number, chatId: number) => `${storeId}:${userId}:${chatId}`;
  return {
    set(storeId: string, userId: number, chatId: number, query: string) {
      if (contexts.size >= 10_000) {
        for (const [id, context] of contexts) if (context.expiresAt <= now()) contexts.delete(id);
        if (contexts.size >= 10_000) contexts.delete(contexts.keys().next().value!);
      }
      contexts.set(key(storeId, userId, chatId), { query: query.slice(0, 120), expiresAt: now() + 15 * 60_000 });
    },
    get(storeId: string, userId: number, chatId: number): string | null {
      const id = key(storeId, userId, chatId); const context = contexts.get(id);
      if (!context || context.expiresAt <= now()) { contexts.delete(id); return null; }
      return context.query;
    },
    clear(storeId: string, userId: number, chatId: number) { contexts.delete(key(storeId, userId, chatId)); },
  };
}
