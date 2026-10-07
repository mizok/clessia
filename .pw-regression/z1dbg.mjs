import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ storageState: process.argv[2], viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
const p = await ctx.newPage();
await p.goto('http://localhost:4200/admin/payments',{waitUntil:'networkidle'}); await p.waitForTimeout(1500);
console.log('masks', await p.locator('.p-dialog-mask').count());
await p.screenshot({path:'/private/tmp/claude-501/z1/dbg.png'});
await b.close();
