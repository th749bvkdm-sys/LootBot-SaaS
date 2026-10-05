import { and, eq } from 'drizzle-orm';
import { db, storesTable, usersTable } from '@workspace/db';
import { storeMembersTable } from '../../../../lib/db/src/schema/staff';
import { featureGate } from './store-plans';
import { STAFF_PERMISSIONS, staffCan, type StaffPermission } from './staff-policy';

export async function getStoreAccess(storeId: string, userId: string, permission: StaffPermission | 'owner' | 'member' = 'owner') {
  const [store] = await db.select({ id: storesTable.id, name: storesTable.name, currency: storesTable.currency, ownerId: storesTable.ownerId })
    .from(storesTable).where(and(eq(storesTable.id, storeId), eq(storesTable.isDeleted, false))).limit(1);
  if (!store) return undefined;
  if (store.ownerId === userId) return { ...store, isOwner: true, permissions: [...STAFF_PERMISSIONS] };
  if (permission === 'owner') return undefined;
  const [membership] = await db.select().from(storeMembersTable).innerJoin(usersTable, eq(usersTable.id, storeMembersTable.userId))
    .where(and(eq(storeMembersTable.storeId, storeId), eq(storeMembersTable.userId, userId), eq(storeMembersTable.enabled, true), eq(usersTable.isDeleted, false))).limit(1);
  if (!membership || !await featureGate.can(storeId, 'staff.basic') || (permission === 'member' ? membership.store_members.permissions.length === 0 : !staffCan(membership.store_members.permissions, permission, membership.store_members.enabled))) return undefined;
  return { ...store, isOwner: false, permissions: membership.store_members.permissions };
}
export async function listAccessibleStores(userId: string) {
  const ownerStores = await db.select().from(storesTable).where(and(eq(storesTable.ownerId, userId), eq(storesTable.isDeleted, false))).orderBy(storesTable.createdAt);
  const memberships = await db.select({ store: storesTable, permissions: storeMembersTable.permissions }).from(storeMembersTable)
    .innerJoin(storesTable, eq(storesTable.id, storeMembersTable.storeId)).where(and(eq(storeMembersTable.userId, userId), eq(storeMembersTable.enabled, true), eq(storesTable.isDeleted, false)));
  const staffStores = [];
  for (const membership of memberships) if (membership.permissions.length && await featureGate.can(membership.store.id, 'staff.basic')) staffStores.push(membership.store);
  return [...ownerStores, ...staffStores.filter(store => !ownerStores.some(owned => owned.id === store.id))];
}
