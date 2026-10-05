import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { db, customersTable, storesTable, storeSettingsTable } from '@workspace/db';
import { and } from 'drizzle-orm';
import { getOwnedStore, requireAuth, requireCsrf } from '../lib/auth-middleware';
import { featureGate } from '../lib/store-plans';
import { writeAuditEvent } from '../lib/audit';
import { DEFAULT_BUSINESS_CONFIGURATION, parseBusinessConfiguration, readBusinessStudio, renderBusinessScreen } from '../lib/telegram-business-configuration';
import { businessViewerData, validateBusinessReferences } from '../lib/telegram-business-data';
import { previewStoreScreen } from '../lib/telegram-preview';
import { DEFAULT_HOME_CONFIGURATION, readHomeStudio } from '../lib/telegram-home-configuration';
import { canPreviewCustomer } from '../lib/studio-access';
import { getStoreAccess } from '../lib/staff-access';
import { financialSegmentIds } from '../lib/financial-segments';
import { businessRequiresOwner } from '../lib/studio-finance-policy';
import { parseStudioPreviewInput } from '../lib/studio-preview-input';

export const businessStudioRouter = Router();
businessStudioRouter.get('/stores/:storeId/telegram/business-studio', requireAuth, async (req, res) => {
  const storeId = req.params.storeId;
  if (typeof storeId !== 'string') { res.status(400).json({ error: 'معرّف المتجر غير صالح.' }); return; }
  const store = await getOwnedStore(storeId, req.auth!.userId, 'telegram.design');
  if (!store) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  const [row] = await db.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, storeId)).limit(1);
  const studio = readBusinessStudio(row?.settings.telegramBusinessStudio);
  res.json({ ...studio, defaults:DEFAULT_BUSINESS_CONFIGURATION, enabled: await featureGate.can(storeId, 'telegram.studio'), preview: renderBusinessScreen(studio.draft, 'home', await businessViewerData(store, studio.draft, 'home')) });
});
businessStudioRouter.post('/stores/:storeId/telegram/business-studio/:action', requireAuth, requireCsrf, async (req, res) => {
  const { storeId, action } = req.params;
  if (typeof storeId !== 'string' || typeof action !== 'string' || !['draft', 'preview', 'publish'].includes(action)) { res.status(400).json({ error: 'طلب غير صالح.' }); return; }
  const store = await getOwnedStore(storeId, req.auth!.userId, 'telegram.design');
  if (!store) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  await featureGate.require(storeId, 'telegram.studio');
  const configuration = parseBusinessConfiguration(req.body?.configuration);
  if (action !== 'publish' && !configuration) { res.status(400).json({ error: 'تحقق من الشاشات وأهداف الأزرار. يمنع وجود حلقات أو أهداف محذوفة أو نصوص تتجاوز الحدود.' }); return; }
  if (configuration && !await validateBusinessReferences(storeId, configuration)) { res.status(400).json({ error: 'يوجد هدف محذوف أو غير منشور أو ميزة تتجاوز الخطة.' }); return; }
  const access = await getStoreAccess(storeId, req.auth!.userId, 'telegram.design');
  if (!access) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  const financialSegments = access.isOwner ? new Set<string>() : await financialSegmentIds(storeId);
  if (configuration && !access.isOwner && businessRequiresOwner(configuration, financialSegments)) {
    res.status(403).json({ error: 'قواعد بيانات العملاء المالية متاحة لمالك المتجر فقط.' }); return;
  }
  if (action === 'preview') {
    const input = parseStudioPreviewInput(req.body, configuration!);
    if (!input) { res.status(400).json({ error: 'سياق المعاينة غير صالح.' }); return; }
    if(!await canPreviewCustomer(storeId,req.auth!.userId,input.customerId,input.callbackData)){res.status(403).json({error:'معاينة بيانات العميل تتطلب صلاحيات العملاء والطلبات المناسبة.'});return;}
    const screenId = input.screenId!;
    const [customer] = input.customerId ? await db.select().from(customersTable).where(and(eq(customersTable.id, input.customerId), eq(customersTable.storeId, storeId))).limit(1) : [];
    if (input.customerId && !customer) { res.status(400).json({ error: 'عميل المعاينة غير موجود في هذا المتجر.' }); return; }
    const viewerFor=async(id:string)=>businessViewerData(store,configuration!,id,customer,false,{isOwner:access.isOwner,financialSegments,returning:input.returning});
    const viewer = await viewerFor(screenId);
    if (!customer) viewer.returning = input.returning!;
    const callback = input.callbackData;
    if (input.state || (callback && callback !== 'lb:home' && !callback.startsWith('lb:screen:'))) {
      if (!input.state && callback?.startsWith('lb:msg:')) {
        const match = /^lb:msg:([a-z][a-z0-9_-]{0,23}):([a-z][a-z0-9_-]{0,23})$/.exec(callback);
        const screen = configuration!.screens.find(s=>s.id===match?.[1]);
        const button = screen?.buttons.find(b=>b.id===match?.[2]) ?? screen?.blocks.find(b=>b.type==='CUSTOM_BUTTON'&&b.id===match?.[2]);
        if (!button || button.action !== 'SEND_MESSAGE' || !renderBusinessScreen(configuration!, screen!.id, await viewerFor(screen!.id))?.keyboard.flat().some(b=>b.callback_data===callback)) { res.status(400).json({ error: 'الزر غير متاح في المعاينة.' }); return; }
        res.json({preview:{text:String(button.target).replace(/\{\{(?:store|customer)\}\}/g,t=>t==='{{store}}'?store.name:customer?.name??'اسم العميل'),keyboard:[[{text:'رجوع',callback_data:`lb:screen:${screen!.id}`}]],images:[]}}); return;
      }
      const [settings] = await db.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId,storeId)).limit(1);
      const pro = {...(readHomeStudio(settings?.settings.telegramHomeStudio).published ?? DEFAULT_HOME_CONFIGURATION),...(configuration!.theme?{theme:configuration!.theme}:{})};
      const preview = await previewStoreScreen(store,pro,{callback,customerId:customer?.id,search:input.search,state:input.state});
      if (!preview) {res.status(400).json({error:'هذا الإجراء غير متاح في المعاينة.'});return;}
      res.json({preview:{...preview,keyboard:preview.keyboard.map(row=>row.map(b=>b.callback_data==='lb:home'&&b.text.includes('رجوع')?{...b,callback_data:`lb:screen:${screenId}`}:b)),images:'images' in preview?preview.images:'imageUrl' in preview && preview.imageUrl?[preview.imageUrl]:[]}});return;
    }
    res.json({ preview: renderBusinessScreen(configuration!, screenId, viewer), experimentVariant: viewer.experimentVariant ?? null }); return;
  }
  const revision = req.body?.revision;
  if (!Number.isSafeInteger(revision) || revision < 0) { res.status(400).json({ error: 'إصدار الإعدادات غير صالح.' }); return; }
  const result = await db.transaction(async tx => {
    await tx.select({ id: storesTable.id }).from(storesTable).where(eq(storesTable.id, storeId)).for('update');
    const [row] = await tx.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, storeId)).limit(1);
    const studio = readBusinessStudio(row?.settings.telegramBusinessStudio);
    if (studio.revision !== revision) return null;
    if (!access.isOwner && businessRequiresOwner(action === 'publish' ? studio.draft : configuration!, await financialSegmentIds(storeId))) return { denied: true };
    if (action === 'publish' && !await validateBusinessReferences(storeId, studio.draft)) return null;
    const next = { draft: action === 'draft' ? configuration! : studio.draft, published: action === 'publish' ? studio.draft : studio.published, revision: revision + 1 };
    const settings = { ...row?.settings, telegramBusinessStudio: next, ...(action === 'publish' ? { telegramHomeMode: 'business' } : {}) };
    await tx.insert(storeSettingsTable).values({ storeId, settings }).onConflictDoUpdate({ target: storeSettingsTable.storeId, set: { settings, updatedAt: new Date() } });
    return next;
  });
  if (!result) { res.status(409).json({ error: 'تم تعديل التصميم من جلسة أخرى. أعد تحميل الصفحة.' }); return; }
  if ('denied' in result) { res.status(403).json({ error: 'قواعد بيانات العملاء المالية متاحة لمالك المتجر فقط.' }); return; }
  await writeAuditEvent({ userId: req.auth!.userId, storeId, action: `telegram.business.${action}`, summary: action === 'publish' ? 'تم نشر شاشات Business' : 'تم حفظ مسودة شاشات Business', details: { revision: result.revision } });
  res.json({ ...result, enabled: true, preview: renderBusinessScreen(result.draft, 'home', await businessViewerData(store, result.draft, 'home')) });
});
