import { chromium } from 'playwright';
const b = await chromium.launch(); const ctx = await b.newContext({ storageState: '../state-admin.json', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
await p.goto('http://localhost:4200/admin/students', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
await p.locator('main').evaluate((m) => m.scrollTo(0, m.scrollHeight)); await p.waitForTimeout(400);
const dock = await p.locator('.page-actions__dock').boundingBox();
const main = await p.locator('main').evaluate((m) => { const c = [...m.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().height > 0 && e.children.length === 0 && !e.closest('.page-actions__dock')); const last = c.reduce((a, e) => (e.getBoundingClientRect().bottom > a ? e.getBoundingClientRect().bottom : a), 0); return { last, pb: getComputedStyle(m).paddingBottom, bottom: m.getBoundingClientRect().bottom }; });
console.log('dock', dock, main);
await p.screenshot({ path: '../s3-dock-m.png' }); await b.close();
