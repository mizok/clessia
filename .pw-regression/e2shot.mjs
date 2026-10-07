import { chromium } from 'playwright';
const [state, out, tag] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, h, vt] of [[1440, 900, 'd'], [390, 844, 'm']]) {
  const ctx = await b.newContext({ storageState: state, viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const hide = async () => { await p.addStyleTag({ content: 'app-flow-field{visibility:hidden!important}' }); await p.waitForTimeout(500); };
  const open = async () => { await p.goto('http://localhost:4200/select-role', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500); await hide(); };
  const dlg = () => p.locator('.p-dialog:visible').last();
  await open();
  console.log(vt, 'idle', new URL(p.url()).pathname, 'picker', await p.locator('.role-picker').count(), 'opts', await p.locator('.role-picker__option').count(), 'active', await p.locator('.role-picker__option--active').count());
  await p.screenshot({ path: `${out}/${tag}-${vt}-idle-page.png` });
  await dlg().screenshot({ path: `${out}/${tag}-${vt}-idle.png` });
  const opts = p.locator('.role-picker__option');
  await opts.nth(1).hover(); await p.waitForTimeout(400); await dlg().screenshot({ path: `${out}/${tag}-${vt}-hover.png` });
  await opts.nth(0).click(); await p.waitForTimeout(2000);
  await open();
  console.log(vt, 'after-select', new URL(p.url()).pathname, 'picker', await p.locator('.role-picker').count(), 'active', await p.locator('.role-picker__option--active').count());
  if (await p.locator('.role-picker').count()) {
    await dlg().screenshot({ path: `${out}/${tag}-${vt}-active.png` });
    await p.locator('.role-picker__option').nth(1).hover(); await p.waitForTimeout(400); await dlg().screenshot({ path: `${out}/${tag}-${vt}-active-hover.png` });
    await p.locator('.role-picker__option--active').hover(); await p.waitForTimeout(400); await dlg().screenshot({ path: `${out}/${tag}-${vt}-active-hover-self.png` });
  }
  await ctx.close();
}
await b.close();
