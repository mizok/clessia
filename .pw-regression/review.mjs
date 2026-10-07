import { chromium } from 'playwright';
const b = await chromium.launch();
const pages = { admin: '/admin/dashboard', teacher: '/teacher/schedule', parent: '/parent/dashboard' };
for (const [role, path] of Object.entries(pages))
  for (const [w, h, t] of [[1440, 900, 'desktop-1440'], [390, 844, 'mobile-390']]) {
    const ctx = await b.newContext({ storageState: `../state-${role}.json`, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto('http://localhost:4200' + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
    if (new URL(p.url()).pathname !== path) throw new Error(role + ' landed ' + p.url());
    await p.screenshot({ path: `../s3-review/${role}-${t}.png` });
    if (role === 'admin' && t === 'desktop-1440') {
      await p.locator('[popovertarget="shell-more"]').click(); await p.waitForTimeout(400);
      await p.screenshot({ path: `../s3-review/admin-desktop-1440-more-open.png` });
    }
    await ctx.close();
  }
await b.close();
