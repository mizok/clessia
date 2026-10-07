import { chromium } from 'playwright';
const [state] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ storageState: state, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
const p = await ctx.newPage();
for (const u of ['/admin/sessions','/admin/dashboard','/admin/leave','/admin/payments','/admin/meals']) {
  await p.goto('http://localhost:4200'+u,{waitUntil:'networkidle'}); await p.waitForTimeout(1000);
  const t = await p.locator('button:visible').evaluateAll(es=>es.map(e=>(e.getAttribute('aria-label')||e.innerText||'').trim().replace(/\s+/g,' ').slice(0,16)).filter(Boolean));
  console.log(u, JSON.stringify(t.slice(0,45)));
}
await b.close();
