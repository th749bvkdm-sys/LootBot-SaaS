import assert from 'node:assert/strict';
import test from 'node:test';
import { businessProductCard } from './telegram-business-product-card.ts';
import { PRODUCT_CARD_STYLES, productCardText } from './telegram-product-card.ts';

test('every Business card style uses the same saved metadata and formatter as Pro', () => {
  const product = { name: 'Owned item', price: '10', oldPrice: '20', stock: 3, warranty: '1 year', description: 'Actual description', sku: 'OWNED', tags: ['Game'] };
  const rating = { rating: 4.5, count: 2 };
  const gallery = { index: 0, total: 3 };
  for (const style of PRODUCT_CARD_STYLES) assert.equal(businessProductCard(product, 'USD', style, rating, gallery), productCardText(product, 'USD', style, rating, gallery));
  assert.equal(businessProductCard(product, 'USD', 'grid'), productCardText(product, 'USD', 'compact'));
  assert.equal(businessProductCard(product, 'USD', 'list'), productCardText(product, 'USD', 'classic'));
  assert.equal(businessProductCard(product, 'USD', 'bad'), productCardText(product, 'USD', 'classic'));
});
