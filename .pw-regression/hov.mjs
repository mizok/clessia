import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [w,h] of [[1440,900],[390,844]]) {
  const ctx = await b.newContext({ storageState: '../state-admin.json', viewport:{width:w,height:h} });
  const p = await ctx.newPage();
  await p.goto('http://localhost:4200/admin/students', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const el = p.locator('.students__search-input');
  const c = () => el.evaluate((e) => getComputedStyle(e).borderTopColor);
  const rest = await c(); await el.hover(); await p.waitForTimeout(300);
  console.log(w, 'rest', rest, 'hover', await c());
}
await b.close();
