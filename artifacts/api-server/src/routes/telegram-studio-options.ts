import { and, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { db, categoriesTable, customersTable, productsTable } from '@workspace/db';
import { getOwnedStore, requireAuth } from '../lib/auth-middleware';
import { getStoreAccess } from '../lib/staff-access';
import { featureGate } from '../lib/store-plans';
import { parseStudioOptionsQuery } from '../lib/studio-options-input';

export const studioOptionsRouter = Router();

/** Same owned catalogue/customer records as management pages, with bounded label-only queries. */
studioOptionsRouter.get('/stores/:storeId/telegram/studio/options/:kind', requireAuth, async (req, res) => {
  const { storeId, kind } = req.params;
  const input = parseStudioOptionsQuery(req.query);
  if (typeof storeId !== 'string' || typeof kind !== 'string' || !['products', 'categories', 'customers'].includes(kind) || !input) {
    res.status(400).json({ error: 'طلب قائمة غير صالح.' }); return;
  }
  if (!await getOwnedStore(storeId, req.auth!.userId, 'telegram.design')) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  await featureGate.require(storeId, 'telegram.advanced');
  if (kind === 'customers' && !await getStoreAccess(storeId, req.auth!.userId, 'customers.read')) {
    res.status(403).json({ error: 'معاينة العملاء تتطلب صلاحية عرض العملاء.' }); return;
  }
  const search = `%${input.q.replace(/[\\%_]/g, value => `\\${value}`)}%`;
  const table = kind === 'products' ? productsTable : kind === 'categories' ? categoriesTable : customersTable;
  const filters = [eq(table.storeId, storeId)];
  if (kind === 'products') filters.push(eq(productsTable.isDeleted, false), eq(productsTable.isPublished, true));
  else if (kind === 'categories') filters.push(eq(categoriesTable.isDeleted, false));
  const fields = { value: table.id, label: table.name };
  const rows = await db.select(fields).from(table).where(and(...filters, sql`${table.name} ilike ${search}`))
    .orderBy(table.name, table.id).limit(51).offset((input.page - 1) * 50);
  const selectedOption = input.selected ? rows.find(row => row.value === input.selected)
    ?? (await db.select(fields).from(table).where(and(...filters, eq(table.id, input.selected))).limit(1))[0] : undefined;
  res.json({ options: rows.slice(0,50), hasMore: rows.length > 50, selectedOption: selectedOption ?? null });
});
