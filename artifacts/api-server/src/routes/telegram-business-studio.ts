import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { db, storesTable, storeSettingsTable } from '@workspace/db';
import { getOwnedStore, requireAuth, requireCsrf } from '../lib/auth-middleware';
import { featureGate } from '../lib/store-plans';
import { writeAuditEvent } from '../lib/audit';
import { parseBusinessConfiguration, readBusinessStudio, renderBusinessScreen } from '../lib/telegram-business-configuration';

export const businessStudioRouter = Router();
businessStudioRouter.get('/stores/:storeId/telegram/business-studio', requireAuth, async (req, res) => {
  const storeId = req.params.storeId;
  if (typeof storeId !== 'string') { res.status(400).json({ error: 'معرّف المتجر غير صالح.' }); return; }
  const store = await getOwnedStore(storeId, req.auth!.userId);
  if (!store) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  const [row] = await db.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, storeId)).limit(1);
  const studio = readBusinessStudio(row?.settings.telegramBusinessStudio);
  res.json({ ...studio, enabled: await featureGate.can(storeId, 'telegram.studio'), preview: renderBusinessScreen(studio.draft, 'home', { storeName: store.name, customerName: 'اسم العميل', returning: false, now: Date.now() }) });
});
businessStudioRouter.post('/stores/:storeId/telegram/business-studio/:action', requireAuth, requireCsrf, async (req, res) => {
  const { storeId, action } = req.params;
  if (typeof storeId !== 'string' || typeof action !== 'string' || !['draft', 'preview', 'publish'].includes(action)) { res.status(400).json({ error: 'طلب غير صالح.' }); return; }
  const store = await getOwnedStore(storeId, req.auth!.userId);
  if (!store) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  await featureGate.require(storeId, 'telegram.studio');
  const configuration = parseBusinessConfiguration(req.body?.configuration);
  if (action !== 'publish' && !configuration) { res.status(400).json({ error: 'تحقق من الشاشات وأهداف الأزرار. يمنع وجود حلقات أو أهداف محذوفة أو نصوص تتجاوز الحدود.' }); return; }
  if (action === 'preview') {
    const screenId = req.body?.screenId;
    if (typeof screenId !== 'string' || typeof req.body?.returning !== 'boolean') { res.status(400).json({ error: 'سياق المعاينة غير صالح.' }); return; }
    res.json({ preview: renderBusinessScreen(configuration!, screenId, { storeName: store.name, customerName: 'اسم العميل', returning: req.body.returning, now: Date.now() }) }); return;
  }
  const revision = req.body?.revision;
  if (!Number.isSafeInteger(revision) || revision < 0) { res.status(400).json({ error: 'إصدار الإعدادات غير صالح.' }); return; }
  const result = await db.transaction(async tx => {
    await tx.select({ id: storesTable.id }).from(storesTable).where(eq(storesTable.id, storeId)).for('update');
    const [row] = await tx.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, storeId)).limit(1);
    const studio = readBusinessStudio(row?.settings.telegramBusinessStudio);
    if (studio.revision !== revision) return null;
    const next = { draft: action === 'draft' ? configuration! : studio.draft, published: action === 'publish' ? studio.draft : studio.published, revision: revision + 1 };
    const settings = { ...row?.settings, telegramBusinessStudio: next, ...(action === 'publish' ? { telegramHomeMode: 'business' } : {}) };
    await tx.insert(storeSettingsTable).values({ storeId, settings }).onConflictDoUpdate({ target: storeSettingsTable.storeId, set: { settings, updatedAt: new Date() } });
    return next;
  });
  if (!result) { res.status(409).json({ error: 'تم تعديل التصميم من جلسة أخرى. أعد تحميل الصفحة.' }); return; }
  await writeAuditEvent({ userId: req.auth!.userId, storeId, action: `telegram.business.${action}`, summary: action === 'publish' ? 'تم نشر شاشات Business' : 'تم حفظ مسودة شاشات Business', details: { revision: result.revision } });
  res.json({ ...result, enabled: true, preview: renderBusinessScreen(result.draft, 'home', { storeName: store.name, customerName: 'اسم العميل', returning: false, now: Date.now() }) });
});
