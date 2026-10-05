import type { BusinessBlock } from './telegram-business-configuration.ts';
import { PRODUCT_CARD_STYLES } from './telegram-product-card.ts';

export const PRODUCT_BUSINESS_BLOCKS = ['PRODUCT', 'PRODUCT_CAROUSEL', 'FEATURED', 'OFFERS'];
export function businessBlockStyles(type: string): readonly string[] {
  if (PRODUCT_BUSINESS_BLOCKS.includes(type)) return PRODUCT_CARD_STYLES;
  if (['CATEGORY_GRID', 'CATEGORY_LIST'].includes(type)) return ['classic', 'grid', 'list', 'compact', 'premium', 'minimal'];
  if (type === 'DIVIDER') return ['classic', 'compact', 'premium', 'minimal'];
  if (type === 'SPACER') return ['classic', 'compact'];
  return ['classic', 'compact', 'premium', 'minimal', 'VIP'];
}

export function businessBlockTitle(title: string, style: string | undefined): string {
  if (!title) return '';
  if (style === 'compact') return title.replace(/\s+/g, ' ').trim();
  if (style === 'minimal') return title.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim() || title;
  return style === 'premium' ? `✦ ${title}` : style === 'VIP' ? `♛ ${title}` : title;
}

/** Telegram text decoration changes actual content without inventing prices or claims. */
export function businessBlockText(block: Pick<BusinessBlock, 'type' | 'title' | 'text' | 'style'>, body = block.text): string {
  const title = businessBlockTitle(block.title ?? '', block.style);
  if (block.type === 'DIVIDER') {
    const divider = block.style === 'compact' ? '─────' : block.style === 'premium' ? '──── ✦ ────' : block.style === 'minimal' ? '───' : '──────────';
    return [title, divider].filter(Boolean).join('\n');
  }
  if (block.type === 'SPACER') return [title, block.style === 'compact' ? '⠀' : '⠀\n⠀'].filter(Boolean).join('\n');
  const marker = block.type === 'HEADER' ? '◆ ' : block.type === 'FAQ' ? '❓ ' : block.type === 'ANNOUNCEMENT' ? '📣 ' : '';
  const content = [title, body].filter(Boolean);
  if (!content.length) return '';
  if (block.style === 'compact') return content.map(value => value.replace(/\s+/g, ' ').trim()).join(' · ');
  if (block.style === 'minimal') return content.map(value => value.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim() || value).join('\n');
  if (block.style === 'premium' || block.style === 'VIP') {
    if (!title) content[0] = businessBlockTitle(content[0], block.style);
    return content.join('\n\n');
  }
  return marker + content.join('\n');
}
