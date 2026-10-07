// 拋棄式（#991 家長端 P3）：payments 前後截圖，含各狀態的明細抽屜。不進 repo。
import { chromium } from 'playwright';
const [state, out, tag] = process.argv.slice(2);
const KID = process.env.KID ?? '張宇軒';
const b = await chromium.launch();
for (const [w, h, vt] of [[1280, 800, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  await p.route('**/api/me/billing*', async (r) => {
    const res = await r.fetch(); const j = await res.json(); const d = j.data; if (d.length < 6) return r.fulfill({ response: res, json: j });
    const pay = (id, amt) => ({ id, kind: 'payment', amount: amt, method: 'transfer', paidAt: '2026-09-20', receiptNo: 1001 });
    d[1].status = 'partial'; d[1].netPaid = 1000; d[1].payments = [pay('p1', 1000)];
    d[2].status = 'paid'; d[2].netPaid = d[2].total; d[2].payments = [pay('p2', d[2].total)];
    d[3].status = 'overrefunded'; d[3].netPaid = -500; d[3].payments = [pay('p3', d[3].total), { ...pay('p4', 500), kind: 'refund' }];
    d[4].status = 'void'; d[4].voidedAt = '2026-09-25T00:00:00Z'; d[4].payments = [];
    d[5].status = 'paid'; d[5].netPaid = d[5].total; d[5].payments = [pay('p5', d[5].total)];
    j.meta.paymentInfo = [{ campusName: '文山旗艦校', text: '台銀 004\n帳號 111-222-333' }, { campusName: '信義校', text: '郵局 700-0012345678901234567890' }];
    await r.fulfill({ response: res, json: j });
  });
  await p.goto('http://localhost:4200/parent/payments', { waitUntil: 'networkidle' });
  await p.addStyleTag({ content: 'app-flow-field{visibility:hidden!important}' });
  await p.waitForTimeout(1200);
  const sw = p.locator('button.child-switcher__badge--interactive');
  if (await sw.count() && !(await sw.innerText()).includes(KID)) { await sw.click(); await p.locator('.child-switcher__list-item', { hasText: KID }).click(); await p.waitForTimeout(1500); }
  console.log(vt, new URL(p.url()).pathname, '列', await p.locator('.payments__row').count(), '待', await p.locator('.payments__section-title').allInnerTexts(), '作廢', await p.locator('.payments__voided').count());
  await p.screenshot({ path: `${out}/${tag}-${vt}-list.png`, fullPage: true });
  const v = p.locator('.payments__voided summary');
  if (await v.count()) { await v.click(); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/${tag}-${vt}-voided.png`, fullPage: true }); await v.click(); }
  const rows = await p.locator('.payments__row').count();
  const seen = new Set();
  for (let i = 0; i < rows; i++) {
    const row = p.locator('.payments__row').nth(i);
    const st = (await row.locator('.payments__row-status').innerText()).trim();
    if (seen.has(st)) continue; seen.add(st);
    if (!(await row.isVisible())) { await p.locator('.payments__voided summary').click(); }
    await row.click(); await p.waitForTimeout(600);
    console.log(vt, '明細', st, JSON.stringify((await p.locator('.payments__detail').innerText()).replace(/\n+/g, '｜').slice(0, 160)));
    await p.screenshot({ path: `${out}/${tag}-${vt}-detail-${seen.size}.png` });
    await p.locator('.payments__detail-close').click(); await p.waitForTimeout(500);
  }
  await ctx.close();
}
await b.close();
