export function couponDiscount(cents: number, coupon: { enabled: boolean; percent: number; minimum: string | number; maxUses: number; uses: number; expiresAt: Date | string | null }, now = Date.now()): number | null {
  const minimum = Number(coupon.minimum);
  if (!Number.isSafeInteger(cents) || cents < 0 || !coupon.enabled || !Number.isInteger(coupon.percent) || coupon.percent < 1 || coupon.percent > 100 ||
    !Number.isFinite(minimum) || minimum < 0 || minimum > 9999999999 || !Number.isInteger(coupon.maxUses) || coupon.maxUses < 1 || !Number.isInteger(coupon.uses) || coupon.uses < 0 || coupon.uses >= coupon.maxUses ||
    (coupon.expiresAt && (!Number.isFinite(new Date(coupon.expiresAt).getTime()) || new Date(coupon.expiresAt).getTime() <= now)) || cents < Math.round(minimum * 100)) return null;
  return Math.floor(cents * coupon.percent / 100);
}
export function parseCoupon(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.code !== 'string' || !/^[A-Z0-9_-]{3,24}$/.test(v.code.trim().toUpperCase()) || !Number.isInteger(v.percent) || Number(v.percent) < 1 || Number(v.percent) > 100 ||
    !Number.isFinite(v.minimum) || Number(v.minimum) < 0 || Number(v.minimum) > 9999999999 || !Number.isInteger(v.maxUses) || Number(v.maxUses) < 1 || Number(v.maxUses) > 1000000 || typeof v.enabled !== 'boolean' ||
    (v.expiresAt !== null && (typeof v.expiresAt !== 'string' || !Number.isFinite(Date.parse(v.expiresAt)) || new Date(v.expiresAt).toISOString() !== v.expiresAt))) return null;
  return { code: v.code.trim().toUpperCase(), percent: Number(v.percent), minimum: Number(v.minimum).toFixed(2), maxUses: Number(v.maxUses), enabled: v.enabled, expiresAt: v.expiresAt === null ? null : new Date(String(v.expiresAt)) };
}

export function referralCustomerId(token: unknown): string | null {
  if (typeof token !== 'string' || !/^(?:ref_)?[a-f0-9]{32}$/i.test(token)) return null;
  const id = token.replace(/^ref_/i, '').toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

export function configuredReward(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100000 ? Number(value) : 0;
}

export function rewardBalance(current: number, requested: number): { balance: number; awarded: number } {
  if (!Number.isInteger(current) || current < 0 || current > 2147483647 || !Number.isInteger(requested) || requested < 0) throw new Error('Invalid points balance.');
  const awarded = Math.min(2147483647 - current, requested);
  return { balance: current + awarded, awarded };
}
