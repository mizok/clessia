/*
 * 設計稿外框：右下角導覽膠囊（在同一方向的四頁之間切換、回索引）＋設計說明抽屜。
 * 頁面宣告：<body data-direction="a"> 與 <template id="notes">…</template>
 * 說明抽屜內容寫在各頁的 <template id="notes">，方向通用的說明可放 ../<dir>/notes.html 不必要 —— 一頁一份就好。
 */
(function () {
  const DIRS = {
    a: { tag: 'A 雙面', pages: [['dashboard.html', '儀表板'], ['students.html', '學生'], ['student.html', '學生檔案'], ['schedule.html', '課表'], ['billing.html', '帳單']] },
    b: { tag: 'B 時間流', pages: [['dashboard.html', '儀表板'], ['students.html', '學生'], ['student.html', '學生檔案'], ['schedule.html', '課表'], ['billing.html', '帳單']] },
    // #990：頁數一路長到 47，膠囊不再列滿 —— 改成 上一頁／目前頁 ▾（彈出分組清單）／下一頁。只列已經做好的頁。
    a6: { tag: 'A6', groups: [
      ['管理端', [['dashboard.html', '儀表板'], ['students.html', '學生'], ['student.html', '學生檔案'], ['schedule.html', '課表'], ['billing.html', '帳單'],
        ['leave.html', '學生請假管理'], ['parents.html', '家長管理'], ['courses.html', '課程管理'], ['class.html', '班級詳情'], ['changes.html', '課務異動'], ['contact-book.html', '聯絡簿'],
        ['exams.html', '考試管理'], ['scores.html', '成績登錄'], ['grades.html', '成績總覽'], ['grades-student.html', '成績總覽：學生'], ['grades-class.html', '成績總覽：班級'],
        ['enrollments.html', '報名進出'], ['notifications.html', '通知中心'],
        ['fee-templates.html', '費用方案管理'], ['meals.html', '餐費管理'], ['reports.html', '營收報表'], ['staff.html', '人員管理'], ['settings.html', '系統設定']]],
      ['老師端', [['t-schedule.html', '課表'], ['t-students.html', '學生'], ['t-notifications.html', '通知']]],
      ['家長端', [['p-dashboard.html', '首頁'], ['p-attendance.html', '到班'], ['p-grades.html', '成績'], ['p-payments.html', '繳費'],
        ['p-schedule.html', '課表查看'], ['p-meals.html', '餐費紀錄'], ['p-enrollment.html', '報名申請'], ['p-trial.html', '試聽申請'],
        ['p-add-course.html', '加選課程'], ['p-renewal.html', '續課資訊'], ['p-notifications.html', '通知中心']]],
      ['公開頁', [['pub-login.html', '登入'], ['pub-select-role.html', '選擇身分'], ['pub-link-line.html', '綁定 LINE'],
        ['pub-qr-checkin.html', 'QR 到班打卡'], ['pub-trial.html', '試聽申請（訪客）'], ['pub-enrollment.html', '我要報名（訪客）']]],
      ['零件', [['kit.html', '共用零件']]],
    ] },
    a5: { tag: 'A5 第五輪', pages: [['dashboard.html', '儀表板'], ['students.html', '學生'], ['student.html', '學生檔案'], ['schedule.html', '課表'], ['billing.html', '帳單']] },
    a4: { tag: 'A4 第四輪', pages: [['dashboard.html', '儀表板'], ['students.html', '學生'], ['student.html', '學生檔案'], ['schedule.html', '課表'], ['billing.html', '帳單']] },
    a3: { tag: 'A3 排版・第三輪', pages: [['dashboard.html', '儀表板'], ['students.html', '學生'], ['student.html', '學生檔案'], ['schedule.html', '課表'], ['billing.html', '帳單']] },
    a2: { tag: 'A2 排版', pages: [['dashboard.html', '儀表板'], ['students.html', '學生'], ['student.html', '學生檔案'], ['schedule.html', '課表'], ['billing.html', '帳單']] },
    c2: { tag: 'C2 就地展開', pages: [['dashboard.html', '儀表板'], ['students.html', '學生'], ['student.html', '學生檔案'], ['schedule.html', '課表'], ['billing.html', '帳單']] },
    b2: { tag: 'B2 日到班', pages: [['dashboard.html', '儀表板'], ['students.html', '學生'], ['student.html', '學生檔案'], ['schedule.html', '課表'], ['billing.html', '帳單']] },
    c: { tag: 'C 焦點面', pages: [['dashboard.html', '儀表板'], ['students.html', '學生'], ['student.html', '學生檔案'], ['schedule.html', '課表'], ['billing.html', '帳單']] },
  };
  function build() {
    const dir = DIRS[document.body.dataset.direction];
    if (!dir) return;
    const here = location.pathname.split('/').pop();
    const pill = document.createElement('nav');
    pill.className = 'proto-pill';
    pill.setAttribute('aria-label', '設計稿導覽');
    if (dir.groups) {
      const all = dir.groups.flatMap(([, ps]) => ps);
      const i = Math.max(0, all.findIndex(([f]) => f === here));
      const prev = all[(i - 1 + all.length) % all.length], next = all[(i + 1) % all.length];
      pill.innerHTML = `<a href="../">← 索引</a><span class="proto-pill__tag">${dir.tag}</span>` +
        `<a href="${prev[0]}" aria-label="上一頁：${prev[1]}">‹</a>` +
        `<button type="button" class="proto-pill__here" popovertarget="proto-all" aria-label="全部頁面，目前：${all[i][1]}">${all[i][1]} ▾</button>` +
        `<a href="${next[0]}" aria-label="下一頁：${next[1]}">›</a>`;
      const list = document.createElement('div');
      list.id = 'proto-all'; list.className = 'proto-all'; list.popover = 'auto';
      list.innerHTML = dir.groups.map(([g, ps]) => `<div><p class="proto-all__h">${g}</p>${ps.map(([f, l]) => `<a href="${f}"${f === here ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</div>`).join('');
      list.addEventListener('toggle', (e) => {
        if (e.newState !== 'open') return;
        // 膠囊在上半部（桌機放在頁首下方）就往下展開，在下半部（手機）就往上
        const r = pill.getBoundingClientRect(), down = r.top < innerHeight / 2;
        Object.assign(list.style, { position: 'fixed', right: Math.max(16, innerWidth - r.right) + 'px', left: 'auto', margin: 0,
          top: down ? r.bottom + 8 + 'px' : 'auto', bottom: down ? 'auto' : innerHeight - r.top + 8 + 'px' });
      });
      document.body.append(list);
      pill.classList.add('proto-pill--top');
    } else pill.innerHTML =
      `<a href="../">← 索引</a><span class="proto-pill__tag">${dir.tag}</span>` +
      dir.pages.map(([f, l]) => `<a href="${f}"${f === here ? ' aria-current="page"' : ''}>${l}</a>`).join('');
    const tpl = document.getElementById('notes');
    if (tpl) {
      const dlg = document.createElement('dialog');
      dlg.className = 'proto-notes';
      dlg.innerHTML = `<button class="proto-notes__close" aria-label="關閉說明"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button><div class="proto-notes__body"></div>`;
      dlg.querySelector('.proto-notes__body').append(tpl.content.cloneNode(true));
      dlg.querySelector('button').onclick = () => dlg.close();
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
      document.body.append(dlg);
      const b = document.createElement('button');
      b.className = 'proto-pill__note';
      b.textContent = '設計說明';
      b.onclick = () => dlg.showModal();
      pill.append(b);
      if (new URLSearchParams(location.search).has('notes')) dlg.showModal();
    }
    document.body.append(pill);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
