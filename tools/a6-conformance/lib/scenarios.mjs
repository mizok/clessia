// 第三層的互動情境：同一件事在兩邊各怎麼做。觸發點出自 inventory 的「互動觸發點」表（a6.js 的
// click handler）。步驟：{ click | fill: [目標, 字] | press | hover | wait }，目標是 CSS 或
// { role, name（regex）, nth }。`ignore`：這個情境裡不比的文案（regex），例如隨資料變的名單；
// `checkFocus`：要比操作後的焦點（關浮層、Esc 這類）。

const role = (r, name, nth) => ({ role: r, name, nth });

export const SCENARIOS = {
  students: [
    {
      name: '打開篩選',
      a6: [{ click: '[popovertarget="filt"]' }],
      app: [{ click: role('button', '^篩選：') }],
    },
    {
      name: '篩選：選國三',
      a6: [{ click: '[popovertarget="filt"]' }, { click: '[data-grade="J3"]' }],
      app: [{ click: role('button', '^篩選：') }, { click: role('button', '^國三') }],
    },
    {
      name: '篩選：選國三後按 Esc 關掉',
      checkFocus: true, // 關掉浮層後焦點要回到開它的那顆鈕
      a6: [
        { click: '[popovertarget="filt"]' },
        { click: '[data-grade="J3"]' },
        { press: 'Escape' },
      ],
      app: [
        { click: role('button', '^篩選：') },
        { click: role('button', '^國三') },
        { press: 'Escape' },
      ],
    },
    {
      name: '搜尋查無結果',
      a6: [{ fill: ['.tsearch input', 'zzzz'], settle: 800 }],
      app: [{ fill: [role('textbox', '搜尋學生'), 'zzzz'], settle: 1200 }],
      // 名單整個消失是兩邊都會有的資料變化，不比
      ignore: ['^\\{名\\}', '^#$'],
    },
  ],
  schedule: [
    {
      name: '切到週檢視',
      a6: [{ click: '[data-view="week"]' }],
      app: [{ click: role('button', '^週$') }],
      // 週格裡的班名、老師名、停課原因都是資料
      ignore: ['班', '^\\{名\\}', '^[\\u4e00-\\u9fff]{2,3}$', '^勾', '停課·', '^到#'],
    },
    {
      name: '點週二',
      a6: [{ click: role('button', '^週二') }],
      app: [{ click: role('button', '^週二') }],
    },
    {
      name: '快速選取',
      a6: [{ click: role('button', '^快速選取') }],
      app: [{ click: role('button', '^快速選取') }],
    },
  ],
  billing: [
    {
      name: '打開匯出',
      a6: [{ click: '[popovertarget="bexp"]' }],
      app: [{ click: role('button', '^匯出$') }],
    },
    {
      name: '展開第一個到期分組',
      a6: [{ click: 'details.coll > summary' }],
      app: [{ click: role('button', '天內到期') }],
    },
    {
      name: '搜尋查無結果',
      a6: [{ fill: ['.tsearch input', 'zzzz'], settle: 800 }],
      app: [{ fill: [role('textbox', '搜尋帳單'), 'zzzz'], settle: 1200 }],
      ignore: ['^\\{名\\}', '^#$'],
    },
  ],
};
