import { chromium } from 'playwright';
const [state, out, tag] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, h, vt] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const W = (ms = 700) => p.waitForTimeout(ms);
  await p.goto('http://localhost:4200/admin/meals', { waitUntil: 'networkidle' }); await W(1800);
  console.log(vt, p.url().includes('/login') ? '登出了' : 'ok', 'overlay', await p.locator('vite-error-overlay').count());
  await p.screenshot({ path: `${out}/${tag}-${vt}-list.png`, fullPage: true });
  try { await p.getByRole('button', { name: /月結|結算|開帳/ }).first().click(); const d = p.locator('.p-dialog:visible').last(); await d.waitFor(); await W(900); await d.screenshot({ path: `${out}/${tag}-${vt}-billing.png` }); console.log(vt, 'billing ok'); } catch (e) { console.log(vt, 'billing FAIL', e.message.split('\n')[0]); }
  await ctx.close();
}
await b.close();
