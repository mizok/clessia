import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ storageState: process.argv[2], viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://localhost:4200/admin/courses', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
console.log(await p.evaluate(() => {
  const row = document.querySelector('app-class-row'); const btn = row.querySelector('button[aria-label$="的操作"]');
  const chain = []; for (let a = row; a && a.tagName !== 'SECTION'; a = a.parentElement) { const cs = getComputedStyle(a); chain.push(`${a.tagName}.${a.className.toString().slice(0, 50)} vis=${cs.visibility} inert=${a.inert} hidden=${a.hidden} h=${Math.round(a.getBoundingClientRect().height)}`); }
  btn.focus(); return chain.join('\n') + '\nfocusable=' + (document.activeElement === btn);
}));
await b.close();
