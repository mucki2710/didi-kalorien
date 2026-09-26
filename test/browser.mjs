import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
import { toCSV } from '../public/csv.js';

const food = { name: '<img src=x onerror=alert(1)> Reis', grams: 200, kcal100: 130, protein100: 2.7, carbs100: 28, fat100: 0.3 };
const oldMeal = { id: 'old-1', date: '2025-12-24', title: '=Reis; "Gemüse"\nÖl', calories: 260, protein: 5, carbs: 56, fat: 1, foods: [food] };
let analysis = { foods: [food], note: 'Geschätzt.' };
const app = express();
// Test only static files, mounted under a GitHub Pages-like subdirectory.
app.use('/didi/', express.static(fileURLToPath(new URL('../public/', import.meta.url))));
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/didi/`;
let browser;
try {
  const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
  browser = await engine.launch({ ...(engine === chromium ? { executablePath: process.env.CHROME_PATH || undefined } : {}), headless: true });
  const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [], localAPI = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (req.url().includes('/api/')) localAPI.push(req.url()); });
  // Fetch-level mock works in both engines even after a service worker takes control.
  await context.addInitScript(initial => {
    const original = window.fetch.bind(window);
    window.testAnalysis = initial;
    window.testStatus = 200;
    window.testRequests = [];
    window.fetch = async (url, options) => {
      if (url !== 'https://api.openai.com/v1/responses') return original(url, options);
      window.testRequests.push({ headers: options.headers, body: JSON.parse(options.body) });
      return new Response(JSON.stringify(window.testStatus === 200 ? {
        status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(window.testAnalysis) }] }],
      } : { error: { message: 'private-provider-detail' } }), { status: window.testStatus, headers: { 'Content-Type': 'application/json' } });
    };
  }, analysis);
  await page.goto(url);
  await expect(page.locator('#mealList')).toContainText('Noch keine Mahlzeit');
  const png = await readFile(new URL('../public/icon-192.png', import.meta.url));
  const upload = () => page.locator('#photoInput').setInputFiles({ name: 'meal.png', mimeType: 'image/png', buffer: png });
  await upload();
  await expect(page.locator('#message')).toContainText('API-Schlüssel');
  assert.equal(await page.evaluate(() => window.testRequests.length), 0);
  await page.locator('#apiKey').fill('test-personal-key');
  await page.locator('#settingsForm button[type=submit]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('didi-api-key')), null);
  await page.locator('#rememberKey').check();
  await page.locator('#settingsForm button[type=submit]').click();
  await upload();
  await expect(page.locator('#analysisCalories')).toHaveText('260 kcal');
  assert.equal(await page.locator('#foodList img').count(), 0);
  const request = await page.evaluate(() => window.testRequests[0]);
  assert.equal(request.headers.Authorization, 'Bearer test-personal-key');
  assert.equal(request.body.model, 'gpt-6-luna');
  assert.equal(request.body.store, false);
  assert.match(request.body.input[0].content[1].image_url, /^data:image\/png;base64,/);
  await page.locator('#foodList input').fill('-1');
  await expect(page.locator('#saveButton')).toBeDisabled();
  await page.locator('#foodList input').fill('100');
  await expect(page.locator('#analysisCalories')).toHaveText('130 kcal');
  await page.locator('#saveButton').click();
  await expect(page.locator('#totalCalories')).toHaveText('130');
  await page.reload();
  await expect(page.locator('#totalCalories')).toHaveText('130');
  const today = await page.locator('#dayPicker').inputValue();
  await page.locator('#previousDay').click();
  await expect(page.locator('#mealList')).toContainText('Noch keine Mahlzeit');
  await upload(); await expect(page.locator('#analysisCalories')).toHaveText('260 kcal');
  await page.locator('#saveButton').click(); await expect(page.locator('#totalCalories')).toHaveText('260');
  await page.locator('#todayButton').click(); await expect(page.locator('#totalCalories')).toHaveText('130');
  const downloadPromise = page.waitForEvent('download'); await page.locator('#exportAll').click();
  const download = await downloadPromise;
  const exported = await readFile(await download.path(), 'utf8');
  assert.match(exported, /calories;protein/); assert.doesNotMatch(exported, /test-personal-key/);
  const importCSV = buffer => page.locator('#csvInput').setInputFiles({ name: 'backup.csv', mimeType: 'text/csv', buffer });
  await importCSV(Buffer.from(toCSV([oldMeal, oldMeal])));
  await expect(page.locator('#message')).toContainText('1 Mahlzeit(en) importiert');
  await importCSV(Buffer.from(toCSV([oldMeal])));
  await expect(page.locator('#message')).toContainText('0 Mahlzeit(en) importiert');
  await page.locator('#dayPicker').fill(oldMeal.date); await page.locator('#dayPicker').dispatchEvent('change');
  await expect(page.locator('#totalCalories')).toHaveText('260');
  await importCSV(Buffer.from('broken CSV'));
  await expect(page.locator('#message')).toContainText('keine gültige Didi-CSV');
  await expect(page.locator('#totalCalories')).toHaveText('260');
  await page.locator('.delete').click(); await expect(page.locator('#totalCalories')).toHaveText('0');
  await page.evaluate(() => { window.testStatus = 404; });
  await upload(); await expect(page.locator('#message')).toContainText('Modell');
  await expect(page.locator('#message')).not.toContainText('private-provider-detail');
  await page.evaluate(() => { window.testStatus = 200; window.testAnalysis = { foods: [], note: 'Kein Essen.' }; });
  await upload(); await expect(page.locator('#message')).toContainText('Kein Essen erkannt');
  await expect(page.locator('#saveButton')).toBeDisabled();
  await page.locator('#cancelButton').click();
  for (const width of [320, 820, 1180]) {
    await page.setViewportSize({ width, height: 1180 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}`);
  }
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  // No host or network is needed after the first complete load.
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  // WebKit's protocol offline emulation can fail navigations before the SW runs.
  // The real static host is stopped for both engines. WebKit's protocol flag also
  // prevents reading uploaded Blob files; simulate only its connectivity indicator.
  if (engine === chromium) await context.setOffline(true);
  await page.reload();
  if (engine === webkit) await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
    window.dispatchEvent(new Event('offline'));
  });
  await expect(page.locator('#totalCalories')).toHaveText('130');
  await expect(page.locator('#connection')).toContainText('Offline');
  await page.locator('#previousDay').click(); await expect(page.locator('#totalCalories')).toHaveText('260');
  await importCSV(Buffer.from(toCSV([oldMeal])));
  await expect(page.locator('#message')).toContainText('1 Mahlzeit(en) importiert');
  await page.locator('#settings summary').click();
  await page.locator('#forgetKey').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('didi-api-key')), null);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(r => r.url)))).flat();
  });
  assert.ok(cached.length >= 10); assert.ok(cached.every(url => !url.includes('openai.com')));
  assert.deepEqual(localAPI, []); assert.deepEqual(errors, []);
  console.log('PWA tests passed: static subpath, direct API, key settings, local save, date navigation, CSV import/export, errors, responsive layout, offline reload with server stopped.');
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
