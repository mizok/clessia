// 拋棄式（#991 T4 回歸）：走全部路由 × 1440／390，dump 每個元素的 computed style。
// 用法：node capture.mjs <baseUrl> <out.json> <shotsDir> <storageState.json> <role> [routesFile]
// 切換前後各跑一次，再用 diff.mjs 比。不進 repo。
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const [base, outFile, shots, state, role, routesFile] = process.argv.slice(2);
const all = JSON.parse(readFileSync(routesFile, 'utf8'));
const routes =
  role === 'public'
    ? all.filter((r) => ['/login', '/trial', '/enrollment', '/qr-checkin'].includes(r.path))
    : all.filter((r) => r.path.startsWith(`/${role}/`));
mkdirSync(shots, { recursive: true });

const PROPS =
  `display position top left right bottom width height min-width min-height max-width max-height
margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left
border-top-width border-right-width border-bottom-width border-left-width border-top-color border-bottom-color
border-left-color border-right-color border-top-left-radius border-bottom-right-radius
color background-color background-image box-shadow opacity visibility z-index overflow-x overflow-y
font-size font-weight line-height font-family text-align white-space text-overflow text-decoration-line
flex-direction flex-wrap justify-content align-items gap flex-grow flex-shrink flex-basis
grid-template-columns transform transition-duration animation-name cursor outline-style pointer-events`.split(
    /\s+/,
  );

async function dump(page, scope) {
  return page.evaluate(
    ({ PROPS, scope }) => {
      const out = {};
      const rootEls = scope
        ? [...document.querySelectorAll(scope)]
        : [document.body];
      const key = (el) => {
        const parts = [];
        for (let e = el; e && e !== document.body; e = e.parentElement) {
          const p = e.parentElement;
          const i = p
            ? [...p.children].filter((c) => c.tagName === e.tagName).indexOf(e)
            : 0;
          parts.unshift(
            `${e.tagName.toLowerCase()}${e.classList.length ? "." + [...e.classList].sort().join(".") : ""}:${i}`,
          );
        }
        return parts.join(">");
      };
      for (const r of rootEls)
        for (const el of [r, ...r.querySelectorAll("*")]) {
          if (["SCRIPT", "STYLE", "svg", "path"].includes(el.tagName)) continue;
          const cs = getComputedStyle(el);
          const o = {};
          for (const p of PROPS) o[p] = cs.getPropertyValue(p);
          out[key(el)] = o;
        }
      return out;
    },
    { PROPS, scope },
  );
}

const OVERLAY =
  ".p-overlay, .p-select-overlay, .p-multiselect-overlay, .p-datepicker-panel, .p-dialog-mask, .p-drawer, .p-popover, .p-confirmdialog, .p-toast, .p-tooltip, .p-menu-overlay";
const result = {};
const browser = await chromium.launch();
for (const [vw, vh, tag] of [
  [1440, 900, "d"],
  [390, 844, "m"],
]) {
  const ctx = await browser.newContext({
    viewport: { width: vw, height: vh },
    storageState: state === 'none' ? undefined : state,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  for (const r of routes) {
    let path = r.path;
    if (path.includes(":")) continue; // 參數路由另外處理（resolveParams）
    const id = `${tag} ${path}`;
    try {
      await page.goto(base + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      const landed = new URL(page.url()).pathname;
      const broken = await page.getByText('連線異常').count();
      if (landed !== path || broken) throw new Error(`落點 ${landed}、連線異常 ${broken} —— 不是要測的頁`);
      result[`${id} | load`] = await dump(page);
      await page.screenshot({
        path: `${shots}/${tag}${path.replaceAll("/", "_")}.png`,
        fullPage: true,
      });
      // 下拉類：打開 overlay
      const triggers = await page
        .locator(
          ".p-select:visible, .p-multiselect:visible, .p-datepicker-input:visible",
        )
        .all();
      for (const [i, t] of triggers.slice(0, 3).entries()) {
        try {
          await t.click({ timeout: 2000 });
          await page.waitForTimeout(400);
          result[`${id} | overlay${i}`] = await dump(page, OVERLAY);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(200);
        } catch {}
      }
      // 開對話框類的按鈕（只開、不送出）
      const btns = await page
        .locator("button:visible")
        .filter({ hasText: /新增|建立|編輯|匯入|篩選|批次/ })
        .all();
      for (const [i, b] of btns.slice(0, 3).entries()) {
        try {
          await page.goto(base + path, { waitUntil: "networkidle" });
          await page.waitForTimeout(500);
          const again = (
            await page
              .locator("button:visible")
              .filter({ hasText: /新增|建立|編輯|匯入|篩選|批次/ })
              .all()
          )[i];
          if (!again) continue;
          await again.click({ timeout: 2000 });
          await page.waitForTimeout(700);
          result[`${id} | dialog${i}`] = await dump(page, OVERLAY);
          await page.screenshot({
            path: `${shots}/${tag}${path.replaceAll("/", "_")}_dlg${i}.png`,
          });
        } catch {}
      }
      console.error("ok", id);
    } catch (e) {
      console.error("FAIL", id, e.message.split("\n")[0]);
    }
  }
  await ctx.close();
}
await browser.close();
writeFileSync(outFile, JSON.stringify(result));
