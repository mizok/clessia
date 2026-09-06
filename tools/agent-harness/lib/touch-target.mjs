/**
 * 守「自己刻的可點元素必須有尺寸下限」（44px，WCAG 2.5.5 / Apple HIG）。
 *
 * ## 規則是反過來寫的，這一點是整支的關鍵
 *
 * 直覺會寫成「宣告了小於 44px 的尺寸 → 違規」。**那會漏掉最嚴重的案例。**
 *
 * 老師端 dashboard 那兩顆連結（該頁僅有的導覽動作）改動前是這樣：
 *
 * ```scss
 * &__link {
 *   padding: 0;
 *   border: none;
 *   cursor: pointer;
 *   font-size: 0.875rem;
 * }
 * ```
 *
 * **沒有 height、沒有 min-height、沒有任何尺寸宣告** —— 那 20px 純粹是 14px 文字的行高。
 * 找「小數字」的掃描在這裡一無所獲，因為根本沒有數字可抓。
 *
 * 所以真正的訊號是「**宣告了 `cursor: pointer` 卻沒有任何尺寸下限**」。
 * （teacher-pages 席 2026-09 在 390px 實測 100×20 與 72×20，高度差門檻一半。）
 *
 * ## 合規的形狀是兩層，不是一層
 *
 * ```scss
 * &__link { min-height: 40px; cursor: pointer; }
 * @media (pointer: coarse) { .block__link { min-height: 44px; } }
 * ```
 *
 * 分兩層是因為 design-web 席第一版只給 padding 沒給下限，**量出來 34px 比改之前的
 * 42px 還矮** —— 手機優先不等於桌機劣化。所以 gate 只要求「有下限」，
 * 並在有明寫數字時要求它在 coarse 底下被抬到 44px。
 *
 * ## 這支看不到什麼（**綠燈不等於觸控目標都合格**）
 *
 * - **PrimeNG 元件不在掃描範圍** —— 元件 SCSS 永遠不會有 min-height，掃它們只會製造誤報。
 *
 *   **但「由全域 token 負責」這句話有範圍，2026-09-06 訂正**：
 *   `styles.scss` 的 `@media (pointer: coarse)` 區塊只對全域**加大內距**
 *   （`--p-button-sm-padding-y` 等），而 `min-height: 44px` **只掛在
 *   `.clessia-filter-bar .p-button`**。其餘位置的 `p-button` 最終高度取決於字級 ——
 *   teacher-pages 量到老師端課堂卡的動作鈕是 **34px**，而這道 gate 是綠的。
 *
 *   **gate 沒有量錯，是這個豁免的理由只在 filter bar 裡成立。**
 *   在別處，PrimeNG 按鈕的觸控尺寸目前**沒有任何機制在守**。
 * - **尺寸從父層或跨檔案繼承**來的，看不到。
 * - **只涵蓋掃描範圍內的目錄。** 權威是 `scan-scope.json` 的 `touch-target.roots`，
 *   **不是這句話** —— 查法：
 *   `node -e "console.log(require('./tools/agent-harness/scan-scope.json')['touch-target'].roots)"`
 *
 *   **2026-09-07 訂正（issue #589）**：這裡原本寫「目前是老師端；admin / parent /
 *   public 沒有人量過」。實際 roots 是 `features/admin`、`features/public`、
 *   `features/select-role`、`features/teacher`、`shared` —— **admin 與 public 早就在
 *   範圍內，三句話裡兩句是過期的**，而**過期的兩句會把剩下那句真的一起帶走**。
 *
 *   仍然為真的那一句：**`features/parent`（5 支 SCSS）不在範圍內，沒有人量過。**
 *   把它併進 roots 會產出一份新的 baseline —— 那是另一個決定，不在本次範圍。
 *
 * 定位是**防回歸**不是驗收合規：真正的合規要靠人在裝置上量，
 * 那件事不會因為這道 gate 綠燈就不用做。
 */

import { blocks } from './scss-blocks.mjs';

const TOUCH_MIN_PX = 44;
const SIZE_PROP = /^(min-)?(height|width)$/;

/** `12px` / `0.75rem` → px；看不懂回 null（看不懂就不報，寧可漏不可吵） */
function toPx(value) {
  const m = /^\s*([0-9.]+)(px|rem)\s*$/.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? (m[2] === 'rem' ? n * 16 : n) : null;
}

/**
 * PrimeNG 的東西不掃。**理由與它的範圍只寫在檔頭那一份，這裡不重複** ——
 * 一句話講兩次就會漂：這行原本寫著「由全域 token 管」，檔頭在 2026-09-06
 * 訂正成「那句話只在 `.clessia-filter-bar` 裡成立」，**而這一行沒跟上，
 * 又活了一天**（issue #589 稽核抓到）。
 *
 * **訂正落在檔頭、沒落在使用點，而改這道 gate 的人是先看到這裡的。**
 * 所以現在這裡只留指標：**看檔頭「這支看不到什麼」的第一條**。
 */
const PRIMENG = /(^|[\s>+~.:[])p-[a-z]|::ng-deep|--p-/;

/**
 * **焦點哨兵不是觸控目標。**
 *
 * 鍵盤陷阱（dialog / drawer）會放一個 1×1 的元素當 focus 的落點：它是給 Tab 走的，
 * 使用者永遠不會用手指點它，把它撐成 44px 反而會在版面上戳出一個看不見的洞。
 *
 * 判準刻意很窄：**兩軸都明寫且都 ≤ 2px**。真正的觸控目標不會長這樣，
 * 而放寬到「很小就算哨兵」會把 32px 的小按鈕一起放掉 —— 那正是要抓的東西。
 *
 * 目前 repo 裡沒有這種元素（2026-09-04 掃過，0 個），這是預防性的：
 * 加 dialog 的鍵盤陷阱時很可能就會出現，而那時它會長得像一筆違規。
 */
function isFocusSentinel(sizes) {
  const w = sizes.filter((s) => /width$/.test(s.prop)).map((s) => s.px);
  const h = sizes.filter((s) => /height$/.test(s.prop)).map((s) => s.px);
  if (w.length === 0 || h.length === 0) return false;
  return Math.max(...w) <= 2 && Math.max(...h) <= 2;
}

/**
 * 把 selector 收斂成「它講的是哪個元素」：
 *
 * - 去掉 `:hover` / `:focus-visible` 之類 —— 同一個元素的不同狀態要對得起來
 * - **只取最後一段**：`.d .d__skip` 與 `.d__skip` 在 CSS 上都作用在同一個元素身上，
 *   而 SCSS 巢狀常常兩種都寫得出來（`@media` 區塊裡寫展開的 selector 就會變成前者）。
 *   不收斂的話，同一個元素的 base 與 coarse 宣告會被當成兩個不同的東西。
 */
const baseKey = (sel) =>
  sel
    .replace(/::?[a-z-]+(\([^)]*\))?/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .pop() ?? '';

function sizeDecls(decls) {
  const out = [];
  for (const m of decls.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) {
    if (!SIZE_PROP.test(m[1].trim())) continue;
    const px = toPx(m[2]);
    if (px !== null) out.push({ prop: m[1].trim(), px });
  }
  return out;
}

/**
 * @param {Array<{path: string, source: string}>} files SCSS（path 用 repo 相對路徑）
 * @returns {Array<{file, line, selector, kind, px?}>} kind: 'no-floor' | 'below-threshold'
 */
export function touchTargetViolations(files) {
  const found = [];

  for (const { path, source } of files) {
    const parsed = blocks(source);

    // 每個 selector 在「非 coarse」與「coarse」底下各自的最大尺寸下限
    const floor = new Map();
    for (const b of parsed) {
      const key = baseKey(b.selector);
      if (!key) continue;
      const cur = floor.get(key) ?? { base: null, coarse: null };
      for (const s of sizeDecls(b.decls)) {
        const slot = b.coarse ? 'coarse' : 'base';
        cur[slot] = Math.max(cur[slot] ?? 0, s.px);
      }
      floor.set(key, cur);
    }

    for (const b of parsed) {
      if (b.coarse) continue;
      if (PRIMENG.test(b.selector)) continue;
      // **只認 `cursor: pointer`** —— 它是「這塊就是點擊目標」的明確宣告。
      // 用 `a` / `button` 當訊號會掃到 reset 區塊與 hover 子塊，那些沒有尺寸是正常的。
      if (!/cursor\s*:\s*pointer/.test(b.decls)) continue;

      const key = baseKey(b.selector);
      const f = floor.get(key) ?? { base: null, coarse: null };
      const effective = Math.max(f.coarse ?? 0, f.base ?? 0);

      if (isFocusSentinel(sizeDecls(b.decls))) continue;

      if (f.base === null && f.coarse === null) {
        found.push({ file: path, line: b.line, selector: b.selector, kind: 'no-floor' });
      } else if (effective < TOUCH_MIN_PX) {
        found.push({
          file: path,
          line: b.line,
          selector: b.selector,
          kind: 'below-threshold',
          px: effective,
        });
      }
    }
  }

  return found.sort((a, b) => `${a.file}:${a.line}`.localeCompare(`${b.file}:${b.line}`));
}

export { TOUCH_MIN_PX };
