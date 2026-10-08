/**
 * 守 `apps/web/src/tailwind.css` 的 `@theme` 映射（#991 T0，gate A25）。
 *
 * tokens 的來源是 `styles.css` 的 `:root`，`@theme` 只引用、不另定值。映射表是手寫的，
 * 所以要一道 gate 守住三件**錯了也不會報錯**的事：
 *
 * 1. **引用的變數不存在**：`--color-zinc-950: var(--zinc-950)` 而 `:root` 沒有 `--zinc-950` ——
 *    `bg-zinc-950` 照樣產生，值是空的，畫面靜靜沒顏色。
 * 2. **字重寫進字體家族命名空間**：本專案的 `--font-medium` 是字重（500），Tailwind 的
 *    `--font-*` 是 `font-family`。寫成 `--font-medium: var(--font-medium)` 的話，
 *    `font-medium` 會輸出 `font-family: 500`。字重要映到 `--font-weight-*`。
 * 3. **同名自我參照被輸出**：`@theme inline` 沒加 `reference` 時，`--text-xs: var(--text-xs)`
 *    會被輸出到 `:root`（實測）。今天靠 styles.css 未分層而贏，`:root` 哪天被包進 layer 就變成循環。
 */

const FONT_WEIGHT_NAMES =
  /^--font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;

/** `:root { … }` 裡宣告的自訂屬性名稱（只看第一個 `:root` 區塊 —— tokens 住那裡） */
export function rootVariables(scss) {
  const start = scss.search(/^:root\s*\{/m);
  if (start === -1) return new Set();
  let depth = 0;
  let end = start;
  for (let i = scss.indexOf('{', start); i < scss.length; i++) {
    if (scss[i] === '{') depth++;
    else if (scss[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  return new Set([...scss.slice(start, end).matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
}

/** 每個 `@theme <options> { … }` 區塊的選項與宣告 */
export function themeBlocks(css) {
  const blocks = [];
  for (const m of css.matchAll(/@theme\b([^{]*)\{/g)) {
    let depth = 0;
    let end = m.index;
    for (let i = m.index + m[0].length - 1; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) {
        end = i;
        break;
      }
    }
    const body = css.slice(m.index + m[0].length, end).replace(/\/\*[^]*?\*\//g, '');
    blocks.push({
      options: m[1].trim().split(/\s+/).filter(Boolean),
      decls: [...body.matchAll(/(--[\w-]+|--\*)\s*:\s*([^;]+);/g)].map((d) => ({
        name: d[1],
        value: d[2].trim(),
      })),
    });
  }
  return blocks;
}

/** @returns {string[]} 違規訊息（空陣列 = 綠） */
export function themeMappingProblems(tailwindCss, stylesCss) {
  const known = rootVariables(stylesCss);
  const problems = [];
  for (const { options, decls } of themeBlocks(tailwindCss)) {
    const emitted = !options.includes('reference');
    for (const { name, value } of decls) {
      if (FONT_WEIGHT_NAMES.test(name)) {
        problems.push(
          `${name} 寫在 Tailwind 的字體家族命名空間（--font-*）—— 字重要寫成 --font-weight-${name.slice(7)}`,
        );
      }
      for (const ref of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (!known.has(ref[1])) {
          problems.push(
            `${name} 引用的 ${ref[1]} 不在 styles.css 的 :root —— utility 會產生、值是空的`,
          );
        }
        if (ref[1] === name && emitted) {
          problems.push(
            `${name}: var(${name}) 是同名自我參照，而這個 @theme 區塊沒有 reference —— 會被輸出到 :root`,
          );
        }
      }
    }
  }
  return problems;
}
