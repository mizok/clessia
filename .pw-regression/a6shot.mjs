import { chromium } from 'playwright';
const b = await chromium.launch();
const A6='file:///Users/mizokhuangmbp2023/Desktop/Workspace/clessia/.worktrees/labor-20261002-2356/.design-explorations/973-layout/a6-editorial/changes.html';
for (const [w,h,t] of [[1440,900,'d'],[390,844,'m']]) {
  const ctx = await b.newContext({ storageState: '../state-admin.json', viewport:{width:w,height:h}, reducedMotion:'reduce' });
  const p = await ctx.newPage();
  await p.goto('http://localhost:4200/admin/changes', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.screenshot({ path: `../s1-app-${t}.png` });
  await p.goto(A6); await p.waitForTimeout(1200);
  await p.screenshot({ path: `../s1-a6-${t}.png` });
}
await b.close();
