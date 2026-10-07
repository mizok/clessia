// 拋棄式（#991 grades G1）：考試列表（新版全頁）＋三支 dialog（前後比對）。不進 repo。
import { chromium } from 'playwright';
const [state, out, tag] = process.argv.slice(2);
const b = await chromium.launch(); const errs = [];
const W = (p, ms = 600) => p.waitForTimeout(ms);
const shot = async (p, name) => {
  const d = p.locator('.p-dialog:visible').last(); await d.waitFor({ timeout: 6000 }); await W(p, 500);
  await d.screenshot({ path: `${out}/${tag}-${name}.png` }); console.log(name, 'ok', Math.round((await d.boundingBox()).height));
};
const close = async (p) => {
  for (let i = 0; i < 3 && (await p.locator('.p-dialog:visible').count()); i++) {
    const d = p.locator('.p-dialog:visible').last();
    await d.getByRole('button', { name: /取消|關閉|Close/ }).first().click({ timeout: 2000 }).catch(() => {});
    await W(p, 400);
    if (await p.locator('.p-dialog:visible').count()) { await p.keyboard.press('Escape'); await W(p, 400); }
  }
};
for (const [w, h, vt] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => localStorage.removeItem('clessia.campusContext'));
  const p = await ctx.newPage(); p.setDefaultTimeout(8000); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:4200/admin/grades/exams', { waitUntil: 'networkidle' }); await W(p, 1200);
  console.log(vt, 'overlay', await p.locator('vite-error-overlay').count(), 'title', (await p.locator('h1').first().innerText()).replace(/\n/g, ' '));
  await p.screenshot({ path: `${out}/${tag}-${vt}-page.png`, fullPage: true });
  for (const [label, name] of [['新增補習班考試', 'academy-form'], ['新增學校考試', 'school-form']]) {
    try {
      await p.getByRole('button', { name: '新增考試' }).first().click(); await W(p, 400);
      await p.getByRole('menuitem', { name: label }).click(); await shot(p, `${vt}-${name}`);
    } catch (e) { console.log(vt, name, 'FAIL', e.message.split('\n')[0]); }
    await close(p);
  }
  if (vt === 'm') {
    await p.getByRole('button', { name: /^篩選/ }).first().click().then(() => shot(p, 'm-filter')).catch((e) => console.log('m-filter FAIL', e.message.split('\n')[0]));
    await close(p);
  }
  await ctx.close();
}
console.log('console errors', errs.length, errs.slice(0, 3)); await b.close();
