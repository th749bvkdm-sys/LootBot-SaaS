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
