import test from 'node:test';
import assert from 'node:assert/strict';
import { readStorefrontSettings, mergeStorefrontSettings, safeStorefrontImage } from './storefront-configuration.ts';
test('storefront defaults stay private; appearance preserves bot, plan, custom and commerce settings', () => {
  assert.deepEqual(readStorefrontSettings({}), { theme: 'dark', enabled: false });
  assert.deepEqual(readStorefrontSettings({ storefront: { theme: 'invalid', enabled: 'yes' } }), { theme: 'dark', enabled: false });
  const initial = { plan: { code: 'BUSINESS' }, telegramHomeStudio: { revision: 4 }, cartEnabled: true, storefront: { custom: 'saved' } };
  const merged = mergeStorefrontSettings(initial, { theme: 'nebula', enabled: true });
  assert.deepEqual(merged.plan, initial.plan); assert.deepEqual(merged.telegramHomeStudio, initial.telegramHomeStudio); assert.equal(merged.cartEnabled, true); assert.equal(merged.storefront.custom, 'saved'); assert.equal(initial.storefront.theme, undefined);
  assert.deepEqual(readStorefrontSettings(merged), { theme: 'nebula', enabled: true });
});
test('customer images reject javascript, protocol relative, SVG data and mixed content', () => {
  for (const value of ['javascript:alert(1)', '//example.invalid/a', 'data:image/svg+xml,...', 'http://example.invalid/a', '/\\bad']) assert.equal(safeStorefrontImage(value), null);
  assert.equal(safeStorefrontImage('/product.png'), '/product.png'); assert.equal(safeStorefrontImage('https://example.invalid/a.webp'), 'https://example.invalid/a.webp');
});
