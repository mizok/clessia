import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 844, height: 390 } });
await p.goto('http://localhost:4200/trial', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(() => { const r = (e) => { const x = e.getBoundingClientRect(); return [Math.round(x.top*10)/10, Math.round(x.height*10)/10]; };
  const sh = document.querySelector('app-public-shell, .public-shell') ; const q = (s) => document.querySelector(s);
  const logo = q('a[href="/login"]'); const nav = q('nav'); const links = [...document.querySelectorAll('nav a')].map(r); const aside = q('aside');
  return { aside: r(aside), logo: r(logo), logoText: r(logo.firstElementChild), nav: r(nav), links, cs: getComputedStyle(logo).margin, ls: getComputedStyle(document.querySelector('nav a')).margin }; })));
await b.close();
