import { chromium } from 'playwright';
const [state,out,tag]=process.argv.slice(2);
const b=await chromium.launch();
for (const [w,h,vt] of [[1440,900,'d'],[390,844,'m']]) {
 const ctx=await b.newContext({storageState:state,viewport:{width:w,height:h},reducedMotion:'reduce'}); const p=await ctx.newPage();
 await p.goto('http://localhost:4200/admin/payments',{waitUntil:'networkidle'}); await p.waitForTimeout(1500);
 await p.locator('app-todo-banner button, app-todo-banner [role=button], app-todo-banner a').first().click();
 const d=p.locator('.p-dialog:visible').last(); await d.waitFor(); await p.waitForTimeout(1000);
 await d.screenshot({path:`${out}/${tag}-${vt}-uninvoiced.png`}); console.log(vt,'ok');
 await ctx.close();
}
await b.close();
