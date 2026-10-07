// 拋棄式（#1138 changes）：異動頁分校跟頂欄走。不進 repo。
import { chromium } from 'playwright';
const [state, out] = process.argv.slice(2);
const b = await chromium.launch(); const errs = [];
for (const [w, h, vt] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => localStorage.removeItem('clessia.campusContext'));
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const qs = []; p.on('request', (r) => r.url().includes('/api/reports') && qs.push(new URL(r.url()).searchParams.get('campusId')));
  await p.goto('http://localhost:4200/admin/reports', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  console.log(vt, p.url().includes('/login') ? '登出了' : 'ok', 'overlay', await p.locator('vite-error-overlay').count(), '頁內分校欄', await p.getByText('分校', { exact: true }).count());
  await p.screenshot({ path: `${out}/rp-${vt}-all.png` });
  const top = p.locator('[popovertarget="shell-campus"]:visible').first();
  console.log(vt, '頂欄分校鈕', await top.count());
  try {
    await top.click(); await p.waitForTimeout(400);
    const opt = p.locator('#shell-campus button').nth(1);
    const name = (await opt.innerText()).trim(); await opt.click(); await p.waitForTimeout(1500);
    console.log(vt, '選了', name, '請求 campusId', qs.map((q) => q ?? '∅').join(','));
    await p.screenshot({ path: `${out}/rp-${vt}-one.png` });
  } catch (e) { console.log(vt, 'switch FAIL', e.message.split('\n')[0]); }
  await ctx.close();
}
console.log('console errors', errs.length, errs.slice(0, 3)); await b.close();
