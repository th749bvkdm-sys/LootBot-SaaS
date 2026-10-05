export const TELEGRAM_THEMES = ['Gaming', 'Neon', 'Premium', 'Minimal', 'Dark Store', 'Cyber', 'Luxury', 'Clean', 'Marketplace', 'Business', 'Colorful'] as const;
export type TelegramTheme = typeof TELEGRAM_THEMES[number];
export const SCREEN_STYLES = ['categories', 'products', 'product', 'offers', 'orders', 'order', 'account', 'search', 'empty', 'error', 'success', 'support', 'points', 'referrals', 'coupons', 'notifications'] as const;
export const SCREEN_VARIANTS = ['default','emoji-grid','image-grid','list','compact','discount-card','flash-offer','banner','featured-product'] as const;
export type ScreenStyle = { title: string; subtitle: string; footer: string; body?:string; columns: 1 | 2 | 3; showEmoji: boolean; bannerUrl: string; variant?:typeof SCREEN_VARIANTS[number]; galleryStyle?:'arrows'|'numbered'|'vertical'; badgeStyle?:'text'|'emoji'|'none'; buttonPlacement?:'before-gallery'|'after-gallery'; bannerPlacement?:'before'|'after' };
export type ScreenStyleMap = Partial<Record<typeof SCREEN_STYLES[number], ScreenStyle>>;
const presets: Record<TelegramTheme, { prefix: string; divider: string }> = {
  Gaming: { prefix: '🎮 ', divider: '━━━━ ◆ ━━━━' }, Neon: { prefix: '⚡ ', divider: '••• ⚡ •••' }, Premium: { prefix: '✦ ', divider: '──────── ✦' },
  Minimal: { prefix: '', divider: '' }, 'Dark Store': { prefix: '◼ ', divider: '▪▪▪▪▪▪▪▪' }, Cyber: { prefix: '◈ ', divider: '── ◈ ──' },
  Luxury: { prefix: '♛ ', divider: '──── ♛ ────' }, Clean: { prefix: '', divider: '────────' }, Marketplace: { prefix: '🛍 ', divider: '• • •' },
  Business: { prefix: '▣ ', divider: '──────────' }, Colorful: { prefix: '🌈 ', divider: '🔹 🔸 🔹' },
};
export const isTelegramTheme = (value: unknown): value is TelegramTheme => typeof value === 'string' && TELEGRAM_THEMES.includes(value as TelegramTheme);
export function themeDefaults(theme?:TelegramTheme){
  return {columns:(theme==='Marketplace'||theme==='Colorful'?3:theme==='Minimal'||theme==='Luxury'?1:2) as 1|2|3,
    productCardStyle:theme==='Premium'?'premium':theme==='Luxury'?'VIP':theme==='Minimal'?'minimal':theme==='Business'?'price-first':theme==='Marketplace'?'sale':'classic',
    spacing:theme==='Minimal'||theme==='Cyber'?'\n':'\n\n', bannerPlacement:theme==='Minimal'?'after':'before'} as const;
}
export function themedText(theme: TelegramTheme | undefined, title: string, body: string) {
  if (!theme) return [title, body].filter(Boolean).join('\n\n');
  const preset = presets[theme]; return [title ? preset.prefix + title : '', title && body ? preset.divider : '', body].filter(Boolean).join('\n\n');
}
export function parseScreenStyles(value: unknown): ScreenStyleMap | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const output: ScreenStyleMap = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!SCREEN_STYLES.includes(key as typeof SCREEN_STYLES[number]) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (!['title', 'subtitle', 'footer'].every(k => typeof item[k] === 'string' && (item[k] as string).length <= 200) || ![1, 2, 3].includes(item.columns as number) || typeof item.showEmoji !== 'boolean' || typeof item.bannerUrl !== 'string') return null;
    if((item.body!==undefined&&(typeof item.body!=='string'||item.body.length>800))||(item.variant!==undefined&&!SCREEN_VARIANTS.includes(item.variant as typeof SCREEN_VARIANTS[number]))||(item.galleryStyle!==undefined&&!['arrows','numbered','vertical'].includes(String(item.galleryStyle)))||(item.badgeStyle!==undefined&&!['text','emoji','none'].includes(String(item.badgeStyle)))||(item.buttonPlacement!==undefined&&!['before-gallery','after-gallery'].includes(String(item.buttonPlacement)))||(item.bannerPlacement!==undefined&&!['before','after'].includes(String(item.bannerPlacement))))return null;
    if (item.bannerUrl) { try { const url = new URL(item.bannerUrl); if (url.protocol !== 'https:' || url.username || url.password || item.bannerUrl.length > 1500) return null; } catch { return null; } }
    output[key as typeof SCREEN_STYLES[number]] = { title: String(item.title).trim(), subtitle: String(item.subtitle).trim(), footer: String(item.footer).trim(), columns: item.columns as 1 | 2 | 3, showEmoji: item.showEmoji, bannerUrl: item.bannerUrl,
      ...(item.body!==undefined?{body:String(item.body).trim()}:{}),...(item.variant!==undefined?{variant:item.variant as ScreenStyle['variant']}:{}),...(item.galleryStyle!==undefined?{galleryStyle:item.galleryStyle as ScreenStyle['galleryStyle']}:{}),...(item.badgeStyle!==undefined?{badgeStyle:item.badgeStyle as ScreenStyle['badgeStyle']}:{}),...(item.buttonPlacement!==undefined?{buttonPlacement:item.buttonPlacement as ScreenStyle['buttonPlacement']}:{}),...(item.bannerPlacement!==undefined?{bannerPlacement:item.bannerPlacement as ScreenStyle['bannerPlacement']}:{}),
    };
  }
  return output;
}
export function presentTelegramScreen(theme: TelegramTheme | undefined, style: ScreenStyle | undefined, content: string, keyboard: import('./telegram-navigation').BotButton[][], storeName: string, customerName: string) {
  const replace = (value: string) => value.replace(/\{\{(?:store|customer)\}\}/g, token => token === '{{store}}' ? storeName : customerName.slice(0, 80));
  const defaultTitle = theme ? content.split('\n')[0] : '';
  const heading = style?.title ? replace(style.title) : defaultTitle;
  const body = [style?.subtitle ? replace(style.subtitle) : '',style?.body?replace(style.body):'', defaultTitle ? content.slice(defaultTitle.length).trimStart() : content, style?.footer ? replace(style.footer) : ''].filter(Boolean).join(style?.variant==='compact'?'\n':themeDefaults(theme).spacing);
  let rows = keyboard;
  if (style || theme) {
    const isControl = (row: typeof keyboard[number]) => row.some(b => b.text.includes('رجوع') || b.callback_data?.startsWith('lb:gallery:') || b.callback_data === 'lb:home' || b.callback_data === 'lb:close' || b.text.includes('التالي') || b.text.includes('السابق') || b.text.includes('تحديث'));
    rows = [];let menu:typeof keyboard[number]=[];
    const columns=style?.columns??themeDefaults(theme).columns;
    const flush=()=>{for(let i=0;i<menu.length;i+=columns)rows.push(menu.slice(i,i+columns));menu=[];};
    for(const row of keyboard){if(isControl(row)){flush();rows.push(row);}else menu.push(...row);}flush();
    if (style?.showEmoji===false) rows = rows.map(row => row.map(button => ({ ...button, text: button.text.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim() || button.text })));
  }
  return { text: themedText(theme, heading, body).slice(0, 3900), keyboard: rows, imageUrl: style?.bannerUrl || null, imagePlacement:style?.bannerPlacement??themeDefaults(theme).bannerPlacement };
}
