// 拋棄式（#991 家長端 P2）：attendance＋grades 前後截圖。不進 repo。
import { chromium } from 'playwright';
const [state, out, tag] = process.argv.slice(2);
const KID = process.env.KID ?? '張宇軒';
const b = await chromium.launch();
for (const [w, h, vt] of [[1280, 800, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  await p.route('**/api/me/grades*', async (r) => { const res = await r.fetch(); const j = await res.json(); const arr = j.data ?? j; (Array.isArray(arr) ? arr : []).slice(0, 3).forEach((x, i) => { x.description = i === 0 ? '範圍：第一章到第三章\n第二行：請帶計算機\n\n空一行後的第四行' : '單行描述' + i; }); await r.fulfill({ response: res, json: j }); });
  for (const [name, path, rec, exp] of [['att', '/parent/attendance', '.attendance__record', '.attendance__record'], ['gr', '/parent/grades', '.grades__record', 'summary.grades__record']]) {
    await p.goto('http://localhost:4200' + path, { waitUntil: 'networkidle' });
    await p.addStyleTag({ content: 'app-flow-field{visibility:hidden!important}' });
    await p.waitForTimeout(1500);
    const sw = p.locator('button.child-switcher__badge--interactive');
    if (await sw.count() && !(await sw.innerText()).includes(KID)) { await sw.click(); await p.locator('.child-switcher__list-item', { hasText: KID }).click(); await p.waitForTimeout(1500); }
    if (name === 'att') { await p.getByText('近30天').click(); await p.waitForTimeout(1500); }
    console.log(vt, name, new URL(p.url()).pathname, '列', await p.locator(rec).count(), 'h1', await p.locator('h1').first().innerText());
    await p.screenshot({ path: `${out}/${tag}-${vt}-${name}.png`, fullPage: true });
    const e = p.locator(exp).first();
    if (await e.count()) { await e.click(); await p.waitForTimeout(400); await p.screenshot({ path: `${out}/${tag}-${vt}-${name}-open.png`, fullPage: true }); }
  }
  await ctx.close();
}
await b.close();
