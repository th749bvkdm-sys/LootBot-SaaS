import { Router } from 'express';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db, storesTable, storeSettingsTable, categoriesTable, productsTable, productImagesTable, telegramBotsTable } from '@workspace/db';
import { getOwnedStore, requireAuth, requireCsrf } from '../lib/auth-middleware';
import { mergeStorefrontSettings, readStorefrontSettings, safeStorefrontImage, STOREFRONT_THEMES } from '../lib/storefront-configuration';

export const storefrontRouter = Router();
// Theme changes and disabling the public catalog must take effect on refresh.
storefrontRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const body = z.object({ theme: z.enum(STOREFRONT_THEMES), enabled: z.boolean() }).strict();
const paging = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), category: z.string().max(100).optional() });

async function catalog(store: typeof storesTable.$inferSelect, settings: Record<string, unknown>, page = 1, category?: string, productId?: string) {
  const categories = await db.select({ id: categoriesTable.id, name: categoriesTable.name, description: categoriesTable.description, imageUrl: categoriesTable.imageUrl, emoji: categoriesTable.emoji }).from(categoriesTable).where(and(eq(categoriesTable.storeId, store.id), eq(categoriesTable.isDeleted, false))).orderBy(asc(categoriesTable.name)).limit(500);
  const products = await db.select({ id: productsTable.id, categoryId: productsTable.categoryId, name: productsTable.name, description: productsTable.description, price: productsTable.price, oldPrice: productsTable.oldPrice, imageUrl: productsTable.imageUrl, warranty: productsTable.warranty, featured: productsTable.featured, tags: productsTable.tags, stock: productsTable.stock }).from(productsTable).where(and(eq(productsTable.storeId, store.id), eq(productsTable.isPublished, true), eq(productsTable.isDeleted, false), category ? eq(productsTable.categoryId, category) : undefined, productId ? eq(productsTable.id, productId) : undefined)).orderBy(desc(productsTable.featured), asc(productsTable.name)).limit(productId ? 1 : 25).offset(productId ? 0 : (page - 1) * 24);
  const visible = products.slice(0, 24);
  const images = visible.length ? await db.select({ productId: productImagesTable.productId, url: productImagesTable.imageUrl, alt: productImagesTable.altText }).from(productImagesTable).where(inArray(productImagesTable.productId, visible.map(product => product.id))).orderBy(asc(productImagesTable.sortOrder)) : [];
  const [bot] = await db.select({ username: telegramBotsTable.username, status: telegramBotsTable.status }).from(telegramBotsTable).where(eq(telegramBotsTable.storeId, store.id)).limit(1);
  return { store: { id: store.id, name: store.name, slug: store.slug, currency: store.currency, ...readStorefrontSettings(settings), botUrl: bot?.status === 'connected' && bot.username && /^[a-zA-Z0-9_]{5,32}$/.test(bot.username) ? `https://t.me/${bot.username}` : null }, categories: categories.map(category => ({ ...category, imageUrl: safeStorefrontImage(category.imageUrl) })), products: visible.map(({ stock, ...product }) => ({ ...product, available: stock > 0, imageUrl: safeStorefrontImage(product.imageUrl), images: images.filter(image => image.productId === product.id && safeStorefrontImage(image.url)).map(image => ({ url: safeStorefrontImage(image.url)!, alt: image.alt })) })), page, hasMore: products.length > 24 };
}

storefrontRouter.get('/stores/:storeId/storefront', requireAuth, async (req, res) => {
  if (!await getOwnedStore(String(req.params.storeId), req.auth!.userId)) { res.status(404).json({ error: 'لم يتم العثور على المتجر.' }); return; }
  const [row] = await db.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, String(req.params.storeId))).limit(1);
  res.json(readStorefrontSettings(row?.settings));
});
storefrontRouter.patch('/stores/:storeId/storefront', requireAuth, requireCsrf, async (req, res) => {
  const parsed = body.safeParse(req.body), storeId = String(req.params.storeId);
  if (!parsed.success) { res.status(400).json({ error: 'اختر مظهرًا صالحًا وحالة عرض واضحة.' }); return; }
  if (!await getOwnedStore(storeId, req.auth!.userId)) { res.status(404).json({ error: 'لم يتم العثور على المتجر.' }); return; }
  await db.transaction(async tx => {
    // Serialize with existing settings editors and preserve every unrelated configuration.
    await tx.select({ id: storesTable.id }).from(storesTable).where(eq(storesTable.id, storeId)).for('update');
    const [row] = await tx.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, storeId)).for('update').limit(1);
    const settings = mergeStorefrontSettings(row?.settings ?? {}, parsed.data);
    await tx.insert(storeSettingsTable).values({ storeId, settings }).onConflictDoUpdate({ target: storeSettingsTable.storeId, set: { settings, updatedAt: new Date() } });
  });
  res.json(parsed.data);
});
storefrontRouter.get('/stores/:storeId/storefront/preview', requireAuth, async (req, res) => {
  const id = String(req.params.storeId);
  if (!await getOwnedStore(id, req.auth!.userId)) { res.status(404).json({ error: 'لم يتم العثور على المتجر.' }); return; }
  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, id));
  const [row] = await db.select().from(storeSettingsTable).where(eq(storeSettingsTable.storeId, id));
  res.json(await catalog(store, row?.settings ?? {}));
});
storefrontRouter.get(['/storefront/:slug', '/storefront/:slug/products/:productId'], async (req, res) => {
  const query = paging.safeParse(req.query), slug = String(req.params.slug);
  if (!query.success || !/^[a-z0-9-]{1,100}$/.test(slug)) { res.status(400).json({ error: 'رابط المتجر أو رقم الصفحة غير صالح.' }); return; }
  const [row] = await db.select({ store: storesTable, settings: storeSettingsTable.settings }).from(storesTable).leftJoin(storeSettingsTable, eq(storeSettingsTable.storeId, storesTable.id)).where(and(eq(storesTable.slug, slug), eq(storesTable.isDeleted, false))).limit(1);
  if (!row || !readStorefrontSettings(row.settings).enabled) { res.status(404).json({ error: 'واجهة المتجر غير متاحة حاليًا.' }); return; }
  const result = await catalog(row.store, row.settings ?? {}, query.data.page, query.data.category, req.params.productId ? String(req.params.productId) : undefined);
  if (req.params.productId && !result.products.length) { res.status(404).json({ error: 'المنتج غير متاح.' }); return; }
  res.json(result);
});
