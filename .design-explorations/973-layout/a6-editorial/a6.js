/*
 * 方向 A2 的殼：白色細頂欄＋全寬開場色面＋白面。每頁呼叫 A2.shell({...}, mainHtml)。
 * 依賴 ../shared/data.js（window.CLESSIA）與 ../shared/flow.js（window.ClessiaFlow）。
 */
(function () {
  const C = window.CLESSIA;

  const P = (d) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const icon = {
    down: P('<path d="M4 6l4 4 4-4"/>'),
    right: P('<path d="M3 8h10M9 4l4 4-4 4"/>'),
    left: P('<path d="M13 8H3M7 4L3 8l4 4"/>'),
    alert: P('<circle cx="8" cy="8" r="6.2"/><path d="M8 4.8v3.6M8 11h.01"/>'),
    check: P('<path d="M3.5 8.5l3 3 6-7"/>'),
    clock: P('<circle cx="8" cy="8" r="6.2"/><path d="M8 4.8V8l2.2 1.6"/>'),
    search: P('<circle cx="7" cy="7" r="4.6"/><path d="M10.5 10.5L14 14"/>'),
    plus: P('<path d="M8 3v10M3 8h10"/>'),
    phone: P('<path d="M3.5 2.5h2.5l1.2 3-1.6 1a7 7 0 003.4 3.4l1-1.6 3 1.2v2.5a1.5 1.5 0 01-1.5 1.5A10.5 10.5 0 012 4a1.5 1.5 0 011.5-1.5z"/>'),
    chat: P('<path d="M2.5 4.5a2 2 0 012-2h7a2 2 0 012 2v5a2 2 0 01-2 2H7l-3 2.5v-2.5h0a2 2 0 01-1.5-2z"/>'),
    swap: P('<path d="M3 5.5h9l-2.5-2.5M13 10.5H4l2.5 2.5"/>'),
    x: P('<path d="M4 4l8 8M12 4l-8 8"/>'),
    bell: P('<path d="M4 11V7a4 4 0 018 0v4l1.2 1.5H2.8zM6.5 14h3"/>'),
    leave: P('<rect x="3" y="2.5" width="10" height="11" rx="1.5"/><path d="M5.5 6h5M5.5 9h3"/>'),
    // A4 第四輪
    info: P('<circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v3.8M8 5h.01"/>'),
    dots: P('<path d="M3.5 8h.01M8 8h.01M12.5 8h.01" stroke-width="2.4"/>'),
    filter: P('<path d="M2.5 4h11M4.5 8h7M6.5 12h3"/>'),
    // A6 第六輪：帳戶選單（角色圖示對應產品 roleIcons：pi-shield / pi-book / pi-users）
    shield: P('<path d="M8 1.8l5 1.9v4c0 3.2-2.1 5.4-5 6.5-2.9-1.1-5-3.3-5-6.5v-4z"/>'),
    book: P('<path d="M8 4.2C6.6 3.2 4.7 2.8 2.5 3v9.5c2.2-.2 4.1.2 5.5 1.2 1.4-1 3.3-1.4 5.5-1.2V3c-2.2-.2-4.1.2-5.5 1.2zM8 4.2v9.5"/>'),
    users: P('<circle cx="6" cy="5.5" r="2.3"/><path d="M1.8 13.2c.4-2.3 2.1-3.7 4.2-3.7s3.8 1.4 4.2 3.7M10.6 3.4a2.2 2.2 0 010 4.2M12 9.8c1.2.5 2 1.7 2.2 3.4"/>'),
    edit: P('<circle cx="6.5" cy="5.5" r="2.6"/><path d="M1.8 13.5c.4-2.4 2.3-3.9 4.7-3.9M10 13.6l.3-1.8 3.2-3.2 1.5 1.5-3.2 3.2z"/>'),
    signout: P('<path d="M6.5 2.5H4a1.5 1.5 0 00-1.5 1.5v8A1.5 1.5 0 004 13.5h2.5M10.5 5L13.5 8l-3 3M13.5 8H6"/>'),
  };

  const NAV = [['dashboard', '儀表板', 'dashboard.html'], ['students', '學生', 'students.html'], ['schedule', '課表', 'schedule.html'], ['billing', '帳單', 'billing.html']];
  // #990 批 4：老師端／家長端各自的頁首選單（產品是同一個 ShellLayoutComponent、依角色換選單）。老師端 t-*.html、家長端 p-*.html
  const NAVS = {
    admin: NAV,
    teacher: [['t-schedule', '課表', 't-schedule.html'], ['t-students', '學生', 't-students.html'], ['t-notifications', '通知', 't-notifications.html']],
    parent: [['p-dashboard', '首頁', 'p-dashboard.html'], ['p-attendance', '到班', 'p-attendance.html'], ['p-grades', '成績', 'p-grades.html'], ['p-payments', '繳費', 'p-payments.html']],
  };
  const HOME = { admin: 'dashboard.html', teacher: 't-schedule.html', parent: 'p-dashboard.html' };
  // 10/02 計畫席裁定 A：「更多」照產品選單的分組與名稱（RoutesCatalog），產品沒有的頁不出現。
  // 已在頁首的（課堂管理＝課表、學生管理＝學生、繳費紀錄＝帳單）不重複。[名稱, 檔名, 在哪一批補上]
  const MORE = [
    ['課務管理', [['課程管理', 'courses.html', 1], ['課務異動', 'changes.html', 1]]],
    ['學務管理', [['家長管理', 'parents.html', 1], ['報名進出', 'enrollments.html', 2], ['學生請假管理', 'leave.html', 1], ['聯絡簿', 'contact-book.html', 1]]],
    ['考務與成績', [['考試管理', 'exams.html', 2], ['成績總覽', 'grades.html', 2]]],
    ['行政財務', [['費用方案管理', 'fee-templates.html', 3], ['餐費管理', 'meals.html', 3], ['營收報表', 'reports.html', 3]]],
    ['人事管理', [['人員管理', 'staff.html', 3]]],
    ['系統設定', [['系統設定', 'settings.html', 3]]],
    ['', [['通知中心', 'notifications.html', 2]]],
  ];
  // 家長端「更多」照產品選單（學習狀況／生活與繳費／行政服務）；已在頁首的到班、成績、繳費不重複
  const MORES = {
    admin: MORE, teacher: null,
    parent: [
      ['學習狀況', [['課表查看', 'p-schedule.html', 5]]],
      ['生活與繳費', [['餐費紀錄', 'p-meals.html', 5]]],
      ['行政服務', [['報名申請', 'p-enrollment.html', 5], ['試聽申請', 'p-trial.html', 5], ['加選課程', 'p-add-course.html', 5], ['續課資訊', 'p-renewal.html', 5]]],
      ['', [['通知中心', 'p-notifications.html', 5]]],
    ],
  };
  // 已經做出來的頁；其餘連結點了跳「這一頁在批 N 補上」（計畫席裁定 A），每批做完把檔名加進來
  const BUILT = new Set(['dashboard.html', 'students.html', 'student.html', 'schedule.html', 'billing.html', 'kit.html',
    'leave.html', 'parents.html', 'courses.html', 'class.html', 'changes.html', 'contact-book.html',
    'exams.html', 'scores.html', 'grades.html', 'grades-student.html', 'grades-class.html', 'enrollments.html', 'notifications.html',
    'fee-templates.html', 'meals.html', 'reports.html', 'staff.html', 'settings.html',
    't-schedule.html', 't-students.html', 't-notifications.html',
    'pub-login.html', 'pub-select-role.html', 'pub-link-line.html', 'pub-qr-checkin.html', 'pub-trial.html', 'pub-enrollment.html',
    'p-dashboard.html', 'p-attendance.html', 'p-grades.html', 'p-payments.html', 'p-schedule.html', 'p-meals.html',
    'p-enrollment.html', 'p-trial.html', 'p-add-course.html', 'p-renewal.html', 'p-notifications.html']);

  const dateOf = (iso) => new Date(iso + 'T00:00:00');
  const md = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8)}`;
  const wd = (iso) => '日一二三四五六'[dateOf(iso).getDay()];
  const days = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 864e5);
  const money = (n) => n.toLocaleString('en-US');
  const phone = (p) => `${p.slice(0, 4)}-${p.slice(4, 7)}-${p.slice(7)}`;
  const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3);

  // 今天的到班狀態（日到班）：studentId → todayExpected 那一筆
  const todayOf = Object.fromEntries(C.todayExpected.map((e) => [e.studentId, e]));
  const STATE = { arrived: '已到', not_yet: '還沒到', missing: '該到沒到', on_leave: '請假' };
  // 名冊上一個人的今日狀態：只用字（「16:42 到」「還沒到」「該到沒到」「請假」），不用要圖例的記號
  const todayMeta = (e) => {
    if (!e) return '';
    if (e.state === 'arrived') { const ck = C.checkins.find((x) => x.studentId === e.studentId); return `${e.arrivedAt} 到${ck && ck.by === '櫃台' ? ' · 櫃台代刷' : ''}`; }
    if (e.state === 'not_yet') return `還沒到 · ${e.dueAt} 的課`;
    if (e.state === 'missing') return '該到沒到';
    return '請假';
  };

  // stats: [{ n, label, pre?, unit?, d? }]  d = 只在桌機顯示（手機色面變矮）
  function shell(o, mainHtml) {
    const stats = (o.stats || []).map((s) => `<div class="open__stat${s.d ? ' open__stat--d' : ''}${s.m ? ' open__stat--m' : ''}"><dt class="open__label">${s.label}</dt><dd class="open__n">${s.pre ? `<span class="pre">${s.pre}</span>` : ''}${s.n}${s.unit ? `<small>${s.unit}</small>` : ''}</dd></div>`).join('');
    const role = o.role || 'admin';
    ME.role = role;
    const nav = NAVS[role].map(([k, l, f]) => `<a class="tlink" href="${f}"${k === o.page ? ' aria-current="page"' : ''}>${l}</a>`).join('');
    const more = (MORES[role] || []).map(([g, items]) => `<div>${g ? `<h3>${g}</h3>` : ''}${items.map(([l, f, n]) => `<a href="${f}"${BUILT.has(f) ? '' : ` data-batch="${n}"`}>${l}</a>`).join('')}</div>`).join('');

    document.getElementById('app').innerHTML = `
      <header class="top"><div class="wrap top__in">
        <a class="top__mark" href="${HOME[role]}"${HOME[role] === o.page + '.html' ? ' aria-current="page"' : ''}>Clessia</a>
        <nav class="top__nav" aria-label="主要導覽">${nav}${more ? `<button class="tlink" type="button" popovertarget="more">更多${icon.down}</button>` : ''}</nav>
        <div class="top__tools">
          ${role === 'admin' ? `<label class="top__search">${icon.search}<input type="search" placeholder="找學生、家長電話、帳單" aria-label="全站搜尋"></label>
          <button class="top__searchbtn" type="button" aria-label="搜尋">${icon.search}</button>
          <select class="top__campus" aria-label="切換分校">${C.campuses.map((c) => `<option>${c}</option>`).join('')}</select>` : ''}
          ${acctBtn()}
        </div>
      </div></header>
      <section class="open" aria-label="這一頁的摘要">
        <canvas class="open__field" aria-hidden="true"></canvas>
        <div class="wrap open__in">
          ${o.back || ''}${o.child ? kidBadge() : ''}
          <h1 class="open__title${o.titleClass ? ' ' + o.titleClass : ''}">${o.title}</h1>
          ${o.sub ? `<p class="open__sub">${o.sub}</p>` : ''}
          ${stats ? `<dl class="open__stats">${stats}</dl>` : ''}
          ${o.extra || ''}
        </div>
      </section>
      ${o.bar ? `<div class="tbar inkbar"><div class="wrap tbar__in">${o.bar}</div></div>` : ''}
      <main><div class="wrap">${mainHtml}</div></main>
      ${o.dock ? `<div class="dock inkbar" role="toolbar" aria-label="主要動作">${o.dock}</div>` : ''}
      ${more ? `<div class="more" id="more" popover><div class="more__grid">${more}</div></div>` : ''}
      ${o.child ? kidPop() : ''}
      ${acctParts()}`;

    // 流場在色面裡慢慢流；往下捲色面就離開畫面，flow.js 的 IntersectionObserver 會停掉它
    ClessiaFlow.mount(document.querySelector('.open__field'), { density: 0.75, speed: 0.5, phase: o.phase || 0 });

    // 「更多」浮層貼著按鈕（popover 預設在畫面正中）
    const pop = document.getElementById('more');
    const opener = document.querySelector('[popovertarget="more"]');
    if (pop) pop.addEventListener('toggle', (e) => {
      if (e.newState !== 'open') return;
      const r = opener.getBoundingClientRect();
      const left = Math.max(16, Math.min(r.left, innerWidth - pop.offsetWidth - 16));
      Object.assign(pop.style, { position: 'fixed', left: left + 'px', top: r.bottom + 8 + 'px' });
    });

    account();
    if (o.child) kidBind();
    if (role === 'admin') search();

    // 10/02：頁首捲離頂端才出現下陰影（使用者：「往下卷會出現下陰影」）；捲回頂端就沒有任何分隔
    const top = document.querySelector('.top');
    const onScroll = () => top && top.classList.toggle('is-scrolled', scrollY > 0);
    addEventListener('scroll', onScroll, { passive: true }); onScroll();

    const invoker = {};
    document.addEventListener('click', (e) => { const t = e.target.closest('[popovertarget]'); if (t) invoker[t.getAttribute('popovertarget')] = t; }, true);
    // A4：其他白色浮層（篩選、⋯）一樣貼著打開它的按鈕；太靠右就往左貼齊
    document.querySelectorAll('[popover].pop').forEach((p) => p.addEventListener('toggle', (e) => {
      if (e.newState !== 'open') return;
      // 同一份選單可能有很多顆開啟鈕（每列一顆 ⋯）：貼著實際被按的那顆
      const b = (invoker[p.id] && invoker[p.id].isConnected ? invoker[p.id] : document.querySelector(`[popovertarget="${p.id}"]`)).getBoundingClientRect();
      const left = Math.max(16, Math.min(b.left, innerWidth - p.offsetWidth - 16));
      // 下方放不下（按的是畫面底部那一列）就往上開，不要開到畫面外
      const below = innerHeight - b.bottom - 24, above = b.top - 24, h = p.scrollHeight;
      if (h > below && above > below) Object.assign(p.style, { position: 'fixed', left: left + 'px', top: 'auto', bottom: innerHeight - b.top + 8 + 'px', maxHeight: above + 'px' });
      else Object.assign(p.style, { position: 'fixed', left: left + 'px', top: b.bottom + 8 + 'px', bottom: 'auto', maxHeight: below + 8 + 'px' });
    }));
  }

  /* ── A6 第六輪：帳戶＋切換身分（一個入口）─────────────────────────────
   * 頁首右側「頭像＋林主任 · 管理員 ▾」→ 浮層（桌機）／底部抽屜（手機，CSS 斷點切換，同一個 popover）。
   * 內容順序：人 → 切換身分（其他角色）→ 帳號設定 → 登出。純 hash #account 直接打開。
   * 示範使用者是「管理員＋任課老師＋家長」，好讓切換身分列出兩個選項。
   * 頭像：產品是 jdenticon（依使用者 id 產生的幾何圖），設計稿用名字首字代替。 */
  const ME = { name: '林主任', email: 'lin.director@wenshan-demo.tw', role: 'admin', roles: ['admin', 'teacher', 'parent'], phone: '0912345678', birthday: '1979-04-12' };
  const ROLE = { admin: ['管理員', 'shield'], teacher: ['任課老師', 'book'], parent: ['家長', 'users'] };
  const av = (cls) => `<span class="acct-av ${cls}" aria-hidden="true">${ME.name[0]}</span>`;
  const acctBtn = () => `<button class="acct" type="button" popovertarget="acct" aria-label="帳戶：${ME.name}，目前身分 ${ROLE[ME.role][0]}">
      ${av('acct-av--sm')}<span class="top__who acct__who">${ME.name} · ${ROLE[ME.role][0]}</span><span class="acct__role">${ROLE[ME.role][0]}</span>${icon.down}</button>`;
  const field = (label, input, hint) => `<div class="acset__f"><label class="acset__l">${label}</label><div class="acset__row">${input}<button class="btn btn--sm" type="button" data-busy="儲存中…" data-ok="已儲存${label}">儲存</button></div>${hint ? `<p class="acset__hint">${hint}</p>` : ''}</div>`;
  const acctParts = () => `
      <div class="acct-menu" id="acct" popover aria-label="帳戶">
        <div class="acct-menu__me">${av('acct-av--lg')}<div class="acct-menu__txt"><p class="acct-menu__name">${ME.name}</p><p class="acct-menu__mail">${ME.email}</p></div></div>
        <div class="acct-menu__grp" role="group" aria-labelledby="acct-sw">
          <p class="acct-menu__h" id="acct-sw">切換身分</p>
          ${ME.roles.filter((r) => r !== ME.role).map((r) => `<button class="acct-menu__item" type="button" data-switch="${r}">${icon[ROLE[r][1]]}${ROLE[r][0]}</button>`).join('')}
        </div>
        <div class="acct-menu__grp">
          <button class="acct-menu__item" type="button" data-acset>${icon.edit}帳號設定</button>
          <button class="acct-menu__item acct-menu__item--danger" type="button" data-signout>${icon.signout}登出</button>
        </div>
      </div>
      <dialog class="acset" aria-labelledby="acset-t">
        <div class="acset__head"><h2 class="acset__t" id="acset-t">帳號設定</h2><button class="acset__x" type="button" aria-label="關閉" data-acset-close>${icon.x}</button></div>
        <div class="acset__body">
          ${field('顯示名稱', `<input class="acset__in" value="${ME.name}">`)}
          ${field('生日', `<input class="acset__in" type="date" value="${ME.birthday}">`)}
          ${field('Email', `<input class="acset__in" type="email" value="${ME.email}">`, '補習班用這個 Email 幫你產生一次性登入連結')}
          ${field('電話', `<input class="acset__in" type="tel" value="${phone(ME.phone)}">`)}
          <section class="acset__sec" aria-labelledby="acset-p"><p class="acset__l" id="acset-p">家長身份</p><p class="acset__on">${icon.check}已啟用</p></section>
        </div>
      </dialog>
      <div class="switching" role="status" aria-live="polite" hidden></div>`;

  function account() {
    const pop = document.getElementById('acct');
    const btn = document.querySelector('[popovertarget="acct"]');
    const dlg = document.querySelector('.acset');
    const sw = document.querySelector('.switching');
    pop.addEventListener('toggle', (e) => {
      btn.setAttribute('aria-expanded', e.newState === 'open');
      if (e.newState !== 'open') { if (location.hash === '#account') history.replaceState(null, '', location.pathname + location.search); return; }
      if (narrow.matches) { pop.removeAttribute('style'); return; } // 手機：CSS 把它放成底部抽屜
      // 從「頁首的下緣」往下留 12px，而不是從按鈕下緣：按鈕在 56px 的頁首裡置中，
      // 從它算會讓選單壓到頁首邊緣，看起來黏在一起
      const r = btn.getBoundingClientRect();
      const hb = (btn.closest('.top') || btn).getBoundingClientRect().bottom;
      Object.assign(pop.style, { position: 'fixed', left: Math.max(16, r.right - pop.offsetWidth) + 'px', top: hb + 12 + 'px' });
    });
    pop.addEventListener('click', (e) => {
      const s = e.target.closest('[data-switch]');
      if (s) { pop.hidePopover(); switchTo(ROLE[s.dataset.switch][0]); setTimeout(() => (location.href = HOME[s.dataset.switch]), 700); }
      if (e.target.closest('[data-acset]')) { pop.hidePopover(); dlg.showModal(); }
      if (e.target.closest('[data-signout]')) { pop.hidePopover(); switchTo('', true); }
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-acset-close]')) dlg.close(); });
    // 過場：產品是就地切換（navigateToRoleShell），這裡只演到「已切換」為止 —— 設計稿沒有家長頁
    // 登出用同一個過場：產品登出後回到登入頁；這裡停在「已登出」，按「重新登入」到 pub-login.html（批 6）
    function switchTo(label, out) {
      sw.innerHTML = `<div class="switching__in">${av('acct-av--lg')}<p class="switching__t">${out ? '正在登出…' : `正在切換到 ${label}…`}</p><span class="switching__bar"></span></div>`;
      sw.hidden = false;
      setTimeout(() => {
        sw.querySelector('.switching__t').textContent = out ? `已登出 ${ME.name} 的帳號` : `已切換到 ${label}`;
        sw.querySelector('.switching__bar').replaceWith(Object.assign(document.createElement('button'), { className: 'btn', type: 'button', textContent: out ? '重新登入' : '回到管理員', onclick: () => (out ? (location.href = 'pub-login.html') : (sw.hidden = true)) }));
      }, out ? 900 : 1400);
    }
    const fromHash = () => { if (location.hash === '#account' && !pop.matches(':popover-open')) pop.showPopover(); };
    addEventListener('hashchange', fromHash);
    fromHash();
  }

  /* ── 全站搜尋（#990 批 0）：打字就出結果，學生名字或家長電話都找得到；手機按放大鏡從底部升起同一個面板 ── */
  function search() {
    const head = document.querySelector('.top__search input');
    const box = Object.assign(document.createElement('div'), { className: 'srch', id: 'srch' });
    box.popover = 'auto';
    box.setAttribute('aria-label', '搜尋結果');
    box.innerHTML = `<label class="srch__q">${icon.search}<input type="search" placeholder="找學生、家長電話" aria-label="全站搜尋"></label><div class="srch__res"></div>`;
    document.body.append(box);
    const own = box.querySelector('input'), res = box.querySelector('.srch__res');
    const digits = (q) => q.replace(/\D/g, '');
    const run = (q) => {
      q = q.trim();
      if (!q) { res.innerHTML = `<p class="srch__empty">打學生名字，或家長電話的後四碼</p>`; return; }
      const d = digits(q);
      const hits = C.students.filter((st) => st.name.includes(q) || (d.length >= 3 && st.parent && st.parent.phone.includes(d))).slice(0, 6);
      res.innerHTML = hits.length
        ? hits.map((st) => `<a class="srch__it" href="student.html"><span class="srch__n">${esc(st.name)}</span><span class="srch__m">${st.parent ? `${esc(st.parent.name)} ${phone(st.parent.phone)}` : ''}</span></a>`).join('')
        : `<p class="srch__empty">找不到「${esc(q)}」。試試只打姓氏，或家長電話的後四碼。</p>`;
    };
    const place = () => {
      if (narrow.matches) { box.removeAttribute('style'); return; }
      const r = head.closest('.top__search').getBoundingClientRect();
      Object.assign(box.style, { position: 'fixed', left: r.left + 'px', top: r.bottom + 6 + 'px', width: Math.max(r.width, 320) + 'px' });
    };
    if (head) head.addEventListener('input', () => {
      run(head.value);
      if (!box.matches(':popover-open')) { box.showPopover(); place(); head.focus(); }
    });
    own.addEventListener('input', () => run(own.value));
    const btn = document.querySelector('.top__searchbtn');
    if (btn) btn.addEventListener('click', () => { own.value = ''; run(''); box.showPopover(); place(); own.focus(); });
    [head, own].forEach((i) => i && i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = res.querySelector('a'); if (a) location.href = a.href; } }));
  }

  // A3 第三輪：<details data-fold> 桌機展開、手機收起；跨過斷點時重設
  const narrow = matchMedia('(max-width: 860px)');
  const fold = (root = document) => root.querySelectorAll('details[data-fold]').forEach((d) => (d.open = !narrow.matches));
  narrow.addEventListener('change', () => fold());

  /* ═══ #990 共用零件（10/02）：toast、按鈕忙碌狀態、客製下拉 ═══════════════════════
   * 三條標準：①按了一定有看得見的回饋 ②彈出有進出場（CSS，見 a6.css 檔尾）③全站沒有看得到的原生下拉。 */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ── toast：每則一個新節點（不改寫舊的），最多同時 3 則；滑過或鍵盤移入時暫停計時 ──
  let toastBox;
  function toast(text, { undo, ms } = {}) {
    if (!toastBox) {
      toastBox = Object.assign(document.createElement('div'), { className: 'toasts' });
      toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite');
      toastBox.popover = 'manual';
      document.body.append(toastBox);
    }
    // 每次重新放進頂層，才會在最後打開的對話框之上
    if (toastBox.matches(':popover-open')) toastBox.hidePopover();
    toastBox.showPopover();
    // 手機底部有動作列時浮在它上面
    // 手機底部有動作列時浮在它上面（用它的頂端位置算，不用 offsetHeight —— 動作列的定位不一定從 0 起算）
    const dock = [...document.querySelectorAll('.dock')].find((x) => x.getClientRects().length && getComputedStyle(x).display !== 'none');
    const dockTop = dock ? dock.getBoundingClientRect().top : innerHeight;
    toastBox.style.bottom = Math.max(16, innerHeight - dockTop + 12) + 'px';
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `${icon.check}<span class="toast__t">${esc(text)}</span>${undo ? '<button class="toast__undo" type="button">復原</button>' : ''}`;
    toastBox.append(t);
    while (toastBox.children.length > 3) toastBox.firstElementChild.remove();
    let left = ms || (undo ? 6000 : 4000), t0 = Date.now(), timer;
    const close = () => { clearTimeout(timer); t.classList.add('is-leaving'); setTimeout(() => t.remove(), 160); };
    const run = () => { t0 = Date.now(); timer = setTimeout(close, left); };
    const hold = () => { clearTimeout(timer); left -= Date.now() - t0; };
    t.addEventListener('pointerenter', hold); t.addEventListener('pointerleave', run);
    t.addEventListener('focusin', hold); t.addEventListener('focusout', run);
    if (undo) t.querySelector('.toast__undo').onclick = () => { close(); undo(); toast('已復原'); };
    run();
    return t;
  }

  // ── act：寫入類按鈕。按下先「處理中…」（寬度先鎖住，不推動旁邊），完成後執行 run、跳 toast ──
  async function act(btn, { busy = '處理中…', ok, run, undo, ms = 700 } = {}) {
    if (btn.getAttribute('aria-busy') === 'true') return;
    const html = btn.innerHTML, w = btn.offsetWidth;
    btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-disabled', 'true');
    btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${esc(busy)}`;
    btn.style.width = Math.max(w, btn.scrollWidth + 2) + 'px';
    await wait(ms);
    btn.innerHTML = html; btn.style.width = '';
    btn.removeAttribute('aria-busy'); btn.removeAttribute('aria-disabled');
    const r = run && run(btn);
    if (ok) toast(ok, { undo: undo || (r && r.undo) });
  }

  // 宣告式：<button data-ok="已提醒 3 位家長" data-busy="寄送中…" data-done="已提醒">
  //   data-done ＝ 完成後按鈕自己換字並停用（資料就地變化），data-undo ＝ toast 給「復原」把它換回來
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ok]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    const done = b.dataset.done, before = b.innerHTML;
    const run = done ? () => { b.innerHTML = `${icon.check}${esc(done)}`; b.setAttribute('aria-disabled', 'true'); b.classList.add('is-done'); } : null;
    const undo = done && 'undo' in b.dataset ? () => { b.innerHTML = before; b.removeAttribute('aria-disabled'); b.classList.remove('is-done'); } : null;
    if ('busy' in b.dataset) act(b, { busy: b.dataset.busy || '處理中…', ok: b.dataset.ok, run, undo });
    else { run && run(); toast(b.dataset.ok, { undo }); }
  });

  // ── form：寫入類動作的表單對話框（沿用帳號設定 .acset 的樣子：桌機置中、手機深灰底部面板）──
  // fields: [{ k, label, type: 'select'|'text'|'date'|'time'|'money'|'radio', options, value, req, hint, ph, half }]
  // 必填沒填時送出鈕不能按，旁邊一行字寫還差什麼（不是只有變灰）。
  // 送出：處理中 → 關閉 → toast（ok 可以是函式，拿到填的值）→ apply(值) 讓頁面就地更新
  function form({ title, sub, fields, submit = '確定', busy = '處理中…', ok, apply, undo }) {
    const d = document.createElement('dialog');
    d.className = 'acset fdlg';
    const fid = (f) => `f-${f.k}`;
    const input = (f) => {
      if (f.type === 'select') return `<select class="acset__in" id="${fid(f)}" data-k="${f.k}">${(f.ph ? [['', f.ph]] : []).concat(f.options.map((o) => (Array.isArray(o) ? o : [o, o]))).map(([v, l]) => `<option value="${esc(v)}"${String(f.value ?? '') === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      if (f.type === 'textarea') return `<textarea class="acset__in" id="${fid(f)}" data-k="${f.k}" rows="4"${f.ph ? ` placeholder="${esc(f.ph)}"` : ''}>${esc(f.value ?? '')}</textarea>`;
      if (f.type === 'radio') return `<div class="fdlg__seg" role="radiogroup" aria-labelledby="${fid(f)}-l">${f.options.map((o, i) => `<label class="fdlg__opt"><input type="radio" name="${f.k}" value="${esc(o)}" data-k="${f.k}"${(f.value ?? f.options[0]) === o ? ' checked' : ''}>${esc(o)}</label>`).join('')}</div>`;
      return `<input class="acset__in" id="${fid(f)}" data-k="${f.k}" type="${f.type === 'money' ? 'text' : f.type || 'text'}"${f.type === 'money' ? ' inputmode="numeric"' : ''} value="${esc(f.value ?? '')}"${f.ph ? ` placeholder="${esc(f.ph)}"` : ''} autocomplete="off">`;
    };
    d.setAttribute('aria-labelledby', 'fdlg-t');
    d.innerHTML = `<div class="acset__head"><div><h2 class="acset__t" id="fdlg-t">${esc(title)}</h2>${sub ? `<p class="fdlg__sub">${esc(sub)}</p>` : ''}</div><button class="acset__x" type="button" aria-label="關閉" data-x>${icon.x}</button></div>
      <form class="acset__body fdlg__body" method="dialog">${fields.map((f) => `<div class="acset__f${f.half ? ' fdlg__half' : ''}"><label class="acset__l" id="${fid(f)}-l" for="${fid(f)}">${esc(f.label)}${f.req ? ' <span class="fdlg__req" aria-hidden="true">*</span>' : ''}</label>${f.type === 'money' ? `<div class="fdlg__money"><span aria-hidden="true">NT$</span>${input(f)}</div>` : input(f)}${f.hint ? `<p class="acset__hint">${esc(f.hint)}</p>` : ''}</div>`).join('')}</form>
      <div class="fdlg__foot"><p class="fdlg__why" aria-live="polite"></p><button class="btn" type="button" data-x>取消</button><button class="btn btn--cta" type="button" data-go>${esc(submit)}</button></div>`;
    document.body.append(d);
    const go = d.querySelector('[data-go]'), why = d.querySelector('.fdlg__why');
    const vals = () => Object.fromEntries(fields.map((f) => [f.k, f.type === 'radio' ? (d.querySelector(`[name="${f.k}"]:checked`) || {}).value : d.querySelector(`[data-k="${f.k}"]`).value.trim()]));
    const check = () => {
      const miss = fields.filter((f) => f.req && !vals()[f.k]);
      go.setAttribute('aria-disabled', miss.length ? 'true' : 'false');
      why.textContent = miss.length ? `還沒填：${miss.map((f) => f.label).join('、')}` : '';
    };
    d.addEventListener('input', check); d.addEventListener('change', check);
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-x]')) d.close();
      if (e.target.closest('[data-go]')) {
        if (go.getAttribute('aria-disabled') === 'true') { why.classList.remove('is-shake'); void why.offsetWidth; why.classList.add('is-shake'); return; }
        const v = vals();
        act(go, { busy, ok: typeof ok === 'function' ? ok(v) : ok, undo: undo && (() => undo(v)), run: () => { d.close(); return apply && apply(v); } });
      }
    });
    d.addEventListener('close', () => setTimeout(() => d.remove(), 200));
    check();
    d.showModal();
    const first = d.querySelector('.dd, input:not([type=radio])');
    if (first && !narrow.matches) first.focus();
    return d;
  }

  // ── 幾支跨頁共用的寫入表單，欄位照產品（kb/wiki/specs/sitemap 記的對話框欄位）──
  const stuOpts = (list) => list.map((st) => [st.id, `${st.name}（${st.gradeLabel}）`]);
  const forms = {
    // 產品 LeaveFormDialogComponent：學生、開始／結束日期時間、原因（選填）
    leave({ studentId, from = '17:00', to = '21:00', onDone } = {}) {
      const st = studentId && C.studentById[studentId];
      return form({
        title: '登記請假', sub: st ? `${st.name} · 這段時間的課都會標成請假` : '這段時間的課都會標成請假',
        fields: [
          ...(st ? [] : [{ k: 'sid', label: '學生', type: 'select', ph: '輸入姓名搜尋', options: stuOpts(C.students), req: true }]),
          { k: 'd1', label: '開始日期', type: 'date', value: C.TODAY, half: true, req: true }, { k: 't1', label: '開始時間', type: 'time', value: from, half: true, req: true },
          { k: 'd2', label: '結束日期', type: 'date', value: C.TODAY, half: true, req: true }, { k: 't2', label: '結束時間', type: 'time', value: to, half: true, req: true },
          { k: 'why', label: '原因（選填）', ph: '請假原因' },
        ],
        submit: '送出請假', busy: '送出中…',
        ok: (v) => `已登記 ${(st || C.studentById[v.sid]).name} ${md(v.d1)} 請假`,
        apply: (v) => onDone && onDone(st ? studentId : v.sid, v),
      });
    },
    // 日到班：櫃台代刷＝幫沒帶卡的學生登記到班，算今天所有的課都到了
    checkin({ onDone } = {}) {
      const left = C.todayExpected.filter((e) => e.state === 'missing' || e.state === 'not_yet').map((e) => C.studentById[e.studentId]);
      return form({
        title: '櫃台代刷到班', sub: '幫沒帶卡的學生登記到班，今天所有的課都算到了',
        fields: [{ k: 'sid', label: '學生（今天還沒到的）', type: 'select', ph: '選一位學生', options: stuOpts(left), req: true }, { k: 't', label: '到班時間', type: 'time', value: C.NOW, req: true }],
        submit: '登記到班', busy: '登記中…',
        ok: (v) => `${C.studentById[v.sid].name} ${v.t} 到班（櫃台代刷）`,
        apply: (v) => onDone && onDone(v.sid, v),
      });
    },
    // 產品「記錄收款」：收款金額、付款方式（現金／轉帳）、收款日期、備註
    pay({ name, due, paid = 0, onDone } = {}) {
      const owe = due - paid;
      return form({
        title: '記錄收款', sub: `${name} · 應繳 ${money(due)} 元 · 已收 ${money(paid)} 元 · 尚欠 ${money(owe)} 元`,
        fields: [
          { k: 'amt', label: '收款金額', type: 'money', value: String(owe), req: true, hint: '可以少於應繳 —— 部分收款是常態，帳單會自動變成「部分繳」。' },
          { k: 'how', label: '付款方式', type: 'radio', options: ['現金', '轉帳'] },
          { k: 'd', label: '收款日期', type: 'date', value: C.TODAY, half: true, req: true }, { k: 'note', label: '備註', ph: '如：定金', half: true },
        ],
        submit: '記錄收款', busy: '記錄中…',
        ok: (v) => `已記錄 ${name} 收款 NT$ ${money(+v.amt.replace(/\D/g, '') || 0)}（${v.how}）`,
        apply: (v) => onDone && onDone(+v.amt.replace(/\D/g, '') || 0, v),
      });
    },
  };

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-batch]');
    if (!a) return;
    e.preventDefault();
    const pop = a.closest('[popover]'); if (pop) pop.hidePopover();
    toast(`「${a.textContent.trim()}」這一頁在批 ${a.dataset.batch} 補上`);
  });

  // ── 客製下拉 ────────────────────────────────────────────────────────────────
  // 原生 <select> 留在原處當資料來源（隱藏、不可聚焦），既有程式讀 .value、聽 change 都不用改；
  // 旁邊畫一顆觸發鈕＋共用的清單浮層。桌機貼著按鈕；手機是深灰底部面板（第五種面）。
  // 鍵盤：Enter／空白／↓ 打開，↑↓ Home End 移動，Enter 選定，Esc 關閉並回到觸發鈕，打字跳到相符的選項；超過 8 項有搜尋框。
  const vDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const iDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  let ddSeq = 0;
  // 讀屏名稱：label 第一個 span 的字，但不要把「新」小標一起念進去
  const ddLabel = (sel) => {
    if (sel.getAttribute('aria-label')) return sel.getAttribute('aria-label');
    const sp = sel.closest('label') && sel.closest('label').querySelector('span');
    if (!sp) return '選擇';
    const c = sp.cloneNode(true); c.querySelectorAll('.new').forEach((n) => n.remove());
    return c.textContent.trim() || '選擇';
  };

  function enhance(sel) {
    if (sel.dataset.dd) return;
    const id = 'dd' + ++ddSeq;
    sel.dataset.dd = id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dd ${sel.className}`.trim();
    btn.id = id;
    btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', `${ddLabel(sel)}：`);
    btn.innerHTML = '<span class="dd__v"></span>';
    // 觸發鈕放在 select 前面：外層 <label> 的點擊會落到第一個可標記的元素，也就是這顆鈕
    sel.before(btn);
    sel.hidden = true; sel.tabIndex = -1;
    const sync = () => {
      const o = sel.options[sel.selectedIndex];
      const txt = o ? o.textContent.trim() : '';
      const v = btn.querySelector('.dd__v');
      if (v.textContent === txt) return;
      // 換值＝換一個新節點，不在原節點上改字
      const n = Object.assign(document.createElement('span'), { className: 'dd__v' + (v.textContent ? ' is-new' : ''), textContent: txt });
      v.replaceWith(n);
      btn.setAttribute('aria-label', `${ddLabel(sel)}：${txt}`);
    };
    Object.defineProperty(sel, 'value', { configurable: true, get() { return vDesc.get.call(this); }, set(x) { vDesc.set.call(this, x); sync(); } });
    Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return iDesc.get.call(this); }, set(x) { iDesc.set.call(this, x); sync(); } });
    new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true });
    sel.addEventListener('change', sync);
    sync();
    btn.addEventListener('click', () => openList(sel, btn));
    btn.addEventListener('keydown', (e) => { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); openList(sel, btn); } });
  }

  let list, cur, last = {};
  function openList(sel, btn) {
    if (!list) {
      list = document.createElement('div');
      list.className = 'ddl'; list.setAttribute('popover', '');
      // beforetoggle 是同步的；toggle 是非同步，換到另一個下拉時會清錯人
      list.addEventListener('beforetoggle', (e) => {
        if (!cur || e.newState !== 'closed') return;
        cur.btn.setAttribute('aria-expanded', 'false');
        last = { sel: cur.sel, t: performance.now(), dismissed: !cur.refocus };
        if (cur.refocus) cur.btn.focus({ preventScroll: true });
        cur = null;
      });
      list.addEventListener('keydown', onKey);
      list.addEventListener('click', (e) => {
        const o = e.target.closest('[role=option]');
        if (o && o.getAttribute('aria-disabled') !== 'true') choose(+o.dataset.i);
        if (e.target.closest('.ddl__x')) close(true);
      });
      list.addEventListener('pointermove', (e) => { const o = e.target.closest('[role=option]'); if (o) setActive(o); });
    }
    // 再按一次同一顆＝關閉（點觸發鈕時清單已被「點外面」關掉了，這裡就不要再打開）
    if (cur && cur.sel === sel) { list.hidePopover(); return; }
    if (last.dismissed && last.sel === sel && performance.now() - last.t < 300) return;
    // 浮層要掛在觸發鈕所在的對話框／浮層裡，否則會被當成外面而關掉上一層
    (btn.closest('dialog, [popover]:not(.ddl)') || document.body).append(list);
    const opts = [...sel.options];
    const many = opts.length > 8;
    list.setAttribute('aria-label', ddLabel(sel));
    list.innerHTML = `<div class="ddl__head"><p class="ddl__t">${esc(ddLabel(sel))}</p><button class="ddl__x" type="button" aria-label="關閉">${icon.x}</button></div>
      ${many ? `<label class="ddl__q">${icon.search}<input type="search" placeholder="搜尋" aria-label="搜尋選項" aria-controls="ddl-box" autocomplete="off"></label>` : ''}
      <div class="ddl__box" id="ddl-box" role="listbox" tabindex="-1" aria-label="${esc(ddLabel(sel))}">${opts.map((o, i) =>
        `<div class="ddl__o" role="option" id="ddo-${i}" data-i="${i}" aria-selected="${i === sel.selectedIndex}"${o.disabled ? ' aria-disabled="true"' : ''}>${icon.check}<span>${esc(o.textContent.trim())}</span></div>`).join('')}</div>`;
    cur = { sel, btn, q: '', qt: 0 };
    btn.setAttribute('aria-expanded', 'true');
    list.showPopover();
    place();
    const s = list.querySelector('[aria-selected=true]') || list.querySelector('[role=option]');
    if (s) { setActive(s); reveal(s); }
    const q = list.querySelector('.ddl__q input');
    if (q) { q.addEventListener('input', () => filter(q.value)); if (!narrow.matches) q.focus(); else list.querySelector('[role=listbox]').focus(); }
    else list.querySelector('[role=listbox]').focus();
  }
  function place() {
    if (narrow.matches) { list.removeAttribute('style'); return; }
    const r = cur.btn.getBoundingClientRect();
    const w = Math.max(r.width, 200);
    const below = innerHeight - r.bottom - 16, above = r.top - 16;
    const up = below < 240 && above > below;
    Object.assign(list.style, {
      position: 'fixed', minWidth: w + 'px', left: Math.max(16, Math.min(r.left, innerWidth - w - 16)) + 'px',
      top: up ? 'auto' : r.bottom + 6 + 'px', bottom: up ? innerHeight - r.top + 6 + 'px' : 'auto',
      maxHeight: Math.min(360, up ? above : below) + 'px',
    });
  }
  // 只捲選項區，不用 scrollIntoView（它會連面板、甚至整頁一起捲）
  const reveal = (o) => {
    const box = o.parentElement;
    if (o.offsetTop < box.scrollTop) box.scrollTop = o.offsetTop - 4;
    else if (o.offsetTop + o.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = o.offsetTop + o.offsetHeight - box.clientHeight + 4;
  };
  const visibleOpts = () => [...list.querySelectorAll('[role=option]:not([hidden]):not([aria-disabled=true])')];
  function setActive(o) {
    list.querySelectorAll('.is-active').forEach((x) => x.classList.remove('is-active'));
    o.classList.add('is-active');
    list.querySelector('[role=listbox]').setAttribute('aria-activedescendant', o.id);
    const q = list.querySelector('.ddl__q input'); if (q) q.setAttribute('aria-activedescendant', o.id);
  }
  function filter(t) {
    const k = t.trim().toLowerCase();
    list.querySelectorAll('[role=option]').forEach((o) => (o.hidden = !!k && !o.textContent.toLowerCase().includes(k)));
    const v = visibleOpts(); if (v[0]) setActive(v[0]);
  }
  const close = (refocus) => { if (cur) cur.refocus = refocus; if (list.matches(':popover-open')) list.hidePopover(); };
  function choose(i) {
    const { sel } = cur;
    const changed = sel.selectedIndex !== i;
    iDesc.set.call(sel, i);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    close(true);
    if (changed) sel.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function onKey(e) {
    const v = visibleOpts(), a = list.querySelector('.is-active'), i = v.indexOf(a);
    const go = (n) => { const o = v[Math.max(0, Math.min(v.length - 1, n))]; if (o) { setActive(o); reveal(o); } };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(v.length - 1); }
    else if (e.key === 'Enter' || (e.key === ' ' && e.target.tagName !== 'INPUT')) { e.preventDefault(); if (a) choose(+a.dataset.i); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') { e.preventDefault(); close(true); }
    else if (e.key.length === 1 && e.target.tagName !== 'INPUT') {
      // 打字跳到開頭相符的選項（1 秒內連打算同一個字串）
      cur.q = Date.now() - cur.qt < 1000 ? cur.q + e.key : e.key; cur.qt = Date.now();
      const hit = v.find((o) => o.textContent.trim().toLowerCase().startsWith(cur.q.toLowerCase()));
      if (hit) { setActive(hit); reveal(hit); }
    }
  }
  addEventListener('resize', () => cur && place());
  addEventListener('scroll', () => cur && !narrow.matches && place(), { passive: true, capture: true });

  // 頁面上（含之後才畫出來的對話框裡）出現的每一個 <select> 都換掉
  const scan = (root) => root.querySelectorAll && root.querySelectorAll('select:not([data-dd])').forEach(enhance);
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType !== 1) return; if (n.tagName === 'SELECT') enhance(n); else scan(n); })))
    .observe(document.documentElement, { childList: true, subtree: true });
  scan(document);

  /* ── #990 批 5：孩子切換器（kb/wiki/specs/sitemap/_shared/parent-child-switcher.md）──────────
   * 家長端依賴孩子的頁（首頁／到班／成績／繳費…）在 A2.shell 帶 child: true，橘色開場色面左上角就出現孩子徽章。
   * 形態照產品 child-switcher.component.html 的判斷順序：讀取失敗 → 徽章「讀不到孩子資料」（不可按）；
   * ≥2 個孩子 → 按鈕徽章＋箭頭，按了開「切換孩子」（只列其他孩子）；1 個 → 靜態徽章；0 個 → 不渲染。
   * 示範：預設 3 個孩子；hash 帶 kids-1／kids-0／kids-failed 看其餘三種（可跟頁面自己的 hash 並存，例 #week&kids-1）。
   * 與產品的差異（設計稿刻意改的）：讀取失敗時內容區給「重新讀取」（產品沒有，標新）；徽章與選項 ≥44px（產品 26／34px，sitemap 記為現況缺口）；
   * 失敗徽章不用紅（A6：紅不貼橘），改近黑字＋警示圖示；手機是底部面板（深灰，五種面）。
   * 頁面：A2.kids.active 取目前的孩子；A2.kids.gate(html) 包內容區（0 個孩子／讀取失敗時換成一句明確的話，#749）；
   * A2.kids.on(fn) 註冊切換後重畫 —— 沒註冊的頁就整頁重載（設計稿用 sessionStorage 記住選了誰）。 */
  const KID_IDS = ['s5', 's3', 's1'];
  const kidMode = (location.hash.match(/kids-(1|0|failed)/) || [])[1] || 'many';
  const kidList = kidMode === 'failed' || kidMode === '0' ? [] : KID_IDS.slice(0, kidMode === '1' ? 1 : 3).map((id) => C.studentById[id]);
  let kidOn = null;
  const kidStore = (v) => { try { if (v) sessionStorage.setItem('a2-kid', v); return sessionStorage.getItem('a2-kid'); } catch (e) { return null; } };
  const kids = {
    mode: kidMode, list: kidList,
    get active() { const id = kidStore(); return kidList.find((k) => k.id === id) || kidList[0] || null; },
    on(fn) { kidOn = fn; },
    gate(html) {
      if (kidMode === 'failed') return `<div class="kidgate">${icon.alert}<div><p class="kidgate__t">讀不到孩子資料</p><p class="kidgate__d">可能是連線問題，你的資料沒有遺失。</p><button class="btn btn--sm" type="button" data-kid-retry>重新讀取</button><span class="new">新</span></div></div>`;
      if (kidMode === '0') return `<div class="kidgate">${icon.users}<div><p class="kidgate__t">這個帳號還沒有綁定任何學生</p><p class="kidgate__d">請聯絡補習班櫃檯協助綁定，綁定之後這裡就會出現孩子的紀錄。</p></div></div>`;
      return html;
    },
  };
  const kidName = (k) => `<span class="kid__name">${k.name}</span><span class="kid__g">${k.gradeLabel}</span>`;
  function kidBadge() {
    if (kidMode === 'failed') return `<p class="kid kid--failed">${icon.alert}讀不到孩子資料</p>`;
    const a = kids.active;
    if (!a) return '';
    if (kidList.length === 1) return `<p class="kid">${kidName(a)}</p>`;
    return `<button class="kid kid--btn" type="button" popovertarget="kidpop" aria-label="目前看的是 ${a.name}，切換孩子">${kidName(a)}${icon.down}</button>`;
  }
  const kidPop = () => kidList.length > 1 ? `<div class="kidpop" id="kidpop" popover aria-labelledby="kidpop-h"><p class="kidpop__h" id="kidpop-h">切換孩子</p><div class="kidpop__list"></div></div>` : '';
  function kidBind() {
    // 示範「重新讀取」成功：拿掉 hash 裡的 kids-failed 重載（產品沒有重試鈕，見檔頭）
    document.addEventListener('click', (e) => {
      if (!e.target.closest('[data-kid-retry]')) return;
      history.replaceState(null, '', location.pathname + location.hash.replace(/&?kids-failed/, ''));
      location.reload();
    });
    const pop = document.getElementById('kidpop');
    if (!pop) return;
    const fill = () => { pop.querySelector('.kidpop__list').innerHTML = kidList.filter((k) => k !== kids.active).map((k) => `<button class="kidpop__item" type="button" data-kid="${k.id}">${kidName(k)}</button>`).join(''); };
    fill();
    pop.addEventListener('toggle', (e) => {
      if (e.newState !== 'open' || matchMedia('(max-width: 860px)').matches) return;
      const r = document.querySelector('[popovertarget="kidpop"]').getBoundingClientRect();
      Object.assign(pop.style, { position: 'fixed', left: Math.max(16, Math.min(r.left, innerWidth - pop.offsetWidth - 16)) + 'px', top: r.bottom + 8 + 'px' });
    });
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-kid]');
      if (!b) return;
      kidStore(b.dataset.kid);
      pop.hidePopover();
      if (!kidOn) { location.reload(); return; }
      document.querySelector('.kid--btn').outerHTML = kidBadge();
      fill();
      kidOn(kids.active);
      toast(`正在看 ${kids.active.name} 的資料`);
    });
  }

  /* ── #990 批 6：公開頁外框（產品 features/public/public-shell.component.*，照現狀搬）──────────
   * 橘色品牌面（桌機在左 40%、≤1024px 在上）＋白色主面。品牌面：字標（連到登入）、學程管家／讓學習旅程更輕鬆、
   * 貼底四條輕量連結（登入、試聽申請、我要報名、QR 到班打卡 —— 產品從 RoutesCatalog 生成：沒有角色且 showInMenu）、版權。
   * 選角色與綁 LINE 不在那排連結裡（showInMenu false），但同一個外框。檔名 pub-*.html（p- 已經是家長端）。
   * 用法：A2.pub({ page: 'pub-login' }, mainHtml)。toast／form／act 等零件照常可用。 */
  const PUB = [['pub-login', '登入'], ['pub-trial', '試聽申請'], ['pub-enrollment', '我要報名'], ['pub-qr-checkin', 'QR 到班打卡']];
  // 手機（≤1024）＝橫向兩面（10/03 使用者自己提的方向，取代 B）：左面＝橘色流場面（全強度、字標、入口選項），
  // 右面＝白色面（表單）。第一屏只看到左面；點左面的選項整個畫面左移露出右面，右面頂部「返回」移回來。
  // 等於把桌機 40/60 搬到手機、一次只看一面。桌機完全不動（.ps__go／.ps__bar 只在這個斷點出現）。
  // 左面：字標、tagline、底部一列純文字入口（10/03 使用者挑 A：近黑字、本頁底線）；點「本頁」那條進右面（不要「回到表單」的捷徑鈕）。
  // 登入頁例外：點「登入」跳底部面板，LINE 鍵在面板裡，關掉回左面（10/03 使用者裁）。選擇身分一進頁就在右面（彈窗本來就關不掉）。
  // 選擇身分、綁定 LINE 不在四條入口裡，手機上多一條本頁連結，否則從左面回不到它。
  const PUB_GO = {
    'pub-login': { name: '登入', sheet: '.login__line-btn', wrap: 'login' }, // wrap：LINE 品牌色變數定義在 .login 上
    'pub-select-role': { name: '選擇身分', right: true },
    'pub-link-line': { name: '綁定 LINE' },
    'pub-qr-checkin': { name: 'QR 到班打卡' },
    'pub-trial': { name: '試聽申請' },
    'pub-enrollment': { name: '我要報名' },
  };
  function pub(o, mainHtml) {
    document.body.classList.add('is-pub');
    const mobile = matchMedia('(max-width: 1024px)').matches;
    const go = PUB_GO[o.page] || { name: '' };
    // 手機：別頁的連結帶 #form 直接落在那頁的右面（使用者在左面選了它，就是要填它）；本頁的連結改成「移到右面」
    const href = (k) => `${k}.html${mobile && k !== o.page ? '#form' : ''}`;
    document.getElementById('app').innerHTML = `
      <section class="ps">
        <aside class="ps__brand">
          <canvas class="ps__field" aria-hidden="true"></canvas>
          <div class="ps__content">
            <a class="ps__logo" href="pub-login.html"${o.page === 'pub-login' ? ' aria-current="page"' : ''}>Clessia</a>
            <h2 class="ps__tagline">學程管家</h2>
            <p class="ps__slogan">讓學習旅程更輕鬆</p>
          </div>
          <div class="ps__go"></div>
          <nav class="ps__links" aria-label="公開頁">${mobile && !PUB.some(([k]) => k === o.page) ? `<a class="ps__link" href="#form" aria-current="page" data-ps-right>${go.name}</a>` : ''}${PUB.map(([k, l]) => `<a class="ps__link" href="${href(k)}"${k === o.page ? ` aria-current="page" ${go.sheet && mobile ? 'data-ps-sheet' : 'data-ps-right'}` : ''}>${l}</a>`).join('')}</nav>
          <p class="ps__copy">&copy; 2025 Clessia Academy</p>
        </aside>
        <main class="ps__main">
          <div class="ps__bar"><button class="ps__back" type="button" data-ps-left>${icon.left}返回</button><span class="ps__name">${go.name}</span></div>
          <div class="ps__route">${mainHtml}</div>
        </main>
      </section>`;

    // 手機左面：密度、線寬回桌機預設，只把彎曲放大 1.2（V42 的加密加粗被使用者說「太過大膽」，10/03）
    const flow = ClessiaFlow.mount(document.querySelector('.ps__field'), mobile ? { density: 0.8, amp: 1.2, speed: 1 } : { density: 0.8, speed: 1 });
    const typing = (el) => el && el.matches && el.matches('input, textarea, select, [contenteditable]');
    document.addEventListener('focusin', (e) => { if (typing(e.target)) flow.pause(); });
    document.addEventListener('focusout', () => setTimeout(() => { if (!typing(document.activeElement)) flow.resume(); }, 0));
    if (!mobile) return;

    // 兩面的寬度＝視窗寬（c6：不用 vw，寫進 --window-width）
    const root = document.documentElement;
    const size = () => { root.style.setProperty('--window-width', innerWidth + 'px'); root.style.setProperty('--window-height', innerHeight + 'px'); };
    size(); addEventListener('resize', size);
    const ps = document.querySelector('.ps');
    // 選擇身分：彈窗必選、關不掉，遮罩會蓋住返回列 —— 看得到按不到的「返回」是死路，所以這頁不顯示返回列
    if (go.right) ps.classList.add('ps--locked');
    const show = (right) => { ps.classList.toggle('is-right', right); document.querySelector('.ps__brand').inert = right; document.querySelector('.ps__main').inert = !right; };
    // 有 hash（#form、#waitlist、#error 之類的深連結）就直接落在右面
    show(!!go.right || location.hash.length > 1);
    // 登入頁：點「登入」跳底部面板（全站 .xp：手機深灰底部面板、既有進出場），LINE 鍵在面板裡，點了等同按右面那顆（同一個處理流程）
    if (go.sheet) {
      const src = document.querySelector('.ps__main ' + go.sheet);
      const sh = Object.assign(document.createElement('div'), { className: 'xp ps-sheet', id: 'ps-sheet' });
      sh.popover = 'auto'; sh.setAttribute('aria-labelledby', 'ps-sheet-h');
      sh.innerHTML = `<div class="xp__head"><h2 class="xp__h" id="ps-sheet-h">登入</h2><button class="xp__x" type="button" popovertarget="ps-sheet" popovertargetaction="hide" aria-label="關閉">${icon.x}</button></div><div class="xp__body"><p class="ps-sheet__sub">用 LINE 登入，不需要記密碼。</p></div>`;
      if (src) { const c = src.cloneNode(true); c.removeAttribute('id'); c.style.marginTop = '0'; c.addEventListener('click', () => { sh.hidePopover(); src.click(); });
        const w = Object.assign(document.createElement('div'), { className: go.wrap || '' }); w.append(c); sh.querySelector('.xp__body').append(w); }
      document.body.append(sh);
    }
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-ps-sheet]')) { e.preventDefault(); document.getElementById('ps-sheet').showPopover(); }
      else if (e.target.closest('[data-ps-right]')) { e.preventDefault(); history.pushState({ ps: 1 }, '', location.pathname + '#form'); show(true); }
      else if (e.target.closest('[data-ps-left]')) {
        // 是自己推進來的就 history.back（瀏覽器返回鍵也走同一條）；深連結進來的就換掉網址、移回左面
        if (history.state && history.state.ps) history.back();
        else { history.replaceState(null, '', location.pathname); show(false); }
      }
    });
    addEventListener('popstate', () => show(!!go.right || location.hash.length > 1));
  }

  window.A2 = { pub, kids, fold, C, icon, shell, md, wd, days, money, phone, toMin, dateOf, todayOf, STATE, todayMeta, toast, act, form, forms, esc };
})();
