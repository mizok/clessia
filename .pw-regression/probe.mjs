import { chromium } from 'playwright';
const [state, url] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext({ storageState: state }); const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
console.log(new URL(p.url()).pathname, (await p.locator('h1').allInnerTexts()).join('|'));
await b.close();
