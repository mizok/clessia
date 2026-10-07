import { chromium } from 'playwright';
const [state, out, tag] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, h, vt] of [[390, 844, 'm'], [640, 800, 'w640'], [700, 800, 'w700'], [720, 800, 'w720'], [1000, 800, 'w1000'], [1440, 900, 'd']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  await p.goto('http://localhost:4200/select-role', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  const t = p.locator('.role-picker__option', { hasText: '老師' }); if (await t.count()) { await t.first().click(); await p.waitForTimeout(2000); }
  await p.goto('http://localhost:4200/teacher/schedule', { waitUntil: 'networkidle' }); await p.waitForTimeout(1800);
  await p.addStyleTag({ content: 'app-flow-field{visibility:hidden!important}' }); await p.waitForTimeout(400);
  const path = new URL(p.url()).pathname;
  const info = await p.evaluate(() => ({ track: !!document.querySelector('.schedule-page__track'), days: document.querySelectorAll('.schedule-page__track > section').length, weekbar: (() => { const e = document.querySelector('.schedule-page__weekbar'); return e ? getComputedStyle(e).display : 'none-el'; })(), sessions: document.querySelectorAll('.schedule-page__session').length }));
  console.log(vt, path, JSON.stringify(info));
  await p.screenshot({ path: `${out}/${tag}-${vt}-idle.png`, fullPage: true });
  // 實際橫捲：捲到第 3 天、再回今天
  const tr = p.locator('.schedule-page__track');
  if (await tr.count()) {
    await tr.evaluate((el) => { el.scrollTo({ left: el.clientWidth * 2, behavior: 'instant' }); });
    await p.waitForTimeout(600);
    console.log(vt, 'scrollLeft', await tr.evaluate((el) => Math.round(el.scrollLeft) + '/' + el.clientWidth));
    await p.screenshot({ path: `${out}/${tag}-${vt}-scrolled.png`, fullPage: true });
    await tr.evaluate((el) => { el.scrollTo({ left: el.clientWidth * 4, behavior: 'instant' }); }); await p.waitForTimeout(600);
    await p.screenshot({ path: `${out}/${tag}-${vt}-scrolled4.png`, fullPage: true });
  }
  await ctx.close();
}
await b.close();
