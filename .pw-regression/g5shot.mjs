import { chromium } from 'playwright';
const [state, out] = process.argv.slice(2);
const b = await chromium.launch(); const errs = [];
for (const [w, h, vt] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => localStorage.removeItem('clessia.campusContext'));
  const p = await ctx.newPage(); p.setDefaultTimeout(8000); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:4200/admin/grades/overview/student', { waitUntil: 'networkidle' }); await p.waitForTimeout(1800);
  console.log(vt, 'overlay', await p.locator('vite-error-overlay').count(), 'h1', (await p.locator('h1').innerText()).replace(/\s+/g, ''), 'rows', await p.locator('[data-part=student-row]').count(), 'chapters', await p.locator('[data-part=grade-chapter]').count());
  await p.screenshot({ path: `${out}/g5-${vt}.png` });
  try { await p.locator('[data-part=student-row]').first().click(); await p.waitForTimeout(1500); await p.locator('.p-dialog:visible').last().screenshot({ path: `${out}/g5-${vt}-dlg.png` }); console.log(vt, 'dialog ok'); } catch (e) { console.log(vt, 'dialog FAIL', e.message.split('\n')[0]); }
  await ctx.close();
}
console.log('console errors', errs.length, errs.slice(0, 3)); await b.close();
