// 拋棄式（#991 payments）：列表＋四支 dialog × 1440／390。不進 repo。
import { chromium } from 'playwright';
const [state, out, tag] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, h, vt] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const W = (ms = 700) => p.waitForTimeout(ms);
  const dlg = async (name) => { const d = p.locator('.p-dialog:visible').last(); await d.waitFor(); await W(500); await d.screenshot({ path: `${out}/${tag}-${vt}-${name}.png` }); console.log(vt, name, 'ok'); };
  const close = async () => { for (let i = 0; i < 3 && (await p.locator('.p-dialog:visible').count()); i++) { const d = p.locator('.p-dialog:visible').last(); const btn = d.locator('.dialog-header-inline__close, [aria-label=Close], [aria-label=關閉], .p-dialog-close-button').first(); if (await btn.count()) await btn.click(); else await d.getByRole('button', { name: /取消|關閉/ }).first().click().catch(() => {}); await W(500); } };
  await p.goto('http://localhost:4200/admin/payments', { waitUntil: 'networkidle' }); await W(1500);
  console.log(vt, p.url().includes('/login') ? '登出了' : 'ok', 'overlay', await p.locator('vite-error-overlay').count());
  await p.screenshot({ path: `${out}/${tag}-${vt}-list.png`, fullPage: true });
  const step = async (name, fn) => { try { await fn(); await dlg(name); } catch (e) { console.log(vt, name, 'FAIL', e.message.split('\n')[0]); } await close(); };
  await step('create', () => p.getByRole('button', { name: /開立帳單|手動開帳|新增/ }).first().click());
  await step('uninvoiced', () => p.getByRole('button', { name: /待開帳|開帳|查看/ }).first().click());
  await step('detail', () => p.locator('tr[role=button]').first().click());
  await p.locator('tr[role=button]').first().click(); await W(1000);
  await step('pay', () => p.getByRole('button', { name: /記錄收款|收款/ }).first().click());
  await ctx.close();
}
await b.close();
