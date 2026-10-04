import { and, count, eq, gte } from "drizzle-orm";
import type { Response } from "express";
import {
  categoriesTable,
  db,
  ordersTable,
  productsTable,
  storeSettingsTable,
  storesTable,
  planDefinitionsTable,
} from "@workspace/db";
import {
  PLAN_CATALOG,
  type PlanCode,
  type PlanCatalog,
  type PlanLimit,
  highestPlan,
  isPlanLimitReached,
  planLimitMessage,
  readPlanCode,
  validatePlanDefinition,
} from "./plans";

export async function getPlanCatalog(): Promise<PlanCatalog> {
  const rows = await db.select().from(planDefinitionsTable);
  const catalog = structuredClone(PLAN_CATALOG) as PlanCatalog;
  for (const row of rows) {
    if (row.code in catalog && validatePlanDefinition(row.definition)) {
      catalog[row.code as keyof typeof catalog] = row.definition;
    }
  }
  return catalog;
}

export async function getStorePlan(storeId: string): Promise<PlanCode> {
  const [settings] = await db
    .select({ settings: storeSettingsTable.settings })
    .from(storeSettingsTable)
    .where(eq(storeSettingsTable.storeId, storeId))
    .limit(1);
  return readPlanCode(settings?.settings);
}

export async function getOwnerPlan(ownerId: string): Promise<PlanCode> {
  const rows = await db
    .select({ settings: storeSettingsTable.settings })
    .from(storesTable)
    .leftJoin(
      storeSettingsTable,
      eq(storeSettingsTable.storeId, storesTable.id),
    )
    .where(and(eq(storesTable.ownerId, ownerId), eq(storesTable.isDeleted, false)));
  return highestPlan(rows.map((row) => readPlanCode(row.settings)));
}

export async function getPlanUsage(storeId: string, ownerId: string) {
  const monthStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  );
  const [storeCount, productCount, categoryCount, monthlyOrderCount] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(storesTable)
        .where(
          and(eq(storesTable.ownerId, ownerId), eq(storesTable.isDeleted, false)),
        ),
      db
        .select({ value: count() })
        .from(productsTable)
        .where(
          and(
            eq(productsTable.storeId, storeId),
            eq(productsTable.isDeleted, false),
          ),
        ),
      db
        .select({ value: count() })
        .from(categoriesTable)
        .where(
          and(
            eq(categoriesTable.storeId, storeId),
            eq(categoriesTable.isDeleted, false),
          ),
        ),
      db
        .select({ value: count() })
        .from(ordersTable)
        .where(
          and(
            eq(ordersTable.storeId, storeId),
            gte(ordersTable.createdAt, monthStart),
          ),
        ),
    ]);

  return {
    stores: Number(storeCount[0]?.value ?? 0),
    productsPerStore: Number(productCount[0]?.value ?? 0),
    categoriesPerStore: Number(categoryCount[0]?.value ?? 0),
    ordersPerMonth: Number(monthlyOrderCount[0]?.value ?? 0),
  };
}

export function enforcePlanLimit(
  response: Response,
  plan: PlanCode,
  limit: PlanLimit,
  usage: number,
  catalog: PlanCatalog = PLAN_CATALOG,
): boolean {
  if (!isPlanLimitReached(plan, limit, usage, catalog)) return false;
  response.status(403).json({
    code: "PLAN_LIMIT_REACHED",
    plan,
    limit,
    maximum: catalog[plan].limits[limit],
    error: planLimitMessage(plan, limit),
  });
  return true;
}
