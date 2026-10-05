import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRule, evaluateRule, ruleUses } from './customer-rules.ts';
import { parseGrowthConfiguration, parseGrowthAudience, defaultGrowthConfiguration, actionMatches, audienceMatches, renderGrowthText, GROWTH_TEMPLATES, safeHttps } from './growth-configuration.ts';
const id = '12345678-1234-1234-1234-123456789abc';
const facts = { USER_LOGGED_IN: true, USER_NEW: false, HAS_ORDERS: true, HAS_ACTIVE_ORDER: true, VIP_LEVEL: 3, POINTS_GREATER_THAN: 20, ORDER_COUNT_GREATER_THAN: 2, TOTAL_SPEND_GREATER_THAN: 100, HAS_COUPON: false, HAS_REFERRAL: true, CUSTOMER_TAG: ['vip'], CUSTOMER_SEGMENT: [id], DATE_RANGE: Date.parse('2026-10-05T12:00:00.000Z'), TIME_RANGE: '23:00', CAMPAIGN: '', STORE_MODE: 'normal', PLAN: 'BUSINESS', ORDER_VALUE: 40, PRODUCT: [id], CATEGORY: [] };
test('dynamic rules enforce typed operators, finite numbers, bounds and nonempty groups', () => {
  for (const rule of [ { field: 'RUN_CODE', operator: '=', value: true }, { field: 'VIP_LEVEL', operator: 'IN', value: [1] }, { field: 'VIP_LEVEL', operator: '>', value: Infinity }, { field: 'HAS_ORDERS', operator: '>', value: true }, { field: 'CUSTOMER_TAG', operator: 'IN', value: [] }, { op: 'AND', rules: [] }, { field: 'HAS_ORDERS', operator: '=', value: 'true' } ]) assert.equal(parseRule(rule), null);
  assert.ok(parseRule({ field: 'VIP_LEVEL', operator: '>=', value: 3 }));
  let deep = { field: 'HAS_ORDERS', operator: '=', value: true }; for (let i = 0; i < 7; i++) deep = { op: 'AND', rules: [deep] }; assert.equal(parseRule(deep), null);
  assert.equal(parseRule({ op: 'OR', rules: Array.from({ length: 20 }, () => ({ op: 'AND', rules: Array.from({ length: 3 }, () => ({ field: 'HAS_ORDERS', operator: '=', value: true })) })) }), null);
});
test('backend rules evaluate nested AND/OR, real membership and missing facts fail closed', () => {
  const rule = parseRule({ op: 'AND', rules: [{ field: 'VIP_LEVEL', operator: '>=', value: 3 }, { op: 'OR', rules: [{ field: 'HAS_COUPON', operator: '=', value: true }, { field: 'CUSTOMER_SEGMENT', operator: 'IN', value: [id] }] }] });
  assert.equal(evaluateRule(rule, facts), true); assert.equal(evaluateRule(rule, { ...facts, VIP_LEVEL: 1 }), false);
  assert.equal(evaluateRule({ field: 'HAS_ORDERS', operator: '!=', value: true }, {}), false);
  assert.equal(ruleUses(rule, 'CUSTOMER_SEGMENT'), true); assert.equal(ruleUses(rule, 'PLAN'), false);
  assert.equal(evaluateRule({ field: 'CUSTOMER_TAG', operator: 'NOT_IN', value: ['vip'] }, facts), false);
});
test('date intervals validate real dates, include start and exclude end; time can span midnight', () => {
  const range = { field: 'DATE_RANGE', operator: 'IN', value: ['2026-10-05T12:00:00.000Z', '2026-10-06T12:00:00.000Z'] };
  assert.ok(parseRule(range)); assert.equal(evaluateRule(range, facts), true); assert.equal(evaluateRule(range, { ...facts, DATE_RANGE: Date.parse(range.value[1]) }), false);
  assert.equal(parseRule({ ...range, value: ['2026-02-30T12:00:00.000Z', range.value[1]] }), null);
  const time = { field: 'TIME_RANGE', operator: 'IN', value: ['22:00', '06:00'] }; assert.equal(evaluateRule(time, facts), true); assert.equal(evaluateRule(time, { ...facts, TIME_RANGE: '06:00' }), false); assert.equal(evaluateRule(time, { ...facts, TIME_RANGE: '05:59' }), true);
  assert.equal(parseRule({ ...time, value: ['24:00', '06:00'] }), null);
});
test('growth defaults serialize safely, segments cannot recursively refer to segments', () => {
  for (const kind of ['segment', 'broadcast', 'automation', 'journey']) assert.ok(parseGrowthConfiguration(JSON.parse(JSON.stringify(defaultGrowthConfiguration(kind)))));
  assert.equal(parseGrowthConfiguration({ ...defaultGrowthConfiguration('segment'), condition: { field: 'CUSTOMER_SEGMENT', operator: '=', value: id } }), null);
  assert.equal(parseGrowthConfiguration({ ...defaultGrowthConfiguration('automation'), trigger: 'SCHEDULED_TIME' }), null);
  assert.equal(parseGrowthConfiguration({ ...defaultGrowthConfiguration('automation'), trigger: 'RUN_CODE' }), null);
  assert.equal(parseGrowthConfiguration({ ...defaultGrowthConfiguration('automation'), inactivityDays: 0 }), null);
});
test('growth validates targets, safe HTTPS, message/button limits, delays and point loops', () => {
  const config = defaultGrowthConfiguration('journey'); const action = config.actions[0];
  for (const changes of [{ type: 'SEND_PRODUCT', target: 'foreign-script' }, { text: 'x'.repeat(3001) }, { delaySeconds: 604801 }, { amount: NaN }, { imageUrl: 'https://user:password@example.com/image.jpg' }, { type: 'ADD_POINTS', amount: 0 }, { type: 'ADD_TAG', target: 'x'.repeat(41) }, { type: 'RUN_SCRIPT' }]) assert.equal(parseGrowthConfiguration({ ...config, actions: [{ ...action, ...changes }] }), null);
  assert.ok(parseGrowthConfiguration({ ...config, actions: [{ ...action, type: 'SEND_COUPON', target: id }] }));
  assert.equal(parseGrowthConfiguration({ ...config, trigger: 'POINTS_EARNED', actions: [{ ...action, type: 'ADD_POINTS', amount: 5 }] }), null);
  assert.equal(parseGrowthConfiguration({ ...config, actions: [{ ...action, buttons: [{ text: 'Danger', type: 'OPEN_URL', target: 'javascript:alert(1)' }] }] }), null);
  assert.ok(parseGrowthConfiguration({ ...config, actions: [{ ...action, buttons: [{ text: 'Product', type: 'OPEN_PRODUCT', target: id }, { text: 'Home', type: 'OPEN_HOME', target: '' }] }] }));
  assert.equal(safeHttps('file:///private'), false); assert.equal(safeHttps('https://example.com/photo.jpg'), true);
});
test('journey branches require a condition and execute the explicit matching branch', () => {
  const config = defaultGrowthConfiguration('journey'); const action = { ...config.actions[0], condition: { field: 'VIP_LEVEL', operator: '>=', value: 3 } };
  assert.equal(actionMatches(action, facts), true); assert.equal(actionMatches({ ...action, branch: 'otherwise' }, facts), false);
  assert.equal(actionMatches({ ...action, branch: 'otherwise' }, { ...facts, VIP_LEVEL: 1 }), true);
  assert.equal(parseGrowthConfiguration({ ...config, actions: [{ ...action, condition: null, branch: 'otherwise' }] }), null);
});
test('broadcast audiences include all, VIP, inactive, spend, segment and selected customers', () => {
  const customer = { id, lastSeenAt: '2026-09-01T00:00:00.000Z' }; const base = parseGrowthAudience(undefined); const now = Date.parse('2026-10-05T00:00:00.000Z');
  for (const audience of [base, { ...base, type: 'vip', minimum: 3 }, { ...base, type: 'highSpend', minimum: 100 }, { ...base, type: 'segment', segmentId: id }, { ...base, type: 'selected', customerIds: [id] }, { ...base, type: 'inactive', inactivityDays: 14 }]) assert.equal(audienceMatches(audience, customer, facts, now), true);
  assert.equal(audienceMatches({ ...base, type: 'vip', minimum: 4 }, customer, facts, now), false);
  assert.equal(audienceMatches({ ...base, type: 'selected', customerIds: [] }, customer, facts, now), false);
  assert.equal(parseGrowthAudience({ ...base, type: 'selected', customerIds: [] }), null); assert.equal(parseGrowthAudience({ ...base, type: 'selected', customerIds: [id, id] }), null);
  assert.equal(parseGrowthAudience({ ...base, type: 'segment', segmentId: 'not-a-reference' }), null);
});
test('growth messages substitute names once and all seven templates are real editable actions', () => {
  assert.equal(renderGrowthText('Welcome {{customer}} to {{store}}', 'Store {{customer}}', 'Ali'), 'Welcome Ali to Store {{customer}}');
  assert.equal(Object.keys(GROWTH_TEMPLATES).length, 7);
  for (const template of Object.values(GROWTH_TEMPLATES)) { const config = defaultGrowthConfiguration('broadcast'); config.actions[0] = { ...config.actions[0], text: template.text, type: template.type, target: ['SEND_PRODUCT', 'SEND_COUPON'].includes(template.type) ? id : '' }; assert.ok(parseGrowthConfiguration(config)); }
});
