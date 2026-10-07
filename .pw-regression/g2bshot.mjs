// 拋棄式（#991 grades G2b）：學校考試成績頁＋逐人對話框。不進 repo。
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [state, out, tag, urlsFile] = process.argv.slice(2);
const url = JSON.parse(readFileSync(urlsFile, 'utf8')).school;
const b = await chromium.launch(); const errs = [];
for (const [w, h, vt] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:4200' + url, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  const rows = p.locator('[data-part=row], .school-score-editor__row');
  for (let i = 0; i < 8 && !(await rows.count()); i++) {
    await p.locator('p-select:visible').first().click(); await p.waitForTimeout(400);
    const opts = p.getByRole('option');
    if (i >= (await opts.count())) { await p.keyboard.press('Escape'); break; }
    await opts.nth(i).click(); await p.waitForTimeout(1200);
  }
  console.log(vt, 'overlay', await p.locator('vite-error-overlay').count(), 'rows', await rows.count());
  await p.screenshot({ path: `${out}/${tag}-${vt}-school.png` });
  if (await rows.count()) {
    await rows.first().click(); await p.waitForTimeout(1000);
    const d = p.locator('.p-dialog:visible, .p-drawer:visible').last();
    if (await d.count()) { await d.screenshot({ path: `${out}/${tag}-${vt}-edit.png` }); console.log(vt, 'edit ok'); }
  }
  await ctx.close();
}
console.log('console errors', errs.length, errs.slice(0, 3)); await b.close();
