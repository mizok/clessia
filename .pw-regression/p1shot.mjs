// 拋棄式（#991 家長端 P1）：switcher＋dashboard 前後截圖。不進 repo。
import { chromium } from 'playwright';
const [state, out, tag] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, h, vt] of [[1280, 800, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  await p.goto('http://localhost:4200/parent/dashboard', { waitUntil: 'networkidle' });
  await p.addStyleTag({ content: 'app-flow-field{visibility:hidden!important}' });
  await p.waitForTimeout(1200);
  console.log(vt, new URL(p.url()).pathname, 'badge', await p.locator('.child-switcher__badge').count());
  const m = async (sel) => { const e = p.locator(sel).first(); return (await e.count()) ? await e.evaluate((n) => { const r = n.getBoundingClientRect(); return [Math.round(r.width*10)/10, Math.round(r.height*10)/10]; }) : null; };
  console.log(vt, 'badge', JSON.stringify(await m('.child-switcher__badge')), 'band', JSON.stringify(await m('app-page-band')), 'h1', JSON.stringify(await m('h1')));
  await p.screenshot({ path: `${out}/${tag}-${vt}-dash.png` });
  const btn = p.locator('button.child-switcher__badge--interactive');
  if (await btn.count()) { await btn.click(); await p.waitForTimeout(500);
    console.log(vt, 'items', JSON.stringify(await m('.child-switcher__list-item')), 'list', JSON.stringify(await m('.child-switcher__list')));
    await p.screenshot({ path: `${out}/${tag}-${vt}-pop.png` }); }
  await ctx.close();
}
await b.close();
