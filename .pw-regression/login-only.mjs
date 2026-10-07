import { chromium } from 'playwright'; import { readFileSync } from 'node:fs';
const [linkFile, out] = process.argv.slice(2);
const link = readFileSync(linkFile, 'utf8').match(/https?:\/\/[^\s]+/)[0];
const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage();
await p.goto(link, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
console.log('landed', new URL(p.url()).pathname);
await ctx.storageState({ path: out }); await b.close();
