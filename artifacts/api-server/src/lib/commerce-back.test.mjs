import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNavigationCallback, createSearchContexts } from './telegram-navigation.ts';
import { productButtons } from './telegram-product-buttons.ts';

test('commerce callbacks preserve optional scoped parents while accepting previous callbacks', () => {
  const parentRef = 'abcdef123456';
  for (const feature of ['cart', 'favorites', 'points', 'referrals', 'coupons', 'support', 'notifications', 'checkout', 'couponClear']) {
    assert.deepEqual(parseNavigationCallback(`lb:commerce:${feature}`), { kind: 'commerce', feature });
    assert.deepEqual(parseNavigationCallback(`lb:commerce:${feature}:${parentRef}`), { kind: 'commerce', feature, parentRef });
    assert.equal(parseNavigationCallback(`lb:commerce:${feature}:${parentRef}:${parentRef}`), null);
  }
  for (const feature of ['add', 'remove', 'favorite', 'review']) {
    const code = '123456abcdef';
    assert.deepEqual(parseNavigationCallback(`lb:commerce:${feature}:${code}`), { kind: 'commerce', feature, code });
    assert.deepEqual(parseNavigationCallback(`lb:commerce:${feature}:${code}:${parentRef}`), { kind: 'commerce', feature, code, parentRef });
    assert.equal(parseNavigationCallback(`lb:commerce:${feature}`), null);
  }
  assert.deepEqual(parseNavigationCallback(`lb:commerce:favorites:2:${parentRef}`), { kind: 'commerce', feature: 'favorites', page: 2, parentRef });
  assert.deepEqual(parseNavigationCallback('lb:commerce:favorites:2'), { kind: 'commerce', feature: 'favorites', page: 2 });
  for (const invalid of ['lb:commerce:support:../private', 'lb:commerce:favorites:0:abcdef123456', 'lb:commerce:favorite:123456abcdef:invalid', 'lb:commerce:support:' + 'a'.repeat(65)]) assert.equal(parseNavigationCallback(invalid), null);
});

test('product commerce actions carry one valid parent reference within Telegram callback limits', () => {
  const parentRef = 'abcdef123456';
  const buttons = productButtons({ code: '123456abcdef', stock: 1, parent: 'lb:commerce:favorites:2', parentRef, galleryIndex: 0, galleryCount: 1, available: { cart: true, favorites: true, reviews: true } }).flat();
  for (const feature of ['add', 'favorite', 'review']) {
    const button = buttons.find(button => button.callback_data?.startsWith(`lb:commerce:${feature}:`));
    assert.equal(parseNavigationCallback(button.callback_data).parentRef, parentRef);
  }
  for (const button of buttons.filter(button => button.callback_data)) assert.ok(Buffer.byteLength(button.callback_data) <= 64);
});

test('scoped reference storage isolates users, chats and stores and expires at 15 minutes', () => {
  let now = 0; const contexts = createSearchContexts(() => now);
  contexts.set('store:abcdef123456', 1, 2, 'lb:commerce:favorites:2');
  assert.equal(contexts.get('store:abcdef123456', 1, 2), 'lb:commerce:favorites:2');
  assert.equal(contexts.get('store:abcdef123456', 3, 2), null);
  assert.equal(contexts.get('store:abcdef123456', 1, 3), null);
  assert.equal(contexts.get('other:abcdef123456', 1, 2), null);
  now = 15 * 60_000;
  assert.equal(contexts.get('store:abcdef123456', 1, 2), null);
});
