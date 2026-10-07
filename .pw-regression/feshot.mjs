// fee-templates
import { chromium } from 'playwright';
const [state, out, tag] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, h, vt] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const W = (ms = 700) => p.waitForTimeout(ms);
  const dlg = async (name) => { const d = p.locator('.p-dialog:visible').last(); await d.waitFor(); await W(600); await d.screenshot({ path: `${out}/${tag}-${vt}-${name}.png` }); console.log(vt, name, 'ok'); };
  const close = async () => { for (let i = 0; i < 3 && (await p.locator('.p-dialog:visible').count()); i++) { const d = p.locator('.p-dialog:visible').last(); const btn = d.locator('.dialog-header-inline__close, [aria-label=Close], [aria-label=關閉], .p-dialog-close-button').first(); if (await btn.count()) await btn.click(); else await d.getByRole('button', { name: /取消|關閉/ }).first().click().catch(() => {}); await W(500); } };
  await p.goto('http://localhost:4200/admin/fee-templates', { waitUntil: 'networkidle' }); await W(1500);
  console.log(vt, p.url().includes('/login') ? '登出了' : 'ok', 'overlay', await p.locator('vite-error-overlay').count());
  await p.screenshot({ path: `${out}/${tag}-${vt}-list.png`, fullPage: true });
  const step = async (name, fn) => { try { await fn(); await dlg(name); } catch (e) { console.log(vt, name, 'FAIL', e.message.split('\n')[0]); } await close(); };
  await step('tpl-new', () => p.getByRole('button', { name: '新增價目表' }).first().click());
  await step('period-new', () => p.getByRole('button', { name: '新增期間' }).first().click());
  const menu = async (label) => { await p.locator('[aria-label$="的操作"]:visible').first().click(); await W(400); await p.getByRole('menuitem', { name: label }).click(); };
  await step('tpl-edit', () => menu('編輯'));
  await ctx.close();
}
await b.close();
