import { and, count, eq, gte, ne, sql } from 'drizzle-orm';
import { db, customersTable, customerProductsTable, couponsTable, couponUsesTable, ordersTable, orderItemsTable, productsTable, storesTable, storeSettingsTable, reviewsTable, referralsTable, customerLedgerTable, commerceRewardsTable } from '@workspace/db';
import { createId } from './security';
import { featureGate, getPlanCatalog } from './store-plans';
import { isFeatureAvailable, isPlanLimitReached, readPlanCode } from './plans';
import { enqueueGrowthEvent } from './growth-service';
import { configuredReward, couponDiscount, referralCustomerId, rewardBalance } from './commerce-validation';
import { navigationFooter, paginationButtons, type BotButton } from './telegram-navigation';
import { rememberProductParent, resolveProductParent, type ScreenContext } from './telegram-store-screens';
type Customer = typeof customersTable.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Order = typeof ordersTable.$inferSelect;
export async function commerceAvailability(storeId: string) {
  const [rows, catalog] = await Promise.all([db.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, storeId)).limit(1), getPlanCatalog()]);
  const settings = rows[0]; const plan = readPlanCode(settings?.settings);
  const advanced = isFeatureAvailable(plan, 'telegram.advanced', catalog);
  return { cart: advanced && settings?.settings.cartEnabled === true,
    favorites: advanced && settings?.settings.favoritesEnabled === true,
    points: !!settings?.pointsEnabled && isFeatureAvailable(plan, 'loyalty.basic', catalog), referrals: !!settings?.referralsEnabled && isFeatureAvailable(plan, 'referrals.basic', catalog),
    coupons: !!settings?.couponsEnabled && isFeatureAvailable(plan, 'coupons.basic', catalog), reviews: !!settings?.reviewsEnabled && isFeatureAvailable(plan, 'reviews.basic', catalog), support: !!settings?.supportEnabled,
    notifications: isFeatureAvailable(plan, 'telegram.basic', catalog) };
}
export async function commerceHome(storeId: string): Promise<BotButton[][]> {
  const enabled = await commerceAvailability(storeId); const labels: Record<string, string> = { cart: '🛒 السلة', favorites: '❤️ المفضلة', points: '⭐ النقاط', referrals: '🎁 الإحالات', coupons: '🎫 الكوبونات', support: '💬 الدعم' };
  return Object.entries(labels).filter(([key]) => enabled[key as keyof typeof enabled]).map(([key, text]) => [{ text, callback_data: `lb:commerce:${key}` }]);
}
export async function placeCartOrder(customer: Customer, updateId: string) {
  if (!/^\d{1,20}$/.test(updateId)) throw Error('طلب التأكيد غير صالح.');
  if (!(await commerceAvailability(customer.storeId)).cart) throw Error('السلة غير مفعلة.');
  const couponsAllowed = await featureGate.can(customer.storeId, 'coupons.basic');
  const catalog = await getPlanCatalog();
  return db.transaction(async tx => {
    const [store] = await tx.select().from(storesTable).where(and(eq(storesTable.id, customer.storeId), eq(storesTable.isDeleted, false))).for('update');
    if (!store) throw Error('المتجر غير متاح.');
    const [prior] = await tx.select().from(ordersTable).where(and(eq(ordersTable.storeId, store.id), eq(ordersTable.telegramUpdateId, updateId))).limit(1);
    if (prior) { if (prior.telegramUserId !== customer.telegramUserId) throw Error('الطلب غير متاح لهذا العميل.'); return prior; }
    const [settings] = await tx.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, store.id)).limit(1);
    if (!settings?.settings.cartEnabled || !isFeatureAvailable(readPlanCode(settings.settings), 'telegram.advanced', catalog)) throw Error('السلة غير مفعلة.');
    const [locked] = await tx.select().from(customersTable).where(and(eq(customersTable.id, customer.id), eq(customersTable.storeId, store.id))).for('update');
    if (!locked) throw Error('العميل غير موجود.');
    const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
    const [usage] = await tx.select({ value: count() }).from(ordersTable).where(and(eq(ordersTable.storeId, store.id), gte(ordersTable.createdAt, month)));
    if (isPlanLimitReached(readPlanCode(settings?.settings), 'ordersPerMonth', Number(usage.value), catalog)) throw Error('بلغ المتجر حد الطلبات الشهري.');
    const items = await tx.select({ line: customerProductsTable, product: productsTable }).from(customerProductsTable).innerJoin(productsTable, eq(productsTable.id, customerProductsTable.productId))
      .where(and(eq(customerProductsTable.customerId, customer.id), gte(customerProductsTable.quantity, 1))).orderBy(productsTable.id).limit(31);
    if (!items.length || items.length > 30) throw Error('السلة فارغة أو تتجاوز 30 منتجًا.');
    let subtotal = 0;
    for (const item of items) {
      const [reserved] = await tx.update(productsTable).set({ stock: sql`${productsTable.stock}-${item.line.quantity}`, updatedAt: new Date() })
        .where(and(eq(productsTable.id, item.product.id), eq(productsTable.storeId, store.id), eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true), gte(productsTable.stock, item.line.quantity))).returning();
      if (!reserved) throw Error('أحد المنتجات غير متاح أو مخزونه لا يكفي. حدّث السلة.');
      item.product = reserved; subtotal += Math.round(Number(reserved.price) * 100) * item.line.quantity;
      if (!Number.isFinite(Number(reserved.price)) || Number(reserved.price) < 0 || !Number.isSafeInteger(subtotal) || subtotal > 999999999999) throw Error('السعر أو إجمالي السلة يتجاوز الحد المسموح.');
    }
    let discount = 0; let coupon: typeof couponsTable.$inferSelect | undefined;
    if (typeof locked.state.couponId === 'string' && settings?.couponsEnabled && couponsAllowed) {
      [coupon] = await tx.select().from(couponsTable).where(and(eq(couponsTable.id, locked.state.couponId), eq(couponsTable.storeId, store.id))).for('update');
      const [used] = coupon ? await tx.select().from(couponUsesTable).where(and(eq(couponUsesTable.couponId, coupon.id), eq(couponUsesTable.customerId, customer.id))).limit(1) : [];
      const value = coupon && !used ? couponDiscount(subtotal, coupon) : null;
      if (value === null) throw Error('الكوبون لم يعد صالحًا. امسحه من شاشة الكوبونات أو اختر كوبونًا آخر.'); discount = value;
    }
    const id = createId(); const total = ((subtotal - discount) / 100).toFixed(2);
    const [order] = await tx.insert(ordersTable).values({ id, storeId: store.id, telegramUpdateId: updateId, telegramUserId: customer.telegramUserId, telegramChatId: customer.telegramChatId, telegramUsername: customer.username, customerName: customer.name, currency: store.currency, total }).returning();
    await tx.insert(orderItemsTable).values(items.map(item => ({ id: createId(), orderId: id, productId: item.product.id, productName: item.product.name, unitPrice: item.product.price, quantity: item.line.quantity, lineTotal: (Math.round(Number(item.product.price) * 100) * item.line.quantity / 100).toFixed(2) })));
    if (coupon) { await tx.insert(couponUsesTable).values({ id: createId(), couponId: coupon.id, customerId: customer.id, orderId: id, discount: (discount / 100).toFixed(2) }); await tx.update(couponsTable).set({ uses: coupon.uses + 1 }).where(eq(couponsTable.id, coupon.id));
      await enqueueGrowthEvent(tx, { storeId: store.id, telegramUserId: customer.telegramUserId, trigger: 'COUPON_USED', eventId: id, orderId: id, orderValue: Number(total) }); }
    const state = { ...locked.state }; delete state.couponId;
    await tx.update(customersTable).set({ state }).where(eq(customersTable.id, customer.id));
    await tx.update(customerProductsTable).set({ quantity: 0 }).where(eq(customerProductsTable.customerId, customer.id));
    await enqueueGrowthEvent(tx, { storeId: store.id, telegramUserId: customer.telegramUserId, trigger: 'ORDER_CREATED', eventId: id, orderId: id, orderValue: Number(total) }); return order;
  });
}
export async function renderCommerce(context: ScreenContext, customer: Customer | undefined, kind: string, code: string | undefined, updateId: string, botUsername?: string, preview = false, page = 1, parentRef?: string) {
  if (!Number.isInteger(page) || page < 1 || page > 99999) page = 1;
  const enabled = await commerceAvailability(context.storeId);
  const feature = ({ add: 'cart', remove: 'cart', checkout: 'cart', favorite: 'favorites', review: 'reviews', rate: 'reviews', couponClear: 'coupons' } as Record<string, string>)[kind] ?? kind;
  if (!enabled[feature as keyof typeof enabled]) { await context.send('هذه الميزة غير مفعلة لهذا المتجر.', navigationFooter(), 'error'); return; }
  if (!customer || !context.privateChat) { await context.send('افتح المحادثة الخاصة لعرض بياناتك.', navigationFooter(), 'error'); return; }
  if (customer.storeId !== context.storeId) { await context.send('العميل غير متاح لهذا المتجر.', navigationFooter(), 'error'); return; }
  const parentSuffix = parentRef && /^[a-f0-9]{12}$/.test(parentRef) ? `:${parentRef}` : '';
  const parent = resolveProductParent(context, parentRef);
  const footer = navigationFooter(parent, `lb:commerce:${feature}${kind === 'favorites' ? `:${page}` : ''}${parentSuffix}`);
  if (preview && ['add', 'remove', 'favorite', 'rate', 'checkout', 'couponClear'].includes(kind)) {
    await context.send('المعاينة للعرض فقط؛ لا تغيّر السلة أو الكوبونات ولا تُنشئ طلبًا.', footer, 'account'); return;
  }
  if (kind === 'points') { const rows = await db.select().from(customerLedgerTable).where(and(eq(customerLedgerTable.storeId, context.storeId), eq(customerLedgerTable.customerId, customer.id))).orderBy(sql`${customerLedgerTable.createdAt} desc`).limit(10);
    await context.send(`⭐ رصيدك: ${customer.points}\n\n${rows.map(r => `${r.amount > 0 ? '+' : ''}${r.amount} · ${r.reason}`).join('\n')}`, footer, 'points'); return; }
  if (kind === 'notifications') {
    const orders = await db.select().from(ordersTable).where(and(eq(ordersTable.storeId, context.storeId), eq(ordersTable.telegramUserId, customer.telegramUserId))).orderBy(sql`${ordersTable.updatedAt} desc`).limit(10);
    const points = await db.select().from(customerLedgerTable).where(and(eq(customerLedgerTable.storeId, context.storeId), eq(customerLedgerTable.customerId, customer.id))).orderBy(sql`${customerLedgerTable.createdAt} desc`).limit(10);
    const states: Record<string, string> = { pending: 'بانتظار التأكيد', confirmed: 'مؤكد', fulfilled: 'منفذ', cancelled: 'ملغى', unpaid: 'غير مدفوع', paid: 'مدفوع', refunded: 'مسترد' };
    const events = [...orders.map(order => ({ date: order.updatedAt, text: `📦 ${order.id.slice(0, 8)} · ${states[order.status] ?? order.status} · ${states[order.paymentStatus] ?? order.paymentStatus}` })),
      ...points.map(row => ({ date: row.createdAt, text: `⭐ ${row.amount > 0 ? '+' : ''}${row.amount} · ${row.reason.slice(0, 120)}` }))].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 15);
    await context.send(`🔔 آخر تحديثاتك\n\n${events.map(event => `${event.date.toLocaleDateString('ar-SA', { timeZone: 'UTC' })} · ${event.text}`).join('\n') || 'لا توجد تحديثات بعد.'}\n\nرسائل المتجر: ${customer.optedIn ? 'مفعلة؛ أرسل /stop لإيقافها.' : 'متوقفة؛ أرسل /start لتفعيلها.'}`, [[{ text: '📦 طلباتي', callback_data: 'lb:orders:1' }, { text: '👤 حسابي', callback_data: 'lb:account' }], ...footer], 'notifications'); return;
  }
  if (kind === 'referrals') { const [usage] = await db.select({ value: count() }).from(referralsTable).where(and(eq(referralsTable.storeId, context.storeId), eq(referralsTable.referrerId, customer.id), eq(referralsTable.completed, true)));
    await context.send(`🎁 الإحالات المكتملة: ${usage.value}\n${botUsername ? `https://t.me/${botUsername}?start=ref_${customer.id.replaceAll('-', '')}` : `رمز الإحالة: ${customer.id.replaceAll('-', '')}`}\nتُحتسب الإحالة بعد أول طلب مدفوع للعميل الجديد.`, footer, 'referrals'); return; }
  if (kind === 'support') { const [settings] = await db.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, context.storeId)).limit(1);
    const handle = typeof settings?.settings.supportUsername === 'string' && /^[a-zA-Z0-9_]{5,32}$/.test(settings.settings.supportUsername) ? settings.settings.supportUsername : '';
    await context.send(handle ? `💬 تواصل مع الدعم: https://t.me/${handle}` : 'لم يحدد المتجر وسيلة الدعم بعد.', footer, 'support'); return; }
  if (kind === 'coupons' || kind === 'couponClear') {
    if (kind === 'couponClear') await db.update(customersTable).set({ state: sql`${customersTable.state}-'couponId'` }).where(eq(customersTable.id, customer.id));
    const rows = await db.select().from(couponsTable).where(and(eq(couponsTable.storeId, context.storeId), eq(couponsTable.enabled, true))).limit(100);
    const used = await db.select({ couponId: couponUsesTable.couponId }).from(couponUsesTable).innerJoin(couponsTable, eq(couponsTable.id, couponUsesTable.couponId)).where(and(eq(couponsTable.storeId, context.storeId), eq(couponUsesTable.customerId, customer.id)));
    const redeemed = new Set(used.map(row => row.couponId));
    const selected = rows.find(c => c.id === customer.state.couponId && !redeemed.has(c.id) && couponDiscount(Math.round(Number(c.minimum) * 100), c) !== null);
    await context.send(`🎫 الكوبونات\n${selected ? `الكوبون المختار: ${selected.code}\n` : ''}${rows.filter(c => !redeemed.has(c.id) && couponDiscount(Math.max(1, Math.round(Number(c.minimum) * 100)), c) !== null).slice(0, 30).map(c => `${c.code} · ${c.percent}% · الحد الأدنى ${c.minimum} ${context.currency}`).join('\n') || 'لا توجد كوبونات متاحة.'}\n\nلتطبيق كوبون على السلة أرسل /coupon الرمز\nكل كوبون يُستخدم مرة واحدة لكل عميل، ويُراجع عند تأكيد الطلب.`, [[{ text: 'مسح الكوبون المختار', callback_data: 'lb:commerce:couponClear' }], ...footer], 'coupons'); return;
  }
  if (kind === 'checkout') { try { const order = await placeCartOrder(customer, updateId); await context.send(`تم تسجيل الطلب ${order.id.slice(0, 8)}\nالإجمالي ${order.total} ${order.currency}\nالدفع يدوي؛ تابع تعليمات المتجر.`, [[{ text: 'تفاصيل الطلب', callback_data: `lb:order:${order.id}:1` }], ...footer], 'success'); } catch (e) { await context.send(e instanceof Error ? e.message : 'تعذر تسجيل الطلب.', footer, 'error'); } return; }
  if (['add', 'remove', 'favorite', 'review', 'rate'].includes(kind)) {
    const [product] = code && /^[a-f0-9]{12}$/.test(code) ? await db.select().from(productsTable).where(and(eq(productsTable.storeId, context.storeId), ...(kind === 'remove' ? [] : [eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true)]), sql`substring(replace(${productsTable.id},'-','') from 1 for 12)=${code}`)).limit(1) : [];
    if (!product) { await context.send('المنتج لم يعد متاحًا.', footer, 'error'); return; }
    if (kind === 'review') { await context.send(`⭐ تقييم ${product.name}\nأرسل /review ${code} رقم_من_1_إلى_5\nالتقييم متاح بعد شراء المنتج والدفع.`, navigationFooter(`lb:product:${code}${parentSuffix}`), 'product'); return; }
    if (kind === 'add' && product.stock < 1) { await context.send('نفد مخزون المنتج.', footer, 'error'); return; }
    try { await db.transaction(async tx => {
      await tx.select().from(customersTable).where(eq(customersTable.id, customer.id)).for('update');
      const [old] = await tx.select().from(customerProductsTable).where(and(eq(customerProductsTable.customerId, customer.id), eq(customerProductsTable.productId, product.id))).limit(1);
      const quantity = kind === 'add' ? Math.min(20, product.stock, (old?.quantity ?? 0) + 1) : kind === 'remove' ? Math.max(0, (old?.quantity ?? 0) - 1) : old?.quantity ?? 0;
      const favorite = kind === 'favorite' ? !old?.favorite : old?.favorite ?? false;
      const [size] = await tx.select({ n: count() }).from(customerProductsTable).where(and(eq(customerProductsTable.customerId, customer.id), gte(customerProductsTable.quantity, 1)));
      if (kind === 'add' && !old?.quantity && Number(size.n) >= 30) throw Error('الحد الأقصى للسلة 30 منتجًا.');
      await tx.insert(customerProductsTable).values({ id: createId(), customerId: customer.id, productId: product.id, quantity, favorite }).onConflictDoUpdate({ target: [customerProductsTable.customerId, customerProductsTable.productId], set: { quantity, favorite } });
    }); } catch (cause) { await context.send(cause instanceof Error ? cause.message : 'تعذر تحديث السلة.', footer, 'error'); return; }
    await context.send(kind === 'favorite' ? 'تم تحديث المفضلة.' : 'تم تحديث السلة.', navigationFooter(`lb:product:${code}${parentSuffix}`), 'success'); return;
  }
  if (kind === 'cart' || kind === 'favorites') {
    const found = await db.select({ product: productsTable, line: customerProductsTable }).from(customerProductsTable).innerJoin(productsTable, eq(productsTable.id, customerProductsTable.productId)).where(and(eq(customerProductsTable.customerId, customer.id), eq(productsTable.storeId, context.storeId), ...(kind === 'favorites' ? [eq(productsTable.isPublished, true), eq(productsTable.isDeleted, false)] : []), kind === 'cart' ? gte(customerProductsTable.quantity, 1) : eq(customerProductsTable.favorite, true))).orderBy(productsTable.id).limit(kind === 'favorites' ? 11 : 30).offset(kind === 'favorites' ? (page - 1) * 10 : 0);
    const rows = kind === 'favorites' ? found.slice(0, 10) : found;
    const productParentRef = rememberProductParent(context, `lb:commerce:${kind}${kind === 'favorites' ? `:${page}` : ''}${parentSuffix}`);
    const buttons = rows.map(({ product, line }) => [...(!product.isDeleted && product.isPublished ? [{ text: `${product.name.slice(0, 35)}${kind === 'cart' ? ` × ${line.quantity}` : ''}`, callback_data: `lb:product:${product.id.replaceAll('-', '').slice(0, 12)}:${productParentRef}` }] : []), ...(kind === 'cart' ? [{ text: `${product.isDeleted || !product.isPublished ? 'حذف منتج غير متاح' : '−'}`, callback_data: `lb:commerce:remove:${product.id.replaceAll('-', '').slice(0, 12)}:${productParentRef}` }] : [])]).filter(row => row.length);
    if (kind === 'cart' && rows.length) buttons.push([{ text: 'تأكيد إنشاء الطلب والدفع يدويًا', callback_data: 'lb:commerce:checkout' }]);
    const subtotal = rows.reduce((sum, row) => sum + Math.round(Number(row.product.price) * 100) * row.line.quantity, 0);
    await context.send(`${kind === 'cart' ? '🛒 السلة' : `❤️ المفضلة · الصفحة ${page}`}\n${rows.length ? rows.map(({ product, line }) => `${product.name.slice(0, 70)} · ${product.price}${kind === 'cart' ? ` × ${line.quantity}` : ''}${product.isDeleted || !product.isPublished ? ' · غير متاح، احذفه قبل التأكيد' : product.stock < line.quantity ? ' · المخزون أقل من الكمية' : ''}`).join('\n') : 'لا توجد منتجات في هذه الصفحة.'}${kind === 'cart' && rows.length ? `\n\nالإجمالي قبل الخصم: ${(subtotal / 100).toFixed(2)} ${context.currency}\nيُطبق الكوبون الصالح عند التأكيد.` : ''}`, [...buttons, ...(kind === 'favorites' ? paginationButtons('lb:commerce:favorites', page, found.length > 10, parentSuffix) : []), ...footer], rows.length ? 'account' : 'empty');
  }
}
export async function setCustomerCoupon(customer: Customer, code: string) {
  if (!/^[A-Z0-9_-]{3,24}$/.test(code.trim().toUpperCase())) throw Error('رمز الكوبون غير صالح.');
  const [coupon] = await db.select().from(couponsTable).where(and(eq(couponsTable.storeId, customer.storeId), eq(couponsTable.code, code.trim().toUpperCase()))).limit(1);
  if (!coupon) throw Error('الكوبون غير صالح أو انتهى.');
  return assignCustomerCoupon(customer, coupon.id);
}
export async function recordReview(customer: Customer, code: string, stars: number) {
  if (!(await commerceAvailability(customer.storeId)).reviews || !Number.isInteger(stars) || stars < 1 || stars > 5) throw Error('التقييم غير متاح أو غير صالح.');
  const [product] = await db.select().from(productsTable).where(and(eq(productsTable.storeId, customer.storeId), eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true), sql`substring(replace(${productsTable.id},'-','') from 1 for 12)=${code}`)).limit(1);
  if (!product) throw Error('المنتج غير موجود.');
  const [purchase] = await db.select({ id: ordersTable.id }).from(ordersTable).innerJoin(orderItemsTable, eq(orderItemsTable.orderId, ordersTable.id)).where(and(eq(ordersTable.storeId, customer.storeId), eq(ordersTable.telegramUserId, customer.telegramUserId), eq(ordersTable.paymentStatus, 'paid'), ne(ordersTable.status, 'cancelled'), eq(orderItemsTable.productId, product.id))).limit(1);
  if (!purchase) throw Error('التقييم متاح للعملاء الذين اشتروا المنتج ودفعوا قيمته.');
  await db.transaction(async tx => { const id = createId(); const [created] = await tx.insert(reviewsTable).values({ id, storeId: customer.storeId, customerId: customer.id, productId: product.id, stars }).onConflictDoNothing().returning();
    if (created) await enqueueGrowthEvent(tx, { storeId: customer.storeId, telegramUserId: customer.telegramUserId, trigger: 'REVIEW_CREATED', eventId: id });
    else await tx.update(reviewsTable).set({ stars }).where(and(eq(reviewsTable.customerId, customer.id), eq(reviewsTable.productId, product.id))); });
}

export async function assignCustomerCoupon(customer: Customer, couponId: string) {
  await featureGate.require(customer.storeId, 'coupons.basic');
  if (!(await commerceAvailability(customer.storeId)).coupons) throw Error('الكوبونات غير مفعلة.');
  return db.transaction(async tx => {
    await tx.select().from(storesTable).where(eq(storesTable.id, customer.storeId)).for('update');
    const [settings] = await tx.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, customer.storeId)).limit(1);
    if (!settings?.couponsEnabled || !isFeatureAvailable(readPlanCode(settings.settings), 'coupons.basic', await getPlanCatalog(tx))) throw Error('الكوبونات غير مفعلة.');
    const [locked] = await tx.select().from(customersTable).where(and(eq(customersTable.id, customer.id), eq(customersTable.storeId, customer.storeId))).for('update');
    if (!locked) throw Error('العميل غير موجود.');
    const [coupon] = await tx.select().from(couponsTable).where(and(eq(couponsTable.id, couponId), eq(couponsTable.storeId, customer.storeId))).limit(1);
    const [used] = coupon ? await tx.select().from(couponUsesTable).where(and(eq(couponUsesTable.customerId, customer.id), eq(couponUsesTable.couponId, coupon.id))).limit(1) : [];
    if (!coupon || used || couponDiscount(Math.round(Number(coupon.minimum) * 100), coupon) === null) throw Error(used ? 'استخدمت هذا الكوبون سابقًا.' : 'الكوبون غير صالح أو انتهى.');
    await tx.update(customersTable).set({ state: { ...locked.state, couponId: coupon.id } }).where(eq(customersTable.id, customer.id));
    return coupon;
  });
}

export async function productReviewSummary(storeId: string, productId: string) {
  const [row] = await db.select({ count: count(), rating: sql<string | null>`avg(${reviewsTable.stars})` }).from(reviewsTable)
    .innerJoin(productsTable, eq(productsTable.id, reviewsTable.productId))
    .where(and(eq(reviewsTable.storeId, storeId), eq(productsTable.storeId, storeId), eq(reviewsTable.productId, productId), eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true)));
  return { count: Number(row?.count ?? 0), rating: row?.rating === null || row?.rating === undefined ? null : Math.round(Number(row.rating) * 10) / 10 };
}

/** Only a newly registered customer without any order may claim a referral. */
export async function registerCustomerReferral(customer: Customer, token: string, now = Date.now()) {
  const referrerId = referralCustomerId(token);
  if (!referrerId || referrerId === customer.id || now - customer.createdAt.getTime() < 0 || now - customer.createdAt.getTime() > 15 * 60 * 1000) return false;
  if (!(await commerceAvailability(customer.storeId)).referrals) return false;
  return db.transaction(async tx => {
    await tx.select().from(storesTable).where(eq(storesTable.id, customer.storeId)).for('update');
    const [locked] = await tx.select().from(customersTable).where(and(eq(customersTable.id, customer.id), eq(customersTable.storeId, customer.storeId))).for('update');
    if (!locked) return false;
    const [orders] = await tx.select({ n: count() }).from(ordersTable).where(and(eq(ordersTable.storeId, customer.storeId), eq(ordersTable.telegramUserId, locked.telegramUserId)));
    if (Number(orders.n) > 0) return false;
    const [referrer] = await tx.select().from(customersTable).where(and(eq(customersTable.id, referrerId), eq(customersTable.storeId, customer.storeId))).limit(1);
    if (!referrer) return false;
    // Walk existing parents to reject self references and referral cycles.
    const seen = new Set([customer.id]); let ancestor: string | undefined = referrer.id;
    for (let depth = 0; ancestor && depth < 30; depth++) {
      if (seen.has(ancestor)) return false; seen.add(ancestor);
      const [parent] = await tx.select({ referrerId: referralsTable.referrerId }).from(referralsTable).where(and(eq(referralsTable.storeId, customer.storeId), eq(referralsTable.customerId, ancestor))).limit(1);
      ancestor = parent?.referrerId;
    }
    if (ancestor) return false;
    const [created] = await tx.insert(referralsTable).values({ id: createId(), storeId: customer.storeId, customerId: customer.id, referrerId }).onConflictDoNothing({ target: referralsTable.customerId }).returning();
    if (!created) return false;
    await tx.update(customersTable).set({ state: { ...locked.state, referrerId } }).where(eq(customersTable.id, customer.id));
    return true;
  });
}

async function awardPoints(tx: Tx, customer: Customer, requested: number, sourceId: string, reason: string) {
  const { balance, awarded } = rewardBalance(customer.points, requested);
  if (!awarded) return 0;
  await tx.insert(customerLedgerTable).values({ id: sourceId, storeId: customer.storeId, customerId: customer.id, amount: awarded, reason });
  await tx.update(customersTable).set({ points: balance }).where(eq(customersTable.id, customer.id));
  await enqueueGrowthEvent(tx, { storeId: customer.storeId, telegramUserId: customer.telegramUserId, trigger: 'POINTS_EARNED', eventId: sourceId });
  return awarded;
}

/** Call in the same transaction that marks the owned order paid. */
export async function rewardPaidOrder(tx: Tx, order: Order) {
  if (order.paymentStatus !== 'paid' || order.status === 'cancelled' || !order.telegramUserId) return;
  const [settings] = await tx.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, order.storeId)).limit(1);
  const catalog = await getPlanCatalog(tx); const plan = readPlanCode(settings?.settings);
  const loyalty = !!settings?.pointsEnabled && isFeatureAvailable(plan, 'loyalty.basic', catalog);
  const referrals = !!settings?.referralsEnabled && isFeatureAvailable(plan, 'referrals.basic', catalog);
  const [customer] = await tx.select().from(customersTable).where(and(eq(customersTable.storeId, order.storeId), eq(customersTable.telegramUserId, order.telegramUserId))).for('update');
  if (!customer) return;
  const [receipt] = await tx.insert(commerceRewardsTable).values({ orderId: order.id, storeId: order.storeId, customerId: customer.id }).onConflictDoNothing().returning();
  if (!receipt) return;
  const points = loyalty ? await awardPoints(tx, customer, configuredReward(settings?.settings.pointsPerPaidOrder), `order-points:${order.id}`, 'مكافأة طلب مدفوع') : 0;
  let referralPoints = 0; let referrerId: string | null = null;
  if (referrals) {
    const [paid] = await tx.select({ n: count() }).from(ordersTable).where(and(eq(ordersTable.storeId, order.storeId), eq(ordersTable.telegramUserId, order.telegramUserId), eq(ordersTable.paymentStatus, 'paid'), ne(ordersTable.status, 'cancelled')));
    const [referral] = await tx.select().from(referralsTable).where(and(eq(referralsTable.storeId, order.storeId), eq(referralsTable.customerId, customer.id))).for('update');
    if (Number(paid.n) === 1 && referral && !referral.completed && referral.referrerId !== customer.id) {
      const [previous] = await tx.select().from(commerceRewardsTable).where(and(eq(commerceRewardsTable.storeId, order.storeId), eq(commerceRewardsTable.customerId, customer.id), sql`${commerceRewardsTable.referrerId} is not null`)).limit(1);
      if (!previous) {
        const [referrer] = await tx.select().from(customersTable).where(and(eq(customersTable.id, referral.referrerId), eq(customersTable.storeId, order.storeId))).for('update');
        if (referrer) {
          referrerId = referrer.id;
          referralPoints = loyalty ? await awardPoints(tx, referrer, configuredReward(settings?.settings.referralRewardPoints), `referral-points:${referral.id}`, 'مكافأة إحالة مكتملة') : 0;
          await tx.update(referralsTable).set({ completed: true }).where(eq(referralsTable.id, referral.id));
          await enqueueGrowthEvent(tx, { storeId: order.storeId, telegramUserId: referrer.telegramUserId, trigger: 'REFERRAL_COMPLETED', eventId: referral.id, orderId: order.id, orderValue: Number(order.total) });
        }
      }
    }
  }
  await tx.update(commerceRewardsTable).set({ points, referrerId, referralPoints }).where(eq(commerceRewardsTable.orderId, order.id));
}

/** Reverses the amount still available once; repeat refund updates stay inert. */
export async function reverseOrderRewards(tx: Tx, order: Order) {
  if (order.paymentStatus === 'paid' && order.status !== 'cancelled') return;
  const [receipt] = await tx.select().from(commerceRewardsTable).where(and(eq(commerceRewardsTable.orderId, order.id), eq(commerceRewardsTable.storeId, order.storeId))).for('update');
  if (!receipt || receipt.reversed) return;
  for (const [id, amount, label] of [[receipt.customerId, receipt.points, 'إلغاء نقاط طلب غير مدفوع'], [receipt.referrerId, receipt.referralPoints, 'إلغاء نقاط إحالة بعد استرداد الطلب']] as const) {
    if (!id || !amount) continue;
    const [customer] = await tx.select().from(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.storeId, order.storeId))).for('update');
    if (!customer) continue;
    const removed = Math.min(customer.points, amount);
    if (removed) { await tx.update(customersTable).set({ points: customer.points - removed }).where(eq(customersTable.id, id)); await tx.insert(customerLedgerTable).values({ id: `reverse:${order.id}:${id}`, storeId: order.storeId, customerId: id, amount: -removed, reason: label }); }
  }
  if (receipt.referrerId) await tx.update(referralsTable).set({ completed: false }).where(and(eq(referralsTable.storeId, order.storeId), eq(referralsTable.customerId, receipt.customerId), eq(referralsTable.referrerId, receipt.referrerId)));
  await tx.update(commerceRewardsTable).set({ reversed: true }).where(eq(commerceRewardsTable.orderId, order.id));
}
