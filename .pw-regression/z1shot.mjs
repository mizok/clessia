// 拋棄式（#991 Z1）：filter-chip／collapsible／todo-banner／ime-filter-input／student-autocomplete 前後截圖。不進 repo。
import { chromium } from 'playwright';
const [state, out, tag] = process.argv.slice(2);
const b = await chromium.launch();
const log = (...a) => console.log(...a);
async function open(p, url) {
  await p.goto('http://localhost:4200' + url, { waitUntil: 'networkidle' });
  await p.addStyleTag({ content: 'app-flow-field{visibility:hidden!important}' });
  await p.waitForTimeout(1200);
  log(url, '→', new URL(p.url()).pathname);
}
const shot = (p, n) => p.screenshot({ path: `${out}/${tag}-${n}.png` });
async function newPage(w, h) {
  const ctx = await b.newContext({
    storageState: state,
    viewport: { width: w, height: h },
    reducedMotion: 'reduce',
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  return p;
}
// 桌機
let p = await newPage(1280, 800);
await open(p, '/admin/contact-book');
log(
  'chip',
  await p.locator('app-filter-chip').count(),
  'ac',
  await p.locator('app-student-autocomplete').count(),
);
await shot(p, 'cb-chip-off');
await p.locator('app-filter-chip button').click();
await p.waitForTimeout(600);
await shot(p, 'cb-chip-on');
await p.locator('app-filter-chip button').hover();
await p.waitForTimeout(300);
await shot(p, 'cb-chip-on-hover');
await p.locator('app-filter-chip button').click();
await p.waitForTimeout(400);
await p.locator('app-student-autocomplete input').click();
await p.locator('app-student-autocomplete input').pressSequentially('王', { delay: 80 });
await p.waitForTimeout(1200);
log('ac items', await p.locator('.student-autocomplete__item').count());
await shot(p, 'cb-ac-open');
await open(p, '/admin/fee-templates');
log('chip', await p.locator('app-filter-chip').count());
await shot(p, 'fee-chip-off');
await p.locator('app-filter-chip button').click();
await p.waitForTimeout(600);
await shot(p, 'fee-chip-on');
await open(p, '/admin/dashboard');
log('collapsible', await p.locator('app-collapsible').count());
await shot(p, 'dash-open');
for (const id of ['dashboard-timeline', 'dashboard-arrived']) {
  const t = p.locator(`[aria-controls="${id}"]`).first();
  if (await t.count()) {
    await t.click();
    await p.waitForTimeout(700);
    await shot(p, `dash-${id}-collapsed`);
    await t.click();
    await p.waitForTimeout(700);
  } else log('no toggle for', id);
}
await open(p, '/admin/payments');
log(
  'banner',
  await p.locator('app-todo-banner button').count(),
  await p
    .locator('app-todo-banner')
    .innerText()
    .catch(() => ''),
);
await shot(p, 'pay-banner');
if (await p.locator('app-todo-banner button').count()) {
  await p.locator('app-todo-banner button').hover();
  await p.waitForTimeout(300);
  await shot(p, 'pay-banner-hover');
}
await open(p, '/admin/meals');
log('ac meals', await p.locator('app-student-autocomplete').count());
await shot(p, 'meals');
await p.context().close();
// 手機
p = await newPage(390, 844);
await open(p, '/admin/sessions');
await shot(p, 'sess-m');
const btns = await p
  .locator('button:visible')
  .evaluateAll((els) =>
    els
      .map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 14))
      .filter(Boolean),
  );
log('mobile buttons', JSON.stringify(btns.slice(0, 30)));

// dialogs（桌機）
p = await newPage(1280, 800);
async function dlg(url, trigger, name, after) {
  p = await newPage(1280, 800);
  await open(p, url);
  await p.getByRole('button', { name: trigger }).first().click(); await p.waitForTimeout(900);
  if (after) await after();
  await p.waitForTimeout(500);
  const d = (await p.locator('.p-dialog:visible').count()) ? p.locator('.p-dialog:visible').last() : p.locator('body');
  log(name, 'dialog', await d.count(), JSON.stringify(await d.boundingBox()));
  await d.screenshot({ path: `${out}/${tag}-${name}.png` });
  await p.context().close();
}
const typeAc = async () => { const inDlg = p.locator('.p-dialog:visible app-student-autocomplete input'); const i = (await inDlg.count()) ? inDlg.first() : p.locator('app-student-autocomplete:visible input').first(); await i.click(); await i.pressSequentially('王', { delay: 80 }); await p.waitForTimeout(1200); log('ac items', await p.locator('.student-autocomplete__item').count()); };
await dlg('/admin/sessions', '進階篩選', 'sess-adv');
await dlg('/admin/dashboard', '接到電話：請假', 'phone-leave', typeAc);
await dlg('/admin/leave', '新增請假', 'leave-form', typeAc);
await dlg('/admin/payments', '手動開帳', 'invoice-form', typeAc);
await p.context().close();
// 手機 sessions 篩選 dialog
p = await newPage(390, 844);
await open(p, '/admin/sessions');
await p.getByRole('button', { name: '篩選', exact: true }).click(); await p.waitForTimeout(900);
await shot(p, 'sess-m-filter');
await p.getByText('所有課程', { exact: true }).first().click(); await p.waitForTimeout(700);
await shot(p, 'sess-m-filter-open');
await p.locator('app-ime-filter-input:visible input').first().pressSequentially('數', { delay: 80 }); await p.waitForTimeout(600);
await shot(p, 'sess-m-filter-typed');
await b.close();
