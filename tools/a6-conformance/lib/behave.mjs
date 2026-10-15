// 第三層：互動情境。同一個情境在 A6 與 app 各跑一次，比「做了這些步驟之後，畫面變了什麼」。
// 比的是變化量（delta），不是絕對狀態 —— 兩邊資料不同，絕對狀態本來就不會一樣。
import { extractSource } from './extract.mjs';
import { normText } from './normalize.mjs';

/** 步驟的目標：CSS 字串，或 `{ role, name }`（name 是 regex 字串，對可及名稱）。 */
function target(page, t) {
  if (typeof t === 'string') return page.locator(t).locator('visible=true').first();
  return page
    .getByRole(t.role, { name: new RegExp(t.name) })
    .locator('visible=true')
    .nth(t.nth ?? 0);
}

async function step(page, s) {
  if (s.click) await target(page, s.click).click();
  else if (s.fill) await target(page, s.fill[0]).fill(s.fill[1]);
  else if (s.press) await page.keyboard.press(s.press);
  else if (s.hover) await target(page, s.hover).hover();
  else if (s.wait) await page.waitForTimeout(s.wait);
  else throw new Error('不認得的步驟：' + JSON.stringify(s));
  await page.waitForTimeout(s.settle ?? 400);
}

/** 畫面快照：part 樹＋開著的浮層數＋焦點＋捲動量。 */
async function snapshot(page, names) {
  const parts = await page.evaluate(extractSource({ names }));
  const extra = await page.evaluate(() => {
    const IGN = '.proto-pill, .proto-all, .proto-notes';
    const shown = (el) =>
      el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const overlays = [
      ...document.querySelectorAll(
        ':popover-open, dialog[open], [role=dialog], [role=menu], [role=listbox]',
      ),
    ].filter((el) => shown(el) && !el.matches(IGN) && !el.closest(IGN));
    const a = document.activeElement;
    let scroll = scrollY;
    for (const el of document.querySelectorAll('*'))
      if (el.scrollTop > scroll) scroll = el.scrollTop;
    return {
      overlays: new Set(overlays.map((el) => el.closest(':popover-open, dialog, [role]'))).size,
      focus:
        a && a !== document.body
          ? (a.getAttribute('aria-label') || a.textContent || a.placeholder || a.tagName).trim()
          : '',
      scroll: Math.round(scroll),
    };
  });
  return { parts, ...extra, focus: normText(extra.focus, names) };
}

/** 在已載入的頁面上跑一個情境（頁面由 capture.mjs 的 openPage 開）。 */
export async function runScenario(page, { steps, names }) {
  const before = await snapshot(page, names);
  let failed = null;
  for (const s of steps) {
    try {
      await step(page, s);
    } catch (e) {
      failed = `步驟 ${JSON.stringify(s)} 失敗：${e.message.split('\n')[0]}`;
      break;
    }
  }
  const after = await snapshot(page, names);
  return { before, after, failed };
}

const ON = {
  'aria-current': (v) => v != null && v !== 'false',
  'aria-pressed': (v) => v === 'true',
  'aria-expanded': (v) => v === 'true',
  'aria-selected': (v) => v === 'true',
  'aria-checked': (v) => v === 'true',
};
// 列內的 part 不帶文案（是資料），變化只看列外的
const visibleParts = (parts) =>
  parts.filter((p) => p.tpl && !p.inRows && p.kind !== 'landmark' && !p.sr);
const onSet = (parts) =>
  new Set(
    visibleParts(parts)
      .filter((p) => Object.entries(ON).some(([k, f]) => f(p.attrs?.[k])))
      .map((p) => p.tpl),
  );

/** 一邊的變化量（純函式）。 */
export function delta({ before, after }) {
  const tb = new Set(visibleParts(before.parts).map((p) => p.tpl));
  const ta = new Set(visibleParts(after.parts).map((p) => p.tpl));
  const ob = onSet(before.parts),
    oa = onSet(after.parts);
  const srB = new Set(before.parts.filter((p) => p.sr && p.tpl).map((p) => p.tpl));
  return {
    // 只給螢幕閱讀器、操作後才出現的文字（篩選結果的 live region）：另列，不比
    sr: [
      ...new Set(after.parts.filter((p) => p.sr && p.tpl && !srB.has(p.tpl)).map((p) => p.tpl)),
    ].sort(),
    appeared: [...ta].filter((t) => !tb.has(t)).sort(),
    gone: [...tb].filter((t) => !ta.has(t)).sort(),
    turnedOn: [...oa].filter((t) => !ob.has(t)).sort(),
    turnedOff: [...ob].filter((t) => !oa.has(t)).sort(),
    overlays: after.overlays - before.overlays,
    focus: after.focus,
    scrolled: Math.abs(after.scroll - before.scroll) > 4,
  };
}

/**
 * 兩邊變化量的差（純函式）。`ignore` 是情境層級的 regex 字串清單：命中的文案不比（資料造成的
 * 名單變化等）。回傳差異描述的陣列，空的＝一致。
 */
// 純數字（計數徽章、分頁碼）一律是資料；
// 第二層已經報過的 app 獨有元件（PrimeNG 分頁器），第三層不重複報它的出現／消失
const ALWAYS_IGNORE = ['^#$', ' Page$', '^第# / #頁'];
const head = (xs, n = 8) =>
  xs.slice(0, n).join('」「') + (xs.length > n ? `」…共 ${xs.length} 項` : '」');

export function compareDelta(a, b, { ignore = [], checkFocus = false } = {}) {
  const pats = [...ALWAYS_IGNORE, ...ignore].map((r) => new RegExp(r));
  const keep = (t) => !pats.some((r) => r.test(t));
  const out = [];
  for (const [k, label] of [
    ['appeared', '出現'],
    ['gone', '消失'],
    ['turnedOn', '變成選中／展開'],
    ['turnedOff', '取消選中／收合'],
  ]) {
    const x = a[k].filter(keep),
      y = b[k].filter(keep);
    const onlyA = x.filter((t) => !y.includes(t)),
      onlyB = y.filter((t) => !x.includes(t));
    if (onlyA.length) out.push(`${label}：只有 A6「${head(onlyA)}`);
    if (onlyB.length) out.push(`${label}：只有 app「${head(onlyB)}`);
  }
  if (a.overlays !== b.overlays) out.push(`浮層數變化：A6 ${a.overlays}、app ${b.overlays}`);
  // 焦點只在情境宣告時比：稿多半用 innerHTML 重畫，點完按鈕焦點掉回 body 是原型的副作用，不是規格
  if (checkFocus && a.focus !== b.focus) out.push(`焦點：A6「${a.focus}」、app「${b.focus}」`);
  if (a.scrolled !== b.scrolled)
    out.push(`捲動：A6 ${a.scrolled ? '有' : '沒有'}、app ${b.scrolled ? '有' : '沒有'}`);
  return out;
}
