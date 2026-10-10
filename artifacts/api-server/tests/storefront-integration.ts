import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import app from '../src/app';
import { sha256 } from '../src/lib/security';

test('real storefront HTTP retains settings, product data and permission boundaries', async t => {
  assert.match(process.env.TEACHER_TEST_SCHEMA ?? '', /^teacher_qa_[a-f0-9]{32}$/);
  const ids = { owner: randomUUID(), other: randomUUID(), teacher: randomUUID(), store: randomUUID(), category: randomUUID(), published: randomUUID(), hidden: randomUUID() };
  const tokens = new Map<string, { cookie: string; csrf: string }>();
  for (const id of [ids.owner, ids.other, ids.teacher]) {
    await pool.query('INSERT INTO users(id,name,email,password_hash,account_type) VALUES($1,$2,$3,$4,$5)', [id, 'حساب اختبار وهمي', `${id}@example.invalid`, 'unused-test-hash', id === ids.teacher ? 'teacher' : 'merchant']);
    const token = randomUUID() + randomUUID(), csrf = randomUUID() + randomUUID();
    await pool.query('INSERT INTO sessions(id,user_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4,$5)', [randomUUID(), id, sha256(token), sha256(csrf), new Date(Date.now() + 3600000)]);
    tokens.set(id, { cookie: `lootbot_session=${token}; lootbot_csrf=${csrf}`, csrf });
  }
  const slug = `qa-${ids.store}`;
  await pool.query('INSERT INTO stores(id,owner_id,name,slug,currency) VALUES($1,$2,$3,$4,$5)', [ids.store, ids.owner, 'متجر تجريبي', slug, 'SAR']);
  const settings = { plan: { code: 'BUSINESS' }, cartEnabled: true, telegramHomeStudio: { revision: 7 }, storefront: { custom: 'keep' } };
  await pool.query('INSERT INTO store_settings(store_id,settings) VALUES($1,$2)', [ids.store, JSON.stringify(settings)]);
  await pool.query('INSERT INTO categories(id,store_id,name) VALUES($1,$2,$3)', [ids.category, ids.store, 'تصنيف اختبار']);
  await pool.query('INSERT INTO products(id,store_id,category_id,name,description,price,stock,is_published) VALUES($1,$2,$3,$4,$5,$6,$7,true),($8,$2,$3,$9,$5,$6,$7,false)', [ids.published, ids.store, ids.category, 'منتج ظاهر', 'وصف تجريبي', '12.50', 3, ids.hidden, 'منتج مسودة']);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(path: string, user?: string, method = 'GET', data?: unknown, csrf = true) {
    const auth = user ? tokens.get(user) : undefined;
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(auth ? { cookie: auth.cookie, ...(csrf ? { 'x-csrf-token': auth.csrf } : {}) } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, cacheControl: response.headers.get('cache-control'), data: await response.json() };
  }
  try {
    await t.test('public default is disabled; private preview excludes drafts and ownership fields', async () => {
      assert.equal((await request(`/storefront/${slug}`)).status, 404);
      assert.equal((await request(`/stores/${ids.store}/storefront/preview`)).status, 401);
      const preview = await request(`/stores/${ids.store}/storefront/preview`, ids.owner);
      assert.equal(preview.status, 200); assert.equal(preview.data.products.length, 1); assert.equal(preview.data.products[0].id, ids.published); assert.equal(preview.data.store.ownerId, undefined); assert.equal(preview.data.products[0].stock, undefined);
    });
    await t.test('CSRF, foreign merchants and teacher attempts are rejected', async () => {
      for (const [user, status] of [[ids.other, 404], [ids.teacher, 403]] as const) assert.equal((await request(`/stores/${ids.store}/storefront`, user, 'PATCH', { theme: 'white', enabled: true })).status, status);
      assert.equal((await request(`/stores/${ids.store}/storefront`, ids.owner, 'PATCH', { theme: 'white', enabled: true }, false)).status, 403);
      assert.equal((await request(`/stores/${ids.store}/storefront`, ids.owner, 'PATCH', { theme: 'fake', enabled: true })).status, 400);
    });
    await t.test('every theme persists, public category/details inherit it and business data remains unchanged', async () => {
      const before = (await pool.query('SELECT * FROM products WHERE store_id=$1 ORDER BY id', [ids.store])).rows;
      for (const theme of ['dark', 'white', 'nebula']) {
        assert.equal((await request(`/stores/${ids.store}/storefront`, ids.owner, 'PATCH', { theme, enabled: true })).status, 200);
        assert.equal((await request(`/stores/${ids.store}/storefront`, ids.owner)).data.theme, theme);
        const page = await request(`/storefront/${slug}?category=${ids.category}`); assert.equal(page.status, 200); assert.equal(page.cacheControl, 'no-store'); assert.equal(page.data.store.theme, theme); assert.equal(page.data.products.length, 1);
        assert.equal((await request(`/storefront/${slug}/products/${ids.published}`)).data.store.theme, theme);
      }
      assert.equal((await request(`/storefront/${slug}/products/${ids.hidden}`)).status, 404);
      assert.equal((await request(`/storefront/${slug}?page=0`)).status, 400);
      const saved = (await pool.query('SELECT settings FROM store_settings WHERE store_id=$1', [ids.store])).rows[0].settings;
      assert.deepEqual(saved.plan, settings.plan); assert.deepEqual(saved.telegramHomeStudio, settings.telegramHomeStudio); assert.equal(saved.cartEnabled, true); assert.equal(saved.storefront.custom, 'keep');
      assert.deepEqual((await pool.query('SELECT * FROM products WHERE store_id=$1 ORDER BY id', [ids.store])).rows, before);
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); }
});
