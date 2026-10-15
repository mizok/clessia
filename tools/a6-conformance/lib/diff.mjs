// 第二層：A6 part ↔ app part 配對，量幾何與樣式差（純函式，spec 在 diff.test.mjs）。
import { TOL, posOk, sizeOk, styleEq } from './normalize.mjs';
import { styleLine } from './report.mjs';

const segs = (key) => key.split('>').filter(Boolean);
const kr = (p) => `${p.kind}:${p.role}`;
// 寬鬆 segment：`family` 把同類角色併在一起（searchbox／textbox／combobox 都是輸入框）；
// `tplOnly` 只留文案模板（`text:div[國三]` 與 `heading:h2[國三]` 視為同一個）。沒有文案的不放寬。
const FAMILY = { searchbox: 'input', textbox: 'input', combobox: 'input' };
const family = (seg) => seg.replace(/^(\w+):(\w+)/, (_, k, r) => `${k}:${FAMILY[r] ?? r}`);
const tplOnly = (seg) => {
  const m = /^[^[]*(\[.*\])(~\d+)?$/.exec(seg);
  return m && m[1] !== '[]' ? m[1] + (m[2] ?? '') : seg;
};

/**
 * 配對。順序：
 * 1. mapping（A6 key → app key，`config.mjs` 的 PAGES[頁].mapping）
 * 2. 完整 key 相同
 * 3. key 後綴唯一（由短到長；有歧義就多帶一層祖先），依序：嚴格 → 同類角色 → 只看文案
 * 4. 已配對的父層底下，同 kind:role 的未配對子項兩邊數量相同 → 依 DOM 順序配（文案不同另報）
 */
export function matchParts(a6, app, mapping = {}) {
  const pairs = new Map(); // a6 key → app key
  const used = new Set();
  const appKeys = new Set(app.map((p) => p.key));
  const take = (ak, bk) => (pairs.set(ak, bk), used.add(bk));
  for (const [ak, bk] of Object.entries(mapping))
    if (a6.some((p) => p.key === ak) && appKeys.has(bk)) take(ak, bk);
  for (const p of a6)
    if (!pairs.has(p.key) && appKeys.has(p.key) && !used.has(p.key)) take(p.key, p.key);

  for (const norm of [(s) => s, family, tplOnly]) {
    for (let progress = true; progress;) {
      progress = false;
      const restA = a6.filter((p) => !pairs.has(p.key));
      const restB = app.filter((p) => !used.has(p.key));
      const maxLen = Math.max(0, ...restA.map((p) => segs(p.key).length));
      for (let n = 1; n <= maxLen && !progress; n++) {
        const group = (list) => {
          const m = new Map();
          for (const p of list) {
            const s = segs(p.key);
            if (s.length < n) continue;
            const k = s.slice(-n).map(norm).join('>');
            m.set(k, (m.get(k) ?? []).concat(p));
          }
          return m;
        };
        const gb = group(restB);
        for (const [s, as] of group(restA)) {
          const bs = gb.get(s);
          if (as.length === 1 && bs?.length === 1) (take(as[0].key, bs[0].key), (progress = true));
        }
      }
    }
  }

  const kidsOf = (list, parent, isFree) => list.filter((p) => p.parent === parent && isFree(p));
  // 新配上的父層也要往下配，所以用佇列
  const queue = [[null, null], ...pairs];
  while (queue.length) {
    const [pa, pb] = queue.shift();
    const ka = kidsOf(a6, pa, (p) => !pairs.has(p.key));
    const kb = kidsOf(app, pb, (p) => !used.has(p.key));
    for (const role of new Set(ka.map(kr))) {
      const xa = ka.filter((p) => kr(p) === role),
        xb = kb.filter((p) => kr(p) === role);
      if (xa.length === xb.length)
        xa.forEach((p, i) => (take(p.key, xb[i].key), queue.push([p.key, xb[i].key])));
    }
  }
  return pairs;
}

const normBorder = (v) =>
  !v || /^0px/.test(v) || / none /.test(v) || /rgba\(0, 0, 0, 0\)/.test(v) ? 'none' : v;
const normDisplay = (v) => (v === 'list-item' ? 'block' : v);
const TEXT_PROPS = ['fontSize', 'fontWeight', 'lineHeight', 'color'];
const BORDERS = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'];
const BOX_PROPS = ['backgroundColor', ...BORDERS, 'borderRadius', 'padding'];

/**
 * 樣式差。只比「看得見」的：字級／字重／行高／顏色只在自己帶文字的 part 上比（容器上那是繼承值）；
 * 0 寬或透明的框線一律算沒有；gap 只在 flex／grid 上比。
 */
export function styleDiffs(a, b, tol = TOL) {
  const out = [];
  const cmp = (k, x, y) => {
    if (!styleEq(k, x, y, tol)) out.push(`${k} ${x} → ${y}`);
  };
  if (a.own || b.own) for (const k of TEXT_PROPS) cmp(k, a.style[k], b.style[k]);
  for (const k of BOX_PROPS) {
    const n = BORDERS.includes(k) ? normBorder : (v) => v;
    cmp(k, n(a.style[k]), n(b.style[k]));
  }
  cmp('display', normDisplay(a.style.display), normDisplay(b.style.display));
  if (/flex|grid/.test(a.style.display + b.style.display))
    for (const k of ['rowGap', 'columnGap']) cmp(k, a.style[k], b.style[k]);
  return out;
}

/**
 * 把「包裝層」span（只包一層同文案文字的子元素）的可見樣式併回控制項：app 的導覽連結把
 * 「目前頁」底線與文字畫在內層 span 上，不併的話會被報成「沒有底線」。
 */
export function withWrapper(p, list) {
  const w = list.find((q) => q.parent === p.key && q.kind === 'text' && q.tpl === p.tpl);
  if (!w) return p;
  const style = { ...p.style };
  for (const k of [...BORDERS, 'backgroundColor'])
    if (normBorder(style[k]) === 'none' || style[k] === 'rgba(0, 0, 0, 0)') style[k] = w.style[k];
  if (!p.own) for (const k of TEXT_PROPS) style[k] = w.style[k];
  return { ...p, own: p.own || w.own, style };
}

const sgn = (n) => (n > 0 ? '+' + n : String(n));
const byKey = (parts) => new Map(parts.map((p) => [p.key, p]));
const count = (p) => p.rows ?? p.inRows;

/** 最近的、符合 has 的祖先（找不到＝null）。 */
function refOf(part, map, has) {
  for (let k = part.parent; k; k = map.get(k)?.parent ?? null) if (has(k)) return map.get(k);
  return null;
}

/**
 * 差異列。status：
 * - `缺`／`多`：A6 有 app 沒有／反過來（只列最上層，子 part 併成「含 N 個」）
 * - `角色`：配上了但 kind/role 不同（例：章名 A6 是 div，app 是 h2）
 * - `文案`：依位置配上、但文案模板不同
 * - `位置`／`尺寸`／`樣式`：超出容差的設計差
 * - `資料差`：列數、文字長度、隨資料增減的同型區塊造成的差 —— 不算設計差
 */
export function diffParts(a6Cap, appCap, mapping = {}, tol = TOL) {
  const A = a6Cap.parts,
    B = appCap.parts;
  const pairs = matchParts(A, B, mapping);
  const appMatched = new Set(pairs.values());
  const mA = byKey(A),
    mB = byKey(B);
  const freeA = (p) => !!p && !pairs.has(p.key),
    freeB = (p) => !!p && !appMatched.has(p.key);
  const rows = [];

  // 同一個父層下、已有同 kind:role 的已配對兄弟 → 隨資料重複的區塊（年級章、清單列）
  // 容器（章、清單）一律算；control／text 要文案帶數字才算（「高三 #」像資料，「已停用」是設計多出來的選項）
  const repeated = (p, list, isFree) =>
    (['landmark', 'list', 'row'].includes(p.kind) || p.tpl.includes('#')) &&
    list.some((q) => q.parent === p.parent && kr(q) === kr(p) && !isFree(q));
  // 只包一層文字的 span（連結文字放在 span 裡）：DOM 形狀，不是設計
  const wrapper = (p, m) => p.kind === 'text' && p.tpl === m.get(p.parent)?.tpl;
  const topFree = (list, m, isFree) =>
    list.filter((p) => isFree(p) && !wrapper(p, m) && !refOf(p, m, (k) => isFree(m.get(k))));
  // 列內 part 不是每列都有（「待繳費」小標）→ 有沒有出現取決於資料
  const rowOf = (p, m) => refOf(p, m, (k) => m.get(k)?.kind === 'row');
  const cond = (p, m) =>
    p.kind !== 'row' && p.inRows > 0 && rowOf(p, m) && p.inRows < rowOf(p, m).inRows;
  const nKids = (list, key) => list.filter((p) => p.key.startsWith(key + '>')).length;
  const dataA = new Set(),
    dataB = new Set();

  for (const [list, m, isFree, side] of [
    [A, mA, freeA, 'a6'],
    [B, mB, freeB, 'app'],
  ])
    for (const p of topFree(list, m, isFree)) {
      const rep = repeated(p, list, isFree);
      if (rep) (side === 'a6' ? dataA : dataB).add(p.key);
      const kids = nKids(list, p.key);
      rows.push({
        status: rep ? '資料差' : side === 'a6' ? '缺' : '多',
        a6: side === 'a6' ? p.key : null,
        app: side === 'app' ? p.key : null,
        detail:
          `${rep ? `${side === 'a6' ? 'A6' : 'app'} 多一個同型區塊（數量隨資料）：` : ''}` +
          `${kr(p)}「${p.tpl}」${kids ? `（含 ${kids} 個子 part）` : ''}` +
          `${cond(p, m) ? `（列內條件式：${p.inRows}／${rowOf(p, m).inRows} 列有，可能隨資料）` : ''}` +
          `${side === 'a6' ? ` · ${styleLine(p.style)}` : ''}`,
      });
    }
  for (const [ak, bk] of pairs) {
    const a = mA.get(ak),
      b = mB.get(bk);
    if ((a.kind === 'list' || a.kind === 'row') && count(a) !== count(b))
      (dataA.add(ak), dataB.add(bk));
  }
  // y 的差是不是資料造成的：同一個參考容器裡、這個 part 上方有資料性的東西
  const dataAbove = (p, ref, set, m) =>
    [...set].some((k) => {
      const q = m.get(k);
      return q && q.box[1] < p.box[1] && (!ref || k.startsWith(ref.key + '>'));
    });

  for (const [ak, bk] of pairs) {
    const a = mA.get(ak),
      b = mB.get(bk);
    const push = (status, detail) => rows.push({ status, a6: ak, app: bk, detail });
    if (kr(a) !== kr(b)) push('角色', `${kr(a)} → ${kr(b)}`);
    const inRow = a.inRows > 0 && a.kind !== 'row';
    if (a.tpl !== b.tpl && a.kind !== 'list' && a.kind !== 'row' && !inRow)
      push('文案', `「${a.tpl}」→「${b.tpl}」`);

    const ra = refOf(a, mA, (k) => pairs.has(k)),
      rb = ra ? mB.get(pairs.get(ra.key)) : null;
    const [ax, ay, aw, ah] = a.box,
      [bx, by, bw, bh] = b.box;
    const dx = bx - (rb?.box[0] ?? 0) - (ax - (ra?.box[0] ?? 0)); // app − A6
    const dy = by - (rb?.box[1] ?? 0) - (ay - (ra?.box[1] ?? 0));
    if (!posOk(0, dx, tol) || !posOk(0, dy, tol)) {
      const data =
        posOk(0, dx, tol) && (dataAbove(a, ra, dataA, mA) || dataAbove(b, rb, dataB, mB));
      push(
        data ? '資料差' : '位置',
        `相對${ra ? `「${ra.tpl || ra.role}」` : '頁面'} Δx ${sgn(dx)}、Δy ${sgn(dy)}（app − A6）${data ? '；上方內容隨資料' : ''}`,
      );
    }
    const inner =
      [...dataA].some((k) => k.startsWith(ak + '>')) ||
      [...dataB].some((k) => k.startsWith(bk + '>'));
    const container = dataA.has(ak)
      ? `列數 ${count(a)}→${count(b)}`
      : inner
        ? '內含隨資料的區塊'
        : '';
    // 文字不同只解釋寬度；高度要行數也不同才算（29→44 這種觸控下限是設計差）
    const lines = (p) => Math.round(p.box[3] / (parseFloat(p.style.lineHeight) || p.box[3]));
    if (!sizeOk(aw, bw, tol)) {
      const why = container || (a.text !== b.text ? '文字不同' : '');
      push(why ? '資料差' : '尺寸', `寬 ${aw}→${bw}${why ? `；${why}` : ''}`);
    }
    if (!sizeOk(ah, bh, tol)) {
      const why = container || (a.text !== b.text && lines(a) !== lines(b) ? '文字行數不同' : '');
      push(why ? '資料差' : '尺寸', `高 ${ah}→${bh}${why ? `；${why}` : ''}`);
    }
    const st = styleDiffs(withWrapper(a, A), withWrapper(b, B), tol);
    if (st.length) push('樣式', st.join('；'));
  }
  const order = { 缺: 0, 角色: 1, 文案: 2, 位置: 3, 尺寸: 4, 樣式: 5, 多: 6, 資料差: 7 };
  return rows.sort((x, y) => order[x.status] - order[y.status]);
}

const short = (k) => (k ? segs(k).slice(-2).join(' › ') : '—');
const where = (r) => (r.pop ? `（彈出物 ${r.pop}）` : '');

/** 同一個父層、同狀態、同細節的列合成一列（「更多」裡 14 個連結都是「高 29→44」只列一次）。 */
export function groupRows(rows) {
  const parent = (k) => (k ? segs(k).slice(0, -1).join('>') : '');
  const out = new Map();
  for (const r of rows) {
    const g = [
      r.status,
      r.pop ?? '',
      parent(r.a6 ?? r.app),
      r.detail.replace(/「[^」]*」/g, '「…」'),
    ].join('|');
    const hit = out.get(g);
    if (hit) hit.n++;
    else out.set(g, { ...r, n: 1 });
  }
  return [...out.values()];
}

export function diffMarkdown(page, cfg, sections) {
  const L = [`# A6 conformance · ${page}：app（${cfg.app}）vs A6（${cfg.a6}）`, ''];
  L.push(
    `容差：位置 ±${TOL.pos}px（相對最近的已配對祖先）；尺寸 ±${TOL.size}px 或 ±${TOL.sizeRatio * 100}%（取大）；字級／行高 ±${TOL.font}px；其餘樣式逐字。`,
    '「資料差」＝列數、文字長度、隨資料增減的同型區塊造成的差，不算設計差，排在最後。同一父層下細節相同的列合併為「×N」。',
    '',
  );
  for (const s of sections) {
    const c = {};
    for (const r of s.rows) c[r.status] = (c[r.status] ?? 0) + 1;
    L.push(
      `## ${s.width}px`,
      '',
      Object.entries(c)
        .map(([k, n]) => `${k} ${n}`)
        .join('、') || '沒有差異',
      '',
    );
    L.push('| 狀態 | A6 part | app part | 差異 |', '| --- | --- | --- | --- |');
    for (const r of groupRows(s.rows))
      L.push(
        `| ${r.status}${where(r)} | ${short(r.a6)}${r.n > 1 ? ` 等 ${r.n} 個` : ''} | ${short(r.app)} | ${r.detail.replace(/\|/g, '\\|')} |`,
      );
    L.push('');
  }
  return L.join('\n');
}
