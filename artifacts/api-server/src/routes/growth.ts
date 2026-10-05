import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import { db, categoriesTable, customersTable, growthResourcesTable, growthJobsTable, productsTable, storesTable, storeSettingsTable, couponsTable } from '@workspace/db';
import { requireAuth, requireCsrf } from '../lib/auth-middleware';
import { getStoreAccess } from '../lib/staff-access';
import type { StaffPermission } from '../lib/staff-policy';
import { featureGate } from '../lib/store-plans';
import { createId } from '../lib/security';
import { actionMatches, audienceMatches, GROWTH_TEMPLATES, parseGrowthConfiguration, record, renderGrowthText, uuid, type GrowthConfiguration } from '../lib/growth-configuration';
import { couponDiscount } from '../lib/commerce-validation';
import { commerceAvailability } from '../lib/customer-commerce';
import { customerFacts, enqueueGrowthEvent } from '../lib/growth-service';
import { evaluateRule } from '../lib/customer-rules';
import { writeAuditEvent } from '../lib/audit';
import { growthRequiresOwner, publicCustomerFacts } from '../lib/growth-finance-policy';
import { financialSegmentIds } from '../lib/financial-segments';
export const growthRouter = Router();
growthRouter.use('/stores/:storeId/growth', requireAuth, async (req, res, next) => {
  const storeId = req.params.storeId;
  if (typeof storeId !== 'string' || !await getStoreAccess(storeId, req.auth!.userId, 'member')) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  next();
});
const resourcePermission = (kind: string): StaffPermission => kind === 'broadcast' ? 'marketing.manage' : kind === 'segment' ? 'customers.manage' : 'automation.manage';
async function allowed(req: Request, res: Response, permission: StaffPermission) {
  if (await getStoreAccess(String(req.params.storeId), req.auth!.userId, permission)) return true;
  res.status(403).json({ error: 'حسابك لا يملك صلاحية هذه العملية في المتجر.' }); return false;
}
async function accessibleResourceKinds(req: Request) {
  const kinds = [];
  for (const kind of ['segment', 'broadcast', 'automation', 'journey']) if (await getStoreAccess(String(req.params.storeId), req.auth!.userId, resourcePermission(kind))) kinds.push(kind);
  return kinds;
}
async function configurationAllowed(req: Request, res: Response, configuration: GrowthConfiguration) {
  const storeId = String(req.params.storeId);
  if (await getStoreAccess(storeId, req.auth!.userId, 'owner') || !growthRequiresOwner(configuration, await financialSegmentIds(storeId))) return true;
  res.status(403).json({ error: 'القواعد والجمهور المرتبطان بقيم مالية متاحان لمالك المتجر فقط.' }); return false;
}
async function visibleResources(req: Request, rows: typeof growthResourcesTable.$inferSelect[]) {
  if (await getStoreAccess(String(req.params.storeId), req.auth!.userId, 'owner')) return rows;
  const financialSegments = await financialSegmentIds(String(req.params.storeId));
  return rows.filter(row => { const configuration = parseGrowthConfiguration(row.configuration); return configuration && !growthRequiresOwner(configuration, financialSegments); });
}
function visibleCustomer(customer: typeof customersTable.$inferSelect, isOwner: boolean, financialSegments: ReadonlySet<string>) {
  if (isOwner) return customer;
  return { ...customer, segments: customer.segments.filter(id => !financialSegments.has(id)), state: { ...customer.state, ...(Array.isArray(customer.state.segmentExclusions) ? { segmentExclusions: customer.state.segmentExclusions.filter(id => typeof id === 'string' && !financialSegments.has(id)) } : {}) } };
}
growthRouter.get('/stores/:storeId/growth', async (req, res) => {
  const storeId = String(req.params.storeId);
  const kinds = await accessibleResourceKinds(req); const automationAccess = kinds.includes('automation');
  const resources = kinds.length ? await visibleResources(req, await db.select().from(growthResourcesTable).where(and(eq(growthResourcesTable.storeId, storeId), inArray(growthResourcesTable.kind, kinds))).orderBy(desc(growthResourcesTable.createdAt))) : [];
  const counts = await db.select({ resourceId: growthJobsTable.resourceId, status: growthJobsTable.status, value: count() }).from(growthJobsTable).innerJoin(growthResourcesTable, eq(growthResourcesTable.id, growthJobsTable.resourceId))
    .where(and(eq(growthJobsTable.storeId, storeId), sql`${growthJobsTable.payload}->>'type'='ACTION' and (${growthResourcesTable.kind}<>'broadcast' or ${growthResourcesTable.configuration}->>'runId' is null or ${growthJobsTable.payload}->'event'->>'runId'=${growthResourcesTable.configuration}->>'runId')`)).groupBy(growthJobsTable.resourceId, growthJobsTable.status);
  const [settings] = await db.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, storeId)).limit(1);
  res.json({ resources: resources.map(r => ({ ...r, counts: Object.fromEntries(counts.filter(c => c.resourceId === r.id).map(c => [c.status, Number(c.value)])) })),
    broadcastEnabled: await featureGate.can(storeId, 'telegram.advanced'), businessEnabled: await featureGate.can(storeId, 'telegram.studio'),
    couponEnabled: (await commerceAvailability(storeId)).coupons, pointsEnabled: await featureGate.can(storeId, 'loyalty.basic'), templates: GROWTH_TEMPLATES,
    permissions: { customers: !!await getStoreAccess(storeId, req.auth!.userId, 'customers.read'), segments: kinds.includes('segment'), marketing: kinds.includes('broadcast'), automation: automationAccess },
    preferences: { adminTelegramChatId: automationAccess && typeof settings?.settings.adminTelegramChatId === 'string' ? settings.settings.adminTelegramChatId : '' } });
});
growthRouter.get('/stores/:storeId/growth/options/:kind', async (req, res) => {
  const storeId = String(req.params.storeId); const kind = String(req.params.kind); const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''; const page = Number(req.query.page ?? 1); const selected = typeof req.query.selected === 'string' ? req.query.selected : '';
  if (!['products', 'categories', 'coupons', 'customers', 'segments'].includes(kind) || q.length > 100 || !Number.isInteger(page) || page < 1 || page > 100000) { res.status(400).json({ error: 'طلب قائمة غير صالح.' }); return; }
  if (selected && !uuid(selected)) { res.status(400).json({ error: 'الهدف غير صالح.' }); return; }
  if (kind === 'customers') { if (!await allowed(req, res, 'customers.read')) return; }
  else if (!(await accessibleResourceKinds(req)).length) { res.status(403).json({ error: 'لا توجد صلاحية لإعداد موارد التسويق.' }); return; }
  const search = `%${q.replace(/[\\%_]/g, value => `\\${value}`)}%`;
  const rows = kind === 'products' ? await db.select({ value: productsTable.id, label: productsTable.name }).from(productsTable).where(and(eq(productsTable.storeId, storeId), eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true), sql`${productsTable.name} ilike ${search}`)).orderBy(productsTable.name, productsTable.id).limit(51).offset((page - 1) * 50)
    : kind === 'categories' ? await db.select({ value: categoriesTable.id, label: categoriesTable.name }).from(categoriesTable).where(and(eq(categoriesTable.storeId, storeId), eq(categoriesTable.isDeleted, false), sql`${categoriesTable.name} ilike ${search}`)).orderBy(categoriesTable.name, categoriesTable.id).limit(51).offset((page - 1) * 50)
    : kind === 'coupons' ? (await db.select().from(couponsTable).where(and(eq(couponsTable.storeId, storeId), eq(couponsTable.enabled, true), sql`${couponsTable.uses}<${couponsTable.maxUses} and (${couponsTable.expiresAt} is null or ${couponsTable.expiresAt}>now())`, sql`${couponsTable.code} ilike ${search}`)).orderBy(couponsTable.code, couponsTable.id).limit(51).offset((page - 1) * 50)).map(c => ({ value: c.id, label: `${c.code} · ${c.percent}%` }))
    : kind === 'customers' ? await db.select({ value: customersTable.id, label: customersTable.name }).from(customersTable).where(and(eq(customersTable.storeId, storeId), eq(customersTable.optedIn, true), sql`${customersTable.name} ilike ${search}`)).orderBy(customersTable.name, customersTable.id).limit(51).offset((page - 1) * 50)
    : await db.select({ value: growthResourcesTable.id, label: growthResourcesTable.name }).from(growthResourcesTable).where(and(eq(growthResourcesTable.storeId, storeId), eq(growthResourcesTable.kind, 'segment'), eq(growthResourcesTable.enabled, true), sql`${growthResourcesTable.name} ilike ${search}`)).orderBy(growthResourcesTable.name, growthResourcesTable.id).limit(51).offset((page - 1) * 50);
  const [selectedOption] = !selected ? [] : kind === 'products' ? await db.select({ value: productsTable.id, label: productsTable.name }).from(productsTable).where(and(eq(productsTable.id, selected), eq(productsTable.storeId, storeId), eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true))).limit(1)
    : kind === 'categories' ? await db.select({ value: categoriesTable.id, label: categoriesTable.name }).from(categoriesTable).where(and(eq(categoriesTable.id, selected), eq(categoriesTable.storeId, storeId), eq(categoriesTable.isDeleted, false))).limit(1)
    : kind === 'coupons' ? (await db.select().from(couponsTable).where(and(eq(couponsTable.id, selected), eq(couponsTable.storeId, storeId))).limit(1)).filter(c => couponDiscount(Math.round(Number(c.minimum) * 100), c) !== null).map(c => ({ value: c.id, label: `${c.code} · ${c.percent}%` }))
    : kind === 'customers' ? await db.select({ value: customersTable.id, label: customersTable.name }).from(customersTable).where(and(eq(customersTable.id, selected), eq(customersTable.storeId, storeId), eq(customersTable.optedIn, true))).limit(1)
    : await db.select({ value: growthResourcesTable.id, label: growthResourcesTable.name }).from(growthResourcesTable).where(and(eq(growthResourcesTable.id, selected), eq(growthResourcesTable.storeId, storeId), eq(growthResourcesTable.kind, 'segment'), eq(growthResourcesTable.enabled, true))).limit(1);
  res.json({ options: rows.slice(0, 50), hasMore: rows.length > 50, selectedOption: selectedOption ?? null });
});
async function validateReferences(storeId: string, config: GrowthConfiguration) {
  const references = config.actions.flatMap(action => [action, ...(action.buttons ?? []).filter(b => ['OPEN_PRODUCT', 'OPEN_CATEGORY'].includes(b.type)).map(b => ({ type: b.type === 'OPEN_PRODUCT' ? 'SEND_PRODUCT' : 'SEND_CATEGORY', target: b.target }))]);
  for (const action of references) {
    if (action.type === 'SEND_PRODUCT') {
      const [row] = await db.select({ id: productsTable.id }).from(productsTable).where(and(eq(productsTable.id, action.target), eq(productsTable.storeId, storeId), eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true))).limit(1);
      if (!row) return false;
    } else if (action.type === 'SEND_CATEGORY') {
      const [row] = await db.select({ id: categoriesTable.id }).from(categoriesTable).where(and(eq(categoriesTable.id, action.target), eq(categoriesTable.storeId, storeId), eq(categoriesTable.isDeleted, false))).limit(1);
      if (!row) return false;
    } else if (['ADD_SEGMENT', 'REMOVE_SEGMENT'].includes(action.type)) {
      const [row] = await db.select({ id: growthResourcesTable.id }).from(growthResourcesTable).where(and(eq(growthResourcesTable.id, action.target), eq(growthResourcesTable.storeId, storeId), eq(growthResourcesTable.kind, 'segment'))).limit(1);
      if (!row) return false;
    } else if (['ADD_POINTS', 'REMOVE_POINTS'].includes(action.type) && !await featureGate.can(storeId, 'loyalty.basic')) {
      return false;
    } else if (action.type === 'SEND_COUPON') {
      if (!(await commerceAvailability(storeId)).coupons) return false;
      const [coupon] = await db.select().from(couponsTable).where(and(eq(couponsTable.id, action.target), eq(couponsTable.storeId, storeId))).limit(1);
      if (!coupon || couponDiscount(Math.round(Number(coupon.minimum) * 100), coupon) === null) return false;
    }
  }
  if (config.audience?.type === 'selected') { const rows = await db.select({ id: customersTable.id }).from(customersTable).where(and(eq(customersTable.storeId, storeId), inArray(customersTable.id, config.audience.customerIds))); if (rows.length !== config.audience.customerIds.length) return false; }
  if (config.audience?.type === 'segment') { const [row] = await db.select({ id: growthResourcesTable.id }).from(growthResourcesTable).where(and(eq(growthResourcesTable.storeId, storeId), eq(growthResourcesTable.id, config.audience.segmentId), eq(growthResourcesTable.kind, 'segment'), eq(growthResourcesTable.enabled, true))).limit(1); if (!row) return false; }
  const rules = [config.condition, ...config.actions.map(a => a.condition)].filter(Boolean);
  while (rules.length) {
    const rule = rules.pop()!;
    if ('op' in rule) { rules.push(...rule.rules); continue; }
    const values = (Array.isArray(rule.value) ? rule.value : [rule.value]).filter((v): v is string => typeof v === 'string');
    if (!['PRODUCT', 'CATEGORY', 'CUSTOMER_SEGMENT', 'CAMPAIGN'].includes(rule.field)) continue;
    if (!values.length || !values.every(uuid)) return false;
    const rows = rule.field === 'PRODUCT' ? await db.select({ id: productsTable.id }).from(productsTable).where(and(eq(productsTable.storeId, storeId), inArray(productsTable.id, values), eq(productsTable.isDeleted, false)))
      : rule.field === 'CATEGORY' ? await db.select({ id: categoriesTable.id }).from(categoriesTable).where(and(eq(categoriesTable.storeId, storeId), inArray(categoriesTable.id, values), eq(categoriesTable.isDeleted, false)))
      : await db.select({ id: growthResourcesTable.id }).from(growthResourcesTable).where(and(eq(growthResourcesTable.storeId, storeId), inArray(growthResourcesTable.id, values), eq(growthResourcesTable.kind, rule.field === 'CAMPAIGN' ? 'broadcast' : 'segment')));
    if (rows.length !== new Set(values).size) return false;
  }
  return true;
}
growthRouter.post('/stores/:storeId/growth/resources', requireCsrf, async (req, res) => {
  const storeId = String(req.params.storeId); const body = req.body;
  const config = parseGrowthConfiguration(body?.configuration);
  if (!config || typeof body?.name !== 'string' || !body.name.trim() || body.name.length > 100 || typeof body.enabled !== 'boolean') { res.status(400).json({ error: 'تحقق من الاسم والقواعد والإجراءات.' }); return; }
  if (!await allowed(req, res, resourcePermission(config.kind))) return;
  if (!await configurationAllowed(req, res, config)) return;
  await featureGate.require(storeId, config.kind === 'broadcast' ? 'telegram.advanced' : 'telegram.studio');
  if (!await validateReferences(storeId, config)) { res.status(400).json({ error: 'تحقق من المنتجات والتصنيفات والكوبونات والعملاء والشرائح المستهدفة وتفعيل الميزات المطلوبة.' }); return; }
  const id = typeof body.id === 'string' ? body.id : createId();
  const saved = await db.transaction(async tx => {
    await tx.select({ id: storesTable.id }).from(storesTable).where(eq(storesTable.id, storeId)).for('update');
    const [old] = await tx.select().from(growthResourcesTable).where(and(eq(growthResourcesTable.id, id), eq(growthResourcesTable.storeId, storeId))).limit(1);
    if (body.id && (!old || old.kind !== config.kind)) return null;
    if (old) { const oldConfiguration = parseGrowthConfiguration(old.configuration); if (!oldConfiguration || !await configurationAllowed(req, res, oldConfiguration)) return null; }
    if (old && ['queued', 'running'].includes(old.status)) return null;
    const [total] = await tx.select({ value: count() }).from(growthResourcesTable).where(eq(growthResourcesTable.storeId, storeId));
    if (!old && Number(total?.value) >= 100) return null;
    const values = { name: body.name.trim(), configuration: config as unknown as Record<string, unknown>, enabled: config.kind !== 'broadcast' && body.enabled, status: 'draft', updatedAt: new Date() };
    if (old) {
      await tx.update(growthJobsTable).set({ status: 'cancelled', lockedUntil: null, lastError: 'أوقف التنفيذ المؤجل بعد تحديث الإعدادات.' }).where(and(eq(growthJobsTable.resourceId, id), eq(growthJobsTable.status, 'queued')));
      const [row] = await tx.update(growthResourcesTable).set(values).where(and(eq(growthResourcesTable.id, id), eq(growthResourcesTable.storeId, storeId))).returning(); return row;
    }
    const [row] = await tx.insert(growthResourcesTable).values({ id, storeId, kind: config.kind, ...values }).returning(); return row;
  });
  if (!saved) { if (!res.headersSent) res.status(409).json({ error: 'المورد قيد التنفيذ أو غير موجود، أو بلغ المتجر حد 100 مورد.' }); return; }
  await writeAuditEvent({ userId: req.auth!.userId, storeId, action: `growth.${config.kind}.saved`, summary: 'تم حفظ إعدادات التسويق والأتمتة', details: { resourceId: id } });
  res.json(saved);
});
growthRouter.post('/stores/:storeId/growth/resources/:id/:action', requireCsrf, async (req, res) => {
  const storeId = String(req.params.storeId); const id = String(req.params.id); const action = String(req.params.action);
  if (!['queue', 'cancel', 'delete'].includes(action)) { res.status(400).json({ error: 'إجراء غير صالح.' }); return; }
  const [resource] = await db.select().from(growthResourcesTable).where(and(eq(growthResourcesTable.id, id), eq(growthResourcesTable.storeId, storeId))).limit(1);
  if (!resource) { res.status(404).json({ error: 'المورد غير موجود.' }); return; }
  if (!await allowed(req, res, resourcePermission(resource.kind))) return;
  const currentConfiguration = parseGrowthConfiguration(resource.configuration);
  if (!currentConfiguration) { res.status(400).json({ error: 'إعدادات المورد لم تعد صالحة. راجعها قبل التنفيذ.' }); return; }
  if (!await configurationAllowed(req, res, currentConfiguration)) return;
  await featureGate.require(storeId, resource.kind === 'broadcast' ? 'telegram.advanced' : 'telegram.studio');
  if (action === 'queue') { const config = parseGrowthConfiguration(resource.configuration); if (!config || !await validateReferences(storeId, config)) { res.status(400).json({ error: 'تغيّر أحد أهداف الحملة أو توقف. راجع الإعدادات قبل الإرسال.' }); return; } }
  const result = await db.transaction(async tx => {
    const [locked] = await tx.select().from(growthResourcesTable).where(and(eq(growthResourcesTable.id, id), eq(growthResourcesTable.storeId, storeId))).for('update');
    if (!locked) return false;
    if (action === 'queue') {
      const config = parseGrowthConfiguration(locked.configuration);
      if (locked.kind !== 'broadcast' || !config || ['queued', 'running'].includes(locked.status)) return false;
      if (!await configurationAllowed(req, res, config)) return false;
      const runId = createId();
      await tx.update(growthResourcesTable).set({ status: 'queued', configuration: { ...locked.configuration, runId }, updatedAt: new Date() }).where(eq(growthResourcesTable.id, id));
      await tx.insert(growthJobsTable).values({ id: createId(), storeId, resourceId: id, dedupeKey: `prepare:${id}:${runId}`, availableAt: config.scheduleAt ? new Date(config.scheduleAt) : new Date(), payload: { type: 'PREPARE', runId } });
    } else {
      await tx.update(growthJobsTable).set({ status: 'cancelled', lockedUntil: null }).where(and(eq(growthJobsTable.resourceId, id), eq(growthJobsTable.status, 'queued')));
      await tx.update(growthResourcesTable).set({ status: 'cancelled', enabled: false, updatedAt: new Date() }).where(eq(growthResourcesTable.id, id));
      if (action === 'delete' && !['queued', 'running'].includes(locked.status)) await tx.delete(growthResourcesTable).where(eq(growthResourcesTable.id, id));
    }
    return true;
  });
  if (!result) { if (!res.headersSent) res.status(409).json({ error: 'لا يمكن تنفيذ الإجراء في الحالة الحالية.' }); return; }
  await writeAuditEvent({ userId: req.auth!.userId, storeId, action: `growth.${action}`, summary: 'تم تحديث حالة مورد التسويق', details: { resourceId: id } });
  res.json({ ok: true });
});
growthRouter.get('/stores/:storeId/growth/jobs', async (req, res) => {
  const storeId = String(req.params.storeId); const page = Number(req.query.page ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 100000) { res.status(400).json({ error: 'الصفحة غير صالحة.' }); return; }
  const kinds = await accessibleResourceKinds(req);
  if (!kinds.length) { res.status(403).json({ error: 'لا توجد صلاحية لعرض سجل التنفيذ.' }); return; }
  const resources = await visibleResources(req, await db.select().from(growthResourcesTable).where(and(eq(growthResourcesTable.storeId, storeId), inArray(growthResourcesTable.kind, kinds))));
  if (!resources.length) { res.json([]); return; }
  res.json(await db.select({ id: growthJobsTable.id, resourceId: growthJobsTable.resourceId, customerId: growthJobsTable.customerId, status: growthJobsTable.status, attempts: growthJobsTable.attempts,
    lastError: growthJobsTable.lastError, availableAt: growthJobsTable.availableAt, completedAt: growthJobsTable.completedAt, createdAt: growthJobsTable.createdAt }).from(growthJobsTable)
    .where(and(eq(growthJobsTable.storeId, storeId), inArray(growthJobsTable.resourceId, resources.map(r => r.id)))).orderBy(desc(growthJobsTable.createdAt)).limit(50).offset((page - 1) * 50));
});
growthRouter.get('/stores/:storeId/growth/customers', async (req, res) => {
  if (!await allowed(req, res, 'customers.read')) return;
  const storeId = String(req.params.storeId); const page = Number(req.query.page ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 100000) { res.status(400).json({ error: 'الصفحة غير صالحة.' }); return; }
  const rows = await db.select().from(customersTable).where(eq(customersTable.storeId, storeId)).orderBy(desc(customersTable.lastSeenAt)).limit(50).offset((page - 1) * 50);
  const isOwner = !!await getStoreAccess(storeId, req.auth!.userId, 'owner');
  const financialSegments = isOwner ? new Set<string>() : await financialSegmentIds(storeId);
  res.json(await Promise.all(rows.map(async customer => ({ ...visibleCustomer(customer, isOwner, financialSegments),
    facts: publicCustomerFacts(await customerFacts(customer), isOwner, financialSegments) }))));
});
growthRouter.get('/stores/:storeId/growth/customer-labels', async (req, res) => {
  if (!await allowed(req, res, 'customers.read')) return;
  const ids = typeof req.query.ids === 'string' ? req.query.ids.split(',') : [];
  if (!ids.length || ids.length > 50 || !ids.every(uuid)) { res.status(400).json({ error: 'قائمة العملاء غير صالحة.' }); return; }
  res.json(await db.select({ id: customersTable.id, name: customersTable.name, optedIn: customersTable.optedIn }).from(customersTable).where(and(eq(customersTable.storeId, String(req.params.storeId)), inArray(customersTable.id, ids))));
});
growthRouter.patch('/stores/:storeId/growth/customers/:id', requireCsrf, async (req, res) => {
  if (!await allowed(req, res, 'customers.manage')) return;
  const storeId = String(req.params.storeId); const id = String(req.params.id); const body = req.body;
  await featureGate.require(storeId, 'telegram.studio');
  if (!record(body) || !Array.isArray(body.tags) || body.tags.length > 50 || !body.tags.every(v => typeof v === 'string' && v.trim() && v.length <= 40) ||
    !Number.isInteger(body.vipLevel) || Number(body.vipLevel) < 0 || Number(body.vipLevel) > 100 || typeof body.optedIn !== 'boolean') { res.status(400).json({ error: 'خصائص العميل غير صالحة.' }); return; }
  const tags = [...new Set(body.tags.map(v => String(v).trim()))]; const vipLevel = Number(body.vipLevel); const optedIn = body.optedIn;
  const saved = await db.transaction(async tx => {
    const [old] = await tx.select().from(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.storeId, storeId))).for('update');
    if (!old) return undefined;
    const [next] = await tx.update(customersTable).set({ tags, vipLevel, optedIn: old.optedIn && optedIn }).where(eq(customersTable.id, id)).returning();
    if (old.vipLevel !== next.vipLevel) await enqueueGrowthEvent(tx, { storeId, telegramUserId: next.telegramUserId, trigger: 'VIP_LEVEL_CHANGED', eventId: createId() });
    return next;
  });
  if (!saved) { res.status(404).json({ error: 'العميل غير موجود.' }); return; }
  await writeAuditEvent({ userId: req.auth!.userId, storeId, action: 'customer.updated', summary: 'تم تحديث خصائص العميل', details: { customerId: id } });
  const isOwner = !!await getStoreAccess(storeId, req.auth!.userId, 'owner');
  res.json(visibleCustomer(saved, isOwner, isOwner ? new Set<string>() : await financialSegmentIds(storeId)));
});
growthRouter.post('/stores/:storeId/growth/preview', requireCsrf, async (req, res) => {
  const storeId = String(req.params.storeId); const config = parseGrowthConfiguration(req.body?.configuration);
  if (!config || typeof req.body?.customerId !== 'string') { res.status(400).json({ error: 'إعدادات المعاينة غير صالحة.' }); return; }
  if (!await allowed(req, res, resourcePermission(config.kind)) || !await allowed(req, res, 'customers.read')) return;
  if (!await configurationAllowed(req, res, config)) return;
  await featureGate.require(storeId, config.kind === 'broadcast' ? 'telegram.advanced' : 'telegram.studio');
  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, req.body.customerId), eq(customersTable.storeId, storeId))).limit(1);
  if (!customer) { res.status(404).json({ error: 'اختر عميلًا حقيقيًا من المتجر للمعاينة.' }); return; }
  const [store] = await db.select({ name: storesTable.name }).from(storesTable).where(eq(storesTable.id, storeId)).limit(1);
  const facts = await customerFacts(customer); const isOwner = !!await getStoreAccess(storeId, req.auth!.userId, 'owner');
  res.json({ customerName: customer.name, eligible: customer.optedIn && audienceMatches(config.audience, customer, facts) && evaluateRule(config.condition, facts), actions: config.actions.map(a => ({ ...a, eligible: actionMatches(a, facts), text: renderGrowthText(a.text, store?.name ?? '', customer.name) })), facts: publicCustomerFacts(facts, isOwner, isOwner ? new Set<string>() : await financialSegmentIds(storeId)) });
});
growthRouter.patch('/stores/:storeId/growth/preferences', requireCsrf, async (req, res) => {
  if (!await allowed(req, res, 'automation.manage')) return;
  const storeId = String(req.params.storeId); const chatId = req.body?.adminTelegramChatId;
  await featureGate.require(storeId, 'telegram.studio');
  if (typeof chatId !== 'string' || (chatId !== '' && !/^-?\d{1,20}$/.test(chatId))) { res.status(400).json({ error: 'معرّف محادثة المسؤول غير صالح.' }); return; }
  await db.transaction(async tx => {
    await tx.select({ id: storesTable.id }).from(storesTable).where(eq(storesTable.id, storeId)).for('update');
    const [old] = await tx.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, storeId)).limit(1);
    const settings = { ...old?.settings, adminTelegramChatId: chatId };
    await tx.insert(storeSettingsTable).values({ storeId, settings }).onConflictDoUpdate({ target: storeSettingsTable.storeId, set: { settings } });
  }); await writeAuditEvent({ userId: req.auth!.userId, storeId, action: 'growth.preferences', summary: 'تم تحديث محادثة إشعارات المسؤول' }); res.json({ ok: true });
});
