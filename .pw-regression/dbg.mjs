import { chromium } from 'playwright';
const b = await chromium.launch(); const ctx = await b.newContext({ storageState: '../state-admin.json', viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
await p.goto('http://localhost:4200/admin/changes', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
const t = await p.locator('.p-select:visible').all(); console.log('selects', t.length);
try { await t[0].click({ timeout: 2000 }); await p.waitForTimeout(400); console.log('overlay els', await p.locator('.p-select-overlay, .p-overlay').count()); } catch (e) { console.log('ERR', e.message.split('\n')[0]); }
console.log('layered primeng styles', await p.evaluate(() => [...document.querySelectorAll('style')].filter(s => s.textContent.includes('@layer primeng')).length));
await b.close();
