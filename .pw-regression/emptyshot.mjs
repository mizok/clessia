// 拋棄式（#1138 空狀態分校提示）：攔截清單 API 回空，看頂欄選分校前後的空狀態。不進 repo。
import { chromium } from 'playwright';
const [state, out] = process.argv.slice(2);
const b = await chromium.launch(); const errs = [];
const cases = [
  ['changes', /\/api\/sessions\/changes\?/, (j) => ({ ...j, data: [], meta: { ...j.meta, total: 0 } }), 'main'],
  ['staff', /\/api\/staff\?/, (j) => ({ ...j, data: [], meta: { ...j.meta, total: 0 } }), 'main'],
];
for (const [path, re, mut] of cases) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.removeItem('clessia.campusContext'));
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.route(re, async (r) => { const res = await r.fetch(); await r.fulfill({ response: res, json: mut(await res.json()) }); });
  await p.goto('http://localhost:4200/admin/' + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  const note = () => p.locator('app-campus-scope-note').allInnerTexts().then((a) => a.map((s) => s.trim()).filter(Boolean));
  console.log(path, '全部分校 →', JSON.stringify(await note()));
  await p.locator('[popovertarget="shell-campus"]:visible').first().click(); await p.waitForTimeout(300);
  await p.locator('#shell-campus button').nth(1).click(); await p.waitForTimeout(1200);
  console.log(path, '選分校後 →', JSON.stringify(await note()));
  await p.screenshot({ path: `${out}/empty-${path}.png` });
  await ctx.close();
}
console.log('console errors', errs.length, errs.slice(0, 3)); await b.close();
