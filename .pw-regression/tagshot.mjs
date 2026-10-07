// 拋棄式（#1194）：課表課塊的異動文案。真資料上前三堂改成合成 latestChange（只用在截圖）。不進 repo。
import { chromium } from 'playwright';
const [state, out] = process.argv.slice(2);
const b = await chromium.launch(); const errs = [];
const fake = [
  { type: 'substitute', originalTeacherName: '王怡君' },
  { type: 'reschedule', originalDate: '2026-09-30', originalStartTime: '16:00' },
  { type: 'cancellation', reason: '颱風停班停課', status: 'cancelled' },
  { type: 'time_change' },
];
for (const [w, h, vt] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.route(/\/api\/sessions\?/, async (r) => {
    const res = await r.fetch(); const json = await res.json();
    const list = json.data ?? json.items ?? [];
    list.slice(0, fake.length).forEach((s, i) => {
      const { status, ...c } = fake[i];
      if (status) s.status = status;
      s.hasChanges = true;
      s.latestChange = { reason: null, originalTeacherName: null, originalDate: null, originalStartTime: null, originalEndTime: null, createdAt: '2026-10-01T00:00:00Z', ...c };
    });
    console.log(vt, 'sessions', list.length);
    await r.fulfill({ response: res, json });
  });
  await p.goto('http://localhost:4200/admin/sessions', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  await p.locator('button:visible', { hasText: '週五' }).first().click(); await p.waitForTimeout(1500);
  console.log(vt, p.url().includes('/login') ? '登出了' : 'ok', 'overlay', await p.locator('vite-error-overlay').count());
  console.log(vt, 'tags', (await p.locator('app-session-tags:visible').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '));
  await p.screenshot({ path: `${out}/tags-${vt}.png`, fullPage: true });
  await ctx.close();
}
console.log('console errors', errs.length, errs.slice(0, 3)); await b.close();
