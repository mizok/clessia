import { chromium } from 'playwright';
const [state,out,tag]=process.argv.slice(2);
const b=await chromium.launch(); const ctx=await b.newContext({storageState:state,viewport:{width:1280,height:800},reducedMotion:'reduce'}); const p=await ctx.newPage();
await p.goto('http://localhost:4200/admin/payments',{waitUntil:'networkidle'}); await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.locator('app-todo-banner button').boundingBox()));
await p.screenshot({path:`${out}/${tag}-pay-banner.png`});
await p.locator('app-todo-banner button').hover(); await p.waitForTimeout(300);
await p.screenshot({path:`${out}/${tag}-pay-banner-hover.png`});
await b.close();
