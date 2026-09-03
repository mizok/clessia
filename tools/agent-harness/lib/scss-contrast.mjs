/**
 * 掃**使用處**的文字對比 —— 不是比對 token 值，是比對「這段文字實際疊在哪個底上」。
 *
 * `band-contrast.mjs` 守的是 token 自己的值；但有一整類失效它抓不到：
 * token 每一個都合格，配在一起卻不合格。判例是琥珀 chip ——
 * `--warning-600` 對白 5.02 ✓、對 `--warning-100` 4.51 ✓，但 hover 把底換成
 * `--warning-200` 之後只剩 **4.03 ✗**，而那個 hover 區塊只寫了 background、
 * 文字色是從外層繼承的，所以看程式碼完全不會發現。
 *
 * ## 這支能抓什麼、不能抓什麼
 *
 * 只在**同一個規則區塊或它的祖先**裡同時找得到 `color` 與 `background` 時才判斷。
 * 這涵蓋了 chip / pill / badge / hover 換底這一類「自己帶底色」的元件 ——
 * 也就是實際會出事的那一類。
 *
 * **抓不到**：底色來自更外層的 DOM 祖先（不同檔案、不同元件）。那需要真的算 CSS
 * 串接，成本高一個量級而且會誤判。這支刻意只做可判定的那一半，寧可漏報不要誤報。
 */

/** 「這裡的底色我算不出來」的標記 —— 它會遮蔽祖先的底色，不是被略過 */
const UNKNOWN = Symbol('unknown');

/** 文字的 WCAG AA 門檻 */
const TEXT_AA = 4.5;

/**
 * 非文字元素的門檻（WCAG 1.4.11）。**圖示不是文字。**
 *
 * 這道 gate 原本一律用 4.5 判，結果把一整批 icon 容器算成違規 ——
 * 2026-09 的分診裡 14 筆 baseline 有 **8 筆是 icon**，其中一半本來就合格。
 * 那不是債，是門檻用錯。
 *
 * 判斷「這是不是圖示」只看**宿主選擇器**：`.pi`（primeicons）、
 * 裸 `i`、`svg`、或名字裡有 `icon` 的 element。這是**保守的形狀判斷**，
 * 不試圖理解語意 —— 一個叫 `__label` 的東西裡面塞圖示，這裡認不出來。
 */
const NON_TEXT_AA = 3;

/** 宿主選擇器看起來是圖示嗎 */
const looksLikeIcon = (selector) =>
  /(^|[\s>+~])(\.pi\b|i|svg)([\s.:{]|$)/.test(selector) || /icon/i.test(selector);

const luminance = (rgb) => {
  const [r, g, b] = rgb
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const parseHex = (hex) => {
  const h =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex.length === 7
        ? hex
        : null;
  return h ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null;
};

/** styles.scss 的 `--name: #hex;` → { name: [r,g,b] }。只收不透明的實色 */
export function readTokenPalette(css) {
  const palette = new Map();
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/gm)) {
    const rgb = parseHex(m[2]);
    if (rgb) palette.set(m[1], rgb);
  }
  return palette;
}

/**
 * 把一個宣告值解析成實色。解析不出來就回 null —— 漸層、color-mix、transparent、
 * currentColor、關鍵字全部歸在這裡，**不猜**。
 */
const resolveColor = (value, palette) => {
  const v = value.trim().replace(/\s*!important$/, '');
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return parseHex(v.slice(0, 7));

  // var(--x) 或 var(--x, fallback) —— 取 --x，fallback 只在 --x 不存在時才看
  const varMatch = v.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.+?)\s*)?\)$/);
  if (varMatch) {
    if (palette.has(varMatch[1])) return palette.get(varMatch[1]);
    if (varMatch[2]) return resolveColor(varMatch[2], palette);
  }
  return null;
};

/**
 * @param {string} scss 一支 .scss 的內容
 * @param {Map<string, number[]>} palette readTokenPalette 的結果
 * @returns {{line: number, ratio: number, fg: string, bg: string}[]}
 */
export function usageContrastViolations(scss, palette) {
  const lines = scss.split('\n');
  const found = [];
  const seen = new Set();
  // 每一層一個 frame。**在 block 收合時才判斷**，不是在宣告當下 ——
  // 同一個規則裡的宣告是一起生效的，先看到 color 就拿祖先的底去比會誤報
  // （sidebar 的 badge 就是：color 在 background 前面一行）。
  const stack = [{ line: 0 }];

  // 往上找最近一筆。碰到 UNKNOWN 就停 —— `background: transparent` / 漸層
  // **會遮蔽**祖先的底色，繼續往上找等於拿一個已經被蓋掉的底來判斷。
  const nearest = (key) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const v = stack[i][key];
      if (v === UNKNOWN) return null;
      if (v) return v;
    }
    return null;
  };

  const evaluate = (frame) => {
    // ::before / ::after 多半是裝飾用的小方塊（圓點、線、角標）。它的 background
    // 是**自己那個盒子**的底，不是父層文字的底 —— 拿父層繼承來的 color 去比它
    // 是誤報。判例：styles.scss 的 6px 項目符號，被算成 zinc-600 疊在 accent-500 上 1.58。
    if (frame.pseudo) return;
    const fg = nearest('color');
    const bg = nearest('bg');
    if (!fg || !bg) return;
    const ratio = contrast(fg.rgb, bg.rgb);
    // **圖示走 3:1，不是 4.5。** 見 NON_TEXT_AA 的註解 ——
    // 用錯門檻製造出來的違規不是債，它會讓 baseline 看起來比實際糟。
    const threshold = frame.icon ? NON_TEXT_AA : TEXT_AA;
    if (ratio >= threshold) return;
    // 同一組配對在同一支檔案裡只報一次，不然一個 chip 會刷出十列
    const key = `${fg.src}|${bg.src}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ line: frame.declLine ?? frame.line, ratio, fg: fg.src, bg: bg.src });
  };

  lines.forEach((raw, idx) => {
    const line = raw.replace(/\/\/.*$/, '');
    const lineNo = idx + 1;

    const decl = line.match(/^\s*(color|background|background-color)\s*:\s*([^;{}]+);/);
    if (decl) {
      const top = stack[stack.length - 1];
      const slot = decl[1] === 'color' ? 'color' : 'bg';
      const rgb = resolveColor(decl[2], palette);
      if (rgb) {
        top[slot] = { rgb, src: decl[2].trim() };
        top.declLine = top.declLine ?? lineNo;
      } else if (slot === 'bg') {
        top.bg = UNKNOWN;
      }
    }

    for (const ch of line) {
      if (ch === '{')
        stack.push({
          line: lineNo,
          pseudo: /::(before|after)/.test(line),
          // 圖示的判定沿著祖先繼承：`.x { .pi { … } }` 裡面那層是圖示，
          // 而 `.x__icon { … }` 自己就是。任一層命中就算。
          icon: looksLikeIcon(line) || (stack[stack.length - 1]?.icon ?? false),
        });
      else if (ch === '}' && stack.length > 1) {
        evaluate(stack[stack.length - 1]);
        stack.pop();
      }
    }
  });

  return found;
}
