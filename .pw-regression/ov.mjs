import { chromium } from 'playwright';
const b = await chromium.launch(); const ctx = await b.newContext({ storageState: '../state-admin.json' }); const p = await ctx.newPage();
await p.goto('http://localhost:4200/admin/students', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
console.log('overlay', await p.locator('vite-error-overlay').count(), 'sidebar', await p.locator('app-sidebar').count());
await b.close();
