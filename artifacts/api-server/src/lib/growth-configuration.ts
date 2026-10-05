import { evaluateRule, parseRule, ruleUses, type Rule, type CustomerFacts } from './customer-rules.ts';
export const GROWTH_TRIGGERS = ['USER_REGISTERED', 'ORDER_CREATED', 'ORDER_PAID', 'ORDER_FULFILLED', 'ORDER_CANCELLED', 'COUPON_USED', 'POINTS_EARNED', 'REFERRAL_COMPLETED', 'REVIEW_CREATED', 'VIP_LEVEL_CHANGED', 'USER_INACTIVE', 'SCHEDULED_TIME'] as const;
export type GrowthTrigger = typeof GROWTH_TRIGGERS[number];
export const GROWTH_ACTIONS = ['SEND_MESSAGE', 'SEND_PRODUCT', 'SEND_CATEGORY', 'SEND_COUPON', 'ADD_POINTS', 'REMOVE_POINTS', 'ADD_TAG', 'REMOVE_TAG', 'ADD_SEGMENT', 'REMOVE_SEGMENT', 'NOTIFY_ADMIN'] as const;
export type GrowthButton = { text: string; type: 'OPEN_URL' | 'OPEN_PRODUCT' | 'OPEN_CATEGORY' | 'OPEN_HOME'; target: string };
export type GrowthAction = { type: typeof GROWTH_ACTIONS[number]; text: string; target: string; amount: number; delaySeconds: number; condition: Rule | null; imageUrl: string; branch?: 'match' | 'otherwise'; buttons?: GrowthButton[] };
export type GrowthAudience = { type: 'all' | 'segment' | 'vip' | 'inactive' | 'highSpend' | 'selected'; segmentId: string; minimum: number; inactivityDays: number; customerIds: string[] };
export type GrowthConfiguration = { kind: 'segment' | 'broadcast' | 'automation' | 'journey'; condition: Rule | null; actions: GrowthAction[]; trigger: GrowthTrigger; scheduleAt: string | null; inactivityDays: number; audience?: GrowthAudience };
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function safeHttps(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1500) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !!url.hostname; } catch { return false; }
}
export function parseGrowthConfiguration(value: unknown): GrowthConfiguration | null {
  if (!record(value) || !['segment', 'broadcast', 'automation', 'journey'].includes(String(value.kind))) return null;
  const condition = value.condition == null ? null : parseRule(value.condition);
  if (value.condition != null && !condition) return null;
  if (value.kind === 'segment' && ruleUses(condition, 'CUSTOMER_SEGMENT')) return null;
  const trigger = value.trigger ?? 'USER_REGISTERED';
  if (!GROWTH_TRIGGERS.includes(trigger as GrowthTrigger)) return null;
  const scheduleAt = value.scheduleAt ?? null;
  if (scheduleAt !== null && (typeof scheduleAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(scheduleAt) || !Number.isFinite(Date.parse(scheduleAt)) || new Date(scheduleAt).toISOString() !== scheduleAt)) return null;
  if (trigger === 'SCHEDULED_TIME' && value.kind !== 'segment' && !scheduleAt) return null;
  const inactivityDays = value.inactivityDays ?? 14;
  if (!Number.isInteger(inactivityDays) || Number(inactivityDays) < 1 || Number(inactivityDays) > 365) return null;
  if (!Array.isArray(value.actions) || value.actions.length > 10 || (value.kind !== 'segment' && !value.actions.length) || (value.kind === 'segment' && value.actions.length)) return null;
  const actions: GrowthAction[] = [];
  for (const raw of value.actions) {
    if (!record(raw) || !GROWTH_ACTIONS.includes(raw.type as GrowthAction['type'])) return null;
    const text = raw.text ?? ''; const target = raw.target ?? ''; const amount = raw.amount ?? 0;
    const delaySeconds = raw.delaySeconds ?? 0; const imageUrl = raw.imageUrl ?? '';
    const actionCondition = raw.condition == null ? null : parseRule(raw.condition);
    if (raw.condition != null && !actionCondition) return null;
    const branch = raw.branch ?? 'match';
    if (!['match', 'otherwise'].includes(String(branch)) || (branch === 'otherwise' && !actionCondition)) return null;
    const buttons: GrowthButton[] = [];
    if (raw.buttons !== undefined && (!Array.isArray(raw.buttons) || raw.buttons.length > 8)) return null;
    for (const button of (raw.buttons ?? []) as unknown[]) {
      if (!record(button) || typeof button.text !== 'string' || !button.text.trim() || button.text.length > 48 || typeof button.target !== 'string' ||
        !['OPEN_URL', 'OPEN_PRODUCT', 'OPEN_CATEGORY', 'OPEN_HOME'].includes(String(button.type))) return null;
      if (button.type === 'OPEN_URL' ? !safeHttps(button.target) : button.type === 'OPEN_HOME' ? button.target !== '' : !uuid(button.target)) return null;
      buttons.push({ text: button.text.trim(), type: button.type as GrowthButton['type'], target: button.target });
    }
    if (buttons.length && !['SEND_MESSAGE', 'SEND_PRODUCT', 'SEND_CATEGORY', 'SEND_COUPON', 'NOTIFY_ADMIN'].includes(String(raw.type))) return null;
    if (typeof text !== 'string' || text.length > 3000 || typeof target !== 'string' || target.length > 100 ||
      !Number.isInteger(amount) || Number(amount) < 0 || Number(amount) > 1000000 || !Number.isInteger(delaySeconds) || Number(delaySeconds) < 0 || Number(delaySeconds) > 604800 ||
      (imageUrl !== '' && !safeHttps(imageUrl))) return null;
    if (['SEND_MESSAGE', 'NOTIFY_ADMIN'].includes(String(raw.type)) && !text.trim()) return null;
    if (['ADD_POINTS', 'REMOVE_POINTS'].includes(String(raw.type)) && !amount) return null;
    if (['SEND_PRODUCT', 'SEND_CATEGORY', 'SEND_COUPON', 'ADD_SEGMENT', 'REMOVE_SEGMENT'].includes(String(raw.type)) && !uuid(target)) return null;
    if (['ADD_TAG', 'REMOVE_TAG'].includes(String(raw.type)) && (!target.trim() || target.length > 40)) return null;
    if (value.kind === 'broadcast' && !['SEND_MESSAGE', 'SEND_PRODUCT', 'SEND_CATEGORY', 'SEND_COUPON'].includes(String(raw.type))) return null;
    if (trigger === 'POINTS_EARNED' && ['ADD_POINTS', 'REMOVE_POINTS'].includes(String(raw.type))) return null;
    actions.push({ type: raw.type as GrowthAction['type'], text: text.trim(), target: target.trim(), amount: Number(amount), delaySeconds: Number(delaySeconds), condition: actionCondition, imageUrl: imageUrl as string, branch: branch as GrowthAction['branch'], buttons });
  }
  const audience = parseGrowthAudience(value.audience);
  if (!audience) return null;
  return { kind: value.kind as GrowthConfiguration['kind'], condition, trigger: trigger as GrowthTrigger, scheduleAt, actions, inactivityDays: Number(inactivityDays), audience };
}
export function parseGrowthAudience(value: unknown): GrowthAudience | null {
  if (value === undefined) return { type: 'all', segmentId: '', minimum: 1, inactivityDays: 14, customerIds: [] };
  if (!record(value) || !['all', 'segment', 'vip', 'inactive', 'highSpend', 'selected'].includes(String(value.type))) return null;
  const minimum = value.minimum ?? 1; const inactivityDays = value.inactivityDays ?? 14; const customerIds = value.customerIds ?? []; const segmentId = value.segmentId ?? '';
  if (typeof minimum !== 'number' || !Number.isFinite(minimum) || minimum < 0 || minimum > 1e12 || !Number.isInteger(inactivityDays) || Number(inactivityDays) < 1 || Number(inactivityDays) > 365 ||
    typeof segmentId !== 'string' || (segmentId !== '' && !uuid(segmentId)) || !Array.isArray(customerIds) || customerIds.length > 500 || !customerIds.every(uuid) || new Set(customerIds).size !== customerIds.length ||
    (value.type === 'segment' && !segmentId) || (value.type === 'selected' && !customerIds.length)) return null;
  return { type: value.type as GrowthAudience['type'], minimum, inactivityDays: Number(inactivityDays), customerIds, segmentId };
}
export function audienceMatches(audience: GrowthAudience | undefined, customer: { id: string; lastSeenAt: Date | string }, facts: CustomerFacts, now = Date.now()) {
  if (!audience || audience.type === 'all') return true;
  if (audience.type === 'selected') return audience.customerIds.includes(customer.id);
  if (audience.type === 'segment') return Array.isArray(facts.CUSTOMER_SEGMENT) && facts.CUSTOMER_SEGMENT.includes(audience.segmentId);
  if (audience.type === 'vip') return typeof facts.VIP_LEVEL === 'number' && facts.VIP_LEVEL >= audience.minimum;
  if (audience.type === 'highSpend') return typeof facts.TOTAL_SPEND_GREATER_THAN === 'number' && facts.TOTAL_SPEND_GREATER_THAN >= audience.minimum;
  return Number.isFinite(new Date(customer.lastSeenAt).getTime()) && new Date(customer.lastSeenAt).getTime() < now - audience.inactivityDays * 86400000;
}
export function actionMatches(action: GrowthAction, facts: CustomerFacts) {
  const matches = evaluateRule(action.condition, facts); return action.branch === 'otherwise' ? !matches : matches;
}
export function renderGrowthText(text: string, storeName: string, customerName: string) {
  return text.replace(/\{\{(?:store|customer)\}\}/g, token => token === '{{store}}' ? storeName : customerName);
}
export const GROWTH_TEMPLATES = {
  welcome: { name: 'ترحيب', trigger: 'USER_REGISTERED', text: 'أهلًا {{customer}} في {{store}} 👋\nتصفح المنتجات وابدأ التسوق.', type: 'SEND_MESSAGE' },
  sale: { name: 'عرض خاص', trigger: 'SCHEDULED_TIME', text: 'عروض {{store}} بانتظارك يا {{customer}}! تصفح العرض من الزر أدناه.', type: 'SEND_MESSAGE' },
  coupon: { name: 'كوبون', trigger: 'ORDER_PAID', text: 'شكرًا لتسوقك من {{store}} يا {{customer}}. إليك كوبون طلبك القادم:', type: 'SEND_COUPON' },
  newProduct: { name: 'منتج جديد', trigger: 'USER_REGISTERED', text: 'وصل جديد إلى {{store}}! اكتشف المنتج يا {{customer}}.', type: 'SEND_PRODUCT' },
  vip: { name: 'عملاء VIP', trigger: 'VIP_LEVEL_CHANGED', text: 'أهلًا {{customer}} ⭐ شكرًا لكونك من عملائنا المميزين في {{store}}.', type: 'SEND_MESSAGE' },
  inactive: { name: 'عودة العميل', trigger: 'USER_INACTIVE', text: 'اشتقنا لك يا {{customer}}! اكتشف الجديد في {{store}}.', type: 'SEND_MESSAGE' },
  referral: { name: 'إحالة ناجحة', trigger: 'REFERRAL_COMPLETED', text: 'شكرًا {{customer}}! اكتملت إحالتك في {{store}} 🎁', type: 'SEND_MESSAGE' },
} as const;
export function defaultGrowthConfiguration(kind: GrowthConfiguration['kind']): GrowthConfiguration {
  return { kind, condition: null, trigger: 'USER_REGISTERED', scheduleAt: null, inactivityDays: 14,
    actions: kind === 'segment' ? [] : [{ type: 'SEND_MESSAGE', text: 'أهلًا {{customer}} في {{store}}', target: '', amount: 0, delaySeconds: 0, condition: null, imageUrl: '' }] };
}
