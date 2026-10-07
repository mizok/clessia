// 拋棄式（#1257）：班級列 ⋯ 在各種捲動位置是不是點得到。不進 repo。
import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const p = await (await b.newContext({ storageState: process.argv[2], viewport: { width: w, height: h } })).newPage();
  await p.goto('http://localhost:4200/admin/courses', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  const res = await p.evaluate(async () => {
    const out = [];
    const btns = [...document.querySelectorAll('app-class-row button[aria-label$="的操作"], app-class-row [data-part=nav]')].filter((x) => x.offsetParent);
    for (const btn of btns.slice(0, 4)) {
      for (const block of ['center', 'start', 'end']) {
        btn.scrollIntoView({ block });
        await new Promise((r) => setTimeout(r, 50));
        const r = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const ok = btn === hit || btn.contains(hit);
        out.push(`${(btn.getAttribute('aria-label') || '').slice(0, 14)} ${block} y=${Math.round(r.y)} ${ok ? 'OK' : 'BLOCKED by ' + hit?.tagName + '.' + (hit?.className?.toString?.() || '').slice(0, 60)}`);
      }
    }
    return out;
  });
  console.log(w, '\n ' + res.join('\n '));
}
await b.close();
