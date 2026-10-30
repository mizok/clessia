// 瀏覽器端的 part 抽取器：A6 稿與 app 用同一支，key 才可比。
// `extractParts` 會被 toString() 塞進 page.evaluate，所以只能用它自己與 normText。
import { normText } from './normalize.mjs';

export const STYLE_PROPS = [
  'display',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'color',
  'backgroundColor',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
  'borderRadius',
  'padding',
  'rowGap',
  'columnGap',
];

/**
 * 走 DOM，回傳扁平的 part 清單（每個帶 parent key，可還原成樹）。
 *
 * part 的種類：
 * - landmark：header／nav／main／footer／aside／form／dialog／開著的 [popover]／有名字的 section、
 *   以及 role=region|toolbar|search|navigation|dialog|menu
 * - heading：h1–h6
 * - control：button／a[href]／input／select／textarea／summary 與對應 role
 * - list：ul／ol／role=list；它的直屬子項是 row
 * - text：自己帶非空白文字節點、又不在 control／heading 裡的元素
 *
 * **row 的處理**：列是資料。所有 row 合成一個 `row` segment（不帶文字），row 底下的 part
 * 取聯集、記 `inRows`（幾列有它）；幾何取第一個出現的。row 內的 control／text 也不帶文字進 key
 * （那是人名、金額），只留角色＋序號。
 */
export function extractParts(opts) {
  const {
    root: rootSel = 'body',
    names = [],
    prefix = '',
    rowParents = [],
    rowSel = '',
    tag = false,
  } = opts ?? {};
  // 稿在這些父層有列（資料多）：app 這邊資料少（1～2 列）也要認成列，兩邊才配得上
  const noList = (k) =>
    k
      .split('>')
      .filter((x) => x !== 'list')
      .join('>');
  const hinted = new Set(rowParents.map(noList));
  const LAND_TAG = {
    HEADER: 'banner',
    NAV: 'navigation',
    MAIN: 'main',
    FOOTER: 'contentinfo',
    ASIDE: 'complementary',
    FORM: 'form',
    DIALOG: 'dialog',
  };
  const LAND_ROLE = new Set([
    'region',
    'toolbar',
    'search',
    'navigation',
    'dialog',
    'menu',
    'banner',
    'main',
    'complementary',
    'contentinfo',
  ]);
  const CTRL_ROLE = new Set([
    'button',
    'link',
    'tab',
    'menuitem',
    'checkbox',
    'radio',
    'switch',
    'combobox',
    'textbox',
    'option',
    'searchbox',
  ]);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'SVG', 'CANVAS', 'NOSCRIPT', 'svg']);

  // 設計稿自帶的翻頁膠囊與說明（proto.js），不是頁面的一部分
  const IGNORE = '.proto-pill, .proto-all, .proto-notes';
  const visible = (el) => {
    if (el.matches(IGNORE)) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    // 收合的 <details> 內容、content-visibility 跳過的東西：沒有盒子就不算畫面上的 part
    if (s.display !== 'contents' && el.getClientRects().length === 0) return false;
    if (el.matches('[popover]') && !el.matches(':popover-open')) return false;
    return true;
  };
  const accName = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb)
      return lb
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
    const al = el.getAttribute('aria-label');
    if (al) return al;
    if (el.labels && el.labels.length) return el.labels[0].textContent;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      return el.placeholder || el.title || '';
    if (el.tagName === 'SELECT') return el.title || '';
    return el.textContent || el.title || '';
  };
  const ownText = (el) =>
    [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join('')
      .trim();
  const classify = (el) => {
    const tag = el.tagName;
    const role = el.getAttribute('role');
    if (el.hasAttribute('data-a6-part')) return { kind: 'mapped', role: role || tag.toLowerCase() };
    if (/^H[1-6]$/.test(tag) || role === 'heading')
      return { kind: 'heading', role: 'h' + (tag[1] || el.getAttribute('aria-level') || '?') };
    if (role && CTRL_ROLE.has(role)) return { kind: 'control', role };
    if (tag === 'BUTTON' || tag === 'SUMMARY') return { kind: 'control', role: 'button' };
    if (tag === 'A' && el.hasAttribute('href')) return { kind: 'control', role: 'link' };
    if (tag === 'INPUT' && el.type !== 'hidden')
      return {
        kind: 'control',
        role:
          el.type === 'search'
            ? 'searchbox'
            : el.type === 'checkbox'
              ? 'checkbox'
              : el.type === 'radio'
                ? 'radio'
                : 'textbox',
      };
    if (tag === 'SELECT') return { kind: 'control', role: 'combobox' };
    if (tag === 'TEXTAREA') return { kind: 'control', role: 'textbox' };
    if (role && LAND_ROLE.has(role)) return { kind: 'landmark', role };
    if (LAND_TAG[tag]) return { kind: 'landmark', role: LAND_TAG[tag] };
    if (el.matches('[popover]')) return { kind: 'landmark', role: 'popover' };
    if (tag === 'SECTION' && (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')))
      return { kind: 'landmark', role: 'region' };
    if (tag === 'UL' || tag === 'OL' || role === 'list' || tag === 'TABLE' || tag === 'TBODY')
      return { kind: 'list', role: 'list' };
    if (ownText(el)) return { kind: 'text', role: tag.toLowerCase() };
    return null;
  };
  // 列的簽名：tag＋class，去掉 BEM 修飾子（`--`）與狀態（`is-`），因為每列狀態不同
  const sig = (el) =>
    el.tagName +
    '.' +
    [...el.classList]
      .filter((k) => !k.includes('--') && !k.startsWith('is-'))
      .sort()
      .join('.');
  // 欄位組：label[for] 指向自己裡面的欄位（label 沒包住它），或 fieldset。只擋「稿有列、門檻降到 2」那條路：
  // app 表單裡同簽名的兩個欄位外框（開始日期、備註）被認成列。≥3／≥5 的不擋 —— 成績列裡也有帶 label 的分數框
  const fieldGroup = (el) =>
    el.tagName === 'FIELDSET' ||
    [...el.querySelectorAll('label[for]')].some(
      (l) => l.control && el.contains(l.control) && !l.contains(l.control),
    );
  // 欄位外框：第一個子元素就是 label[for]、指向自己裡面的欄位（表單的「標籤＋輸入框＋提示」）。
  // 表單裡三個以上整列欄位常同簽名、同子元素數，會被 ≥3／≥5 那條認成列（#1314 家長表單）。
  // 成績列的分數框不受影響：列的第一格是學生名，不是 label
  const fieldFrame = (el) => {
    const l = el.firstElementChild;
    return (
      !!l &&
      l.tagName === 'LABEL' &&
      !!l.control &&
      el.contains(l.control) &&
      !l.contains(l.control)
    );
  };
  const isRow = (el, c, parentKey = '') => {
    const p = el.parentElement;
    if (!p) return false;
    // 頁面設定指名的列（`PAGES[頁].rowSel`）：稿把每筆紀錄做成一顆獨立的按鈕（`button.rq`），沒有清單結構
    if (rowSel && el.matches(rowSel)) return true;
    if (
      (p.tagName === 'UL' ||
        p.tagName === 'OL' ||
        p.getAttribute('role') === 'list' ||
        p.tagName === 'TBODY') &&
      (el.tagName === 'LI' || el.tagName === 'TR' || el.getAttribute('role') === 'listitem')
    )
      return true;
    // 沒用 ul/li 的列（div 格線）：同層同簽名的容器，裡面沒有標題（有標題的是分組，不是列），
    // 且 ≥5 個、或 ≥3 個且子元素數都一樣
    if (c && c.kind !== 'text') return false;
    const H = 'h1,h2,h3,h4,h5,h6,[role=heading]';
    if (el.querySelector(H)) return false;
    if (fieldFrame(el)) return false;
    const s = sig(el);
    const sibs = [...p.children].filter((x) => sig(x) === s && !x.querySelector(H));
    // 分組（「今天：全部／已到…」「年級：…」）各組選項數不同；資料列的形狀一樣
    const same = sibs.every((x) => x.children.length === el.children.length);
    // 稿在這個父層有列（資料多）：app 資料少時門檻降到 2 個（軸列＋一位老師）。單獨一個仍不算 ——
    // 提示只說「這裡該有列」，沒說是哪一個容器，單個容器（工具列、日期條）會被誤認
    if (hinted.has(noList(parentKey)) && sibs.length >= 2 && same && !fieldGroup(el)) return true;
    return (
      sibs.length >= 5 ||
      (sibs.length >= 3 && sibs.every((x) => x.children.length === el.children.length))
    );
  };
  // 徽章：有底色或框線的短字（狀態標籤）
  const badge = (el) => {
    const st = getComputedStyle(el);
    const t = ownText(el);
    return (
      t.length <= 6 &&
      (st.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
        parseFloat(st.borderTopWidth) > 0 ||
        st.boxShadow !== 'none')
    );
  };
  const style = (el) => {
    const s = getComputedStyle(el);
    const o = {};
    for (const p of STYLE_PROPS) o[p] = s[p];
    return o;
  };
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  };

  // 黏住（sticky）：自己或最近的 sticky 祖先。sticky 容器常不是 part（A6 的 .chap__side 是 div），
  // 所以每個 part 記「被誰釘住」；id 區分同一頁的不同釘點，diff 只報每個釘點最上層的 part
  const pinMemo = new Map();
  const pinOf = (el) => {
    if (!el || el === document.documentElement) return null;
    if (pinMemo.has(el)) return pinMemo.get(el);
    const s = getComputedStyle(el);
    const r =
      s.position === 'sticky'
        ? {
            id: pinMemo.size + 1,
            at: ['top', 'bottom', 'left', 'right']
              .filter((k) => s[k] !== 'auto')
              .map((k) => `${k} ${s[k]}`)
              .join(' '),
          }
        : pinOf(el.parentElement);
    pinMemo.set(el, r);
    return r;
  };
  // tag：把 key → 元素留在 window（行為檢查要拿 key 找回元素；不改 DOM）
  const els = tag ? (window.__a6els = new Map()) : null;

  const parts = [];
  const byKey = new Map();
  // 遞迴：ctx = { key, counts（同層 segment 計數）, inRow, rowSeen（這一列已算過的 key）}
  // 稿的「新」標記（span.new）是設計說明（a6.js ddLabel 也剔掉它）：另記一份不含它的 key（alt）給配對用
  const noNew = (el) => {
    let t = '';
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (w.nextNode())
      if (!w.currentNode.parentElement?.closest('.new')) t += w.currentNode.textContent;
    return t;
  };
  const walk = (el, ctx) => {
    if (SKIP.has(el.tagName) || !visible(el)) return;
    const c0 = classify(el);
    const row = isRow(el, c0, ctx.key);
    let next = ctx;
    if (row) next = emit(el, { kind: 'row', role: 'row' }, true, next);
    // 整顆是按鈕的列：列裡保留那顆按鈕（app 是 li＞button，兩邊同 key）
    if (c0 && (!row || c0.kind === 'control')) next = emit(el, c0, false, next);
    for (const ch of el.children) walk(ch, next);
    if (el.shadowRoot) for (const ch of el.shadowRoot.children) walk(ch, next);
  };
  const emit = (el, c, row, ctx) => {
    let next = ctx;
    {
      // landmark／list 只認明寫的名字（aria-label），不然整段內文會進 key
      const named = c.kind === 'landmark' || c.kind === 'list' || c.kind === 'row';
      const raw = (
        c.kind === 'text'
          ? ownText(el)
          : named
            ? el.matches('[aria-label],[aria-labelledby]')
              ? accName(el)
              : ''
            : accName(el)
      )
        .replace(/\s+/g, ' ')
        .trim();
      let seg;
      if (c.kind === 'mapped') seg = el.getAttribute('data-a6-part');
      else if (c.kind === 'row') seg = 'row';
      else if (c.kind === 'list') seg = 'list';
      else if (ctx.inRow && !(c.kind === 'text' && badge(el)))
        seg = `${c.kind}:${c.role}`; // 列內文字是資料，不進 key（徽章例外：「上課中」「補課」是狀態，不是資料）
      else seg = `${c.kind}:${c.role}[${normText(raw, names)}]`;
      // 同一個 parent 底下同名 segment 加序號；列（row）全部合一
      const sib = (ctx.counts[seg] = (ctx.counts[seg] ?? 0) + 1);
      const suffix = (x) => (c.kind === 'row' || sib === 1 ? x : `${x}~${sib}`);
      const key = c.kind === 'mapped' ? seg : `${ctx.key}>${suffix(seg)}`;
      const named0 = el.matches('[aria-label],[aria-labelledby]');
      const segAlt =
        (c.kind === 'control' || c.kind === 'heading') &&
        !ctx.inRow &&
        !named0 &&
        el.querySelector('.new')
          ? seg.slice(0, seg.lastIndexOf('[') + 1) +
            normText(noNew(el).replace(/\s+/g, ' ').trim(), names) +
            ']'
          : seg;
      const alt = ctx.alt || segAlt !== seg ? `${ctx.alt ?? ctx.key}>${suffix(segAlt)}` : undefined;
      if (els && !els.has(key)) els.set(key, el);
      let p = byKey.get(key);
      if (!p) {
        p = {
          key,
          ...(alt ? { alt } : {}),
          parent: ctx.key || null,
          kind: c.kind === 'mapped' ? 'mapped' : c.kind,
          role: c.role,
          tpl: c.kind === 'row' || c.kind === 'list' ? '' : normText(raw, names),
          text: raw.slice(0, 80),
          // 含子元素的完整文字：判斷「寬度差是不是文字長度造成的」要看它（「已收 NT$ 174,100」的數字在子元素裡）
          full: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
          box: box(el),
          // 自己有沒有文字節點：字級／顏色只在這種 part 上才看得見（包一層 span 的連結，顏色在 span 上）
          own: !!ownText(el),
          // 有 ::before／::after 內容：線、圖示可能畫在那裡，工具不量（報告會標「工具限制」）
          pseudo: ['::before', '::after'].some(
            (x) => !['none', 'normal'].includes(getComputedStyle(el, x).content),
          ),
          style: style(el),
          pin: pinOf(el),
          // blockify 判斷用：DOM 的父元素，不是父 part（#1639）
          parentDisplay: el.parentElement ? getComputedStyle(el.parentElement).display : '',
          attrs: Object.fromEntries(
            [
              'aria-current',
              'aria-expanded',
              'aria-pressed',
              'aria-selected',
              'aria-checked',
              'disabled',
              'popovertarget',
              'href',
            ]
              .filter((a) => el.hasAttribute(a))
              .map((a) => [a, el.getAttribute(a)])
              // 原生 popovertarget：瀏覽器把展開狀態給輔助技術，但不寫進屬性 —— 補上，兩邊才可比
              .concat(
                el.hasAttribute('popovertarget') &&
                  !el.hasAttribute('aria-expanded') &&
                  el.getAttribute('popovertargetaction') !== 'hide'
                  ? [
                      [
                        'aria-expanded',
                        String(
                          !!document
                            .getElementById(el.getAttribute('popovertarget'))
                            ?.matches(':popover-open'),
                        ),
                      ],
                    ]
                  : [],
              ),
          ),
          // 最近的元件宿主（Angular／PrimeNG 的自訂元素，例如 p-paginator）：偏離規則與盤點用
          host: (() => {
            for (let x = el; x; x = x.parentElement)
              if (x.tagName.includes('-')) return x.tagName.toLowerCase();
            return '';
          })(),
          // 只給螢幕閱讀器的文字（1px、clip）：不是視覺 part，報告另列
          sr: (() => {
            const r = el.getBoundingClientRect();
            return r.width <= 1 || r.height <= 1 || getComputedStyle(el).clip.startsWith('rect(0');
          })(),
          inRows: 0,
          rows: c.kind === 'list' ? [...el.children].filter((x) => visible(x)).length : undefined,
        };
        parts.push(p);
        byKey.set(key, p);
      }
      // 列內同一個 key 會出現很多次：每次都記下樣式，最後取最常見的那種當代表（稿的第一列可能是
      // 軸列、第一個課塊可能是「上課中」—— 取第一個出現的會配錯對象）
      if (ctx.inRow || row) {
        const b = box(el);
        // 列內 part 相對「自己所在那一列」的位置：兩邊代表可能取自不同的列（稿取資料列、app 取軸列），
        // 用絕對位置比會把「第幾列」的差也算進來
        const rel = ctx.rowBox && !row ? [b[0] - ctx.rowBox[0], b[1] - ctx.rowBox[1]] : null;
        (p.occ ??= []).push({ box: b, style: style(el), rel });
      }
      if (ctx.inRow && !ctx.rowSeen.has(key)) {
        ctx.rowSeen.add(key);
        p.inRows++;
      }
      next = {
        key,
        alt,
        counts: {},
        inRow: ctx.inRow || row,
        rowSeen: row ? new Set() : ctx.rowSeen,
        rowBox: row ? box(el) : ctx.rowBox,
      };
      if (row) p.inRows++;
    }
    return next;
  };
  const rootEl = document.querySelector(rootSel);
  if (rootEl) walk(rootEl, { key: prefix, counts: {}, inRow: false, rowSeen: new Set() });
  for (const p of parts) {
    if (!p.occ) continue;
    const groups = new Map();
    for (const o of p.occ) {
      const k = JSON.stringify(o.style);
      groups.set(k, (groups.get(k) ?? []).concat(o));
    }
    const modal = [...groups.values()].sort((a, b) => b.length - a.length)[0];
    p.box = modal[0].box;
    if (modal[0].rel) p.rowRel = modal[0].rel;
    p.style = modal[0].style;
    p.variants = groups.size;
    delete p.occ;
  }
  return parts;
}

/** 給 page.evaluate 的字串：把 normText 一起帶進頁面。 */
export const extractSource = (opts) =>
  `(() => { const normText = ${normText.toString()}; const STYLE_PROPS = ${JSON.stringify(STYLE_PROPS)}; return (${extractParts.toString()})(${JSON.stringify(opts ?? {})}); })()`;
