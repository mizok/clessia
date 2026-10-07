import { chromium } from 'playwright';
const b = await chromium.launch();
for (const w of [900, 860]) { const ctx = await b.newContext({ storageState: '../state-admin.json', viewport: { width: w, height: 900 }, reducedMotion: 'reduce' }); const p = await ctx.newPage();
  await p.goto('http://localhost:4200/admin/changes', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000); await p.screenshot({ path: `../wide-${w}.png` }); await ctx.close(); }
await b.close();
