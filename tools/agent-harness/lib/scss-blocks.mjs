/**
 * 共用的 SCSS 區塊解析器。**不是 SCSS 編譯器，夠用即可。**
 *
 * 抽成共用是因為它已經被踩過三個安靜的 bug（見下方註解），而每一個都是
 * 「不報錯、只是結果悄悄變成錯的」那種。多一份副本＝多一次踩同樣的坑。
 */

/**
 * 註解裡常有 `44px`、`{`、`}`（本 repo 的註解特別長），不剝掉會把整段註解當成
 * selector，然後合規判定跟著失效 —— touch-target 第一版就是這樣誤報的。
 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * 把 SCSS 切成「解析後的 selector → 該區塊自己的宣告」。
 *
 * @param {string} rawSource
 * @returns {Array<{selector: string, decls: string, line: number, coarse: boolean, cond: boolean}>}
 *   `coarse` = 位於 `pointer: coarse` 底下；`cond` = 位於任何 at-rule 底下
 *   （`@media` / `@container` / `@include respond-to(...)`），也就是「某個條件才生效」。
 */
export function blocks(rawSource) {
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
      // **at-rule 要繼承外層的 selector，不能變成空字串。**
      // `&__skip { @media (pointer: coarse) { min-height: 44px; } }` 是 SCSS 最慣用的
      // 兩層寫法 —— 把 at-rule 的 selector 清成空的話，那個 44px 就掛不到任何 selector 上，
      // 於是「已經被 coarse 抬高」這件事看不見，已修好的程式碼被誤報成違規。
      // （2026-09-04 teacher-pages 首次外用時回報。self-test 當時只測了
      // 「@media 在頂層、選擇器已展開」那一種 —— 剛好是 dashboard 用的那種。）
      const sel = isAt
        ? parent
        : raw.startsWith('&')
          ? parent + raw.slice(1)
          : parent
            ? `${parent} ${raw}`
            : raw;
      stack.push({
        sel,
        coarse: /pointer\s*:\s*coarse/.test(raw) || stack.some((f) => f.coarse),
        cond: isAt || stack.some((f) => f.cond),
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
          cond: frame.cond,
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
