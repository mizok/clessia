/**
 * 守 cascade layer 順序的三處宣告一致（#991 T4，gate A26）。
 *
 * - `tailwind.css` 與 `styles.css` 各自開頭宣告完整順序 `@layer theme, base, primeng, legacy, utilities;`
 * - `app.config.ts` 的 PrimeNG `cssLayer.order` 必須是它的**前綴**
 *
 * 順序由第一次出現決定，而 PrimeNG 把它那支 layer-order 插在 `<head>` 最前面 —— 所以**只改其中一處**時
 * 生效的是 PrimeNG 那一行，另外兩處寫什麼都不會報錯。例如 order 少了 `legacy`，legacy 就排到 primeng
 * **前面**，styles.css 對 PrimeNG 的覆寫全部靜靜失效。
 */

/** 第一個 `@layer a, b, c;` 陳述（不是區塊）的 layer 名稱 */
export function layerStatement(css) {
  const m = css.match(/^@layer\s+([\w\s,-]+);/m);
  return m ? m[1].split(',').map((s) => s.trim()) : null;
}

/** `cssLayer: { name: '…', order: '…' }`；`cssLayer: false` 或找不到回 null */
export function primengCssLayer(ts) {
  const m = ts.match(/cssLayer:\s*\{([^}]*)\}/);
  if (!m) return null;
  const name = m[1].match(/name:\s*'([^']+)'/)?.[1];
  const order = m[1].match(/order:\s*'([^']+)'/)?.[1];
  return { name, order: order ? order.split(',').map((s) => s.trim()) : [] };
}

/** @returns {string[]} 違規訊息（空陣列 = 綠） */
export function layerOrderProblems({ tailwindCss, stylesCss, appConfigTs }) {
  const problems = [];
  const tw = layerStatement(tailwindCss);
  if (!tw) return ['tailwind.css 開頭沒有 `@layer …;` 順序宣告'];

  const st = layerStatement(stylesCss);
  if (!st) problems.push('styles.css 沒有 `@layer …;` 順序宣告');
  else if (st.join() !== tw.join()) {
    problems.push(
      `styles.css 的 layer 順序（${st.join(', ')}）跟 tailwind.css（${tw.join(', ')}）不一致`,
    );
  }

  const pn = primengCssLayer(appConfigTs);
  if (!pn) {
    problems.push(
      'app.config.ts 的 PrimeNG cssLayer 不是 { name, order } —— PrimeNG 沒進 layer 的話，' +
        'utilities 永遠贏不了 Aura（tailwind-adoption.md 2.2）',
    );
    return problems;
  }
  if (!tw.includes(pn.name)) {
    problems.push(`PrimeNG 的 layer 名稱 ${pn.name} 不在 tailwind.css 的順序裡`);
  }
  if (pn.order.join() !== tw.slice(0, pn.order.length).join()) {
    problems.push(
      `app.config.ts 的 cssLayer.order（${pn.order.join(', ')}）不是 tailwind.css 順序的前綴 —— ` +
        'PrimeNG 的 layer-order 最先載入，順序以它為準',
    );
  }
  if (!pn.order.includes(pn.name)) {
    problems.push(`cssLayer.order 沒有列出 ${pn.name} 自己`);
  }
  return problems;
}
