// 拋棄式（#991 grades G2a）：成績登錄外殼＋補習班編輯器、儲存列、離開對話框。不進 repo。
import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
const [state, out, tag] = process.argv.slice(2);
const urlsFile = `${out}/urls2.json`;
const b = await chromium.launch(); const errs = [];
const W = (p, ms = 800) => p.waitForTimeout(ms);
let urls = existsSync(urlsFile) ? JSON.parse(readFileSync(urlsFile, 'utf8')) : null;
if (!urls) {
  const p = await (await b.newContext({ storageState: state, viewport: { width: 1440, height: 900 } })).newPage();
  urls = {};
  for (const [type, label] of [['academy', '補習班考試'], ['school', '學校考試']]) {
    await p.goto('http://localhost:4200/admin/grades/exams', { waitUntil: 'networkidle' }); await W(p);
    await p.getByText(label, { exact: true }).first().click(); await W(p, 1200);
    await p.locator('tr:has-text("進行中") button.exams__name-link, ul[aria-label=考試] li:has-text("進行中") button.text-lg').first().click(); await W(p, 1500);
    urls[type] = new URL(p.url()).pathname;
  }
  writeFileSync(urlsFile, JSON.stringify(urls)); await p.context().close();
}
console.log('urls', JSON.stringify(urls));
for (const [w, h, vt] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  for (const type of ['academy', 'school']) {
    await p.goto('http://localhost:4200' + urls[type], { waitUntil: 'networkidle' }); await W(p, 1500);
    console.log(vt, type, 'overlay', await p.locator('vite-error-overlay').count(), 'h1', (await p.locator('h1').first().innerText()).replace(/\s+/g, ' ').slice(0, 40));
    await p.screenshot({ path: `${out}/${tag}-${vt}-${type}.png`, fullPage: true });
  }
  if (tag === 'after' && vt === 'd') {
    await p.goto('http://localhost:4200' + urls.academy, { waitUntil: 'networkidle' }); await W(p, 1500);
    const input = p.locator('input[aria-label$="的分數"]:visible, td input:visible').first();
    await input.fill('59'); await input.press('Tab'); await W(p, 600);
    console.log('tally', (await p.locator('text=已登錄').first().innerText()).replace(/\s+/g, ' '));
    console.log('savebar', await p.locator('[role=region][aria-label=儲存]').innerText().catch(() => 'none'));
    await p.locator('[role=region][aria-label=儲存]').scrollIntoViewIfNeeded().catch(() => {}); await p.screenshot({ path: `${out}/${tag}-d-dirty.png` });
    await p.getByRole('link', { name: '考試管理' }).first().click(); await W(p, 600);
    console.log('dialog open', await p.locator('dialog[open]').count());
    await p.screenshot({ path: `${out}/${tag}-d-leave.png` });
    await p.getByRole('button', { name: '留下來' }).click(); await W(p, 400);
    console.log('after stay url', new URL(p.url()).pathname.replace(/[0-9a-f-]{36}/, ':id'));
  }
  await ctx.close();
}
console.log('console errors', errs.length, errs.slice(0, 3)); await b.close();
