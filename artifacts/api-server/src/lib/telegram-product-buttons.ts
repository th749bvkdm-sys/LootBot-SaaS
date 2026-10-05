import { navigationFooter, type BotButton } from './telegram-navigation.ts';

export type ProductPreviewButton = BotButton & { previewDisabled?: boolean };
type ProductButtonsInput = {
  code: string; stock: number; parent: string; parentRef?: string | null;
  galleryIndex: number; galleryCount: number;
  available: { cart: boolean; favorites: boolean; reviews: boolean };
  botUsername?: string | null; productName?: string; preview?: boolean;
  galleryStyle?: 'arrows' | 'numbered' | 'vertical';
  buttonPlacement?: 'before-gallery' | 'after-gallery';
};
export function productShareLink(code: string, botUsername?: string | null): string | null {
  return /^[a-f0-9]{12}$/.test(code) && typeof botUsername === 'string' && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(botUsername)
    ? `https://t.me/${botUsername}?start=product_${code}` : null;
}
export function productInstructions(code: string, botUsername?: string | null) {
  if (!/^[a-f0-9]{12}$/.test(code)) return '';
  const link = productShareLink(code, botUsername);
  return `\n\nللطلب: /order ${code} 1${link ? `\nللمشاركة: ${link}` : ''}`;
}
/** Runtime and preview use the same enabled actions. Preview tags write actions. */
export function productButtons(input: ProductButtonsInput): ProductPreviewButton[][] {
  if (!/^[a-f0-9]{12}$/.test(input.code)) return navigationFooter(input.parent);
  const code = input.code; const buttons: ProductPreviewButton[][] = [];
  const parentSuffix = input.parentRef && /^[a-f0-9]{12}$/.test(input.parentRef) ? `:${input.parentRef}` : '';
  const gallery: ProductPreviewButton[] = [];
  const count = Number.isInteger(input.galleryCount) ? Math.min(10, Math.max(0, input.galleryCount)) : 0;
  const index = Number.isInteger(input.galleryIndex) ? Math.min(Math.max(0, input.galleryIndex), Math.max(0, count - 1)) : 0;
  if (input.parentRef && /^[a-f0-9]{12}$/.test(input.parentRef)) {
    if (index > 0) gallery.push({ text: input.galleryStyle==='numbered' ? `◀ ${index} / ${count}` : '◀ الصورة السابقة', callback_data: `lb:gallery:${code}:${index - 1}:${input.parentRef}` });
    if (input.galleryStyle==='numbered' && count) gallery.push({ text: `📷 ${index + 1} / ${count}`, callback_data: `lb:gallery:${code}:${index}:${input.parentRef}` });
    if (index + 1 < count) gallery.push({ text: input.galleryStyle==='numbered' ? `${index + 2} / ${count} ▶` : 'الصورة التالية ▶', callback_data: `lb:gallery:${code}:${index + 1}:${input.parentRef}` });
  }
  const write = (text: string, callback_data: string): ProductPreviewButton => ({ text, callback_data, ...(input.preview ? { previewDisabled: true } : {}) });
  if (input.stock > 0) buttons.push([write('🛍 طلب قطعة واحدة', `lb:buy:${code}`)]);
  if (input.available.cart && input.stock > 0) buttons.push([write('🛒 إضافة للسلة', `lb:commerce:add:${code}${parentSuffix}`)]);
  if (input.available.favorites) buttons.push([write('❤️ تحديث المفضلة', `lb:commerce:favorite:${code}${parentSuffix}`)]);
  const link = productShareLink(code, input.botUsername);
  if (link) buttons.push([{ text: '↗️ مشاركة المنتج', url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent((input.productName ?? '').slice(0, 80))}` }]);
  if (input.available.reviews) buttons.push([{ text: '⭐ تقييم المنتج', callback_data: `lb:commerce:review:${code}${parentSuffix}` }]);
  const galleryRows = input.galleryStyle==='vertical' ? gallery.map(button => [button]) : gallery.length ? [gallery] : [];
  if(input.buttonPlacement==='before-gallery') buttons.push(...galleryRows); else buttons.unshift(...galleryRows);
  buttons.push(...navigationFooter(input.parent)); return buttons;
}
