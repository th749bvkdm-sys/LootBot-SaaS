import assert from 'node:assert/strict';
import test from 'node:test';
import { businessRequiresOwner } from './studio-finance-policy.ts';
import { DEFAULT_BUSINESS_CONFIGURATION } from './telegram-business-configuration.ts';
import { financialSegmentClosure, publicCustomerFacts } from './growth-finance-policy.ts';
import { defaultGrowthConfiguration } from './growth-configuration.ts';

test('financial segment closure includes nested and negated derivations but ignores safe cycles', () => {
  const financial = defaultGrowthConfiguration('segment');
  financial.condition = { field: 'TOTAL_SPEND_GREATER_THAN', operator: '>', value: 10 };
  const segment = id => ({ ...defaultGrowthConfiguration('segment'), condition: { field: 'CUSTOMER_SEGMENT', operator: 'NOT_IN', value: [id] } });
  const closure = financialSegmentClosure([{ id: 'third', configuration: segment('second') }, { id: 'second', configuration: segment('first') }, { id: 'first', configuration: financial }, { id: 'cycle-a', configuration: segment('cycle-b') }, { id: 'cycle-b', configuration: segment('cycle-a') }, { id: 'invalid', configuration: null }]);
  assert.deepEqual([...closure].sort(), ['first', 'invalid', 'second', 'third']);
  assert.deepEqual(publicCustomerFacts({ TOTAL_SPEND_GREATER_THAN: 12, ORDER_VALUE: 10, CUSTOMER_SEGMENT: ['third', 'safe'] }, false, closure), { CUSTOMER_SEGMENT: ['safe'] });
});

test('Business customer financial rules require ownership in screens, blocks and button branches', () => {
  const config = structuredClone(DEFAULT_BUSINESS_CONFIGURATION);
  assert.equal(businessRequiresOwner(config), false);
  config.screens[0].buttons[0].condition = { op: 'OR', rules: [{ field: 'VIP_LEVEL', operator: '>', value: 1 }, { field: 'ORDER_VALUE', operator: '<', value: 100 }] };
  assert.equal(businessRequiresOwner(config), true);
  config.screens[0].buttons[0].condition = { field: 'CUSTOMER_SEGMENT', operator: 'NOT_IN', value: ['derived'] };
  assert.equal(businessRequiresOwner(config, new Set(['derived'])), true);
  config.screens[0].buttons[0].condition = null;
  config.screens[0].blocks[0].condition = { field: 'TOTAL_SPEND_GREATER_THAN', operator: '>=', value: 100 };
  assert.equal(businessRequiresOwner(config), true);
  config.screens[0].blocks[0].condition = null;
  config.screens[0].condition = { field: 'CUSTOMER_SEGMENT', operator: '=', value: 'derived' };
  assert.equal(businessRequiresOwner(config, new Set(['derived'])), true);
});
