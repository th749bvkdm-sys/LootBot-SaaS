import { and, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { db, storesTable, usersTable } from '@workspace/db';
import { storeMembersTable } from '../../../../lib/db/src/schema/staff';
import { requireAuth, requireCsrf } from '../lib/auth-middleware';
import { getStoreAccess } from '../lib/staff-access';
import { featureGate } from '../lib/store-plans';
import { parseStaffPermissions, STAFF_PERMISSION_LABELS } from '../lib/staff-policy';
import { createId } from '../lib/security';
import { writeAuditEvent } from '../lib/audit';

const router = Router();
router.get('/stores/:storeId/access', requireAuth, async (req, res) => {
  const storeId = String(req.params.storeId);
  const [store] = await db.select({ ownerId: storesTable.ownerId }).from(storesTable).where(and(eq(storesTable.id, storeId), eq(storesTable.isDeleted, false))).limit(1);
  if (!store) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  if (store.ownerId === req.auth!.userId) { res.json({ isOwner: true, permissions: Object.keys(STAFF_PERMISSION_LABELS), labels: STAFF_PERMISSION_LABELS }); return; }
  const [member] = await db.select().from(storeMembersTable).where(and(eq(storeMembersTable.storeId, storeId), eq(storeMembersTable.userId, req.auth!.userId), eq(storeMembersTable.enabled, true))).limit(1);
  if (!member || !await featureGate.can(storeId, 'staff.basic')) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  res.json({ isOwner: false, permissions: member.permissions, labels: STAFF_PERMISSION_LABELS });
});
router.get('/stores/:storeId/team', requireAuth, async (req, res) => {
  const storeId = String(req.params.storeId);
  if (!await getStoreAccess(storeId, req.auth!.userId, 'owner')) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  const enabled = await featureGate.can(storeId, 'staff.basic');
  const members = await db.select({ id: storeMembersTable.id, userId: usersTable.id, name: usersTable.name, email: usersTable.email, permissions: storeMembersTable.permissions, enabled: storeMembersTable.enabled, createdAt: storeMembersTable.createdAt })
    .from(storeMembersTable).innerJoin(usersTable, eq(storeMembersTable.userId, usersTable.id)).where(and(eq(storeMembersTable.storeId, storeId), eq(usersTable.isDeleted, false))).orderBy(storeMembersTable.createdAt);
  res.json({ enabled, requiredPlan: 'BUSINESS', members, labels: STAFF_PERMISSION_LABELS });
});
router.post('/stores/:storeId/team', requireAuth, requireCsrf, async (req, res) => {
  const storeId = String(req.params.storeId);
  const access = await getStoreAccess(storeId, req.auth!.userId, 'owner');
  if (!access) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  await featureGate.require(storeId, 'staff.basic');
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const permissions = parseStaffPermissions(req.body.permissions);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !permissions) { res.status(400).json({ error: 'تحقق من البريد والصلاحيات المحددة.' }); return; }
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.email, email), eq(usersTable.isDeleted, false))).limit(1);
  if (!user || user.id === access.ownerId) { res.status(400).json({ error: 'يجب أن يملك العضو حسابًا حاليًا مختلفًا عن مالك المتجر.' }); return; }
  const result = await db.transaction(async tx => {
    await tx.select({ id: storesTable.id }).from(storesTable).where(eq(storesTable.id, storeId)).for('update');
    const [existing] = await tx.select().from(storeMembersTable).where(and(eq(storeMembersTable.storeId, storeId), eq(storeMembersTable.userId, user.id))).limit(1);
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::integer` }).from(storeMembersTable).where(and(eq(storeMembersTable.storeId, storeId), eq(storeMembersTable.enabled, true)));
    if (!existing?.enabled && total >= 50) return null;
    const [member] = await tx.insert(storeMembersTable).values({ id: createId(), storeId, userId: user.id, invitedBy: req.auth!.userId, permissions, enabled: true }).onConflictDoUpdate({ target: [storeMembersTable.storeId, storeMembersTable.userId], set: { permissions, enabled: true, updatedAt: new Date(), invitedBy: req.auth!.userId } }).returning();
    return member;
  });
  if (!result) { res.status(400).json({ error: 'اكتمل حد الفريق (50 عضوًا).' }); return; }
  await writeAuditEvent({ userId: req.auth!.userId, storeId, action: 'staff.granted', summary: 'تم حفظ صلاحيات عضو الفريق', details: { memberId: result.id, permissions } });
  res.status(201).json({ id: result.id, enabled: result.enabled, permissions: result.permissions });
});
router.patch('/stores/:storeId/team/:memberId', requireAuth, requireCsrf, async (req, res) => {
  const storeId = String(req.params.storeId);
  if (!await getStoreAccess(storeId, req.auth!.userId, 'owner')) { res.status(404).json({ error: 'المتجر غير موجود.' }); return; }
  // Revocation stays available after a plan downgrade.
  if (req.body.enabled !== false) await featureGate.require(storeId, 'staff.basic');
  const permissions = req.body.permissions === undefined ? undefined : parseStaffPermissions(req.body.permissions);
  if (permissions === null || (req.body.enabled !== undefined && typeof req.body.enabled !== 'boolean') || (permissions === undefined && req.body.enabled === undefined)) { res.status(400).json({ error: 'تحقق من صلاحيات العضو.' }); return; }
  const [member] = await db.update(storeMembersTable).set({ ...(permissions ? { permissions } : {}), ...(typeof req.body.enabled === 'boolean' ? { enabled: req.body.enabled } : {}), updatedAt: new Date() }).where(and(eq(storeMembersTable.id, String(req.params.memberId)), eq(storeMembersTable.storeId, storeId))).returning({ id: storeMembersTable.id });
  if (!member) { res.status(404).json({ error: 'العضو غير موجود في هذا المتجر.' }); return; }
  await writeAuditEvent({ userId: req.auth!.userId, storeId, action: req.body.enabled === false ? 'staff.revoked' : 'staff.updated', summary: 'تم تحديث صلاحيات الفريق', details: { memberId: member.id } });
  res.json({ ok: true });
});
export default router;
