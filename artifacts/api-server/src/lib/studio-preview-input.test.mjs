import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStudioPreviewInput } from './studio-preview-input.ts';
import { DEFAULT_BUSINESS_CONFIGURATION } from './telegram-business-configuration.ts';

test('studio preview validates identifiers, callbacks, search and design states before rendering', () => {
  const uuid = 'c2d074eb-dbff-44d4-98b0-dfbefa2e547a';
  assert.deepEqual(parseStudioPreviewInput({ customerId: uuid, callbackData: 'lb:products:1', search: 'Actual', state: 'empty' }), { customerId: uuid, callbackData: 'lb:products:1', search: 'Actual', state: 'empty' });
  assert.deepEqual(parseStudioPreviewInput({ customerId: '' }), {});
  for (const invalid of [null, [], 'bad', { customerId: {} }, { customerId: 'bad' }, { customerId: null }, { callbackData: {} }, { callbackData: 'nonsense' }, { callbackData: '' }, { callbackData: 'a'.repeat(65) }, { search: {} }, { search: 'a'.repeat(121) }, { state: {} }, { state: 'completed' }]) assert.equal(parseStudioPreviewInput(invalid), null);
});

test('Business preview requires an owned existing screen and consistent navigation target', () => {
  const config = structuredClone(DEFAULT_BUSINESS_CONFIGURATION);
  config.screens.push({ ...structuredClone(config.screens[0]), id: 'child', parentId: 'home' });
  assert.ok(parseStudioPreviewInput({ screenId: 'home', returning: false }, config));
  assert.ok(parseStudioPreviewInput({ screenId: 'child', returning: true, callbackData: 'lb:screen:child' }, config));
  for (const invalid of [{ returning: false }, { screenId: {}, returning: false }, { screenId: 'missing', returning: false }, { screenId: 'home', returning: 'false' }, { screenId: 'home', returning: false, callbackData: 'lb:screen:missing' }, { screenId: 'home', returning: false, callbackData: 'lb:screen:child' }, { screenId: 'child', returning: false, callbackData: 'lb:home' }]) assert.equal(parseStudioPreviewInput(invalid, config), null);
});
