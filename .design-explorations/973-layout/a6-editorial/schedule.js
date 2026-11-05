/*
 * A6（第六輪，在 A5 上改）：開場色面下方加「常用批次」三張情境卡；「異動」條換成慢慢捲動的跑馬燈＋
 * 「全部異動」抽屜（#changes）。異動紀錄（LOG）是跑馬燈、抽屜、單堂「查看異動紀錄」共用的一份，
 * 套用批次／單堂動作時會寫進去。以下是 A4 起的說明。
 *
 * A4 課表（第四輪，在 A3 上改）：首屏只回答「今天哪裡有異動、我要動哪一堂」；
 * 操作區（日／週工具列、批次動作列、步驟頁底部）是黑面，甘特與課塊是白面。
 * 以下沿用 A3：日視圖＝以老師為列的甘特（老師同時只能上一堂，所以列內不會疊），
 * 週視圖＝每天一欄、依開始時間分組的清單。資料一律用 shared/stress.js（同時 12–15 班的最壞情況）。
 * 勾課 → 動作 → 預覽（dryRun）→ 套用，三個例子可用純 hash 直接進入：
 *   #typhoon(-action|-preview|-done)、#teacher-leave(...)、#retime(...)、#op（單堂操作）、#day、#week
 */
(function () {
  const { icon, shell, md, toMin } = A2;
  const X = window.CLESSIA_STRESS;
  const TODAY = X.today, NOW = X.now, NOWM = toMin(NOW);
  const ZH = '日一二三四五六';
  const dobj = (iso) => new Date(iso + 'T00:00:00');
  const wdz = (iso) => ZH[dobj(iso).getDay()];
  const addD = (iso, n) => { const d = dobj(iso); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TERM_END = '2027-01-15';
  const HOLIDAY = { '2026-10-09': '國慶補假', '2026-10-10': '國慶日', '2027-01-01': '元旦' };
  const P = (d) => `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ic = {
    ...icon,
    more: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="12.5" cy="8" r="1.4" fill="currentColor"/></svg>',
    link: P('<path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1"/>'),
    move: P('<path d="M2.5 8h11M10 4.5L13.5 8 10 11.5"/>'),
    user: P('<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5a5 5 0 0110 0"/>'),
    undo: P('<path d="M5 6.5H10a3 3 0 010 6H6M5 6.5L7.5 4M5 6.5L7.5 9"/>'),
    info: P('<circle cx="8" cy="8" r="6.2"/><path d="M8 7.3v3.7M8 5h.01"/>'),
    cal: P('<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 7h11M5.5 2v3M10.5 2v3"/>'),
  };

  // ── 資料 ───────────────────────────────────────────────────────────
  const SS = X.sessions;
  // stress.js 代課只換了名字；以「實際上課的人」為準
  const tid = Object.fromEntries(X.teachers.map((t) => [t.name, t.id]));
  SS.forEach((s) => { s.teacherId = s.teacher ? tid[s.teacher] : null; });
  const extra = []; // 「某班整期」展開出來的之後週次（stress 只有本週；之後的週以本週同一個星期幾當重複課表的代理）
  const all = () => SS.concat(extra);
  const byId = (id) => all().find((s) => s.id === id);
  const DAYS = X.days.map((d) => d.date);
  const editable = (s) => s.status === 'scheduled' || s.status === 'in_progress'; // 產品端「上課中」的 status 仍是 scheduled
  const fromNow = (s) => s.date > TODAY || (s.date === TODAY && s.start > NOW);
  const len = (s) => toMin(s.end) - toMin(s.start);
  const overlap = (a, b, c, d) => a < d && c < b;

  // ── 異動紀錄（＝產品的 schedule_changes）：跑馬燈與「全部異動」共用這一份 ──────────
  // 類型用字沿用課表上的動作名稱；批次的同一次操作共用一個 batch id（產品端是 isBatch）。
  const TYPE = { reschedule: '調課', substitute: '代課', cancel: '停課', time: '改時間', uncancel: '恢復上課', makeup: '補課' };
  const TK = { reschedule: 'move', substitute: 'sub', cancel: 'cancel', time: 'time', uncancel: 'uncancel', makeup: 'makeup' };
  const LOG = [];
  let bseq = 0;
  const newBatch = () => 'b' + ++bseq;
  const logOf = (s, type, o) => LOG.push({ id: 'L' + LOG.length, sid: s.id, date: s.date, start: s.start, cls: s.className, teacher: s.teacher, type, detail: o.detail || '', reason: o.reason || '', by: o.by || '林主任', at: o.at || `${TODAY}T${NOW}`, batch: o.batch || null, synth: !!o.synth });
  // stress.js 本週已經發生的異動（操作者與時間是補上的）
  const B0 = newBatch();
  SS.forEach((s) => {
    const c = s.change;
    if (!c) return;
    if (c.type === 'cancel') logOf(s, 'cancel', { reason: (c.reason || '').replace('（批次）', ''), batch: B0, at: '2026-10-01T16:05' });
    if (c.type === 'substitute') logOf(s, 'substitute', { detail: `${c.from} → ${s.teacher}`, reason: c.reason, by: '張教務', at: '2026-10-01T13:40' });
    if (c.type === 'reschedule') logOf(s, 'reschedule', { detail: `從 ${md(c.fromDate)} ${c.fromStart} 移來`, reason: c.reason, by: '張教務', at: '2026-09-29T10:02' });
    if (c.type === 'makeup') logOf(s, 'makeup', { detail: `補 ${c.forLabel}`, reason: '颱風停課補課', at: '2026-10-01T16:20' });
  });
  // ponytail: 合成的過去 4 週歷史（9/1–9/27）—— stress.js 只有本週，這段只為了讓「全部異動」有歷史可篩。
  // 這些紀錄沒有對應的課堂（sid 為 null），所以不能「看這堂」。
  (function synth() {
    let seed = 977;
    const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const pk = (a) => a[Math.floor(r() * a.length)];
    const T = X.teachers.map((t) => t.name), C = [...new Set(SS.map((s) => s.className))], S = ['17:00', '17:30', '18:00', '18:30', '19:00'];
    const OPS = ['林主任', '張教務', '陳櫃台'];
    const at = (d) => `${addD(d, -1 - Math.floor(r() * 4))}T${String(9 + Math.floor(r() * 10)).padStart(2, '0')}:${pk(['05', '12', '20', '38', '47'])}`;
    const mk = (date, type, o) => logOf({ id: null, date, start: o.start || pk(S), className: o.cls || pk(C), teacher: o.teacher || pk(T) }, type, Object.assign({ synth: true, by: pk(OPS), at: at(date) }, o));
    const b1 = newBatch(); // 中秋節（9/25 週五）整天停課，一批
    for (let i = 0; i < 14; i++) mk('2026-09-25', 'cancel', { reason: '中秋節停課', batch: b1, by: '林主任', at: '2026-09-14T10:20' });
    const out = T[3], sub = T[8]; // 一位老師請假三天，一堂一堂代課（批次代課還不存在）
    ['2026-09-16', '2026-09-17', '2026-09-18'].forEach((d, i) => mk(d, 'substitute', { teacher: sub, detail: `${out} → ${sub}`, reason: `${out} 請假`, by: '張教務', at: `2026-09-15T1${i + 1}:05` }));
    const c3 = C.find((c) => c.startsWith('國三')) || C[0], b2 = newBatch(); // 一個班整期改時段（批次，同一天）
    ['2026-09-07', '2026-09-14', '2026-09-21'].forEach((d) => mk(d, 'time', { cls: c3, start: '19:00', detail: '18:30 → 19:00', reason: '配合學校第八節課', batch: b2, by: '林主任', at: '2026-09-04T15:30' }));
    ['reschedule', 'cancel', 'makeup', 'reschedule', 'uncancel', 'substitute', 'cancel', 'reschedule', 'makeup', 'time'].forEach((type) => {
      let d; do d = `2026-09-${String(1 + Math.floor(r() * 26)).padStart(2, '0')}`; while (dobj(d).getDay() === 0);
      const cls = pk(C), a = pk(T), b = pk(T.filter((x) => x !== a));
      const o = {
        reschedule: { detail: `從 ${md(addD(d, -2))} ${pk(S)} 移來`, reason: pk(['學校段考週', '老師研習', '家長要求']) },
        cancel: { reason: pk(['學校段考', '老師病假', '教室冷氣維修']) },
        makeup: { detail: `補 ${md(addD(d, -5))} ${cls}`, reason: '停課補課' },
        uncancel: { detail: '恢復成要上課', reason: '段考改期' },
        substitute: { teacher: b, detail: `${a} → ${b}`, reason: `${a} 病假` },
        time: { detail: '19:00 → 19:30', reason: '家長接送時間' },
      }[type];
      mk(d, type, Object.assign({ cls }, o));
    });
  })();

  // 同一位老師同一天時間重疊 = 撞堂（日常資料不會有；批次代課／指派的預覽會算出來）
  const clash = (s) => s.teacher && s.status !== 'cancelled' && all().some((o) => o !== s && o.date === s.date && o.teacher === s.teacher && o.status !== 'cancelled' && overlap(toMin(s.start), toMin(s.end), toMin(o.start), toMin(o.end)));

  // ── 狀態 ───────────────────────────────────────────────────────────
  const st = { view: 'day', day: TODAY, sel: new Set(), selLabel: '', last: null, picking: false, flow: null, order: [] };

  // ── 狀態標記：文字＋形狀（不只靠顏色） ─────────────────────────────
  function tags(s, short) {
    const t = [], c = s.change || {};
    if (s.status === 'in_progress') t.push(['live', '<span class="dot" aria-hidden="true"></span>', '上課中']);
    if (s.status === 'completed') t.push(['done', '', '已上完']);
    if (s.status === 'cancelled') t.push(['cancel', ic.x, short ? '停課' : `停課${c.reason ? ' · ' + c.reason : ''}`]);
    if (c.type === 'substitute') t.push(['sub', ic.swap, short ? '代課' : `代課 · 原 ${c.from}`]);
    if (c.type === 'reschedule') t.push(['move', ic.move, short ? '調課' : `調課 · 從 ${md(c.fromDate)} ${c.fromStart} 移來`]);
    if (c.type === 'makeup') t.push(['makeup', ic.link, short ? '補課' : `補課 · 補 ${c.forLabel}`]);
    if (!s.teacher && s.status !== 'cancelled') t.push(['none', ic.alert, '未指派老師']);
    if (clash(s)) t.push(['clash', ic.alert, short ? '撞堂' : '老師撞堂']);
    return t;
  }
  const tagHtml = (s, short) => tags(s, short).map(([k, i, l]) => `<span class="stag stag--${k}">${i}${esc(l)}</span>`).join('');
  const kind = (s) => s.status === 'cancelled' ? 'cancelled' : s.status === 'completed' ? 'done' : s.status === 'in_progress' ? 'live' : 'next';
  const changed = (s) => s.status === 'cancelled' || (s.change && s.change.type !== 'cancel') || clash(s);

  // ── 密度：每 15 分鐘同時幾班 ─────────────────────────────────────
  function span(list) {
    const ms = list.map((s) => toMin(s.start)), me = list.map((s) => toMin(s.end));
    return [Math.floor(Math.min(...ms) / 60), Math.ceil(Math.max(...me) / 60)];
  }
  function density(list, h0, h1) {
    const live = list.filter((s) => s.status !== 'cancelled');
    const out = [];
    for (let m = h0 * 60; m < h1 * 60; m += 15) out.push({ m, n: live.filter((s) => toMin(s.start) <= m && toMin(s.end) > m).length });
    return out;
  }
  function peak(list) {
    const [h0, h1] = span(list), d = density(list, h0, h1);
    const max = Math.max(...d.map((x) => x.n));
    if (!max) return { max: 0, from: '—', to: '—' };
    const i = d.findIndex((x) => x.n === max);
    let j = i; while (j + 1 < d.length && d[j + 1].n === max) j++;
    return { max, from: hm(d[i].m), to: hm(d[j].m + 15) };
  }
  const dayList = (iso) => SS.filter((s) => s.date === iso).sort((a, b) => a.start.localeCompare(b.start) || (a.teacher || '').localeCompare(b.teacher || ''));
  const dayName = (iso) => iso === TODAY ? '今天' : `週${wdz(iso)} ${md(iso)}`;

  // ── 開場色面（文字跟著日／週換） ─────────────────────────────────
  function bandData() {
    if (st.view === 'week') {
      const per = DAYS.map((d) => ({ d, p: peak(dayList(d)) }));
      const top = per.reduce((a, b) => (b.p.max > a.p.max ? b : a));
      const ch = SS.filter(changed).length;
      return { title: `這週 ${SS.filter((s) => s.status !== 'cancelled').length} 堂課，<br>${ch ? `${ch} 堂有異動。` : '沒有異動。'}`, stats: [] };
    }
    const l = dayList(st.day), live = l.filter((s) => s.status !== 'cancelled').length, ch = l.filter(changed).length;
    return { title: live ? `${dayName(st.day)} ${live} 堂課，<br>${ch ? `${ch} 堂有異動。` : '沒有異動。'}` : `${dayName(st.day)}<br>${l.length} 堂全部停課。`, stats: [] };
  }
  function paintBand() {
    document.querySelector('.open__title').innerHTML = bandData().title;
  }

  // ── 共用：一堂課的勾選框與「操作」按鈕 ─────────────────────────────
  const pick = (s) => `<input type="checkbox" class="pick" data-pick="${s.id}" ${st.sel.has(s.id) ? 'checked' : ''} aria-label="勾 ${esc(s.className)} ${md(s.date)} ${s.start}">`;

  // ── 日視圖：以老師為列的甘特 ─────────────────────────────────────
  function gantt(list) {
    const [h0, h1] = span(list), hrs = h1 - h0;
    const x = (t) => ((toMin(t) - h0 * 60) / (hrs * 60)) * 100;
    const rows = new Map();
    list.forEach((s) => { const k = s.teacher || ''; if (!rows.has(k)) rows.set(k, []); rows.get(k).push(s); });
    const ordered = [...rows.entries()].sort((a, b) => (a[0] === '') - (b[0] === '') || a[1][0].start.localeCompare(b[1][0].start));
    const p = peak(list);
    const order = [];
    const rowHtml = ordered.map(([name, ss]) => {
      // 車道：同一列若真的重疊（撞堂）就往下疊一條，而不是蓋住
      const lanes = [];
      const placed = ss.map((s) => { let l = lanes.findIndex((e) => e <= s.start); if (l < 0) { l = lanes.length; lanes.push(''); } lanes[l] = s.end; return { s, l }; });
      const sub = ss.filter((s) => s.change && s.change.type === 'substitute').length;
      const blocks = placed.map(({ s, l }) => {
        order.push(s.id);
        const sel = st.sel.has(s.id) ? ' is-sel' : '';
        return `<div class="gb gb--${kind(s)}${sel}" style="left:${x(s.start)}%;width:${x(s.end) - x(s.start)}%;top:calc(${l} * var(--lane))">
          ${pick(s)}
          <button type="button" class="gb__main" data-op="${s.id}" aria-label="${esc(s.className)} ${s.start}–${s.end}：看看能做什麼">
            <span class="gb__name">${esc(s.className)}</span>
            <span class="gb__meta">${s.start}–${s.end} · ${s.students} 人</span>
            <span class="gb__tags">${tagHtml(s)}</span>
            <span class="gb__more" aria-hidden="true">${ic.more}</span>
          </button>
        </div>`;
      }).join('');
      return `<div class="gt__row" style="--lanes:${lanes.length}">
        <div class="gt__lab">${name ? `<span class="gt__who">${esc(name)}</span><span class="gt__n">${ss.length} 堂${sub ? ' · 含代課' : ''}${lanes.length > 1 ? ' · <b class="gt__warn">撞堂</b>' : ''}</span>` : `<span class="gt__who gt__who--none">還沒指派老師</span><span class="gt__n">${ss.length} 堂</span>`}</div>
        <div class="gt__track">${blocks}</div></div>`;
    }).join('');
    st.order = order;
    const band = p.max ? `<div class="gt__pkband" style="--a:${x(p.from)};--b:${x(p.to)}" aria-hidden="true"><span>最滿 ${p.max} 班</span></div>` : '';
    const nowX = st.day === TODAY ? x(NOW) : -99;
    const ticks = Array.from({ length: hrs + 1 }, (_, i) => Math.abs((i / hrs) * 100 - nowX) < 7 ? '<span></span>' : `<span style="left:${(i / hrs) * 100}%">${h0 + i}:00</span>`).join('');
    const now = st.day === TODAY && toMin(NOW) > h0 * 60 ? `<div class="gt__now" style="--x:${x(NOW)}"><span>現在 ${NOW}</span></div>` : '';
    return `<div class="gt" style="--hrs:${hrs}">
      <div class="gt__scroll"><div class="gt__grid">
        ${band}
        <div class="gt__row gt__row--axis"><div class="gt__lab gt__lab--axis">老師</div><div class="gt__track gt__ticks">${ticks}</div></div>
        ${rowHtml}
        ${now}
      </div></div></div>`;
  }

  // ── 清單（手機日視圖＋桌機週視圖的每一欄共用），依開始時間分組 ─────────
  function list(ss, compact) {
    const groups = new Map();
    ss.forEach((s) => { if (!groups.has(s.start)) groups.set(s.start, []); groups.get(s.start).push(s); });
    return [...groups.entries()].map(([t, g]) => `<div class="lg">
      <div class="lg__h"><b>${t}</b> 開始 · ${g.length} 堂</div>
      ${g.map((s) => { st.order.push(s.id); return `<div class="li li--${kind(s)}${st.sel.has(s.id) ? ' is-sel' : ''}" data-row="${s.id}">
        ${pick(s)}
        <button type="button" class="li__main" data-op="${s.id}" aria-label="${st.sel.has(s.id) ? '已勾，' : ''}${esc(s.className)} ${s.start}–${s.end}：看看能做什麼">
          <span class="li__name">${esc(s.className)}</span>
          <span class="li__meta">${compact ? `到 ${s.end}` : `${s.start}–${s.end}`} · <span class="nb">${s.teacher ? esc(s.teacher) : '未指派'}</span>${compact ? '' : ` · ${s.students} 人`}</span>
          ${tags(s).length ? `<span class="li__tags">${tagHtml(s, compact)}</span>` : ''}
        </button>
        <button type="button" class="li__more" data-op="${s.id}" aria-label="${esc(s.className)} 的操作">${ic.more}</button>
      </div>`; }).join('')}</div>`).join('');
  }

  // ── 異動跑馬燈（A6）：今天起 7 天內的異動，一則一顆按鈕；同一批的收成一則 ─────────
  const ICON = { cancel: ic.x, substitute: ic.swap, reschedule: ic.move, makeup: ic.link, time: ic.clock, uncancel: ic.undo };
  const typeTag = (e, label) => `<span class="stag stag--${TK[e.type]}">${ICON[e.type]}${esc(label || TYPE[e.type])}</span>`;
  const rel = (iso) => iso === TODAY ? '今天' : iso === addD(TODAY, 1) ? '明天' : `週${wdz(iso)} ${md(iso)}`;
  const when = (at) => `${md(at.slice(0, 10))} ${at.slice(11)}`;
  function nearItems() {
    const end = addD(TODAY, 6), out = [], by = new Map();
    LOG.filter((e) => e.date >= TODAY && e.date <= end).forEach((e) => {
      if (!e.batch) { out.push({ k: e.date + e.start, one: e }); return; }
      if (!by.has(e.batch)) { const g = { batch: e.batch, es: [] }; by.set(e.batch, g); out.push(g); }
      by.get(e.batch).es.push(e);
    });
    out.forEach((g) => { if (g.es) { g.es.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)); g.k = g.es[0].date + g.es[0].start; } });
    return out.sort((a, b) => a.k.localeCompare(b.k));
  }
  function tkItem(g) {
    if (g.one) {
      const e = g.one;
      return `<li><button type="button" class="tk__it" data-goto="${e.sid}"><b class="tk__when">${rel(e.date)} ${e.start}</b><span class="tk__cls">${esc(e.cls)}</span>${typeTag(e)}${e.detail ? `<span class="tk__d">${esc(e.detail)}</span>` : ''}</button></li>`;
    }
    // 一批可能跨好幾天（整期改時段）：寫第一天＋「起」、堂數算整批，不只算這 7 天內的
    const e = g.es[0], whole = LOG.filter((x) => x.batch === g.batch), multi = whole.some((x) => x.date !== e.date), r = rel(e.date);
    return `<li><button type="button" class="tk__it" data-batch="${g.batch}"><b class="tk__when">${r}${multi ? (r.length === 2 ? '起' : ' 起') : ''}</b>${typeTag(e, `${TYPE[e.type]} ${whole.length} 堂`)}${e.reason ? `<span class="tk__d">${esc(e.reason)}</span>` : ''}<span class="bchip">批次</span></button></li>`;
  }
  function ticker() {
    const items = nearItems();
    const lis = items.map(tkItem).join('');
    return `<section class="tk" aria-label="近期異動">
      <h2 class="tk__h">異動<span class="tk__n">今天起 ${items.length} 則</span></h2>
      ${items.length ? `<button type="button" class="tk__pause" data-tkpause aria-pressed="${tk.user}" aria-label="${tk.user ? '繼續捲動' : '暫停捲動'}" title="${tk.user ? '繼續捲動' : '暫停捲動'}">${tk.user ? '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" fill="currentColor"/></svg>' : '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9M11 3.5v9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'}</button>
      <div class="tk__scroll"><ul class="tk__list">${lis}</ul><ul class="tk__list tk__dup" aria-hidden="true" inert>${lis}</ul></div>` : '<p class="tk__none">今天起沒有異動</p>'}
      <button type="button" class="tlink tk__all" data-allchg>全部異動${ic.right}</button>
    </section>`;
  }
  // 慢慢捲：用 scrollLeft 而不是 transform —— 停住時可以自己左右滑、鍵盤焦點會把那一則捲進來，
  // 所以每一則都讀得完整。prefers-reduced-motion 時不跑，剩一列可以左右滑的清單。
  const tk = { pos: 0, hover: false, focus: false, touch: 0, user: false, seen: true, last: 0 };
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const SPEED = 32; // px／秒
  function tkFrame(t) {
    const el = document.querySelector('.tk__scroll');
    const dt = tk.last ? Math.min(0.1, (t - tk.last) / 1000) : 0;
    tk.last = t;
    if (el) {
      const half = el.firstElementChild.offsetWidth; // 第一份清單的寬（含尾端間距）＝繞一圈的距離
      const moving = !RM.matches && half > el.clientWidth;
      el.classList.toggle('is-moving', moving);
      const paused = tk.hover || tk.focus || tk.user || Date.now() < tk.touch || !tk.seen || document.hidden;
      if (moving && !paused) {
        if (Math.abs(el.scrollLeft - tk.pos) > 2) tk.pos = el.scrollLeft; // 使用者自己滑過：從那裡接著走
        tk.pos += SPEED * dt;
        if (tk.pos >= half) tk.pos -= half;
        el.scrollLeft = tk.pos;
      }
    }
    requestAnimationFrame(tkFrame);
  }

  function dayView() {
    const ss = dayList(st.day);
    st.order = [];
    const ml = list(ss, false);
    const g = gantt(ss); // 甘特最後算，Shift 範圍勾選用它的順序（老師列由上而下）
    const p = peak(ss);
    return `<p class="pkl">${p.max ? `${dayName(st.day)}${st.day === TODAY ? '' : ' '}最滿 <b>${p.from}–${p.to}</b> · 同時 ${p.max} 班` : `${dayName(st.day)}整天停課`}</p>
      <div class="only-desk">${g}</div>
      <div class="only-mob"><div class="mlist">${ml}</div></div>`;
  }

  function weekView() {
    st.order = [];
    const cols = DAYS.map((d) => {
      const ss = dayList(d), p = peak(ss), ch = ss.filter(changed).length;
      return `<section class="wc${d === TODAY ? ' wc--today' : ''}" aria-label="週${wdz(d)} ${md(d)}">
        <header class="wc__h">
          <div class="wc__dow">週${wdz(d)}${d === TODAY ? ' · 今天' : ''}</div>
          <div class="wc__date">${md(d)}</div>
          <div class="wc__sum">${ss.length} 堂 · 最多同時 <b>${p.max}</b></div>
          <div class="wc__sum">${ch ? `異動 ${ch}` : '沒有異動'}</div>
          <button type="button" class="qlink" data-qday="${d}">勾選這一整天</button>
        </header>
        ${list(ss, true)}
      </section>`;
    }).join('');
    const mob = DAYS.map((d) => {
      const ss = dayList(d), p = peak(ss), c = ss.filter((s) => s.status === 'cancelled').length, ch = ss.filter(changed).length;
      return `<div class="wm${d === TODAY ? ' wm--today' : ''}">
        <button type="button" class="wm__go" data-goday="${d}">
          <span class="wm__d"><b>週${wdz(d)}</b> ${md(d)}${d === TODAY ? ' · 今天' : ''}</span>
          <span class="wm__s">${ss.length} 堂 · ${p.max ? `${p.from} 同時 ${p.max} 班` : '整天停課'}${c ? ` · 停課 ${c}` : ''}${ch - c > 0 ? ` · ${c ? '其他' : ''}異動 ${ch - c}` : ''}${ss.filter((s) => st.sel.has(s.id)).length ? ` · <b>已勾 ${ss.filter((s) => st.sel.has(s.id)).length}</b>` : ''}</span>
          ${ic.right}
        </button>
        <button type="button" class="qlink" data-qday="${d}">勾選這一整天</button>
      </div>`;
    }).join('');
    return `<div class="only-desk wk">${cols}</div><div class="only-mob wkm">${mob}</div>`;
  }

  // ── 控制列 ─────────────────────────────────────────────────────────
  // 「一次勾：」三個控制項 —— 桌機在工具列下面那一列，手機在快速選取面板裡
  function quick() {
    const tSel = X.teachers.map((t) => `<option value="${t.name}">${t.name}</option>`).join('');
    const cSel = dayList(st.day).filter(editable).map((s) => `<option value="${s.id}">${esc(s.className)}（週${wdz(s.date)} ${s.start}）</option>`).join('');
    return `<button type="button" class="btn btn--sm" data-qday="${st.day}">${ic.cal}這一整天（${dayName(st.day)}）</button>
        <label class="qsel"><span class="sr">某位老師這週的課</span><select data-qteacher><option value="">某位老師這週的課…</option>${tSel}</select></label>
        <label class="qsel"><span class="sr">某個班整期的課</span><select data-qclass><option value="">某個班整期的課…</option>${cSel}</select></label>`;
  }
  const pickLabel = () => `快速選取${st.sel.size ? ` · 已勾 ${st.sel.size}` : ''}`;
  function ctx() {
    const tabs = DAYS.map((d) => `<button type="button" class="dtab" data-day="${d}"${st.view === 'day' && d === st.day ? ' aria-current="true"' : ''}><span>週${wdz(d)}</span><b>${md(d)}</b>${d === TODAY ? '<i>今天</i>' : ''}</button>`).join('');
    // 手機：入口只是打開底部面板（沒有原地的勾選模式、沒有「完成」）
    const entry = mob()
      ? `<button type="button" class="btn btn--sm sx__pickmode" data-pickmode aria-haspopup="dialog">${pickLabel()}</button>`
      : `<button type="button" class="btn btn--sm sx__pickmode" data-pickmode aria-pressed="${st.picking}">${st.picking ? `${ic.check}完成` : '快速選取'}</button>`;
    return `<div class="sx inkbar">
      <div class="sx__row">
        <div class="vsw" role="group" aria-label="檢視">
          <button type="button" class="vsw__b" data-view="day"${st.view === 'day' ? ' aria-current="true"' : ''}>日</button>
          <button type="button" class="vsw__b" data-view="week"${st.view === 'week' ? ' aria-current="true"' : ''}>週</button>
        </div>
        <span class="sx__range">9/28 – 10/3</span>
        <div class="dtabs">${tabs}</div>
        <div class="sx__tools">
          ${entry}
        </div>
      </div>
      ${st.picking && !mob() ? `<div class="sx__row sx__row--q">
        <span class="sx__ql">一次勾：</span>
        ${quick()}
        <span class="sx__hint">按住 Shift 再勾一堂，中間的會一起勾起來</span>
      </div>` : ''}
    </div>`;
  }

  // ── 批次動作列 ─────────────────────────────────────────────────────
  const ACTS = {
    cancel: { label: '停課', api: 'PATCH /sessions/batch-cancel', icon: ic.x },
    uncancel: { label: '恢復課堂', api: 'PATCH /sessions/batch-uncancel', icon: ic.undo },
    time: { label: '改時間（同一天）', api: 'PATCH /sessions/batch-update-time', icon: ic.clock },
    move: { label: '改到別天', api: '新：batch-reschedule', icon: ic.move, isNew: true },
    assign: { label: '指派老師', api: 'PATCH /sessions/batch-assign-teacher', icon: ic.user },
    sub: { label: '批次代課', api: '新：batch-substitute', icon: ic.swap, isNew: true },
  };
  const NEW = '<span class="new" title="現在的系統沒有這個功能">新</span>';
  function bar() {
    sheetSync();
    const n = mob() ? 0 : st.sel.size; // 手機沒有批次列：數字與動作都在快速選取面板裡
    const el = document.getElementById('bar');
    document.body.classList.toggle('has-sel', n > 0);
    if (!n) { el.innerHTML = ''; return; }
    const ss = [...st.sel].map(byId);
    const anyC = ss.some((s) => s.status === 'cancelled');
    const shown = ss.filter((s) => s.date === (st.view === 'day' ? st.day : s.date) && DAYS.includes(s.date)).length;
    const keys = ['cancel', anyC && 'uncancel', 'time', 'move', 'assign', 'sub'].filter(Boolean);
    el.innerHTML = `<div class="wrap"><div class="bar__in inkbar">
      <div class="bar__count"><span class="bar__n">已勾 <b>${n}</b> 堂</span><span class="bar__src">${esc(st.selLabel || '逐堂勾選')}${shown < n ? ` · 畫面上看得到 ${shown} 堂` : ''}</span>${st.pending ? `<span class="bar__hint">下一步：按「${ACTS[st.pending.act].label}」</span>` : ''}</div>
      <div class="bar__acts">${keys.map((k) => `<button type="button" class="btn bar__btn${k === 'cancel' ? ' bar__btn--main' : ''}${st.pending && st.pending.act === k ? ' btn--primary bar__btn--next' : ''}" data-act="${k}">${ACTS[k].icon}${ACTS[k].label}${ACTS[k].isNew ? NEW : ''}</button>`).join('')}
        <button type="button" class="btn btn--ink bar__all" data-act="">選動作${ic.right}</button>
        <button type="button" class="tlink bar__clear" data-clear>全部取消選取</button></div></div></div>`;
  }

  // ── 手機：快速選取面板（從底部升起的 <dialog>）—— 取代原地勾選模式與底部批次列 ─────────
  // 關掉面板＝離開選取模式；已勾的課留著。沒有「完成」。
  const sheetMain = () => (st.pending && ACTS[st.pending.act] ? st.pending.act : 'cancel'); // 從情境進來時，主動作＝那個情境的下一步
  function sheetHtml() {
    const groups = new Map();
    dayList(st.day).forEach((s) => { if (!groups.has(s.start)) groups.set(s.start, []); groups.get(s.start).push(s); });
    const why = (s) => s.status === 'cancelled' ? '已停課' : s.status === 'completed' ? '已上完' : '';
    const rows = [...groups.entries()].map(([t, g]) => `<div class="qs__g"><div class="lg__h"><b>${t}</b> 開始 · ${g.length} 堂</div>
      ${g.map((s) => `<label class="qs__row${editable(s) ? '' : ' is-off'}">
        <input type="checkbox" class="qs__pick" data-pick="${s.id}"${st.sel.has(s.id) ? ' checked' : ''}${editable(s) ? '' : ' disabled'}>
        <span class="qs__name">${esc(s.className)}</span>
        <span class="qs__meta">${s.start}–${s.end} · ${s.teacher ? esc(s.teacher) : '未指派'}${why(s) ? ` · <b>${why(s)}</b>` : ''}</span>
      </label>`).join('')}</div>`).join('');
    const k = sheetMain();
    return `<header class="qs__head"><h2 class="qs__t" id="qs-t">快速選取</h2><span class="qs__day">週${wdz(st.day)} ${md(st.day)}${st.day === TODAY ? ' · 今天' : ''}</span>
        <button type="button" class="qs__x" data-qsclose aria-label="關閉">${ic.x}</button></header>
      <div class="qs__body">
        <div class="qs__q"><span class="qs__ql">一次勾：</span>${quick()}</div>
        <div class="qs__list">${rows || '<p class="qs__none">這一天沒有課。</p>'}</div>
      </div>
      <footer class="qs__foot">
        <div class="qs__sum"><span class="qs__n" aria-live="polite"></span><button type="button" class="tlink qs__clear" data-clear>全部取消選取</button></div>
        <div class="qs__acts"><button type="button" class="btn" data-act="">其他動作</button><button type="button" class="btn btn--cta" data-act="${k}">${ACTS[k].icon}${ACTS[k].label}</button></div>
      </footer>`;
  }
  function paintSheet() {
    const qs = document.getElementById('qs'), b = qs.querySelector('.qs__body'), y = b ? b.scrollTop : 0;
    qs.innerHTML = sheetHtml();
    qs.querySelector('.qs__body').scrollTop = y;
    sheetSync();
  }
  function openSheet() {
    const qs = document.getElementById('qs');
    paintSheet();
    if (!qs.open) qs.showModal();
    sheetSync(); // 數字要在 open 之後才寫得進去
  }
  // 勾一堂時不重畫面板，只更新數字、按鈕可不可按、入口按鈕上的「已勾 N」
  function sheetSync() {
    const n = st.sel.size, qs = document.getElementById('qs'), entry = document.querySelector('[data-pickmode]');
    if (entry && mob()) entry.textContent = pickLabel();
    if (!qs || !qs.open) return;
    const shown = [...st.sel].filter((id) => byId(id).date === st.day).length;
    qs.querySelector('.qs__n').innerHTML = `已勾 <b>${n}</b> 堂${n && shown < n ? `<span class="qs__src">這一天 ${shown} 堂，其他 ${n - shown} 堂在別天</span>` : ''}`;
    qs.querySelectorAll('[data-act],[data-clear]').forEach((b) => { b.disabled = !n; });
  }

  // ── 勾課 ───────────────────────────────────────────────────────────
  function setSel(ids, label) { st.sel = new Set(ids); st.selLabel = label; st.last = null; if (ids.length) st.picking = true; }
  function selectDay(d) { setSel(dayList(d).map((s) => s.id), `${dayName(d)} 整天`); }
  function selectTeacher(name) { setSel(SS.filter((s) => s.teacher === name && fromNow(s) && s.status !== 'cancelled').sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).map((s) => s.id), `${name} 這週（今天起）`); }
  function selectClass(id) {
    const base = byId(id);
    // 整期 = 本週這一堂＋之後每週同一時段直到期末；國定假日那週已停課
    extra.splice(0, extra.length, ...extra.filter((e) => e.base !== base.id));
    for (let d = addD(base.date, 7), k = 1; d <= TERM_END; d = addD(d, 7), k++) {
      extra.push({ ...base, id: `${base.id}w${k}`, base: base.id, date: d, status: HOLIDAY[d] ? 'cancelled' : 'scheduled', change: HOLIDAY[d] ? { type: 'cancel', reason: `${HOLIDAY[d]}停課` } : null });
    }
    const ids = [base, ...extra.filter((e) => e.base === base.id)].filter(fromNow).map((s) => s.id);
    setSel(ids, `${base.className} 整期（今天起到 ${md(TERM_END)}）`);
  }

  // ── 單堂操作（看得見的「⋯」→ 浮層；手機是底部抽屜） ──────────────────
  function opItems(s) {
    const a = [];
    a.push(['log', '查看異動紀錄', '誰在什麼時候改過這堂']);
    if (s.date <= TODAY && s.status !== 'cancelled') a.push(['att', '管理出勤狀況', '點名、補登到班']);
    if (editable(s)) a.push(['resched', '調課', '改日期或時間（不能換老師）']);
    if (editable(s) && s.teacher) a.push(['substitute', '代課', '找人代這一堂，會留代課紀錄']);
    if (editable(s) && !s.teacher) a.push(['assign1', '指派老師', '這堂還沒有老師']);
    if (editable(s)) a.push(['makeup', s.change && s.change.type === 'makeup' ? '改指定補課' : '指定為補課', '把這堂已排定的課當作補某一堂停課']);
    if (editable(s)) a.push(['cancel1', '停課', '學生不用來；之後可以恢復']);
    if (s.status === 'cancelled') a.push(['uncancel1', '取消停課', '恢復成要上課']);
    if (s.status === 'cancelled') a.push(['addmakeup', '加開一堂補課', '另外排一個時間補這堂', true]);
    return a;
  }
  function opHead(s) {
    return `<div class="op__h"><div class="op__name">${esc(s.className)}</div>
      <div class="op__meta">週${wdz(s.date)} ${md(s.date)} · ${s.start}–${s.end} · ${s.teacher ? esc(s.teacher) : '未指派老師'} · ${s.students} 人</div>
      ${tags(s).length ? `<div class="op__tags">${tagHtml(s)}</div>` : ''}</div>`;
  }
  function openOp(id, anchor, form) {
    const s = byId(id), pop = document.getElementById('op');
    const body = form ? opForm(s, form) : `${opHead(s)}
      <ul class="op__list">${opItems(s).map(([k, l, d, isNew]) => `<li><button type="button" class="op__it${k.startsWith('cancel') ? ' op__it--stop' : ''}" data-opk="${k}" data-id="${s.id}"><span class="op__l">${l}${isNew ? NEW : ''}</span><span class="op__d">${d}</span></button></li>`).join('')}</ul>
      ${s.status === 'completed' ? '<p class="op__note">已上完的課只能看紀錄與出勤。</p>' : ''}
      <div class="op__foot"><label class="op__pick"><input type="checkbox" data-pick="${s.id}" ${st.sel.has(s.id) ? 'checked' : ''}> 加入批次調整</label></div>`;
    pop.innerHTML = `<button type="button" class="op__x" data-opclose aria-label="關閉">${ic.x}</button>${body}`;
    if (!pop.matches(':popover-open')) pop.showPopover();
    if (anchor && !matchMedia('(max-width: 860px)').matches) {
      const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
      let left = Math.min(Math.max(16, r.left), innerWidth - w - 16);
      let top = r.bottom + 6; if (top + h > innerHeight - 16) top = Math.max(16, r.top - h - 6);
      Object.assign(pop.style, { left: left + 'px', top: top + 'px' });
    } else pop.removeAttribute('style');
  }
  const teacherOptions = (s, cur) => X.teachers.filter((t) => t.name !== (s && s.teacher)).map((t) => {
    const busy = s && all().find((o) => o.date === s.date && o.teacher === t.name && o.status !== 'cancelled' && overlap(toMin(s.start), toMin(s.end), toMin(o.start), toMin(o.end)));
    return `<option value="${t.name}"${t.name === cur ? ' selected' : ''}>${t.name}${busy ? `（${busy.start} 有課）` : ''}</option>`;
  }).join('');
  function opForm(s, k) {
    const back = `<button type="button" class="tlink" data-opback="${s.id}">${ic.left}其他動作</button>`;
    const F = {
      cancel1: ['停課', `<label class="fl"><span>原因</span><input class="in" data-f="reason" value="" placeholder="例如：颱風停課、老師請假"></label><p class="fnote">停課不會刪掉這堂；之後可以「取消停課」恢復。</p>`, '確定停課'],
      resched: ['調課', `<div class="frow"><label class="fl"><span>日期</span><input class="in" type="date" data-f="date" value="${s.date}"></label><label class="fl"><span>開始</span><input class="in" type="time" data-f="start" value="${s.start}" step="900"></label><label class="fl"><span>結束</span><input class="in" type="time" data-f="end" value="${s.end}" step="900"></label></div><label class="fl"><span>原因</span><input class="in" data-f="reason" placeholder="例如：學校段考週"></label><p class="fnote">調課只能改日期與時間；要換老師用「代課」。</p>`, '確定調課'],
      substitute: ['代課', `<label class="fl"><span>代課老師</span><select class="in" data-f="teacher">${teacherOptions(s)}</select></label><label class="fl"><span>原因</span><input class="in" data-f="reason" placeholder="例如：${esc(s.teacher)} 請假"></label><p class="fnote">會留代課紀錄（原任課老師：${esc(s.teacher)}）。</p>`, '確定代課'],
      assign1: ['指派老師', `<label class="fl"><span>老師</span><select class="in" data-f="teacher">${teacherOptions(s)}</select></label>`, '確定指派'],
      makeup: ['指定為補課', `<label class="fl"><span>這堂要補哪一堂停課</span><select class="in" data-f="for">${all().filter((o) => o.status === 'cancelled' && o.date <= s.date).map((o) => `<option>${md(o.date)} ${esc(o.className)}</option>`).join('')}</select></label><p class="fnote">這是「指定」，不是新增一堂：把這堂已經排好的課，當作補那一堂停課。</p>`, '確定指定'],
    };
    if (k === 'addmakeup') return `${back}${opHead(s)}<details class="newbox" open><summary>新功能：加開一堂補課</summary><p>現在的系統做不到 —— 沒有 <code>POST /sessions</code>，課堂只能照班級的固定課表產生。現在能做的是：到另一堂已排定的課按「指定為補課」，或把某堂「調課」到別天。</p><p>需要的後端：<code>POST /sessions</code>（classId、date、start、end、teacherId、makeupFor），並檢查老師撞堂。</p></details>`;
    if (k === 'log') return `${back}${opHead(s)}<ul class="logl">${LOG.filter((e) => e.sid === s.id).reverse().map((e) => `<li><b>${when(e.at)} ${esc(e.by)}</b> ${typeTag(e)}${e.batch ? '<span class="bchip">批次</span>' : ''}${e.detail ? ` ${esc(e.detail)}` : ''}${e.reason ? `<span class="logl__why">原因：${esc(e.reason)}</span>` : ''}</li>`).join('')}<li><b>8/20 14:03 系統</b> 依班級課表產生</li></ul>`;
    if (k === 'att') return `${back}${opHead(s)}<p class="fnote">（進入既有的出勤頁 —— 這份設計稿沒畫。）</p>`;
    if (k === 'uncancel1') return `${back}${opHead(s)}<p class="fnote">恢復後這堂回到「要上課」。</p><div class="op__go"><button type="button" class="btn btn--ink" data-opdo="uncancel1" data-id="${s.id}">確定恢復</button></div>`;
    const [title, fields, go] = F[k];
    return `${back}${opHead(s)}<h3 class="op__ft">${title}</h3>${fields}<div class="op__go"><button type="button" class="btn btn--ink" data-opdo="${k}" data-id="${s.id}">${go}</button></div>`;
  }
  function opDo(k, s, pop) {
    const v = (f) => (pop.querySelector(`[data-f="${f}"]`) || {}).value;
    const was = { date: s.date, start: s.start, teacher: s.teacher };
    if (k === 'cancel1') { s.status = 'cancelled'; s.change = { type: 'cancel', reason: v('reason') || '' }; logOf(s, 'cancel', { reason: v('reason') }); }
    if (k === 'uncancel1') { s.status = s.date < TODAY ? 'completed' : 'scheduled'; s.change = null; logOf(s, 'uncancel', { detail: '恢復成要上課' }); }
    if (k === 'resched') { s.change = { type: 'reschedule', fromDate: s.date, fromStart: s.start, reason: v('reason') }; s.date = v('date'); s.start = v('start'); s.end = v('end'); logOf(s, 'reschedule', { detail: `從 ${md(was.date)} ${was.start} 移來`, reason: v('reason') }); }
    if (k === 'substitute') { s.change = { type: 'substitute', from: s.teacher, reason: v('reason') }; s.teacher = v('teacher'); logOf(s, 'substitute', { detail: `${was.teacher} → ${s.teacher}`, reason: v('reason') }); }
    if (k === 'assign1') { s.teacher = v('teacher'); s.change = null; }
    if (k === 'makeup') { s.change = { type: 'makeup', forLabel: v('for') }; logOf(s, 'makeup', { detail: `補 ${v('for')}` }); }
    pop.hidePopover();
    render();
  }

  // ── 批次流程：動作 → 預覽（dryRun）→ 套用 ────────────────────────────
  // 檢查老師在那天那段時間有沒有別的課；stress 之外的週用本週同一個星期幾當代理（固定課表會重複）
  function poolOn(date) {
    const wd = dobj(date).getDay();
    if (DAYS.includes(date)) return all().filter((o) => o.date === date);
    return SS.filter((o) => dobj(o.date).getDay() === wd).concat(extra.filter((o) => o.date === date));
  }
  function teacherBusy(name, date, a, b, skip) {
    return poolOn(date).find((o) => o.teacher === name && o.status !== 'cancelled' && !skip.has(o.id) && overlap(a, b, toMin(o.start), toMin(o.end)));
  }
  function dry(f) {
    const ss = [...st.sel].map(byId).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const moving = new Set(ss.map((s) => s.id));
    const taken = []; // 這一批裡已經排給同一位老師的時段
    return ss.map((s) => {
      const r = { s, ok: true, why: '', kind: '' };
      const no = (kind, why) => Object.assign(r, { ok: false, kind, why });
      if (f.act === 'uncancel') { if (s.status !== 'cancelled') no('status', '不是停課狀態'); else if (s.change && /假/.test(s.change.reason || '')) no('status', `${s.change.reason}（國定假日不恢復）`); return r; }
      if (s.status === 'cancelled') return no('status', s.change && s.change.reason ? `已經停課（${s.change.reason}）` : '已經停課');
      if (s.status === 'completed') return no('status', '已經上完');
      if (f.act === 'cancel') return r;
      if (f.act === 'time' || f.act === 'move') {
        const date = f.act === 'move' ? addD(s.date, (+f.wd - dobj(s.date).getDay())) : s.date;
        const a = toMin(f.start), b = toMin(f.end);
        const o = s.teacher && teacherBusy(s.teacher, date, a, b, moving);
        if (o) return no('teacher', `${s.teacher} 在 ${md(date)} ${o.start}–${o.end} 有 ${o.className}`);
        const same = poolOn(date).find((o2) => o2.className === s.className && !moving.has(o2.id) && o2.status !== 'cancelled' && overlap(a, b, toMin(o2.start), toMin(o2.end)));
        if (same) return no('class', `同一班在 ${md(date)} ${same.start} 已有一堂`);
        r.to = { date, start: f.start, end: f.end };
        return r;
      }
      if (f.act === 'assign' || f.act === 'sub') {
        if (!f.teacher) return no('form', '還沒選老師');
        if (s.teacher === f.teacher) return no('status', '已經是這位老師');
        if (f.act === 'assign' && s.teacher && !f.include) return no('status', `已指派 ${s.teacher}（沒勾「覆蓋已指派的」）`);
        if (f.act === 'sub' && !s.teacher) return no('status', '還沒指派老師，不能代課（用指派老師）');
        const a = toMin(s.start), b = toMin(s.end);
        const o = teacherBusy(f.teacher, s.date, a, b, moving) || taken.find((t) => t.date === s.date && overlap(a, b, t.a, t.b));
        if (o) return no('teacher', `${f.teacher} 在 ${md(s.date)} ${o.start || hm(o.a)} 已有 ${o.className || o.cn}`);
        taken.push({ date: s.date, a, b, cn: s.className });
        return r;
      }
      return r;
    });
  }
  const KIND = { status: '狀態不能改', teacher: '老師撞堂', class: '同一班撞堂', form: '缺少欄位' };

  function apply(res, f) {
    const lt = { cancel: 'cancel', uncancel: 'uncancel', time: 'time', move: 'reschedule', sub: 'substitute' }[f.act]; // 指派老師不寫異動紀錄（產品端也沒有）
    const bid = newBatch();
    res.filter((r) => r.ok).forEach(({ s, to }) => {
      const was = { date: s.date, start: s.start, teacher: s.teacher };
      if (f.act === 'cancel') { s.status = 'cancelled'; s.change = { type: 'cancel', reason: f.reason }; }
      if (f.act === 'uncancel') { s.status = s.date < TODAY ? 'completed' : 'scheduled'; s.change = null; }
      if (f.act === 'time' || f.act === 'move') { s.change = { type: 'reschedule', fromDate: s.date, fromStart: s.start, reason: f.reason }; Object.assign(s, to); }
      if (f.act === 'assign') { s.teacher = f.teacher; if (s.change && s.change.type === 'unassigned') s.change = null; }
      if (f.act === 'sub') { s.change = { type: 'substitute', from: s.teacher, reason: f.reason }; s.teacher = f.teacher; }
      if (lt) logOf(s, lt, { batch: bid, reason: f.reason, detail: { time: `${was.start} → ${s.start}`, reschedule: `從 ${md(was.date)} ${was.start} 移來`, substitute: `${was.teacher} → ${s.teacher}`, uncancel: '恢復成要上課' }[lt] });
    });
  }

  function steps(cur) {
    const L = ['勾選課堂', '動作', '預覽', '完成'];
    return `<ol class="fsteps">${L.map((l, i) => `<li class="${i < cur ? 'is-done' : i === cur ? 'is-cur' : ''}"${i === cur ? ' aria-current="step"' : ''}><span>${i + 1}</span>${l}</li>`).join('')}</ol>`;
  }
  function actionForm(f) {
    const a = ACTS[f.act];
    const ss = [...st.sel].map(byId);
    const pickActs = Object.entries(ACTS).filter(([k]) => k !== 'uncancel' || ss.some((s) => s.status === 'cancelled'));
    if (!f.act) return `<h2 class="f__t">要對這 ${st.sel.size} 堂做什麼？</h2><ul class="op__list">${pickActs.map(([k, v]) => `<li><button type="button" class="op__it" data-fact="${k}"><span class="op__l">${v.icon}${v.label}${v.isNew ? NEW : ''}</span><span class="op__d">${v.api}</span></button></li>`).join('')}</ul>`;
    const tOpts = X.teachers.map((t) => `<option value="${t.name}"${t.name === f.teacher ? ' selected' : ''}>${t.name}</option>`).join('');
    const newBox = {
      move: `<details class="newbox"><summary>新：批次改到別天</summary><p>現在的批次只能「同一天改時間」（batch-update-time）。要把整期從週五改到別天，需要新的 <code>PATCH /sessions/batch-reschedule</code>：sessionIds、目標星期幾（或日期位移）、startTime、endTime，dryRun 一樣回 class／teacher 衝突。</p></details>`,
      sub: `<details class="newbox"><summary>新：批次代課</summary><p>現在代課只有單堂（<code>POST /sessions/{id}/substitute</code>，會留代課紀錄）。批次只有「指派老師」—— 會換老師，但<strong>不留代課紀錄</strong>：學生、家長、鐘點看到的是換老師，不是代課。需要新的 <code>PATCH /sessions/batch-substitute</code>：sessionIds、substituteTeacherId、reason、dryRun。</p></details>`,
    }[f.act] || '';
    const fields = {
      cancel: `<label class="fl"><span>原因（家長會看到）</span><input class="in" data-ff="reason" value="${esc(f.reason || '')}" placeholder="例如：颱風停課"></label><p class="fnote">停課不會刪課；套用之後可以用「恢復課堂」整批復原。</p>`,
      uncancel: `<p class="fnote">勾起來的課裡，已停課的會恢復成要上課；其他的會略過。</p>`,
      time: `<div class="frow"><label class="fl"><span>新的開始</span><input class="in" type="time" step="900" data-ff="start" value="${f.start || ''}"></label><label class="fl"><span>新的結束</span><input class="in" type="time" step="900" data-ff="end" value="${f.end || ''}"></label></div><label class="fl"><span>原因</span><input class="in" data-ff="reason" value="${esc(f.reason || '')}"></label><p class="fnote">每一堂都留在原本那天，只換時段。要換到別天：<button type="button" class="tlink" data-fact="move">改到別天${NEW}</button></p>`,
      move: `<div class="frow"><label class="fl"><span>改到</span><select class="in" data-ff="wd">${[1, 2, 3, 4, 5, 6].map((w) => `<option value="${w}"${+f.wd === w ? ' selected' : ''}>週${ZH[w]}</option>`).join('')}</select></label><label class="fl"><span>開始</span><input class="in" type="time" step="900" data-ff="start" value="${f.start || ''}"></label><label class="fl"><span>結束</span><input class="in" type="time" step="900" data-ff="end" value="${f.end || ''}"></label></div><label class="fl"><span>原因</span><input class="in" data-ff="reason" value="${esc(f.reason || '')}"></label>`,
      assign: `<label class="fl"><span>老師</span><select class="in" data-ff="teacher"><option value="">選一位老師</option>${tOpts}</select></label><label class="chk"><input type="checkbox" data-ff="include"${f.include ? ' checked' : ''}> 覆蓋已經指派的（includeAssigned）</label><p class="fnote">指派是「換老師」，不留代課紀錄。老師請假要找人代，用<button type="button" class="tlink" data-fact="sub">批次代課${NEW}</button>。</p>`,
      sub: `<label class="fl"><span>代課老師</span><select class="in" data-ff="teacher"><option value="">選一位老師</option>${tOpts}</select></label><label class="fl"><span>原因</span><input class="in" data-ff="reason" value="${esc(f.reason || '')}"></label><p class="fnote">現在做得到的替代：一堂一堂按「代課」，或用「指派老師」整批換（不留代課紀錄）。</p>`,
    }[f.act];
    return `<h2 class="f__t">${a.icon}${a.label}${a.isNew ? NEW : ''} <span class="f__n">${st.sel.size} 堂</span></h2>
      <p class="f__api">${a.isNew ? '新功能：系統目前還做不到，下面寫了需要什麼' : '下一步會先預覽會發生什麼，不會直接改'}</p>${newBox}${fields}
      <button type="button" class="tlink f__change" data-fact="">${ic.left}換一個動作</button>`;
  }
  function previewHtml(f, res) {
    const bad = res.filter((r) => !r.ok), ok = res.filter((r) => r.ok);
    const groups = {};
    bad.forEach((r) => (groups[r.kind] ||= []).push(r));
    const line = (r) => `<li><span class="pv__when">週${wdz(r.s.date)} ${md(r.s.date)} ${r.s.start}</span><span class="pv__cls">${esc(r.s.className)}</span>${r.why ? `<span class="pv__why">${esc(r.why)}</span>` : r.to ? `<span class="pv__why pv__why--ok">→ ${r.to.date !== r.s.date ? `週${wdz(r.to.date)} ${md(r.to.date)} ` : ''}${r.to.start}–${r.to.end}</span>` : ''}</li>`;
    return `<h2 class="f__t">${ACTS[f.act].label}：先看會發生什麼</h2>
      <div class="pv__sum">
        <div><b>${res.length}</b><span>堂受影響</span></div>
        <div><b>${ok.length}</b><span>堂會套用</span></div>
        <div class="${bad.length ? 'pv__bad' : ''}"><b>${bad.length}</b><span>堂不會套用</span></div>
      </div>
      ${Object.entries(groups).map(([k, rs]) => `<section class="pv__g"><h3>${ic.alert}${KIND[k]}（${rs.length}）</h3><ul class="pv__list">${rs.map(line).join('')}</ul></section>`).join('')}
      ${ok.length ? `<details class="pv__ok"${bad.length ? '' : ' open'}><summary>會套用的 ${ok.length} 堂</summary><ul class="pv__list">${ok.map(line).join('')}</ul></details>` : ''}
      ${bad.length && ok.length ? `<p class="fnote">按套用只會改那 ${ok.length} 堂；不會套用的那 ${bad.length} 堂維持原狀${f.act === 'sub' || f.act === 'assign' ? '，並保留勾選，可以換一位老師再走一次' : ''}。</p>` : ''}`;
  }
  function doneHtml(f) {
    const d = f.done, ok = d.filter((r) => r.ok), bad = d.filter((r) => !r.ok);
    const verb = { cancel: '停課', uncancel: '恢復', time: '改時間', move: '改到別天', assign: '指派', sub: '安排代課' }[f.act];
    let next = '';
    if (f.act === 'cancel') next = `<section class="dn__next"><h3>停課之後：補課怎麼辦</h3>
      <ul class="dn__l"><li><b>指定為補課</b>（現有，一堂一堂）：到之後某一堂已排定的課，按「⋯ → 指定為補課」，把它當作補這次停的課。</li>
      <li><b>加開補課</b>${NEW}：真實補習班的「颱風停課 → 下週六加開一堂」現在做不到（沒有 <code>POST /sessions</code>）。</li></ul>
      <button type="button" class="btn" data-undo>${ic.undo}復原：恢復這 ${ok.length} 堂（批次恢復課堂）</button></section>`;
    if ((f.act === 'sub' || f.act === 'assign') && bad.length) next = `<section class="dn__next"><h3>還有 ${bad.length} 堂沒人接</h3><p class="fnote">這幾堂還勾著。</p><button type="button" class="btn btn--ink" data-again>換一位老師給這 ${bad.length} 堂${ic.right}</button></section>`;
    return `<h2 class="f__t">已${verb} ${ok.length} 堂</h2>
      ${bad.length ? `<p class="dn__skip">略過 ${bad.length} 堂：${[...new Set(bad.map((r) => KIND[r.kind]))].join('、')}。</p>` : ''}
      ${ACTS[f.act].isNew ? `<p class="fnote">（「${ACTS[f.act].label}」是新功能，這一步在設計稿裡是模擬的。）</p>` : ''}
      ${next}`;
  }
  function flow() {
    const dlg = document.getElementById('flow'), f = st.flow;
    if (!f) { if (dlg.open) dlg.close(); return; }
    const step = f.step;
    let body = '', foot = '';
    if (step === 'action') {
      body = actionForm(f);
      foot = `<button type="button" class="btn" data-fclose>取消</button>${f.act ? `<button type="button" class="btn btn--primary" data-fgo="preview">預覽 ${st.sel.size} 堂${ic.right}</button>` : ''}`;
    } else if (step === 'preview') {
      f.res = dry(f);
      const ok = f.res.filter((r) => r.ok).length;
      body = previewHtml(f, f.res);
      foot = `<button type="button" class="btn" data-fgo="action">${ic.left}改設定</button><button type="button" class="btn btn--primary" data-fgo="done"${ok ? '' : ' disabled'}>套用到 ${ok} 堂</button>`;
    } else {
      body = doneHtml(f);
      foot = `<button type="button" class="btn btn--primary" data-fclose>完成</button>`;
    }
    dlg.innerHTML = `<div class="f__in"><header class="f__head"><div class="f__sel">${step === 'done' ? f.res.length : st.sel.size} 堂 · ${esc(f.label || st.selLabel || '逐堂勾選')}</div>${steps({ action: 1, preview: 2, done: 3 }[step])}<button type="button" class="op__x" data-fclose aria-label="關閉">${ic.x}</button></header>
      <div class="f__body" tabindex="-1" autofocus>${body}</div><footer class="f__foot inkbar">${foot}</footer></div>`;
    if (!dlg.open) dlg.showModal();
  }
  function readForm() {
    const f = st.flow, dlg = document.getElementById('flow');
    dlg.querySelectorAll('[data-ff]').forEach((el) => { f[el.dataset.ff] = el.type === 'checkbox' ? el.checked : el.value; });
  }
  function goStep(step) {
    const f = st.flow;
    if (step === 'done') { st.applied = true; f.label = st.selLabel; apply(f.res, f); f.done = f.res; const bad = f.res.filter((r) => !r.ok).map((r) => r.s.id); if (f.act === 'sub' || f.act === 'assign') { st.sel = new Set(bad); st.selLabel = '上一輪沒人接的'; } else st.sel.clear(); }
    f.step = step;
    syncHash();
    render();
    flow();
  }

  // ── 全部異動（A6）：桌機右側抽屜、手機全螢幕；依上課日分組，篩選＝類型／月份／老師或班級 ─────
  const cf = { type: '', month: '', q: '', focus: null };
  const MONTHS = [...new Set(LOG.map((e) => e.date.slice(0, 7)))].sort().reverse();
  function chgList() {
    const q = cf.q.trim();
    const es = LOG.filter((e) => (!cf.type || e.type === cf.type) && (!cf.month || e.date.startsWith(cf.month)) && (!q || [e.cls, e.teacher, e.detail].some((x) => x && x.includes(q))));
    if (!es.length) return `<div class="cg__empty"><p>沒有符合的異動。</p><button type="button" class="btn" data-creset>清除篩選</button></div>`;
    const days = new Map();
    es.slice().sort((a, b) => (b.date + a.start).localeCompare(a.date + b.start)).forEach((e) => { if (!days.has(e.date)) days.set(e.date, []); days.get(e.date).push(e); });
    let synthShown = false;
    return `<p class="cg__count">共 ${es.length} 則</p>` + [...days.entries()].map(([d, list]) => {
      const rows = [], bs = new Map();
      list.forEach((e) => {
        if (!e.batch) { rows.push(e); return; }
        if (!bs.has(e.batch)) { const g = { batch: e.batch, es: [] }; bs.set(e.batch, g); rows.push(g); }
        bs.get(e.batch).es.push(e);
      });
      const divider = !synthShown && list[0].synth ? ((synthShown = true), '<p class="cg__synth">以下是合成的過去 4 週歷史（設計稿示範用，沒有對應的課堂）</p>') : '';
      return `${divider}<section class="cg__day"><h3 class="cg__dh">週${wdz(d)} ${md(d)}${d === TODAY ? ' · 今天' : d === addD(TODAY, 1) ? ' · 明天' : ''}<span>${list.length} 則</span></h3><ul class="cg__l">${rows.map((r) => r.es ? clBatch(r) : clOne(r)).join('')}</ul></section>`;
    }).join('');
  }
  const canGo = (e) => e.sid && byId(e.sid);
  function clOne(e) {
    return `<li class="cl">
      <div class="cl__top"><span class="cl__t">${e.start}</span><b class="cl__cls">${esc(e.cls)}</b>${typeTag(e)}</div>
      ${e.detail ? `<p class="cl__d">${esc(e.detail)}</p>` : ''}
      <p class="cl__why">原因：${e.reason ? esc(e.reason) : '—'}</p>
      <div class="cl__foot"><span class="cl__by">${esc(e.by)} · ${when(e.at)}</span>${canGo(e) ? `<button type="button" class="tlink cl__go" data-goto="${e.sid}">看這堂${ic.right}</button>` : ''}</div>
    </li>`;
  }
  function clBatch(g) {
    const e = g.es[0];
    return `<li class="cl cl--batch" data-bid="${g.batch}"><details${cf.focus === g.batch ? ' open' : ''}>
      <summary><span class="cl__top">${typeTag(e, `${TYPE[e.type]} ${g.es.length} 堂`)}<span class="bchip">批次</span></span>
        <span class="cl__why">原因：${e.reason ? esc(e.reason) : '—'}</span>
        <span class="cl__foot"><span class="cl__by">${esc(e.by)} · ${when(e.at)}</span><span class="cl__more">看是哪 ${g.es.length} 堂</span></span></summary>
      <ul class="cl__sub">${g.es.map((x) => `<li><span class="cl__t">${x.start}</span><span class="cl__cls">${esc(x.cls)}</span><span class="cl__tt">${x.teacher ? esc(x.teacher) : '未指派'}${x.detail ? ` · ${esc(x.detail)}` : ''}</span>${canGo(x) ? `<button type="button" class="tlink" data-goto="${x.sid}">看這堂</button>` : ''}</li>`).join('')}</ul>
    </details></li>`;
  }
  function openChanges(focus) {
    const dlg = document.getElementById('chg');
    cf.focus = focus || null;
    dlg.innerHTML = `<div class="f__in"><header class="f__head cg__head"><h2 class="cg__t">全部異動</h2><button type="button" class="op__x" data-cclose aria-label="關閉">${ic.x}</button></header>
      <div class="cg__filters" role="search">
        <label class="fl"><span>類型</span><select class="in" data-ctype><option value="">全部異動</option>${Object.entries(TYPE).map(([k, l]) => `<option value="${k}"${cf.type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="fl"><span>月份</span><select class="in" data-cmonth><option value="">全部月份</option>${MONTHS.map((m) => `<option value="${m}"${cf.month === m ? ' selected' : ''}>${m.slice(0, 4)} 年 ${+m.slice(5)} 月</option>`).join('')}</select></label>
        <label class="fl cg__q"><span>老師或班級</span><input class="in" type="search" data-cq value="${esc(cf.q)}" placeholder="例如：周雅琳、國三數學"></label>
      </div>
      <div class="f__body cg__body">${chgList()}</div></div>`;
    if (!dlg.open) dlg.showModal();
    if (focus) { const el = dlg.querySelector(`[data-bid="${focus}"]`); if (el) el.scrollIntoView({ block: 'start' }); }
  }
  const paintChg = () => { document.querySelector('.cg__body').innerHTML = chgList(); };
  // 跳到那一堂：切到那天的日視圖、捲到那一塊、打開它的「⋯」
  function gotoSession(id) {
    const s = byId(id);
    if (!s) return;
    if (DAYS.includes(s.date)) { st.view = 'day'; st.day = s.date; render(); }
    const a = document.querySelector(`.only-${mob() ? 'mob' : 'desk'} [data-op="${id}"]`);
    if (a) a.scrollIntoView({ block: 'center' });
    openOp(id, a);
  }

  // ── 三個例子（純 hash 進入） ─────────────────────────────────────
  const FRI = '2026-10-02';
  function leaveCase() {
    const cnt = {};
    SS.filter((s) => s.teacher && fromNow(s) && s.status !== 'cancelled').forEach((s) => (cnt[s.teacher] = (cnt[s.teacher] || 0) + 1));
    const T = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
    const mine = SS.filter((s) => s.teacher === T && fromNow(s) && s.status !== 'cancelled');
    // 代課老師：挑一位「大致有空，但有一兩堂撞到」的 —— 真實情況通常是這樣
    const score = X.teachers.filter((t) => t.name !== T).map((t) => ({ t: t.name, c: mine.filter((s) => teacherBusy(t.name, s.date, toMin(s.start), toMin(s.end), new Set())).length }));
    const T2 = (score.find((x) => x.c === 1) || score.find((x) => x.c === 2) || score.sort((a, b) => a.c - b.c)[0]).t;
    return { T, T2 };
  }
  function retimeCase() {
    // 週五傍晚開始、還沒停課、班名本週唯一的一班，整期往後挪 90 分鐘（配合學校第八節）
    const s = dayList(FRI).find((x) => x.status === 'scheduled' && x.start < '18:30' && x.teacher && SS.filter((o) => o.className === x.className).length === 1 && !teacherBusy(x.teacher, FRI, toMin(x.start) + 90, toMin(x.end) + 90, new Set([x.id])));
    return { s, start: hm(toMin(s.start) + 90), end: hm(toMin(s.end) + 90) };
  }
  const CASES = {
    typhoon: () => { st.view = 'day'; st.day = FRI; selectDay(FRI); return { act: 'cancel', reason: '颱風停課' }; },
    'teacher-leave': () => { const { T, T2 } = leaveCase(); st.view = 'week'; selectTeacher(T); return { act: 'sub', teacher: T2, reason: `${T} 請假（10/1–10/3）` }; },
    retime: () => { const r = retimeCase(); st.view = 'week'; selectClass(r.s.id); return { act: 'time', start: r.start, end: r.end, reason: '配合學校第八節課' }; },
  };
  let caseKey = null;
  function fromHash() {
    const h = location.hash.slice(1);
    const m = h.match(/^(typhoon|teacher-leave|retime)(?:-(action|preview|done))?$/);
    st.flow = null; st.pending = null;
    if (m) {
      caseKey = m[1];
      const f = Object.assign({ step: m[2] || 'pick' }, CASES[m[1]]());
      if (m[2]) {
        st.flow = f;
        if (m[2] === 'done') { f.res = dry(f); f.step = 'preview'; render(); goStep('done'); return; }
      } else st.pending = f;
    } else {
      caseKey = null;
      if (h === 'week') st.view = 'week';
      if (h === 'day' || h === 'op') st.view = 'day';
    }
    render();
    flow();
    if (h === 'op') {
      const s = dayList(TODAY).find((x) => x.status === 'scheduled' && x.teacher && !x.change && !clash(x));
      const a = document.querySelector(`.only-${matchMedia('(max-width: 860px)').matches ? 'mob' : 'desk'} [data-op="${s.id}"]`);
      a.scrollIntoView({ block: 'center' });
      openOp(s.id, a);
    }
    const qs = document.getElementById('qs');
    if (m && !m[2] && mob()) openSheet();
    else if (qs.open && !m) qs.close();
    if (h === 'changes') openChanges();
    else if (document.getElementById('chg').open) document.getElementById('chg').close();
    // 從情境卡進來：捲到工具列，讓已勾好的課與「下一步」的動作列一起出現在眼前
    if (jump && m) { jump = false; window.scrollTo({ top: document.getElementById('sx').getBoundingClientRect().top + scrollY - document.querySelector('.top').offsetHeight }); }
  }
  let jump = false;
  function syncHash() {
    if (!caseKey || !st.flow) return;
    history.replaceState(null, '', `#${caseKey}-${st.flow.step}`);
  }

  // ── 畫面 ───────────────────────────────────────────────────────────
  function render() {
    paintBand();
    document.getElementById('sx').innerHTML = ctx();
    document.getElementById('view').innerHTML = st.view === 'day' ? dayView() : weekView();
    document.getElementById('tk').innerHTML = ticker();
    const sc = document.querySelector('.tk__scroll');
    if (sc) sc.scrollLeft = tk.pos;
    tk.focus = false; // 重畫之後焦點已經不在跑馬燈裡（被移除的元素不會發 focusout）
    document.querySelectorAll('.case').forEach((c) => c.classList.toggle('is-on', c.dataset.c === caseKey));
    document.body.classList.toggle('is-picking', st.picking && !mob());
    if (document.getElementById('qs').open) paintSheet();
    bar();
  }

  // ── 常用批次情境卡（A6，新的入口）：點了＝勾好課、選好動作，停在「下一步」 ─────────
  // A6 修正（使用者：「板塊太大了，做成 pill 式，不需要 descrp」）：三張大卡 → 一列 pill，只留名稱
  const CASE_PILLS = [
    ['typhoon', '颱風整天停課'],
    ['teacher-leave', '老師請假找人代'],
    ['retime', '班級整期改時間'],
  ];
  const casesHtml = `<section class="cases" aria-labelledby="cases-h">
    <h2 class="cases__h" id="cases-h">常用批次<span class="new">新</span></h2>
    <ul class="cases__row">${CASE_PILLS.map(([k, t]) => `<li class="case" data-c="${k}"><button type="button" class="case__go" data-case="${k}">${t}${ic.right}</button></li>`).join('')}</ul>
  </section>`;

  const b0 = (() => { st.view = 'day'; return bandData(); })();
  shell({ page: 'schedule', title: b0.title, stats: b0.stats, phase: 1300 }, `
    <div id="sx"></div>
    <div id="tk"></div>
    <div id="view" class="view"></div>`);
  document.body.insertAdjacentHTML('beforeend', `<div id="bar" class="bar" role="region" aria-label="批次動作"></div><div id="op" class="op" popover></div><dialog id="flow" class="flow" aria-label="批次操作"></dialog><dialog id="qs" class="qs" aria-labelledby="qs-t"></dialog><dialog id="chg" class="flow cg" aria-label="全部異動"></dialog>`);

  // ── 事件 ───────────────────────────────────────────────────────────
  const mob = () => matchMedia('(max-width: 860px)').matches;
  function toggle(id, shift) {
    if (shift && st.last && st.order.includes(st.last) && st.order.includes(id)) {
      const [a, b] = [st.order.indexOf(st.last), st.order.indexOf(id)].sort((x, y) => x - y);
      st.order.slice(a, b + 1).forEach((x) => st.sel.add(x));
    } else st.sel.has(id) ? st.sel.delete(id) : st.sel.add(id);
    st.last = id; st.selLabel = '逐堂勾選';
    if (st.sel.size && !st.picking && !mob()) { st.picking = true; document.body.classList.add('is-picking'); document.getElementById('sx').innerHTML = ctx(); }
    document.querySelectorAll('[data-pick]').forEach((el) => { el.checked = st.sel.has(el.dataset.pick); el.closest('.gb,.li') && el.closest('.gb,.li').classList.toggle('is-sel', el.checked); });
    bar();
  }
  document.addEventListener('click', (e) => {
    const t = e.target;
    const cs = t.closest('[data-case]');
    if (cs) { jump = true; const h = '#' + cs.dataset.case; if (location.hash === h) fromHash(); else location.hash = h; return; }
    const go = t.closest('[data-goto]');
    if (go) { const dlg = document.getElementById('chg'); if (dlg.open) dlg.close(); gotoSession(go.dataset.goto); return; }
    const bt = t.closest('[data-batch]');
    if (bt) { history.replaceState(null, '', '#changes'); openChanges(bt.dataset.batch); return; }
    if (t.closest('[data-allchg]')) { history.replaceState(null, '', '#changes'); openChanges(); return; }
    if (t.closest('[data-cclose]')) { document.getElementById('chg').close(); return; }
    if (t.closest('[data-creset]')) { Object.assign(cf, { type: '', month: '', q: '' }); openChanges(); return; }
    if (t.closest('[data-tkpause]')) { tk.user = !tk.user; document.getElementById('tk').innerHTML = ticker(); document.querySelector('.tk__scroll').scrollLeft = tk.pos; document.querySelector('[data-tkpause]').focus(); return; }
    const pk = t.closest('[data-pick]');
    if (pk) {
      // 手機：單堂「⋯」的「加入批次調整」＝勾起那堂並打開快速選取面板
      if (mob() && pk.closest('#op')) { st.sel.add(pk.dataset.pick); st.selLabel = '逐堂勾選'; document.getElementById('op').hidePopover(); openSheet(); return; }
      toggle(pk.dataset.pick, e.shiftKey); return;
    }
    if (t.closest('[data-qsclose]')) { document.getElementById('qs').close(); return; }
    const op = t.closest('[data-op]');
    if (op) {
      openOp(op.dataset.op, op.closest('.gb,.li,.chg__it') || op); return;
    }
    const k = t.closest('[data-opk]');
    if (k) { openOp(k.dataset.id, null, k.dataset.opk); return; }
    if (t.closest('[data-opback]')) { openOp(t.closest('[data-opback]').dataset.opback); return; }
    const od = t.closest('[data-opdo]');
    if (od) { opDo(od.dataset.opdo, byId(od.dataset.id), document.getElementById('op')); return; }
    if (t.closest('[data-opclose]')) { document.getElementById('op').hidePopover(); return; }
    const v = t.closest('[data-view]');
    if (v) { st.view = v.dataset.view; history.replaceState(null, '', '#' + st.view); render(); return; }
    const d = t.closest('[data-day],[data-goday]');
    if (d) { st.view = 'day'; st.day = d.dataset.day || d.dataset.goday; render(); window.scrollTo({ top: document.getElementById('sx').offsetTop - 64 }); return; }
    const qd = t.closest('[data-qday]');
    if (qd) { selectDay(qd.dataset.qday); render(); return; }
    if (t.closest('[data-pickmode]')) { if (mob()) { openSheet(); return; } st.picking = !st.picking; render(); return; } // 「完成」只收起勾選模式，已勾的留著（動作列上「清除」才放掉）
    if (t.closest('[data-clear]')) { st.sel.clear(); st.selLabel = ''; render(); return; }
    const a = t.closest('[data-act]');
    if (a) { const pend = st.pending && st.pending.act === a.dataset.act ? st.pending : {}; st.flow = Object.assign({}, pend, { act: a.dataset.act, step: 'action' }); if (st.flow.act === 'assign' && st.flow.include === undefined) st.flow.include = [...st.sel].some((id) => byId(id).teacher); syncHash(); flow(); return; }
    const fa = t.closest('[data-fact]');
    if (fa) { readForm(); st.flow.act = fa.dataset.fact; if (fa.dataset.fact === 'move' && !st.flow.wd) st.flow.wd = '6'; flow(); return; }
    const fg = t.closest('[data-fgo]');
    if (fg) { if (st.flow.step === 'action') readForm(); goStep(fg.dataset.fgo); return; }
    if (t.closest('[data-fclose]')) { st.flow = null; flow(); if (caseKey) history.replaceState(null, '', '#' + caseKey); return; }
    if (t.closest('[data-undo]')) { const ids = st.flow.done.filter((r) => r.ok).map((r) => r.s.id); st.sel = new Set(ids); st.selLabel = '剛剛停課的'; st.flow = { act: 'uncancel', step: 'action' }; goStep('preview'); return; }
    if (t.closest('[data-again]')) { st.flow = { act: st.flow.act, reason: st.flow.reason, step: 'action' }; goStep('action'); return; }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-qteacher]') && t.value) { selectTeacher(t.value); render(); }
    if (t.matches('[data-qclass]') && t.value) { selectClass(t.value); render(); }
    if (t.matches('[data-ctype]')) { cf.type = t.value; paintChg(); }
    if (t.matches('[data-cmonth]')) { cf.month = t.value; paintChg(); }
  });
  document.addEventListener('input', (e) => { if (e.target.matches('[data-cq]')) { cf.q = e.target.value; paintChg(); } });
  document.getElementById('chg').addEventListener('close', () => { if (location.hash === '#changes') history.replaceState(null, '', location.pathname + location.search); });
  // 跑馬燈：滑鼠移上去、鍵盤焦點、手指碰到就停（手指放開後 4 秒才繼續）；捲出畫面就不跑
  document.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') tk.hover = !!e.target.closest('.tk__scroll'); });
  document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) tk.hover = false; });
  document.addEventListener('focusin', (e) => { tk.focus = !!e.target.closest('.tk__scroll'); });
  document.addEventListener('focusout', (e) => { if (!e.relatedTarget) tk.focus = false; });
  document.addEventListener('touchstart', (e) => { if (e.target.closest('.tk__scroll')) tk.touch = Date.now() + 60000; }, { passive: true });
  document.addEventListener('touchend', (e) => { if (e.target.closest('.tk__scroll')) tk.touch = Date.now() + 4000; }, { passive: true });
  new IntersectionObserver(([en]) => { tk.seen = en.isIntersecting; }).observe(document.getElementById('tk'));
  requestAnimationFrame(tkFrame);
  // 步驟流程關掉：套用過了就連面板一起收（回到課表看結果）；沒套用（取消）就回到面板
  document.getElementById('flow').addEventListener('close', () => {
    st.flow = null;
    const qs = document.getElementById('qs');
    if (st.applied) { st.applied = false; if (qs.open) qs.close(); } else if (qs.open) paintSheet();
  });
  const qsEl = document.getElementById('qs');
  qsEl.addEventListener('click', (e) => { if (e.target === qsEl) qsEl.close(); }); // 點背景＝關閉（面板內容蓋滿整個 dialog，點得到 dialog 本身只會是背景）
  qsEl.addEventListener('close', () => { st.picking = false; render(); });
  // 跨斷點：變成桌機就收起面板（桌機用原本的勾選模式＋批次列）
  matchMedia('(max-width: 860px)').addEventListener('change', () => { if (!mob() && qsEl.open) qsEl.close(); render(); });
  // 手機：長按一堂＝打開快速選取面板並勾起這一堂
  let lp = null;
  document.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.li');
    if (!row || !mob()) return;
    lp = setTimeout(() => { st.sel.add(row.dataset.row); st.selLabel = '逐堂勾選'; render(); openSheet(); lp = 'fired'; }, 500);
  });
  ['pointerup', 'pointercancel', 'pointermove'].forEach((ev) => document.addEventListener(ev, (e) => { if (ev === 'pointermove' && Math.abs(e.movementY) < 4) return; if (lp !== 'fired') clearTimeout(lp); }));
  document.addEventListener('click', (e) => { if (lp === 'fired') { e.stopImmediatePropagation(); e.preventDefault(); lp = null; } }, true);

  window.addEventListener('hashchange', fromHash);
  fromHash();
})();
