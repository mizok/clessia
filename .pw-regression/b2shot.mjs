import { chromium } from 'playwright';
const [state, out, tag] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, h, vt] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const W = (ms = 700) => p.waitForTimeout(ms);
  for (const [name, url] of [['leave', '/admin/leave'], ['notif', '/admin/notifications']]) {
    await p.goto('http://localhost:4200' + url, { waitUntil: 'networkidle' }); await W(1500);
    console.log(vt, name, p.url().includes('/login') ? '登出了' : 'ok', 'overlay', await p.locator('vite-error-overlay').count());
    await p.screenshot({ path: `${out}/${tag}-${vt}-${name}.png`, fullPage: true });
  }
  await p.goto('http://localhost:4200/admin/leave', { waitUntil: 'networkidle' }); await W(1200);
  try { await p.getByRole('button', { name: /新增請假/ }).first().click(); const d = p.locator('.p-dialog:visible').last(); await d.waitFor(); await W(800); await d.screenshot({ path: `${out}/${tag}-${vt}-leave-dialog.png` }); console.log(vt, 'dialog ok'); } catch (e) { console.log(vt, 'dialog FAIL', e.message.split('\n')[0]); }
  await ctx.close();
}
await b.close();
