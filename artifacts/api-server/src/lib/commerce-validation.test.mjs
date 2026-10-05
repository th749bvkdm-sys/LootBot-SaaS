import assert from 'node:assert/strict';
import test from 'node:test';
import { couponDiscount, parseCoupon, referralCustomerId, configuredReward, rewardBalance } from './commerce-validation.ts';

const base = { enabled: true, percent: 15, minimum: '10.00', maxUses: 3, uses: 0, expiresAt: null };
test('coupon uses integer cents, minimum boundary, and rounds the discount down', () => {
  assert.equal(couponDiscount(1000, base), 150);
  assert.equal(couponDiscount(1001, base), 150);
  assert.equal(couponDiscount(999, base), null);
  assert.equal(couponDiscount(1000.1, base), null);
});
test('coupon rejects disabled, exhausted, expired and malformed monetary records', () => {
  for (const change of [{ enabled: false }, { uses: 3 }, { percent: 101 }, { percent: -1 }, { minimum: 'invalid' }, { minimum: -1 }, { maxUses: 0 }, { uses: -1 }, { expiresAt: 'invalid' }, { expiresAt: new Date(1000) }]) assert.equal(couponDiscount(1000, { ...base, ...change }, 1000), null);
  assert.equal(couponDiscount(1000, { ...base, expiresAt: new Date(1001) }, 1000), 150);
});
test('coupon input is bounded and dates must be canonical ISO timestamps', () => {
  const input = { code: ' welcome ', percent: 20, minimum: 9.99, maxUses: 10, enabled: true, expiresAt: null };
  assert.equal(parseCoupon(input)?.code, 'WELCOME');
  assert.equal(parseCoupon(input)?.minimum, '9.99');
  for (const change of [{ code: 'x' }, { code: '<script>' }, { code: 'a'.repeat(25) }, { percent: 1.5 }, { minimum: Infinity }, { minimum: -1 }, { maxUses: 0 }, { maxUses: 1000001 }, { enabled: 'true' }, { expiresAt: '2026-10-05' }, { expiresAt: '2026-02-30T00:00:00.000Z' }]) assert.equal(parseCoupon({ ...input, ...change }), null);
  assert.ok(parseCoupon({ ...input, expiresAt: '2027-01-01T00:00:00.000Z' }));
});
test('referral tokens are literal UUID hex with no code or arbitrary callback payload', () => {
  assert.equal(referralCustomerId('ref_1234567890abcdef1234567890abcdef'), '12345678-90ab-cdef-1234-567890abcdef');
  assert.equal(referralCustomerId('1234567890ABCDEF1234567890ABCDEF'), '12345678-90ab-cdef-1234-567890abcdef');
  for (const value of ['', 'ref_abc', '12345678-90ab-cdef-1234-567890abcdef', 'ref_../../etc', null, {}]) assert.equal(referralCustomerId(value), null);
});
test('reward settings reject unbounded values and points never overflow PostgreSQL integer', () => {
  assert.equal(configuredReward(100000), 100000);
  for (const value of [100001, -1, 1.5, '10', Infinity, undefined]) assert.equal(configuredReward(value), 0);
  assert.deepEqual(rewardBalance(10, 15), { balance: 25, awarded: 15 });
  assert.deepEqual(rewardBalance(2147483640, 100), { balance: 2147483647, awarded: 7 });
  assert.throws(() => rewardBalance(-1, 10));
  assert.throws(() => rewardBalance(2147483648, 10));
});
