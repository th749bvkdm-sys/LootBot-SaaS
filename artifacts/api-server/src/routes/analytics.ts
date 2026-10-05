import { and, count, desc, eq, gte, sql, sum } from 'drizzle-orm';
import { Router } from 'express';
import { db, customersTable, growthJobsTable, orderItemsTable, ordersTable, productsTable, storeSettingsTable, telegramBotsTable } from '@workspace/db';
import { requireAuth } from '../lib/auth-middleware';
import { getStoreAccess } from '../lib/staff-access';
import { featureGate, getPlanCatalog, getPlanUsage, getStorePlan } from '../lib/store-plans';
import { FEATURE_METADATA } from '../lib/plans';
import { readHomeStudio } from '../lib/telegram-home-configuration';
import { readBusinessStudio } from '../lib/telegram-business-configuration';

const router = Router();
const numeric = (value: unknown) => Number(value ?? 0);
router.get('/stores/:storeId/plan-catalog', requireAuth, async (req, res) => {
  const storeId = String(req.params.storeId);
  const access = await getStoreAccess(storeId, req.auth!.userId, 'member');
  if (!access) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  const [plan, catalog, usage] = await Promise.all([getStorePlan(storeId), getPlanCatalog(), getPlanUsage(storeId, access.ownerId)]);
  res.json({ plan, catalog, usage, featureMetadata: FEATURE_METADATA, billing: 'manual_admin_assignment' });
});
router.get('/stores/:storeId/workspace-summary', requireAuth, async (req, res) => {
  const storeId = String(req.params.storeId);
  const access = await getStoreAccess(storeId, req.auth!.userId, 'overview.read');
  if (!access) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  const [plan, catalog, usage, customers, pending, lowStock, jobs, recentOrders, bot, settings, totals, published] = await Promise.all([
    getStorePlan(storeId), getPlanCatalog(), getPlanUsage(storeId, access.ownerId),
    db.select({ total: count(), optedIn: sql<number>`count(*) filter (where ${customersTable.optedIn} = true)::integer` }).from(customersTable).where(eq(customersTable.storeId, storeId)),
    db.select({ total: count() }).from(ordersTable).where(and(eq(ordersTable.storeId, storeId), eq(ordersTable.status, 'pending'))),
    db.select({ total: count() }).from(productsTable).where(and(eq(productsTable.storeId, storeId), eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true), sql`${productsTable.stock} <= 3`)),
    db.select({ status: growthJobsTable.status, total: count() }).from(growthJobsTable).where(eq(growthJobsTable.storeId, storeId)).groupBy(growthJobsTable.status),
    db.select({ id: ordersTable.id, customerName: ordersTable.customerName, status: ordersTable.status, paymentStatus: ordersTable.paymentStatus, total: ordersTable.total, createdAt: ordersTable.createdAt }).from(ordersTable).where(eq(ordersTable.storeId, storeId)).orderBy(desc(ordersTable.createdAt)).limit(6),
    db.select({ status: telegramBotsTable.status, username: telegramBotsTable.username, lastSuccessfulPollAt: telegramBotsTable.lastSuccessfulPollAt, lastConnectionTestAt: telegramBotsTable.lastConnectionTestAt, lastError: telegramBotsTable.lastError, lastConnectionTestError: telegramBotsTable.lastConnectionTestError }).from(telegramBotsTable).where(eq(telegramBotsTable.storeId, storeId)).limit(1),
    db.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, storeId)).limit(1),
    db.select({ orders: count(), revenue: sql<string>`coalesce(sum(${ordersTable.total}) filter (where ${ordersTable.paymentStatus} = 'paid'),0)` }).from(ordersTable).where(eq(ordersTable.storeId, storeId)),
    db.select({ total: count() }).from(productsTable).where(and(eq(productsTable.storeId, storeId), eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true))),
  ]);
  const home = readHomeStudio(settings[0]?.settings.telegramHomeStudio), business = readBusinessStudio(settings[0]?.settings.telegramBusinessStudio);
  const latestPoll = bot[0]?.lastSuccessfulPollAt ?? null;
  const live = !!latestPoll && Date.now() - latestPoll.getTime() < 180_000 && bot[0]?.status === 'connected';
  res.json({
    plan, planName: catalog[plan].name, features: catalog[plan].features, limits: catalog[plan].limits, usage,
    customers: numeric(customers[0]?.total), optedInCustomers: numeric(customers[0]?.optedIn), pendingOrders: numeric(pending[0]?.total), lowStockProducts: numeric(lowStock[0]?.total),
    orderCount: numeric(totals[0]?.orders), revenue: access.isOwner ? numeric(totals[0]?.revenue) : null, publishedProducts: numeric(published[0]?.total),
    jobs: Object.fromEntries(jobs.map(job => [job.status, numeric(job.total)])),
    recentOrders: access.permissions.includes('orders.read') ? recentOrders.map(order => ({ ...order, total: access.isOwner ? numeric(order.total) : null })) : [],
    telegram: { linked: !!bot[0], live, status: live ? 'healthy' : bot[0] ? 'attention' : 'disconnected', username: bot[0]?.username ?? null, lastSuccessfulPollAt: latestPoll, lastConnectionTestAt: bot[0]?.lastConnectionTestAt ?? null, hasError: !!(bot[0]?.lastError || bot[0]?.lastConnectionTestError), published: settings[0]?.settings.telegramHomeMode === 'business' ? !!business.published : !!home.published, revision: settings[0]?.settings.telegramHomeMode === 'business' ? business.revision : home.revision },
    isOwner: access.isOwner,
  });
});
router.get('/stores/:storeId/analytics', requireAuth, async (req, res) => {
  const storeId = String(req.params.storeId);
  const access = await getStoreAccess(storeId, req.auth!.userId, 'analytics.read');
  if (!access) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  await featureGate.require(storeId, 'analytics.basic');
  const rawDays = req.query.days === undefined ? 30 : Number(req.query.days);
  if (![7, 30, 90].includes(rawDays)) { res.status(400).json({ error: 'اختر فترة 7 أو 30 أو 90 يومًا.' }); return; }
  const advanced = await featureGate.can(storeId, 'analytics.advanced');
  if (rawDays === 90 && !advanced) { res.status(403).json({ code: 'FEATURE_LOCKED', requiredPlan: 'BUSINESS', error: 'الفترة الممتدة تتطلب خطة Business.' }); return; }
  const since = new Date(); since.setUTCHours(0, 0, 0, 0); since.setUTCDate(since.getUTCDate() - rawDays + 1);
  const dateExpression = sql<string>`to_char(${ordersTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const scope = and(eq(ordersTable.storeId, storeId), gte(ordersTable.createdAt, since));
  const [daily, statuses, payments, aggregate, topProducts, topCustomers, customerCount] = await Promise.all([
    db.select({ date: dateExpression, orders: count(), paidOrders: sql<number>`count(*) filter (where ${ordersTable.paymentStatus} = 'paid')::integer`, revenue: sql<string>`coalesce(sum(${ordersTable.total}) filter (where ${ordersTable.paymentStatus} = 'paid'),0)` }).from(ordersTable).where(scope).groupBy(dateExpression).orderBy(dateExpression),
    db.select({ status: ordersTable.status, total: count() }).from(ordersTable).where(scope).groupBy(ordersTable.status),
    db.select({ status: ordersTable.paymentStatus, total: count() }).from(ordersTable).where(scope).groupBy(ordersTable.paymentStatus),
    db.select({ total: count(), revenue: sql<string>`coalesce(sum(${ordersTable.total}) filter (where ${ordersTable.paymentStatus} = 'paid'),0)`, average: sql<string>`coalesce(avg(${ordersTable.total}) filter (where ${ordersTable.paymentStatus} = 'paid'),0)` }).from(ordersTable).where(scope),
    advanced ? db.select({ productId: orderItemsTable.productId, name: orderItemsTable.productName, quantity: sum(orderItemsTable.quantity), revenue: sum(orderItemsTable.lineTotal) }).from(orderItemsTable).innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id)).where(and(scope, eq(ordersTable.paymentStatus, 'paid'))).groupBy(orderItemsTable.productId, orderItemsTable.productName).orderBy(desc(sum(orderItemsTable.quantity))).limit(10) : Promise.resolve([]),
    advanced && access.isOwner ? db.select({ name: ordersTable.customerName, telegramUserId: ordersTable.telegramUserId, orders: count(), revenue: sum(ordersTable.total) }).from(ordersTable).where(and(scope, eq(ordersTable.paymentStatus, 'paid'))).groupBy(ordersTable.telegramUserId, ordersTable.customerName).orderBy(desc(sum(ordersTable.total))).limit(10) : Promise.resolve([]),
    db.select({ total: count() }).from(customersTable).where(and(eq(customersTable.storeId, storeId), gte(customersTable.createdAt, since))),
  ]);
  const series = Array.from({ length: rawDays }, (_, index) => {
    const day = new Date(since); day.setUTCDate(day.getUTCDate() + index); const date = day.toISOString().slice(0, 10);
    const row = daily.find(item => item.date === date);
    return { date, orders: numeric(row?.orders), paidOrders: numeric(row?.paidOrders), revenue: access.isOwner ? numeric(row?.revenue) : null };
  });
  const visits = advanced ? await db.execute(sql`
    select entries.key as variant, count(distinct customer.id)::integer as customers
    from customers customer
    cross join lateral jsonb_each(case when jsonb_typeof(customer.state->'experimentVisits') = 'object' then customer.state->'experimentVisits' else '{}'::jsonb end) entries
    where customer.store_id = ${storeId} and entries.value = 'true'::jsonb
    group by entries.key order by entries.key
  `) : { rows: [] };
  const experimentVisits = visits.rows.filter((row: Record<string, unknown>) => typeof row.variant === 'string' && /^[a-zA-Z0-9_-]{1,24}:[AB]$/.test(row.variant)).map((row: Record<string, unknown>) => ({ variant: String(row.variant), customers: numeric(row.customers) }));
  res.json({ days: rawDays, timezone: 'UTC', currency: access.currency, advanced, canViewFinancials: access.isOwner,
    totals: { orders: numeric(aggregate[0]?.total), newCustomers: numeric(customerCount[0]?.total), revenue: access.isOwner ? numeric(aggregate[0]?.revenue) : null, averagePaidOrder: access.isOwner ? numeric(aggregate[0]?.average) : null },
    daily: series, statuses, payments: access.isOwner ? payments : [],
    topProducts: topProducts.map(product => ({ ...product, quantity: numeric(product.quantity), revenue: access.isOwner ? numeric(product.revenue) : null })),
    topCustomers: topCustomers.map(customer => ({ ...customer, orders: numeric(customer.orders), revenue: numeric(customer.revenue) })),
    experimentVisits,
    exportEnabled: access.isOwner && await featureGate.can(storeId, 'analytics.reports'),
  });
});
export default router;
