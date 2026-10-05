import assert from 'node:assert/strict';
import test from 'node:test';
import { productButtons, productInstructions, productShareLink } from './telegram-product-buttons.ts';
import { DEFAULT_BUSINESS_CONFIGURATION, renderBusinessScreen } from './telegram-business-configuration.ts';
import { parseNavigationCallback } from './telegram-navigation.ts';

const input = { code: '123456abcdef', stock: 3, parent: 'lb:commerce:favorites:2', parentRef: 'abcdef123456', galleryIndex: 1, galleryCount: 3, available: { cart: true, favorites: true, reviews: true }, botUsername: 'test_shop_bot', productName: 'منتج حقيقي' };
test('runtime and preview product buttons have identical actions and safely mark only writes', () => {
  const runtime = productButtons(input).flat(); const preview = productButtons({ ...input, preview: true }).flat();
  assert.deepEqual(preview.map(({ previewDisabled, ...button }) => button), runtime);
  assert.deepEqual(preview.filter(button => button.previewDisabled).map(button => button.callback_data), ['lb:buy:123456abcdef', 'lb:commerce:add:123456abcdef:abcdef123456', 'lb:commerce:favorite:123456abcdef:abcdef123456']);
  assert.ok(preview.some(button => button.callback_data === 'lb:commerce:review:123456abcdef:abcdef123456' && !button.previewDisabled));
  assert.ok(runtime.some(button => button.url?.startsWith('https://t.me/share/url?')));
  for (const button of runtime.filter(button => button.callback_data)) assert.ok(parseNavigationCallback(button.callback_data));
  assert.ok(runtime.some(button => button.callback_data === input.parent), 'real favorites parent preserved');
});
test('unavailable commerce actions and out-of-stock purchase buttons remain hidden', () => {
  const buttons = productButtons({ ...input, stock: 0, available: { cart: false, favorites: false, reviews: false } }).flat();
  assert.ok(!buttons.some(button => /^(?:lb:buy:|lb:commerce:(?:add|favorite|review):)/.test(button.callback_data ?? '')));
  assert.equal(buttons.filter(button => button.callback_data?.startsWith('lb:gallery:')).length, 2);
});
test('share button and text require a known safe bot username', () => {
  assert.equal(productShareLink(input.code, null), null);
  assert.equal(productShareLink(input.code, 'javascript:bad'), null);
  assert.equal(productShareLink('invalid', 'test_shop_bot'), null);
  assert.ok(!productInstructions(input.code, undefined).includes('t.me'));
  assert.ok(!productButtons({ ...input, botUsername: null }).flat().some(button => button.url));
  assert.equal(productShareLink(input.code, 'test_shop_bot'), 'https://t.me/test_shop_bot?start=product_123456abcdef');
});
test('gallery styles create distinct labels and rows with safe current-image refresh', () => {
  const arrows = productButtons(input);
  const numbered = productButtons({ ...input, galleryStyle:'numbered' });
  const vertical = productButtons({ ...input, galleryStyle:'vertical' });
  assert.equal(arrows[0].length,2);
  assert.equal(numbered[0].length,3);
  assert.equal(numbered[0][1].text,'📷 2 / 3');
  assert.equal(numbered[0][1].callback_data,'lb:gallery:123456abcdef:1:abcdef123456');
  assert.equal(vertical[0].length,1); assert.equal(vertical[1].length,1);
  assert.ok(vertical[0][0].callback_data.startsWith('lb:gallery:'));
  for(const button of numbered.flat().filter(button=>button.callback_data)) assert.ok(parseNavigationCallback(button.callback_data));
});
test('purchase placement reorders action groups while preserving navigation footer', () => {
  const after = productButtons(input);
  const before = productButtons({...input,buttonPlacement:'before-gallery'});
  assert.ok(after[0][0].callback_data.startsWith('lb:gallery:'));
  assert.equal(before[0][0].callback_data,'lb:buy:123456abcdef');
  assert.deepEqual(before.at(-1),after.at(-1));
  assert.deepEqual(before.flat().map(button=>button.callback_data??button.url).sort(),after.flat().map(button=>button.callback_data??button.url).sort());
});
test('published Business default home includes enabled customer features without duplication', () => {
  const config = structuredClone(DEFAULT_BUSINESS_CONFIGURATION);
  const viewer = { storeName: 'Shop', customerName: 'Customer', returning: false, now: Date.now(), available: { cart: true, favorites: true, points: true, referrals: true, coupons: true, support: true } };
  const buttons = renderBusinessScreen(config, 'home', viewer).keyboard.flat();
  for (const feature of ['cart', 'favorites', 'points', 'referrals', 'coupons', 'support']) assert.equal(buttons.filter(button => button.callback_data === `lb:commerce:${feature}`).length, 1);
  config.screens[0].buttons.push({ id: 'cart', action: 'OPEN_CART', title: 'Custom cart', target: null, enabled: true });
  assert.equal(renderBusinessScreen(config, 'home', viewer).keyboard.flat().filter(button => button.callback_data === 'lb:commerce:cart').length, 1);
});
test('explicitly disabled or conditional Business customer buttons and blocks stay deliberate', () => {
  const config = structuredClone(DEFAULT_BUSINESS_CONFIGURATION);
  const viewer = { storeName: 'Shop', customerName: 'Customer', returning: false, now: Date.now(), available: { cart: true, points: true, coupons: false } };
  config.screens[0].buttons.push({ id: 'cart', action: 'OPEN_CART', title: 'Custom cart', target: null, enabled: false });
  config.screens[0].blocks.push({ id: 'points', type: 'POINTS', text: '', enabled: false });
  const buttons = renderBusinessScreen(config, 'home', viewer).keyboard.flat();
  assert.ok(!buttons.some(button => ['lb:commerce:cart', 'lb:commerce:points', 'lb:commerce:coupons'].includes(button.callback_data)));
});
