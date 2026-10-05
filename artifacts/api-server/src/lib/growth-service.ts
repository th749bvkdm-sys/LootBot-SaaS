import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { db, categoriesTable, customersTable, customerLedgerTable, growthResourcesTable, growthJobsTable, ordersTable, orderItemsTable, productsTable, storeSettingsTable, storesTable, telegramBotsTable, couponsTable, couponUsesTable, referralsTable } from '@workspace/db';
import { createId, decryptBotToken } from './security';
import { evaluateRule, type CustomerFacts } from './customer-rules';
import { actionMatches, audienceMatches, parseGrowthConfiguration, renderGrowthText, type GrowthAction, type GrowthTrigger } from './growth-configuration';
import { couponDiscount } from './commerce-validation';
import { featureGate, getStorePlan } from './store-plans';
import { logger } from './logger';
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function enqueueGrowthEvent(tx: Tx, input: { storeId: string; telegramUserId: string; trigger: GrowthTrigger; eventId: string; orderValue?: number; orderId?: string; depth?: number }) {
  const depth = input.depth ?? 0;
  if (!Number.isInteger(depth) || depth < 0 || depth > 3) return;
  await tx.insert(growthJobsTable).values({ id: createId(), storeId: input.storeId, dedupeKey: `event:${input.trigger}:${input.eventId}`, payload: { type: 'EVENT', ...input } })
    .onConflictDoNothing({ target: [growthJobsTable.storeId, growthJobsTable.dedupeKey] });
}
export async function touchCustomer(input: { storeId: string; userId: number; chatId: number; name: string; username?: string; optIn?: boolean }) {
  return db.transaction(async tx => {
    const [created] = await tx.insert(customersTable).values({ id: createId(), storeId: input.storeId, telegramUserId: String(input.userId), telegramChatId: String(input.chatId), name: input.name.slice(0, 80), username: input.username })
      .onConflictDoNothing({ target: [customersTable.storeId, customersTable.telegramUserId] }).returning();
    if (created) await enqueueGrowthEvent(tx, { storeId: input.storeId, telegramUserId: String(input.userId), trigger: 'USER_REGISTERED', eventId: created.id });
    const [customer] = await tx.update(customersTable).set({ name: input.name.slice(0, 80), username: input.username ?? null, telegramChatId: String(input.chatId), lastSeenAt: new Date(), ...(input.optIn !== undefined ? { optedIn: input.optIn } : {}) })
      .where(and(eq(customersTable.storeId, input.storeId), eq(customersTable.telegramUserId, String(input.userId)))).returning();
    return customer;
  });
}
export async function customerFacts(customer: typeof customersTable.$inferSelect, event: Record<string, unknown> = {}): Promise<CustomerFacts> {
  const [usage] = await db.select({ orders: count(), active: sql<number>`count(*) filter (where ${ordersTable.status} in ('pending','confirmed'))`,
    spend: sql<string>`coalesce(sum(${ordersTable.total}) filter (where ${ordersTable.paymentStatus} = 'paid'),0)` }).from(ordersTable)
    .where(and(eq(ordersTable.storeId, customer.storeId), eq(ordersTable.telegramUserId, customer.telegramUserId)));
  const [settings] = await db.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, customer.storeId)).limit(1);
  const productIds = typeof event.orderId === 'string' ? await db.select({ productId: orderItemsTable.productId, categoryId: productsTable.categoryId }).from(orderItemsTable)
    .leftJoin(productsTable, eq(productsTable.id, orderItemsTable.productId)).innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
    .where(and(eq(orderItemsTable.orderId, event.orderId), eq(ordersTable.storeId, customer.storeId), eq(ordersTable.telegramUserId, customer.telegramUserId))) : [];
  const now = new Date();
  const [selectedCoupon] = typeof customer.state.couponId === 'string' ? await db.select().from(couponsTable).where(and(eq(couponsTable.id, customer.state.couponId), eq(couponsTable.storeId, customer.storeId))).limit(1) : [];
  const [redemption] = selectedCoupon ? await db.select({ id: couponUsesTable.id }).from(couponUsesTable).where(and(eq(couponUsesTable.couponId, selectedCoupon.id), eq(couponUsesTable.customerId, customer.id))).limit(1) : [];
  const [referral] = await db.select({ id: referralsTable.id }).from(referralsTable).where(and(eq(referralsTable.storeId, customer.storeId), eq(referralsTable.customerId, customer.id))).limit(1);
  const attribution = customer.state.currentCampaign;
  const context = attribution && typeof attribution === 'object' && !Array.isArray(attribution) ? attribution as Record<string, unknown> : null;
  const candidateCampaign = typeof event.campaignId === 'string' ? event.campaignId : context && typeof context.resourceId === 'string' && typeof context.jobId === 'string' && typeof context.expiresAt === 'string' && Date.parse(context.expiresAt) > now.getTime() ? context.resourceId : '';
  const [campaign] = candidateCampaign ? await db.select({ id: growthResourcesTable.id }).from(growthResourcesTable).where(and(eq(growthResourcesTable.id, candidateCampaign), eq(growthResourcesTable.storeId, customer.storeId), eq(growthResourcesTable.kind, 'broadcast'), inArray(growthResourcesTable.status, ['running', 'completed']))).limit(1) : [];
  const [campaignDelivery] = campaign && typeof event.campaignId !== 'string' ? await db.select({ id: growthJobsTable.id }).from(growthJobsTable).where(and(eq(growthJobsTable.id, String(context?.jobId)), eq(growthJobsTable.storeId, customer.storeId), eq(growthJobsTable.customerId, customer.id), eq(growthJobsTable.resourceId, campaign.id), eq(growthJobsTable.status, 'completed'), sql`${growthJobsTable.completedAt}>${new Date(now.getTime() - 86400000)} and ${growthJobsTable.payload}->>'type'='ACTION' and ${growthJobsTable.payload}->'action'->>'type' in ('SEND_MESSAGE','SEND_PRODUCT','SEND_CATEGORY','SEND_COUPON') and ${growthJobsTable.payload}->'event'->>'campaignId'=${campaign.id}`)).limit(1) : [];
  const facts: CustomerFacts = { USER_LOGGED_IN: true, USER_NEW: Number(usage?.orders ?? 0) === 0, HAS_ORDERS: Number(usage?.orders ?? 0) > 0,
    HAS_ACTIVE_ORDER: Number(usage?.active ?? 0) > 0, VIP_LEVEL: customer.vipLevel, POINTS_GREATER_THAN: customer.points,
    ORDER_COUNT_GREATER_THAN: Number(usage?.orders ?? 0), TOTAL_SPEND_GREATER_THAN: Number(usage?.spend ?? 0), HAS_COUPON: !!settings?.couponsEnabled && !!selectedCoupon && !redemption && couponDiscount(Math.round(Number(selectedCoupon.minimum) * 100), selectedCoupon) !== null && await featureGate.can(customer.storeId, 'coupons.basic'),
    HAS_REFERRAL: !!referral, CUSTOMER_TAG: customer.tags, CUSTOMER_SEGMENT: [],
    DATE_RANGE: now.getTime(), TIME_RANGE: now.toISOString().slice(11, 16), CAMPAIGN: campaign && (typeof event.campaignId === 'string' || campaignDelivery) ? campaign.id : '',
    STORE_MODE: typeof settings?.settings.storeMode === 'string' ? settings.settings.storeMode : 'normal', PLAN: await getStorePlan(customer.storeId),
    ORDER_VALUE: Number(event.orderValue ?? 0), PRODUCT: productIds.flatMap(p => p.productId ? [p.productId] : []), CATEGORY: productIds.flatMap(p => p.categoryId ? [p.categoryId] : []) };
  if (await featureGate.can(customer.storeId, 'telegram.studio')) {
    const segments = await db.select().from(growthResourcesTable).where(and(eq(growthResourcesTable.storeId, customer.storeId), eq(growthResourcesTable.kind, 'segment'), eq(growthResourcesTable.enabled, true))).limit(100);
    for (const segment of segments) {
      const config = parseGrowthConfiguration(segment.configuration);
      const excluded = Array.isArray(customer.state.segmentExclusions) && customer.state.segmentExclusions.includes(segment.id);
      if (config && !excluded && (customer.segments.includes(segment.id) || evaluateRule(config.condition, facts))) (facts.CUSTOMER_SEGMENT as string[]).push(segment.id);
    }
  }
  return facts;
}
export async function queueActions(tx: Tx, input: { storeId: string; resourceId: string; customerId: string; actions: GrowthAction[]; event: Record<string, unknown>; dedupe: string; startsAt?: Date }) {
  let delay = 0; let previousJobId: string | undefined; const startsAt = input.startsAt?.getTime() ?? Date.now();
  for (const [index, action] of input.actions.entries()) {
    delay += action.delaySeconds;
    const dedupeKey = `${input.dedupe}:${input.customerId}:${index}`;
    const [inserted] = await tx.insert(growthJobsTable).values({ id: createId(), storeId: input.storeId, resourceId: input.resourceId, customerId: input.customerId,
      dedupeKey, availableAt: new Date(startsAt + delay * 1000 + index),
      payload: { type: 'ACTION', action, event: input.event, ...(previousJobId ? { previousJobId } : {}) } }).onConflictDoNothing({ target: [growthJobsTable.storeId, growthJobsTable.dedupeKey] }).returning({ id: growthJobsTable.id });
    const [existing] = inserted ? [] : await tx.select({ id: growthJobsTable.id }).from(growthJobsTable).where(and(eq(growthJobsTable.storeId, input.storeId), eq(growthJobsTable.dedupeKey, dedupeKey))).limit(1);
    previousJobId = inserted?.id ?? existing?.id;
  }
}
class DeliveryError extends Error { constructor(message: string, readonly retrySeconds = 0, readonly permanent = false) { super(message); } }
async function deliver(storeId: string, chatId: string, text: string, imageUrl = '', buttons?: { text: string; callback_data?: string; url?: string }[][]) {
  const [bot] = await db.select().from(telegramBotsTable).where(and(eq(telegramBotsTable.storeId, storeId), eq(telegramBotsTable.status, 'connected'))).limit(1);
  if (!bot) throw new Error('البوت غير متصل.');
  const token = decryptBotToken(bot.encryptedToken);
  const body = imageUrl ? { chat_id: chatId, photo: imageUrl, caption: text.length > 1024 ? '' : text, ...(buttons && text.length <= 1024 ? { reply_markup: { inline_keyboard: buttons } } : {}) }
    : { chat_id: chatId, text: text.slice(0, 3900), ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) };
  let response: Response;
  try { response = await fetch(`https://api.telegram.org/bot${token}/${imageUrl ? 'sendPhoto' : 'sendMessage'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error('تعذر الاتصال بـ Telegram.'); }
  const payload = await response.json().catch(() => null) as { ok?: boolean; error_code?: number; parameters?: { retry_after?: number } } | null;
  if (!response.ok || !payload?.ok) {
    if (payload?.error_code === 403) await db.update(customersTable).set({ optedIn: false }).where(and(eq(customersTable.storeId, storeId), eq(customersTable.telegramChatId, chatId)));
    const delay = payload?.error_code === 429 ? Math.min(86400, Math.max(1, Number(payload.parameters?.retry_after) || 60)) : 0;
    throw new DeliveryError(payload?.error_code === 403 ? 'رفض العميل الرسائل أو حظر البوت.' : payload?.error_code === 429 ? 'أوقف Telegram الإرسال مؤقتًا؛ سيعاد التنفيذ بعد المهلة.' : 'رفض Telegram الرسالة.', delay, payload?.error_code === 403 || payload?.error_code === 400);
  }
  if (imageUrl && text.length > 1024) { await new Promise(resolve => setTimeout(resolve, 1200)); await deliver(storeId, chatId, text, '', buttons); }
}
async function runJob(job: typeof growthJobsTable.$inferSelect) {
  const [store] = await db.select().from(storesTable).where(and(eq(storesTable.id, job.storeId), eq(storesTable.isDeleted, false))).limit(1);
  if (!store) throw new Error('المتجر غير متاح.');
  if (typeof job.payload.previousJobId === 'string') {
    const [previous] = await db.select({ status: growthJobsTable.status }).from(growthJobsTable).where(and(eq(growthJobsTable.id, job.payload.previousJobId), eq(growthJobsTable.storeId, job.storeId), eq(growthJobsTable.customerId, job.customerId!))).limit(1);
    if (!previous || previous.status !== 'completed') {
      await db.update(growthJobsTable).set({ status: 'cancelled', lastError: 'لم ينفّذ الإجراء لأن الإجراء السابق فشل أو توقف.', lockedUntil: null }).where(eq(growthJobsTable.id, job.id)); return;
    }
  }
  if (job.payload.type === 'EVENT') {
    if (!await featureGate.can(job.storeId, 'telegram.studio')) return;
    const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.storeId, job.storeId), eq(customersTable.telegramUserId, String(job.payload.telegramUserId)))).limit(1);
    if (!customer) return;
    const facts = await customerFacts(customer, job.payload);
    const resources = await db.select().from(growthResourcesTable).where(and(eq(growthResourcesTable.storeId, job.storeId), inArray(growthResourcesTable.kind, ['automation', 'journey']), eq(growthResourcesTable.enabled, true))).limit(100);
    await db.transaction(async tx => {
      for (const resource of resources) {
        const config = parseGrowthConfiguration(resource.configuration);
        if (!config || config.trigger !== job.payload.trigger || (job.payload.resourceId && job.payload.resourceId !== resource.id) || !evaluateRule(config.condition, facts)) continue;
        await queueActions(tx, { storeId: job.storeId, resourceId: resource.id, customerId: customer.id, actions: config.actions, event: job.payload, dedupe: `${job.dedupeKey}:${resource.id}` });
      }
    }); return;
  }
  const [resource] = job.resourceId ? await db.select().from(growthResourcesTable).where(and(eq(growthResourcesTable.id, job.resourceId), eq(growthResourcesTable.storeId, job.storeId))).limit(1) : [];
  if (!resource || resource.status === 'cancelled' || (!resource.enabled && resource.kind !== 'broadcast')) return;
  await featureGate.require(job.storeId, resource.kind === 'broadcast' ? 'telegram.advanced' : 'telegram.studio');
  const config = parseGrowthConfiguration(resource.configuration);
  if (!config) throw new Error('إعدادات التنفيذ غير صالحة.');
  if (job.payload.type === 'PREPARE') {
    const cursor = typeof job.payload.cursor === 'string' ? job.payload.cursor : '';
    const audience = await db.select().from(customersTable).where(and(eq(customersTable.storeId, job.storeId), eq(customersTable.optedIn, true), cursor ? sql`${customersTable.id}>${cursor}` : undefined))
      .orderBy(customersTable.id).limit(50);
    for (const recipient of audience) {
      const facts = await customerFacts(recipient, { campaignId: resource.id });
      if (!audienceMatches(config.audience, recipient, facts) || !evaluateRule(config.condition, facts)) continue;
      await db.transaction(tx => queueActions(tx, { storeId: job.storeId, resourceId: resource.id, customerId: recipient.id, actions: config.actions,
        event: { campaignId: resource.id, runId: job.payload.runId }, dedupe: `broadcast:${resource.id}:${job.payload.runId}`, startsAt: config.scheduleAt ? new Date(config.scheduleAt) : undefined }));
    }
    if (audience.length === 50) await db.insert(growthJobsTable).values({ id: createId(), storeId: job.storeId, resourceId: resource.id,
      dedupeKey: `prepare:${resource.id}:${job.payload.runId}:${audience[49].id}`, payload: { type: 'PREPARE', runId: job.payload.runId, cursor: audience[49].id } })
      .onConflictDoNothing({ target: [growthJobsTable.storeId, growthJobsTable.dedupeKey] });
    return;
  }
  const candidate = parseGrowthConfiguration({ ...config, kind: 'automation', actions: [job.payload.action] });
  const action = candidate?.actions[0];
  if (!action) throw new Error('الإجراء غير صالح.');
  const [customer] = job.customerId ? await db.select().from(customersTable).where(and(eq(customersTable.id, job.customerId), eq(customersTable.storeId, job.storeId))).limit(1) : [];
  if (!customer) throw new Error('العميل غير موجود.');
  const event = typeof job.payload.event === 'object' && job.payload.event ? job.payload.event as Record<string, unknown> : {};
  if (!actionMatches(action, await customerFacts(customer, event))) return;
  if (['ADD_POINTS', 'REMOVE_POINTS', 'ADD_TAG', 'REMOVE_TAG', 'ADD_SEGMENT', 'REMOVE_SEGMENT'].includes(action.type)) {
    await db.transaction(async tx => {
      const [locked] = await tx.select().from(customersTable).where(and(eq(customersTable.id, customer.id), eq(customersTable.storeId, job.storeId))).for('update');
      const [currentJob] = await tx.select().from(growthJobsTable).where(eq(growthJobsTable.id, job.id)).for('update');
      if (!locked || currentJob?.status === 'completed') return;
      if (action.type.includes('POINTS')) {
        await featureGate.require(job.storeId, 'loyalty.basic');
        const delta = action.type === 'ADD_POINTS' ? action.amount : -action.amount;
        if (locked.points + delta < 0 || locked.points + delta > 2000000000) throw new Error('رصيد النقاط غير كافٍ أو يتجاوز الحد.');
        await tx.insert(customerLedgerTable).values({ id: createId(), storeId: job.storeId, customerId: customer.id, jobId: job.id, amount: delta, reason: resource.name });
        await tx.update(customersTable).set({ points: locked.points + delta }).where(eq(customersTable.id, customer.id));
        if (delta > 0) await enqueueGrowthEvent(tx, { storeId: job.storeId, telegramUserId: customer.telegramUserId, trigger: 'POINTS_EARNED', eventId: job.id, depth: Number(event.depth ?? 0) + 1 });
      } else {
        const isTag = action.type.includes('TAG'); const old = isTag ? locked.tags : locked.segments;
        if (!isTag) { const [segment] = await tx.select().from(growthResourcesTable).where(and(eq(growthResourcesTable.id, action.target), eq(growthResourcesTable.storeId, job.storeId), eq(growthResourcesTable.kind, 'segment'))).limit(1); if (!segment) throw new Error('الشريحة المستهدفة غير موجودة.'); }
        const next = action.type.startsWith('ADD') ? [...new Set([...old, action.target])] : old.filter(v => v !== action.target);
        if (next.length > 50) throw new Error('العميل بلغ الحد الأقصى للوسوم أو الشرائح.');
        const exclusions = Array.isArray(locked.state.segmentExclusions) ? locked.state.segmentExclusions.filter((id): id is string => typeof id === 'string') : [];
        const segmentExclusions = action.type === 'REMOVE_SEGMENT' ? [...new Set([...exclusions, action.target])].slice(-100) : exclusions.filter(id => id !== action.target);
        await tx.update(customersTable).set(isTag ? { tags: next } : { segments: next, state: { ...locked.state, segmentExclusions } }).where(eq(customersTable.id, customer.id));
      }
      await tx.update(growthJobsTable).set({ status: 'completed', completedAt: new Date(), lockedUntil: null }).where(eq(growthJobsTable.id, job.id));
    }); return;
  }
  if (!customer.optedIn && action.type !== 'NOTIFY_ADMIN') throw new DeliveryError('العميل أوقف الرسائل.', 0, true);
  let content = action.text; const buttons: { text: string; callback_data?: string; url?: string }[][] = [];
  if (action.type === 'SEND_PRODUCT') {
    const [product] = await db.select().from(productsTable).where(and(eq(productsTable.id, action.target), eq(productsTable.storeId, job.storeId), eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true))).limit(1);
    if (!product) throw new DeliveryError('المنتج المستهدف غير متاح.', 0, true);
    content = `${content}\n${product.name}\n${product.price} ${store.currency}`; buttons.push([{ text: 'عرض المنتج', callback_data: `lb:product:${product.id.replaceAll('-', '').slice(0, 12)}` }]);
  } else if (action.type === 'SEND_CATEGORY') {
    const [category] = await db.select().from(categoriesTable).where(and(eq(categoriesTable.id, action.target), eq(categoriesTable.storeId, job.storeId), eq(categoriesTable.isDeleted, false))).limit(1);
    if (!category) throw new DeliveryError('التصنيف المستهدف غير متاح.', 0, true);
    content = `${content}\n${category.name}`; buttons.push([{ text: 'عرض التصنيف', callback_data: `lb:category:${action.target}:1` }]);
  }
  else if (action.type === 'SEND_COUPON') {
    const { assignCustomerCoupon } = await import('./customer-commerce');
    const coupon = await assignCustomerCoupon(customer, action.target);
    content = `${content}\n🎫 ${coupon.code} · خصم ${coupon.percent}%\nالحد الأدنى ${coupon.minimum} ${store.currency}${coupon.expiresAt ? `\nصالح حتى ${coupon.expiresAt.toISOString().slice(0, 10)}` : ''}`;
    buttons.push([{ text: 'الكوبونات والسلة', callback_data: 'lb:commerce:coupons' }]);
  }
  for (const button of action.buttons ?? []) {
    if (button.type === 'OPEN_PRODUCT') {
      const [product] = await db.select({ id: productsTable.id }).from(productsTable).where(and(eq(productsTable.id, button.target), eq(productsTable.storeId, job.storeId), eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true))).limit(1);
      if (!product) throw new DeliveryError('منتج أحد الأزرار غير متاح.', 0, true);
    } else if (button.type === 'OPEN_CATEGORY') {
      const [category] = await db.select({ id: categoriesTable.id }).from(categoriesTable).where(and(eq(categoriesTable.id, button.target), eq(categoriesTable.storeId, job.storeId), eq(categoriesTable.isDeleted, false))).limit(1);
      if (!category) throw new DeliveryError('تصنيف أحد الأزرار غير متاح.', 0, true);
    }
    buttons.push([{ text: button.text, ...(button.type === 'OPEN_URL' ? { url: button.target } : { callback_data: button.type === 'OPEN_PRODUCT' ? `lb:product:${button.target.replaceAll('-', '').slice(0, 12)}` : button.type === 'OPEN_CATEGORY' ? `lb:category:${button.target}:1` : 'lb:home' }) }]);
  }
  const [settings] = await db.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, job.storeId)).limit(1);
  const chatId = action.type === 'NOTIFY_ADMIN' ? settings?.settings.adminTelegramChatId : customer.telegramChatId;
  if (typeof chatId !== 'string' || !/^-?\d+$/.test(chatId)) throw new Error('حدد معرّف محادثة مسؤول المتجر للإشعارات.');
  content = renderGrowthText(content, store.name, customer.name);
  await deliver(job.storeId, chatId, content, action.imageUrl, buttons.length ? buttons : undefined);
  if (resource.kind === 'broadcast' && event.campaignId === resource.id) {
    await db.transaction(async tx => {
      const [locked] = await tx.select().from(customersTable).where(and(eq(customersTable.id, customer.id), eq(customersTable.storeId, job.storeId))).for('update');
      const [currentJob] = await tx.select().from(growthJobsTable).where(eq(growthJobsTable.id, job.id)).for('update');
      if (!locked || currentJob?.status === 'completed') return;
      const deliveredAt = new Date();
      await tx.update(customersTable).set({ state: { ...locked.state, currentCampaign: { resourceId: resource.id, jobId: job.id, deliveredAt: deliveredAt.toISOString(), expiresAt: new Date(deliveredAt.getTime() + 86400000).toISOString() } } }).where(eq(customersTable.id, customer.id));
      await tx.update(growthJobsTable).set({ status: 'completed', completedAt: deliveredAt, lockedUntil: null, lastError: null }).where(eq(growthJobsTable.id, job.id));
    });
  }
}
let running = false; let timer: ReturnType<typeof setInterval> | null = null;
export async function processGrowthJobs(storeId?: string) {
  if (running) return; running = true;
  try {
    const job = await db.transaction(async tx => {
      // A short global lock protects the delivery slot across multiple server processes.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('lootbot:growth-delivery-slot'))`);
      const [busy] = await tx.select({ id: growthJobsTable.id }).from(growthJobsTable).where(sql`${growthJobsTable.status}='running' and ${growthJobsTable.lockedUntil}>now()`).limit(1);
      if (busy) return null;
      const [recent] = await tx.select({ id: growthJobsTable.id }).from(growthJobsTable).where(sql`${growthJobsTable.completedAt}>now()-interval '1200 milliseconds' and ${growthJobsTable.payload}->>'type'='ACTION'`).limit(1);
      if (recent) return null;
      const [candidate] = await tx.select().from(growthJobsTable).where(and(storeId ? eq(growthJobsTable.storeId, storeId) : undefined,
        sql`((${growthJobsTable.status}='queued' and ${growthJobsTable.availableAt}<=now()) or (${growthJobsTable.status}='running' and ${growthJobsTable.lockedUntil}<now())) and (${growthJobsTable.payload}->>'previousJobId' is null or exists (select 1 from growth_jobs previous where previous.id=${growthJobsTable.payload}->>'previousJobId' and previous.store_id=${growthJobsTable.storeId} and previous.status in ('completed','failed','cancelled')))`))
        .orderBy(growthJobsTable.availableAt).limit(1).for('update', { skipLocked: true });
      if (!candidate) return null;
      if (candidate.attempts >= 3) {
        await tx.update(growthJobsTable).set({ status: 'failed', lastError: 'توقف التنفيذ بعد انتهاء مهلة المحاولات.', lockedUntil: null }).where(eq(growthJobsTable.id, candidate.id));
        if (candidate.resourceId) { const [remaining] = await tx.select({ id: growthJobsTable.id }).from(growthJobsTable).where(and(eq(growthJobsTable.resourceId, candidate.resourceId), inArray(growthJobsTable.status, ['queued', 'running']))).limit(1); if (!remaining) await tx.update(growthResourcesTable).set({ status: 'failed', updatedAt: new Date() }).where(and(eq(growthResourcesTable.id, candidate.resourceId), eq(growthResourcesTable.kind, 'broadcast'), sql`${growthResourcesTable.status}<>'cancelled'`)); }
        return null;
      }
      const [claimed] = await tx.update(growthJobsTable).set({ status: 'running', attempts: candidate.attempts + 1, lockedUntil: new Date(Date.now() + 120000) }).where(eq(growthJobsTable.id, candidate.id)).returning();
      if (claimed.resourceId) await tx.update(growthResourcesTable).set({ status: 'running' }).where(and(eq(growthResourcesTable.id, claimed.resourceId), eq(growthResourcesTable.kind, 'broadcast'), eq(growthResourcesTable.status, 'queued')));
      return claimed;
    });
    if (!job) return;
    const heartbeat = setInterval(() => { void db.update(growthJobsTable).set({ lockedUntil: new Date(Date.now() + 120000) }).where(and(eq(growthJobsTable.id, job.id), eq(growthJobsTable.status, 'running'))).catch(() => undefined); }, 30000);
    heartbeat.unref();
    try {
      await runJob(job);
      await db.update(growthJobsTable).set({ status: 'completed', completedAt: new Date(), lockedUntil: null, lastError: null }).where(and(eq(growthJobsTable.id, job.id), eq(growthJobsTable.status, 'running')));
    } catch (error) {
      const safeMessage = error instanceof Error && !/https?:|postgres|password|token/i.test(error.message) ? error.message.slice(0, 200) : 'تعذر تنفيذ الإجراء.';
      await db.update(growthJobsTable).set({ status: job.attempts >= 3 || (error instanceof DeliveryError && error.permanent) ? 'failed' : 'queued', lastError: safeMessage, lockedUntil: null, availableAt: new Date(Date.now() + Math.max(job.attempts * 60000, error instanceof DeliveryError ? error.retrySeconds * 1000 : 0)) }).where(eq(growthJobsTable.id, job.id));
    } finally { clearInterval(heartbeat); }
    if (job.resourceId) {
      const runId = job.payload.type === 'PREPARE' ? job.payload.runId : typeof job.payload.event === 'object' && job.payload.event ? (job.payload.event as Record<string, unknown>).runId : undefined;
      const sameRun = typeof runId === 'string' ? sql`coalesce(${growthJobsTable.payload}->>'runId',${growthJobsTable.payload}->'event'->>'runId')=${runId}` : undefined;
      const [remaining] = await db.select({ id: growthJobsTable.id }).from(growthJobsTable).where(and(eq(growthJobsTable.resourceId, job.resourceId), inArray(growthJobsTable.status, ['queued', 'running']), sameRun)).limit(1);
      if (!remaining) {
        const [failed] = await db.select({ id: growthJobsTable.id }).from(growthJobsTable).where(and(eq(growthJobsTable.resourceId, job.resourceId), eq(growthJobsTable.status, 'failed'), sameRun)).limit(1);
        await db.update(growthResourcesTable).set({ status: failed ? 'failed' : 'completed', updatedAt: new Date() }).where(and(eq(growthResourcesTable.id, job.resourceId), eq(growthResourcesTable.kind, 'broadcast'), sql`${growthResourcesTable.status}<>'cancelled'`, typeof runId === 'string' ? sql`(${growthResourcesTable.configuration}->>'runId' is null or ${growthResourcesTable.configuration}->>'runId'=${runId})` : undefined));
      }
    }
  } finally { running = false; }
}
export function startGrowthWorker() {
  if (timer) return;
  timer = setInterval(() => { void processGrowthJobs().catch(error => logger.warn({ errorType: error instanceof Error ? error.name : 'Unknown' }, 'Growth worker failed.')); void scheduleGrowthEvents().catch(error => logger.warn({ errorType: error instanceof Error ? error.name : 'Unknown' }, 'Growth schedule failed.')); }, 1200);
  timer.unref();
}
export function stopGrowthWorker() { if (timer) clearInterval(timer); timer = null; }

let nextScheduleCheck = 0; let scheduleResourceCursor = '';
const scheduleCustomerCursors = new Map<string, { revision: number; cursor: string }>();
export async function scheduleGrowthEvents() {
  if (Date.now() < nextScheduleCheck) return; nextScheduleCheck = Date.now() + 60000;
  // Bounded pages keep overdue schedules recoverable without scanning every tenant at once.
  let resources = await db.select().from(growthResourcesTable).where(and(eq(growthResourcesTable.enabled, true), inArray(growthResourcesTable.kind, ['automation', 'journey']), sql`${growthResourcesTable.configuration}->>'trigger' in ('SCHEDULED_TIME','USER_INACTIVE')`, scheduleResourceCursor ? sql`${growthResourcesTable.id}>${scheduleResourceCursor}` : undefined)).orderBy(growthResourcesTable.id).limit(10);
  if (!resources.length && scheduleResourceCursor) { scheduleResourceCursor = ''; resources = await db.select().from(growthResourcesTable).where(and(eq(growthResourcesTable.enabled, true), inArray(growthResourcesTable.kind, ['automation', 'journey']), sql`${growthResourcesTable.configuration}->>'trigger' in ('SCHEDULED_TIME','USER_INACTIVE')`)).orderBy(growthResourcesTable.id).limit(10); }
  for (const resource of resources) {
    const config = parseGrowthConfiguration(resource.configuration);
    if (!config || !['SCHEDULED_TIME', 'USER_INACTIVE'].includes(config.trigger) || !await featureGate.can(resource.storeId, 'telegram.studio')) continue;
    if (config.trigger === 'SCHEDULED_TIME' && (!config.scheduleAt || Date.parse(config.scheduleAt) > Date.now())) continue;
    const progress = scheduleCustomerCursors.get(resource.id); const cursor = progress?.revision === resource.updatedAt.getTime() ? progress.cursor : '';
    const candidates = await db.select().from(customersTable).where(and(eq(customersTable.storeId, resource.storeId), eq(customersTable.optedIn, true), cursor ? sql`${customersTable.id}>${cursor}` : undefined,
      config.trigger === 'USER_INACTIVE' ? sql`${customersTable.lastSeenAt}<${new Date(Date.now() - config.inactivityDays * 86400000)}` : undefined)).orderBy(customersTable.id).limit(50);
    const values = candidates.map(customer => {
      const eventId = `${resource.id}:${customer.id}:${config.trigger === 'SCHEDULED_TIME' ? config.scheduleAt : customer.lastSeenAt.toISOString()}`;
      return { id: createId(), storeId: resource.storeId, resourceId: resource.id, dedupeKey: `event:${config.trigger}:${eventId}`, payload: { type: 'EVENT', resourceId: resource.id, telegramUserId: customer.telegramUserId, trigger: config.trigger, eventId } };
    });
    if (values.length) await db.insert(growthJobsTable).values(values).onConflictDoNothing({ target: [growthJobsTable.storeId, growthJobsTable.dedupeKey] });
    scheduleCustomerCursors.delete(resource.id); scheduleCustomerCursors.set(resource.id, { revision: resource.updatedAt.getTime(), cursor: candidates.length === 50 ? candidates[49].id : '' });
    while (scheduleCustomerCursors.size > 1000) scheduleCustomerCursors.delete(scheduleCustomerCursors.keys().next().value!);
  }
  if (resources.length) scheduleResourceCursor = resources[resources.length - 1].id;
}
