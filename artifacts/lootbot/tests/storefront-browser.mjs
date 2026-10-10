import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const base = process.env.TEACHER_UI_URL || 'http://127.0.0.1:5190';
if (!/^http:\/\/127\.0\.0\.1:51\d{2}$/.test(base)) throw Error('Only the local fictional fixture is permitted.');
const runtime = process.env.PLAYWRIGHT_MODULE || 'C:/Users/kh7bw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(runtime).href);
const output = path.resolve('artifacts/lootbot/test-results/storefront'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ar-SA', serviceWorkers: 'block' });
const page = await context.newPage(); const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => void dialog.accept());
async function api(endpoint, method = 'GET', data) {
  const headers = {};
  if (method !== 'GET') headers['x-csrf-token'] = (await (await page.request.get(`${base}/api/auth/csrf`)).json()).token;
  const response = await page.request.fetch(`${base}/api${endpoint}`, { method, headers, ...(data !== undefined ? { data } : {}) });
  assert.ok(response.ok(), `API ${endpoint} ${response.status()}`); return response.json();
}
async function check(name, action) { await action(); console.log(`PASS ${name}`); results.push({ name, passed: true }); }
try {
  await page.goto(`${base}/login`); await page.locator('input[name=email]').fill('merchant@example.invalid'); await page.locator('input[name=password]').fill('Local-Fixture-Only-2026!'); await page.getByTestId('button-submit').click(); await page.waitForURL('**/dashboard');
  const stores = await api('/stores'); const store = stores.find(value => value.slug === 'local-fixture-store'); assert.ok(store);
  await check('existing merchant navigation and modules remain usable', async () => {
    for (const section of ['', '/products', '/categories', '/orders', '/telegram', '/analytics', '/team', '/settings']) {
      await page.goto(`${base}/dashboard${section}`); await page.locator('.merchant-console').waitFor(); await page.waitForTimeout(700);
      assert.ok(!page.url().includes('/account/select')); assert.equal(await page.locator('.console-navigation a').filter({ hasText: 'كشوف الطلاب' }).count(), 0);
      assert.equal(await page.getByText('حدث خطأ غير متوقع.', { exact: true }).count(), 0);
    }
  });
  await check('theme radio controls preview instantly, save and persist after refresh', async () => {
    await page.goto(`${base}/dashboard/settings`); const appearance = page.locator('section').filter({ has: page.getByRole('heading', { name: 'مظهر واجهة المتجر', exact: true }) });
    for (const [theme, name] of [['dark', 'داكن'], ['white', 'أبيض'], ['nebula', 'LootBot Nebula']]) {
      await appearance.getByRole('radio', { name: new RegExp(name) }).check(); await appearance.locator(`.sf-preview.sf-${theme}`).waitFor();
      await appearance.getByRole('button', { name: 'حفظ المظهر', exact: true }).click(); await appearance.getByText('تم حفظ المظهر. المنتجات والطلبات لم تتغير.', { exact: true }).waitFor();
      assert.equal((await api(`/stores/${store.id}/storefront`)).theme, theme); await page.reload(); await page.getByRole('radio', { name: new RegExp(name) }).waitFor(); assert.equal(await page.getByRole('radio', { name: new RegExp(name) }).isChecked(), true);
    }
  });
  await check('public themes, category navigation, detail links and product data', async () => {
    const productNames = new Set();
    for (const theme of ['dark', 'white', 'nebula']) {
      await api(`/stores/${store.id}/storefront`, 'PATCH', { theme, enabled: true });
      await page.goto(`${base}/store/local-fixture-store`); await page.locator('.sf-product').first().waitFor(); await page.locator(`.storefront.sf-${theme}`).first().waitFor(); assert.equal(await page.locator('.sf-product').count(), 4);
      const names = await page.locator('.sf-product h2').allTextContents(); names.forEach(value => productNames.add(value));
      await page.locator('.sf-categories a').filter({ hasText: 'تصنيف تجريبي' }).click(); await page.waitForURL('**/categories/**'); await page.locator('.sf-product').first().waitFor(); assert.equal(await page.locator('.sf-product').count(), 4);
      await page.getByRole('link', { name: 'عرض التفاصيل' }).first().click(); await page.locator('.sf-detail').waitFor(); assert.equal(await page.locator('.sf-detail h1').count(), 1); await page.locator('.sf-breadcrumb a').first().click();
      await page.screenshot({ path: path.join(output, `store-${theme}-desktop.png`), fullPage: true });
    }
    assert.equal(productNames.size, 4);
  });
  await check('public catalog responsive RTL keyboard focus and reduced motion', async () => {
    for (const width of [320, 390, 820, 1440]) {
      await page.setViewportSize({ width, height: 1000 }); await page.goto(`${base}/store/local-fixture-store`); await page.locator('.sf-product').first().waitFor();
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })); assert.ok(dimensions.scroll <= dimensions.client + 1, `overflow at ${width}: ${JSON.stringify(dimensions)}`);
      assert.equal(await page.locator('.storefront').first().getAttribute('dir'), 'rtl'); await page.screenshot({ path: path.join(output, `store-${width}.png`), fullPage: true });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' }); const animation = await page.locator('.sf-hero').evaluate(element => getComputedStyle(element, '::before').animationName); assert.equal(animation, 'none');
    await page.keyboard.press('Tab'); const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, outline: getComputedStyle(document.activeElement).outlineStyle })); assert.ok(['A', 'BUTTON', 'INPUT'].includes(focus.tag)); assert.equal(focus.outline, 'solid');
  });
  assert.deepEqual(errors, []); await writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: results.length, results, browserErrors: errors }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); await writeFile(path.join(output, 'failure.txt'), String(error)); throw error; }
finally { await browser.close(); }
