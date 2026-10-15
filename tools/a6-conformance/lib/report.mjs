// JSON → 人讀的 Markdown（純函式）。

const hex = (c) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c ?? '');
  if (!m) return c;
  if (m[4] === '0') return 'transparent';
  const h = '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('');
  return m[4] && m[4] !== '1' ? `${h}/${m[4]}` : h;
};

const borders = (s) => {
  const sides = ['Top', 'Right', 'Bottom', 'Left']
    .map((k) => [k[0], s['border' + k]])
    .filter(([, v]) => v && !/^0px/.test(v));
  if (!sides.length) return '';
  const uniq = new Set(sides.map(([, v]) => v));
  const fmt = (v) => v.replace(/rgba?\([^)]*\)/, hex);
  return sides.length === 4 && uniq.size === 1
    ? `框 ${fmt(sides[0][1])}`
    : sides.map(([k, v]) => `${k}框 ${fmt(v)}`).join('；');
};

/** 一行樣式摘要：字級／字重／色、底色、框、圓角。 */
export function styleLine(s) {
  if (!s) return '';
  const out = [`${s.fontSize}/${s.fontWeight} ${hex(s.color)}`];
  const bg = hex(s.backgroundColor);
  if (bg && bg !== 'transparent') out.push(`底 ${bg}`);
  const b = borders(s);
  if (b) out.push(b);
  if (s.borderRadius && s.borderRadius !== '0px') out.push(`圓角 ${s.borderRadius}`);
  return out.join(' · ');
}

export const depth = (key) => key.split('>').length - 1;

export function treeLines(parts, base = 0) {
  return parts.map((p) => {
    const ind = '  '.repeat(Math.max(0, depth(p.key) - base - 1));
    const name = p.tpl ? ` 「${p.tpl}」` : '';
    const rows =
      p.kind === 'list'
        ? ` ×${p.rows} 項`
        : p.kind === 'row'
          ? ` ×${p.inRows} 列`
          : p.inRows
            ? `（${p.inRows} 列有）`
            : '';
    const attrs = Object.entries(p.attrs ?? {})
      .filter(([k]) => k !== 'href')
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    const [x, y, w, h] = p.box;
    return `${ind}- **${p.kind}:${p.role}**${name}${rows} — \`${x},${y} ${w}×${h}\` · ${styleLine(p.style)}${attrs ? ` · ${attrs}` : ''}`;
  });
}

/** 一頁的 part 清單（A6 那邊）。caps = [{ tag, width, height, parts, popovers, hooks }]。 */
export function inventoryMarkdown(page, file, caps) {
  const L = [`# A6 part 清單 · ${page}（${file}）`, ''];
  L.push(
    '> 由 `tools/a6-conformance` 產生。key 規則：結構路徑＋角色＋文案模板（數字→`#`、稿的假人名→`{名}`）；',
    '> 列（row）是資料，合成一個 `row`，列內 part 取聯集並記「幾列有」。座標是撐開視窗後的頁面座標（px）。',
    '',
  );
  for (const c of caps) {
    const counts = {};
    for (const p of c.parts) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
    L.push(
      `## ${c.width}px（頁高 ${c.height}）`,
      '',
      `part ${c.parts.length} 個：${Object.entries(counts)
        .map(([k, n]) => `${k} ${n}`)
        .join('、')}`,
      '',
    );
    L.push(...treeLines(c.parts), '');
    for (const [id, pp] of Object.entries(c.popovers)) {
      const trig = c.parts.find((p) => p.attrs?.popovertarget === id);
      L.push(
        `### 彈出物 \`${id}\`（觸發：${trig ? `${trig.role}「${trig.tpl}」` : '不在主樹'}）`,
        '',
      );
      L.push(...(pp ? treeLines(pp, 0) : ['- （點了沒有打開）']), '');
    }
  }
  const hooks = caps[0]?.hooks ?? [];
  if (hooks.length) {
    L.push(
      '## 互動觸發點（第三層的素材）',
      '',
      '從頁內與 a6.js 的 click handler 抓到的選擇器，以及 1440 寬時畫面上有幾個：',
      '',
      '| 選擇器 | 數量 |',
      '| --- | --- |',
    );
    for (const [s, n] of hooks) L.push(`| \`${s}\` | ${n} |`);
    L.push('');
  }
  return L.join('\n');
}
