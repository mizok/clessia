import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const p = await (await b.newContext({ storageState: process.argv[2], viewport: { width: w, height: h } })).newPage();
  await p.goto('http://localhost:4200/admin/courses', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  const probe = () => p.evaluate(async () => {
    const out = [];
    for (const row of [...document.querySelectorAll('app-class-row')]) {
      const btn = row.querySelector('button[aria-label$="的操作"]'); if (!btn) continue;
      // 最近一個把它裁掉的祖先
      let clip = null; for (let a = row.parentElement; a; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflow !== 'visible' && a.getBoundingClientRect().height < 2) { clip = a; break; } }
      const exp = row.closest('section')?.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded');
      btn.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 50));
      const r = btn.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      out.push(`${btn.getAttribute('aria-label').slice(0, 12)} expanded=${exp} clipped=${!!clip} hit=${btn.contains(hit) ? 'OK' : 'BLOCKED'}`);
    }
    return out;
  });
  console.log(w, 'initial\n ' + (await probe()).join('\n '));
  await p.locator('section button[aria-expanded=false]').first().click(); await p.waitForTimeout(800);
  console.log(w, 'after expanding first\n ' + (await probe()).slice(0, 6).join('\n '));
  const r = p.locator('section:has(button[aria-expanded=true]) app-class-row button[aria-label$="的操作"]').first();
  await r.click({ timeout: 5000 }).then(async () => console.log(w, 'real click menuitems', (await p.getByRole('menuitem').allInnerTexts()).length)).catch((e) => console.log(w, 'real click FAIL', e.message.split('\n')[0]));
}
await b.close();
