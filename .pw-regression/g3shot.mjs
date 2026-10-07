import { chromium } from 'playwright';
const [state, out] = process.argv.slice(2);
const b = await chromium.launch(); const errs = [];
for (const [w, h, vt] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const p = await (await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' })).newPage();
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:4200/admin/grades/overview', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  console.log(vt, 'overlay', await p.locator('vite-error-overlay').count(), 'h1', (await p.locator('h1').innerText()).replace(/\s+/g, ''), 'rows', await p.locator('section li').count());
  await p.screenshot({ path: `${out}/g3-${vt}.png` });
}
console.log('console errors', errs.length, errs.slice(0, 3)); await b.close();
