import { chromium } from 'playwright';
const b = await chromium.launch(); const ctx = await b.newContext({ storageState: '../state-admin.json', viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
await p.goto('http://localhost:4200/admin/changes', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
await p.locator('.p-select').first().click(); await p.waitForTimeout(600);
console.log(await p.evaluate(() => { const o = document.querySelector('.p-overlay-mask, .p-overlay-modal, .p-overlay'); let n = o; while (n && n.parentElement !== document.body) n = n.parentElement; const walk = (e, d) => d > 4 ? '' : '  '.repeat(d) + e.tagName.toLowerCase() + ' .' + [...e.classList].join('.') + ' style=' + (e.getAttribute('style') || '').slice(0, 120) + '\n' + [...e.children].slice(0, 3).map(c => walk(c, d + 1)).join(''); return walk(n, 0); }));
console.log(await p.evaluate(() => { const s = [...document.styleSheets].find(x => x.href?.includes('styles.css')); return [...s.cssRules].filter(r => r.cssText?.includes('860')).slice(0, 3).map(r => r.cssText.slice(0, 200)).join('\n'); }));
await b.close();
