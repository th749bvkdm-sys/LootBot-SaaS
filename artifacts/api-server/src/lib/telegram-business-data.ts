import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, categoriesTable, customersTable, productImagesTable, productsTable } from '@workspace/db';
import { createHash } from 'node:crypto';
import { commerceAvailability, productReviewSummary } from './customer-commerce';
import { customerFacts } from './growth-service';
import { evaluateRule } from './customer-rules';
import { safeUrl, visibleBusinessScreen, type BusinessConfiguration, type BusinessViewer } from './telegram-business-configuration';
import { featureGate, getPlanCatalog, getStorePlan } from './store-plans';
import { isFeatureAvailable } from './plans';
import { publicCustomerFacts } from './growth-finance-policy';
import { businessProductCard } from './telegram-business-product-card';
import { themeDefaults } from './telegram-presentation';

export async function validateBusinessReferences(storeId: string, configuration: BusinessConfiguration, reader: Pick<typeof db, 'select'> = db) {
  if (configuration.hideBranding) {
    const [plan, catalog] = await Promise.all([getStorePlan(storeId, reader), getPlanCatalog(reader)]);
    if (!isFeatureAvailable(plan, 'branding.removeLootBot', catalog)) return false;
  }
  const products = new Set<string>(); const categories = new Set<string>();
  for (const screen of configuration.screens) {
    for (const button of [...screen.buttons, ...screen.blocks.filter(b => b.type === 'CUSTOM_BUTTON').map(b => ({ action: b.action, target: b.target }))]) {
      if (button.action === 'OPEN_PRODUCT') products.add(button.target!);
      if (button.action === 'OPEN_CATEGORY') categories.add(button.target!);
    }
    for (const block of screen.blocks) if (block.type === 'PRODUCT') products.add(block.target!);
  }
  const [productRows, categoryRows] = await Promise.all([
    products.size ? reader.select({ id: productsTable.id }).from(productsTable).where(and(eq(productsTable.storeId, storeId), eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true), inArray(productsTable.id, [...products]))) : [],
    categories.size ? reader.select({ id: categoriesTable.id }).from(categoriesTable).where(and(eq(categoriesTable.storeId, storeId), eq(categoriesTable.isDeleted, false), inArray(categoriesTable.id, [...categories]))) : [],
  ]);
  return products.size === productRows.length && categories.size === categoryRows.length;
}
export function experimentVariant(config: BusinessConfiguration, storeId: string, customerId: string): 'A'|'B'|undefined {
  if (!config.experiment?.enabled || !customerId) return undefined;
  const bucket = createHash('sha256').update(`${storeId}:${config.experiment.id}:${customerId}`).digest().readUInt32BE(0) % 100;
  return bucket < config.experiment.ratio ? 'A' : 'B';
}
export async function businessViewerData(store: { id: string; name: string; currency: string }, config: BusinessConfiguration, screenId: string, customer?: typeof customersTable.$inferSelect, recordVisit = false, factsPolicy?: { isOwner: boolean; financialSegments: ReadonlySet<string>; returning?: boolean }): Promise<BusinessViewer> {
  const rawFacts = customer ? await customerFacts(customer) : undefined;
  const facts = rawFacts && factsPolicy ? publicCustomerFacts(rawFacts, factsPolicy.isOwner, factsPolicy.financialSegments) : rawFacts;
  const viewer: BusinessViewer = { storeName: store.name, customerName: customer?.name ?? 'اسم العميل', returning: customer ? facts?.HAS_ORDERS === true : factsPolicy?.returning ?? false, now: Date.now(), facts, available: await commerceAvailability(store.id), data: {}, experimentVariant: experimentVariant(config, store.id, customer?.id ?? '') };
  const screen = config.screens.find(s => s.id === screenId);
  if (!screen || !visibleBusinessScreen(config, screen, viewer)) return viewer;
  for (const block of screen.blocks) {
    if (!block.enabled || (block.condition && (!facts || !evaluateRule(block.condition, facts)))) continue;
    if (['PRODUCT', 'PRODUCT_CAROUSEL', 'FEATURED', 'OFFERS'].includes(block.type)) {
      const filters = [eq(productsTable.storeId, store.id), eq(productsTable.isPublished, true), eq(productsTable.isDeleted, false)];
      if (block.type === 'PRODUCT') filters.push(eq(productsTable.id, block.target!));
      if (block.type === 'FEATURED') filters.push(eq(productsTable.featured, true));
      if (block.type === 'OFFERS') filters.push(sql`${productsTable.oldPrice}>${productsTable.price}`);
      const products = await db.select().from(productsTable).where(and(...filters)).orderBy(asc(productsTable.createdAt), asc(productsTable.id)).limit(block.type === 'PRODUCT' ? 1 : 6);
      const gallery = products.length && await featureGate.can(store.id, 'catalog.multipleImages') ? await db.select().from(productImagesTable).where(inArray(productImagesTable.productId, products.map(p => p.id))).orderBy(productImagesTable.sortOrder) : [];
      const cards = await Promise.all(products.map(async p => {
        const images = gallery.filter(image => image.productId === p.id).slice(0,10);
        const total = images.length || (p.imageUrl ? 1 : 0);
        return businessProductCard(p,store.currency,block.style??themeDefaults(config.theme).productCardStyle,viewer.available?.reviews ? await productReviewSummary(store.id,p.id) : undefined,total ? {index:0,total} : undefined);
      }));
      const imageUrl = gallery.find(image=>image.productId===products[0]?.id)?.imageUrl ?? products[0]?.imageUrl;
      viewer.data![block.id] = { text: products.length ? [block.title, ...cards].filter(Boolean).join('\n\n') : 'لا توجد منتجات متاحة لهذا القسم.',
        buttons: products.map(p => ({ text: p.name.slice(0,40), callback_data: `lb:product:${p.id.replaceAll('-','').slice(0,12)}` })), ...(imageUrl && safeUrl(imageUrl) ? { imageUrl } : {}) };
    } else if (['CATEGORY_GRID', 'CATEGORY_LIST'].includes(block.type)) {
      const categories = await db.select().from(categoriesTable).where(and(eq(categoriesTable.storeId, store.id), eq(categoriesTable.isDeleted, false))).orderBy(asc(categoriesTable.createdAt), asc(categoriesTable.id)).limit(6);
      const grid = block.style === 'grid' || (block.type === 'CATEGORY_GRID' && !['list','compact','minimal'].includes(block.style??''));
      const categoryName = (category: typeof categories[number]) => block.style === 'minimal' ? category.name : `${category.emoji || '📂'} ${category.name}`;
      const imageUrl = grid ? categories.find(category=>category.imageUrl&&safeUrl(category.imageUrl))?.imageUrl : undefined;
      viewer.data![block.id] = { text: categories.length ? categories.map(categoryName).join(grid||block.style==='compact' ? ' · ' : '\n') : 'لا توجد تصنيفات متاحة.', buttons: categories.map(c => ({ text: categoryName(c).slice(0,40), callback_data: `lb:category:${c.id}:1` })), ...(imageUrl?{imageUrl}:{}) };
    } else if (block.type === 'POINTS' && viewer.available?.points && customer) {
      viewer.data![block.id] = { text: `⭐ رصيدك: ${customer.points}`, buttons: [{ text: block.title || 'سجل النقاط', callback_data: 'lb:commerce:points' }] };
    }
  }
  if (recordVisit && customer && config.experiment?.enabled && viewer.experimentVariant) {
    const key = `${config.experiment.id}:${viewer.experimentVariant}`;
    await db.update(customersTable).set({ state: sql`jsonb_set(${customersTable.state},'{experimentVisits}',coalesce(${customersTable.state}->'experimentVisits','{}'::jsonb) || jsonb_build_object(${key}::text, true))` }).where(and(eq(customersTable.id, customer.id), eq(customersTable.storeId, store.id)));
  }
  return viewer;
}
