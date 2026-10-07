// 拋棄式（#1138 H1 截圖）：頂欄全站搜尋，真資料（名字）＋攔截（電話）× 1440／390。不進 repo。
import { chromium } from 'playwright';
const [state, out] = process.argv.slice(2);
const b = await chromium.launch();
const errs = [];
for (const [w, h, tag] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:4200/admin/dashboard', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  console.log(tag, 'overlay', await p.locator('vite-error-overlay').count());
  const input = async () => {
    if (tag === 'm') { await p.getByRole('button', { name: '搜尋學生' }).click(); await p.waitForTimeout(300); }
    return p.locator('input[aria-label="全站搜尋"]:visible');
  };
  let i = await input();
  await p.screenshot({ path: `${out}/search-${tag}-empty.png` });
  await i.fill('王'); await p.waitForTimeout(900);
  console.log(' 王 →', await p.locator('[role="option"]:visible').count(), '筆');
  await i.press('ArrowDown'); await p.waitForTimeout(100);
  console.log(' activedescendant', await i.getAttribute('aria-activedescendant'));
  await p.screenshot({ path: `${out}/search-${tag}-name.png` });
  await i.fill('查無此人'); await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/search-${tag}-none.png` });
  // 電話：本機家長 ba_user.phone 全是 NULL，用攔截回一筆帶主要家長電話的
  await p.route(/\/api\/students\?/, async (r) => {
    r.fulfill({ json: { data: [{ id: 'b68e7b0a-eff3-468d-8dc3-e5786cc742f2', name: '王柏睿', isActive: true, parentNames: ['王美玲'], primaryParentPhone: '0912345678' }], summary: { total: 1, activeCount: 1 }, meta: { total: 1, page: 1, pageSize: 6, totalPages: 1 } } });
  });
  await i.fill('5678'); await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/search-${tag}-phone.png` });
  await i.press('Enter'); await p.waitForTimeout(1200);
  console.log(' Enter →', new URL(p.url()).pathname, 'panel open', await p.locator('[popover]:popover-open').count());
  await ctx.close();
}
console.log('console errors', errs.length, errs.slice(0, 3));
await b.close();
