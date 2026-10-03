import assert from "node:assert/strict";
import test from "node:test";
import {
  highestPlan,
  isFeatureAvailable,
  isPlanCode,
  isPlanLimitReached,
  planLimitMessage,
  readPlanCode,
} from "./plans.ts";

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
  assert.equal(isFeatureAvailable("PRO", "catalog.multipleImages"), false);
  assert.equal(isFeatureAvailable("BUSINESS", "staff.basic"), false);
});

test("plan limit messages explain the next tier without suggesting a payment", () => {
  assert.match(planLimitMessage("FREE", "productsPerStore"), /Pro/);
  assert.match(planLimitMessage("PRO", "stores"), /Business/);
  assert.match(planLimitMessage("BUSINESS", "stores"), /قريبًا/);
});
