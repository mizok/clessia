import { chromium } from 'playwright';
const b = await chromium.launch(); const ctx = await b.newContext({ storageState: '../state-admin.json' }); const p = await ctx.newPage();
await p.goto('http://localhost:4200/admin/changes', { waitUntil: 'networkidle' });
console.log(await p.evaluate(() => [...document.styleSheets].map((s, i) => { let first; let found = null, err = null; try { first = s.cssRules[0]?.constructor.name; for (const o of s.cssRules) for (const n of o.style) if (/-anchor-gutter$/.test(n)) { found = n; throw 0; } } catch (e) { if (e !== 0) err = String(e).slice(0, 60); } return `${i} ${s.href ? s.href.split('/').pop() : 'inline'} first=${first} found=${found} err=${err}`; }).join('\n')));
await b.close();
