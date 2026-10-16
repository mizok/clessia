// PR 驗收用的前後對照（#1314，10-15 計畫席：各席自己切前後報告、混用工具版本 → 不是同一把尺）。
// 同一個工具版本對兩個 app 版本各跑一次；這裡只做統計與表格（純函式），跑的部分在 run.mjs。
import { isShell } from './diff.mjs';

export const SECTIONS = ['殼層', '頁面', '全站'];
export const COLS = ['待修', '已記錄偏離', '資料差', '工具限制'];

const sectionOf = (r) => (r.bucket === '全站' ? '全站' : isShell(r) ? '殼層' : '頁面');

/** 一個寬度的分欄計數：{ 殼層: { 待修: n, … }, 頁面: {…}, 全站: { 件數, 命中 } }。 */
export function summarize(rows) {
  const out = Object.fromEntries(
    SECTIONS.map((s) => [s, Object.fromEntries(COLS.map((c) => [c, 0]))]),
  );
  out.全站 = { 件數: 0, 命中: 0 };
  for (const r of rows) {
    const s = sectionOf(r);
    if (s === '全站') {
      out.全站.件數++;
      out.全站.命中 += Number(/命中 (\d+) 處/.exec(r.detail)?.[1] ?? 0);
    } else if (COLS.includes(r.bucket)) out[s][r.bucket]++;
  }
  return out;
}

// 同一條差異在兩次跑之間的識別：狀態＋兩邊 key＋彈出物（細節裡的數字會變，不拿來比）
const ident = (r) => [r.status, r.pop ?? '', r.a6 ?? '', r.app ?? ''].join('|');

/** head 才有的待修（回歸）與 base 才有的待修（修掉了）。 */
export function todoDelta(baseRows, headRows) {
  const todo = (rows) => new Map(rows.filter((r) => r.bucket === '待修').map((r) => [ident(r), r]));
  const b = todo(baseRows),
    h = todo(headRows);
  return {
    added: [...h].filter(([k]) => !b.has(k)).map(([, r]) => r),
    removed: [...b].filter(([k]) => !h.has(k)).map(([, r]) => r),
  };
}

const arrow = (a, b) => (a === b ? `${a}` : `${a} → **${b}**`);
const short = (k) => (k ? k.split('>').filter(Boolean).slice(-2).join(' › ') : '—');
const cell = (t) => String(t).replace(/\|/g, '\\|');

/**
 * meta：{ tool, toolDirty, base: { ref, sha }, head: { ref, sha }, api, state, page, cfg }
 * widths：[{ width, base: rows, head: rows }]
 */
export function compareMarkdown(meta, widths) {
  const L = [
    `## A6 conformance 前後對照 · ${meta.page}（app \`${meta.cfg.app}\` ↔ 稿 \`${meta.cfg.a6}\`）`,
    '',
    `- 工具：\`tools/a6-conformance\` @ \`${meta.tool}\`${meta.toolDirty ? '（**有未提交的修改** —— 這張表不可重現）' : ''}`,
    `- base：\`${meta.base.ref}\` @ \`${meta.base.sha}\`；head：\`${meta.head.ref}\` @ \`${meta.head.sha}\``,
    `- 兩邊共用：API \`${meta.api}\`、登入 \`${meta.state}\`、稿 \`${meta.cfg.a6}\``,
    '',
  ];
  for (const w of widths) {
    const b = summarize(w.base),
      h = summarize(w.head);
    L.push(
      `### ${w.width}px`,
      '',
      `| 段 | ${COLS.join(' | ')} |`,
      `| --- | ${COLS.map(() => '---').join(' | ')} |`,
    );
    for (const s of ['殼層', '頁面'])
      L.push(`| ${s} | ${COLS.map((c) => arrow(b[s][c], h[s][c])).join(' | ')} |`);
    L.push(
      `| 全站（#1591） | ${arrow(b.全站.件數, h.全站.件數)} 條、命中 ${arrow(b.全站.命中, h.全站.命中)} 處 | | | |`,
      '',
    );
    const d = todoDelta(w.base, w.head);
    if (d.added.length) {
      L.push(`**head 新增的待修 ${d.added.length} 條**（回歸先看這裡）：`, '');
      for (const r of d.added.slice(0, 20))
        L.push(
          `- ${r.status}${r.pop ? `（彈出物 ${r.pop}）` : ''} \`${cell(short(r.a6 ?? r.app))}\`：${cell(r.detail.slice(0, 120))}`,
        );
      if (d.added.length > 20) L.push(`- …另 ${d.added.length - 20} 條`);
      L.push('');
    }
    L.push(`修掉的待修 ${d.removed.length} 條。`, '');
  }
  return L.join('\n');
}
