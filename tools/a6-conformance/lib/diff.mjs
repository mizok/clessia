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

  // 每一輪的正規化作用在整串 segment 上。最後一輪拿掉 `list`：app 用 ul/li、稿用 div 格線（R7），
  // 同一列在兩邊只差多一層 list
  const passes = [
    (ss) => ss,
    (ss) => ss.map(family),
    (ss) => ss.map(tplOnly),
    (ss) => ss.filter((x) => x !== 'list').map(tplOnly),
  ];
  for (const norm of passes) {
    for (let progress = true; progress;) {
      progress = false;
      const restA = a6.filter((p) => !pairs.has(p.key));
      const restB = app.filter((p) => !used.has(p.key));
      const maxLen = Math.max(0, ...restA.map((p) => norm(segs(p.key)).length));
      for (let n = 1; n <= maxLen && !progress; n++) {
        const group = (list) => {
          const m = new Map();
          for (const p of list) {
            const s = norm(segs(p.key));
            if (s.length < n) continue;
            // 完全不帶文案的短後綴（「text:span」「control:button>text:span」）是弱證據：
            // 剩下沒配上的 part 很少時它常常「剛好唯一」，配到別的列裡去。要延伸到有文案的段、或整串 key
            const suf = s.slice(-n);
            if (n < s.length && !suf.some((x) => /\[[^\]]+\]/.test(x))) continue;
            const k = suf.join('>');
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
// 父層是 flex／grid 時，子項的 inline-* 會被 blockify（inline-flex → flex），不是真差
// 父層＝DOM 的父元素（extract 記的 parentDisplay）；舊抓取沒有時才退回父 part（父 part 可能隔好幾層，#1639）
const BLOCKIFY = {
  'inline-flex': 'flex',
  'inline-block': 'block',
  inline: 'block',
  'inline-grid': 'grid',
  'list-item': 'block',
};
const normDisplay = (v, parent = '') =>
  /flex|grid/.test(parent) ? (BLOCKIFY[v] ?? v) : v === 'list-item' ? 'block' : v;
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
  cmp(
    'display',
    normDisplay(a.style.display, a.parentDisplay),
    normDisplay(b.style.display, b.parentDisplay),
  );
  if (/flex|grid/.test(a.style.display + b.style.display))
    for (const k of ['rowGap', 'columnGap']) cmp(k, a.style[k], b.style[k]);
  return out;
}

/**
 * 把「包裝層」span（只包一層同文案文字的子元素）的可見樣式併回控制項：app 的導覽連結把
 * 「目前頁」底線與文字畫在內層 span 上，不併的話會被報成「沒有底線」。
 */
export function withWrapper(p, list) {
  // 只有控制項（連結、按鈕）會把字包在 span 裡；section 跟它的章名同文案不算包裝層
  if (p.kind !== 'control') return p;
  const w = list.find((q) => q.parent === p.key && q.kind === 'text' && q.tpl === p.tpl);
  if (!w) return p;
  const style = { ...p.style };
  for (const k of [...BORDERS, 'backgroundColor'])
    if (normBorder(style[k]) === 'none' || style[k] === 'rgba(0, 0, 0, 0)') style[k] = w.style[k];
  if (!p.own) for (const k of TEXT_PROPS) style[k] = w.style[k];
  return { ...p, own: p.own || w.own, style };
}

/** 工具量不準的幾類（README「已知限制」）。命中的列歸「工具限制」，不算待修，要人工看。 */
export const LIMITS = {
  scope: '結構範圍不同：兩邊這個容器包住的東西不同，它自己的位置／尺寸不可比',
  pseudo: '偽元素：沒有底色／框線的那一側帶 ::before／::after，可能畫在那裡，工具不量',
  count: '同型段落數不同：父層配上了、對面有同型的沒配上，要人工對',
  sparse:
    '稿這裡是一份清單的列，app 這邊只有 1 個（或 0 個）容器：資料太少，工具無法確認是不是同一份清單',
  host: '元件根的 display：PrimeNG 元件根元素用 flex 排內容（元件結構），子項的位置／尺寸另外比',
  ua: '瀏覽器預設：稿的 button 沒重設 padding（1px 6px），app 重設成 0；尺寸另外比',
  variant: '列內有多種樣式（例如上課中的課塊）：工具只比最常見那種，其他變體人工看',
};

/**
 * 每列歸一欄：`資料差` → `工具限制` → `已記錄偏離`（命中 deviations）→ `待修`。
 * deviation：{ status, detail?, a6?, app?（regex 字串）, kind?, pop?, widths?（只在這些寬度生效）, reason, source }。
 */
export function classify(rows, deviations = [], width, site = []) {
  const hit = (r, d) =>
    d.status === r.status &&
    (!d.widths || d.widths.includes(width)) &&
    (!d.pop || d.pop === r.pop) &&
    (!d.kind || d.kind === r.kind) &&
    (!d.host || new RegExp(d.host).test(r.host ?? '')) &&
    (!d.detail || new RegExp(d.detail).test(r.detail)) &&
    (!d.a6 || new RegExp(d.a6).test(r.a6 ?? '')) &&
    (!d.app || new RegExp(d.app).test(r.app ?? ''));
  // 全站項（#1591）：每頁都有的同一組差異收成一條，不計入各頁待修
  const siteHits = new Map();
  const siteOf = (r) =>
    site.find(
      (x) =>
        x.rows &&
        ['樣式', '位置', '尺寸'].includes(r.status) &&
        new RegExp(x.rows).test(r.a6 ?? ''),
    );
  const stripped = rows.flatMap((r) => {
    const whole = siteOf(r);
    if (whole) return (siteHits.set(whole, (siteHits.get(whole) ?? 0) + 1), []);
    if (r.status !== '樣式') return [r];
    const items = r.detail.split('；');
    // 一個 part 命中同一條全站項算一處（字級、字重、行高同時差也只算一處）
    const hitHere = new Set();
    const keep = items.filter((it) => {
      const x = site.find(
        (x) =>
          x.strip?.includes(it) ||
          (x.stripProps?.includes(it.split(' ')[0]) && new RegExp(x.a6).test(r.a6 ?? '')),
      );
      if (x) hitHere.add(x);
      return !x;
    });
    for (const x of hitHere) siteHits.set(x, (siteHits.get(x) ?? 0) + 1);
    return keep.length ? [{ ...r, detail: keep.join('；') }] : [];
  });
  const out = stripped.flatMap((r0) => {
    let r = r0;
    if (r.status === '資料差') return [{ ...r, bucket: '資料差' }];
    if (r.limit) return [{ ...r, bucket: '工具限制' }];
    const side = r.a6 ? 'a6' : 'app';
    const subOf = (q) => ({
      ...r,
      inner: undefined,
      kind: q.kind,
      host: q.host,
      [side]: q.key,
      detail: `「${q.tpl}」（在${r.status === '缺' ? '缺少' : '多出'}的區塊裡）`,
    });
    // 單項偏離（硬性規則 A28 的對比色）：從樣式列拆出那一項，其他項照常歸欄
    if (r.status === '樣式') {
      const items = r.detail.split('；');
      const split = [];
      const rest = items.filter((it) => {
        const dd = deviations.find(
          (x) =>
            x.item &&
            new RegExp(x.item).test(it) &&
            hit({ ...r, detail: it }, { ...x, item: undefined }),
        );
        if (dd) split.push({ ...r, detail: it, bucket: '已記錄偏離', dev: dd });
        return !dd;
      });
      if (split.length) {
        if (!rest.length) return split;
        r = { ...r, detail: rest.join('；') };
        const d2 = deviations.find((x) => !x.item && hit(r, x));
        return [d2 ? { ...r, bucket: '已記錄偏離', dev: d2 } : { ...r, bucket: '待修' }, ...split];
      }
    }
    const d = deviations.find((x) => !x.item && hit(r, x));
    // 包裝層本身是偏離（R7 的 role=search）：裡面真正多出／缺少的東西各自拆列、各自歸欄，不被包裝層一起帶走
    if (d) {
      // 只拆容器裡最上層的東西（按鈕裡的文字 span 跟著按鈕，不另列）
      const all = r.inner ?? [];
      const inner = all
        .filter(
          (q) =>
            q.kind !== 'landmark' &&
            !all.some((o) => o !== q && q.key.startsWith(o.key + '>')) &&
            // 按鈕裡的文字（按鈕本身配上了）不另列
            !(q.kind === 'text' && segs(q.key).at(-2)?.startsWith('control:')),
        )
        .map((q) => {
          const sub = subOf(q);
          const dd = deviations.find((x) => hit(sub, x));
          if (dd) return { ...sub, bucket: '已記錄偏離', dev: dd };
          // whole：整塊搬走（表單整個進彈窗，#1697），裡面跟著歸偏離
          if (d.whole)
            return { ...sub, bucket: '已記錄偏離', dev: { ...d, reason: `連帶：${d.reason}` } };
          return { ...sub, bucket: '待修' };
        });
      return [{ ...r, bucket: '已記錄偏離', dev: d }, ...inner];
    }
    // 缺／多的容器：裡面若有子孫命中偏離，拆成自己一列；容器本身仍是待修
    const split = (r.inner ?? []).flatMap((q) => {
      const sub = subOf(q);
      const dd = deviations.find((x) => hit(sub, x));
      return dd ? [{ ...sub, bucket: '已記錄偏離', dev: dd }] : [];
    });
    const note = split.length ? `；其中 ${split.length} 個已記錄偏離（拆列）` : '';
    return [{ ...r, detail: r.detail + note, bucket: '待修' }, ...split];
  });
  for (const [x, n] of siteHits)
    out.push({
      status: '全站',
      bucket: '全站',
      a6: null,
      app: null,
      detail: `${x.label}（本頁命中 ${n} 處；${x.issue}）`,
    });
  // 連帶：待修的位移／尺寸差，如果每個原因都已經是偏離或資料差，就跟著原因歸欄。
  // 原因可能自己也是連帶（「更多」第 3 項被第 2 項推、第 2 項被多出的「公開申請」推），所以重複到不再變
  const causeRow = (c) =>
    out.find(
      (r) =>
        (c.a6 ? r.a6 === c.a6 : r.app === c.app) &&
        (c.style
          ? r.status === '樣式'
          : c.axis
            ? r.detail.startsWith(c.axis) && ['尺寸', '資料差'].includes(r.status)
            : ['多', '缺', '資料差'].includes(r.status)),
    );
  // 連帶的判定是「夠不夠」：每一軸，已歸偏離／資料差的原因加起來能解釋位移量（＋容差）就成立。
  // 不要求所有可能原因都歸好 —— 「匯出」被右邊的「⋯」（R2）推 56，旁邊搜尋框變窄是另一件事
  const settled = (c) => c && (c.bucket === '已記錄偏離' || c.bucket === '資料差');
  for (let changed = true; changed;) {
    changed = false;
    for (const r of out) {
      if (r.bucket !== '待修' || !r.because?.causes?.length) continue;
      const cs = r.because.causes.map((c) => ({ c, row: causeRow(c) }));
      const enough = (pred) =>
        Object.entries(r.because.needs).every(
          ([ax, need]) =>
            cs.filter((x) => x.c.ax === ax && pred(x.row)).reduce((n, x) => n + x.c.amt, 0) +
              TOL.pos >=
            need,
        );
      if (enough(settled)) {
        const used = cs.filter((x) => settled(x.row));
        const devs = used.filter((x) => x.row.bucket === '已記錄偏離');
        if (devs.length) {
          const d = devs[0].row.dev;
          r.bucket = '已記錄偏離';
          r.dev = { ...d, reason: `連帶：${d.reason}`, source: d.source };
        } else r.bucket = '資料差';
        r.detail += `；連帶自 ${used.length} 處${devs.length ? '偏離' : '資料差'}`;
        changed = true;
      } else if (!r.chained && enough((row) => row && row.bucket !== '工具限制')) {
        // 要算上待修的原因才夠：自己仍是待修，註明原因 —— 修好它多半就跟著消失
        const c = cs
          .filter((x) => x.row?.bucket === '待修')
          .sort((p, q) => q.c.amt - p.c.amt)[0]?.row;
        if (c) {
          r.chained = true;
          r.detail += `；連帶自待修「${(c.a6 ?? c.app ?? '').split('>').at(-1)} ${c.status}」`;
        }
      }
    }
  }
  return out;
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
/**
 * opts.dataDependent：只在某些資料下才出現的 part（`{ a6?, app?, reason }`，regex 字串）。
 * 沒配上時算資料差而不是缺／多，它的容器尺寸差也跟著算資料差。
 */
export function diffParts(a6Cap, appCap, mapping = {}, opts = {}, tol = TOL) {
  // 只給螢幕閱讀器的文字不算視覺 part（第三層另列）
  const A = a6Cap.parts.filter((p) => !p.sr),
    B = appCap.parts.filter((p) => !p.sr);
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
  const wrapper = (p, m) =>
    p.kind === 'text' && m.get(p.parent)?.kind === 'control' && p.tpl === m.get(p.parent)?.tpl;
  const topFree = (list, m, isFree) =>
    list.filter((p) => isFree(p) && !wrapper(p, m) && !refOf(p, m, (k) => isFree(m.get(k))));
  // 列內 part 不是每列都有（「待繳費」小標）→ 有沒有出現取決於資料
  const rowOf = (p, m) => refOf(p, m, (k) => m.get(k)?.kind === 'row');
  const cond = (p, m) =>
    p.kind !== 'row' && p.inRows > 0 && rowOf(p, m) && p.inRows < rowOf(p, m).inRows;
  // 子孫分兩種：自己也沒配上的（一起缺／多）、已配上的（這個容器只是多包了一層）
  const kidsText = (list, key, isFree) => {
    const ks = list.filter((p) => p.key.startsWith(key + '>'));
    const free = ks.filter(isFree).length,
      paired = ks.length - free;
    return [free && `含 ${free} 個子 part`, paired && `包住 ${paired} 個已配對的 part＝多包一層`]
      .filter(Boolean)
      .join('；');
  };
  const dataA = new Set(),
    dataB = new Set();
  // 父層配上了，對面同一個父層底下也有沒配上的同 kind:role → 段落數不同才沒配（帳戶浮層少了「切換身分」）
  const sameTypeUnpaired = (p, side) => {
    const other =
      side === 'a6' ? pairs.get(p.parent) : [...pairs].find(([, v]) => v === p.parent)?.[0];
    if (!other) return false;
    const [list, isFree] = side === 'a6' ? [B, freeB] : [A, freeA];
    return list.some((q) => q.parent === other && kr(q) === kr(p) && isFree(q));
  };
  // 兩邊容器包住的東西不同（app 的 main 包住色面、稿的不包）→ 它自己的位置／尺寸差沒有意義
  // 一兩個配錯的子項不算（那是配對誤差）；要 ≥3 個、或 ≥20% 的子項在一邊裡面、另一邊外面才算
  const scopeMemo = new Map();
  const scopeDiff = (ak, bk) => {
    if (scopeMemo.has(ak)) return scopeMemo.get(ak);
    let inside = 0,
      odd = 0;
    for (const [x, y] of pairs) {
      const ia = x.startsWith(ak + '>'),
        ib = y.startsWith(bk + '>');
      if (ia || ib) inside++;
      if (ia !== ib) odd++;
    }
    const r = odd >= 3 || (inside > 0 && odd / inside >= 0.2);
    scopeMemo.set(ak, r);
    return r;
  };

  for (const [list, m, isFree, side] of [
    [A, mA, freeA, 'a6'],
    [B, mB, freeB, 'app'],
  ])
    for (const p of topFree(list, m, isFree)) {
      const dd = (opts.dataDependent ?? []).find((d) => d[side] && new RegExp(d[side]).test(p.key));
      const rep = !!dd || repeated(p, list, isFree);
      if (rep) (side === 'a6' ? dataA : dataB).add(p.key);
      const kids = kidsText(list, p.key, isFree);
      rows.push({
        status: rep ? '資料差' : side === 'a6' ? '缺' : '多',
        kind: p.kind,
        host: p.host,
        // 底下同樣沒配上的子孫：偏離規則可能指的是裡面某一顆（多包一層的區塊裡的「⋯」）
        inner: list
          .filter((q) => q.key.startsWith(p.key + '>') && isFree(q))
          .map((q) => ({ key: q.key, kind: q.kind, tpl: q.tpl, host: q.host })),
        limit:
          !rep && sameTypeUnpaired(p, side)
            ? LIMITS.count
            : side === 'a6' &&
                p.kind === 'row' &&
                !B.some((q) => q.kind === 'row' && q.parent === pairs.get(p.parent))
              ? LIMITS.sparse
              : undefined,
        a6: side === 'a6' ? p.key : null,
        app: side === 'app' ? p.key : null,
        detail:
          `${dd ? `隨資料出現（${dd.reason}）：` : rep ? `${side === 'a6' ? 'A6' : 'app'} 多一個同型區塊（數量隨資料）：` : ''}` +
          `${kr(p)}「${p.tpl}」${kids ? `（${kids}）` : ''}` +
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
  const freeTopA = topFree(A, mA, freeA),
    freeTopB = topFree(B, mB, freeB);
  // y 的差是不是資料造成的：同一個參考容器裡、這個 part 上方有資料性的東西
  const dataAbove = (p, ref, set, m) =>
    [...set].some((k) => {
      const q = m.get(k);
      return q && q.box[1] < p.box[1] && (!ref || k.startsWith(ref.key + '>'));
    });

  for (const [ak, bk] of pairs) {
    const a = mA.get(ak),
      b = mB.get(bk);
    const push = (status, detail, limit, because) =>
      rows.push({ status, kind: a.kind, host: b.host, a6: ak, app: bk, detail, limit, because });
    const scope =
      ['landmark', 'list'].includes(a.kind) && scopeDiff(ak, bk) ? LIMITS.scope : undefined;
    if (kr(a) !== kr(b)) push('角色', `${kr(a)} → ${kr(b)}`);
    const inRow = a.inRows > 0 && a.kind !== 'row';
    if (a.tpl !== b.tpl && a.kind !== 'list' && a.kind !== 'row' && !inRow)
      push('文案', `「${a.tpl}」→「${b.tpl}」`);

    // 參考容器要兩邊包的範圍一樣（app 的 main 包住色面、稿的不包 → 不拿 main 當參考）
    const ra = refOf(a, mA, (k) => pairs.has(k) && !scopeDiff(k, pairs.get(k))),
      rb = ra ? mB.get(pairs.get(ra.key)) : null;
    const [ax, ay, aw, ah] = a.box,
      [bx, by, bw, bh] = b.box;
    let dx = bx - (rb?.box[0] ?? 0) - (ax - (ra?.box[0] ?? 0)); // app − A6
    let dy = by - (rb?.box[1] ?? 0) - (ay - (ra?.box[1] ?? 0));
    // 沒有參考祖先（彈出物根）且知道兩邊視窗高：手機的底部抽屜貼視窗底，兩邊撐開的視窗高不同，
    // 量「距視窗底」才可比。兩種量法取差小的
    let anchor = '頁面';
    // 根＝父層不是 part：彈出物根的 parent 是合成的 `pop[id]`，不是 null（#2016 #7：手機帳戶抽屜
    // 因此一直量「相對頁面」，兩邊頁高差（資料）整個灌進位置差）
    const isRoot = !a.parent || !mA.has(a.parent);
    // 兩邊都在列裡：直接比「相對所在列」的位置
    if (a.rowRel && b.rowRel) {
      dx = b.rowRel[0] - a.rowRel[0];
      dy = b.rowRel[1] - a.rowRel[1];
      anchor = '所在列';
    }
    // 沒有可用的參考容器、但不是根（例：main 被排除後的章節）：改量跟「上方最近一個已配對 part」的間距，
    // 不然頂端色面的高度差會灌進每一條位置差
    if (anchor === '頁面' && !ra && !isRoot) {
      const rel = (k) => k === ak || ak.startsWith(k + '>') || k.startsWith(ak + '>');
      let best = null;
      for (const [k2, k2b] of pairs) {
        const x = mA.get(k2);
        if (rel(k2) || x.box[3] <= 0 || x.box[1] + x.box[3] > ay + 2) continue;
        if (!best || x.box[1] + x.box[3] > best[0].box[1] + best[0].box[3]) best = [x, mB.get(k2b)];
      }
      if (best) {
        const [xa, xb] = best;
        dy = by - (xb.box[1] + xb.box[3]) - (ay - (xa.box[1] + xa.box[3]));
        anchor = `上方「${xa.tpl || xa.role}」`;
      }
    }
    if (anchor === '頁面' && !ra && isRoot && a6Cap.height && appCap.height) {
      const fromBottom = appCap.height - (by + bh) - (a6Cap.height - (ay + ah));
      if (Math.abs(fromBottom) < Math.abs(dy)) ((dy = -fromBottom), (anchor = '視窗底'));
    }
    // 連帶：這個 part 的位移能不能被同一個參考容器裡「別人的變化量」解釋 —— 前面多出／少了的 part、
    // 鄰居變高變寬、自己變高（置中）。能完整解釋就記下原因，classify 時跟著原因歸欄
    const explain = (axis, d) => {
      const i = axis === 'x' ? 0 : 1,
        s = axis === 'x' ? 2 : 3;
      const inA = (k) => !ra || k.startsWith(ra.key + '>'),
        inB = (k) => !rb || k.startsWith(rb.key + '>');
      const rel = (k, self) => k === self || self.startsWith(k + '>') || k.startsWith(self + '>');
      const causes = [];
      let room = 0;
      const add = (amt, c) => ((room += amt), causes.push({ ...c, amt, ax: axis }));
      // 多出／少了的 part：y 軸看上方的；x 軸看同一列「兩側」的（靠右對齊的工具列，右邊插進「⋯」會把左邊的鈕推走）。
      // 包住自己的多出區塊不算，但它裡面跟自己並排的東西要算（帳單工具列的「⋯」在多出的 search 區塊裡）。
      // 量要加上父層的 gap（「⋯」寬 40＋間距 16＝推 56）
      const gapOf = (q, m) =>
        parseFloat(m.get(q.parent)?.style?.[axis === 'x' ? 'columnGap' : 'rowGap']) || 0;
      const besides = (q, me) =>
        axis === 'y'
          ? q.box[1] < me.box[1]
          : Math.abs(q.box[1] - me.box[1]) < Math.max(me.box[3], q.box[3]);
      const frees = (list, m, isFree, self) => {
        const cand = list.filter((q) => isFree(q) && !rel(q.key, self) && q.box[s] > 0);
        return cand.filter((q) => !cand.some((o) => o !== q && q.key.startsWith(o.key + '>')));
      };
      // 方向：往前（左／上）移＝前面少了東西、或（x 軸）後面多了東西；往後移則相反
      const before = (q, me) => q.box[i] < me.box[i];
      const pushes = (q, me, extra) =>
        axis === 'y' ? d > 0 === extra : extra ? d < 0 !== before(q, me) : d < 0 === before(q, me);
      for (const q of frees(A, mA, freeA, ak))
        if (inA(q.key) && besides(q, a) && pushes(q, a, false))
          add(q.box[s] + gapOf(q, mA), { a6: q.key });
      for (const q of frees(B, mB, freeB, bk))
        if (inB(q.key) && besides(q, b) && pushes(q, b, true))
          add(q.box[s] + gapOf(q, mB), { app: q.key });
      for (const [k2, k2b] of pairs) {
        if (k2 === ak || !inA(k2) || rel(k2, ak)) continue;
        const x = mA.get(k2),
          y = mB.get(k2b);
        // y 軸：上方的鄰居；x 軸：同一列的鄰居（靠右對齊的列，右邊變寬也會把左邊推走）
        const near =
          axis === 'y'
            ? x.box[1] < a.box[1]
            : Math.abs(x.box[1] - a.box[1]) < Math.max(a.box[3], x.box[3]);
        const d = Math.abs(y.box[s] - x.box[s]);
        if (near && !sizeOk(x.box[s], y.box[s], tol))
          add(d, { a6: k2, axis: axis === 'x' ? '寬' : '高' });
      }
      // 參考容器自己變高／變寬：置中的內容會移動一半（手機分校鈕 29→44，裡面的字往下 7.5）
      // 參考容器的 padding 不同：裡面每個子項都被整體推動（帳單「逾期」章 padding 32→0，子項全部 Δy −32）
      if (ra) {
        const pad = (p) => (p.style.padding ?? '').split(' ').map(parseFloat);
        const [pa, pb] = [pad(ra), pad(rb)];
        const at = (v) => (axis === 'x' ? (v[3] ?? v[1] ?? v[0]) : v[0]);
        const dp = Math.abs((at(pb) || 0) - (at(pa) || 0));
        if (dp > tol.pos) add(dp, { a6: ra.key, style: true });
      }
      // 只在稿上真的置中時才算（彈出物是靠上排的，它變高不會推動裡面的項目）
      const centered =
        ra && Math.abs(a.box[i] - ra.box[i] - (ra.box[i] + ra.box[s] - a.box[i] - a.box[s])) <= 2;
      if (centered && !sizeOk(ra.box[s], rb.box[s], tol))
        add(Math.abs(rb.box[s] - ra.box[s]) / 2, { a6: ra.key, axis: axis === 'x' ? '寬' : '高' });
      const own = Math.abs(b.box[s] - a.box[s]);
      // 自己變大：起點最多移動整個增量（靠左 0、置中一半、靠右全部 —— 帳戶鈕靠右，變寬就整個左移）
      if (!sizeOk(a.box[s], b.box[s], tol)) add(own, { a6: ak, axis: axis === 'x' ? '寬' : '高' });
      return causes.length ? { room, causes } : null;
    };
    if (!posOk(0, dx, tol) || !posOk(0, dy, tol)) {
      const ex = posOk(0, dx, tol) ? null : explain('x', dx),
        ey = posOk(0, dy, tol) ? null : explain('y', dy);
      const okX = posOk(0, dx, tol) || (ex && Math.abs(dx) <= ex.room + tol.pos),
        okY = posOk(0, dy, tol) || (ey && Math.abs(dy) <= ey.room + tol.pos);
      const because =
        okX && okY
          ? {
              needs: { ...(ex ? { x: Math.abs(dx) } : {}), ...(ey ? { y: Math.abs(dy) } : {}) },
              causes: [...(ex?.causes ?? []), ...(ey?.causes ?? [])],
            }
          : undefined;
      const data =
        posOk(0, dx, tol) && (dataAbove(a, ra, dataA, mA) || dataAbove(b, rb, dataB, mB));
      push(
        data ? '資料差' : '位置',
        `相對${anchor === '所在列' ? anchor : ra ? `「${ra.tpl || ra.role}」` : anchor} Δx ${sgn(dx)}、Δy ${sgn(dy)}（app − A6）${data ? '；上方內容隨資料' : ''}`,
        scope,
        data ? undefined : because,
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
      const why = container || ((a.full ?? a.text) !== (b.full ?? b.text) ? '文字不同' : '');
      push(why ? '資料差' : '尺寸', `寬 ${aw}→${bw}${why ? `；${why}` : ''}`, scope);
    }
    if (!sizeOk(ah, bh, tol)) {
      const why =
        container ||
        ((a.full ?? a.text) !== (b.full ?? b.text) && lines(a) !== lines(b) ? '文字行數不同' : '');
      // 容器變高／變矮：裡面多出／少了的 part、直屬子項變高 → 連帶
      const causes = [];
      let room = 0;
      const add = (amt, c) => ((room += amt), causes.push({ ...c, amt, ax: 'h' }));
      for (const q of freeTopA) if (q.key.startsWith(ak + '>')) add(q.box[3], { a6: q.key });
      for (const q of freeTopB) if (q.key.startsWith(bk + '>')) add(q.box[3], { app: q.key });
      for (const [k2, k2b] of pairs)
        if (mA.get(k2).parent === ak && !sizeOk(mA.get(k2).box[3], mB.get(k2b).box[3], tol))
          add(Math.abs(mB.get(k2b).box[3] - mA.get(k2).box[3]), { a6: k2, axis: '高' });
      const because =
        causes.length && Math.abs(bh - ah) <= room + tol.size
          ? { needs: { h: Math.abs(bh - ah) }, causes }
          : undefined;
      push(
        why ? '資料差' : '尺寸',
        `高 ${ah}→${bh}${why ? `；${why}` : ''}`,
        scope,
        why ? undefined : because,
      );
    }
    const st = styleDiffs(
      { ...withWrapper(a, A), parentDisplay: a.parentDisplay ?? mA.get(a.parent)?.style?.display },
      { ...withWrapper(b, B), parentDisplay: b.parentDisplay ?? mB.get(b.parent)?.style?.display },
      tol,
    );
    // 偽元素只可能解釋「底色／框線一邊有、一邊沒有」，而且沒有的那邊要帶偽元素；其他樣式差照算
    const empty = (v) => normBorder(v) === 'none' || v === 'rgba(0, 0, 0, 0)';
    const viaPseudo = (d) => {
      const k = d.split(' ')[0];
      if (k !== 'backgroundColor' && !BORDERS.includes(k)) return false;
      return (a.pseudo && empty(a.style[k])) || (b.pseudo && empty(b.style[k]));
    };
    // PrimeNG 元件根（host p-*）用 flex 排自己的內容：根的 display 是元件結構，子項幾何另外比（#1639）
    const viaHost = (d) => d.startsWith('display ') && /^p-/.test(b.host ?? '');
    // 稿的 <button> 沒重設 padding，computed 是瀏覽器預設 1px 6px；app 重設成 0。尺寸另外比，這項不可比（#1639 關閉鈕）
    const viaUA = (d) => d === 'padding 1px 6px → 0px' && a.role === 'button';
    const real = st.filter((d) => !viaPseudo(d) && !viaHost(d) && !viaUA(d)),
      maybe = st.filter(viaPseudo),
      host = st.filter(viaHost),
      ua = st.filter(viaUA);
    if (real.length) push('樣式', real.join('；'));
    if (host.length) push('樣式', host.join('；'), LIMITS.host);
    if (ua.length) push('樣式', ua.join('；'), LIMITS.ua);
    if ((a.variants ?? 1) !== (b.variants ?? 1))
      push(
        '變體',
        `列內樣式變體：A6 ${a.variants ?? 1} 種、app ${b.variants ?? 1} 種`,
        LIMITS.variant,
      );
    if (maybe.length) push('樣式', maybe.join('；'), LIMITS.pseudo);
    // 黏住：每個釘點最上層的 part（自己或 sticky 祖先跟父 part 的不是同一個）。這裡只提名，
    // 寫法不同效果可能一樣（app 把動作列放在捲動區外），由行為檢查收斂（lib/sticky.mjs、run.mjs）
    const topPin = (p, m) => !!p.pin && p.pin.id !== m.get(p.parent)?.pin?.id;
    if (topPin(a, mA) || topPin(b, mB)) {
      const pa = a.pin?.at ?? '',
        pb = b.pin?.at ?? '';
      rows.push({
        status: '黏住',
        kind: a.kind,
        host: b.host,
        a6: ak,
        app: bk,
        detail: `sticky ${pa || '無'} → ${pb || '無'}`,
        probe: { axis: (pa || pb).split(' ')[0] || 'top', differ: pa !== pb },
      });
    }
  }
  const order = { 缺: 0, 角色: 1, 文案: 2, 位置: 3, 黏住: 3.5, 尺寸: 4, 樣式: 5, 多: 6, 資料差: 7 };
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

/** 殼層的 part：頂欄（banner）與殼層彈出物。 */
export const isShell = (r) =>
  ['more', 'acct'].includes(r.pop) || (r.a6 ?? r.app ?? '').startsWith('>landmark:banner');

export const BUCKETS = ['待修', '已記錄偏離', '全站', '工具限制', '資料差'];

export function diffMarkdown(page, cfg, sections) {
  const L = [`# A6 conformance · ${page}：app（${cfg.app}）vs A6（${cfg.a6}）`, ''];
  L.push(
    `容差：位置 ±${TOL.pos}px（相對最近的已配對祖先）；尺寸 ±${TOL.size}px 或 ±${TOL.sizeRatio * 100}%（取大）；字級／行高 ±${TOL.font}px；其餘樣式逐字。`,
    '分四欄：**待修**（目標歸零）／**已記錄偏離**（config 的 deviations，附理由與出處）／**工具限制**（工具量不準，人工看）／**資料差**（不算設計差）。同一父層下細節相同的列合併為「等 N 個」。',
    '',
    '| 寬 | ' + BUCKETS.join(' | ') + ' |',
    '| --- | ' + BUCKETS.map(() => '---').join(' | ') + ' |',
  );
  // 殼層（頂欄＋「更多」＋帳戶）每頁都有，分開數才不會在每頁的報告裡重複算
  for (const s of sections)
    for (const [name, sel] of [
      ['全部', () => true],
      ['殼層', isShell],
      ['頁面', (r) => !isShell(r)],
    ])
      L.push(
        `| ${s.width}px ${name} | ${BUCKETS.map((b) => s.rows.filter((r) => r.bucket === b && sel(r)).length).join(' | ')} |`,
      );
  L.push('');
  // 黏住的行為檢查：效果一致的不列，只在這裡記數（看得出工具有沒有真的檢查過）
  for (const s of sections)
    if (s.sticky)
      L.push(
        `黏住行為檢查 ${s.width}px：提名 ${s.sticky.checked} 處（任一邊有 sticky 的最上層 part），捲動後效果一致 ${s.sticky.same} 處，其餘以「黏住」列在下表。`,
        '',
      );
  const cell = (t) => String(t).replace(/\|/g, '\\|');
  for (const s of sections) {
    L.push(`## ${s.width}px`, '');
    for (const b of BUCKETS) {
      const g = groupRows(s.rows.filter((r) => r.bucket === b));
      if (!g.length) continue;
      const extra = b === '已記錄偏離' ? ' 理由（出處） |' : b === '工具限制' ? ' 限制 |' : '';
      L.push(
        `### ${b}（${g.length}）`,
        '',
        `| 狀態 | A6 part | app part | 差異 |${extra}`,
        `| --- | --- | --- | --- |${extra ? ' --- |' : ''}`,
      );
      for (const r of g)
        L.push(
          `| ${r.status}${where(r)} | ${cell(short(r.a6))}${r.n > 1 ? ` 等 ${r.n} 個` : ''} | ${cell(short(r.app))} | ${cell(r.detail)} |` +
            (b === '已記錄偏離'
              ? ` ${cell(`${r.dev.reason}（${r.dev.source}）`)} |`
              : b === '工具限制'
                ? ` ${cell(r.limit)} |`
                : ''),
        );
      L.push('');
    }
  }
  return L.join('\n');
}
