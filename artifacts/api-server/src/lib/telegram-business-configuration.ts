import { isTelegramTheme, themedText, themeDefaults, type TelegramTheme } from './telegram-presentation.ts';
import { businessBlockText, businessBlockTitle, PRODUCT_BUSINESS_BLOCKS } from './telegram-business-block-presentation.ts';
import { parseRule, evaluateRule, type Rule, type CustomerFacts } from './customer-rules.ts';
import type { BotButton } from './telegram-navigation.ts';
export const BUSINESS_ACTIONS = ['OPEN_SCREEN','OPEN_PRODUCTS','OPEN_CATEGORIES','OPEN_PRODUCT','OPEN_CATEGORY','OPEN_OFFERS','OPEN_SEARCH','OPEN_ORDERS','OPEN_ACCOUNT','OPEN_CART','OPEN_FAVORITES','OPEN_POINTS','OPEN_REFERRALS','OPEN_COUPONS','OPEN_SUPPORT','SEND_MESSAGE','OPEN_URL','CUSTOM_CALLBACK'] as const;
export type BusinessAction = typeof BUSINESS_ACTIONS[number];
export const BLOCK_TYPES = ['TEXT','HEADER','BANNER','IMAGE','PRODUCT','PRODUCT_CAROUSEL','CATEGORY_GRID','CATEGORY_LIST','FEATURED','OFFERS','SEARCH','ORDERS','ACCOUNT','CART','FAVORITES','POINTS','REFERRALS','COUPONS','SUPPORT','FAQ','DIVIDER','SPACER','CUSTOM_BUTTON','EXTERNAL_LINK','ANNOUNCEMENT','VIP_BLOCK','SEGMENT_BLOCK'] as const;
export const BLOCK_STYLES = ['classic','compact','premium','sale','minimal','image-first','price-first','warranty-first','VIP','grid','list'] as const;
export type BlockType = typeof BLOCK_TYPES[number];
export type BusinessButton = { id: string; title: string; action: BusinessAction; target: string | null; enabled: boolean; condition?: Rule | null };
export type BusinessBlock = { id: string; type: BlockType; target?: string; style?: typeof BLOCK_STYLES[number]; title?: string; action?: BusinessAction; variant?: 'A'|'B'|''; text: string; enabled: boolean; condition?: Rule | null };
export type BusinessScreen = {
  id: string; parentId: string | null; title: string; enabled: boolean;
  audience: 'all' | 'new' | 'returning'; startsAt: string | null; endsAt: string | null;
  blocks: BusinessBlock[]; buttons: BusinessButton[];
  condition?: Rule | null;
};
export type BusinessConfiguration = { version: 1; columns: 1 | 2 | 3; screens: BusinessScreen[]; theme?: TelegramTheme; hideBranding?: boolean; experiment?: { id: string; enabled: boolean; ratio: number } };

export const DEFAULT_BUSINESS_CONFIGURATION: BusinessConfiguration = {
  version: 1, columns: 2, screens: [{ id: 'home', parentId: null, title: '{{store}}', enabled: true, audience: 'all', startsAt: null, endsAt: null,
    blocks: [{ id: 'welcome', type: 'TEXT', text: 'أهلًا {{customer}}. اختر من قائمة المتجر:', enabled: true }],
    buttons: [
      { id: 'offers', title: '🔥 العروض', action: 'OPEN_OFFERS', target: null, enabled: true },
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

const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export function safeUrl(v:unknown): v is string { if(typeof v!=='string'||v.length>1500)return false;try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;} }
export function validActionTarget(action:BusinessAction,target:unknown){return action==='OPEN_SCREEN'?id(target):['OPEN_PRODUCT','OPEN_CATEGORY'].includes(action)?uuid(target):action==='OPEN_URL'?safeUrl(target):action==='SEND_MESSAGE'?text(target,500):action==='CUSTOM_CALLBACK'?['home','close','refresh'].includes(String(target)):target===null;}
export function parseBusinessConfiguration(value: unknown): BusinessConfiguration | null {
  if (!record(value) || value.version !== 1 || ![1, 2, 3].includes(value.columns as number) || !Array.isArray(value.screens) || !value.screens.length || value.screens.length > 30) return null;
  if (value.theme !== undefined && !isTelegramTheme(value.theme)) return null;
  if (value.hideBranding !== undefined && typeof value.hideBranding !== 'boolean') return null;
  if (value.experiment !== undefined && (!record(value.experiment) || !id(value.experiment.id) || typeof value.experiment.enabled !== 'boolean' || !Number.isInteger(value.experiment.ratio) || Number(value.experiment.ratio)<1 || Number(value.experiment.ratio)>99)) return null;
  const screens: BusinessScreen[] = [];
  for (const raw of value.screens) {
    if (!record(raw) || !id(raw.id) || (raw.parentId !== null && !id(raw.parentId)) || !text(raw.title, 80) || typeof raw.enabled !== 'boolean' ||
      !['all', 'new', 'returning'].includes(raw.audience as string) || !date(raw.startsAt) || !date(raw.endsAt) ||
      (raw.startsAt && raw.endsAt && Date.parse(raw.startsAt) >= Date.parse(raw.endsAt)) ||
      !Array.isArray(raw.blocks) || raw.blocks.length > 12 || !Array.isArray(raw.buttons) || raw.buttons.length > 12) return null;
    const condition = raw.condition == null ? null : parseRule(raw.condition);
    if (raw.condition != null && !condition) return null;
    const blocks: BusinessBlock[] = [];
    for (const block of raw.blocks) {
      if (!record(block) || !id(block.id) || !BLOCK_TYPES.includes(block.type as BlockType) || !text(block.text, 500, !['TEXT','HEADER','FAQ','ANNOUNCEMENT','VIP_BLOCK','SEGMENT_BLOCK'].includes(String(block.type))) || typeof block.enabled !== 'boolean') return null;
      const blockCondition = block.condition == null ? null : parseRule(block.condition);
      if (block.condition != null && !blockCondition) return null;
      if ((block.title !== undefined && !text(block.title,80,true)) || (block.style !== undefined && !BLOCK_STYLES.includes(block.style as typeof BLOCK_STYLES[number])) || (block.variant !== undefined && !['','A','B'].includes(String(block.variant)))) return null;
      if (block.target !== undefined && typeof block.target !== 'string') return null;
      if (['PRODUCT'].includes(String(block.type)) && !uuid(block.target)) return null;
      if (['IMAGE','BANNER','EXTERNAL_LINK'].includes(String(block.type)) && !safeUrl(block.target)) return null;
      if (block.type === 'CUSTOM_BUTTON' && (!BUSINESS_ACTIONS.includes(block.action as BusinessAction) || !validActionTarget(block.action as BusinessAction, block.target ?? null))) return null;
      if (block.type === 'SEGMENT_BLOCK' && !blockCondition) return null;
      blocks.push({ id: block.id, type: block.type as BlockType, text: block.text.trim(), enabled: block.enabled, condition: blockCondition,
        ...(block.title !== undefined ? { title: String(block.title).trim() } : {}), ...(block.target !== undefined ? { target: String(block.target) } : {}),
        ...(block.action !== undefined ? { action: block.action as BusinessAction } : {}), ...(block.style !== undefined ? { style: block.style as typeof BLOCK_STYLES[number] } : {}), ...(block.variant !== undefined ? { variant: block.variant as BusinessBlock['variant'] } : {}) });
    }
    const buttons: BusinessScreen['buttons'] = [];
    for (const button of raw.buttons) {
      if (!record(button) || !id(button.id) || !text(button.title, 40) || !BUSINESS_ACTIONS.includes(button.action as BusinessAction) || typeof button.enabled !== 'boolean' ||
        !validActionTarget(button.action as BusinessAction, button.target)) return null;
      const buttonCondition = button.condition == null ? null : parseRule(button.condition); if (button.condition != null && !buttonCondition) return null;
      buttons.push({ id: button.id, title: button.title.trim(), action: button.action as BusinessAction, target: button.target as string | null, enabled: button.enabled, condition: buttonCondition });
    }
    if (new Set([...blocks,...buttons].map(b=>b.id)).size!==blocks.length+buttons.length || blocks.reduce((sum, b) => sum + b.text.length, 0) > 3000) return null;
    screens.push({ id: raw.id, parentId: raw.parentId as string | null, title: raw.title.trim(), enabled: raw.enabled, audience: raw.audience as BusinessScreen['audience'], startsAt: raw.startsAt, endsAt: raw.endsAt, blocks, buttons, condition });
  }
  const byId = new Map(screens.map(s => [s.id, s]));
  const home = byId.get('home');
  if (byId.size !== screens.length || !home || home.parentId !== null || !home.enabled || home.audience !== 'all' || home.startsAt || home.endsAt || home.condition) return null;
  for (const screen of screens) {
    if (screen.id !== 'home' && (!screen.parentId || !byId.has(screen.parentId))) return null;
    const seen = new Set([screen.id]); let parent = screen.parentId; let depth = 0;
    while (parent) {
      if (seen.has(parent) || ++depth > 3) return null;
      seen.add(parent); parent = byId.get(parent)?.parentId ?? null;
    }
    const referenced = [...screen.buttons, ...screen.blocks.filter(b => b.type === 'CUSTOM_BUTTON').map(b => ({...b, action:b.action!}))];
    if (referenced.some(b => b.action === 'OPEN_SCREEN' && (!byId.has(b.target!) || (screen.enabled && b.enabled && !byId.get(b.target!)!.enabled)))) return null;
  }
  return { version: 1, columns: value.columns as 1 | 2 | 3, screens, ...(value.theme !== undefined ? { theme: value.theme as TelegramTheme } : {}), ...(value.hideBranding !== undefined ? {hideBranding: value.hideBranding as boolean}:{}), ...(value.experiment !== undefined ? {experiment:value.experiment as BusinessConfiguration['experiment']}: {}) };
}
export type BusinessViewer = { storeName: string; customerName: string; returning: boolean; now: number; facts?: Partial<CustomerFacts>; available?: Record<string,boolean>; data?: Record<string, {text:string; buttons:BotButton[]; imageUrl?:string}>; experimentVariant?: 'A'|'B' };
export function visibleBusinessScreen(config: BusinessConfiguration, screen: BusinessScreen, viewer: BusinessViewer): boolean {
  const own = (s: BusinessScreen) => s.enabled && (!s.condition || (!!viewer.facts && evaluateRule(s.condition, viewer.facts))) && (s.audience === 'all' || (s.audience === 'returning') === viewer.returning) && (!s.startsAt || Date.parse(s.startsAt)<=viewer.now) && (!s.endsAt || Date.parse(s.endsAt)>viewer.now);
  if (!own(screen)) return false;
  let parent=screen.parentId; const seen=new Set<string>(); while(parent) { if(seen.has(parent)) return false; seen.add(parent); const node=config.screens.find(s=>s.id===parent); if(!node||!own(node))return false;parent=node.parentId; } return true;
}
export const actionCallbacks: Partial<Record<BusinessAction,string>>={OPEN_PRODUCTS:'lb:products:1',OPEN_CATEGORIES:'lb:categories:1',OPEN_OFFERS:'lb:offers:1',OPEN_SEARCH:'lb:search:1',OPEN_ORDERS:'lb:orders:1',OPEN_ACCOUNT:'lb:account',OPEN_CART:'lb:commerce:cart',OPEN_FAVORITES:'lb:commerce:favorites',OPEN_POINTS:'lb:commerce:points',OPEN_REFERRALS:'lb:commerce:referrals',OPEN_COUPONS:'lb:commerce:coupons',OPEN_SUPPORT:'lb:commerce:support'};
const features: Partial<Record<BusinessAction,string>>={OPEN_CART:'cart',OPEN_FAVORITES:'favorites',OPEN_POINTS:'points',OPEN_REFERRALS:'referrals',OPEN_COUPONS:'coupons',OPEN_SUPPORT:'support'};
export function businessButton(config: BusinessConfiguration, screenId:string, button:BusinessButton, viewer:BusinessViewer): BotButton|null {
  if(!button.enabled || (button.condition && (!viewer.facts || !evaluateRule(button.condition,viewer.facts))))return null;
  const feature=features[button.action];if(feature && !viewer.available?.[feature])return null;
  if(button.action==='OPEN_SCREEN'){const target=config.screens.find(s=>s.id===button.target);return target&&visibleBusinessScreen(config,target,viewer)?{text:button.title,callback_data:'lb:screen:'+button.target}:null;}
  if(button.action==='OPEN_URL')return {text:button.title,url:button.target!};
  if(button.action==='SEND_MESSAGE')return {text:button.title,callback_data:'lb:msg:'+screenId+':'+button.id};
  if(button.action==='OPEN_PRODUCT')return {text:button.title,callback_data:'lb:product:'+button.target!.replaceAll('-','').slice(0,12)};
  if(button.action==='OPEN_CATEGORY')return {text:button.title,callback_data:'lb:category:'+button.target+':1'};
  if(button.action==='CUSTOM_CALLBACK')return {text:button.title,callback_data:button.target==='refresh'?'lb:screen:'+screenId:'lb:'+button.target};
  const callback=actionCallbacks[button.action];return callback?{text:button.title,callback_data:callback}:null;
}
export function renderBusinessScreen(config:BusinessConfiguration,screenId:string,viewer:BusinessViewer){
  const screen=config.screens.find(s=>s.id===screenId);if(!screen||!visibleBusinessScreen(config,screen,viewer))return null;
  const substitute=(v:string)=>v.replace(/\{\{(?:store|customer)\}\}/g,t=>t==='{{store}}'?viewer.storeName:viewer.customerName.slice(0,80));
  const buttons:BotButton[]=screen.buttons.flatMap(b=>{const v=businessButton(config,screenId,b,viewer);return v?[v]:[];}); const content:string[]=[];const images:string[]=[];
  for(const b of screen.blocks){if(!b.enabled || (b.condition && (!viewer.facts||!evaluateRule(b.condition,viewer.facts))) || (b.type==='VIP_BLOCK' && Number(viewer.facts?.VIP_LEVEL??0)<1) || (config.experiment?.enabled && b.variant && b.variant !== viewer.experimentVariant))continue;
    if(b.type==='DIVIDER'||b.type==='SPACER'){content.push(businessBlockText(b));continue;}
    if(['IMAGE','BANNER'].includes(b.type)){images.push(b.target!);const text=businessBlockText(b);if(text)content.push(text);continue;}
    if(b.type==='CUSTOM_BUTTON'){const v=businessButton(config,screenId,{...b,title:businessBlockTitle(b.title||b.text||'فتح',b.style).slice(0,60),action:b.action!,target:b.target||null},viewer);if(v)buttons.push(v);continue;}
    if(b.type==='EXTERNAL_LINK'){buttons.push({text:businessBlockTitle(b.title||b.text||'فتح الرابط',b.style).slice(0,60),url:b.target!});continue;}
    const d=viewer.data?.[b.id];if(d){if(d.text)content.push(PRODUCT_BUSINESS_BLOCKS.includes(b.type)?d.text:businessBlockText(b,d.text));buttons.push(...d.buttons.map(button=>({...button,text:businessBlockTitle(button.text,b.style).slice(0,60)})));if(d.imageUrl)images.push(d.imageUrl);continue;}
    const action=('OPEN_'+b.type) as BusinessAction; if(actionCallbacks[action]){const v=businessButton(config,screenId,{id:b.id,title:businessBlockTitle(b.title||b.text||b.type,b.style).slice(0,60),action,target:null,enabled:true},viewer);if(v)buttons.push(v);continue;}
    if(['PRODUCT','PRODUCT_CAROUSEL','CATEGORY_GRID','CATEGORY_LIST','FEATURED','OFFERS'].includes(b.type))continue;
    content.push(businessBlockText(b));
  }
  for(const child of config.screens.filter(s=>s.parentId===screenId&&visibleBusinessScreen(config,s,viewer)))if(!buttons.some(b=>b.callback_data==='lb:screen:'+child.id))buttons.push({text:substitute(child.title).slice(0,60),callback_data:'lb:screen:'+child.id});
  if(screenId==='home'&&!buttons.length)for(const b of DEFAULT_BUSINESS_CONFIGURATION.screens[0].buttons){const v=businessButton(config,screenId,b,viewer);if(v)buttons.push(v);}
  if(screenId==='home') {
    const explicit = new Set<BusinessAction>([
      ...screen.buttons.map(button => button.action),
      ...screen.blocks.map(block => block.type==='CUSTOM_BUTTON' ? block.action! : ('OPEN_'+block.type) as BusinessAction),
    ]);
    const defaults: [BusinessAction,string][] = [['OPEN_CART','🛒 السلة'],['OPEN_FAVORITES','❤️ المفضلة'],['OPEN_POINTS','⭐ النقاط'],['OPEN_REFERRALS','🎁 الإحالات'],['OPEN_COUPONS','🎫 الكوبونات'],['OPEN_SUPPORT','💬 الدعم']];
    for(const [action,title] of defaults) {
      if(explicit.has(action)) continue;
      const button = businessButton(config,screenId,{id:'default_'+action.toLowerCase(),title,action,target:null,enabled:true},viewer);
      if(button && !buttons.some(existing=>existing.callback_data===button.callback_data)) buttons.push(button);
    }
  }
  const keyboard:BotButton[][]=[];for(let i=0;i<buttons.length;i+=config.columns)keyboard.push(buttons.slice(i,i+config.columns));
  if(screenId!=='home')keyboard.push([{text:'↩️ رجوع',callback_data:'lb:screen:'+screen.parentId},{text:'🏠 الرئيسية',callback_data:'lb:home'}]);keyboard.push([{text:'🔄 تحديث',callback_data:'lb:screen:'+screenId},{text:'✖ إغلاق',callback_data:'lb:close'}]);
  return {text:substitute(themedText(config.theme,screen.title,content.join(themeDefaults(config.theme).spacing))).slice(0,config.hideBranding?3800:3780)+(config.hideBranding?'':'\n\nPowered by LootBot'),keyboard,images:images.slice(0,3)};
}
export function readBusinessStudio(value:unknown){const raw=record(value)?value:{};return {draft:parseBusinessConfiguration(raw.draft)??structuredClone(DEFAULT_BUSINESS_CONFIGURATION),published:parseBusinessConfiguration(raw.published),revision:typeof raw.revision==='number'&&Number.isSafeInteger(raw.revision)&&raw.revision>=0?raw.revision:0};}
