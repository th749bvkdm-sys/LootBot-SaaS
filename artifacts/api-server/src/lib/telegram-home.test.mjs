import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_ACTIONS, HOME_COMMERCE_ACTIONS, DEFAULT_HOME_CONFIGURATION, parseHomeConfiguration, renderConfiguredHome, availableHomeConfiguration, appendHomeCommerce } from './telegram-home-configuration.ts';
import { parseNavigationCallback } from './telegram-navigation.ts';
const full = () => ({ ...structuredClone(DEFAULT_HOME_CONFIGURATION), buttons: HOME_ACTIONS.map(action => ({ action, title: action, emoji: '⭐', enabled: true })) });
test('Pro navigation accepts old five/six core buttons and validates all optional actions', () => {
  assert.ok(parseHomeConfiguration(DEFAULT_HOME_CONFIGURATION));
  assert.ok(parseHomeConfiguration({ ...DEFAULT_HOME_CONFIGURATION, buttons: DEFAULT_HOME_CONFIGURATION.buttons.filter(b => b.action !== 'offers') }));
  const configuration = parseHomeConfiguration(full()); assert.ok(configuration);
  const buttons = renderConfiguredHome(configuration, 'Store', 'Customer').keyboard.flat();
  assert.equal(buttons.length, 13); assert.ok(buttons.every(b => parseNavigationCallback(b.callback_data)));
  for (const action of HOME_COMMERCE_ACTIONS) assert.ok(buttons.some(b => b.callback_data === `lb:commerce:${action}`));
  assert.equal(parseHomeConfiguration({ ...full(), buttons: [...full().buttons, full().buttons[0]] }), null);
});
test('availability hides unavailable optional buttons without mutating drafts or showing explicitly disabled buttons again', () => {
  const configuration = full(); configuration.buttons.find(b => b.action === 'coupons').enabled = false;
  const filtered = availableHomeConfiguration(configuration, { cart: true, points: false, coupons: true, notifications: true });
  const home = renderConfiguredHome(filtered, 'Store', 'Customer');
  const extras = [[{ text: 'Default cart', callback_data: 'lb:commerce:cart' }], [{ text: 'Default coupon', callback_data: 'lb:commerce:coupons' }], [{ text: 'Duplicate', callback_data: 'lb:commerce:cart' }]];
  const buttons = appendHomeCommerce(home.keyboard, configuration, extras).flat();
  assert.equal(buttons.filter(b => b.callback_data === 'lb:commerce:cart').length, 1);
  assert.equal(buttons.some(b => b.callback_data === 'lb:commerce:coupons'), false);
  assert.equal(buttons.some(b => b.callback_data === 'lb:commerce:points'), false);
  assert.equal(configuration.buttons.find(b => b.action === 'points').enabled, true, 'draft remains unchanged');
});
test('legacy published menus append missing available actions once and custom optional labels/order persist', () => {
  const original = structuredClone(DEFAULT_HOME_CONFIGURATION);
  const home = renderConfiguredHome(original, 'Store', 'Customer');
  const extra = { text: 'Cart', callback_data: 'lb:commerce:cart' };
  assert.equal(appendHomeCommerce(home.keyboard, original, [[extra], [extra]]).flat().filter(b => b.callback_data === extra.callback_data).length, 1);
  const customized = full(); customized.buttons.reverse(); customized.buttons[0].title = 'تنبيهاتي'; customized.columns = 1;
  const saved = parseHomeConfiguration(JSON.parse(JSON.stringify(customized)));
  assert.equal(renderConfiguredHome(saved, 'Store', 'Customer').keyboard[0][0].text, '⭐ تنبيهاتي');
});
