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
    ],
  },
  'select-role': {
    a6: 'pub-select-role.html',
    app: '/select-role',
    state: path.join(cache, 'state-multi.json'),
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
    ],
  },
  enrollment: {
    a6: 'pub-enrollment.html',
    app: '/enrollment',
    state: path.join(cache, 'state-guest.json'),
    deviations: PUBLIC_FORM_DEVIATIONS,
  },
  student: { a6: 'student.html', app: '/admin/students/e98f234f-b706-4209-8478-b2e5fda043ee' },
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
  },
  class: {
    a6: 'class.html',
    app: '/admin/courses/dc2f0b1a-7e79-4b6e-a61e-8bbac3eec5a6/classes/1deffd57-e069-4d72-98bf-41415ec01967',
  },
  dashboard: { a6: 'dashboard.html', app: '/admin/dashboard' },
  enrollments: { a6: 'enrollments.html', app: '/admin/enrollments' },
  leave: { a6: 'leave.html', app: '/admin/leave' },
  // 家長端報名申請（#1727 ③）：家長登入態；預設分頁「新增申請」，申請紀錄是 p-enrollment-records
  'p-enrollment': {
    a6: 'p-enrollment.html',
    app: '/parent/enrollment',
    state: path.join(cache, 'state-parent.json'),
  },
  // 「申請紀錄」分頁：稿與 app 都認網址 #records
  'p-enrollment-records': {
    a6: 'p-enrollment.html#records',
    app: '/parent/enrollment#records',
    state: path.join(cache, 'state-parent.json'),
  },
  // 家長端試聽申請（#1727 ④）：一門課一列（稿一列一班，R5 2026-10-19）
  'p-trial': {
    a6: 'p-trial.html',
    app: '/parent/trial',
    state: path.join(cache, 'state-parent.json'),
  },
  'p-trial-records': {
    a6: 'p-trial.html#records',
    app: '/parent/trial#records',
    state: path.join(cache, 'state-parent.json'),
  },
  // 家長端加選課程（#1727 ⑤）：卡片點開是 JS 打開的 <dialog>（稿 sheet()、app 原生 showModal）
  'p-add-course': {
    a6: 'p-add-course.html',
    app: '/parent/add-course',
    state: path.join(cache, 'state-parent.json'),
  },
  // 家長端續課資訊（計畫席 10-22）：只量「沒有即將到來的續課」那一態 —— 本機 seed 沒有未來的繳費期，
  // app 只畫得出這一態；稿的有續課那一態要有下期資料才量得了（偏離見 R5 2026-10-22）
  'p-renewal-none': {
    a6: 'p-renewal.html#none',
    app: '/parent/renewal',
    state: path.join(cache, 'state-parent.json'),
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
    state: path.join(cache, 'state-parent.json'),
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
  'contact-book': { a6: 'contact-book.html', app: '/admin/contact-book' },
  changes: { a6: 'changes.html', app: '/admin/changes' },
  exams: {
    a6: 'exams.html',
    app: '/admin/grades/exams',
    a6Open: opensOf('exams', 'a6Open'),
    appOpen: opensOf('exams', 'appOpen'),
  },
  scores: {
    a6: 'scores.html',
    app: '/admin/grades/exams/academy/5bce4763-b20c-4dd5-9f7e-2b7e500e3a22/scores',
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
  'grades-student': { a6: 'grades-student.html', app: '/admin/grades/overview/student' },
  // `prep`：量之前先在兩邊做的步驟（步驟格式同 scenarios.mjs）。週視圖與儲存列都要操作後才出現，
  // 黏住的行為檢查才量得到（A6 的 .wc__h／.cg__dh、#save）
  'schedule-week': {
    a6: 'schedule.html',
    app: '/admin/sessions',
    // 稿的今天（973-layout/shared/stress.js：2026-10-01 17:40，週四）；不對齊的話週四／週五兩欄成對地差
    clock: '2026-10-01T17:40:00+08:00',
    prep: {
      a6: [{ click: '[data-view="week"]', settle: 800 }],
      app: [{ click: { role: 'button', name: '^週$' }, settle: 1500 }],
    },
  },
  'scores-dirty': {
    a6: 'scores.html',
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
  },
  't-notifications': {
    a6: 't-notifications.html',
    app: '/teacher/notifications',
    state: path.join(cache, 'state-teacher.json'),
  },
  'p-schedule': {
    a6: 'p-schedule.html',
    app: '/parent/schedule',
    state: path.join(cache, 'state-parent.json'),
  },
  'p-payments': {
    a6: 'p-payments.html',
    app: '/parent/payments',
    state: path.join(cache, 'state-parent.json'),
  },
  'p-meals': {
    a6: 'p-meals.html',
    app: '/parent/meals',
    state: path.join(cache, 'state-parent.json'),
    popovers: { mexp: 'meals-export' },
    deviations: [
      {
        status: '缺',
        a6: 'landmark:popover\\[匯出餐費\\]>text:span\\[新\\]$',
        reason: '稿的「新」標記是設計說明（產品原本沒有匯出），不是畫面內容',
        source: '.design-explorations p-meals.html notes「匯出」列',
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
    state: path.join(cache, 'state-parent.json'),
    deviations: [
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
    state: path.join(cache, 'state-parent.json'),
  },
  't-students': {
    a6: 't-students.html',
    app: '/teacher/students',
    state: path.join(cache, 'state-teacher.json'),
  },
};
