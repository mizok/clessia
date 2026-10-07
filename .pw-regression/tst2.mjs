import { chromium } from 'playwright';
const [state, out] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, h, vt] of [[390, 844, 'm'], [1280, 800, 'd']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  await p.goto('http://localhost:4200/teacher/students', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  console.log(vt, new URL(p.url()).pathname, 'li', await p.locator('li').count());
  await p.locator('input[type=search]').fill('不存在的名字'); await p.waitForTimeout(300);
  const btn = p.locator('.clear-filters');
  console.log(vt, '按鈕', await btn.count(), JSON.stringify(await btn.evaluate((n) => { const r = n.getBoundingClientRect(); return [r.width, r.height]; })));
  await p.screenshot({ path: `${out}/tst2-${vt}-empty.png` });
  await btn.click(); await p.waitForTimeout(300);
  console.log(vt, '清除後 li', await p.locator('li').count(), '搜尋框', JSON.stringify(await p.locator('input[type=search]').inputValue()), '按鈕', await p.locator('.clear-filters').count());
  await p.screenshot({ path: `${out}/tst2-${vt}-cleared.png` });
  await ctx.close();
}
await b.close();
