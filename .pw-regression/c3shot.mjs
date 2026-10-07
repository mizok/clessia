// 拋棄式（#991 courses C3）：courses 目錄 dialog 逐支截圖 × 1440／390。不進 repo。
import { chromium } from 'playwright';
const [state, out, tagp] = process.argv.slice(2);
const b = await chromium.launch();
const errs = [];
const W = (p, ms = 700) => p.waitForTimeout(ms);
for (const [w, h, vt] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const shot = async (name) => {
    const d = p.locator('.p-dialog:visible').last();
    await d.waitFor({ timeout: 5000 });
    await W(p, 500);
    await d.screenshot({ path: `${out}/${tagp}-${vt}-${name}.png` });
    console.log(vt, name, 'ok', Math.round((await d.boundingBox()).height));
  };
  const close = async () => {
    for (let i = 0; i < 3 && (await p.locator('.p-dialog:visible').count()); i++) {
      const d = p.locator('.p-dialog:visible').last();
      const btn = d.locator('.dialog-header-inline__close, [aria-label=Close], [aria-label=關閉], .p-dialog-close-button').first();
      if (await btn.count()) await btn.click(); else await d.getByRole('button', { name: '取消' }).first().click().catch(() => p.keyboard.press('Escape'));
      await W(p, 500);
    }
  };
  const step = async (name, fn) => { p.setDefaultTimeout(8000); try { await fn(); await shot(name); } catch (e) { console.log(vt, name, 'FAIL', e.message.split('\n')[0]); } await close(); };
  await p.goto('http://localhost:4200/admin/courses', { waitUntil: 'networkidle' }); await W(p, 1200);
  console.log(vt, p.url().includes('/login') ? '登出了' : 'ok', 'overlay', await p.locator('vite-error-overlay').count());
  await step('course-new', () => p.getByRole('button', { name: '新增課程' }).first().click());
  await step('course-edit', () => p.locator('[aria-label^="編輯 "]:visible').first().click());
  await step('class-new', () => p.locator('[aria-label^="在 "]:visible').first().click());
  if (!(await p.locator('app-class-row:visible').count())) { await p.locator('button[aria-expanded=false]:visible').first().click(); await W(p, 800); }
  const menu = async (label) => { await p.locator('app-class-row:visible').first().locator('button').last().dispatchEvent('click'); await W(p, 400); await p.getByRole('menuitem', { name: label }).click(); };
  await step('class-edit', () => menu('編輯班級'));
  await step('generate', () => menu('產生課堂'));
  await step('deactivate', () => menu('停用班級'));
  try { await p.locator('[aria-label="前往班級詳情"]:visible').first().dispatchEvent('click'); } catch (e) { console.log(vt, 'nav FAIL', e.message.split('\n')[0]); await ctx.close(); continue; }
  await W(p, 1500);
  console.log(vt, 'class', new URL(p.url()).pathname.replace(/[0-9a-f-]{36}/g, ':id'));
  await step('student-picker', () => p.getByRole('button', { name: '加入學生' }).click());
  await step('copy-roster', () => p.getByRole('button', { name: '複製名單' }).click());
  await step('roster-import', () => p.getByRole('button', { name: 'Excel 匯入' }).click());
  for (let i = 1; i < 8 && !(await p.locator('[data-part=student]').count()); i++) {
    await p.goto('http://localhost:4200/admin/courses', { waitUntil: 'networkidle' }); await W(p, 1000);
    const navs = p.locator('[aria-label="前往班級詳情"]:visible');
    if (i >= (await navs.count())) break;
    await navs.nth(i).dispatchEvent('click'); await W(p, 1500);
  }
  console.log(vt, 'roster', await p.locator('[data-part=student]').count(), 'masks', await p.locator('.p-overlay-mask:visible').count());
  try {
    await p.locator('[data-part=student] button').first().dispatchEvent('click'); await W(p, 400);
    await p.getByRole('menuitem', { name: '計費設定' }).click();
    await shot('billing');
    await p.getByRole('button', { name: '記錄一次購買' }).click().catch(() => console.log(vt, 'no 記錄一次購買（非堂數制）'));
    await W(p, 600);
    if (await p.locator('.p-dialog:visible').count() > 1) await shot('session-pack');
  } catch (e) { console.log(vt, 'billing FAIL', e.message.split('\n')[0]); }
  await ctx.close();
}
console.log('console errors', errs.length, errs.slice(0, 3));
await b.close();
