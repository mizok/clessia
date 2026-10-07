import { chromium } from 'playwright';
const [state, out] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, h, vt] of [[1280, 800, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  await p.goto('http://localhost:4200/admin/contact-book', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  console.log(vt, new URL(p.url()).pathname);
  const fill = p.getByRole('button', { name: /補寫/ }).first();
  const rows = p.locator('app-responsive-table tbody tr').first();
  const target = (await fill.count()) ? fill : (await p.getByRole('button', { name: /編輯|查看|撰寫/ }).first());
  console.log(vt, '入口', await target.count());
  await target.click(); await p.waitForTimeout(800);
  const reason = p.locator('.entry-dialog__disabled-reason');
  console.log(vt, '提示', await reason.count(), JSON.stringify(await reason.first().innerText().catch(() => null)), '鈕disabled', await p.locator('.entry-dialog__footer button').last().isDisabled());
  await p.screenshot({ path: `${out}/cb6-${vt}-off.png` });
  await p.locator('#cb-content').fill('今天上課狀況良好'); await p.waitForTimeout(300);
  console.log(vt, '輸入後提示', await reason.count(), '鈕disabled', await p.locator('.entry-dialog__footer button').last().isDisabled());
  await p.screenshot({ path: `${out}/cb6-${vt}-on.png` });
  await ctx.close();
}
await b.close();
