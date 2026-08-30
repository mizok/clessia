/**
 * 橘帶（band）的對比硬地板。
 *
 * 「橘面上一律近黑字」是設計語言寫死的，但**近黑降透明度**之後就掉出 AA 了：
 * 0.72 壓在 `--accent-vivid` 上只有 4.00:1。這件事沒有任何編譯期訊號 ——
 * 兩席各自憑直覺寫過 0.32~0.72，全部不合格，而畫面看起來「只是淡了一點」。
 * 所以它需要一道 gate 而不是一段註解。
 *
 * 不寫死數字：門檻是從 styles.scss 的**現值**算出來的，之後誰動了 `--accent-vivid`
 * 或 `--band-ink-muted`，這裡會跟著重算。
 */

/** 文字的 WCAG AA 門檻 */
const TEXT_AA = 4.5;
/** 非文字元件（chip、pill、底線這些邊界）的門檻 */
const NON_TEXT_AA = 3;

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

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

/** 半透明前景疊在不透明底色上之後的實際顏色 */
const composite = (fg, bg, alpha) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

const readHex = (css, name) => {
  const m = css.match(new RegExp(`^\\s*${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`, 'm'));
  return m ? m[1] : null;
};

const readRgba = (css, name) => {
  const m = css.match(
    new RegExp(
      `^\\s*${name}\\s*:\\s*rgb\\(\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*/\\s*(\\d+)%\\s*\\)`,
      'm',
    ),
  );
  return m ? { rgb: [+m[1], +m[2], +m[3]], alpha: +m[4] / 100 } : null;
};

/**
 * @param {string} css `apps/web/src/styles.scss` 的內容
 * @returns {string[]} 違規訊息；全部合格時是空陣列
 */
export function bandContrastViolations(css) {
  const vivid = readHex(css, '--accent-vivid');
  const vivid2 = readHex(css, '--accent-vivid-2');
  const zinc900 = readHex(css, '--zinc-900');
  const inkMuted = readRgba(css, '--band-ink-muted');
  const rule = readRgba(css, '--band-rule');

  // token 還沒鑄進去的分支不是這道 gate 的事
  if (!vivid || !vivid2 || !zinc900 || !inkMuted || !rule) return [];

  const violations = [];
  const ink = toRgb(zinc900);

  // 硬編碼的 rgb 三元組必須跟 --zinc-900 一致，否則換色系時橘帶會留在上一代
  // —— 這正是 #97 的教訓：改 token 值修不到繞過 token 的地方。
  for (const [name, token] of [
    ['--band-ink-muted', inkMuted],
    ['--band-rule', rule],
  ]) {
    if (token.rgb.join(',') !== ink.join(',')) {
      violations.push(
        `${name} 的 rgb(${token.rgb.join(' ')}) 跟 --zinc-900（${zinc900}）不一致 —— ` +
          `橘帶的近黑字必須跟著中性階走，否則換色系時它會留在上一代`,
      );
    }
  }

  for (const [groundName, groundHex] of [
    ['--accent-vivid', vivid],
    ['--accent-vivid-2', vivid2],
  ]) {
    const ground = toRgb(groundHex);
    for (const [name, token, floor, kind] of [
      ['--band-ink-muted', inkMuted, TEXT_AA, '文字的 AA 門檻'],
      ['--band-rule', rule, NON_TEXT_AA, '非文字元件的門檻'],
    ]) {
      const ratio = contrast(composite(token.rgb, ground, token.alpha), ground);
      if (ratio < floor) {
        violations.push(
          `${name}（透明度 ${token.alpha}）壓在 ${groundName} 上只有 ` +
            `${ratio.toFixed(2)}:1，低於${kind} ${floor}:1`,
        );
      }
    }
  }

  return violations;
}
