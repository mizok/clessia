import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../../..');
const cache = path.join(os.homedir(), '.cache/clessia-a6-conformance');

/** A6 稿不進版控：路徑走環境變數，預設 repo 內 gitignore 掉的那份。 */
export const A6_DIR =
  process.env.A6_DIR ?? path.join(root, '.design-explorations/973-layout/a6-editorial');
export const APP_URL = process.env.A6_APP_URL ?? 'http://localhost:4200';
export const API_URL = process.env.A6_API_URL ?? 'http://localhost:8787';
export const STATE = process.env.A6_STATE ?? path.join(cache, 'state-admin.json');
export const OUT = process.env.A6_OUT ?? path.join(cache, 'out');

/**
 * 家長頁的登入態：**多孩子的家長**（seed 的 parent03，3 個孩子）。單孩子帳號量不到「孩子 >1 才出現」的
 * 東西 —— 切換孩子鈕、切換清單，#1932 就是這樣藏了一陣子（計畫席 10-23）。檔名刻意不是 state-parent.json：
 * 沒產生過這份的人跑工具會直接報錯，不會拿舊的單孩子登入態量出一份看似正常的結果。產生方式見 README。
 */
const PARENT_STATE = path.join(cache, 'state-parent03.json');
/**
 * parent03 預設選中的是第一個孩子（張品妍），她沒有帳單、沒有餐費 → 繳費、餐費頁只剩空狀態，量不到列。
 * 量之前切到張宇軒（26 張帳單、6 筆餐費）。切換鈕兩種寫法都認（#1932 前是 `__badge--interactive`）。
 */
const PARENT_PREP = {
  app: [
    { click: '.child-switcher__badge--interactive, button.child-switcher', settle: 500 },
    { click: '.child-switcher__list-item:has-text("張宇軒")', settle: 2000 },
  ],
};

export const WIDTHS = [
  // height：黏住的行為檢查用的視窗高（其餘量測把視窗撐到內容全高，不捲）
  { tag: 'd', width: 1440, height: 900 },
  { tag: 'm', width: 360, height: 780 },
];

/**
 * 刻意偏離 A6 的地方（#1314 gate 10-15：每條要 key／條件＋理由＋出處，不能用「近似」帶過）。
 * 命中的差異列歸「已記錄偏離」，不算待修。欄位是 regex 字串：status（差異類別，必填）、
 * detail（差異文字）、a6／app（part key）、kind（part 種類）。頁面專屬的放 PAGES[頁].deviations。
 * `whole: true`：缺／多的整塊搬走（例：表單整個進彈窗），裡面的子 part 跟著歸偏離；不標的話子 part
 * 拆出來各自算（R7 包裝層那種：包裝是偏離、裡面真的多出來的東西照算）。
 */
/**
 * 硬性規則（constitution-enforcement.md 的 A 條）當偏離出處：條號手寫、行號執行時查，不會漂。
 * 查不到那一條就直接報錯（條文被改名或刪掉時，偏離也該重審）。
 */
const ENFORCEMENT = 'kb/wiki/architecture/constitution-enforcement.md';
export function hardRule(id) {
  const lines = fs.readFileSync(path.join(root, ENFORCEMENT), 'utf8').split('\n');
  const n = lines.findIndex((l) => l.startsWith(`| ${id} `));
  if (n < 0) throw new Error(`${ENFORCEMENT} 找不到 ${id}`);
  return `${ENFORCEMENT}:${n + 1}（${id}）`;
}

const RULES = 'kb/wiki/architecture/a6-adoption-rules.md'; // #1586
/**
 * A6 採用規則（R 條）當偏離出處：跟 hardRule 一樣行號執行時查（手抄的 :46-48 在規則檔長大後全漂了，#1639）。
 * 讀 origin/main 的版本 —— 規則以 main 為準，工具分支上的副本可能是舊的或根本沒有。
 */
let rulesLines;
export function rule(id, note = '') {
  rulesLines ??= execFileSync('git', ['show', `origin/main:${RULES}`], {
    cwd: root,
    encoding: 'utf8',
  }).split('\n');
  const n = rulesLines.findIndex((l) => l.startsWith(`## ${id} `));
  if (n < 0) throw new Error(`${RULES}（origin/main）找不到 ${id}`);
  return `${RULES}:${n + 1}（${id}${note}）`;
}

export const DEVIATIONS = [
  {
    // 家長頁量的是 parent03 → 張宇軒（國二）；稿的示範孩子是國三。年級不在人名樣板裡
    status: '文案',
    a6: 'control:button\\[目前看的是\\{名\\}，切換孩子\\]>text:span\\[[^\\]]*\\]$',
    detail:
      '^「(小[一二三四五六]|國[一二三]|高[一二三])」→「(小[一二三四五六]|國[一二三]|高[一二三])」$',
    reason: '資料：孩子的年級（稿國三、量測的張宇軒國二）',
    source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968`,
  },
  // R5 2026-10-22（#1866）：帳戶鈕只留頭像，手機桌機一致 —— 稿桌機畫「{名} · 身分」＋箭頭。
  // 名字與身分在帳戶選單頂端、頭像鈕的 aria-label 也有。鈕本身因此變窄，位置／尺寸／樣式連帶不同
  ...['缺', '樣式'].map((status) => ({
    status,
    a6: '>control:button\\[帳戶：[^\\]]*\\]>text:span\\[[^\\]]*\\]$',
    reason: '帳戶鈕只留頭像：名字與身分移到帳戶選單頂端',
    source: `${rule('R5')}「手機頂欄一列」2026-10-22；#1866`,
  })),
  ...['位置', '尺寸', '樣式'].map((status) => ({
    status,
    a6: '^>landmark:banner\\[\\]>control:button\\[帳戶：[^\\]]*\\]$',
    reason: '帳戶鈕只留頭像：鈕變窄，位置與樣式連帶不同',
    source: `${rule('R5')}「手機頂欄一列」2026-10-22；#1866`,
  })),
  // 同一條：Logo 22 → 20px（頂欄一列放得下），寬度跟著窄
  {
    status: '尺寸',
    a6: '^>landmark:banner\\[\\]>control:link\\[Clessia\\]$',
    detail: '^寬 \\d+→\\d+$',
    reason: 'Logo 22 → 20px：頂欄一列放得下',
    source: `${rule('R5')}「手機頂欄一列」2026-10-22；#1866`,
  },
  {
    status: '樣式',
    a6: '^>landmark:banner\\[\\]>control:link\\[Clessia\\]$',
    detail: '^fontSize 22px → 20px；lineHeight 22px → 20px(；display block → flex)?$',
    reason: 'Logo 22 → 20px：頂欄一列放得下',
    source: `${rule('R5')}「手機頂欄一列」2026-10-22；#1866`,
  },
  {
    // R5 2026-10-16（#1683）：通知中心從「更多」移到頂欄鈴鐺，三個角色都有（A6 沒有）
    status: '多',
    app: '^>landmark:banner\\[\\]>control:link\\[通知[^\\]]*\\]$',
    reason: '頂欄通知鈴鐺：通知中心的入口（A6 沒有）',
    source: `${rule('R5')}「頂欄通知鈴鐺」2026-10-16；#1683`,
  },
  {
    // 同一條：通知中心從「更多」移到頂欄鈴鐺，「更多」裡不再有它
    status: '缺',
    pop: 'more',
    a6: '>landmark:popover\\[\\]>control:link\\[通知中心\\]$',
    reason: '通知中心從「更多」移到頂欄鈴鐺',
    source: `${rule('R5')}「頂欄通知鈴鐺」2026-10-16；#1683`,
  },
  // 稿的「新」標記（span.new）是設計說明，不是畫面內容（a6.js 的 ddLabel 也剔掉它）。配對時已經拿掉它比
  // （extract 的 alt，#1314 10-30），剩下的就是「新」那顆小標本身、以及只差一個「新」的文案
  {
    status: '缺',
    a6: '>text:span\\[新\\]$',
    reason: '稿的「新」標記是設計說明，不是畫面內容',
    source: '.design-explorations a6.js ddLabel（剔除 .new）',
  },
  {
    status: '文案',
    a6: '(control:[a-z]+|heading:h\\d)\\[[^\\]]*新\\](~\\d+)?$',
    detail: '^「(.+)新」→「\\1」$',
    reason: '稿的「新」標記是設計說明，拿掉之後文案相同',
    source: '.design-explorations a6.js ddLabel（剔除 .new）',
  },
  {
    // 手機頂欄一列（稿 ≤860 是兩列）：搜尋鈕跟著上移到第一列、帳戶鈕只剩頭像，位置不同
    status: '位置',
    widths: [360],
    a6: '^>landmark:banner\\[\\]>control:button\\[搜尋\\]$',
    detail: '^相對「banner」 ',
    reason: '手機頂欄一列：搜尋鈕在第一列',
    source: `${rule('R5')}「手機頂欄一列」2026-10-22；#1866`,
  },
  {
    // 同一條：老師頂欄導覽的「通知」一起拿掉（同一個功能不留兩個入口）
    status: '缺',
    a6: '>landmark:navigation\\[主要導覽\\]>control:link\\[通知\\]$',
    reason: '頂欄通知鈴鐺取代導覽的「通知」：同一個功能不留兩個入口',
    source: `${rule('R5')}「頂欄通知鈴鐺」2026-10-16；#1683`,
  },
  {
    // R5 2026-10-16（#1701）：手機「更多」改兩欄流排（分組各自往下長），不是稿的一列兩組對齊 ——
    // 管理員項目比稿多，360×640 會被切掉。分組在欄裡的位置跟稿不同是刻意的
    status: '位置',
    widths: [360],
    pop: 'more',
    detail: '^相對「popover」 ',
    reason: '手機「更多」兩欄流排：分組各自往下長，位置跟稿的整列對齊不同',
    source: `${rule('R5')}「手機「更多」選單排法與捲動」2026-10-16；#1701`,
  },
  {
    // R5 2026-10-16：公開頁入口不加「QR 到班打卡」—— 打卡改成先登入行政帳號、移到內部頁面（#1127）
    status: '缺',
    a6: 'landmark:navigation\\[公開頁\\]>control:link\\[QR到班打卡\\]$',
    reason: '公開頁入口不加 QR 到班打卡：打卡已改成要先登入、移到內部頁面',
    source: `${rule('R5')}「公開頁入口 QR 到班打卡」2026-10-16；#1636`,
  },
  {
    // 上一條的連帶（手機）：入口列少了 QR 那一行（56px），品牌面中段用 margin:auto 置中 → 學程管家／標語下移一半
    status: '位置',
    widths: [360],
    a6: 'landmark:complementary\\[\\]>(heading:h2\\[學程管家\\]|text:p\\[讓學習旅程更輕鬆\\])$',
    detail: '^相對「complementary」 Δx 0、Δy \\+(2[4-9]|3[0-2])（',
    reason: '連帶：入口列少 QR 那一行，品牌面中段置中，下移一半',
    source: `${rule('R5')}「公開頁入口 QR 到班打卡」2026-10-16；#1636`,
  },
  {
    // R3：44px 只約束基底（手機）；桌機高度跟稿不同是待修，所以只在 360 生效
    status: '尺寸',
    kind: 'control',
    widths: [360],
    detail: '^高 \\d+→(4[4-9]|[5-9]\\d)',
    reason: '可點元素基底高 ≥44px（觸控下限），只管手機',
    source: `${rule('R3')}；${hardRule('A27')}`,
  },
  {
    // 硬性規則 A28：文字對比門檻。稿的 zinc-500（#786f69）在白底對比不足，app 升到 zinc-600（#57504b）。
    // 只拆這一項（item），同一列的其他樣式差照算
    status: '樣式',
    item: '^color rgb\\(120, 111, 105\\) → rgb\\(87, 80, 75\\)$',
    reason: '文字對比門檻：zinc-500 對比不足，升 zinc-600',
    source: hardRule('A28'),
  },
  {
    // R3 連帶：手機 44px 的可點元素用 flex 垂直置中，取代稿的上下 padding
    status: '樣式',
    kind: 'control',
    widths: [360],
    detail: '^(padding [\\d.]+px( [\\d.]+px)* → 0px；)?display (block|inline) → (inline-)?flex$',
    reason: '手機 44px 觸控高度用 flex 置中（取代稿的上下 padding）',
    source: `${rule('R3')}`,
  },
  {
    // R7：頂欄搜尋有建議清單＝combobox（稿是 searchbox）
    status: '角色',
    a6: 'control:searchbox\\[全站搜尋\\]$',
    detail: '^control:searchbox → control:combobox$',
    reason: 'ARIA 角色依元件行為：有建議清單的搜尋是 combobox',
    source: `${rule('R7')}`,
  },
  {
    // R7（殼層席 B2）：手機搜尋鈕名「搜尋」→「搜尋學生」，名字講清楚搜的範圍
    status: '文案',
    a6: 'landmark:banner\\[\\]>control:button\\[搜尋\\]$',
    detail: '^「搜尋」→「搜尋學生」$',
    reason: '可及名稱依元件行為：搜的範圍是學生／家長電話',
    source: `${rule('R7')}`,
  },
  // ── 帳單 gate（#1314 comment 6182400702）起：語意結構與角色（R7，#1590 擴寫）、分頁器（R2 例外）──
  {
    // D1：列表用 ul／li（稿是 div 格線）
    status: '多',
    kind: 'list',
    reason: '語意結構依內容：列表用 ul／li，外觀照稿',
    source: `${rule('R7', '，#1590')}`,
  },
  {
    // D2：章名用 h2（稿是 div）
    status: '角色',
    detail: '^text:\\w+ → heading:h[1-6]$',
    reason: '語意結構依內容：章名用標題',
    source: `${rule('R7', '，#1590')}`,
  },
  {
    // D2：工具列外包一層 role=search landmark（稿沒有）；裡面多出來的鈕另外拆列
    status: '多',
    app: 'landmark:search\\[[^\\]]*\\]$',
    reason: '語意結構依內容：搜尋／篩選區包成 search landmark',
    source: `${rule('R7', '，#1590')}`,
  },
  {
    // D4：手機停靠列不加 role=toolbar（沒有方向鍵移動的行為就不加）
    status: '缺',
    a6: 'landmark:toolbar\\[主要動作\\]$',
    reason: '不為貼稿加沒有對應行為的角色：toolbar 要方向鍵移動，沒實作',
    source: `${rule('R7', ' 反向，#1590')}`,
  },
  {
    // D3：伺服器分頁的分頁器，收不進「⋯」
    status: '多',
    host: '^p-paginator$',
    reason: '分頁器：伺服器分頁，沒有它看不到後面的資料，收不進「⋯」',
    source: `${rule('R2', ' 例外')}；#1314 comment 6182400702`,
  },
  {
    // 列尾「⋯」：每一列的列動作（全站都是這個形，#1593 起改成全站通用）
    status: '多',
    // 兩種寫法：學生「某某 的更多動作」、帳單「更多：某某的帳單動作」
    detail: '「(更多：[^」]*|[^」]*的更多動作)」',
    reason: '列尾「⋯」：現況有、稿沒畫的列動作收進「⋯」',
    source: `${rule('R2')}`,
  },
  {
    status: '多',
    pop: 'more',
    app: 'control:link\\[(公開申請|到班打卡)\\]$',
    reason: '現況有、稿沒畫：收進「更多」選單，不刪',
    source: `${rule('R2')}`,
  },
];

/**
 * 全站項（#1591）：每頁都量到的同一組差異，報告收成每頁一條「全站」，不計入頁面待修。
 * `strip`：從樣式差裡拿掉的項目；`stripProps`＋`a6`：對符合 A6 key 的 part 拿掉這些屬性的差；
 * `rows`：整列歸全站的 part（regex 對 A6 key）。
 */
export const SITE_WIDE = [
  {
    label: '全站基底字級、字重：app 13px／500，稿 14px／400',
    issue: '#1591',
    strip: ['fontSize 14px → 13px', 'fontWeight 400 → 500', 'lineHeight 21px → 19.5px'],
  },
  {
    // D7（#1593）：頁面搜尋框的底色與框線來自全站共用 class；頂欄的全站搜尋屬殼層，不在這條
    label: '頁面搜尋框底色、框線（全站共用 class）',
    issue: '#1591',
    a6: '^(?!>landmark:banner).*control:searchbox\\[[^\\]]*\\]$',
    stripProps: [
      'backgroundColor',
      'borderTop',
      'borderRight',
      'borderBottom',
      'borderLeft',
      'borderRadius',
    ],
  },
  {
    label: 'main 範圍與盒子樣式：app 的 main 包住色面（結構範圍不同）、底色／padding／display 不同',
    issue: '#1591',
    rows: '^>landmark:main\\[\\]$',
  },
];

/**
 * 只在某些資料下才出現的 part（regex 對 A6／app 的 part key）。沒配上時歸資料差、不算缺／多。
 */
export const DATA_DEPENDENT = [
  {
    // 公開表單（#1665）：課程／開課班是資料（稿的示範課程 vs seed），稿的國文、自然組只有 1–2 項，工具認不成列
    a6: 'landmark:region\\[想(試聽的課程|報名的開課班)可以選好幾個\\]>(control:checkbox|text:span)\\[',
    reason: '公開表單的選項是資料：稿的示範課程與 seed 的開課班不同，項目少的組認不成列',
  },
  {
    app: '>text:span~2>text:span$',
    reason: '公開報名列的「剩 N 位」：說明行文案隨資料，配不上時落在錯位的 span 底下',
  },
  {
    // 選身分頁：稿的示範使用者 3 個身分（含家長）；seed 的多身分帳號最多 2 個（teacher0001＝管理員＋任課老師）
    a6: 'landmark:dialog\\[\\{名\\}，你好\\]>control:button\\[家長',
    reason: '身分數隨帳號：稿的示範使用者有 3 個身分，seed 的多身分帳號最多 2 個',
  },
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
 * `a6Open` 同上、放稿端的（稿用 JS showPopover、沒有 popovertarget 的），id 跟 app 不同時在 `popovers` 對照；
 * `popovers` 放 A6 id → app id 的額外對照（殼層的在 SHELL_POPOVERS）；
 * `mapping` 放自動配不上的 part（A6 key → app key）。
 */
/**
 * 公開試聽／報名表單共用的偏離（#1665 PR-4，兩張稿逐字是同一套 `.pf`）。
 * 年級下拉：稿的 `.dd` 是 a6.js 把 <select> 換成「一顆 button＋span」；app 用共用的 app-select-field
 * （PrimeNG p-select＋pt，#991 P1 計畫席裁定選項 A），結構是 combobox＋觸發鈕＋標籤 span，外觀用 pt 對齊。
 */
const SELECT_FIELD = 'app-select-field（p-select＋pt）對 A6 .dd：結構不同、外觀對齊';
const SELECT_FIELD_SOURCE =
  'apps/web/src/app/shared/components/select-field/select-field.component.ts（#991 P1 選項 A）';
/** 工具列的 A6 下拉（app-select-field）換掉 p-select 之後：稿的 .dd 按鈕 ↔ app 的 combobox＋PrimeNG 箭頭鈕 */
const selectFieldDeviations = (names) =>
  [
    { status: '缺', a6: `control:button\\[(${names})：[^\\]]*\\](>text:span\\[[^\\]]*\\])?$` },
    { status: '多', app: `control:combobox\\[(${names})\\]$` },
    { status: '多', app: 'control:button\\[dropdown trigger\\](~\\d+)?$' },
  ].map((d) => ({ ...d, reason: SELECT_FIELD, source: SELECT_FIELD_SOURCE }));
/**
 * 公開頁（登入、選身分、試聽、報名）的品牌面：補習班名稱當主標，Clessia 退成一行小字併「· 學程管家」
 * （稿是大字 Clessia、下面一行學程管家）。字標兩顆的文案、尺寸、樣式，以及多出來的「· 學程管家」字。
 */
const PUBLIC_BRAND_SOURCE = `${rule('R5')}「公開頁品牌面的字標與補習班名稱」2026-10-22；#1858、#1871`;
const PUBLIC_BRAND_DEVIATIONS = [
  ...['文案', '尺寸', '樣式'].map((status) => ({
    status,
    a6: '^>landmark:complementary\\[\\]>(control:link\\[Clessia\\]|heading:h2\\[學程管家\\])$',
    reason: '品牌面：補習班名稱當主標，Clessia 退成一行小字',
    source: PUBLIC_BRAND_SOURCE,
  })),
  {
    status: '多',
    app: '^>landmark:complementary\\[\\]>control:link\\[Clessia·學程管家\\]>text:span\\[·學程管家\\]$',
    reason: '品牌面：「學程管家」併進 Clessia 那一行',
    source: PUBLIC_BRAND_SOURCE,
  },
];
/**
 * 老師／家長收件匣（通知＋公告）共用的偏離。內容是 seed-demo 寫的（#1314 10-30），標題、則數是資料差；
 * 保留期限句、類型標籤是 R5 已裁的。
 */
const INBOX_DATA_SOURCE = `${rule('R5')}「收件匣與申請紀錄的量測資料」2026-10-30；#1314`;
const DAY = '>landmark:region\\[(今天|昨天|這週|更早)\\]';
const INBOX_DEVIATIONS = [
  {
    status: '文案',
    a6: '>landmark:main\\[\\]>text:p\\[通知保留#天。\\]$',
    detail: '^「通知保留#天。」→「通知保留#天，公告會一直留著。」$',
    reason: '保留期限句補「公告會一直留著」：API 只清通知，公告永久保存',
    source: `${rule('R5')}「老師／家長通知頁底部的保留期限」2026-10-22；#1661`,
  },
  {
    // 時間前面的類型標籤（公告／繳費提醒／報名…）
    status: '文案',
    a6: `${DAY}>control:button\\[[^\\]]*\\]>text:span\\[# #\\]$`,
    detail: '^「# #」→「[^」]+· # #」$',
    reason: '收件匣列的時間前面保留類型標籤',
    source: `${rule('R5')}「老師／家長收件匣列上的類型標籤與「全部標為已讀」」2026-10-22；#1683`,
  },
  // 單獨一則（不成列）的那天：標題是 seed 的內容
  ...['文案', '樣式'].map((status) => ({
    status,
    a6: `${DAY}>control:button\\[[^\\]]*\\](>text:span\\[[^\\]]*\\])?$`,
    ...(status === '樣式' ? { detail: '^fontWeight \\d+ → \\d+(；color [^；]+)?$' } : {}),
    reason: '資料：通知內容與已讀狀態是 seed 寫的（已讀未讀的字重不同）',
    source: INBOX_DATA_SOURCE,
  })),
  {
    status: '多',
    app: `${DAY}>control:button\\[[^\\]]*\\]$`,
    reason: '資料：那一天 seed 的通知比稿多一則',
    source: INBOX_DATA_SOURCE,
  },
  // 未讀數包一層 span 給數字變化的動效（稿的 strong 直接是字）：字一樣，工具拆成缺＋多
  ...[
    { status: '缺', a6: '>text:strong\\[#則未讀\\]$' },
    { status: '多', app: '>landmark:main\\[\\]>text:strong\\[則未讀\\]$' },
  ].map((d) => ({
    ...d,
    reason: '未讀數的數字包一層（數字變化：新值從下方淡入，掛在只包數字的元素上）',
    source: 'kb/wiki/architecture/motion.md:150（數字變化：套到未讀數）',
  })),
];
const PUBLIC_FORM_DEVIATIONS = [
  {
    status: '缺',
    a6: 'control:button\\[選擇：選擇年級\\]>text:span\\[選擇年級\\]$',
    reason: SELECT_FIELD,
    source: SELECT_FIELD_SOURCE,
  },
  {
    status: '角色',
    a6: 'landmark:region\\[學生資訊\\]>text:label\\[年級\\]$',
    detail: '^text:label → text:span$',
    reason: `${SELECT_FIELD}（標籤是 aria-labelledby 指到的 span）`,
    source: `${SELECT_FIELD_SOURCE}；${rule('R7')}`,
  },
  {
    status: '文案',
    a6: 'landmark:region\\[學生資訊\\]>control:button\\[選擇：選擇年級\\]$',
    app: 'control:button\\[dropdown trigger\\]$',
    reason: `${SELECT_FIELD}（稿的整顆按鈕被配到 PrimeNG 的箭頭鈕）`,
    source: SELECT_FIELD_SOURCE,
  },
  {
    status: '樣式',
    a6: 'landmark:region\\[學生資訊\\]>control:button\\[選擇：選擇年級\\]$',
    app: 'control:button\\[dropdown trigger\\]$',
    reason: `${SELECT_FIELD}（稿的整顆按鈕被配到 PrimeNG 的箭頭鈕）`,
    source: SELECT_FIELD_SOURCE,
  },
  {
    status: '多',
    app: 'landmark:region\\[學生資訊\\]>control:combobox\\[年級\\*?\\]$',
    reason: SELECT_FIELD,
    source: SELECT_FIELD_SOURCE,
  },
  {
    // 稿上的「新」是設計說明（這一列是新加的），不是畫面內容；a6.js 的 ddLabel 也把 .new 剔掉
    status: '缺',
    a6: 'text:p\\[已通過機器人驗證\\]>text:span\\[新\\]$',
    reason: '稿的「新」標記是設計說明，不是畫面內容',
    source: '.design-explorations a6.js ddLabel（剔除 .new）',
  },
  {
    // 資料：選項清單的長度隨資料（稿的示範課程 vs seed 的開課班），它下面的欄位與品牌面高度跟著移
    status: '位置',
    a6: '(landmark:region\\[想(試聽的課程|報名的開課班)可以選好幾個\\]>(text:p\\[|text:label\\[|control:textbox\\[)|landmark:complementary\\[\\]>(landmark:navigation|heading:h2|text:p))',
    // 只放過垂直位移（清單變長變短只會推上推下）；大小隨資料、不設上限。只掛試聽／報名兩頁，/login 的品牌面不吃這條
    detail: '^相對「[^」]+」 Δx 0、',
    reason: '資料：選項清單的長度與科目順序隨資料，下面的欄位、品牌面的入口列跟著移',
    source: '#1665 PR-4 conformance（10-16）',
  },
  {
    // 資料：報名列的說明行文案隨資料（稿有老師名、seed 多分校時寫分校名），配不上就變成列內 span 錯位
    status: '位置',
    a6: '>row>text:span~2$',
    reason: '資料：報名列說明行（老師暱稱、分校）隨資料，文案配不上時列內 span 錯位',
    source: '#1665 PR-4 conformance（10-16）',
  },
  {
    // 資料：報名列的說明行文案隨資料（稿有老師名、seed 多分校時寫分校名），配不上就變成列內 span 錯位
    status: '樣式',
    a6: '>row>text:span~2$',
    reason: '資料：報名列說明行（老師暱稱、分校）隨資料，文案配不上時列內 span 錯位',
    source: '#1665 PR-4 conformance（10-16）',
  },
];

/** 通知中心兩個分頁共用的分頁列（#1692）：稿的「新」標記、分頁 44px（R3） */
const NOTIFICATIONS_TABS = [
  {
    // 稿上的「新」是設計說明（這個分頁、這顆鈕是新加的），不是畫面內容；同 a6.js ddLabel 剔掉 .new
    status: '缺',
    a6: '>text:span\\[新\\]$',
    reason: '稿的「新」標記是設計說明，不是畫面內容',
    source: '.design-explorations a6.js ddLabel（剔除 .new）',
  },
  {
    status: '文案',
    a6: 'control:button\\[[^\\]]*新\\]$',
    detail: '^「(.+)新」→「\\1」$',
    reason: '稿的「新」標記是設計說明，拿掉之後文案相同',
    source: '.design-explorations a6.js ddLabel（剔除 .new）',
  },
  {
    // 稿的 .tlink 高 26（padding 2px），app 照 R3 撐到 44
    status: '尺寸',
    a6: 'landmark:navigation\\[通知\\]>control:button\\[[^\\]]*\\]$',
    detail: '^高 \\d+→44',
    reason: '可點元素的基底高度 ≥ 44px',
    source: `${rule('R3')}`,
  },
];

/**
 * 表單彈窗（#1772）：稿用 JS 開（A2.form → `dialog.fdlg`），app 是 DialogService 的 `.p-dialog`（共用 `.form-dialog`）。
 * id 兩邊同名才配得上。量動作列黏底（稿 `.fdlg__foot { position: sticky; bottom: 0 }`）與彈窗裡的 part。
 */
const formOpen = (a6Click, appClick) => ({
  a6Open: { root: 'dialog[open]', click: a6Click },
  appOpen: { root: '.p-dialog:has(.form-dialog)', click: appClick },
});
const FORM_DIALOGS = {
  courses: {
    'new-course': formOpen('[data-newc]', 'button:has-text("新增課程")'),
    'new-class': formOpen('[data-newk]', 'button:has-text("新增班")'),
  },
  staff: { 'new-staff': formOpen('[data-new]', 'button:has-text("新增人員")') },
  parents: { 'new-parent': formOpen('[data-new]', 'button:has-text("新增家長")') },
  exams: {
    'new-exam': formOpen('[data-new]', [
      'button:has-text("新增考試")',
      '[role=menuitem]:has-text("補習班")',
    ]),
  },
};
const opensOf = (page, side) =>
  Object.fromEntries(Object.entries(FORM_DIALOGS[page] ?? {}).map(([id, o]) => [id, o[side]]));

export const PAGES = {
  students: {
    a6: 'students.html',
    app: '/admin/students',
    // app 的篩選是 PrimeNG Popover（不是原生 popover）：點哪顆、內容根在哪
    appOpen: { filt: { click: 'button:has-text("篩選：")', root: '.p-popover' } },
    // 第三層：年級名單隨資料（稿是國一～小五，demo 是高一～國三）
    behaveIgnore: ['^[高國小][一二三四五六]#?$'],
  },
  schedule: {
    a6: 'schedule.html',
    app: '/admin/sessions',
    deviations: [
      {
        status: '多',
        app: 'control:button\\[(上一週|下一週)\\]$',
        reason: '換週箭頭：收不進「⋯」的入口，保留',
        source: `${rule('R2', ' 例外')}；#1314 comment 6163635319`,
      },
    ],
  },
  // 課表勾一堂之後的批次動作列（#1314 S7）：列只在勾了課才出現，手機沒有這條（在快速選取面板裡）
  'schedule-batch': {
    a6: 'schedule.html',
    app: '/admin/sessions',
    prep: {
      // 稿的勾選框 hover 課塊才出現（schedule.css:50-53）
      a6: [
        { hover: '.gb', widths: [1440] },
        { click: { role: 'checkbox', name: '^勾 ' }, settle: 500, widths: [1440] },
      ],
      app: [{ click: { role: 'checkbox', name: '^勾 ' }, settle: 800, widths: [1440] }],
    },
    deviations: [
      {
        status: '多',
        app: 'control:button\\[(上一週|下一週)\\]$',
        reason: '換週箭頭：收不進「⋯」的入口，保留',
        source: `${rule('R2', ' 例外')}；#1314 comment 6163635319`,
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
        source: `${rule('R2')}`,
      },
      {
        status: '多',
        app: 'control:button\\[更多動作\\]$',
        reason: '工具列「⋯」：現況有、稿沒畫的動作收進「⋯」',
        source: `${rule('R2')}`,
      },
    ],
  },
  // 以下只登稿檔 ↔ 路由（#1314 多出功能盤點，10-15）；偏離與情境之後各頁對齊時再補。
  // 詳情頁的 id 取自本機示範庫：張宇軒（資料最完整的學生）、國中數學的第一個班、展示用小考 #90
  // 入口頁（10-16 使用者：「手機版的入口頁面設計也跟 A6 不一樣」）：各自的登入態。
  // 登入頁要未登入（guestGuard 會把已登入的轉走）；選身分要多身分帳號（seed 的 teacher0001＝admin＋teacher）
  login: {
    a6: 'pub-login.html',
    app: '/login',
    state: path.join(cache, 'state-guest.json'),
    // 手機登入的底部面板：稿用 JS showPopover（<a data-ps-sheet>，不是 popovertarget），app 是原生 popover login-sheet
    a6Open: { 'ps-sheet': { click: '[data-ps-sheet]', root: '#ps-sheet' } },
    popovers: { 'ps-sheet': 'login-sheet' },
    deviations: [
      {
        // 手機點「登入」打開底部面板（popover），不是導航：角色照行為用 button（稿是 <a>）
        status: '角色',
        widths: [360],
        a6: 'landmark:navigation\\[公開頁\\]>control:link\\[登入\\]$',
        detail: '^control:link → control:button$',
        reason: 'ARIA 角色依元件行為：手機「登入」打開底部面板，是按鈕',
        source: `${rule('R7')}；#1639`,
      },
      // 手機登入改成置中彈窗（稿是貼底的底部面板）：寬 calc(100% - 32px)、四角圓角，位置置中
      ...['位置', '尺寸', '樣式'].map((status) => ({
        status,
        pop: 'ps-sheet',
        widths: [360],
        a6: '^pop\\[ps-sheet\\]>landmark:popover\\[登入\\]',
        reason: '手機登入是置中彈窗，不是貼底的底部面板',
        source: `${rule('R5')}「手機登入：置中彈窗」2026-10-23；#2031`,
      })),
      ...PUBLIC_BRAND_DEVIATIONS,
    ],
  },
  'select-role': {
    a6: 'pub-select-role.html',
    app: '/select-role',
    state: path.join(cache, 'state-multi.json'),
    deviations: PUBLIC_BRAND_DEVIATIONS,
  },
  // 公開表單（#1665 PR-4）：未登入也進得來，用訪客登入態（跟登入頁同一份）。偏離是 10-16 第一次 diff 跑出來的 key
  trial: {
    a6: 'pub-trial.html',
    app: '/trial',
    state: path.join(cache, 'state-guest.json'),
    deviations: [
      {
        // #1637 Q1：試聽稿沒有「與學生的關係」，使用者指定補上（版面照報名稿同一欄）
        status: '多',
        app: 'landmark:region\\[家長資訊\\]>(text:p\\[與學生的關係\\]|row(>control:radio)?)$',
        reason: '試聽表單補「與學生的關係」（使用者指定的 A6 偏離）',
        source: `${rule('R5')}「公開試聽表單與學生的關係」2026-10-16；#1637 Q1`,
      },
      ...PUBLIC_FORM_DEVIATIONS,
      ...PUBLIC_BRAND_DEVIATIONS,
    ],
  },
  enrollment: {
    a6: 'pub-enrollment.html',
    app: '/enrollment',
    state: path.join(cache, 'state-guest.json'),
    deviations: [...PUBLIC_FORM_DEVIATIONS, ...PUBLIC_BRAND_DEVIATIONS],
  },
  student: {
    a6: 'student.html',
    app: '/admin/students/e98f234f-b706-4209-8478-b2e5fda043ee',
    deviations: [
      {
        // 色面上方「學生名冊」返回連結手機 44 高（稿 20），下面的標題、副行、統計整組往下。
        // 標題行高對齊稿（#1925：手機 1.2）之前，標題比稿矮 8.8px 剛好抵掉一部分，統計才沒被量出來
        status: '位置',
        widths: [360],
        a6: 'landmark:region\\[這一頁的摘要\\]>text:(dt|dd)(\\[[^\\]]*\\])?(~\\d)?$',
        detail: '^相對「這一頁的摘要」 Δx 0、Δy \\+\\d+（',
        reason: '連帶：返回連結手機 44px（觸控下限），色面裡下面的內容整組往下',
        source: `${rule('R3')}；#1925`,
      },
    ],
  },
  parents: {
    a6: 'parents.html',
    app: '/admin/parents',
    a6Open: opensOf('parents', 'a6Open'),
    appOpen: opensOf('parents', 'appOpen'),
  },
  courses: {
    a6: 'courses.html',
    app: '/admin/courses',
    a6Open: opensOf('courses', 'a6Open'),
    appOpen: opensOf('courses', 'appOpen'),
    deviations: [
      // 頁面搜尋框：框畫在 input 上，稿畫在外層 label.tsearch —— 同 grades-class #1762 那條
      ...['尺寸', '樣式', '位置'].map((status) => ({
        status,
        a6: 'control:searchbox\\[搜尋課程\\]$',
        reason: '頁面搜尋框的框畫在 input 上（全站同款），稿畫在外層 label',
        source: '全站共用 .clessia-filter-search（p-iconfield）；高度 #1903（使用者 10-23 裁定）',
      })),      {
        // 批次選取（#1226 courses C1 Q3 照留）：現況有、稿沒畫，收進工具列「⋯」—— 同帳單那條
        status: '多',
        app: 'control:button\\[更多動作\\]$',
        reason: '工具列「⋯」：現況有、稿沒畫的動作收進「⋯」',
        source: `${rule('R2')}；#1226`,
      },      {
        // 課程列：稿是 <details><summary>，summary 裡包「新增班」「⋯」按鈕（summary 是按鈕角色，裡面不能再放按鈕）；
        // app 是展開鈕＋並排的動作鈕，每門課一個 region（計畫席 10-30 #2078 同意）。結構不同，課程列裡的子項配不上，一起歸這條
        status: '多',
        app: '>landmark:main\\[\\]>landmark:region\\[[^\\]]*\\]>landmark:region\\[[^\\]]*\\](>.*)?$',
        reason: '課程列結構依元件行為：展開鈕＋並排動作鈕，不把按鈕包進 summary',
        source: `${rule('R7')}；https://github.com/mizok/clessia/pull/2078`,
      },
    ],
  },
  class: {
    a6: 'class.html',
    app: '/admin/courses/dc2f0b1a-7e79-4b6e-a61e-8bbac3eec5a6/classes/1deffd57-e069-4d72-98bf-41415ec01967',
  },
  dashboard: {
    a6: 'dashboard.html',
    app: '/admin/dashboard',
    // 稿的今天（shared/data.js：2026-10-01 17:40，週四），同 p-schedule（#1314 10-30）
    clock: '2026-10-01T17:40:00+08:00',
  },
  enrollments: { a6: 'enrollments.html', app: '/admin/enrollments' },
  leave: { a6: 'leave.html', app: '/admin/leave' },
  // 家長端報名申請（#1727 ③）：家長登入態；預設分頁「新增申請」，申請紀錄是 p-enrollment-records
  'p-enrollment': {
    a6: 'p-enrollment.html',
    app: '/parent/enrollment',
    state: PARENT_STATE,
  },
  // 「申請紀錄」分頁：稿與 app 都認網址 #records
  'p-enrollment-records': {
    a6: 'p-enrollment.html#records',
    // 稿的每筆紀錄是一顆獨立的按鈕（button.rq），沒有清單結構；指名成列才跟 app 的清單配得上（#1314 10-30）
    rowSel: { a6: 'button.rq' },
    app: '/parent/enrollment#records',
    state: PARENT_STATE,
    deviations: [
      {
        // parent03 沒送過申請 → 紀錄分頁是空狀態句
        status: '多',
        app: '>landmark:main\\[\\]>text:p\\[還沒有送過報名申請。\\]$',
        reason: '資料：量測的家長沒送過申請',
        source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968`,
      },
    ],
  },
  // 家長端試聽申請（#1727 ④）：一門課一列（稿一列一班，R5 2026-10-19）
  'p-trial': {
    a6: 'p-trial.html',
    app: '/parent/trial',
    state: PARENT_STATE,
    deviations: [
      {
        // 色面第二句「另外還有 N 筆試聽…」只在有試聽紀錄時出現
        status: '缺',
        a6: '>landmark:region\\[這一頁的摘要\\]>text:p\\[另外還有#筆試聽已排好、#筆在等安排。\\]$',
        reason: '資料：量測的家長沒有試聽紀錄',
        source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968`,
      },
      {
        // 試聽一門課一列（不是一班一列），所以說明寫「課」
        status: '文案',
        detail: '^「孩子已經在上的班不會出現在這裡。」→「孩子已經在上的課不會出現在這裡。」$',
        reason: '試聽是一門課一列，說明跟著寫「課」',
        source: `${rule('R5')}「家長試聽申請的選課列」2026-10-19；#1727`,
      },
    ],
  },
  'p-trial-records': {
    a6: 'p-trial.html#records',
    // 稿的每筆紀錄是一顆獨立的按鈕（button.rq），沒有清單結構；指名成列才跟 app 的清單配得上（#1314 10-30）
    rowSel: { a6: 'button.rq' },
    app: '/parent/trial#records',
    state: PARENT_STATE,
    deviations: [
      {
        // parent03 沒送過申請 → 紀錄分頁是空狀態句
        status: '多',
        app: '>landmark:main\\[\\]>text:p\\[還沒有送過試聽申請。\\]$',
        reason: '資料：量測的家長沒送過申請',
        source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968`,
      },
      {
        // 色面第二句「另外還有 N 筆試聽…」只在有試聽紀錄時出現
        status: '缺',
        a6: '>landmark:region\\[這一頁的摘要\\]>text:p\\[另外還有#筆試聽已排好、#筆在等安排。\\]$',
        reason: '資料：量測的家長沒有試聽紀錄',
        source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968`,
      },
    ],
  },
  // 家長端加選課程（#1727 ⑤）：卡片點開是 JS 打開的 <dialog>（稿 sheet()、app 原生 showModal）
  'p-add-course': {
    a6: 'p-add-course.html',
    app: '/parent/add-course',
    state: PARENT_STATE,
    prep: PARENT_PREP,
    // 篩選換成 A6 下拉（app-select-field），結構不同、外觀對齊 —— 同 p-grades
    deviations: selectFieldDeviations('科目|星期'),
  },
  // 家長端續課資訊（計畫席 10-22）：只量「沒有即將到來的續課」那一態 —— 本機 seed 沒有未來的繳費期，
  // app 只畫得出這一態；稿的有續課那一態要有下期資料才量得了（偏離見 R5 2026-10-22）
  'p-renewal-none': {
    a6: 'p-renewal.html#none',
    app: '/parent/renewal',
    state: PARENT_STATE,
    deviations: [
      {
        status: '缺',
        a6: 'text:p\\[下次預計開單日期#\\]$',
        reason: '不寫下次預計開單日期：系統沒有自動開單，給不出日期',
        source: `${rule('R5', ' 2026-10-22 家長續課頁的自動開單日與「申請異動」')}；計畫席 10-22`,
      },
      {
        status: '文案',
        a6: 'text:p\\[目前沒有即將到來的續課。下次預計在#開單',
        reason: '空狀態不寫開單日；孩子有月繳的在讀班時改寫「月繳的課每月照常開單，不列在這裡。」',
        source: `${rule('R5', ' 2026-10-22 家長續課頁的字')}；計畫席 10-22`,
      },
    ],
  },
  // 家長端到班紀錄（#1695 第 3 張）：家長登入態；「幫孩子請假」兩邊都是 JS 打開的 <dialog>（稿 a6.js form()、app 原生 showModal）
  'p-attendance': {
    a6: 'p-attendance.html',
    app: '/parent/attendance',
    state: PARENT_STATE,
    prep: PARENT_PREP,
    a6Open: { leave: { click: '#leave', root: 'dialog.fdlg' } },
    appOpen: { leave: { click: 'button:has-text("幫孩子請假")', root: 'dialog[open]' } },
  },
  // 系統設定「一般」分頁（殼照 A6，#1755 計畫席另開）：稿預設落在一般，app /admin/settings 也是
  settings: { a6: 'settings.html', app: '/admin/settings/general' },
  // 系統設定的學校分頁（#1314 SE4）
  schools: { a6: 'settings.html#schools', app: '/admin/settings/schools' },
  // 系統設定的科目分頁（#1314 SE5）
  subjects: { a6: 'settings.html#subjects', app: '/admin/settings/subjects' },
  // 系統設定的分校分頁（#1314 SE 插單）：稿與 app 都認 hash／子路由
  campuses: {
    a6: 'settings.html#campuses',
    app: '/admin/settings/campuses',
    // 教室對話框（SE3）：第一列的 ⋮ › 教室
    a6Open: {
      rooms: { click: ['[data-cm]', '#cm [data-rooms]'], root: 'dialog.fdlg' },
      'campus-form': { click: '[data-new-campus]', root: 'dialog.fdlg' },
    },
    appOpen: {
      rooms: {
        click: [
          '[data-campus] button[aria-label$="的更多動作"]',
          '.popup-menu__item-wrapper button:has-text("教室")',
        ],
        root: 'dialog[open]',
      },
      'campus-form': { click: 'button:has-text("新增分校")', root: 'dialog[open]' },
    },
    deviations: [
      ...[
        { status: '位置', detail: '^相對' },
        { status: '樣式', detail: 'display' },
      ].map((d) => ({
        // 教室對話框：稿的容納人數用了 money 欄型，前面多一個「NT$」，輸入框被推右、變 block
        pop: 'rooms',
        a6: 'control:textbox\\[容納人數\\]$',
        ...d,
        reason: '稿誤用 money 欄型（容量不是金額），手機上還會擠出畫面',
        source: '計畫席 10-21 裁定（#1785）',
      })),
      {
        // 稿上的「新」是設計說明（教室數、⋮ 的教室是新加的），不是畫面內容；同 a6.js ddLabel 剔掉 .new
        status: '缺',
        a6: '>text:span\\[新\\]$',
        reason: '稿的「新」標記是設計說明，不是畫面內容',
        source: '.design-explorations a6.js ddLabel（剔除 .new）',
      },
      {
        // 稿的「操作紀錄」只在桌機（only-d）；手機收進頁首「⋯」，不刪（計畫席 10-21 裁）
        status: '多',
        widths: [360],
        app: 'control:button\\[分校的更多動作\\]$',
        reason: '手機的操作紀錄：稿沒畫，收進頁首「⋯」',
        source: `${rule('R2')}；#1755 計畫席 10-21`,
      },
    ],
  },
  staff: {
    a6: 'staff.html',
    app: '/admin/staff',
    a6Open: opensOf('staff', 'a6Open'),
    appOpen: opensOf('staff', 'appOpen'),
  },
  'fee-templates': { a6: 'fee-templates.html', app: '/admin/fee-templates' },
  notifications: {
    // 預設分頁「收到的」（#1692 起 app 也有）；「發布公告」是 notifications-publish
    a6: 'notifications.html',
    app: '/admin/notifications',
    // 稿的按鈕名帶「新」標記（全部標為已讀新），整串文案對不上，自動配對配不起來
    mapping: {
      '>control:button[全部標為已讀新]': '>landmark:main[]>control:button[全部標為已讀]',
    },
    deviations: NOTIFICATIONS_TABS,
  },
  'notifications-publish': {
    // 「發布公告」分頁：稿與 app 都認網址 #publish
    a6: 'notifications.html#publish',
    app: '/admin/notifications#publish',
    deviations: [
      ...NOTIFICATIONS_TABS,
      {
        // #1689：發布表單改成彈窗，頁面只放已發布列表 —— 稿的頁內表單（缺）與 app 工具列的入口（多）是同一件事
        status: '缺',
        whole: true, // 整個表單搬進彈窗：裡面的列、「發布」鈕跟著歸偏離
        a6: 'landmark:main\\[\\]>landmark:form\\[\\]$',
        reason: '發布表單改成彈窗，頁面只放已發布列表（使用者指定）',
        source: `${rule('R5')}「通知中心發布表單」2026-10-16；#1689`,
      },
      {
        status: '多',
        app: 'landmark:main\\[\\]>control:button\\[發送通知\\]$',
        reason: '發布表單改成彈窗：工具列「發送通知」是它的入口',
        source: `${rule('R5')}「通知中心發布表單」2026-10-16；#1689`,
      },
    ],
  },
  meals: {
    a6: 'meals.html',
    app: '/admin/meals',
    deviations: [
      {
        status: '黏住',
        a6: 'landmark:region\\[確認名單\\]$',
        detail: '稿宣告了 sticky 但捲動時沒黏住',
        reason:
          '稿的 .savebar 被只有自己高的 div 框住、捲動時不會動（稿的 bug）；app 確認列有黏是對的，手機 offset 照 app 現狀',
        source: 'https://github.com/mizok/clessia/pull/1761#issuecomment-6309038184（計畫席裁定）',
      },
    ],
  },
  reports: { a6: 'reports.html', app: '/admin/reports' },
  'contact-book': {
    a6: 'contact-book.html',
    app: '/admin/contact-book',
    deviations: [
      // 學生篩選有建議清單（app-student-autocomplete，選了才帶 studentId 查）＝combobox；框畫在 input 上
      // （共用 p-iconfield＋.clessia-filter-search），稿畫在外層 label.tsearch —— 同 courses #1762 的那條
      {
        status: '角色',
        a6: 'control:searchbox\\[輸入學生姓名篩選\\]$',
        detail: '^control:searchbox → control:combobox$',
        reason: 'ARIA 角色依元件行為：有建議清單的搜尋是 combobox',
        source: `${rule('R7')}`,
      },
      ...['尺寸', '樣式', '位置'].map((status) => ({
        status,
        a6: 'control:searchbox\\[輸入學生姓名篩選\\]$',
        reason: '頁面搜尋框的框畫在 input 上（全站共用 p-iconfield），稿畫在外層 label',
        source: '全站共用 .clessia-filter-search（p-iconfield）；高度 #1903（使用者 10-23 裁定）',
      })),
      {
        status: '多',
        app: 'control:combobox\\[(缺漏名單的日期|期間)\\]$',
        reason: SELECT_FIELD,
        source: SELECT_FIELD_SOURCE,
      },
      {
        status: '多',
        app: 'control:button\\[dropdown trigger\\](~\\d+)?$',
        reason: SELECT_FIELD,
        source: SELECT_FIELD_SOURCE,
      },
    ],
  },
  changes: { a6: 'changes.html', app: '/admin/changes' },
  exams: {
    a6: 'exams.html',
    app: '/admin/grades/exams',
    a6Open: opensOf('exams', 'a6Open'),
    appOpen: opensOf('exams', 'appOpen'),
    deviations: [
      // 考試列的班名：稿是連到班級頁的連結（`.ex__where a`），app 是字 —— 班級頁要 courseId，列表 API 沒給（等 API）。
      // 稿的班名包在連結裡，`.ex__where` 自己沒有字、不成 part；app 的有字，後面的「# ／# 已登錄」順位跟著錯開一格
      { status: '缺', a6: '>row>control:link~2$', reason: '班名連班級頁：等 API（列表沒有 courseId）', source: '#1314 盤點 10-30「等 API」G1b：`GET /academy-exams` 的 classes[] 要帶 courseId 才連得到班級頁（`/admin/courses/:courseId/classes/:classId`）' },
      ...['缺', '多', '位置', '樣式'].map((status) => ({
        status,
        [status === '多' ? 'app' : 'a6']: '>row>text:span~[23](>text:b)?$',
        reason: '連帶：班名不是連結，列內 span 的順位錯開一格',
        source: '#1314 盤點 10-30「等 API」G1b：`GET /academy-exams` 的 classes[] 要帶 courseId 才連得到班級頁（`/admin/courses/:courseId/classes/:classId`）',
      })),
      {
        // 稿的「待處理」帶「新」設計標記（工具配對前拿掉），手機上多佔的寬度把考試型態擠到下一行
        status: '位置',
        widths: [360],
        a6: 'landmark:navigation\\[考試\\]>control:button\\[(補習班考試|學校考試)\\]$',
        reason: '連帶：稿的「新」設計標記佔寬，手機上考試型態換行；app 沒有那個標記，同一行放得下',
        source: 'tools/a6-conformance/README.md（「新」標記是設計說明，#2070）',
      },
      {
        // 手機上考試名連結撐 44（觸控下限），列的第一行變高，置中的「⋯」跟著下移
        status: '位置',
        widths: [360],
        a6: '>row>control:button$',
        reason: '連帶：手機考試名連結撐到 44px',
        source: `${rule('R3')}`,
      },
    ],
  },
  scores: {
    a6: 'scores.html',
    // seed 的考試（跟 scores-dirty 同一場）；原本的 id 是某一席本機 DB 的，seed 裡沒有（#1314 10-30）
    app: '/admin/grades/exams/academy/70000000-0000-0000-0000-000000000003/scores',
  },
  grades: { a6: 'grades.html', app: '/admin/grades/overview' },
  'grades-class': {
    a6: 'grades-class.html',
    app: '/admin/grades/overview/class',
    deviations: [
      {
        // 舊有新無：稿的章頭只有課程名＋「N 個班」，app 在章名下保留科目小字
        status: '多',
        host: '^app-chapter-head$',
        app: 'landmark:region\\[[^\\]]*\\]>text:span\\[[^\\]]*\\]$',
        reason: '章名下保留科目小字：課程名不保證含科目，照稿拿掉這頁就看不到科目',
        source:
          'kb/wiki/architecture/a6-adoption-rules.md R5（2026-10-21）；https://github.com/mizok/clessia/pull/1769#issuecomment-6310159607',
      },
      // ── #1762 收尾（10-23）：剩下的不是設計差 ──
      // 頁面搜尋框：框畫在 input 上（共用 p-iconfield＋.clessia-filter-search，全站同款），稿畫在外層
      // label.tsearch；量到的是 input，所以寬高、padding、位置都不同。高度由 #1903 全站一起定
      // （使用者 10-23 裁：工具列控制項電腦 40、手機 44），不在這頁補
      ...['尺寸', '樣式', '位置'].map((status) => ({
        status,
        a6: '^>control:searchbox\\[搜尋課程或班級\\]$',
        reason: '頁面搜尋框的框畫在 input 上（全站共用 p-iconfield），稿畫在外層 label',
        source: '全站共用 .clessia-filter-search（p-iconfield）；高度 #1903（使用者 10-23 裁定）',
      })),
      // 資料：稿的示範班都是單一年級、最近一場是「第三次小考」；seed 的班跨年級（國一～國三）、考試名不同
      {
        status: '文案',
        // 年級範圍、考試名不同；seed 的班還沒考過 →「還沒有考試」、平均「—」
        detail:
          '^(「[^」]*(第三次小考|(國[一二三]|小[五六])·)[^」]*」→「|「最近：[^」]*」→「|「#」→「—」$)',
        reason: '資料：班級年級範圍、最近一場考試（有沒有、名稱、平均）隨資料',
        source: `${rule('R5')}「成績班級視圖的資料差」2026-10-23；#1762`,
      },
      // 資料：課程順序、每門課幾個班、哪幾班有待登錄隨資料
      {
        status: '缺',
        a6: '>landmark:region\\[[^\\]]*\\]>(control:link\\[待登錄#\\]|.*text:b\\[[^\\]]*\\])$',
        reason: '資料：哪幾班有待登錄、有沒有考過隨資料',
        source: `${rule('R5')}「成績班級視圖的資料差」2026-10-23；#1762`,
      },
      {
        status: '多',
        app: '>landmark:region\\[[^\\]]*\\]>control:button\\[[^\\]]*\\]$',
        reason: '資料：每門課的班數隨資料',
        source: `${rule('R5')}「成績班級視圖的資料差」2026-10-23；#1762`,
      },
      {
        status: '位置',
        detail: '^相對上方「[^」]+」 Δx 0、Δy -\\d{3,}（',
        reason: '資料：課程順序隨資料（稿的國中數學在第一章，seed 在最後）',
        source: `${rule('R5')}「成績班級視圖的資料差」2026-10-23；#1762`,
      },
      {
        // 手機：seed 的年級範圍較長，說明行換兩行，右欄平均跟著置中往下
        status: '位置',
        widths: [360],
        app: '>control:button\\[[^\\]]*\\]>text:span\\[(#|—)\\]$',
        detail: '^相對「[^」]+」 Δx 0、Δy \\+\\d+（',
        reason: '資料：說明行換行與否隨年級範圍長度，平均跟著垂直置中',
        source: `${rule('R5')}「成績班級視圖的資料差」2026-10-23；#1762`,
      },
    ],
  },
  'grades-student': {
    a6: 'grades-student.html',
    app: '/admin/grades/overview/student',
    deviations: [
      // 同 grades-class：工具列換成全站共用的搜尋框之後（#1314 G9），量到的是 input 不是外層 label
      ...['尺寸', '樣式', '位置'].map((status) => ({
        status,
        a6: '^>control:searchbox\\[搜尋學生姓名\\]$',
        reason: '頁面搜尋框的框畫在 input 上（全站共用 p-iconfield），稿畫在外層 label',
        source: '全站共用 .clessia-filter-search（p-iconfield）；高度 #1903（使用者 10-23 裁定）',
      })),
    ],
  },
  // `prep`：量之前先在兩邊做的步驟（步驟格式同 scenarios.mjs）。週視圖與儲存列都要操作後才出現，
  // 黏住的行為檢查才量得到（A6 的 .wc__h／.cg__dh、#save）
  'schedule-week': {
    a6: 'schedule.html',
    app: '/admin/sessions',
    // 稿的今天（973-layout/shared/stress.js：2026-10-01 17:40，週四）；不對齊的話週四／週五兩欄成對地差
    clock: '2026-10-01T17:40:00+08:00',
    deviations: [
      {
        status: '多',
        app: 'control:button\\[(上一週|下一週)\\]$',
        reason: '換週箭頭：收不進「⋯」的入口，保留（同日檢視）',
        source: `${rule('R2', ' 例外')}；#1314 comment 6163635319`,
      },
      {
        status: '尺寸',
        a6: '>landmark:main\\[\\]>control:button\\[快速選取\\]$',
        detail: '^高 30→40$',
        reason: '灰帶工具列控制項全部同高：桌機 40',
        source: `${rule('R5')}「灰帶工具列控制項高度」2026-10-23；#1903`,
      },
      {
        // 連帶：app 的 main 包住色面（全站 #1591），工具列在 main 裡的位置多了色面高（1440：147、360：118）；
        // 橫向是 ‹ › 佔了位置
        status: '位置',
        a6: '>landmark:main\\[\\]>control:button\\[(週.#(今天)?|快速選取|日|週)\\]$',
        detail: '^相對「main」 Δx -?\\d+、Δy \\+(1[01]\\d|14\\d)（',
        reason: '連帶：app 的 main 包住色面，工具列在 main 裡多了色面的高度；橫向是換週箭頭佔位',
        source: `#1591（全站）；${rule('R2', ' 例外')}`,
      },
      {
        // 資料：seed 那週每天 1–2 堂、沒有異動；稿每天 14–18 堂、有異動
        status: '文案',
        a6: '>text:div\\[異動#\\]$',
        detail: '^「異動#」→「沒有異動」$',
        reason: '資料差：seed 那幾天沒有異動',
        source: '#1923（本機 seed 2026-09-28 那週）',
      },
      {
        status: '位置',
        a6: '>text:div\\[#堂·最多同時\\]>text:b\\[#\\]$',
        detail: '^相對「#堂·最多同時」 Δx -\\d、Δy 0（',
        reason: '資料差：堂數位數不同（稿 18 堂、seed 1 堂），後面的數字跟著左移',
        source: '#1923（本機 seed 2026-09-28 那週）',
      },
      {
        status: '樣式',
        a6: '>row>control:button>text:span$',
        detail: '^color rgb\\(26, 22, 20\\) → rgb\\(87, 80, 75\\)$',
        reason: '資料差：配對到的那一堂是停課（灰字＋刪除線），稿的那一堂不是',
        source: '#1923（本機 seed 10/3 停課那堂）',
      },
      {
        // 一天只有一個分組時，工具的列判斷（≥2 個同簽名容器）認不出列，整組被當成具名元件
        status: '多',
        app: '>landmark:region\\[週.#\\]>(text:div\\[開始· #堂\\](>text:b\\[#\\])?|control:button\\[[^\\]]*(：看看能做什麼|的操作)\\])$',
        reason:
          '資料差：seed 那天只有一個開始時間，工具不把單一分組認成列（稿每天十幾堂）；列的形狀在有兩組的週六欄已配對',
        source: '#1923（本機 seed）；tools/a6-conformance/lib/extract.mjs isRow',
      },
      {
        status: '缺',
        a6: '>landmark:region\\[週.#\\]>row>control:button~\\d+$',
        detail: '列內條件式',
        reason:
          '資料差：稿的部分列（10 列裡 4 列）多一顆按鈕，跟著課堂狀態出現；seed 那幾堂沒有那種狀態',
        source: '#1923（工具判定「列內條件式，可能隨資料」）',
      },
      {
        // 異動 API 用伺服器的真實日期篩「今天起」，工具的 clock 只管得到瀏覽器
        status: '缺',
        a6: '>landmark:main\\[\\]>landmark:region\\[近期異動\\](>.*)?$',
        reason: '工具限制：跑馬燈的資料由伺服器以真實日期篩選，clock 對不到稿的 10/1',
        source: '#1923；tools/a6-conformance/lib/capture.mjs clock',
      },
    ],
    prep: {
      a6: [{ click: '[data-view="week"]', settle: 800 }],
      app: [{ click: { role: 'button', name: '^週$' }, settle: 1500 }],
    },
  },
  'scores-dirty': {
    a6: 'scores.html',
    // 稿的灰帶工具列在 main 外面、鈕名帶「新」標記；app 的灰帶在殼層 main 裡（全站 main 範圍，R5 10-22），
    // 自動配對配不起來（#1925）
    mapping: {
      '>control:button[其餘標記缺考新]': '>landmark:main[]>control:button[其餘標記缺考]',
      '>control:button[加入其他學生新]': '>landmark:main[]>control:button[加入其他學生]',
      '>control:button[標記完成新]': '>landmark:main[]>control:button[標記完成]',
      '>text:p[已登錄·缺考# ·不及格（< #）位]': '>landmark:main[]>text:p[已登錄·缺考# ·不及格位]',
    },
    deviations: [
      // ── 設計說明，不是畫面 ──
      {
        status: '缺',
        a6: 'control:button\\[[^\\]]*新\\]>text:span\\[新\\]$',
        reason: '稿的「新」標記是設計說明（新功能的提示），不是畫面內容',
        source: '.design-explorations scores.html notes「批次動作」「儲存」列',
      },
      {
        status: '文案',
        a6: '^>control:button\\[[^\\]]*新\\]$',
        detail: '^「[^」]*新」→「[^」]*」$',
        reason: '稿的「新」標記是設計說明，鈕名少了「新」',
        source: '.design-explorations scores.html notes',
      },
      // ── 還沒做的 ──
      {
        status: '缺',
        a6: '^>control:button\\[匯入成績新\\]$',
        reason: '匯入成績還沒做（A6 新功能），另排',
        source: `${rule('R5')}「成績登錄」2026-10-23；#1925`,
      },
      {
        status: '位置',
        a6: '^>control:button\\[其餘標記缺考新\\]$',
        detail: '連帶自待修「control:button\\[匯入成績新\\] 缺」',
        reason: '少了匯入成績那顆，同列的鈕跟著挪位',
        source: `${rule('R5')}「成績登錄」2026-10-23；#1925`,
      },
      // ── 手機 ──
      {
        status: '多',
        widths: [360],
        app: '^>landmark:main\\[\\]>control:button\\[加入其他學生\\]$',
        reason: '舊有新無：app 手機原本就有「加入其他學生」，稿的手機沒畫',
        source: `${rule('R2')}；${rule('R5')}「成績登錄」2026-10-23`,
      },
      {
        status: '缺',
        widths: [360],
        a6: '>landmark:main\\[\\]>list(>list)?$',
        reason: '手機名單：app 點一列開底部面板改（稿是行內輸入），見本頁 prep 的註記',
        source: '#991 grades G2a；scores-dirty prep',
      },
      {
        status: '多',
        widths: [360],
        app: '^>landmark:main\\[\\]>control:button\\[[^\\]]*\\](>text:span\\[[^\\]]*\\])?$',
        reason: '手機名單：app 一列是一顆按鈕（點了開底部面板），稿是行內輸入的列',
        source: '#991 grades G2a；scores-dirty prep',
      },
      ...['缺', '位置', '樣式'].map((status) => ({
        status,
        widths: [360],
        ...(status === '缺'
          ? { a6: 'landmark:toolbar\\[主要動作\\]>control:button\\[[^\\]]*\\]$' }
          : { app: '^>landmark:main\\[\\]>row(>control:button(>text:span)?)?$' }),
        reason:
          '工具限制：app 的手機托盤（page-actions，position: fixed）被認成「列」、拿掉了鈕名，' +
          '配不上稿的托盤，反而跟稿的手機名單列錯配（截圖底部托盤兩顆鈕都在）',
        source: 'tools/a6-conformance extract.mjs isRow；#1925',
      })),
      // ── 資料差（seed 的考試、班、學生跟稿的示範資料不同）──
      {
        status: '文案',
        // 副行：考試類型、科目、星期隨資料（稿：小考·數學·週二）
        detail:
          '^「(第五次小考進行中|第五次小考|國三數學A班|\\{分校\\} › ·小考·數學· #（二）)」→「',
        reason: '資料：考試名、班名隨資料',
        source: `${rule('R5')}「成績登錄」2026-10-23；#1925`,
      },
      {
        status: '位置',
        a6: 'heading:h1\\[[^\\]]*\\]>text:span\\[(進行中|已完成)\\]$',
        reason: '資料：考試名長短不同，狀態小標落在標題第幾行跟著變',
        source: `${rule('R5')}「成績登錄」2026-10-23；#1925`,
      },
      {
        status: '文案',
        a6: '^>text:p\\[已登錄·缺考# ·不及格（< #）位\\]$',
        detail: '^「已登錄·缺考# ·不及格（< #）位」→「已登錄·缺考# ·不及格位」$',
        reason: '資料：seed 這場考試沒設及格線，合計不寫「（< 及格線）」',
        source: `${rule('R5')}「成績登錄」2026-10-23；#1925`,
      },
      {
        status: '位置',
        a6: 'text:p\\[已登錄·缺考# ·不及格（< #）位\\]>text:strong\\[#\\]$',
        reason: '資料：沒設及格線、少一段字，後面的數字往前',
        source: `${rule('R5')}「成績登錄」2026-10-23；#1925`,
      },
      {
        status: '位置',
        a6: 'row>text:dd>text:small$',
        reason: '資料：前面的數字位數不同（稿 10、seed 7）',
        source: `${rule('R5')}「成績登錄」2026-10-23；#1925`,
      },
      ...['位置', '尺寸', '樣式'].map((status) => ({
        status,
        widths: [1440],
        a6: '>list>(list>)?row(>(text:small|text:span|control:textbox(~2)?|control:button(>text:span)?|control:link))?$',
        ...(status === '樣式' ? { detail: '^color ' } : {}),
        reason:
          '資料：seed 的學生名比較長（出勤測試學生NN），表格欄寬跟著變；名字灰色只在還沒登分的列（稿的第一列沒分數）',
        source: `${rule('R5')}「成績登錄」2026-10-23；#1925`,
      })),
    ],
    // scores 用的那份已結束（輸入框 disabled），儲存列出不來；這份是 seed 裡進行中的
    app: '/admin/grades/exams/academy/70000000-0000-0000-0000-000000000003/scores',
    // app 手機是點列開 sheet 編輯（稿是行內輸入），只在桌機改分數
    prep: {
      a6: [{ fill: ['input[aria-label$="的分數"]:not([disabled])', '77'], widths: [1440] }],
      // p-inputnumber 不吃 fill（不走 input 事件），逐鍵打
      app: [
        { click: 'input[aria-label$="的分數"]:not([disabled])', widths: [1440] },
        { press: 'Control+A', widths: [1440] },
        { press: '7', widths: [1440] },
        { press: '7', widths: [1440], settle: 800 },
      ],
    },
  },
  settings: { a6: 'settings.html', app: '/admin/settings/general' },
  't-schedule': {
    a6: 't-schedule.html',
    app: '/teacher/schedule',
    state: path.join(cache, 'state-teacher.json'),
    deviations: [
      {
        // 拿掉的話 app 的週列會跑到 main 底下、跟稿的課卡搶配對（app 的 main 包住色面與工具列，#1591）
        status: '多',
        app: '>landmark:main\\[\\]>landmark:navigation\\[本週各日\\]$',
        reason: '週條是換日、換週的導覽，用 nav landmark（稿是 div）',
        source: `${rule('R7')}`,
      },
      // 量測帳號 teacher0001 的機構是行政負責點名：統計列第一格換成「本週的課 N 堂」。
      // 老師負責點名時照稿顯示「N 堂待點名（隨堂）」（schedule.page.html 的 isTeacherLed 分支；
      // schedule.page.spec.ts「teacher 模式：同一堂課才叫『漏點名』」守著）
      ...[
        {
          status: '文案',
          a6: '>landmark:region\\[這一頁的摘要\\]>text:dt\\[堂待點名（隨堂）\\]$',
          detail: '^「堂待點名（隨堂）」→「本週的課」$',
        },
        {
          status: '多',
          app: '>landmark:region\\[這一頁的摘要\\]>text:dd\\[#\\]>text:small\\[堂\\]$',
        },
      ].map((d) => ({
        ...d,
        reason:
          '行政負責點名時老師沒有點名入口，統計列不放待點名、改放本週的課；老師負責點名時照稿',
        source: 'kb/wiki/rules/attendance-rules.md:60-65（點名責任歸屬，#920）；計畫席 10-30 裁定',
      })),
    ],
  },
  't-notifications': {
    a6: 't-notifications.html',
    app: '/teacher/notifications',
    state: path.join(cache, 'state-teacher.json'),
    deviations: [
      ...INBOX_DEVIATIONS,
      {
        status: '文案',
        a6: '>landmark:region\\[這一頁的摘要\\]>heading:h1\\[',
        detail: '^「#則未讀，今天#則新公告。」→「#則未讀，今天#則新通知。」$',
        reason: '老師收件匣也有通知（請假等），色面句寫「通知」',
        source: `${rule('R5')}「老師通知頁的色面句」2026-10-22；#1888`,
      },
    ],
  },
  'p-schedule': {
    a6: 'p-schedule.html',
    app: '/parent/schedule',
    state: PARENT_STATE,
    prep: PARENT_PREP,
    // 稿的今天（shared/stress.js：2026-10-01 17:40，週四）：不釘的話「今天」底線、哪天有課、
    // 上課中都隨量測當天跑（#1967）
    clock: '2026-10-01T17:40:00+08:00',
  },
  'p-grades': {
    a6: 'p-grades.html',
    app: '/parent/grades',
    // 家長頁一律用 parent03（#1968）；量之前切到張宇軒（105 筆補習班成績，預設的第一個孩子沒有成績）
    state: PARENT_STATE,
    prep: PARENT_PREP,
    deviations: [
      // 資料：「NEW」接在考試名稱後、「筆」接在筆數後 —— 名稱長度與位數不同，往右移的量就是字寬差
      ...[
        'control:button>text:span~2>text:span\\[NEW\\]$',
        'landmark:region\\[這一頁的摘要\\]>text:dd\\[#\\]>text:small\\[筆\\]$',
      ].map((a6) => ({
        status: '位置',
        a6,
        detail: 'Δy 0（',
        reason: '資料：前面的考試名稱長度、筆數位數不同',
        source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968`,
      })),
      {
        // 資料：最近一次考試的科目（稿英文、量測的張宇軒數學），兩邊同一套句子
        status: '文案',
        detail: '^「\\{名\\}最近一次[^#」]+#分。」→「\\{名\\}最近一次[^#」]+#分。」$',
        reason: '資料：最近一次考試的科目',
        source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968、#1959`,
      },
      {
        // 資料：張宇軒成績超過一頁才有這句（稿的示範孩子筆數少）
        status: '多',
        app: '>landmark:main\\[\\]>text:p\\[只顯示最近#筆，共#筆。\\]$',
        reason: '資料：成績筆數超過顯示上限才出現',
        source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968、#1959`,
      },
      {
        // 資料：章名是孩子上的班與任課老師（稿的示範孩子一班一位老師；張宇軒的班有兩位老師、班名不同）
        status: '文案',
        a6: '>landmark:main\\[\\]>heading:h2\\[[^\\]]*老師· #場\\](>text:small\\[[^\\]]*\\])?$',
        detail: '^「[^」]*老師· #場」→「[^」]*老師· #場」$',
        reason: '資料：孩子上的班與任課老師',
        source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968`,
      },
      {
        status: '缺',
        a6: 'control:button\\[(課程|學期)：[^\\]]*\\](>text:span\\[[^\\]]*\\])?$',
        reason: SELECT_FIELD,
        source: SELECT_FIELD_SOURCE,
      },
      {
        status: '多',
        app: 'control:combobox\\[(課程|學期)\\]$',
        reason: SELECT_FIELD,
        source: SELECT_FIELD_SOURCE,
      },
      {
        status: '多',
        app: 'control:button\\[dropdown trigger\\](~\\d+)?$',
        reason: SELECT_FIELD,
        source: SELECT_FIELD_SOURCE,
      },
      // 孩子切換鈕的形狀（大字名＋年級、可及名稱「目前看的是 X，切換孩子」）是全家長頁的殼層差異，另開 #1932；
      // 這頁不先修，免得跟殼層單各改一半
      ...['缺', '文案', '樣式'].map((status) => ({
        status,
        a6: '>landmark:region\\[這一頁的摘要\\]>control:button\\[目前看的是\\{名\\}，切換孩子\\](>text:span\\[[^\\]]*\\])?$',
        reason: '孩子切換鈕的形狀：家長頁共用的殼層差異，在 #1932 一次修',
        source: '#1932（#1314 盤點，計畫席 10-23 派）',
      })),
      {
        // 工具只把登入者（家長）的名字換成 {名}；孩子名（seed 的「出勤測試學生 N」帶數字）沒被換，句子其餘相同
        status: '文案',
        a6: '>landmark:region\\[這一頁的摘要\\]>heading:h1\\[\\{名\\}',
        detail: '^「\\{名\\}([^」]*)」→「[^」]+\\1」$',
        reason: '工具限制：孩子名字沒被樣板化成 {名}（只換登入者的名字），句子其餘一樣',
        source: '#1926；tools/a6-conformance/lib/capture.mjs harvestNames',
      },
      {
        // app 有這兩種標籤（grades.component.html：NEW＝7 天內登錄、補考＝status makeup）；量的那位孩子這 7 天
        // 沒有新成績（色面「0 筆」）、也沒有補考
        status: '缺',
        a6: '>text:span\\[(NEW|補考)\\]$',
        detail: '列內條件式',
        reason: '資料差：量的孩子沒有 7 天內登錄的成績、也沒有補考（app 兩種標籤都有）',
        source: '#1926（本機 seed attendance-parent-02）',
      },
      {
        // 稿配到的那一列是不及格（`.ex__v--fail` 是 inline-flex，裡面的 small 變成 flex item → block）
        status: '樣式',
        a6: '>text:span~3>text:small$',
        detail: '^display block → inline$',
        reason: '資料差：稿配到的是不及格列（分數是 inline-flex），app 配到的是及格列',
        source: '#1926；.design-explorations p-grades.html:33',
      },
    ],
  },
  'p-payments': {
    a6: 'p-payments.html',
    app: '/parent/payments',
    state: PARENT_STATE,
    prep: PARENT_PREP,
    // #1924 收尾、#1949 換多孩子帳號重看（10-23）：量的是 parent03 → 張宇軒（26 張待繳，第一頁 20 張、沒有已繳清）。
    // 單孩子帳號時登的「靜態徽章、孩子數、標題句的孩子名字」在多孩子帳號下都不再出現，已刪
    deviations: [
      // 期限標籤：圓點＋字（app-status-dot），不換稿的 .tag 膠囊（底色、圓角、12px）；圓點佔掉的寬讓字往右
      ...['位置', '尺寸', '樣式'].map((status) => ({
        status,
        a6: 'control:button\\[[^\\]]*\\]>text:span\\[(#天後到期|今天到期|逾期#天|未到期)\\]$',
        reason: '狀態標籤用圓點＋字，不換稿的膠囊',
        source: `${rule('R5')}「狀態標籤：圓點，不換 A6 的 .tag 膠囊」2026-10-23`,
      })),
      {
        // 稿的待繳還沒到期；seed 那張已逾期 → 副句多「，已經過了」（兩邊同一套句子）
        status: '文案',
        detail: '^「最近的期限是#」→「最近的期限是#，已經過了」$',
        reason: '資料：最近那張帳單有沒有逾期',
        source: `${rule('R5')}「家長繳費頁的資料差」2026-10-23；#1924、#1968`,
      },
      {
        // 第一頁 20 張全是待繳 → 已繳清那一章是空狀態句
        status: '多',
        app: 'landmark:main\\[\\]>text:p\\[還沒有繳清的帳單。\\]$',
        reason: '資料：載入的那一頁沒有已繳清的帳單',
        source: `${rule('R5')}「家長繳費頁的資料差」2026-10-23；#1924、#1968`,
      },
      {
        // 還有下一頁時章頭不寫張數：只數到已載入的會是錯的數字（#1496「不編數字」，計畫席 10-10 讀過 diff）
        status: '缺',
        a6: '>landmark:main\\[\\]>text:span\\[#張\\](~\\d)?$',
        reason: '帳單超過一頁時章頭不寫張數：只數已載入的會寫錯',
        source:
          'apps/web/src/app/features/parent/pages/payments/payments.page.html（hasMore）；#1496',
      },
      // 數字的位數、狀態標籤的長度、帳單列數隨資料 →「元」、dt 寬、副行、已繳清章頭、餐費連結跟著移
      ...['位置', '尺寸'].map((status) => ({
        status,
        a6: '(text:dd\\[#\\](~2)?>text:small\\[元\\]|text:dt\\[本學期已繳\\]|text:span\\[繳費期限#\\]|heading:h2\\[已繳清\\]|control:link\\[看餐費紀錄\\])$',
        reason: '資料：金額位數、狀態標籤長度、帳單列數',
        source: `${rule('R5')}「家長繳費頁的資料差」2026-10-23；#1924、#1968`,
      })),
    ],
  },
  'p-meals': {
    a6: 'p-meals.html',
    app: '/parent/meals',
    state: PARENT_STATE,
    prep: PARENT_PREP,
    popovers: { mexp: 'meals-export' },
    deviations: [
      // 資料：月份摘要的「N 元 · N 餐」位數比稿長，手機放不下時整段換到第二行（摘要列 flex-wrap）；稿的資料放得下一行
      {
        status: '位置',
        a6: '>landmark:main\\[\\]>row>control:button>text:span~3(>text:b)?$',
        reason: '資料：月份合計的金額與餐數位數',
        source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968`,
      },
      {
        status: '缺',
        a6: 'landmark:popover\\[匯出餐費\\]>text:span\\[新\\]$',
        reason: '稿的「新」標記是設計說明（產品原本沒有匯出），不是畫面內容',
        source: '.design-explorations p-meals.html notes「匯出」列',
      },
      {
        // 360 量到：稿的關閉鈕 36，app 照全站手機控制項 44（計畫席 10-23 轉，#2017）
        status: '尺寸',
        a6: 'landmark:popover\\[匯出餐費\\]>control:button\\[關閉\\]$',
        detail: '^寬 36→44$',
        reason: '手機控制項一律 44（觸控）',
        source: `${rule('R5')}「灰帶工具列控制項高度」2026-10-23；#1903`,
      },
      {
        status: '多',
        app: 'control:combobox\\[期間\\]$',
        reason: SELECT_FIELD,
        source: SELECT_FIELD_SOURCE,
      },
      {
        status: '多',
        app: 'control:button\\[dropdown trigger\\]$',
        reason: SELECT_FIELD,
        source: SELECT_FIELD_SOURCE,
      },
      // 稿一列四欄（日期、餐別、備註、金額）；API 沒有餐別（meal-rules 每生每日一筆）、
      // 不回行政備註（#1117 計畫席裁定的欄位 allowlist），app 一列兩欄 —— 列內的 span 配對因此錯位
      ...['缺', '多', '位置', '樣式'].map((status) => ({
        status,
        a6: status === '多' ? undefined : '>row>(row|text:span(~\\d)?)$',
        app: status === '缺' ? undefined : '>row>(row|text:span(~\\d)?)$',
        reason: '明細列少了餐別、備註兩欄：API 沒有這兩項資料',
        source: 'apps/api/src/routes/parent/meals.ts（#1117 欄位 allowlist）',
      })),
    ],
  },
  'p-dashboard': {
    a6: 'p-dashboard.html',
    app: '/parent/dashboard',
    // 稿的今天（shared/data.js：2026-10-01 17:40，週四），同 p-schedule（#1314 10-30）
    clock: '2026-10-01T17:40:00+08:00',
    state: PARENT_STATE,
    prep: PARENT_PREP,
    deviations: [
      {
        // 稿的「今天」有課；量測當天張宇軒沒課 → 寫下一堂（兩邊同一套句子）
        status: '文案',
        a6: '>landmark:region\\[這一頁的摘要\\]>text:p\\[今天#堂：',
        detail: '→「下一堂',
        reason: '資料：量測當天有沒有課',
        source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968`,
      },
      // 稿每一節標題後的「新」是設計說明（產品原本沒有這一節），不是畫面內容
      {
        status: '缺',
        a6: 'heading:h2\\[[^\\]]*新\\]>text:span\\[新\\]$',
        reason: '稿的「新」標記是設計說明，不是畫面內容',
        source: '.design-explorations p-dashboard.html notes「整頁」列',
      },
      {
        status: '文案',
        a6: '(heading:h2|landmark:region)\\[[^\\]]*新\\]$',
        detail: '^「[^」]*新」→',
        reason: '稿的「新」標記是設計說明，不是畫面內容',
        source: '.design-explorations p-dashboard.html notes「整頁」列',
      },
      // 續課預告條（.pd-renew）：沒有自動開單日，算不出 T-5～T-0 的出現窗口
      ...['缺', '文案', '位置', '樣式', '尺寸'].map((status) => ({
        status,
        a6: 'control:link\\[申請異動\\]$|text:span\\[[^\\]]*續課預告',
        reason:
          '續課預告條這次不做：沒有自動開單日，算不出出現窗口（計畫席 10-22 裁定，使用者已裁定自動續課先不做）',
        source: 'kb/wiki/flows/renewal.md:21-31（T 的定義）',
      })),
    ],
  },
  'p-notifications': {
    a6: 'p-notifications.html',
    app: '/parent/notifications',
    state: PARENT_STATE,
    deviations: [
      ...INBOX_DEVIATIONS,
      {
        status: '多',
        app: '>landmark:main\\[\\]>control:button\\[通知設定：[^\\]]*\\]$',
        reason: '推播設定收進工具列「通知設定」鈕（舊有新無，稿沒有位置）',
        source: `${rule('R5')}「家長通知頁「繳費提醒通知」」2026-10-22；#1888`,
      },
    ],
  },
  't-students': {
    a6: 't-students.html',
    app: '/teacher/students',
    state: path.join(cache, 'state-teacher.json'),
    // 篩選換成 A6 下拉（app-select-field），結構不同、外觀對齊 —— 同 p-grades
    deviations: selectFieldDeviations('班級'),
  },
};
