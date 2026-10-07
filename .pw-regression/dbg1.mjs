import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
p.on('console', m => console.log('console:', m.type(), m.text().slice(0, 300)));
p.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 300)));
p.on('response', r => { if (r.status() >= 400) console.log('http', r.status(), r.url()); });
await p.goto('http://localhost:4200/login', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
console.log(await p.locator('body').innerText().then(t => t.slice(0, 200)));
await b.close();
