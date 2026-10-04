export const HOME_ACTIONS = ["products", "categories", "search", "orders", "account"] as const;
type HomeAction = typeof HOME_ACTIONS[number];
export type HomeConfiguration = {
  version: 1; welcomeMessage: string; columns: 1 | 2 | 3; showEmoji: boolean;
  headerTitle?: string; headerSubtitle?: string; footer?: string;
  buttons: { action: HomeAction; title: string; emoji: string; enabled: boolean }[];
};
export const DEFAULT_HOME_CONFIGURATION: HomeConfiguration = {
  version: 1, welcomeMessage: "أهلًا {{customer}} في {{store}}.\nاختر من قائمة المتجر:", columns: 2, showEmoji: true,
  buttons: [
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
  for (const [key, limit] of [["headerTitle", 100], ["headerSubtitle", 200], ["footer", 200]] as const) {
    if (body[key] !== undefined && (typeof body[key] !== "string" || (body[key] as string).length > limit)) return null;
  }
  if (body.version !== 1 || typeof body.welcomeMessage !== "string" || !body.welcomeMessage.trim() || body.welcomeMessage.length > 800 ||
      ![1, 2, 3].includes(body.columns as number) || typeof body.showEmoji !== "boolean" || !Array.isArray(body.buttons) || body.buttons.length !== HOME_ACTIONS.length) return null;
  const buttons: HomeConfiguration["buttons"] = [];
  for (const raw of body.buttons) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (!HOME_ACTIONS.includes(item.action as HomeAction) || typeof item.title !== "string" || !item.title.trim() || item.title.length > 40 ||
        typeof item.emoji !== "string" || item.emoji.length > 16 || typeof item.enabled !== "boolean") return null;
    buttons.push({ action: item.action as HomeAction, title: item.title.trim(), emoji: item.emoji.trim(), enabled: item.enabled });
  }
  if (new Set(buttons.map(button => button.action)).size !== HOME_ACTIONS.length || !buttons.some(button => button.enabled)) return null;
  return { version: 1, welcomeMessage: body.welcomeMessage.trim(), columns: body.columns as 1 | 2 | 3, showEmoji: body.showEmoji, buttons,
    ...(body.headerTitle !== undefined ? { headerTitle: (body.headerTitle as string).trim() } : {}),
    ...(body.headerSubtitle !== undefined ? { headerSubtitle: (body.headerSubtitle as string).trim() } : {}),
    ...(body.footer !== undefined ? { footer: (body.footer as string).trim() } : {}),
  };
}
export function renderConfiguredHome(configuration: HomeConfiguration, storeName: string, customerName: string) {
  const buttons = configuration.buttons.filter(button => button.enabled).map(button => ({
    text: `${configuration.showEmoji && button.emoji ? button.emoji + " " : ""}${button.title}`,
    callback_data: button.action === "account" ? "lb:account" : `lb:${button.action}:1`,
  }));
  const keyboard: typeof buttons[] = [];
  for (let index = 0; index < buttons.length; index += configuration.columns) keyboard.push(buttons.slice(index, index + configuration.columns));
  return {
    text: [configuration.headerTitle, configuration.headerSubtitle, configuration.welcomeMessage, configuration.footer].filter(Boolean).join("\n\n")
      .replace(/\{\{(?:store|customer)\}\}/g, token => token === "{{store}}" ? storeName : customerName.slice(0, 80)),
    keyboard,
  };
}
export function readHomeStudio(value: unknown): { draft: HomeConfiguration; published: HomeConfiguration | null; revision: number } {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    draft: parseHomeConfiguration(item.draft) ?? structuredClone(DEFAULT_HOME_CONFIGURATION),
    published: parseHomeConfiguration(item.published),
    revision: typeof item.revision === "number" && Number.isSafeInteger(item.revision) && item.revision >= 0 ? item.revision : 0,
  };
}
