import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [linkFile, role, out] = process.argv.slice(2);
const link = readFileSync(linkFile, 'utf8').match(/https?:\/\/[^\s]+/)[0];
const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
await p.goto(link, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.goto('http://localhost:4200/select-role', { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
if (p.url().includes('select-role')) {
  await p.getByText({ admin: '管理', teacher: '老師', parent: '家長' }[role]).first().click();
  await p.waitForTimeout(1500);
}
console.log(role, 'landed', new URL(p.url()).pathname + new URL(p.url()).search);
await ctx.storageState({ path: out });
await b.close();
