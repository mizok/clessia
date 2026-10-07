import { chromium } from 'playwright';
const [state, out] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, h, vt] of [[1280, 800, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  await p.goto('http://localhost:4200/admin/fee-templates', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  console.log(vt, new URL(p.url()).pathname, 'tr', await p.locator('tbody tr, app-responsive-table li, app-responsive-table [role=row]').count());
  const txt = (await p.locator('body').innerText());
  console.log(vt, '報名文案', JSON.stringify([...txt.matchAll(/\d+ 筆報名(?:在此期間)?|沒有報名在此期間/g)].map((m) => m[0])));
  await p.screenshot({ path: `${out}/f14-${vt}.png`, fullPage: true });
  await ctx.close();
}
await b.close();
