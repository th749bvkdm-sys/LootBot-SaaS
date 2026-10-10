import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseSetupPlan } from './run-db-push.mjs';

const migrate = ['--filter', '@workspace/db', 'run', 'migrate'];
const push = ['--filter', '@workspace/db', 'run', 'push'];

test('Render builds use migrations even without production NODE_ENV', () => {
  assert.deepEqual(databaseSetupPlan({ RENDER: 'true' }), [migrate]);
  assert.deepEqual(databaseSetupPlan({ RENDER: 'true', NODE_ENV: 'development' }), [migrate]);
});

test('production builds never run Drizzle push', () => {
  assert.deepEqual(databaseSetupPlan({ NODE_ENV: 'production' }), [migrate]);
  assert.deepEqual(databaseSetupPlan({ NODE_ENV: 'production', RENDER: 'false' }), [migrate]);
});

test('local development preserves push then migrate', () => {
  assert.deepEqual(databaseSetupPlan({}), [push, migrate]);
  assert.deepEqual(databaseSetupPlan({ NODE_ENV: 'development', RENDER: 'false' }), [push, migrate]);
  assert.deepEqual(databaseSetupPlan({ NODE_ENV: 'test' }), [push, migrate]);
});

test('plans are fresh values and cannot affect a subsequent invocation', () => {
  const plan = databaseSetupPlan({ RENDER: 'true' });
  plan[0].push('--force');
  assert.deepEqual(databaseSetupPlan({ RENDER: 'true' }), [migrate]);
});
