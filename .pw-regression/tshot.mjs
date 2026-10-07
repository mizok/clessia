import { chromium } from 'playwright';
const b = await chromium.launch(); const ctx = await b.newContext({ storageState: '../state-teacher.json', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
await p.goto('http://localhost:4200/teacher/schedule', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
console.log('看名單 buttons', await p.getByRole('button', { name: '看名單' }).count(), '開始點名', await p.getByRole('button', { name: /開始點名|修改點名/ }).count());
await p.screenshot({ path: '../t920-schedule.png' });
const btn = p.getByRole('button', { name: '看名單' }).first();
if (await btn.count()) { await btn.click(); await p.waitForTimeout(1200); await p.screenshot({ path: '../t920-roster.png' }); }
await b.close();
