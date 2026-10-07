import { chromium } from 'playwright';
const b = await chromium.launch(); const ctx = await b.newContext({ storageState: '../state-p2.json', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
await p.goto('http://localhost:4200/parent/grades', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
console.log('expandable', await p.locator('details.grades__item').count(), 'plain', await p.locator('div.grades__record').count());
const d = p.locator('details.grades__item summary').first();
if (await d.count()) { await d.click(); await p.waitForTimeout(300); }
await p.screenshot({ path: '../g1076.png' });
await b.close();
