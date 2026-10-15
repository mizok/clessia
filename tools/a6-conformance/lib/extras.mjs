// 「現況有、A6 沒畫」的功能盤點（#1314，10-15 使用者：舊有新無的要提出來討論，不是預設保留）。
// 從第二層的「多」列出發，依功能歸組，給使用者逐項裁。純函式；裁圖在 run.mjs。
import { isShell } from './diff.mjs';

const segs = (k) => k.split('>').filter(Boolean);

/** 這一列是不是「功能」：多包一層的結構、拆開的文字碎片不是。回傳不列的理由（null＝要列）。 */
export function skipReason(r, part, byKey = new Map()) {
  if (/包住 \d+ 個已配對/.test(r.detail) && !/含 \d+ 個子 part/.test(r.detail))
    return '結構：多包一層，裡面都配上了';
  // 只有父層也是文字時才算「被拆開的文字」（「#」＋「位」）；浮層裡的「狀態」是選項組的標籤
  if (part?.kind === 'text' && byKey.get(part.parent)?.kind === 'text' && part.tpl.length <= 2)
    return '結構：文字被拆成兩段（例：「#」＋「位」）';
  if (part?.kind === 'list' || part?.kind === 'row') return '結構：清單／列的包裝';
  if (part?.tpl === '#') return '資料：純數字';
  // PrimeNG 下拉／日期的內部按鈕：屬於它的欄位，不是另一個功能
  if (
    part?.tpl === 'dropdown trigger' ||
    (/^p-(select|multiselect|datepicker|autocomplete)$/.test(part?.host ?? '') &&
      part.kind !== 'control')
  )
    return '結構：下拉／日期元件的內部';
  return null;
}

/** 呈現方式（給使用者看的詞，不是 DOM）。 */
export function presentation(part, inner = []) {
  if (!part) return '—';
  const each = part.inRows > 0 ? '每一列都有的' : '';
  if (part.host === 'p-paginator' || inner.some((q) => / Page$/.test(q.tpl))) return '分頁器';
  if (part.kind === 'control') {
    const r =
      {
        button: '按鈕',
        link: '連結',
        textbox: '輸入欄位',
        searchbox: '輸入欄位',
        combobox: '下拉／輸入欄位',
        checkbox: '勾選框',
        radio: '選項',
      }[part.role] ?? part.role;
    return `${each}常駐${r}`;
  }
  if (part.kind === 'landmark' && part.role === 'search') return '搜尋／篩選區塊';
  if (part.kind === 'landmark' || part.kind === 'heading') return '整區塊';
  if (part.kind === 'text') return `${each}文字`;
  return part.kind;
}

// 給人看的位置名：最近的有名字的祖先，否則用 landmark 的白話
const PLACE = {
  banner: '頂欄',
  main: '主內容',
  search: '工具列',
  navigation: '導覽',
  dialog: '浮層',
  popover: '浮層',
  region: '區塊',
};
function placeOf(part, byKey) {
  for (let k = part.parent; k; k = byKey.get(k)?.parent) {
    const q = byKey.get(k);
    if (!q) break;
    if (q.kind === 'landmark' && q.tpl) return `「${q.tpl}」`;
    if (q.kind === 'landmark' && PLACE[q.role]) return PLACE[q.role];
  }
  return '頁面';
}

// 結構包裝（role=search、form、toolbar）：它本身不是功能，裡面多出來的控制項才是
const WRAPPER = new Set(['search', 'form', 'toolbar']);
// 列內控制項的名字常帶資料（「出勤測試學生# 的更多動作」）：只留「的」後面
// 控制項名字常帶資料（「出勤測試學生# 的更多動作」「黃佳穎的編輯」）：只留「的」後面
const plainName = (p) =>
  p.kind === 'control' || p.inRows > 0 ? p.tpl.replace(/^.*的/, '') : p.tpl;

/**
 * pages：[{ page, cfg, widths: [{ width, tag, rows（已 classify）, parts（app 全部 part，含浮層）, height }] }]
 * 回傳 { shell: [...], pages: [{ page, cfg, features, skipped }] }。殼層的只收一次。
 */
export function collectExtras(pages) {
  const shellSeen = new Map();
  const out = [];
  for (const { page, cfg, widths } of pages) {
    const feats = new Map();
    const skipped = [];
    for (const { width, tag, rows, parts, height } of widths) {
      const byKey = new Map(parts.map((p) => [p.key, p]));
      // 1. 候選 part：結構包裝拆開成裡面的東西，其餘照列
      const cands = [];
      for (const r of rows.filter((x) => x.status === '多' && x.app)) {
        const part = byKey.get(r.app);
        const why = skipReason(r, part, byKey);
        if (why) {
          skipped.push({ width, key: r.app, why, tpl: part?.tpl ?? '' });
          continue;
        }
        if (part?.kind === 'landmark' && WRAPPER.has(part.role)) {
          for (const q of r.inner ?? []) {
            const qp = byKey.get(q.key);
            if (
              qp &&
              qp.kind !== 'landmark' &&
              !skipReason({ detail: '' }, qp, byKey) &&
              !(qp.kind === 'text' && byKey.get(qp.parent)?.kind === 'control')
            )
              cands.push({ r, part: qp, fromWrapper: true });
          }
          skipped.push({
            width,
            key: r.app,
            why: `結構：${part.role} 包裝（裡面的功能已拆開列）`,
            tpl: part.tpl,
          });
        } else cands.push({ r, part });
      }
      // 2. 同一個父層、上下相鄰（60px 內）的候選合成一組（分頁器、篩選裡的一組選項）
      const groups = [];
      for (const c of cands.sort((x, y) => (x.part?.box[1] ?? 0) - (y.part?.box[1] ?? 0))) {
        const g = groups.find(
          (g) =>
            g[0].part &&
            c.part &&
            g[0].part.parent === c.part.parent &&
            g[0].r.pop === c.r.pop &&
            Math.abs(g.at(-1).part.box[1] - c.part.box[1]) < 60,
        );
        if (g) g.push(c);
        else groups.push([c]);
      }
      // 只有分頁器、或組裡有文字標籤的選項組（「狀態：在籍／已停用／全部」）才合併；
      // 工具列上相鄰的不同按鈕（「⋯」與「新增學生」）是不同功能，拆回單項
      const isGroup = (g) =>
        g.some((c) => c.part && (c.part.host === 'p-paginator' || / Page$/.test(c.part.tpl))) ||
        (g.length > 1 && g.some((c) => c.part?.kind === 'text' && !c.part.tpl.includes('#')));
      const singles = groups.flatMap((g) => (isGroup(g) ? [g] : g.map((c) => [c])));
      // 同一個父層、同樣呈現的單項 ≥3 個 ＝ 一份資料清單（班級的學生列、聯絡簿每則、課程卡）。
      // 它沒配上是因為稿用了不同的結構畫同一份清單 —— 合成一項，不逐筆列
      // 形狀＝父層的類型（去掉文案，每個課程區塊都算同一種父層）＋組內各項的類型序列。
      // 從結構包裝拆出來的鈕是刻意擺的（工具列的「篩選」「⋯」），不參與
      const shape = (u) =>
        u[0].part && !u.some((c) => c.fromWrapper)
          ? `${(u[0].part.parent ?? '').replace(/\[[^\]]*\](~\d+)?$/, '')}|${u.map((c) => `${c.part?.kind}:${c.part?.role}`).join(',')}`
          : null;
      const counts = new Map();
      for (const u of singles) if (shape(u)) counts.set(shape(u), (counts.get(shape(u)) ?? 0) + 1);
      const units = [];
      const lists = new Map();
      for (const u of singles) {
        const k = shape(u);
        if (k && counts.get(k) >= 3) {
          if (!lists.has(k))
            units.push((lists.set(k, Object.assign([...u], { list: true, n: 1 })), lists.get(k)));
          else (lists.get(k).push(...u), lists.get(k).n++);
        } else units.push(u);
      }
      // 3. 每組一個功能
      for (const g of units) {
        const ps = g.map((c) => c.part).filter(Boolean);
        const lead = g[0].part;
        const r = g[0].r;
        const pager = ps.some((p) => p.host === 'p-paginator' || / Page$/.test(p.tpl));
        const label = ps.find((p) => p.kind === 'text' && !p.tpl.includes('#'))?.tpl;
        const opts = ps.filter((p) => p !== ps.find((x) => x.tpl === label)).map(plainName);
        if (g.list) {
          const sample = ps.slice(0, 2).map(plainName).join('、');
          g.listName = `資料清單 ${g.n} 項（例：${sample}）`;
          g.listType = `清單（每項：${presentation(lead)}）`;
        }
        const name =
          g.listName ??
          (pager
            ? '分頁器'
            : label && ps.length > 1
              ? `${label}（${opts.join('／')}）`
              : ps.length > 1
                ? ps.map(plainName).join('、')
                : plainName(lead ?? { tpl: '?' }) || lead?.role || '?');
        const type =
          g.listType ??
          (pager
            ? '分頁器'
            : ps.length > 1
              ? `一組 ${ps.length} 個（${[...new Set(ps.map((p) => presentation(p)))].sort().join('、')}）`
              : presentation(lead));
        const box = ps.length
          ? (() => {
              const x0 = Math.min(...ps.map((p) => p.box[0])),
                y0 = Math.min(...ps.map((p) => p.box[1]));
              const x1 = Math.max(...ps.map((p) => p.box[0] + p.box[2])),
                y1 = Math.max(...ps.map((p) => p.box[1] + p.box[3]));
              return [x0, y0, x1 - x0, y1 - y0];
            })()
          : null;
        const id = `${name}|${type}`;
        const pos = box
          ? box[1] < height / 3
            ? '上段'
            : box[1] < (height * 2) / 3
              ? '中段'
              : '下段'
          : '';
        const where = r.pop ? `浮層「${r.pop}」` : lead ? placeOf(lead, byKey) : '頁面';
        const dev = g.map((c) => c.r).find((x) => x.bucket === '已記錄偏離')?.dev ?? null;
        const target = isShell(r) ? shellSeen : feats;
        // 判讀：清單、對面同位置有沒配上的同型 part、純文案 —— 這些多半不是「多出的功能」
        const missHere = lead
          ? rows.find(
              (x) =>
                x.status === '缺' &&
                x.a6 &&
                x.kind === lead.kind &&
                x.a6.split('>').slice(0, -1).join('>') === lead.parent,
            )
          : null;
        const hint = g.list
          ? '疑似：稿也有這份清單，只是結構不同沒配上（看截圖）'
          : missHere
            ? `疑似：對應稿上的「${/\[([^\]]*)\]/.exec(missHere.a6.split('>').at(-1))?.[1] ?? ''}」（同位置同類型，文案或結構不同沒配上）`
            : ps.every((p) => p.kind === 'text')
              ? '文案（說明／空狀態／欄位標籤），不是操作'
              : '功能';
        const f = target.get(id) ?? {
          name,
          type,
          hint,
          dev,
          sizes: {},
          where: {},
          keys: {},
          pop: r.pop ?? null,
          pages: new Set(),
        };
        f.sizes[width] = box ? `${box[2]}×${box[3]}` : '—';
        f.where[width] = `${where}${pos ? `（${pos}）` : ''}`;
        f.keys[width] = { tag, box, popId: /^pop\[([^\]]+)\]/.exec(r.app)?.[1] ?? null };
        f.pages.add(page);
        f.dev ??= dev;
        target.set(id, f);
      }
    }
    out.push({ page, cfg, features: [...feats.values()], skipped });
  }
  return { shell: [...shellSeen.values()], pages: out };
}

const cell = (t) => String(t ?? '').replace(/\|/g, '\\|');
const featRow = (f, shots) =>
  [
    cell(f.name),
    cell(
      Object.entries(f.where)
        .map(([w, x]) => `${w}：${x}`)
        .join('<br>'),
    ),
    cell(f.type),
    cell(
      Object.entries(f.sizes)
        .map(([w, x]) => `${w}：${x}`)
        .join('<br>'),
    ),
    f.dev ? cell(`已登偏離：${f.dev.reason}（${f.dev.source}）`) : '—',
    shots.map((x) => `\`${x}\``).join('<br>') || '—',
  ].reduce((acc, c) => `${acc} ${c} |`, '|');

export function extrasMarkdown({ shell, pages }, shotsOf) {
  const total = shell.length + pages.reduce((n, p) => n + p.features.length, 0);
  const devs = [...shell, ...pages.flatMap((p) => p.features)].filter((f) => f.dev).length;
  const L = [
    '# 現況有、A6 沒畫的功能（多出功能清單）',
    '',
    '> 由 `tools/a6-conformance` 第二層的「多」（app 有、稿沒有的 part）依功能歸組。使用者 10-15：舊有新無的要提出來討論，不是預設保留。',
    '> 「已登偏離」欄＝目前 `DEVIATIONS` 已把它當成刻意保留（R2 等），**同樣要重裁**。尺寸是 app 實測的寬×高（px）；位置的上／中／下段是相對整頁高。',
    '> 截圖路徑相對於這份檔所在的目錄（`~/.cache/clessia-a6-conformance/out/`），是 app 的裁圖（浮層內的功能取浮層開著時的畫面）。登入身分 admin@demo（全部分校、單一身分）—— 只在特定資料或身分下才出現的功能可能沒抓到。',
    '',
    `共 **${total}** 項（殼層 ${shell.length}、各頁 ${total - shell.length}；其中 ${devs} 項目前登為偏離）。`,
    '',
    `判讀：${Object.entries(
      [...shell, ...pages.flatMap((p) => p.features)].reduce((m, f) => {
        const k = f.hint.startsWith('疑似：稿也有這份清單')
          ? '疑似同一份清單'
          : f.hint.startsWith('疑似：對應')
            ? '疑似對應稿上某項'
            : f.hint.startsWith('文案')
              ? '文案'
              : '功能';
        return { ...m, [k]: (m[k] ?? 0) + 1 };
      }, {}),
    )
      .map(([k, n]) => `${k} ${n}`)
      .join(
        '、',
      )}。「功能」是真正要裁的；「疑似」兩類請看截圖確認是不是同一個東西；「文案」是文字差。`,
    '',
  ];
  const head = [
    '| 功能 | 在哪 | 怎麼呈現 | 判讀 | 佔多少（寬×高） | 目前狀態 | 截圖 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  L.push(
    '## 殼層（每頁都有）',
    '',
    ...head,
    ...shell.map((f) => featRow(f, shotsOf('shell', f))),
    '',
  );
  for (const p of pages) {
    L.push(`## ${p.page}：app \`${p.cfg.app}\` ↔ 稿 \`${p.cfg.a6}\``, '');
    if (!p.features.length) L.push('沒有多出的功能。', '');
    else L.push(...head, ...p.features.map((f) => featRow(f, shotsOf(p.page, f))), '');
    if (p.skipped.length)
      L.push(
        `<details><summary>沒列入的「多」（結構差，不是功能）${p.skipped.length} 條</summary>`,
        '',
        ...p.skipped.map(
          (x) => `- ${x.width}：\`${x.key.split('>').slice(-2).join(' › ')}\` —— ${x.why}`,
        ),
        '',
        '</details>',
        '',
      );
  }
  return L.join('\n');
}
