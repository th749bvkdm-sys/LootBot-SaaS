import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { applyMigrations } from '../run-migrations.mjs';

test('isolated migration upgrades only legacy defaults, preserves admin changes, locks and rolls back failures', async () => {
  const saved = (await readFile(new URL('../../../.env.v2-test', import.meta.url), 'utf8')).trim();
  const url = new URL(saved.slice('DATABASE_URL='.length));
  assert.equal(url.hostname, 'ep-summer-recipe-b21ls93d-pooler.c-6.eu-central-1.aws.neon.tech');
  url.searchParams.set('sslmode', 'verify-full');
  const connectionString = url.toString();
  const client = new pg.Client({ connectionString });
  const schema = 'v2_migration_' + randomUUID().replaceAll('-', '');
  const query = (text, values) => client.query(text.replaceAll('plan_definitions', `"${schema}".plan_definitions`).replaceAll('lootbot_schema_migrations', `"${schema}".lootbot_schema_migrations`), values);
  const directory = await mkdtemp(join(tmpdir(), 'lootbot-v2-migrations-'));
  const name = '0008_implemented_premium_features.sql';
  const source = await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8');
  await writeFile(join(directory, name), source);
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await query('CREATE TABLE plan_definitions (id text PRIMARY KEY, code text NOT NULL, definition jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
    const common = { 'catalog.basic': true, 'analytics.basic': true, 'telegram.basic': true, 'telegram.advanced': true, 'catalog.bulkTools': true, 'catalog.multipleImages': true, 'analytics.advanced': false, 'analytics.reports': false, 'coupons.basic': false, 'loyalty.basic': false, 'reviews.basic': false, 'referrals.basic': false, 'staff.basic': false, 'branding.removeLootBot': false };
    const definition = features => ({ name: 'Preserved administrator name', limits: { stores: 7, productsPerStore: 333, categoriesPerStore: 50, ordersPerMonth: 900 }, features });
    const rows = [
      ['pro', 'PRO', definition(common)],
      ['business', 'BUSINESS', definition({ ...common, 'analytics.reports': true, 'telegram.studio': true })],
      ['custom', 'BUSINESS', definition({ ...common, 'analytics.reports': true, 'catalog.bulkTools': false })],
      ['free', 'FREE', definition({ ...common, 'telegram.advanced': false, 'catalog.bulkTools': false, 'catalog.multipleImages': false })],
    ];
    for (const [id, code, value] of rows) await query('INSERT INTO plan_definitions (id, code, definition) VALUES ($1, $2, $3)', [id, code, value]);
    const runs = await Promise.all([applyMigrations({ connectionString, schema, migrationsDir: directory }), applyMigrations({ connectionString, schema, migrationsDir: directory })]);
    assert.equal(runs.flat().length, 1, 'concurrent runners apply the migration once');
    const values = new Map((await query('SELECT id, definition FROM plan_definitions')).rows.map(row => [row.id, row.definition]));
    for (const id of ['pro', 'business']) {
      assert.deepEqual(values.get(id).limits, rows.find(row => row[0] === id)[2].limits);
      assert.equal(values.get(id).name, 'Preserved administrator name');
      for (const key of ['coupons.basic', 'loyalty.basic', 'reviews.basic', 'referrals.basic']) assert.equal(values.get(id).features[key], true);
    }
    for (const key of ['staff.basic', 'analytics.advanced', 'branding.removeLootBot']) assert.equal(values.get('business').features[key], true);
    assert.equal(values.get('pro').features['staff.basic'], false);
    assert.deepEqual(values.get('custom'), rows[2][2], 'customized feature definitions remain untouched');
    assert.deepEqual(values.get('free'), rows[3][2], 'Free is never upgraded');
    await query('UPDATE plan_definitions SET definition=$1 WHERE id=$2', [rows[1][2], 'business']);
    assert.deepEqual(await applyMigrations({ connectionString, schema, migrationsDir: directory }), []);
    assert.equal((await query("SELECT definition FROM plan_definitions WHERE id='business'")).rows[0].definition.features['coupons.basic'], false, 'later admin disables survive subsequent deployments');
    await writeFile(join(directory, name), source + '\n-- changed migration');
    await assert.rejects(applyMigrations({ connectionString, schema, migrationsDir: directory }), /Previously applied migration changed/);
    await writeFile(join(directory, name), source);
    const badName = '0009_failure.sql';
    await writeFile(join(directory, badName), "UPDATE plan_definitions SET definition = '{\"bad\":true}'::jsonb; SELECT 1/0;");
    try {
      await assert.rejects(applyMigrations({ connectionString, schema, migrationsDir: directory }), /division by zero/);
      assert.equal((await query("SELECT count(*)::integer AS total FROM plan_definitions WHERE definition->>'bad'='true'")).rows[0].total, 0);
      assert.equal((await query('SELECT count(*)::integer AS total FROM lootbot_schema_migrations WHERE name=$1', [badName])).rows[0].total, 0);
    } finally { await unlink(join(directory, badName)); }
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
    await unlink(join(directory, name));
    await rmdir(directory);
  }
});
