import { chromium } from 'playwright';
const [url, out, w, h, click] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext({ storageState: '../state-admin.json', viewport: { width: +w, height: +h }, deviceScaleFactor: 1 }); const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });
await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
if (click && click !== '-') { await p.locator(click).first().click(); await p.waitForTimeout(600); }
await p.screenshot({ path: out, fullPage: process.env.FULL === '1' });
await b.close();
