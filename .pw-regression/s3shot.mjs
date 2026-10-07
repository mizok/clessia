import { chromium } from 'playwright';
const b = await chromium.launch();
const home = { admin: '/admin/changes', teacher: '/teacher/schedule', parent: '/parent/dashboard' };
for (const role of ['admin', 'teacher', 'parent'])
  for (const [w, h, t] of [[1440, 900, 'd'], [390, 844, 'm']]) {
    const ctx = await b.newContext({ storageState: `../state-${role}.json`, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto('http://localhost:4200' + home[role], { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
    await p.screenshot({ path: `../s3-${role}-${t}.png` });
    const more = p.locator('[popovertarget="shell-more"]');
    if (await more.count()) { await more.click(); await p.waitForTimeout(400); await p.screenshot({ path: `../s3-${role}-${t}-more.png` }); await p.keyboard.press('Escape'); }
    await p.locator('[popovertarget="shell-account"]').click(); await p.waitForTimeout(400);
    await p.screenshot({ path: `../s3-${role}-${t}-acct.png` });
    await ctx.close();
  }
await b.close();
