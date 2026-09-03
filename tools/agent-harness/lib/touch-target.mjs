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
 * - **PrimeNG 元件不在掃描範圍**。它們由 `styles.scss` 的 `@media (pointer: coarse)`
 *   token 區塊統一負責（#171），元件 SCSS 永遠不會有 min-height —— 掃它們只會製造誤報。
 * - **尺寸從父層或跨檔案繼承**來的，看不到。
 * - **只涵蓋掃描範圍內的目錄**。目前是老師端；admin / parent / public **沒有人量過**，
 *   別把綠燈讀成「全站合格」。
 *
 * 定位是**防回歸**不是驗收合規：真正的合規要靠人在裝置上量，
 * 那件事不會因為這道 gate 綠燈就不用做。
 */

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
 * 註解裡常有 `44px`、`{`、`}`（本 repo 的註解特別長），不剝掉會把整段註解當成
 * selector，然後合規判定跟著失效 —— 第一版就是這樣誤報的。
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 把 SCSS 切成「解析後的 selector → 該區塊自己的宣告」。不是 SCSS 編譯器，夠用即可。 */
function blocks(rawSource) {
  const source = stripComments(rawSource);
  const out = [];
  const stack = [];
  let buf = '';
  let line = 1;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\n') line++;

    if (ch === '{') {
      const raw = buf.trim();
      const isAt = raw.startsWith('@');
      const parent = [...stack].reverse().find((f) => f.sel)?.sel ?? '';
      const sel = isAt
        ? ''
        : raw.startsWith('&')
          ? parent + raw.slice(1)
          : parent
            ? `${parent} ${raw}`
            : raw;
      stack.push({
        sel,
        coarse: /pointer\s*:\s*coarse/.test(raw) || stack.some((f) => f.coarse),
        line,
        decls: '',
      });
      buf = '';
    } else if (ch === '}') {
      const frame = stack.pop();
      if (frame?.sel) {
        out.push({
          selector: frame.sel,
          decls: frame.decls + buf,
          line: frame.line,
          coarse: frame.coarse,
        });
      }
      buf = '';
    } else {
      buf += ch;
      if (ch === ';') {
        // **頂層也要清**。`@use 'x' as y;` 這種沒有大括號的語句若留在 buffer 裡，
        // 會跟下一個 selector 黏成一體，而它以 `@` 開頭 → 整個區塊被當成 at-rule、
        // selector 變成空字串，後面所有 `&__x` 的父層解析跟著全毀。
        // 症狀是安靜的：不會報錯，只是 selector 少了前綴、合規比對對不上。
        if (stack.length > 0) stack[stack.length - 1].decls += buf;
        buf = '';
      }
    }
  }
  return out;
}

/** PrimeNG 的東西由全域 token 管，掃它只會誤報 */
const PRIMENG = /(^|[\s>+~.:[])p-[a-z]|::ng-deep|--p-/;

/** 去掉 `:hover` / `:focus-visible` 之類，讓「同一個元素的不同狀態」對得起來 */
const baseKey = (sel) => sel.replace(/::?[a-z-]+(\([^)]*\))?/g, '').trim();

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
