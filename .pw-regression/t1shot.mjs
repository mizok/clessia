import { chromium } from 'playwright';
const [state, out, tag] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, h, vt] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto('http://localhost:4200/select-role', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  const t = p.locator('.role-picker__option', { hasText: '老師' }); if (await t.count()) { await t.first().click(); await p.waitForTimeout(2000); }
  await p.goto('http://localhost:4200/teacher/students', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  console.log(vt, new URL(p.url()).pathname, 'items', await p.locator('li').count());
  await p.screenshot({ path: `${out}/${tag}-${vt}-list.png`, fullPage: true });
  await p.locator('input[type=search]').fill('zzzzzz'); await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/${tag}-${vt}-empty.png`, fullPage: true });
  await p.locator('input[type=search]').fill(''); await p.locator('input[type=search]').focus(); await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/${tag}-${vt}-focus.png` });
  await ctx.close();
}
await b.close();
