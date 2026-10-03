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

const isInteractive = (el) =>
  ['button', 'a', 'summary'].includes(el.name) ||
  el.outputs.some((o) => o.name === 'click') ||
  el.attributes.some((a) => ['routerLink', 'href'].includes(a.name)) ||
  el.inputs.some((i) => ['routerLink', 'href'].includes(i.name));

/** `h-11`、`min-h-12`、`size-11`、`h-[48px]` → px；其他回 null */
export function minHeightPx(cls) {
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
    for (const el of [...chain].reverse()) {
      const hits = baseClasses(el).filter((c) => c.startsWith(`${prop}-`) && colorOf(c));
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
        const a = resolve(colorOf(fg));
        const b = resolve(colorOf(bg));
        if (!a || !b) continue;
        const ratio = contrast(a, b);
        if (ratio < threshold) {
          out.push({
            line: el.sourceSpan.start.line + 1,
            ratio: Math.round(ratio * 100) / 100,
            fg,
            bg,
            threshold,
          });
        }
      }
    }
  });
  return out;
}
