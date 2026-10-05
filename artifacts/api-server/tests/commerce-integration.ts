import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, pool, usersTable, storesTable, storeSettingsTable, customersTable, productsTable, customerProductsTable, couponsTable, couponUsesTable, ordersTable, orderItemsTable, reviewsTable, referralsTable, customerLedgerTable, commerceRewardsTable, growthJobsTable } from '@workspace/db';
import { assignCustomerCoupon, placeCartOrder, recordReview, registerCustomerReferral, rewardPaidOrder, reverseOrderRewards, productReviewSummary, renderCommerce } from '../src/lib/customer-commerce';

test('commerce database transactions prevent double redemption, stock races, rewards and referral replay', async () => {
  assert.ok(/^ep-summer-recipe-b21ls93d(?:-pooler)?\.[a-z0-9.-]+\.neon\.tech$/.test(new URL(process.env.DATABASE_URL!).hostname));
  // Additive schema migration, only on the isolated test branch.
  await pool.query(await readFile(new URL('../../../lib/db/migrations/0005_customer_commerce.sql', import.meta.url), 'utf8').catch(() => readFile('../../lib/db/migrations/0005_customer_commerce.sql', 'utf8')));
  const ownerId = randomUUID(); const storeId = randomUUID(); const otherStoreId = randomUUID();
  const customerId = randomUUID(); const referrerId = randomUUID(); const otherCustomerId = randomUUID(); const productId = randomUUID(); const couponId = randomUUID();
  const storeIds = [storeId, otherStoreId]; const customerIds = [customerId, referrerId, otherCustomerId];
  try {
    await db.insert(usersTable).values({ id: ownerId, name: 'Commerce test', email: `commerce-${ownerId}@example.invalid`, passwordHash: 'no-login' });
    await db.insert(storesTable).values(storeIds.map((id, index) => ({ id, ownerId, name: `Commerce isolated ${index}`, slug: `commerce-${id}`, currency: 'USD' })));
    await db.insert(storeSettingsTable).values(storeIds.map(storeId => ({ storeId, settings: { plan: { code: 'BUSINESS' }, cartEnabled: true, favoritesEnabled: true, pointsPerPaidOrder: 10, referralRewardPoints: 25 }, pointsEnabled: true, referralsEnabled: true, reviewsEnabled: true, couponsEnabled: true })));
    const [customer, referrer, outsider] = await db.insert(customersTable).values([
      { id: customerId, storeId, telegramUserId: '87001', telegramChatId: '87001', name: 'Buyer' },
      { id: referrerId, storeId, telegramUserId: '87002', telegramChatId: '87002', name: 'Referrer' },
      { id: otherCustomerId, storeId: otherStoreId, telegramUserId: '87003', telegramChatId: '87003', name: 'Other store' },
    ]).returning();
    await db.insert(productsTable).values({ id: productId, storeId, name: 'Real test product', price: '10.00', stock: 4, isPublished: true });
    await db.insert(couponsTable).values({ id: couponId, storeId, code: `TEST_${couponId.slice(0, 8).toUpperCase()}`, percent: 20, minimum: '5.00', maxUses: 1 });
    assert.equal(await registerCustomerReferral(customer, `ref_${customerId.replaceAll('-', '')}`), false, 'no self referral');
    assert.equal(await registerCustomerReferral(customer, `ref_${otherCustomerId.replaceAll('-', '')}`), false, 'no cross-store referral');
    assert.equal(await registerCustomerReferral(customer, `ref_${referrerId.replaceAll('-', '')}`), true);
    assert.equal(await registerCustomerReferral(customer, `ref_${referrerId.replaceAll('-', '')}`), false, 'one referral claim');
    assert.equal(await registerCustomerReferral(referrer, `ref_${customerId.replaceAll('-', '')}`), false, 'reject referral cycle');
    await assert.rejects(assignCustomerCoupon(outsider, couponId));
    await assignCustomerCoupon(customer, couponId);
    await db.insert(customerProductsTable).values({ id: randomUUID(), customerId, productId, quantity: 2, favorite: true });
    const updateId = `${Date.now()}1`;
    const concurrent = await Promise.all([placeCartOrder(customer, updateId), placeCartOrder(customer, updateId)]);
    assert.equal(concurrent[0].id, concurrent[1].id, 'update ID retry returns same order');
    assert.equal(concurrent[0].total, '16.00', 'real coupon applied to 20.00 subtotal');
    assert.equal((await db.select().from(productsTable).where(eq(productsTable.id, productId)))[0].stock, 2);
    assert.equal((await db.select().from(couponUsesTable).where(eq(couponUsesTable.couponId, couponId))).length, 1);
    assert.equal((await db.select().from(customerProductsTable).where(eq(customerProductsTable.customerId, customerId)))[0].favorite, true);
    await assert.rejects(assignCustomerCoupon(customer, couponId), /سابقًا/);
    await assert.rejects(recordReview(customer, productId.replaceAll('-', '').slice(0, 12), 5), /دفع/);
    const paid = await db.transaction(async tx => {
      const [order] = await tx.update(ordersTable).set({ paymentStatus: 'paid' }).where(eq(ordersTable.id, concurrent[0].id)).returning();
      await rewardPaidOrder(tx, order); await rewardPaidOrder(tx, order); return order;
    });
    assert.equal((await db.select().from(customersTable).where(eq(customersTable.id, customerId)))[0].points, 10);
    assert.equal((await db.select().from(customersTable).where(eq(customersTable.id, referrerId)))[0].points, 25);
    assert.equal((await db.select().from(referralsTable).where(eq(referralsTable.customerId, customerId)))[0].completed, true);
    await recordReview(customer, productId.replaceAll('-', '').slice(0, 12), 5);
    await recordReview(customer, productId.replaceAll('-', '').slice(0, 12), 4);
    assert.deepEqual(await productReviewSummary(storeId, productId), { count: 1, rating: 4 });
    assert.deepEqual(await productReviewSummary(otherStoreId, productId), { count: 0, rating: null });
    await assert.rejects(recordReview(outsider, productId.replaceAll('-', '').slice(0, 12), 5));
    await db.transaction(async tx => {
      const [order] = await tx.update(ordersTable).set({ paymentStatus: 'refunded' }).where(eq(ordersTable.id, paid.id)).returning();
      await reverseOrderRewards(tx, order); await reverseOrderRewards(tx, order);
    });
    assert.equal((await db.select().from(customersTable).where(eq(customersTable.id, customerId)))[0].points, 0);
    assert.equal((await db.select().from(customersTable).where(eq(customersTable.id, referrerId)))[0].points, 0);
    await db.transaction(async tx => { const [order] = await tx.update(ordersTable).set({ paymentStatus: 'paid' }).where(eq(ordersTable.id, paid.id)).returning(); await rewardPaidOrder(tx, order); });
    assert.equal((await db.select().from(customersTable).where(eq(customersTable.id, customerId)))[0].points, 0, 'repayment never grants the same reward again');
    const messages: string[] = [];
    const context = { storeId, userId: 87001, chatId: 87001, privateChat: true, storeName: 'Commerce', currency: 'USD', send: async (text: string) => { messages.push(text); }, product: async () => {} } as any;
    await renderCommerce(context, customer, 'checkout', undefined, `${Date.now()}2`, undefined, true);
    assert.match(messages[0], /المعاينة/);
    assert.equal((await db.select().from(ordersTable).where(eq(ordersTable.storeId, storeId))).length, 1, 'preview never creates order');
    await db.insert(customerProductsTable).values({ id: randomUUID(), customerId: referrerId, productId, quantity: 3 });
    await assert.rejects(placeCartOrder(referrer, `${Date.now()}3`), /مخزونه/);
    assert.equal((await db.select().from(productsTable).where(eq(productsTable.id, productId)))[0].stock, 2, 'failed checkout rolls back reservations');
    const limitedCouponId = randomUUID();
    await db.insert(couponsTable).values({ id: limitedCouponId, storeId, code: `RACE_${limitedCouponId.slice(0, 8).toUpperCase()}`, percent: 10, minimum: '0.00', maxUses: 1 });
    await assignCustomerCoupon(customer, limitedCouponId); await assignCustomerCoupon(referrer, limitedCouponId);
    await db.update(customerProductsTable).set({ quantity: 1 }).where(inArray(customerProductsTable.customerId, [customerId, referrerId]));
    const couponRace = await Promise.allSettled([placeCartOrder(customer, `${Date.now()}4`), placeCartOrder(referrer, `${Date.now()}5`)]);
    assert.equal(couponRace.filter(result => result.status === 'fulfilled').length, 1, 'last coupon use is reserved atomically');
    assert.equal(couponRace.filter(result => result.status === 'rejected').length, 1);
    assert.equal((await db.select().from(productsTable).where(eq(productsTable.id, productId)))[0].stock, 1, 'rejected redemption rolls back its stock');
    assert.equal((await db.select().from(couponUsesTable).where(eq(couponUsesTable.couponId, limitedCouponId))).length, 1);
    const favorites = Array.from({ length: 12 }, () => ({ id: randomUUID(), storeId, name: 'Favorite pagination item', price: '1.00', stock: 1, isPublished: true }));
    await db.insert(productsTable).values(favorites);
    await db.insert(customerProductsTable).values(favorites.map(product => ({ id: randomUUID(), customerId, productId: product.id, favorite: true })));
    const outputs: { text: string; buttons: { callback_data: string }[][] }[] = [];
    await renderCommerce({ ...context, send: async (text: string, buttons: { callback_data: string }[][]) => { outputs.push({ text, buttons }); } }, customer, 'favorites', undefined, '0', undefined, true, 1);
    assert.ok(outputs[0].buttons.flat().some(button => button.callback_data === 'lb:commerce:favorites:2'), 'favorites expose next page');
    assert.ok(outputs[0].buttons.flat().filter(button => button.callback_data.startsWith('lb:product:')).every(button => button.callback_data.split(':').length === 4), 'product links preserve their favorites parent');
    outputs.length = 0;
    await renderCommerce({ ...context, send: async (text: string, buttons: { callback_data: string }[][]) => { outputs.push({ text, buttons }); } }, customer, 'favorites', undefined, '0', undefined, true, 2);
    assert.ok(outputs[0].buttons.flat().some(button => button.callback_data === 'lb:commerce:favorites:1'));
  } finally {
    const orders = await db.select({ id: ordersTable.id }).from(ordersTable).where(inArray(ordersTable.storeId, storeIds));
    const coupons = await db.select({ id: couponsTable.id }).from(couponsTable).where(inArray(couponsTable.storeId, storeIds));
    if (coupons.length) await db.delete(couponUsesTable).where(inArray(couponUsesTable.couponId, coupons.map(coupon => coupon.id)));
    await db.delete(customerProductsTable).where(inArray(customerProductsTable.customerId, customerIds));
    await db.delete(reviewsTable).where(inArray(reviewsTable.storeId, storeIds));
    await db.delete(referralsTable).where(inArray(referralsTable.storeId, storeIds));
    await db.delete(commerceRewardsTable).where(inArray(commerceRewardsTable.storeId, storeIds));
    await db.delete(customerLedgerTable).where(inArray(customerLedgerTable.storeId, storeIds));
    await db.delete(growthJobsTable).where(inArray(growthJobsTable.storeId, storeIds));
    if (orders.length) await db.delete(orderItemsTable).where(inArray(orderItemsTable.orderId, orders.map(order => order.id)));
    await db.delete(ordersTable).where(inArray(ordersTable.storeId, storeIds));
    await db.delete(couponsTable).where(inArray(couponsTable.storeId, storeIds));
    await db.delete(customersTable).where(inArray(customersTable.storeId, storeIds));
    await db.delete(productsTable).where(inArray(productsTable.storeId, storeIds));
    await db.delete(storeSettingsTable).where(inArray(storeSettingsTable.storeId, storeIds));
    await db.delete(storesTable).where(inArray(storesTable.id, storeIds));
    await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    await pool.end();
  }
});
