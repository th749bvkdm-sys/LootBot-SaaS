import assert from "node:assert/strict";
import test from "node:test";
import {
  highestPlan,
  isFeatureAvailable,
  isPlanCode,
  isPlanLimitReached,
  planLimitMessage,
  readPlanCode,
  readPlanDefinition,
  validatePlanDefinition,
  PLAN_CATALOG,
  FeatureGateService,
  FeatureAccessError,
} from "./plans.ts";
import { createLoginRateLimiter } from "./login-rate-limit.ts";
import { parseTelegramDesignerSettings, readTelegramDesignerSettings } from "./telegram-designer.ts";
import { parseGalleryInput, galleryWithLegacyFallback } from "./product-gallery.ts";
import { productMediaRequest } from "./telegram-product-media.ts";
import { passwordHash, verifyPassword, safeStringEqual, newOpaqueToken, sha256 } from "./security.ts";
import { parseNavigationCallback, defaultHomeKeyboard, navigationFooter, paginationButtons, createSearchContexts } from "./telegram-navigation.ts";
import { DEFAULT_HOME_CONFIGURATION, parseHomeConfiguration, renderConfiguredHome, readHomeStudio } from "./telegram-home-configuration.ts";
import { DEFAULT_BUSINESS_CONFIGURATION, parseBusinessConfiguration, renderBusinessScreen, readBusinessStudio } from './telegram-business-configuration.ts';
import { createBusinessNavigation } from './telegram-business-navigation.ts';

test("new and malformed store settings resolve to the safe FREE plan", () => {
  assert.equal(readPlanCode({}), "FREE");
  assert.equal(readPlanCode(null), "FREE");
  assert.equal(readPlanCode({ plan: { code: "UNKNOWN" } }), "FREE");
  assert.equal(readPlanCode({ plan: { code: "PRO" } }), "PRO");
});

test("only configured plan codes can be assigned", () => {
  assert.equal(isPlanCode("BUSINESS"), true);
  assert.equal(isPlanCode("SUPERADMIN"), false);
  assert.equal(isPlanCode(null), false);
});

test("an account uses its highest assigned store plan for its store limit", () => {
  assert.equal(highestPlan([]), "FREE");
  assert.equal(highestPlan(["FREE", "PRO"]), "PRO");
  assert.equal(highestPlan(["BUSINESS", "PRO"]), "BUSINESS");
});

test("limits distinguish tiers and block at the configured boundary", () => {
  assert.equal(isPlanLimitReached("FREE", "productsPerStore", 29), false);
  assert.equal(isPlanLimitReached("FREE", "productsPerStore", 30), true);
  assert.equal(isPlanLimitReached("PRO", "productsPerStore", 30), false);
  assert.equal(isPlanLimitReached("BUSINESS", "stores", 20), true);
});

test("unimplemented paid features stay disabled instead of being promised", () => {
  assert.equal(isFeatureAvailable("FREE", "catalog.basic"), true);
  assert.equal(isFeatureAvailable("FREE", "catalog.bulkTools"), false);
  assert.equal(isFeatureAvailable("PRO", "catalog.bulkTools"), true);
  assert.equal(isFeatureAvailable("PRO", "catalog.multipleImages"), true);
  assert.equal(isFeatureAvailable("BUSINESS", "staff.basic"), false);
  assert.equal(isFeatureAvailable("FREE", "analytics.reports"), false);
  assert.equal(isFeatureAvailable("BUSINESS", "analytics.reports"), true);
});

test("plan limit messages explain the next tier without suggesting a payment", () => {
  assert.match(planLimitMessage("FREE", "productsPerStore"), /Pro/);
  assert.match(planLimitMessage("PRO", "stores"), /Business/);
  assert.match(planLimitMessage("BUSINESS", "stores"), /قريبًا/);
});

test("plan definitions reject invalid limits, missing features, and fake feature enablement", () => {
  assert.equal(validatePlanDefinition(PLAN_CATALOG.FREE), true);
  assert.equal(validatePlanDefinition({ ...PLAN_CATALOG.PRO, limits: { ...PLAN_CATALOG.PRO.limits, productsPerStore: 0 } }), false);
  assert.equal(validatePlanDefinition({ ...PLAN_CATALOG.PRO, features: { ...PLAN_CATALOG.PRO.features, "catalog.bulkTools": "yes" } }), false);
  assert.equal(validatePlanDefinition({ ...PLAN_CATALOG.BUSINESS, features: { ...PLAN_CATALOG.BUSINESS.features, "staff.basic": true } }), false);
});

test("login throttling is isolated by client IP, expires, and resets after success", () => {
  let now = 10_000;
  const limiter = createLoginRateLimiter({ windowMs: 1_000, maxAttempts: 2, now: () => now });
  assert.equal(limiter.isLimited("client-a"), false);
  assert.equal(limiter.isLimited("client-a"), false);
  assert.equal(limiter.isLimited("client-a"), true);
  assert.equal(limiter.isLimited("client-b"), false);
  limiter.clear("client-a");
  assert.equal(limiter.isLimited("client-a"), false);
  now += 1_001;
  assert.equal(limiter.isLimited("client-b"), false);
});

test("Telegram designer settings validate message lengths and safely default old settings", () => {
  assert.deepEqual(readTelegramDesignerSettings({}), parseTelegramDesignerSettings({ welcomeMessage: "", helpMessage: "", catalogIntro: "", showStock: true }));
  assert.equal(parseTelegramDesignerSettings({ welcomeMessage: "x".repeat(401), helpMessage: "", catalogIntro: "", showStock: true }), null);
  assert.equal(parseTelegramDesignerSettings({ welcomeMessage: " hi ", helpMessage: "", catalogIntro: "", showStock: false }).welcomeMessage, "hi");
  assert.equal(readTelegramDesignerSettings({ telegramDesigner: { welcomeMessage: "old" } }).showStock, true);
});

test("advanced Telegram messages are an enforceable Pro entitlement", () => {
  assert.equal(isFeatureAvailable("FREE", "telegram.advanced"), false);
  assert.equal(isFeatureAvailable("PRO", "telegram.advanced"), true);
  assert.equal(isFeatureAvailable("BUSINESS", "telegram.advanced"), true);
});

test("gallery validates protocols, credentials, duplicates, bounds, and primary selection", () => {
  const image = { imageUrl: "https://images.example/a.jpg", altText: "Main" };
  assert.deepEqual(parseGalleryInput({ images: [image], primaryIndex: 0 }), { images: [image], primaryIndex: 0 });
  for (const imageUrl of ["javascript:alert(1)", "file:///a.jpg", "https://user:password@example.com/a.jpg", ""]) {
    assert.equal(parseGalleryInput({ images: [{ imageUrl }] }), null);
  }
  assert.equal(parseGalleryInput({ images: [image, image] }), null);
  assert.equal(parseGalleryInput({ images: Array.from({ length: 11 }, (_, index) => ({ imageUrl: `https://images.example/${index}.jpg` })) }), null);
  assert.equal(parseGalleryInput({ images: [image], primaryIndex: 1 }), null);
  assert.equal(parseGalleryInput({ images: [], primaryIndex: 1 }), null);
  assert.deepEqual(parseGalleryInput({ images: [] }), { images: [], primaryIndex: 0 });
  assert.equal(parseGalleryInput({ images: [{ ...image, altText: "x".repeat(161) }] }), null);
});

test("legacy single-image products remain readable and stored galleries take precedence", () => {
  assert.equal(galleryWithLegacyFallback([], "https://images.example/old.jpg")[0].isPrimary, true);
  assert.deepEqual(galleryWithLegacyFallback([], null), []);
  const stored = [{ imageUrl: "https://images.example/new.jpg", altText: "", isPrimary: true }];
  assert.deepEqual(galleryWithLegacyFallback(stored, "https://images.example/old.jpg"), stored);
  assert.equal(isFeatureAvailable("FREE", "catalog.multipleImages"), false);
  assert.equal(isFeatureAvailable("BUSINESS", "catalog.multipleImages"), true);
});

test("saved administrator settings keep their limits as new features are added", () => {
  const old = structuredClone(PLAN_CATALOG.PRO);
  delete old.features['telegram.advanced'];
  old.limits.productsPerStore = 75;
  const result = readPlanDefinition(old, 'PRO');
  assert.equal(result.limits.productsPerStore, 75);
  assert.equal(result.features['telegram.advanced'], true);
  assert.equal(readPlanDefinition({ ...old, features: { ...old.features, 'fake.feature': true } }, 'PRO'), null);
});

test("Telegram photos use a single photo or bounded media group with valid captions", () => {
  assert.equal(productMediaRequest(1, [], 'caption'), null);
  assert.equal(productMediaRequest(1, [{ imageUrl: 'https://example.com/a.jpg' }], 'caption').method, 'sendPhoto');
  const images = Array.from({ length: 12 }, (_, index) => ({ imageUrl: `https://example.com/${index}.jpg` }));
  const request = productMediaRequest(1, images, 'x'.repeat(1500));
  assert.equal(request.method, 'sendMediaGroup');
  assert.equal(request.body.media.length, 10);
  assert.equal(request.body.media[0].caption.length, 1024);
  assert.equal(request.body.media[1].caption, undefined);
});

test("central feature gate enforces each tier and follows administrative changes", async () => {
  const catalog = structuredClone(PLAN_CATALOG);
  const plans = { free: 'FREE', pro: 'PRO', business: 'BUSINESS' };
  const gate = new FeatureGateService({
    load: async id => ({ plan: plans[id], catalog }),
    loadUsage: async () => ({ stores: 1, productsPerStore: 31, categoriesPerStore: 3, ordersPerMonth: 10 }),
  });
  await assert.rejects(gate.require('free', 'catalog.multipleImages'), FeatureAccessError);
  await gate.require('pro', 'catalog.multipleImages');
  await assert.rejects(gate.require('pro', 'analytics.reports'), FeatureAccessError);
  await gate.require('business', 'analytics.reports');
  assert.equal(await gate.isPlanAtLeast('pro', 'BUSINESS'), false);
  assert.equal(await gate.isPlanAtLeast('business', 'PRO'), true);
  assert.equal(await gate.getUsage('free', 'productsPerStore'), 31);
  assert.equal(await gate.remaining('free', 'productsPerStore'), 0);
  assert.equal(await gate.getLimit('pro', 'productsPerStore'), 500);
  catalog.PRO.limits.productsPerStore = 40;
  catalog.PRO.features['catalog.multipleImages'] = false;
  assert.equal(await gate.remaining('pro', 'productsPerStore'), 9);
  await assert.rejects(gate.require('pro', 'catalog.multipleImages'), FeatureAccessError);
});

test("password checks accept the correct password and reject wrong or malformed stored hashes", async () => {
  const stored = await passwordHash('test-only-correct-password');
  assert.equal(await verifyPassword('test-only-correct-password', stored), true);
  assert.equal(await verifyPassword('wrong-password', stored), false);
  for (const malformed of ['scrypt$salt$zz', 'scrypt$salt$', 'scrypt$salt$aa', stored + '$extra', 'plain$password', '']) {
    assert.equal(await verifyPassword('anything', malformed), false);
  }
  assert.notEqual(await passwordHash('test-only-correct-password'), stored);
});

test("session and CSRF token primitives are opaque and comparisons reject unequal lengths", () => {
  const first = newOpaqueToken(); const second = newOpaqueToken();
  assert.ok(first.length >= 32);
  assert.notEqual(first, second);
  assert.equal(safeStringEqual(first, second), false);
  assert.equal(safeStringEqual(first, first + 'x'), false);
  assert.equal(safeStringEqual(sha256(first), sha256(first)), true);
});

test("default store home exposes real navigable actions with safe callback payloads", () => {
  const buttons = defaultHomeKeyboard().flat();
  assert.equal(buttons.length, 5);
  assert.ok(buttons.every(button => parseNavigationCallback(button.callback_data)));
  assert.equal(buttons.some(button => /points|referrals|coupons/.test(button.callback_data)), false);
  assert.equal(parseNavigationCallback('https://example.com'), null);
  assert.equal(parseNavigationCallback('lb:products:0'), null);
  assert.equal(parseNavigationCallback('lb:products:-1'), null);
  assert.equal(parseNavigationCallback('x'.repeat(65)), null);
  assert.equal(parseNavigationCallback('lb:category:../../other-store:1'), null);
});

test("pagination and back preserve the originating category or search page", () => {
  const categoryId = '12345678-1234-1234-1234-123456789abc';
  const rows = paginationButtons(`lb:category:${categoryId}`, 2, true);
  assert.deepEqual(rows[0].map(button => parseNavigationCallback(button.callback_data)), [
    { kind: 'category', id: categoryId, page: 1 }, { kind: 'category', id: categoryId, page: 3 },
  ]);
  assert.equal(navigationFooter('lb:search:2')[0][0].callback_data, 'lb:search:2');
  assert.deepEqual(paginationButtons('lb:products', 1, false), []);
  assert.deepEqual(parseNavigationCallback('lb:product:123456789abc:abcdef123456'), { kind: 'product', code: '123456789abc', parentRef: 'abcdef123456' });
});

test("conversation search context isolates stores, users and chats and expires safely", () => {
  let now = 0; const contexts = createSearchContexts(() => now);
  contexts.set('store-a', 1, 10, 'keyboard');
  assert.equal(contexts.get('store-a', 1, 10), 'keyboard');
  assert.equal(contexts.get('store-b', 1, 10), null);
  assert.equal(contexts.get('store-a', 2, 10), null);
  assert.equal(contexts.get('store-a', 1, 11), null);
  now += 15 * 60_000;
  assert.equal(contexts.get('store-a', 1, 10), null);
  contexts.set('store-a', 1, 10, '');
  assert.equal(contexts.get('store-a', 1, 10), '');
  contexts.clear('store-a', 1, 10);
  assert.equal(contexts.get('store-a', 1, 10), null);
});

test("home configuration accepts real actions only and rejects empty or duplicate menus", () => {
  assert.ok(parseHomeConfiguration(DEFAULT_HOME_CONFIGURATION));
  assert.equal(parseHomeConfiguration({ ...DEFAULT_HOME_CONFIGURATION, columns: 4 }), null);
  assert.equal(parseHomeConfiguration({ ...DEFAULT_HOME_CONFIGURATION, welcomeMessage: '' }), null);
  assert.equal(parseHomeConfiguration({ ...DEFAULT_HOME_CONFIGURATION, buttons: DEFAULT_HOME_CONFIGURATION.buttons.map(button => ({ ...button, enabled: false })) }), null);
  const invalid = structuredClone(DEFAULT_HOME_CONFIGURATION);
  invalid.buttons[0].action = 'RUN_CODE';
  assert.equal(parseHomeConfiguration(invalid), null);
  invalid.buttons[0].action = 'categories';
  assert.equal(parseHomeConfiguration(invalid), null);
});

test("server preview and home runtime reflect layout, ordering, visibility and customer greeting", () => {
  const configuration = structuredClone(DEFAULT_HOME_CONFIGURATION);
  configuration.columns = 3; configuration.showEmoji = false;
  configuration.buttons.reverse(); configuration.buttons[0].enabled = false;
  const rendered = renderConfiguredHome(configuration, 'Store {{customer}}', 'Ali');
  assert.match(rendered.text, /Store \{\{customer\}\}/);
  assert.match(rendered.text, /Ali/);
  assert.equal(rendered.keyboard[0].length, 3);
  assert.equal(rendered.keyboard[0][0].callback_data, 'lb:orders:1');
  assert.ok(rendered.keyboard.flat().every(button => parseNavigationCallback(button.callback_data)));
  assert.equal(rendered.keyboard.flat().some(button => button.callback_data === 'lb:account'), false);
});

test("draft edits remain independent of published config and published data survives serialization", () => {
  const draft = structuredClone(DEFAULT_HOME_CONFIGURATION); draft.welcomeMessage = 'DRAFT';
  const published = structuredClone(DEFAULT_HOME_CONFIGURATION); published.welcomeMessage = 'PUBLISHED';
  const persisted = JSON.parse(JSON.stringify({ draft, published, revision: 2 }));
  const studio = readHomeStudio(persisted);
  assert.equal(renderConfiguredHome(studio.published, 'store', 'customer').text, 'PUBLISHED');
  assert.equal(studio.draft.welcomeMessage, 'DRAFT');
  assert.equal(studio.revision, 2);
  assert.equal(readHomeStudio({ published: { invalid: true } }).published, null);
  assert.deepEqual(readHomeStudio(null).draft, DEFAULT_HOME_CONFIGURATION);
});

test("nested navigation preserves the list page and all controls fit Telegram callback limits", () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  assert.deepEqual(parseNavigationCallback(`lb:category:${id}:2:3`), { kind: 'category', id, page: 2, parentPage: 3 });
  assert.deepEqual(parseNavigationCallback(`lb:order:${id}:7`), { kind: 'order', id, parentPage: 7 });
  assert.equal(parseNavigationCallback(`lb:order:${id}:0`), null);
  assert.equal(parseNavigationCallback(`lb:category:${id}:1:0`), null);
  const rows = paginationButtons(`lb:category:${id}`, 99998, true, ':99999');
  for (const button of rows.flat()) {
    assert.ok(Buffer.byteLength(button.callback_data) <= 64);
    assert.equal(parseNavigationCallback(button.callback_data).parentPage, 99999);
  }
  assert.equal(paginationButtons('lb:products', 99999, true).flat().length, 1);
  const footer = navigationFooter('lb:orders:3', `lb:order:${id}:3`).flat();
  assert.deepEqual(footer.map(button => button.callback_data), ['lb:orders:3', 'lb:home', `lb:order:${id}:3`, 'lb:close']);
  assert.ok(footer.every(button => parseNavigationCallback(button.callback_data)));
});

test("home header and footer persist, render identically, and reject invalid values", () => {
  const input = { ...DEFAULT_HOME_CONFIGURATION, headerTitle: '{{store}}', headerSubtitle: '  Premium games  ', footer: 'Thanks {{customer}}' };
  const config = parseHomeConfiguration(JSON.parse(JSON.stringify(input)));
  assert.equal(config.headerSubtitle, 'Premium games');
  const preview = renderConfiguredHome(config, 'LootBot', 'Ali');
  const runtime = renderConfiguredHome(readHomeStudio({ published: config }).published, 'LootBot', 'Ali');
  assert.deepEqual(preview, runtime);
  assert.ok(preview.text.startsWith('LootBot\n\nPremium games'));
  assert.ok(preview.text.endsWith('Thanks Ali'));
  assert.equal(parseHomeConfiguration({ ...input, headerTitle: 'x'.repeat(101) }), null);
  assert.equal(parseHomeConfiguration({ ...input, footer: { html: '<script>' } }), null);
});

test("search snapshots and gallery callbacks remain scoped and bounded", () => {
  assert.deepEqual(parseNavigationCallback('lb:search:3:abcdef123456'), { kind: 'search', page: 3, queryRef: 'abcdef123456' });
  assert.deepEqual(parseNavigationCallback('lb:search:clear'), { kind: 'searchClear' });
  assert.deepEqual(parseNavigationCallback('lb:gallery:123456789abc:9:abcdef123456'), { kind: 'gallery', code: '123456789abc', index: 9, parentRef: 'abcdef123456' });
  for (const invalid of ['lb:gallery:123456789abc:10:abcdef123456', 'lb:gallery:123456789abc:-1:abcdef123456', 'lb:search:0:abcdef123456', 'lb:search:1:invalid']) assert.equal(parseNavigationCallback(invalid), null);
  const contexts = createSearchContexts();
  contexts.set('store-a:snapshot-a', 1, 10, 'keyboard');
  contexts.set('store-a:snapshot-b', 1, 10, 'mouse');
  assert.equal(contexts.get('store-a:snapshot-a', 1, 10), 'keyboard');
  assert.equal(contexts.get('store-a:snapshot-b', 1, 10), 'mouse');
  assert.equal(contexts.get('store-a:snapshot-a', 2, 10), null);
  assert.equal(contexts.get('store-b:snapshot-a', 1, 10), null);
});

const businessFixture = () => {
  const config = structuredClone(DEFAULT_BUSINESS_CONFIGURATION);
  config.screens.push({ id: 'vip', parentId: 'home', title: 'Customers', enabled: true, audience: 'returning', startsAt: null, endsAt: null, blocks: [{ id: 'text', type: 'HEADER', text: 'Welcome {{customer}}', enabled: true }], buttons: [] });
  config.screens.push({ id: 'faq', parentId: 'vip', title: 'FAQ', enabled: true, audience: 'all', startsAt: null, endsAt: null, blocks: [{ id: 'faq', type: 'FAQ', text: 'Question and answer', enabled: true }, { id: 'divider', type: 'DIVIDER', text: '', enabled: true }], buttons: [] });
  return config;
};
const viewer = { storeName: 'LootBot', customerName: 'Ali', returning: true, now: Date.parse('2026-10-04T12:00:00.000Z') };
test('Business screens render actual actions and preserve screen parents', () => {
  const config = parseBusinessConfiguration(businessFixture());
  assert.ok(config);
  const home = renderBusinessScreen(config, 'home', viewer);
  assert.ok(home.keyboard.flat().some(b => b.callback_data === 'lb:screen:vip'));
  const faq = renderBusinessScreen(config, 'faq', viewer);
  assert.match(faq.text, /❓ Question and answer/);
  assert.match(faq.text, /──────────/);
  assert.ok(faq.keyboard.flat().some(b => b.text.includes('رجوع') && b.callback_data === 'lb:screen:vip'));
  assert.ok(faq.keyboard.flat().every(b => parseNavigationCallback(b.callback_data)));
  assert.equal(renderBusinessScreen(config, 'deleted', viewer), null);
});
test('Business visibility enforces audience, ancestors and inclusive/exclusive time boundaries', () => {
  const config = businessFixture();
  assert.equal(renderBusinessScreen(config, 'faq', { ...viewer, returning: false }), null);
  config.screens[1].startsAt = '2026-10-04T12:00:00.000Z';
  config.screens[1].endsAt = '2026-10-04T13:00:00.000Z';
  assert.ok(renderBusinessScreen(config, 'faq', viewer));
  assert.equal(renderBusinessScreen(config, 'faq', { ...viewer, now: viewer.now - 1 }), null);
  assert.equal(renderBusinessScreen(config, 'faq', { ...viewer, now: viewer.now + 3600000 }), null);
  config.screens[1].enabled = false;
  assert.equal(renderBusinessScreen(config, 'faq', viewer), null);
  assert.equal(renderBusinessScreen(config, 'home', viewer).keyboard.flat().some(b => b.callback_data === 'lb:screen:vip'), false);
});
test('Business validator rejects cycles, missing targets, bad dates, unknown actions and invalid root rules', () => {
  for (const mutate of [
    c => c.screens[1].parentId = 'faq',
    c => c.screens[1].parentId = 'deleted',
    c => c.screens[1].id = 'home',
    c => c.screens[1].startsAt = '2026-02-30T12:00:00.000Z',
    c => c.screens[1].startsAt = 'not-a-date',
    c => c.screens[0].audience = 'returning',
    c => c.screens[0].enabled = false,
    c => c.screens[0].buttons[0].action = 'RUN_SCRIPT',
    c => Object.assign(c.screens[0].buttons[0], { action: 'OPEN_SCREEN', target: 'deleted' }),
    c => c.screens[0].blocks[0].text = 'x'.repeat(501),
  ]) { const config = businessFixture(); mutate(config); assert.equal(parseBusinessConfiguration(config), null); }
  const deep = businessFixture(); deep.screens.push({ ...deep.screens[2], id: 'level3', parentId: 'faq' }, { ...deep.screens[2], id: 'level4', parentId: 'level3' });
  assert.equal(parseBusinessConfiguration(deep), null);
});
test('Business draft isolation and serialization use the same renderer for published data', () => {
  const draft = businessFixture(); draft.screens[0].title = 'Draft';
  const published = businessFixture(); published.screens[0].title = 'Published';
  const persisted = readBusinessStudio(JSON.parse(JSON.stringify({ draft, published, revision: 4 })));
  assert.ok(renderBusinessScreen(persisted.published, 'home', viewer).text.startsWith('Published'));
  assert.ok(renderBusinessScreen(persisted.draft, 'home', viewer).text.startsWith('Draft'));
  assert.equal(persisted.revision, 4);
  assert.equal(readBusinessStudio({ published: 'invalid' }).published, null);
});
test('Business empty home falls back to real store actions and text remains within Telegram limits', () => {
  const config = structuredClone(DEFAULT_BUSINESS_CONFIGURATION); config.screens[0].buttons = [];
  const rendered = renderBusinessScreen(config, 'home', viewer);
  assert.ok(rendered.keyboard.flat().some(b => b.callback_data === 'lb:products:1'));
  config.screens[0].blocks[0].text = '{{store}}'.repeat(50);
  assert.ok(renderBusinessScreen(config, 'home', { ...viewer, storeName: 'x'.repeat(120) }).text.length <= 3800);
});
test('Business entitlement is unavailable in Free/Pro and old administrative plan data gains its default', () => {
  assert.equal(isFeatureAvailable('FREE', 'telegram.studio'), false);
  assert.equal(isFeatureAvailable('PRO', 'telegram.studio'), false);
  assert.equal(isFeatureAvailable('BUSINESS', 'telegram.studio'), true);
  const old = structuredClone(PLAN_CATALOG.BUSINESS); delete old.features['telegram.studio'];
  assert.equal(readPlanDefinition(old, 'BUSINESS').features['telegram.studio'], true);
});

test('Business navigation preserves the source screen across real actions and expires per customer', () => {
  let now = 0; const navigation = createBusinessNavigation(() => now);
  const rows = navigation.wrap('store-a', 1, 10, 'faq', [[{ text: 'Products', callback_data: 'lb:products:2' }], ...navigationFooter('lb:home', 'lb:products:2')]);
  const reference = parseNavigationCallback(rows[0][0].callback_data);
  assert.equal(reference.kind, 'contextual');
  assert.deepEqual(navigation.read('store-a', 1, 10, reference.ref), { source: 'faq', callback: 'lb:products:2' });
  assert.equal(navigation.read('store-a', 2, 10, reference.ref), null);
  assert.equal(navigation.read('store-a', 1, 11, reference.ref), null);
  assert.equal(navigation.read('store-b', 1, 10, reference.ref), null);
  assert.equal(rows[1][0].callback_data, 'lb:screen:faq');
  assert.equal(rows[1][1].callback_data, 'lb:home');
  navigation.rememberSearchOrigin('store-a', 1, 10, 'faq');
  assert.equal(navigation.searchOrigin('store-a', 1, 10), 'faq');
  assert.equal(navigation.searchOrigin('store-a', 2, 10), null);
  navigation.clearSearchOrigin('store-a', 1, 10);
  assert.equal(navigation.searchOrigin('store-a', 1, 10), null);
  assert.ok(rows.flat().every(b => Buffer.byteLength(b.callback_data) <= 64 && parseNavigationCallback(b.callback_data)));
  now += 15 * 60_000;
  assert.equal(navigation.read('store-a', 1, 10, reference.ref), null);
});
