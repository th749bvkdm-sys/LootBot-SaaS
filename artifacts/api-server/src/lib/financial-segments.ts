import { and, eq } from 'drizzle-orm';
import { db, growthResourcesTable } from '@workspace/db';
import { parseGrowthConfiguration } from './growth-configuration';
import { financialSegmentClosure } from './growth-finance-policy';

export async function financialSegmentIds(storeId: string): Promise<Set<string>> {
  const rows = await db.select({ id: growthResourcesTable.id, configuration: growthResourcesTable.configuration })
    .from(growthResourcesTable).where(and(eq(growthResourcesTable.storeId, storeId), eq(growthResourcesTable.kind, 'segment')));
  return financialSegmentClosure(rows.map(row => ({ id: row.id, configuration: parseGrowthConfiguration(row.configuration) })));
}
