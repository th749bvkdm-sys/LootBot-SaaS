import { isTelegramTheme, parseScreenStyles, themedText, type TelegramTheme, type ScreenStyleMap } from './telegram-presentation.ts';
export const HOME_COMMERCE_ACTIONS = ['cart', 'favorites', 'points', 'referrals', 'coupons', 'support', 'notifications'] as const;
export const HOME_ACTIONS = ["products", "categories", "search", "orders", "account", "offers", ...HOME_COMMERCE_ACTIONS] as const;
export const HOME_REQUIRED_ACTIONS = ['products', 'categories', 'search', 'orders', 'account'] as const;
import { PRODUCT_CARD_STYLES, type ProductCardStyle } from './telegram-product-card.ts';
export const HOME_LAYOUTS = ['grid-2','grid-3','vertical','compact','sections','featured-first','categories-first','offers-first','custom-order'] as const;
export type HomeAction = typeof HOME_ACTIONS[number];
export type HomeConfiguration = {
  version: 1; welcomeMessage: string; columns: 1 | 2 | 3; showEmoji: boolean;
  headerTitle?: string; headerSubtitle?: string; footer?: string;
  theme?: TelegramTheme; screenStyles?: ScreenStyleMap; bannerUrl?: string;
  layout?: typeof HOME_LAYOUTS[number]; productCardStyle?: ProductCardStyle; announcement?: string; customerGreeting?: boolean;
  buttons: { action: HomeAction; title: string; emoji: string; enabled: boolean }[];
};
export const DEFAULT_HOME_CONFIGURATION: HomeConfiguration = {
  version: 1, welcomeMessage: "أهلًا {{customer}} في {{store}}.\nاختر من قائمة المتجر:", columns: 2, showEmoji: true,
  buttons: [
    { action: "offers", title: "العروض", emoji: "🔥", enabled: true },
    { action: "products", title: "المنتجات", emoji: "🛍", enabled: true },
    { action: "categories", title: "التصنيفات", emoji: "📂", enabled: true },
    { action: "search", title: "البحث", emoji: "🔎", enabled: true },
    { action: "orders", title: "طلباتي", emoji: "📦", enabled: true },
    { action: "account", title: "حسابي", emoji: "👤", enabled: true },
  ],
};
export function parseHomeConfiguration(value: unknown): HomeConfiguration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if ((body.layout !== undefined && !HOME_LAYOUTS.includes(body.layout as typeof HOME_LAYOUTS[number])) || (body.productCardStyle !== undefined && !PRODUCT_CARD_STYLES.includes(body.productCardStyle as ProductCardStyle)) || (body.announcement !== undefined && (typeof body.announcement !== 'string'||body.announcement.length>500)) || (body.customerGreeting !== undefined&&typeof body.customerGreeting!=='boolean')) return null;
  if (body.theme !== undefined && !isTelegramTheme(body.theme)) return null;
  const screenStyles = body.screenStyles === undefined ? undefined : parseScreenStyles(body.screenStyles);
  if (screenStyles === null) return null;
  if (body.bannerUrl !== undefined) {
    if (typeof body.bannerUrl !== 'string') return null;
    if (body.bannerUrl) { try { const url = new URL(body.bannerUrl); if (url.protocol !== 'https:' || url.username || url.password || body.bannerUrl.length > 1500) return null; } catch { return null; } }
  }
  for (const [key, limit] of [["headerTitle", 100], ["headerSubtitle", 200], ["footer", 200]] as const) {
    if (body[key] !== undefined && (typeof body[key] !== "string" || (body[key] as string).length > limit)) return null;
  }
  if (body.version !== 1 || typeof body.welcomeMessage !== "string" || !body.welcomeMessage.trim() || body.welcomeMessage.length > 800 ||
      ![1, 2, 3].includes(body.columns as number) || typeof body.showEmoji !== "boolean" || !Array.isArray(body.buttons) || (body.buttons.length < 5 || body.buttons.length > HOME_ACTIONS.length)) return null;
  const buttons: HomeConfiguration["buttons"] = [];
  for (const raw of body.buttons) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (!HOME_ACTIONS.includes(item.action as HomeAction) || typeof item.title !== "string" || !item.title.trim() || item.title.length > 40 ||
        typeof item.emoji !== "string" || item.emoji.length > 16 || typeof item.enabled !== "boolean") return null;
    buttons.push({ action: item.action as HomeAction, title: item.title.trim(), emoji: item.emoji.trim(), enabled: item.enabled });
  }
  if (new Set(buttons.map(button => button.action)).size !== buttons.length || HOME_REQUIRED_ACTIONS.some(action => !buttons.some(b => b.action === action)) || !buttons.some(button => button.enabled)) return null;
  return { version: 1, welcomeMessage: body.welcomeMessage.trim(), columns: body.columns as 1 | 2 | 3, showEmoji: body.showEmoji, buttons,
    ...(body.headerTitle !== undefined ? { headerTitle: (body.headerTitle as string).trim() } : {}),
    ...(body.headerSubtitle !== undefined ? { headerSubtitle: (body.headerSubtitle as string).trim() } : {}),
    ...(body.footer !== undefined ? { footer: (body.footer as string).trim() } : {}),
    ...(body.theme !== undefined ? { theme: body.theme as TelegramTheme } : {}), ...(screenStyles ? { screenStyles } : {}),
    ...(body.bannerUrl !== undefined ? { bannerUrl: body.bannerUrl as string } : {}),
    ...(body.layout !== undefined ? {layout:body.layout as typeof HOME_LAYOUTS[number]}:{}), ...(body.productCardStyle !== undefined?{productCardStyle:body.productCardStyle as ProductCardStyle}:{}), ...(body.announcement !== undefined?{announcement:body.announcement as string}:{}), ...(body.customerGreeting !== undefined?{customerGreeting:body.customerGreeting as boolean}:{}),
  };
}
export function renderConfiguredHome(configuration: HomeConfiguration, storeName: string, customerName: string) {
  const sourceButtons = configuration.buttons.filter(button => button.enabled);
  const first = configuration.layout==='categories-first'?'categories':configuration.layout==='offers-first'?'offers':configuration.layout==='featured-first'?'products':null;
  if (first) sourceButtons.sort((a,b)=>Number(b.action===first)-Number(a.action===first));
  const buttons = sourceButtons.map(button => ({
    text: `${configuration.showEmoji && button.emoji ? button.emoji + " " : ""}${button.title}`,
    callback_data: homeActionCallback(button.action),
  }));
  const keyboard: typeof buttons[] = [];
  const columns = configuration.layout==='grid-2'?2:configuration.layout==='grid-3'?3:['vertical','compact','sections'].includes(configuration.layout??'')?1:configuration.columns;
  for (let index = 0; index < buttons.length; index += columns) keyboard.push(buttons.slice(index, index + columns));
  return {
    text: themedText(configuration.theme, configuration.headerTitle ?? (configuration.theme?storeName:''), [configuration.headerSubtitle, configuration.welcomeMessage, configuration.announcement, configuration.footer].filter(Boolean).join(configuration.layout==='compact'?'\n':'\n\n'))
      .replace(/\{\{(?:store|customer)\}\}/g, token => token === "{{store}}" ? storeName : configuration.customerGreeting===false?'':customerName.slice(0, 80)).slice(0, 3900),
    keyboard,
    ...(configuration.bannerUrl ? { imageUrl: configuration.bannerUrl } : {}),
  };
}
export function homeActionCallback(action: HomeAction) {
  return (HOME_COMMERCE_ACTIONS as readonly string[]).includes(action) ? `lb:commerce:${action}` : action === 'account' ? 'lb:account' : `lb:${action}:1`;
}
export function availableHomeConfiguration(configuration: HomeConfiguration, availability: Record<string, boolean>) {
  return { ...configuration, buttons: configuration.buttons.map(button => (HOME_COMMERCE_ACTIONS as readonly string[]).includes(button.action) && availability[button.action] !== true ? { ...button, enabled: false } : button) };
}
export function appendHomeCommerce(keyboard: { text: string; callback_data: string }[][], configuration: HomeConfiguration, extras: { text: string; callback_data: string }[][]) {
  const configured = new Set(configuration.buttons.map(button => homeActionCallback(button.action)));
  const used = new Set(keyboard.flat().map(button => button.callback_data));
  const additional = extras.map(row => row.filter(button => { if (configured.has(button.callback_data) || used.has(button.callback_data)) return false; used.add(button.callback_data); return true; })).filter(row => row.length);
  return [...keyboard, ...additional];
}
export function readHomeStudio(value: unknown): { draft: HomeConfiguration; published: HomeConfiguration | null; revision: number } {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    draft: parseHomeConfiguration(item.draft) ?? structuredClone(DEFAULT_HOME_CONFIGURATION),
    published: parseHomeConfiguration(item.published),
    revision: typeof item.revision === "number" && Number.isSafeInteger(item.revision) && item.revision >= 0 ? item.revision : 0,
  };
}
