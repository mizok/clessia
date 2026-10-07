// 拋棄式（#991 sessions dialogs）：課表 dialog 逐支截圖 before/after。不進 repo。
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
    const btn = d.locator('.p-dialog-close-button, [aria-label=關閉], [aria-label=Close], .dialog-header-inline__close').first();
    if (await btn.count()) await btn.click({ timeout: 2000 }).catch(() => {});
    else await d.getByRole('button', { name: /取消|關閉/ }).first().click({ timeout: 2000 }).catch(() => {});
    await W(p, 400);
    if (await p.locator('.p-dialog:visible').count()) { await p.keyboard.press('Escape'); await W(p, 400); }
  }
};
// 桌機：找下週有「調課」選單的課塊
{
  const ctx = await b.newContext({ storageState: state, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:4200/admin/sessions', { waitUntil: 'networkidle' }); await W(p, 1200);
  console.log('overlay', await p.locator('vite-error-overlay').count());
  await p.getByRole('button', { name: '操作紀錄' }).first().click().then(() => shot(p, 'oplog')).catch((e) => console.log('oplog FAIL', e.message.split('\n')[0])); await close(p);
  await p.getByRole('button', { name: '下一週' }).click(); await W(p, 1000);
  let found = null;
  for (const day of ['週一', '週二', '週三', '週四', '週五', '週六']) {
    await p.locator('button:visible', { hasText: day }).first().click(); await W(p, 1000);
    const blocks = p.locator('button[aria-label$="看看能做什麼"]:visible');
    for (let i = 0; i < (await blocks.count()); i++) {
      await blocks.nth(i).click(); await W(p, 400);
      const items = await p.getByRole('menuitem').allInnerTexts();
      if (items.some((t) => t.includes('調課'))) { found = items; break; }
      await p.keyboard.press('Escape'); await W(p, 300);
    }
    if (found) break;
  }
  console.log('menu', found?.map((s) => s.trim()).join('/'));
  if (found) {
    const viaMenu = async (label, name) => {
      try {
        if (!(await p.getByRole('menuitem').count())) { await p.locator('button[aria-label$="看看能做什麼"]:visible').first().click(); await W(p, 400); }
        await p.getByRole('menuitem', { name: label }).click(); await shot(p, name);
      } catch (e) { console.log(name, 'FAIL', e.message.split('\n')[0], 'dialogs', await p.locator('.p-dialog:visible').count()); }
      await close(p);
    };
    await viaMenu('查看異動紀錄', 'detail');
    await viaMenu('調課', 'reschedule');
    await viaMenu('代課', 'substitute');
    await viaMenu('停課', 'cancel');
  }
  await ctx.close();
}
// 手機：篩選對話框
{
  const ctx = await b.newContext({ storageState: state, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:4200/admin/sessions', { waitUntil: 'networkidle' }); await W(p, 1200);
  await p.getByRole('button', { name: /^篩選/ }).first().click().then(() => shot(p, 'm-filter')).catch((e) => console.log('m-filter FAIL', e.message.split('\n')[0]));
  await ctx.close();
}
console.log('console errors', errs.length, errs.slice(0, 3)); await b.close();
