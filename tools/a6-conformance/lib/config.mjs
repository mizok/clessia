import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '../../..');
const cache = path.join(os.homedir(), '.cache/clessia-a6-conformance');

/** A6 稿不進版控：路徑走環境變數，預設 repo 內 gitignore 掉的那份。 */
export const A6_DIR =
  process.env.A6_DIR ?? path.join(root, '.design-explorations/973-layout/a6-editorial');
export const APP_URL = process.env.A6_APP_URL ?? 'http://localhost:4200';
export const API_URL = process.env.A6_API_URL ?? 'http://localhost:8787';
export const STATE = process.env.A6_STATE ?? path.join(cache, 'state-admin.json');
export const OUT = process.env.A6_OUT ?? path.join(cache, 'out');

export const WIDTHS = [
  { tag: 'd', width: 1440 },
  { tag: 'm', width: 360 },
];

/**
 * 刻意偏離 A6 的地方（#1314 gate 10-15：每條要 key／條件＋理由＋出處，不能用「近似」帶過）。
 * 命中的差異列歸「已記錄偏離」，不算待修。欄位是 regex 字串：status（差異類別，必填）、
 * detail（差異文字）、a6／app（part key）、kind（part 種類）。頁面專屬的放 PAGES[頁].deviations。
 */
const RULES = 'kb/wiki/architecture/a6-adoption-rules.md'; // #1586

export const DEVIATIONS = [
  {
    // R3：44px 只約束基底（手機）；桌機高度跟稿不同是待修，所以只在 360 生效
    status: '尺寸',
    kind: 'control',
    widths: [360],
    detail: '^高 \\d+→(4[4-9]|[5-9]\\d)',
    reason: '可點元素基底高 ≥44px（觸控下限），只管手機',
    source: `${RULES}:32-34（R3）；kb/wiki/architecture/constitution-enforcement.md:101（A27）`,
  },
  {
    // R3 連帶：手機 44px 的可點元素用 flex 垂直置中，取代稿的上下 padding
    status: '樣式',
    kind: 'control',
    widths: [360],
    detail: '^(padding [\\d.]+px( [\\d.]+px)* → 0px；)?display (block|inline) → (inline-)?flex$',
    reason: '手機 44px 觸控高度用 flex 置中（取代稿的上下 padding）',
    source: `${RULES}:32-34（R3）`,
  },
  {
    // R7：頂欄搜尋有建議清單＝combobox（稿是 searchbox）
    status: '角色',
    a6: 'control:searchbox\\[全站搜尋\\]$',
    detail: '^control:searchbox → control:combobox$',
    reason: 'ARIA 角色依元件行為：有建議清單的搜尋是 combobox',
    source: `${RULES}:46-48（R7）`,
  },
  {
    // R7（殼層席 B2）：手機搜尋鈕名「搜尋」→「搜尋學生」，名字講清楚搜的範圍
    status: '文案',
    a6: 'landmark:banner\\[\\]>control:button\\[搜尋\\]$',
    detail: '^「搜尋」→「搜尋學生」$',
    reason: '可及名稱依元件行為：搜的範圍是學生／家長電話',
    source: `${RULES}:46-48（R7）`,
  },
  {
    status: '多',
    pop: 'more',
    app: 'control:link\\[(公開申請|到班打卡)\\]$',
    reason: '現況有、稿沒畫：收進「更多」選單，不刪',
    source: `${RULES}:24-28（R2）`,
  },
];

/**
 * 只在某些資料下才出現的 part（regex 對 A6／app 的 part key）。沒配上時歸資料差、不算缺／多。
 */
export const DATA_DEPENDENT = [
  {
    a6: '^pop\\[acct\\]>.*(text:p\\[切換身分\\]|control:button\\[(管理員|任課老師|家長)\\])',
    reason:
      '「切換身分」只在多身分帳號出現；稿的示範使用者有 3 個身分（app `otherRoles().length > 0`）',
  },
];

/** 殼層的彈出物：A6 popover id → app popover id（每頁都有）。 */
export const SHELL_POPOVERS = { more: 'shell-more', acct: 'shell-account' };

/**
 * 頁面對照：稿檔 ↔ app 路由。兩邊的原生 `[popovertarget]` 會自動逐一打開；
 * `appOpen` 放 app 端不是原生 popover 的彈出物（id 用 A6 那邊的，才配得上）；
 * `popovers` 放 A6 id → app id 的額外對照（殼層的在 SHELL_POPOVERS）；
 * `mapping` 放自動配不上的 part（A6 key → app key）。
 */
export const PAGES = {
  students: {
    a6: 'students.html',
    app: '/admin/students',
    // app 的篩選是 PrimeNG Popover（不是原生 popover）：點哪顆、內容根在哪
    appOpen: { filt: { click: 'button:has-text("篩選：")', root: '.p-popover' } },
    // 第三層：年級名單隨資料（稿是國一～小五，demo 是高一～國三）
    behaveIgnore: ['^[高國小][一二三四五六]#?$'],
    deviations: [
      {
        status: '多',
        detail: '的更多動作」',
        reason: '列尾「⋯」：現況有、稿沒畫的列動作收進「⋯」',
        source: `${RULES}:24-28（R2）`,
      },
    ],
  },
  schedule: {
    a6: 'schedule.html',
    app: '/admin/sessions',
    deviations: [
      {
        status: '多',
        app: 'control:button\\[(上一週|下一週)\\]$',
        reason: '換週箭頭：收不進「⋯」的入口，保留',
        source: `${RULES}:30（R2 例外）；#1314 comment 6163635319`,
      },
    ],
  },
  billing: {
    a6: 'billing.html',
    app: '/admin/payments',
    deviations: [
      {
        status: '多',
        app: 'control:button\\[有#筆生效中的報名還沒開過帳單\\]$',
        reason: '未開單名單：使用者 10-08 逐項裁定「留」',
        source: `${RULES}:26（R2）`,
      },
      {
        status: '多',
        app: 'control:button\\[更多動作\\]$',
        reason: '工具列「⋯」：現況有、稿沒畫的動作收進「⋯」',
        source: `${RULES}:24-28（R2）`,
      },
    ],
  },
};
