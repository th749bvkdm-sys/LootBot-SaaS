import assert from 'node:assert/strict';
import test from 'node:test';
import { growthRequiresOwner, publicCustomerFacts } from './growth-finance-policy.ts';
import { defaultGrowthConfiguration } from './growth-configuration.ts';

test('staff facts hide spend and financial segment membership without changing owner facts', () => {
  const facts = { TOTAL_SPEND_GREATER_THAN: 1500, ORDER_VALUE: 100, VIP_LEVEL: 2, CUSTOMER_SEGMENT: ['safe', 'financial'] };
  const result = publicCustomerFacts(facts, false, new Set(['financial']));
  assert.equal(Object.hasOwn(result, 'TOTAL_SPEND_GREATER_THAN'), false);
  assert.equal(Object.hasOwn(result, 'ORDER_VALUE'), false);
  assert.deepEqual(result.CUSTOMER_SEGMENT, ['safe']);
  assert.equal(result.VIP_LEVEL, 2);
  assert.deepEqual(publicCustomerFacts(facts, true), facts);
});

test('financial threshold rules, alternate branches and audiences require owner access', () => {
  const c = defaultGrowthConfiguration('journey');
  assert.equal(growthRequiresOwner(c), false);
  c.actions[0].condition = { op: 'OR', rules: [{ field: 'VIP_LEVEL', operator: '>=', value: 1 }, { field: 'TOTAL_SPEND_GREATER_THAN', operator: '>', value: 5 }] };
  c.actions[0].branch = 'otherwise';
  assert.equal(growthRequiresOwner(c), true);
  c.actions[0].condition = null;
  c.audience = { type: 'highSpend', minimum: 10, customerIds: [], inactivityDays: 14, segmentId: '' };
  assert.equal(growthRequiresOwner(c), true);
});

test('indirect financial segment audiences and rule references require owner access', () => {
  const c = defaultGrowthConfiguration('broadcast');
  c.audience = { type: 'segment', minimum: 1, customerIds: [], inactivityDays: 14, segmentId: 'financial' };
  assert.equal(growthRequiresOwner(c, new Set(['financial'])), true);
  c.audience.type = 'all';
  c.condition = { field: 'CUSTOMER_SEGMENT', operator: 'NOT_IN', value: ['financial'] };
  assert.equal(growthRequiresOwner(c, new Set(['financial'])), true);
});
