import { chromium } from 'playwright';
const [state, out] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ storageState: state, viewport: { width: 390, height: 844 }, hasTouch: true });
const p = await ctx.newPage();
await p.goto('http://localhost:4200/admin/sessions', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.getByRole('button', { name: /快速選取/ }).click();
await p.waitForTimeout(400);
await p.locator('dialog[open] p-select').first().click();
await p.waitForTimeout(600);
await p.screenshot({ path: `${out}/dbg-sheet-select.png` });
const info = await p.evaluate(() => {
  const o = document.querySelector('dialog[open] .p-select-overlay');
  const chain = [];
  for (let e = o; e; e = e.parentElement) { const cs = getComputedStyle(e); chain.push(`${e.tagName.toLowerCase()}.${[...e.classList].slice(0,2).join('.')} pos=${cs.position} ov=${cs.overflow} tf=${cs.transform} ct=${cs.contain}`); if (e.tagName === 'DIALOG') break; }
  const r = o?.getBoundingClientRect();
  return { rect: r && [r.x, r.y, r.width, r.height], chain };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
