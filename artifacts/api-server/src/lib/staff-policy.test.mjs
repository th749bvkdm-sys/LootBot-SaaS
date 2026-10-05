import assert from 'node:assert/strict';
import test from 'node:test';
import { STAFF_PERMISSIONS, parseStaffPermissions, permissionForRequest, staffCan } from './staff-policy.ts';

test('staff permissions are allowlisted and write scopes include reading', () => {
  assert.deepEqual(parseStaffPermissions(['catalog.write']), ['catalog.write', 'catalog.read']);
  assert.deepEqual(parseStaffPermissions(['orders.manage']), ['orders.manage', 'orders.read']);
  for (const input of [null, [], ['SUPERADMIN'], ['owner'], ['billing.manage'], ['catalog.read', 'catalog.read'], [1]]) assert.equal(parseStaffPermissions(input), null);
  assert.equal(parseStaffPermissions([...STAFF_PERMISSIONS]).length, STAFF_PERMISSIONS.length);
});
test('staff access is revoked immediately by disabling membership or its plan', () => {
  assert.equal(staffCan(['catalog.read'], 'catalog.read'), true);
  assert.equal(staffCan(['catalog.read'], 'catalog.write'), false);
  assert.equal(staffCan(['catalog.read'], 'catalog.read', false), false);
  assert.equal(staffCan(['catalog.read'], 'catalog.read', true, false), false);
  assert.equal(staffCan(['owner'], 'owner'), false);
  assert.equal(staffCan('catalog.read', 'catalog.read'), false);
});
test('financial and security requests remain owner-only even with all staff permissions', () => {
  const ownerRoutes = [['PATCH', '/orders/123/payment'], ['POST', '/stores/123/bot'], ['DELETE', '/stores/123/bot'], ['POST', '/stores/123/telegram/test-connection'], ['PATCH', '/stores/123/team/456'], ['GET', '/admin/overview'], ['PATCH', '/stores/123'], ['POST', '/stores/123/unknown-action']];
  for (const [method, path] of ownerRoutes) assert.equal(permissionForRequest(method, path), 'owner', path);
});
test('known store workflows map to separate reading and editing scopes', () => {
  assert.equal(permissionForRequest('GET', '/products/123/gallery'), 'catalog.read');
  assert.equal(permissionForRequest('PUT', '/products/123/presentation'), 'catalog.write');
  assert.equal(permissionForRequest('PATCH', '/orders/123/status'), 'orders.manage');
  assert.equal(permissionForRequest('GET', '/orders'), 'orders.read');
  assert.equal(permissionForRequest('GET', '/stores/123/growth/customers'), 'customers.read');
  assert.equal(permissionForRequest('PATCH', '/stores/123/growth/customers/456'), 'customers.manage');
  assert.equal(permissionForRequest('POST', '/stores/123/telegram/business-studio/publish'), 'telegram.design');
  assert.equal(permissionForRequest('GET', '/stores/123/analytics'), 'analytics.read');
});
