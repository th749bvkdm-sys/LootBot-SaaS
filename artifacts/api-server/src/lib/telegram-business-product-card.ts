import { productCardText, PRODUCT_CARD_STYLES, type ProductCardStyle } from './telegram-product-card.ts';

type Product = Parameters<typeof productCardText>[0];

/** Business blocks and Pro product views use the same nine persisted card styles. */
export function businessProductCard(product: Product, currency: string, style: string | undefined,
  rating?: Parameters<typeof productCardText>[3], gallery?: Parameters<typeof productCardText>[4]) {
  const cardStyle = PRODUCT_CARD_STYLES.includes(style as ProductCardStyle) ? style as ProductCardStyle : style === 'grid' ? 'compact' : 'classic';
  return productCardText({ ...product, description: product.description.slice(0, 180) }, currency, cardStyle, rating, gallery);
}
