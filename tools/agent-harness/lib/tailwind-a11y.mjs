/**
 * touch-target（A17）與 scss-contrast 的 **class 版**（#991 T3，gate A27／A28）。
 *
 * 那兩支解析的是 SCSS；頁面改用 Tailwind、SCSS 刪掉之後它們什麼都看不到，**輸出還是綠的**
 * （tailwind-adoption.md 4.3：「gate 全綠」在那一頁上的意思會變成「沒有東西在看」）。
 * 這裡改讀 template 的 class 字串，只套在 `tailwind.css` 的 `@source` 目錄（已遷移的頁）。
 *
 * template 用 `@angular/compiler` 的 `parseTemplate` 解析 —— 看得懂 `@if`／`@for`／`ng-template`，
 * 也拿得到 `[class.x]` 條件 class（條件 class 視為「可能套上」，一起檢查）。
 *
 * ## 看不到什麼
 *
 * - **帶 variant 的 class 不算**（`lg:h-11`、`hover:bg-…`）。觸控看的是手機（mobile-first 的基底），
 *   對比只看靜態狀態。`max-[860px]:` 這類手機專屬寫法也不算 —— 要合規就寫在基底。
 *   **例外：對比看得懂巢狀任意變體 `[&_x]:`（子孫）與 `[&>x]:`（子）**（#1359）：它們是
 *   「父元素替子元素上色」的靜態寫法（empty-state 的 `[&_i]:text-zinc-400`），當成子元素自己的 class。
 *   `x` 只認單純選擇器（`i`、`.pi`、`i.pi`）；疊了別的 variant（`[&_i]:hover:`）照樣不算。
 * - **同元素 modifier 變體 `[&.x]:` 不算**（`[&.status-dot--done]:text-…`）：那是「某個狀態下」的配色，
 *   要逐個 modifier 組合才量得準，還沒做（#1359 範圍外）。
 * - **`[class]`／`[ngClass]` 整串綁定**、`pt` 物件裡的 class（PrimeNG 元件，同 A17 的豁免理由）。
 * - **底色在 template 外**（殼、父元件）的文字：找不到 `bg-*` 祖先就不判，跟 scss-contrast 同一個限制。
 */
import { parseTemplate } from '@angular/compiler';

import { TOUCH_MIN_PX } from './touch-target.mjs';

const SPACING_PX = 4; // tailwind.css 的 --spacing

/** 走過所有 Element，帶著祖先鏈 */
function walkElements(nodes, visit, ancestors = []) {
  for (const n of nodes) {
    const isEl = n.constructor.name === 'Element';
    if (isEl) visit(n, ancestors);
    const next = isEl ? [...ancestors, n] : ancestors;
    for (const key of ['children', 'branches', 'cases']) {
      if (Array.isArray(n[key])) walkElements(n[key], visit, next);
    }
    if (n.empty?.children) walkElements(n.empty.children, visit, next);
  }
}

/** 靜態 class ＋ `[class.x]` 條件 class；不帶 variant 的才回傳 */
export function baseClasses(el) {
  const statics = (el.attributes.find((a) => a.name === 'class')?.value ?? '').split(/\s+/);
  const bound = el.inputs.filter((i) => i.type === 2).map((i) => i.name);
  return [...statics, ...bound].filter((c) => c && !c.includes(':'));
}

/** `[&_x]:cls`／`[&>x]:cls` → { child, sel, cls }；不是這種寫法（或後面還疊 variant）回 null */
function nestedVariant(c) {
  const m = c.match(/^\[&([_>])([^\]]+)\]:([^:]+)$/);
  return m ? { child: m[1] === '>', sel: m[2], cls: m[3] } : null;
}

/** 單純選擇器 `i`／`.pi`／`i.pi` 對不對得上這個元素；看不懂的選擇器一律對不上（不猜） */
function matchesSimple(el, sel) {
  const m = sel.match(/^([a-z][a-z0-9-]*)?((?:\.[\w-]+)*)$/i);
  if (!m || (!m[1] && !m[2])) return false;
  if (m[1] && m[1] !== el.name) return false;
  const own = new Set(baseClasses(el));
  return m[2]
    .split('.')
    .filter(Boolean)
    .every((c) => own.has(c));
}

/**
 * 這個元素實際套上的 class：自己的基底 class ＋ 祖先用 `[&_x]:`／`[&>x]:` 替它上的。
 * `label` 是 template 裡寫的原字（回報、豁免鍵用），`cls` 是拿掉變體後的 class（查色用）。
 */
function appliedClasses(el, ancestors) {
  const out = baseClasses(el).map((c) => ({ label: c, cls: c }));
  ancestors.forEach((a, i) => {
    const isParent = i === ancestors.length - 1;
    const statics = (a.attributes.find((x) => x.name === 'class')?.value ?? '').split(/\s+/);
    for (const c of statics) {
      const v = c && nestedVariant(c);
      if (v && (!v.child || isParent) && matchesSimple(el, v.sel))
        out.push({ label: c, cls: v.cls });
    }
  });
  return out;
}

const isInteractive = (el) =>
  ['button', 'a', 'summary'].includes(el.name) ||
  el.outputs.some((o) => o.name === 'click') ||
  el.attributes.some((a) => ['routerLink', 'href'].includes(a.name)) ||
  el.inputs.some((i) => ['routerLink', 'href'].includes(i.name));

/**
 * 工具列控制項的自訂 utility（tailwind.css，#1903）：高度是 `--tbar-control`，手機與觸控 44、桌機（寬螢幕＋滑鼠）40。
 * 觸控看手機基底，所以算 44。**改了 tailwind.css 的手機值，這裡要跟著改。**
 */
const NAMED_HEIGHT_PX = { 'tbar-control': 44, 'tbar-control-square': 44 };

/** `h-11`、`min-h-12`、`size-11`、`h-[48px]`、`tbar-control` → px；其他回 null */
export function minHeightPx(cls) {
  if (cls in NAMED_HEIGHT_PX) return NAMED_HEIGHT_PX[cls];
  const m = cls.match(/^(?:min-h|h|size)-(?:(\d+(?:\.\d+)?)|\[(\d+(?:\.\d+)?)px\])$/);
  if (!m) return null;
  return m[1] !== undefined ? Number(m[1]) * SPACING_PX : Number(m[2]);
}

/** @returns {{ line: number, tag: string, classes: string }[]} */
export function touchTargetClassViolations(template, url = 'template.html') {
  const out = [];
  walkElements(parseTemplate(template, url, {}).nodes, (el) => {
    if (!isInteractive(el)) return;
    const classes = baseClasses(el);
    if (classes.some((c) => (minHeightPx(c) ?? 0) >= TOUCH_MIN_PX)) return;
    out.push({
      line: el.sourceSpan.start.line + 1,
      tag: el.name,
      classes: classes.join(' ') || '（沒有 class）',
    });
  });
  return out;
}

const hasOwnText = (el) =>
  el.children.some(
    (c) => (c.constructor.name === 'Text' && c.value.trim()) || c.constructor.name === 'BoundText',
  );
const looksLikeIcon = (el) =>
  el.name === 'i' || el.name === 'svg' || baseClasses(el).includes('pi');

/**
 * @param {string} template
 * @param {(cls: string) => string | null} colorOf `text-zinc-600` → CSS 色值（`var(--zinc-600)`、`#fff`）；不是顏色回 null
 * @param {(value: string) => number[] | null} resolve 色值 → rgb；解不出來回 null（不猜）
 * @param {(a: number[], b: number[]) => number} contrast
 * @returns {{ line: number, ratio: number, fg: string, bg: string, threshold: number }[]}
 */
export function contrastClassViolations(
  template,
  { colorOf, resolve, contrast },
  url = 'template.html',
) {
  const out = [];
  const pick = (chain, prop) => {
    for (let i = chain.length - 1; i >= 0; i--) {
      const hits = appliedClasses(chain[i], chain.slice(0, i)).filter(
        (c) => c.cls.startsWith(`${prop}-`) && colorOf(c.cls),
      );
      if (hits.length) return hits;
    }
    return [];
  };
  walkElements(parseTemplate(template, url, {}).nodes, (el, ancestors) => {
    const icon = looksLikeIcon(el);
    if (!hasOwnText(el) && !icon) return;
    const chain = [...ancestors, el];
    const threshold = icon ? 3 : 4.5;
    for (const fg of pick(chain, 'text')) {
      for (const bg of pick(chain, 'bg')) {
        const a = resolve(colorOf(fg.cls));
        const b = resolve(colorOf(bg.cls));
        if (!a || !b) continue;
        const ratio = contrast(a, b);
        if (ratio < threshold) {
          out.push({
            line: el.sourceSpan.start.line + 1,
            ratio: Math.round(ratio * 100) / 100,
            fg: fg.label,
            bg: bg.label,
            threshold,
          });
        }
      }
    }
  });
  return out;
}
