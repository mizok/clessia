import { chromium } from 'playwright';
const b = await chromium.launch();
for (const r of ['admin','teacher','parent']) {
  const ctx = await b.newContext({ storageState: `../state-${r}.json` });
  const p = await ctx.newPage();
  await p.goto(`http://localhost:4200/${r}/${r==='teacher'?'schedule':'dashboard'}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  console.log(r, new URL(p.url()).pathname, await p.getByText('連線異常').count());
}
await b.close();
