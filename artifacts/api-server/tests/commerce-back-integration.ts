import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, pool, usersTable, storesTable, storeSettingsTable, customersTable, productsTable, customerProductsTable, ordersTable } from '@workspace/db';
import { renderCommerce } from '../src/lib/customer-commerce';
import { rememberProductParent, resolveProductParent, renderStoreScreen, type ScreenContext } from '../src/lib/telegram-store-screens';
import { parseNavigationCallback, type BotButton } from '../src/lib/telegram-navigation';
import { productButtons } from '../src/lib/telegram-product-buttons';

test('real database commerce Back preserves favorites pages, support orders and account notifications', async t => {
  assert.ok(/^ep-summer-recipe-b21ls93d(?:-pooler)?\.[a-z0-9.-]+\.neon\.tech$/.test(new URL(process.env.DATABASE_URL!).hostname), 'Only the isolated V2 branch is permitted');
  const ownerId = randomUUID(); const storeId = randomUUID(); const customerId = randomUUID(); const orderId = randomUUID();
  const messages: { text: string; buttons: BotButton[][] }[] = [];
  const context: ScreenContext = {
    storeId, storeName: 'Back navigation test', currency: 'USD', userId: 893001, chatId: 893001, privateChat: true, customerName: 'Test customer',
    send: async (text, buttons) => { messages.push({ text, buttons }); },
    product: async (code, parent) => {
      const parentRef = rememberProductParent(context, parent);
      await context.send('Actual product screen', productButtons({ code, stock: 1, parent, parentRef, galleryIndex: 0, galleryCount: 0, available: { cart: true, favorites: true, reviews: true } }), 'product');
    },
  };
  const last = () => { assert.ok(messages.length); return messages.at(-1)!; };
  const callback = (predicate: (value: string) => boolean) => {
    const value = last().buttons.flat().find(button => button.callback_data && predicate(button.callback_data))?.callback_data;
    assert.ok(value); assert.ok(Buffer.byteLength(value) <= 64); return value;
  };
  try {
    await db.insert(usersTable).values({ id: ownerId, name: 'Back navigation test', email: `commerce-back-${ownerId}@example.invalid`, passwordHash: 'no-login' });
    await db.insert(storesTable).values({ id: storeId, ownerId, name: context.storeName, slug: `commerce-back-${storeId}`, currency: 'USD' });
    await db.insert(storeSettingsTable).values({ storeId, settings: { plan: { code: 'BUSINESS' }, favoritesEnabled: true, cartEnabled: true, supportUsername: 'support_test_bot' }, reviewsEnabled: true, supportEnabled: true });
    const [customer] = await db.insert(customersTable).values({ id: customerId, storeId, telegramUserId: String(context.userId), telegramChatId: String(context.chatId), name: context.customerName }).returning();
    const products = Array.from({ length: 12 }, (_, index) => ({ id: randomUUID(), storeId, name: `Favorite ${index + 1}`, price: '1.00', stock: 1, isPublished: true }));
    await db.insert(productsTable).values(products);
    await db.insert(customerProductsTable).values(products.map(product => ({ id: randomUUID(), customerId, productId: product.id, favorite: true })));
    await db.insert(ordersTable).values({ id: orderId, storeId, telegramUserId: String(context.userId), telegramChatId: String(context.chatId), customerName: context.customerName, currency: 'USD', total: '1.00' });

    await renderCommerce(context, customer, 'favorites', undefined, '0', undefined, false, 2);
    assert.match(last().text, /الصفحة 2/);
    const productLink = parseNavigationCallback(callback(value => value.startsWith('lb:product:')));
    assert.equal(productLink?.kind, 'product');
    if (productLink?.kind !== 'product') throw Error('Expected product callback');
    assert.equal(resolveProductParent(context, productLink.parentRef), 'lb:commerce:favorites:2');
    await renderStoreScreen(context, productLink);
    const favorite = parseNavigationCallback(callback(value => value.startsWith('lb:commerce:favorite:')));
    assert.equal(favorite?.kind, 'commerce');
    if (favorite?.kind !== 'commerce') throw Error('Expected favorite callback');
    assert.ok(favorite.parentRef);
    assert.equal(resolveProductParent(context, favorite.parentRef), 'lb:commerce:favorites:2');
    await renderCommerce(context, customer, favorite.feature, favorite.code, '0', undefined, false, favorite.page ?? 1, favorite.parentRef);
    const productBack = parseNavigationCallback(callback(value => value.startsWith('lb:product:')));
    assert.equal(productBack?.kind, 'product');
    if (productBack?.kind !== 'product') throw Error('Expected product Back callback');
    assert.equal(productBack.parentRef, favorite.parentRef, 'Mutation success retains the product parent');
    await renderStoreScreen(context, productBack);
    const favoriteBack = parseNavigationCallback(callback(value => value === 'lb:commerce:favorites:2'));
    assert.equal(favoriteBack?.kind, 'commerce');
    if (favoriteBack?.kind !== 'commerce') throw Error('Expected favorites Back callback');
    await renderCommerce(context, customer, favoriteBack.feature, favoriteBack.code, '0', undefined, false, favoriteBack.page ?? 1, favoriteBack.parentRef);
    assert.match(last().text, /الصفحة 2/);
    assert.equal((await db.select().from(customerProductsTable).where(eq(customerProductsTable.customerId, customerId))).filter(row => row.favorite).length, 11, 'Toggle changes the real favorite only once');

    await renderCommerce(context, customer, 'review', productLink.code, '0', undefined, false, 1, favorite.parentRef);
    assert.equal(callback(value => value.startsWith('lb:product:')), `lb:product:${productLink.code}:${favorite.parentRef}`, 'Review instructions retain favorites parent');

    await renderStoreScreen(context, { kind: 'order', id: orderId, parentPage: 2 });
    const support = parseNavigationCallback(callback(value => value.startsWith('lb:commerce:support:')));
    assert.equal(support?.kind, 'commerce');
    if (support?.kind !== 'commerce') throw Error('Expected support callback');
    assert.equal(resolveProductParent(context, support.parentRef), `lb:order:${orderId}:2`);
    await renderCommerce(context, customer, support.feature, undefined, '0', undefined, false, 1, support.parentRef);
    assert.equal(callback(value => value.startsWith('lb:order:')), `lb:order:${orderId}:2`, 'Support returns to the same private order and list page');

    await renderStoreScreen(context, { kind: 'account' });
    const notifications = parseNavigationCallback(callback(value => value.startsWith('lb:commerce:notifications:')));
    assert.equal(notifications?.kind, 'commerce');
    if (notifications?.kind !== 'commerce') throw Error('Expected notifications callback');
    assert.equal(resolveProductParent(context, notifications.parentRef), 'lb:account');
    await renderCommerce(context, customer, notifications.feature, undefined, '0', undefined, false, 1, notifications.parentRef);
    assert.match(last().text, /آخر تحديثاتك/);
    assert.equal(last().buttons.at(-2)?.[0]?.callback_data, 'lb:account', 'Notification footer returns to Account');

    for (const scope of [{ ...context, userId: 893002 }, { ...context, chatId: 893002 }, { ...context, storeId: randomUUID() }]) assert.equal(resolveProductParent(scope, support.parentRef), 'lb:home');
    assert.equal(resolveProductParent(context, 'invalid'), 'lb:home');
    const now = Date.now(); const mock = t.mock.method(Date, 'now', () => now + 15 * 60_000);
    try {
      assert.equal(resolveProductParent(context, favorite.parentRef), 'lb:home');
      await renderCommerce(context, customer, 'support', undefined, '0', undefined, false, 1, support.parentRef);
      assert.equal(last().buttons.at(-2)?.[0]?.callback_data, 'lb:home', 'Expired support context safely falls back to Home');
    } finally { mock.mock.restore(); }
  } finally {
    await db.delete(customerProductsTable).where(eq(customerProductsTable.customerId, customerId));
    await db.delete(ordersTable).where(eq(ordersTable.storeId, storeId));
    await db.delete(customersTable).where(eq(customersTable.storeId, storeId));
    await db.delete(productsTable).where(eq(productsTable.storeId, storeId));
    await db.delete(storeSettingsTable).where(eq(storeSettingsTable.storeId, storeId));
    await db.delete(storesTable).where(eq(storesTable.id, storeId));
    await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    await pool.end();
  }
});
