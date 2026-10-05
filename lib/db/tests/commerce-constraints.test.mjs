import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const constraints = [
  'coupons_percent_check', 'customer_products_quantity_check',
  'product_reviews_stars_check', 'customer_referrals_check',
  'commerce_order_rewards_points_check', 'commerce_order_rewards_referral_points_check',
];

test('isolated deployed schema enforces commerce checks and additive repair is repeatable without changing data', async () => {
  const saved = (await readFile(new URL('../../../.env.v2-test', import.meta.url), 'utf8')).trim();
  const target = new URL(saved.slice('DATABASE_URL='.length));
  assert.equal(target.hostname, 'ep-summer-recipe-b21ls93d-pooler.c-6.eu-central-1.aws.neon.tech');
  target.searchParams.set('sslmode', 'verify-full');
  const client = new pg.Client({ connectionString: target.toString() });
  await client.connect();
  await client.query('BEGIN');
  const expectDatabaseError = async (statement, values, code, name) => {
    await client.query('SAVEPOINT rejected_write');
    try {
      await assert.rejects(client.query(statement, values), error => error.code === code && (!name || error.constraint === name));
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT rejected_write');
      await client.query('RELEASE SAVEPOINT rejected_write');
    }
  };
  try {
    const actual = await client.query("SELECT conname, convalidated FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname=ANY($1::text[]) ORDER BY conname", [constraints]);
    assert.deepEqual(actual.rows.map(row => row.conname), [...constraints].sort());
    assert.ok(actual.rows.every(row => row.convalidated));
    const expectedIndexes = ['product_images_product_sort_unique','product_images_primary_unique','customers_store_telegram_unique','customers_store_seen_idx','growth_resources_store_kind_idx','growth_jobs_store_dedupe_unique','growth_jobs_status_available_idx','coupons_store_code_unique','coupon_uses_customer_unique','coupon_uses_order_unique','customer_products_unique','product_reviews_customer_unique','customer_referrals_new_unique','store_members_store_user_unique','store_members_user_enabled_idx'];
    const indexes = await client.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname=ANY($1::text[]) ORDER BY indexname", [expectedIndexes]);
    assert.deepEqual(indexes.rows.map(row => row.indexname), [...expectedIndexes].sort());

    const owner=randomUUID(),store=randomUUID(),customer=randomUUID(),referrer=randomUUID(),product=randomUUID(),order=randomUUID();
    await client.query('INSERT INTO users (id,name,email,password_hash) VALUES ($1,$2,$3,$4)',[owner,'Constraint fixture',`constraints-${owner}@example.invalid`,'not-a-login-credential']);
    await client.query('INSERT INTO stores (id,owner_id,name,slug) VALUES ($1,$2,$3,$4)',[store,owner,'Constraint fixture',`constraints-${store}`]);
    for(const id of [customer,referrer])await client.query('INSERT INTO customers (id,store_id,telegram_user_id,telegram_chat_id,name) VALUES ($1,$2,$3,$3,$4)',[id,store,id,'Constraint fixture']);
    await client.query('INSERT INTO products (id,store_id,name,price,stock) VALUES ($1,$2,$3,1,1)',[product,store,'Constraint fixture']);
    await client.query('INSERT INTO orders (id,store_id,telegram_chat_id,customer_name,currency,total) VALUES ($1,$2,$3,$4,$5,1)',[order,store,customer,'Constraint fixture','USD']);
    for(const percent of [0,101])await expectDatabaseError('INSERT INTO coupons (id,store_id,code,percent) VALUES ($1,$2,$3,$4)',[randomUUID(),store,randomUUID(),percent],'23514','coupons_percent_check');
    for(const percent of [1,100])await client.query('INSERT INTO coupons (id,store_id,code,percent) VALUES ($1,$2,$3,$4)',[randomUUID(),store,randomUUID(),percent]);
    const cart=randomUUID();await client.query('INSERT INTO customer_products (id,customer_id,product_id,quantity) VALUES ($1,$2,$3,0)',[cart,customer,product]);
    for(const quantity of [-1,21])await expectDatabaseError('UPDATE customer_products SET quantity=$1 WHERE id=$2',[quantity,cart],'23514','customer_products_quantity_check');
    await client.query('UPDATE customer_products SET quantity=20 WHERE id=$1',[cart]);
    const review=randomUUID();await client.query('INSERT INTO product_reviews (id,store_id,customer_id,product_id,stars) VALUES ($1,$2,$3,$4,1)',[review,store,customer,product]);
    for(const stars of [0,6])await expectDatabaseError('UPDATE product_reviews SET stars=$1 WHERE id=$2',[stars,review],'23514','product_reviews_stars_check');
    await client.query('UPDATE product_reviews SET stars=5 WHERE id=$1',[review]);
    await expectDatabaseError('INSERT INTO customer_referrals (id,store_id,referrer_id,customer_id) VALUES ($1,$2,$3,$3)',[randomUUID(),store,customer],'23514','customer_referrals_check');
    await client.query('INSERT INTO customer_referrals (id,store_id,referrer_id,customer_id) VALUES ($1,$2,$3,$4)',[randomUUID(),store,referrer,customer]);
    await client.query('INSERT INTO commerce_order_rewards (order_id,store_id,customer_id,points,referrer_id,referral_points) VALUES ($1,$2,$3,0,$4,0)',[order,store,customer,referrer]);
    await expectDatabaseError('UPDATE commerce_order_rewards SET points=-1 WHERE order_id=$1',[order],'23514','commerce_order_rewards_points_check');
    await expectDatabaseError('UPDATE commerce_order_rewards SET referral_points=-1 WHERE order_id=$1',[order],'23514','commerce_order_rewards_referral_points_check');
    await expectDatabaseError('INSERT INTO customer_products (id,customer_id,product_id,quantity) VALUES ($1,$2,$3,1)',[randomUUID(),randomUUID(),product],'23503');
    await expectDatabaseError('INSERT INTO customer_products (id,customer_id,product_id,quantity) VALUES ($1,$2,$3,1)',[randomUUID(),customer,product],'23505','customer_products_unique');

    const schema='v2_constraints_'+randomUUID().replaceAll('-','');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query("SELECT set_config('search_path',$1,true)",[schema]);
    for(const table of ['coupons','customer_products','product_reviews','customer_referrals','commerce_order_rewards'])await client.query(`CREATE TABLE "${table}" (LIKE public."${table}" INCLUDING DEFAULTS)`);
    const migration=await readFile(new URL('../migrations/0009_commerce_check_constraints.sql',import.meta.url),'utf8');
    await client.query(migration);await client.query(migration);
    const repaired=await client.query('SELECT conname, convalidated FROM pg_constraint WHERE connamespace=$1::regnamespace AND conname=ANY($2::text[]) ORDER BY conname',[schema,constraints]);
    assert.deepEqual(repaired.rows.map(row=>row.conname),[...constraints].sort());assert.ok(repaired.rows.every(row=>row.convalidated));
    await expectDatabaseError('INSERT INTO coupons (id,store_id,code,percent) VALUES ($1,$2,$3,0)',[randomUUID(),store,randomUUID()],'23514','coupons_percent_check');
  } finally {
    // Every record and the temporary schema belong to this transaction.
    await client.query('ROLLBACK');await client.end();
  }
});
