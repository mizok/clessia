import { chromium } from 'playwright';
const [out, tag] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, h, vt] of [[1440, 900, 'd'], [1000, 800, 't'], [390, 844, 'm'], [1280, 500, 's'], [844, 390, 'l']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  for (const [name, url] of [['login', '/login'], ['trial', '/trial'], ['enroll', '/enrollment'], ['linkline', '/link-line']]) {
    await p.goto('http://localhost:4200' + url, { waitUntil: 'networkidle' }); await p.addStyleTag({ content: 'app-flow-field{visibility:hidden!important}' }); await p.waitForTimeout(600);
    console.log(vt, name, new URL(p.url()).pathname, 'overlay', await p.locator('vite-error-overlay').count());
    await p.screenshot({ path: `${out}/${tag}-${vt}-${name}.png` });
  }
  if (vt === 'd') {
    await p.goto('http://localhost:4200/trial', { waitUntil: 'networkidle' }); await p.addStyleTag({ content: 'app-flow-field{visibility:hidden!important}' }); await p.waitForTimeout(600);
    const links = p.locator('nav a'); const n = await links.count();
    for (let i = 0; i < n; i++) { const t = (await links.nth(i).innerText()).trim(); if (t) { await links.nth(i).hover(); await p.waitForTimeout(400); await p.screenshot({ path: `${out}/${tag}-${vt}-hover${i}.png`, clip: { x: 0, y: 500, width: 700, height: 400 } }); } }
  }
  await ctx.close();
}
await b.close();
