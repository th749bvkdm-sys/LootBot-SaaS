import { Router } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, couponsTable, couponUsesTable, reviewsTable, storeSettingsTable, storesTable, customersTable, productsTable } from '@workspace/db';
import { requireAuth, requireCsrf, getOwnedStore } from '../lib/auth-middleware';
import { featureGate, getPlanCatalog } from '../lib/store-plans';
import { isFeatureAvailable, readPlanCode } from '../lib/plans';
import { createId } from '../lib/security';
import { parseCoupon } from '../lib/commerce-validation';
import { commerceAvailability } from '../lib/customer-commerce';
import { writeAuditEvent } from '../lib/audit';
export const commerceRouter = Router();
commerceRouter.use('/stores/:storeId/commerce', requireAuth, async (req, res, next) => { if (!await getOwnedStore(String(req.params.storeId), req.auth!.userId)) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; } next(); });
commerceRouter.get('/stores/:storeId/commerce', async (req, res) => {
  const storeId = String(req.params.storeId); const [rows, catalog] = await Promise.all([db.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, storeId)).limit(1), getPlanCatalog()]);
  const settings = rows[0]; const plan = readPlanCode(settings?.settings); const advanced = isFeatureAvailable(plan, 'telegram.advanced', catalog);
  const entitlements = { cart: advanced, favorites: advanced, support: advanced, points: isFeatureAvailable(plan, 'loyalty.basic', catalog), referrals: isFeatureAvailable(plan, 'referrals.basic', catalog), reviews: isFeatureAvailable(plan, 'reviews.basic', catalog), coupons: isFeatureAvailable(plan, 'coupons.basic', catalog) };
  res.json({ availability: await commerceAvailability(storeId), preferences: { cartEnabled: settings?.settings.cartEnabled === true, favoritesEnabled: settings?.settings.favoritesEnabled === true,
    pointsEnabled: settings?.pointsEnabled ?? false, referralsEnabled: settings?.referralsEnabled ?? false, reviewsEnabled: settings?.reviewsEnabled ?? false, couponsEnabled: settings?.couponsEnabled ?? false, supportEnabled: settings?.supportEnabled ?? false,
    supportUsername: settings?.settings.supportUsername ?? '', pointsPerPaidOrder: settings?.settings.pointsPerPaidOrder ?? 0, referralRewardPoints: settings?.settings.referralRewardPoints ?? 0 },
    coupons: await db.select().from(couponsTable).where(eq(couponsTable.storeId, storeId)).orderBy(desc(couponsTable.createdAt)).limit(100),
    reviews: await db.select({ id: reviewsTable.id, stars: reviewsTable.stars, createdAt: reviewsTable.createdAt, customerName: customersTable.name, productName: productsTable.name }).from(reviewsTable)
      .innerJoin(customersTable, eq(customersTable.id, reviewsTable.customerId)).innerJoin(productsTable, eq(productsTable.id, reviewsTable.productId))
      .where(and(eq(reviewsTable.storeId, storeId), eq(customersTable.storeId, storeId), eq(productsTable.storeId, storeId))).orderBy(desc(reviewsTable.createdAt)).limit(50),
    entitlements, editable: advanced });
});
commerceRouter.patch('/stores/:storeId/commerce/preferences', requireCsrf, async (req, res) => {
  const storeId = String(req.params.storeId); await featureGate.require(storeId, 'telegram.advanced'); const b = req.body;
  const flags = ['cartEnabled', 'favoritesEnabled', 'pointsEnabled', 'referralsEnabled', 'reviewsEnabled', 'couponsEnabled', 'supportEnabled'];
  if (!b || !flags.every(f => typeof b[f] === 'boolean') || typeof b.supportUsername !== 'string' || (b.supportUsername && !/^[a-zA-Z0-9_]{5,32}$/.test(b.supportUsername)) || (b.supportEnabled && !b.supportUsername) || !['pointsPerPaidOrder', 'referralRewardPoints'].every(f => Number.isInteger(b[f]) && b[f] >= 0 && b[f] <= 100000)) { res.status(400).json({ error: 'تحقق من إعدادات ميزات العملاء. الدعم يتطلب اسم حساب صحيحًا.' }); return; }
  for (const [flag, feature] of [['pointsEnabled', 'loyalty.basic'], ['referralsEnabled', 'referrals.basic'], ['reviewsEnabled', 'reviews.basic'], ['couponsEnabled', 'coupons.basic']] as const) if (b[flag]) await featureGate.require(storeId, feature);
  await db.transaction(async tx => {
    await tx.select().from(storesTable).where(eq(storesTable.id, storeId)).for('update');
    const [old] = await tx.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, storeId)).limit(1);
    const settings = { ...old?.settings, cartEnabled: b.cartEnabled, favoritesEnabled: b.favoritesEnabled, supportUsername: b.supportUsername, pointsPerPaidOrder: b.pointsPerPaidOrder, referralRewardPoints: b.referralRewardPoints };
    const values = { settings, pointsEnabled: b.pointsEnabled, referralsEnabled: b.referralsEnabled, reviewsEnabled: b.reviewsEnabled, couponsEnabled: b.couponsEnabled, supportEnabled: b.supportEnabled, updatedAt: new Date() };
    await tx.insert(storeSettingsTable).values({ storeId, ...values }).onConflictDoUpdate({ target: storeSettingsTable.storeId, set: values });
  }); await writeAuditEvent({ userId: req.auth!.userId, storeId, action: 'commerce.preferences', summary: 'تم تحديث ميزات العملاء' }); res.json({ ok: true });
});
commerceRouter.post('/stores/:storeId/commerce/coupons', requireCsrf, async (req, res) => {
  const storeId = String(req.params.storeId); await featureGate.require(storeId, 'coupons.basic'); const coupon = parseCoupon(req.body);
  if (!coupon) { res.status(400).json({ error: 'بيانات الكوبون غير صالحة.' }); return; }
  if (req.body.id !== undefined && (typeof req.body.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(req.body.id))) { res.status(400).json({ error: 'معرّف الكوبون غير صالح.' }); return; }
  if (coupon.enabled && coupon.expiresAt && coupon.expiresAt.getTime() <= Date.now()) { res.status(400).json({ error: 'لا يمكن تفعيل كوبون انتهى. اختر تاريخًا لاحقًا أو أوقفه.' }); return; }
  const id = typeof req.body.id === 'string' ? req.body.id : createId();
  const saved = await db.transaction(async tx => {
    await tx.select().from(storesTable).where(eq(storesTable.id, storeId)).for('update');
    const [old] = await tx.select().from(couponsTable).where(and(eq(couponsTable.id, id), eq(couponsTable.storeId, storeId))).for('update');
    if (req.body.id && !old) return null;
    const [duplicate] = await tx.select().from(couponsTable).where(and(eq(couponsTable.storeId, storeId), eq(couponsTable.code, coupon.code))).limit(1);
    if (duplicate && duplicate.id !== id) return null;
    if (old && coupon.maxUses < old.uses) return null;
    if (!old) { const [n] = await tx.select({ n: sql<number>`count(*)` }).from(couponsTable).where(eq(couponsTable.storeId, storeId)); if (Number(n.n) >= 100) return null; }
    const [row] = old ? await tx.update(couponsTable).set(coupon).where(eq(couponsTable.id, id)).returning() : await tx.insert(couponsTable).values({ id, storeId, ...coupon }).returning(); return row;
  }); if (!saved) { res.status(409).json({ error: 'الكود مستخدم أو الكوبون غير موجود أو بلغ الحد.' }); return; }
  await writeAuditEvent({ userId: req.auth!.userId, storeId, action: 'coupon.saved', summary: 'تم حفظ كوبون' }); res.json(saved);
});
commerceRouter.get('/stores/:storeId/commerce/redemptions', async (req, res) => {
  const storeId = String(req.params.storeId); await featureGate.require(storeId, 'coupons.basic');
  res.json(await db.select({ id: couponUsesTable.id, code: couponsTable.code, customerName: customersTable.name, customerId: couponUsesTable.customerId, orderId: couponUsesTable.orderId, discount: couponUsesTable.discount, createdAt: couponUsesTable.createdAt }).from(couponUsesTable)
    .innerJoin(couponsTable, eq(couponsTable.id, couponUsesTable.couponId)).innerJoin(customersTable, eq(customersTable.id, couponUsesTable.customerId))
    .where(and(eq(couponsTable.storeId, storeId), eq(customersTable.storeId, storeId))).orderBy(desc(couponUsesTable.createdAt)).limit(100));
});
