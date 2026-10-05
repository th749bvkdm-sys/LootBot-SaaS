export const STAFF_PERMISSIONS = [
  'overview.read', 'catalog.read', 'catalog.write', 'orders.read', 'orders.manage',
  'customers.read', 'customers.manage', 'telegram.design', 'marketing.manage',
  'automation.manage', 'analytics.read',
] as const;
export type StaffPermission = typeof STAFF_PERMISSIONS[number];
export const STAFF_PERMISSION_LABELS: Record<StaffPermission, string> = {
  'overview.read': 'عرض نظرة عامة', 'catalog.read': 'عرض المنتجات والتصنيفات', 'catalog.write': 'إدارة الكتالوج',
  'orders.read': 'عرض الطلبات', 'orders.manage': 'تجهيز الطلبات وتحديث حالتها', 'customers.read': 'عرض العملاء',
  'customers.manage': 'إدارة شرائح العملاء', 'telegram.design': 'تصميم البوت ونشره',
  'marketing.manage': 'إدارة الحملات وإرسالها', 'automation.manage': 'إدارة الأتمتة والرحلات', 'analytics.read': 'عرض التحليلات دون بيانات مالية',
};
export function parseStaffPermissions(input: unknown): StaffPermission[] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > STAFF_PERMISSIONS.length || !input.every(permission => typeof permission === 'string' && STAFF_PERMISSIONS.includes(permission as StaffPermission))) return null;
  if (new Set(input).size !== input.length) return null;
  const result = [...input] as StaffPermission[];
  for (const [write, read] of [['catalog.write', 'catalog.read'], ['orders.manage', 'orders.read'], ['customers.manage', 'customers.read']] as const) if (result.includes(write) && !result.includes(read)) result.push(read);
  return result;
}
export function staffCan(permissions: unknown, permission: StaffPermission | 'owner', enabled = true, staffPlanEnabled = true): boolean {
  return enabled && staffPlanEnabled && permission !== 'owner' && Array.isArray(permissions) && permissions.includes(permission);
}

/** Fails closed for unmatched endpoints; financial, team and security changes stay owner-only. */
export function permissionForRequest(method: string, path: string): StaffPermission | 'owner' {
  const read = method === 'GET' || method === 'HEAD';
  if (/\/(payment|team|settings|plan|bot)(\/|$)/.test(path) || path.endsWith('/test-connection')) return 'owner';
  if (/\/(products|categories)(\/|$)/.test(path)) return read ? 'catalog.read' : 'catalog.write';
  if (/\/orders(\/|$)/.test(path)) return read ? 'orders.read' : 'orders.manage';
  if (/\/growth\/customers(\/|$)/.test(path)) return read ? 'customers.read' : 'customers.manage';
  if (/\/telegram\/(studio|designer|business-studio)(\/|$)/.test(path)) return 'telegram.design';
  if (/\/telegram\/health$/.test(path)) return 'overview.read';
  if (/\/analytics(\/|$)/.test(path)) return 'analytics.read';
  if (/\/dashboard\/(summary|activity)$/.test(path)) return 'overview.read';
  return 'owner';
}
