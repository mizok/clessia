import { chromium } from 'playwright';
const b = await chromium.launch(); const ctx = await b.newContext({ storageState: process.argv[2], viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
await p.goto('http://localhost:4200/select-role', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate(() => ({ bem: document.querySelectorAll('.role-picker__header,.role-picker__option-icon').length, flex: document.querySelector('.role-picker')?.className, optCls: document.querySelector('.role-picker__option')?.className.slice(0, 60) }))));
await b.close();
