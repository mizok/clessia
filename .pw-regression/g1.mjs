import { chromium } from 'playwright';
const [state, out] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, h, vt] of [[1280, 800, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  await p.goto('http://localhost:4200/admin/grades/exams', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  console.log(vt, new URL(p.url()).pathname);
  const titles = await p.locator('[title]').evaluateAll((els) => els.map((e) => e.getAttribute('title')).filter((t) => t && t.length > 4).slice(0, 6));
  console.log(vt, 'title', JSON.stringify(titles));
  const txt = await p.locator('body').innerText();
  console.log(vt, '含「個班」', (txt.match(/\d+ 個班/g) ?? []).length, '含「等 N 個班」', (txt.match(/等 \d+ 個班/g) ?? []).length);
  await p.screenshot({ path: `${out}/g1-${vt}.png`, fullPage: true });
  await ctx.close();
}
await b.close();
