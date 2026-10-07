// 拋棄式（#1174 G2 回歸）：非精簡清單（手機日視圖、篩選結果）的欄寬仍是 44／中／44。不進 repo。
import { chromium } from 'playwright';
const [state, out] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ storageState: state, viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
const cols = () => p.locator('app-schedule-list:visible > section > div').first().evaluate((e) => getComputedStyle(e).gridTemplateColumns);
for (const [name, url] of [['day', '/admin/sessions'], ['results', '/admin/sessions?dateFrom=2026-09-01&dateTo=2026-10-03&attendanceTaken=false&endedOnly=true']]) {
  await p.goto('http://localhost:4200' + url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  if (name === 'day') { await p.locator('nav[aria-label="選擇日期"] button', { hasText: '9/29' }).click(); await p.waitForTimeout(800); }
  console.log(name, await cols(), '⋯', await p.locator('button:visible[aria-label$=" 的操作"]').count());
  await p.screenshot({ path: `${out}/reg-m-${name}.png`, fullPage: true });
}
await b.close();
