export type BusinessAction = 'OPEN_SCREEN' | 'OPEN_PRODUCTS' | 'OPEN_CATEGORIES' | 'OPEN_SEARCH' | 'OPEN_ORDERS' | 'OPEN_ACCOUNT';
export type BusinessBlock = { id: string; type: 'TEXT' | 'HEADER' | 'FAQ' | 'DIVIDER'; text: string; enabled: boolean };
export type BusinessScreen = {
  id: string; parentId: string | null; title: string; enabled: boolean;
  audience: 'all' | 'new' | 'returning'; startsAt: string | null; endsAt: string | null;
  blocks: BusinessBlock[]; buttons: { id: string; title: string; action: BusinessAction; target: string | null; enabled: boolean }[];
};
export type BusinessConfiguration = { version: 1; columns: 1 | 2 | 3; screens: BusinessScreen[] };
export const BUSINESS_ACTIONS: BusinessAction[] = ['OPEN_SCREEN', 'OPEN_PRODUCTS', 'OPEN_CATEGORIES', 'OPEN_SEARCH', 'OPEN_ORDERS', 'OPEN_ACCOUNT'];
export const DEFAULT_BUSINESS_CONFIGURATION: BusinessConfiguration = {
  version: 1, columns: 2, screens: [{ id: 'home', parentId: null, title: '{{store}}', enabled: true, audience: 'all', startsAt: null, endsAt: null,
    blocks: [{ id: 'welcome', type: 'TEXT', text: 'أهلًا {{customer}}. اختر من قائمة المتجر:', enabled: true }],
    buttons: [
      { id: 'products', title: '🛍 المنتجات', action: 'OPEN_PRODUCTS', target: null, enabled: true },
      { id: 'categories', title: '📂 التصنيفات', action: 'OPEN_CATEGORIES', target: null, enabled: true },
      { id: 'search', title: '🔎 البحث', action: 'OPEN_SEARCH', target: null, enabled: true },
      { id: 'orders', title: '📦 طلباتي', action: 'OPEN_ORDERS', target: null, enabled: true },
      { id: 'account', title: '👤 حسابي', action: 'OPEN_ACCOUNT', target: null, enabled: true },
    ],
  }],
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_-]{0,23}$/.test(v);
const text = (v: unknown, max: number, empty = false): v is string => typeof v === 'string' && v.length <= max && (empty || !!v.trim());
const date = (v: unknown): v is string | null => v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);

export function parseBusinessConfiguration(value: unknown): BusinessConfiguration | null {
  if (!record(value) || value.version !== 1 || ![1, 2, 3].includes(value.columns as number) || !Array.isArray(value.screens) || !value.screens.length || value.screens.length > 30) return null;
  const screens: BusinessScreen[] = [];
  for (const raw of value.screens) {
    if (!record(raw) || !id(raw.id) || (raw.parentId !== null && !id(raw.parentId)) || !text(raw.title, 80) || typeof raw.enabled !== 'boolean' ||
      !['all', 'new', 'returning'].includes(raw.audience as string) || !date(raw.startsAt) || !date(raw.endsAt) ||
      (raw.startsAt && raw.endsAt && Date.parse(raw.startsAt) >= Date.parse(raw.endsAt)) ||
      !Array.isArray(raw.blocks) || raw.blocks.length > 12 || !Array.isArray(raw.buttons) || raw.buttons.length > 12) return null;
    const blocks: BusinessBlock[] = [];
    for (const block of raw.blocks) {
      if (!record(block) || !id(block.id) || !['TEXT', 'HEADER', 'FAQ', 'DIVIDER'].includes(block.type as string) || !text(block.text, 500, block.type === 'DIVIDER') || typeof block.enabled !== 'boolean') return null;
      blocks.push({ id: block.id, type: block.type as BusinessBlock['type'], text: block.text.trim(), enabled: block.enabled });
    }
    const buttons: BusinessScreen['buttons'] = [];
    for (const button of raw.buttons) {
      if (!record(button) || !id(button.id) || !text(button.title, 40) || !BUSINESS_ACTIONS.includes(button.action as BusinessAction) || typeof button.enabled !== 'boolean' ||
        (button.action === 'OPEN_SCREEN' ? !id(button.target) : button.target !== null)) return null;
      buttons.push({ id: button.id, title: button.title.trim(), action: button.action as BusinessAction, target: button.target as string | null, enabled: button.enabled });
    }
    if (new Set(blocks.map(b => b.id)).size !== blocks.length || new Set(buttons.map(b => b.id)).size !== buttons.length || blocks.reduce((sum, b) => sum + b.text.length, 0) > 3000) return null;
    screens.push({ id: raw.id, parentId: raw.parentId as string | null, title: raw.title.trim(), enabled: raw.enabled, audience: raw.audience as BusinessScreen['audience'], startsAt: raw.startsAt, endsAt: raw.endsAt, blocks, buttons });
  }
  const byId = new Map(screens.map(s => [s.id, s]));
  const home = byId.get('home');
  if (byId.size !== screens.length || !home || home.parentId !== null || !home.enabled || home.audience !== 'all' || home.startsAt || home.endsAt) return null;
  for (const screen of screens) {
    if (screen.id !== 'home' && (!screen.parentId || !byId.has(screen.parentId))) return null;
    const seen = new Set([screen.id]); let parent = screen.parentId; let depth = 0;
    while (parent) {
      if (seen.has(parent) || ++depth > 3) return null;
      seen.add(parent); parent = byId.get(parent)?.parentId ?? null;
    }
    if (screen.buttons.some(b => b.action === 'OPEN_SCREEN' && (!byId.has(b.target!) || (screen.enabled && b.enabled && !byId.get(b.target!)!.enabled)))) return null;
  }
  return { version: 1, columns: value.columns as 1 | 2 | 3, screens };
}
export type BusinessViewer = { storeName: string; customerName: string; returning: boolean; now: number };
export function visibleBusinessScreen(config: BusinessConfiguration, screen: BusinessScreen, viewer: BusinessViewer): boolean {
  const own = (s: BusinessScreen) => s.enabled && (s.audience === 'all' || (s.audience === 'returning') === viewer.returning) &&
    (!s.startsAt || Date.parse(s.startsAt) <= viewer.now) && (!s.endsAt || Date.parse(s.endsAt) > viewer.now);
  if (!own(screen)) return false;
  let parent = screen.parentId;
  while (parent) { const node = config.screens.find(s => s.id === parent); if (!node || !own(node)) return false; parent = node.parentId; }
  return true;
}
export function renderBusinessScreen(config: BusinessConfiguration, screenId: string, viewer: BusinessViewer) {
  const screen = config.screens.find(s => s.id === screenId);
  if (!screen || !visibleBusinessScreen(config, screen, viewer)) return null;
  const substitute = (value: string) => value.replace(/\{\{(?:store|customer)\}\}/g, token => token === '{{store}}' ? viewer.storeName : viewer.customerName.slice(0, 80));
  const buttons = screen.buttons.filter(b => b.enabled).flatMap(b => {
    if (b.action === 'OPEN_SCREEN') {
      const target = config.screens.find(s => s.id === b.target);
      return target && visibleBusinessScreen(config, target, viewer) ? [{ text: b.title, callback_data: `lb:screen:${b.target}` }] : [];
    }
    const actions = { OPEN_PRODUCTS: 'lb:products:1', OPEN_CATEGORIES: 'lb:categories:1', OPEN_SEARCH: 'lb:search:1', OPEN_ORDERS: 'lb:orders:1', OPEN_ACCOUNT: 'lb:account' };
    return [{ text: b.title, callback_data: actions[b.action] }];
  });
  for (const child of config.screens.filter(s => s.parentId === screen.id && visibleBusinessScreen(config, s, viewer))) {
    if (!buttons.some(b => b.callback_data === `lb:screen:${child.id}`)) buttons.push({ text: substitute(child.title).slice(0, 60), callback_data: `lb:screen:${child.id}` });
  }
  if (screen.id === 'home' && !buttons.length) {
    for (const button of DEFAULT_BUSINESS_CONFIGURATION.screens[0].buttons) {
      const fallback = { OPEN_PRODUCTS: 'lb:products:1', OPEN_CATEGORIES: 'lb:categories:1', OPEN_SEARCH: 'lb:search:1', OPEN_ORDERS: 'lb:orders:1', OPEN_ACCOUNT: 'lb:account' };
      if (button.action !== 'OPEN_SCREEN') buttons.push({ text: button.title, callback_data: fallback[button.action] });
    }
  }
  const keyboard: typeof buttons[] = [];
  for (let index = 0; index < buttons.length; index += config.columns) keyboard.push(buttons.slice(index, index + config.columns));
  if (screen.id !== 'home') keyboard.push([{ text: '↩️ رجوع', callback_data: `lb:screen:${screen.parentId}` }, { text: '🏠 الرئيسية', callback_data: 'lb:home' }]);
  keyboard.push([{ text: '🔄 تحديث', callback_data: `lb:screen:${screen.id}` }, { text: '✖ إغلاق', callback_data: 'lb:close' }]);
  return { text: substitute([screen.title, ...screen.blocks.filter(b => b.enabled).map(b => b.type === 'DIVIDER' ? '──────────' : b.type === 'HEADER' ? `◆ ${b.text}` : b.type === 'FAQ' ? `❓ ${b.text}` : b.text)].join('\n\n')).slice(0, 3800), keyboard };
}
export function readBusinessStudio(value: unknown) {
  const raw = record(value) ? value : {};
  return { draft: parseBusinessConfiguration(raw.draft) ?? structuredClone(DEFAULT_BUSINESS_CONFIGURATION), published: parseBusinessConfiguration(raw.published),
    revision: typeof raw.revision === 'number' && Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0 };
}
