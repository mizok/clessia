import { chromium } from 'playwright';
const [state, out, tag] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, h, vt] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const W = (ms = 700) => p.waitForTimeout(ms);
  for (const name of ['campuses', 'schools', 'subjects', 'general']) {
    await p.goto('http://localhost:4200/admin/settings/' + name, { waitUntil: 'networkidle' }); await W(1500);
    console.log(vt, name, p.url().includes('/login') ? '登出了' : new URL(p.url()).pathname, 'overlay', await p.locator('vite-error-overlay').count());
    await p.screenshot({ path: `${out}/${tag}-${vt}-${name}.png`, fullPage: true });
  }
  const dlg = async (name, fn) => { try { await fn(); const d = p.locator('.p-dialog:visible').last(); await d.waitFor(); await W(700); await d.screenshot({ path: `${out}/${tag}-${vt}-${name}.png` }); console.log(vt, name, 'ok'); } catch (e) { console.log(vt, name, 'FAIL', e.message.split('\n')[0]); } const c = p.locator('.p-dialog:visible .dialog-header-inline__close, .p-dialog:visible [aria-label=Close]').first(); if (await c.count()) await c.click().catch(()=>{}); await W(500); };
  await p.goto('http://localhost:4200/admin/settings/campuses', { waitUntil: 'networkidle' }); await W(1200);
  await dlg('campus-new', () => p.getByRole('button', { name: /新增分校/ }).first().click());
  await p.goto('http://localhost:4200/admin/settings/schools', { waitUntil: 'networkidle' }); await W(1200);
  await dlg('school-new', () => p.getByRole('button', { name: /新增學校/ }).first().click());
  await ctx.close();
}
await b.close();
