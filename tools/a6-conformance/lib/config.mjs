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
  // #2290 計畫席 11-05 裁定（issuecomment-6660276130）：殼的內距在 .dialog-frame__body，稿在 form 上 ——
  // form 本身 padding 8/24/24 → 0、子項相對 form Δx −24、Δy −8（幾何結果相同，所有換殼的表單都會碰到）
  {
    status: '樣式',
    a6: '(^|>)landmark:dialog\\[[^\\]]*\\]>landmark:form\\[[^\\]]*\\]$',
    // 手機稿 8/16/24（A6 .acset__body 手機左右 16）
    item: '^padding 8px (24|16)px 24px → 0px$',
    reason: '殼的內距在內容區外層（.dialog-frame__body），稿在 form 上，幾何相同',
    source: 'https://github.com/mizok/clessia/issues/2290#issuecomment-6660276130（計畫席裁定）',
  },
  {
    status: '位置',
    a6: '(^|>)landmark:dialog\\[[^\\]]*\\]>landmark:form\\[[^\\]]*\\]>',
    detail: '^相對「form」 Δx -(24|16)、Δy -(8|9)（',
    reason:
      '殼的內距在內容區外層（.dialog-frame__body），稿在 form 上：子項相對 form 位移，畫面位置相同',
    source: 'https://github.com/mizok/clessia/issues/2290#issuecomment-6660276130（計畫席裁定）',
  },
  {
    // 使用者 11-05 17:10：手機貼底抽屜改白底（--sheet-bg），稿是 --gray-sheet 灰。只拆底色這一項
    status: '樣式',
    widths: [360],
    a6: '^pop\\[[^\\]]*\\]>landmark:(dialog|popover)\\[[^\\]]*\\]$',
    item: '^backgroundColor rgb\\(235, 231, 228\\) → rgb\\(255, 255, 255\\)$',
    reason: '手機貼底抽屜白底（稿灰底）',
    source: `${rule('R5')}「手機貼底抽屜白底」2026-11-05；使用者 11-05 截圖`,
  },
  {
    // #2290：對話框手機的左右內距 16（標頭與內容一致），稿 `.acset__head`／`.acset__body` 手機仍是 24 —— 對話框裡的部件 Δx −8
    status: '位置',
    widths: [360],
    a6: '(^|>)landmark:dialog\\[[^\\]]*\\]>',
    detail: '^相對「[^」]*」 Δx -8、',
    reason: '對話框手機左右內距 16（標頭與內容對齊），稿 24',
    source: `${rule('R5')}「對話框手機標頭左距 16」「對話框手機內容左右 16」2026-11-05；#2290`,
  },
  // #2290：寬歸成三種，表單／詳情用 --dlg-w-md 520，稿 `.acset` 是 480 —— 根寬 480→520、置中位移 Δx −20
  ...[
    { status: '尺寸', detail: '^寬 480→520' },
    { status: '位置', detail: 'Δx -20、' },
  ].map((d) => ({
    ...d,
    widths: [1440],
    a6: '^pop\\[[^\\]]*\\]>landmark:dialog\\[[^\\]]*\\]$',
    reason: '對話框寬歸成 420／520／760 三種，表單與詳情 520（稿 .acset 480）',
    source: `${rule('R5')}「對話框寬三種」2026-11-05；#2290`,
  })),
  {
    // #2290：手機貼底抽屜沒有底部列時，內容區底留 --sheet-foot-gap 16（稿 `.acset__body` 24）—— 根高 −8。
    // 用 delta 只放過預期的 −8，其他高度變化照報（#2322 二讀）
    status: '尺寸',
    widths: [360],
    a6: '^pop\\[[^\\]]*\\]>landmark:dialog\\[[^\\]]*\\]$',
    delta: -8,
    reason: '手機貼底抽屜的內容區底留 16＋safe-area（稿 24）',
    source: `${rule('R5')}「貼底抽屜底部留白 16」2026-11-05；#2290`,
  },
  {
    // #2290：對話框有動作就 sticky（殼的底部列），稿的 `.fdlg__foot` 不黏（只有 `.gdlg__foot` 黏）
    status: '黏住',
    a6: '(^|>)landmark:dialog\\[[^\\]]*\\]>',
    detail: 'app 仍黏在視窗內（多黏）',
    reason: '對話框的動作列一律 sticky 在捲動容器底（殼的底部列）',
    source: `${rule('R5')}「對話框動作列一律 sticky」2026-11-05；#2290`,
  },
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
  // R5 2026-11-02：切換身分列出全部身分，目前的打勾標「使用中」（A6 只列其他身分）。
  // 多了一列 → 其他身分的列往下推、文案配錯位、目前那列字重 600
  ...['文案', '位置', '樣式'].map((status) => ({
    status,
    pop: 'acct',
    a6: '>landmark:popover\\[帳戶\\]>.*control:button\\[(管理員|任課老師|家長)\\]$',
    reason: '切換身分也列目前身分：多一列，其他身分的位置、文案配對與字重連帶不同',
    source: `${rule('R5')}「帳戶選單『切換身分』列出全部身分」2026-11-02`,
  })),
  {
    status: '多',
    pop: 'acct',
    app: '>control:button\\[[^\\]]*使用中\\]>text:span\\[使用中\\]$',
    reason: '切換身分的目前身分標「使用中」（A6 沒有）',
    source: `${rule('R5')}「帳戶選單『切換身分』列出全部身分」2026-11-02`,
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
    // R3 連帶：手機 44px 的可點元素用 flex 垂直置中，取代稿的上下 padding。
    // inline-block 是 <button> 的 UA 預設（句中的「個資使用聲明」鈕，#2035 @switch 補檢）
    status: '樣式',
    kind: 'control',
    widths: [360],
    detail:
      '^(padding [\\d.]+px( [\\d.]+px)* → 0px；)?display (block|inline|inline-block) → (inline-)?flex$',
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
    // D3：伺服器分頁的分頁器，收不進「⋯」（#1314 comment 6182400702）。Z 批起全站是共用 app-pager；
    // 稿沒畫分頁器的列表用精簡版（R5 2026-11-02）
    status: '多',
    host: '^app-pager$',
    reason: '分頁器：伺服器分頁，稿沒畫分頁器的列表用 A6 精簡版（第 x／y 頁＋上一頁／下一頁）',
    source: `${rule('R5')}「分頁器：稿沒畫分頁器的列表」2026-11-02；${rule('R2', ' 例外')}`,
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
  {
    // 置中的對話框：彈出物根沒有已配對的祖先，量「距頁頂」與「距視窗底」取差小的；兩邊頁面長度不同（清單長短），
    // 量到的就是頁長差，不是對話框位置差。前例 parents 的 new-parent（稿 98 位家長）
    status: '位置',
    widths: [1440],
    a6: 'landmark:dialog\\[[^\\]]*\\]$',
    detail: '^相對(視窗底|頁面) Δx 0、',
    reason: '工具限制：兩邊頁面長度不同，置中對話框的位置量法失真',
    source: 'tools/a6-conformance/README.md（彈出物根：距頁頂與距視窗底取差小的）',
  },
  {
    // 系統設定各分頁共用色面句（settings.html:224 與 settings-shell.page.ts 同一套分支）：全部分校日到班時寫「全部用日到班」
    status: '文案',
    a6: '>heading:h1\\[#個分校在營運，#個用日到班。\\]$',
    reason: '資料：seed 的分校全部用日到班',
    source: 'settings.html:224 與 settings-shell.page.ts 同一套分支',
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
    reason: '「切換身分」只在多身分帳號出現；稿的示範使用者有 3 個身分（app `hasOtherRoles()`）',
  },
];

/**
 * K4：頂欄「切換分校」只在這一頁真的照分校篩資料時才出現（不然頂欄選了 A 分校、頁面還是在看全部）。
 * 資料本來就整個補習班共用、或只看一個班／學生／考試的頁登記成不適用（#1314 K4 盤點第一節）
 */
const noCampusSwitch = (why) => ({
  status: '缺',
  a6: '^>landmark:banner\\[\\]>control:button\\[切換分校：[^\\]]*\\]$',
  reason: `頂欄不放切換分校：${why}`,
  source: 'https://github.com/mizok/clessia/issues/1314#issuecomment-6572339488（K4 盤點第一節）',
});

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
 * 對話框裡的 app-select-field（#2325）：selectFieldDeviations 只管缺／多；稿的選單鈕本身（位置、文案、樣式、尺寸）
 * 與標籤（稿 label、app span）也是同一個結構差。app 的可及名稱可能帶必填星號；稿的選單鈕名稱是「ddName：目前值」
 */
const selectFieldInDialog = (pop, name, ddName = name) =>
  [
    { status: '缺', a6: `control:button\\[${ddName}：[^\\]]*\\](>text:span\\[[^\\]]*\\])?$` },
    { status: '多', app: `control:combobox\\[${name}\\*?\\]$` },
    { status: '多', app: 'control:button\\[dropdown trigger\\](~\\d+)?$' },
    ...['文案', '位置', '樣式', '尺寸'].map((status) => ({
      status,
      a6: `control:button\\[${ddName}：[^\\]]*\\]$`,
    })),
    ...['角色', '尺寸'].map((status) => ({ status, a6: `text:label\\[${name}\\]$` })),
  ].map((d) => ({ ...d, pop, reason: SELECT_FIELD, source: SELECT_FIELD_SOURCE }));
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
  {
    status: '多',
    app: '>landmark:main\\[\\]>text:strong\\[則未讀\\]>text:span\\[#\\]$',
    reason: '未讀數的數字包一層（數字變化：新值從下方淡入，掛在只包數字的元素上）',
    source: 'kb/wiki/architecture/motion.md:150（數字變化：套到未讀數）',
  },
  // 資料：哪一章有未讀、代表列是已讀還是未讀，都看 seed
  {
    status: '多',
    app: `${DAY}>text:p\\[#則\\]>text:span\\[·未讀#\\]$`,
    reason: '資料：那一章有沒有未讀（「· 未讀 N」稿同款，只在有未讀的章出現）',
    source: INBOX_DATA_SOURCE,
  },
  {
    status: '樣式',
    a6: `${DAY}>row>control:button>text:span$`,
    detail: '^fontWeight \\d+ → \\d+(；color [^；]+)?$',
    reason: '資料：代表列已讀／未讀不同（未讀是粗體深字），兩種都照稿',
    source: INBOX_DATA_SOURCE,
  },
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
export const NOTIFICATIONS_TABS = [
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
/**
 * 稿用 JS 開的唯讀／兩步對話框（#2210）：稿 `dialog.acset`（showModal），app 是 DialogService 的 `.p-dialog`，
 * 用裡面的元件宿主區分。量完按 Escape（兩邊都吃）。
 */
const dlgOpen = (a6Click, appClick, host) => ({
  a6Open: { root: 'dialog[open]', click: a6Click },
  appOpen: { root: `.p-dialog:has(${host})`, click: appClick },
});
const FORM_DIALOGS = {
  courses: {
    'new-course': formOpen('[data-newc]', 'button:has-text("新增課程")'),
    'new-class': formOpen('[data-newk]', 'button:has-text("新增班")'),
    // 操作紀錄（工具列時鐘鈕）、產生課堂（「無未來排程」班的標籤鈕）。那些班收在合起來的課程裡，
    // 先按「需介入」列的「只看這幾個班」攤開（兩邊同一顆）；放最後，篩選狀態不影響前面的彈出物
    log: dlgOpen('[data-log]', 'button[aria-label="操作紀錄"]', 'app-audit-log-dialog'),
    gen: dlgOpen(
      ['[data-attn]', '[data-gen]'],
      ['[data-testid="intervention"] button', '[data-part="generate"]'],
      'app-generate-sessions-dialog',
    ),
  },
  // 學生成績明細（點學生列）
  'grades-student': {
    detail: dlgOpen('[data-sid]', '[data-part="student-row"]', 'app-student-score-detail-dialog'),
  },
  staff: {
    'new-staff': formOpen('[data-new]', 'button:has-text("新增人員")'),
    // 權限設定（#1314 ST2）：稿第一筆林主任是示範的「本人」（鎖住），取第二筆張教務（可改）對 app 的第一筆管理員
    perm: dlgOpen(
      '.pp__perm[data-perm="p2"]',
      '[data-testid^="permission-count-"]',
      'app-permission-dialog',
    ),
    // 確認對話框（#2290 ConfirmDialog）：稿＝沒有欄位的 A2.form（停用帳號）；app 的 ConfirmDialog 換殼。
    // 第一列是本人（稿 p1／app 登入的管理員），兩邊都取第二列
    off: dlgOpen(
      ['.pp__more[data-x="p2"]', '[data-off]'],
      [':nth-match(button[aria-label$=" 的更多動作"], 2)', '[role=menuitem]:has-text("停用帳號")'],
      'app-confirm-dialog',
    ),
    // 授課紀錄（#2290 B 批）：老師章第一列的「⋯」→「授課紀錄」
    'teaching-log': dlgOpen(
      ['[aria-label="老師"] .pp__more', '[data-log-t]'],
      [
        '[aria-label="老師"] button[aria-label$="的更多動作"]',
        '[role=menuitem]:has-text("授課紀錄")',
      ],
      'app-teaching-log-dialog',
    ),
  },
  parents: {
    'new-parent': formOpen('[data-new]', 'button:has-text("新增家長")'),
    // 家長詳情、批次匯入（#2290 換殼）
    detail: dlgOpen('[data-detail]', 'button[aria-label$=" 的詳情"]', 'app-parent-detail-dialog'),
    import: dlgOpen('[data-import]', 'button:has-text("匯入")', 'app-parent-import-dialog'),
  },
  // #2290 換共用殼的對話框（0950-a 家族）
  leave: {
    batch: formOpen('[data-batch-leave]', 'button:has-text("批次請假")'),
    // 登記請假（#2318 勾當天的課）
    'new-leave': dlgOpen('[data-new]', 'button:has-text("登記請假")', 'app-leave-form-dialog'),
  },
  schools: { 'new-school': formOpen('[data-new-school]', 'button:has-text("新增學校")') },
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
    // app 的篩選是 app-filter-panel：桌機 PrimeNG Popover、≤860 貼底抽屜 p-dialog（#2206）
    appOpen: {
      filt: { click: 'button:has-text("篩選：")', root: '.p-popover, .p-dialog' },
      // 帳號設定（#2290 shared）：頂欄帳戶選單 →「帳號設定」。稿是原生 dialog.acset；app 是 DynamicDialog＋共用殼
      acset: {
        click: ['button[aria-label^="帳戶："]', 'button:has-text("帳號設定")'],
        root: '.p-dialog:has(app-account-settings-dialog)',
      },
    },
    a6Open: { acset: { click: ['[popovertarget="acct"]', '[data-acset]'], root: 'dialog.acset[open]' } },
    // 第三層：年級名單隨資料（稿是國一～小五，demo 是高一～國三）
    behaveIgnore: ['^[高國小][一二三四五六]#?$'],
    deviations: [
      // ── 帳號設定內容（#2390）──
      // 寬 520（稿 .acset 480，寬三種）／手機內容左右 16（稿 24）：整欄寬的部件變寬，靠右的儲存鈕跟著位移
      ...[
        { status: '尺寸', widths: [1440], detail: '^寬 (432→472|400→440)$' },
        { status: '位置', widths: [1440], a6: '>control:button\\[儲存\\](~\\d)?$', detail: '^相對「帳號設定」 Δx \\+40、' },
      ].map((d) => ({
        a6: '^pop\\[acset\\]>',
        ...d,
        pop: 'acset',
        reason: '對話框寬歸成 420／520／760 三種，帳號設定用 520（稿 .acset 480）',
        source: `${rule('R5')}「對話框寬三種」2026-11-05；#2290`,
      })),
      ...[
        { status: '尺寸', widths: [360], detail: '^寬 (312→328|280→296)$' },
        { status: '位置', widths: [360], a6: '>control:button\\[儲存\\](~\\d)?$', detail: '^相對「帳號設定」 Δx \\+8、' },
      ].map((d) => ({
        a6: '^pop\\[acset\\]>',
        ...d,
        pop: 'acset',
        reason: '對話框手機內容左右 16（稿 .acset__body 24）',
        source: `${rule('R5')}「對話框手機內容左右 16」2026-11-05；#2290`,
      })),
      // 量的帳號是管理員：有「對外暱稱」一欄（#1665，稿沒畫、R2 保留），下面各欄跟著下移
      ...[
        { status: '多', app: '>landmark:dialog\\[帳號設定\\]>(text:label\\[對外暱稱\\]|text:p\\[公開課程目錄[^\\]]*\\]|control:button\\[儲存\\]~5)$' },
        { status: '位置', widths: [1440], a6: '>landmark:dialog\\[帳號設定\\]>(text:label\\[(生日|Email|電話)\\]|text:p\\[補習班用這個Email[^\\]]*\\])$', detail: '^相對「帳號設定」 Δx 0、Δy \\+10\\d（' },
      ].map((d) => ({
        ...d,
        pop: 'acset',
        reason: '對外暱稱（人員身分才有）：稿沒畫、現況有，保留',
        source: `${rule('R2')}；#1665`,
      })),
      // 量的帳號沒有家長身份：稿的使用者有（✓ 已啟用），app 照實寫洽行政（#1844）
      ...['文案', '樣式'].map((status) => ({
        status,
        pop: 'acset',
        a6: '>landmark:region\\[家長身份\\]>text:p\\[已啟用\\]$',
        reason: '資料：量測帳號沒有家長身份，顯示「請洽補習班行政」那一句（有家長身份時照稿 ✓ 已啟用，spec 守）',
        source: `${rule('R2')}；#1844；#2390`,
      })),
      // 帳號設定：寬照 #2290「寬三種」用 520（稿 .acset 480），✕ 跟著右移 40
      {
        status: '位置',
        widths: [1440],
        pop: 'acset',
        a6: '>landmark:dialog\\[帳號設定\\]>control:button\\[關閉\\]$',
        detail: '^相對「帳號設定」 Δx \\+40、Δy 0（',
        reason: '對話框寬歸成 420／520／760 三種，帳號設定用 520（稿 .acset 480）',
        source: `${rule('R5')}「對話框寬三種」2026-11-05；#2290`,
      },
      // 頁面搜尋框：框畫在 input 上，稿畫在外層 label.tsearch —— 同 courses／grades-class 那條
      ...['尺寸', '樣式', '位置'].map((status) => ({
        status,
        a6: 'control:searchbox\\[搜尋學生\\]$',
        reason: '頁面搜尋框的框畫在 input 上（全站同款），稿畫在外層 label',
        source: '全站共用 .clessia-filter-search（p-iconfield）；高度 #1903（使用者 10-23 裁定）',
      })),
      {
        // 稿寫「這頁沒有主要動作」；新增學生、列印本頁到班卡（工具列「⋯」）是現況有、稿沒畫的
        status: '多',
        app: 'landmark:search\\[篩選學生\\]>control:button\\[(新增學生|更多動作)\\]$',
        reason:
          '現況有、稿沒畫：「新增學生」留在工具列（手機底部動作列單顆，R5 10-23 #2005），列印到班卡收進「⋯」',
        source: `${rule('R2')}；${rule('R5')}「手機底部動作列只有一顆時」2026-10-23；#2005`,
      },
      {
        // 「新增學生」「⋯」佔掉工具列右側，搜尋框與「篩選」整組往左
        status: '位置',
        a6: '^>control:button\\[篩選：全部\\]$',
        detail: '連帶自待修「control:button\\[新增學生\\] 多」',
        reason: '連帶：「新增學生」「⋯」留在工具列',
        source: rule('R2'),
      },
      {
        // 篩選面板多「狀態」「學校」「卡片」三列（現況有、稿沒畫）；五列同形，工具把它們認成清單列，
        // 稿的兩列沒成列 —— 稿那邊的列內按鈕就配不上
        status: '多',
        pop: 'filt',
        // 手機抽屜有可及名稱「篩選」（#2208 二讀），桌機浮層沒有
        app: 'landmark:dialog\\[(篩選)?\\]>row(>.*)?$',
        reason: '現況有、稿沒畫的篩選收進篩選面板（狀態、學校、卡片）；五列同形被認成清單列',
        source: rule('R2'),
      },
      {
        status: '缺',
        pop: 'filt',
        a6: 'landmark:popover\\[\\]>(text:span\\[(今天|年級)\\]|control:button\\[[^\\]]*\\])$',
        reason: '連帶：篩選面板五列被認成清單列，稿的兩列配不上（app 同樣是今天／年級兩列文字鈕）',
        source: rule('R2'),
      },
      {
        // PrimeNG Popover（非原生 popover）：浮層根是 role=dialog，有焦點管理、Esc 關
        status: '角色',
        pop: 'filt',
        a6: 'landmark:popover\\[\\]$',
        detail: '^landmark:popover → landmark:dialog$',
        reason: '篩選浮層用 PrimeNG Popover，根元素 role=dialog（非原生 popover）',
        source: rule('R7'),
      },
      // #2206：≤860 篩選改成貼底抽屜（全站 p-dialog 手機樣式，#1776），稿手機是內縮 16px 的浮層
      {
        status: '樣式',
        widths: [360],
        pop: 'filt',
        a6: 'landmark:popover\\[\\]$',
        reason: '手機篩選是貼底抽屜（全站 p-dialog 手機樣式），不是稿那種四邊有框的浮層',
        source: `${rule('R5')}「手機的篩選面板：貼底抽屜」2026-11-03；#2206 issuecomment-6593157592`,
      },
      {
        status: '多',
        widths: [360],
        pop: 'filt',
        app: 'landmark:dialog\\[篩選\\]>heading:h2\\[篩選\\]$',
        reason: '手機篩選抽屜的標題「篩選」（稿的浮層沒有標題）',
        source: `${rule('R5')}「手機的篩選面板：貼底抽屜」2026-11-03；#2206 issuecomment-6593157592`,
      },
      {
        status: '多',
        widths: [360],
        pop: 'filt',
        app: 'landmark:dialog\\[篩選\\]>control:button\\[完成\\]$',
        reason: '手機篩選抽屜底部的「完成」（只關閉；稿的浮層點外面關）',
        source: `${rule('R5')}「手機的篩選面板：貼底抽屜」2026-11-03；#2206 issuecomment-6593157592`,
      },
      {
        status: '文案',
        widths: [360],
        pop: 'filt',
        a6: 'landmark:popover\\[\\]$',
        reason: '手機篩選抽屜以標題「篩選」為可及名稱（aria-labelledby），稿的浮層沒有名稱',
        source: `${rule('R5')}「手機的篩選面板：貼底抽屜」2026-11-03；#2208 二讀`,
      },
      {
        // 「篩選」鈕被「新增學生」「⋯」推到左邊，貼著它開的浮層跟著左移
        status: '位置',
        pop: 'filt',
        a6: 'landmark:popover\\[\\]$',
        reason: '連帶：「新增學生」「⋯」留在工具列，「篩選」鈕與它的浮層往左',
        source: rule('R2'),
      },
      {
        // 列的代表樣式取最常見的列：seed 今天有課的學生少（國三 8 位裡 1 位），多數列沒有到班字，
        // 名字那段就成了連結裡唯一的字、被併回連結量（16px／600 是名字的字）。稿多數列有到班字，量的是連結本身
        status: '樣式',
        a6: '>row>control:link$',
        detail: '^fontSize 14px → 16px；fontWeight 400 → 600；lineHeight 21px → 24px$',
        reason: '資料：多數列今天沒課、沒有到班字，名字的字級被併回連結',
        source:
          'tools/a6-conformance/README.md（列內 part 取最常見那種；包一層文字的 span 併回外層控制項）',
      },
      {
        // 稿第 2 章有一位暫停（何芷涵）；量測頁第一頁的 seed 學生沒有暫停的。樣式跟待繳費同一組（students.page.html 的 flag）
        status: '缺',
        a6: '>text:span>text:span\\[暫停\\]$',
        reason: '資料：量測頁沒有暫停的學生',
        source: 'tools/a6-conformance/README.md（列內條件式：可能隨資料）',
      },
      {
        // 到班字的代表樣式取最常見的列：量測時刻過了上課時間，seed 今天有課的多半「該到沒到」（紅、600）；稿多半「16:41 到」
        status: '樣式',
        a6: '>control:link>text:span~2$',
        detail: '^fontWeight 400 → 600；color rgb\\(87, 80, 75\\) → rgb\\(185, 28, 28\\)$',
        reason: '資料：量測時刻今天有課的人多半該到沒到（紅字是稿 `.who--missing` 的樣式）',
        source: 'tools/a6-conformance/README.md（列內 part 取最常見那種）',
      },
      {
        // 手機：列尾「⋯」（R2）跟名字連結並排，列要 flex、分隔線畫在列上（稿畫在連結上），到班字往左讓出按鈕寬
        status: '樣式',
        app: '(>list>row|>row>control:link|>control:link>text:span~2)$',
        detail: '(borderBottom|display block → flex|相對所在列 Δx -\\d+、Δy 0)',
        reason: '連帶：列尾「⋯」與連結並排，分隔線畫在列上',
        source: rule('R2'),
      },
      {
        status: '位置',
        app: '(>list>row|>row>control:link|>control:link>text:span~2)$',
        detail: '(borderBottom|display block → flex|相對所在列 Δx -\\d+、Δy 0)',
        reason: '連帶：列尾「⋯」與連結並排，分隔線畫在列上',
        source: rule('R2'),
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
      // 「一次勾：」那列（#2140 起桌機勾第一堂就出現）：完成鈕照工具列控制項同高、兩個下拉是 A6 下拉元件
      {
        status: '尺寸',
        a6: '>landmark:main\\[\\]>control:button\\[完成\\]$',
        detail: '^高 30→40$',
        reason: '灰帶工具列控制項全部同高：桌機 40',
        source: `${rule('R5')}「灰帶工具列控制項高度」2026-10-23；#1903`,
      },
      {
        status: '多',
        app: '>landmark:main\\[\\]>control:combobox\\[(某位老師這週的課|某個班整期的課)\\]$',
        reason: SELECT_FIELD,
        source: SELECT_FIELD_SOURCE,
      },
    ],
  },
  billing: {
    a6: 'billing.html',
    app: '/admin/payments',
    // 收款彈窗（#2316 寫期別、#2290 換殼）：稿列上的「收款」↔ app 列上的「收款」（DynamicDialog）
    // 稿的「收款」鈕在收合的章節裡（逾期列是「提醒」），先展開第一個章節再點
    a6Open: { pay: { click: ['details.coll > summary', '[data-pay]'], root: 'dialog[open]' } },
    appOpen: {
      pay: {
        click: 'button[aria-label^="記錄 "]',
        root: '.p-dialog:has(app-payment-form-dialog)',
      },
    },
    deviations: [
      // #2316：收款彈窗標題寫期別、副標加到期日 —— 標題文字變了，工具把稿的 h2 配到別的字上
      ...[
        { status: '文案', a6: '^pop\\[pay\\]>landmark:dialog\\[記錄收款\\]$' },
        {
          status: '文案',
          a6: '>landmark:dialog\\[記錄收款\\]>text:p\\[\\{名\\} ·應繳#元·已收#元·尚欠#元\\]$',
        },
        ...['角色', '位置', '尺寸', '樣式'].map((status) => ({
          status,
          a6: '>landmark:dialog\\[記錄收款\\]>heading:h2\\[記錄收款\\]$',
        })),
      ].map((d) => ({
        ...d,
        pop: 'pay',
        reason: '收款彈窗標題寫期別（「記錄收款 · 11 月學費」）、副標加到期日',
        source: `${rule('R5', '「帳單列寫期別」2026-11-05')}；#2316`,
      })),
      // #2316：逾期章每列多一行期別（稿沒有），列內 span 序號跟著錯開
      ...[
        { status: '樣式', a6: '>landmark:region\\[逾期\\]>row>text:span~2$' },
        { status: '多', app: '>landmark:region\\[逾期\\]>list>row>text:span~3$' },
      ].map((d) => ({
        ...d,
        reason: '每列多一行期別（同一位學生好幾張帳單要分得出來），列內 span 序號錯開',
        source: `${rule('R5', '「帳單列寫期別」2026-11-05')}；#2316`,
      })),
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
      // 本月 seed 還沒開單（billed＝0）：色面那句不報百分比、沒有已收長條（payments.page.ts bandTitle）
      ...[
        { status: '缺', a6: '>landmark:region\\[這一頁的摘要\\]>text:span\\[(已收|還差)\\](>|$)' },
        {
          status: '文案',
          a6: '>landmark:region\\[這一頁的摘要\\]>heading:h1\\[#月應收NT\\$ #，已收#%。\\]$',
        },
      ].map((d) => ({
        ...d,
        reason: '資料：本月還沒開單（應收 0），不報已收百分比、不畫長條',
        source: 'payments.page.ts bandTitle／receivedPct（billed ≤ 0 不報）',
      })),
      {
        status: '位置',
        a6: '>landmark:region\\[逾期\\]>text:p\\[#張\\]>text:span\\[·待收\\]$',
        detail: '^相對「#張」 Δx \\+(1[0-9]|2[0-4])、Δy 0',
        reason: '資料：逾期張數位數不同（稿 9、seed 兩位數），「· 待收」跟著右移',
        source:
          'tools/a6-conformance/README.md:83（文案模板：數字 → #；位數不同造成的位移，工具不扣）',
      },
      // 頁面搜尋框：框畫在 input 上（共用 p-iconfield），稿畫在外層 label.tsearch —— 同 staff、courses
      ...['尺寸', '樣式', '位置'].map((status) => ({
        status,
        a6: '^>control:searchbox\\[搜尋帳單\\]$',
        reason: '頁面搜尋框的框畫在 input 上（全站共用 p-iconfield），稿畫在外層 label',
        source: '全站共用 .clessia-filter-search（p-iconfield）；高度 #1903（使用者 10-23 裁定）',
      })),
      {
        // 稿用「逾期攤開、其他收合」取代狀態篩選；app 另有課程／分校／月份等篩選（舊有新無）
        status: '多',
        app: '>landmark:search\\[帳單搜尋與篩選\\]>control:button\\[篩選：全部\\](>|$)',
        reason: '現況有、稿沒畫：帳單的篩選面板，保留',
        source: `${rule('R2')}`,
      },
      {
        status: '多',
        app: '>landmark:search\\[帳單搜尋與篩選\\]>control:button\\[操作紀錄\\](>|$)',
        reason: '全站「操作紀錄」入口統一成工具列的時鐘圖示鈕',
        source: '使用者 10-23 裁定 #2006（#2014）',
      },
      {
        // 工具列多了篩選、操作紀錄，右側的開立帳單、匯出跟著位移
        status: '位置',
        a6: '^>control:button\\[(開立帳單|匯出)\\]$',
        reason: '連帶：工具列多了篩選與操作紀錄鈕',
        source: `${rule('R2')}；使用者 10-23 裁定 #2006`,
      },
      // 桌機逾期章頭的「全部提醒」：同一顆、同一個理由（要 LINE 推播）。分頁器換成 app-pager
      // （自己是 navigation）後才浮出來（#1314 Z 批）
      {
        status: '缺',
        a6: '>landmark:region\\[逾期\\]>control:button\\[全部提醒（#）\\](>|$)',
        reason: '「全部提醒」要 LINE 推播（不接 LINE Messaging API）',
        source: `${rule('R5')}「學生檔案『傳 LINE』」2026-10-14：不接 LINE Messaging API`,
      },
      // 手機托盤：稿是「開立帳單（白）＋全部提醒（CTA）」；全部提醒要 LINE 推播，不接 LINE Messaging API，
      // 托盤只剩開立帳單，它就是主要動作（CTA 色）
      ...[
        {
          status: '缺',
          a6: '>landmark:toolbar\\[主要動作\\]>control:button\\[全部提醒（#）\\](>|$)',
        },
        { status: '位置', a6: '>landmark:toolbar\\[主要動作\\]>control:button\\[開立帳單\\]$' },
        { status: '樣式', a6: '>landmark:toolbar\\[主要動作\\]>control:button\\[開立帳單\\]$' },
      ].map((d) => ({
        ...d,
        widths: [360],
        reason: '「全部提醒」要 LINE 推播（不接 LINE Messaging API），托盤只剩開立帳單、當主要動作',
        source: `${rule('R5')}「學生檔案『傳 LINE』」2026-10-14：不接 LINE Messaging API`,
      })),
      // 稿列的第二格下面有一行「還沒提醒／M/D 提醒過」（row__sub），要上次提醒日；app 沒有這份資料，
      // 工具把稿的 row__sub 配到 app 的金額格
      ...['位置', '樣式'].map((status) => ({
        status,
        a6: '>landmark:region\\[逾期\\]>row>text:div$',
        reason: '等 API：列的上次提醒日（稿 row__sub「還沒提醒」）；工具把它配到 app 的金額格',
        source: 'payments.page.html 檔頭「沒有上次提醒日」',
      })),
      {
        // app 列尾是「收款＋⋯」兩顆（作廢、列印收費單收在 ⋯，#1420），比稿的一顆寬，第二格跟著右移
        status: '位置',
        widths: [1440],
        a6: '>landmark:region\\[逾期\\]>row>text:span~2$',
        detail: '^相對所在列 Δx \\+([0-9]|[12][0-9]|3[0-2])、Δy [-+]?[0-6]',
        reason: '連帶：列尾動作多一顆「⋯」，第二格較窄',
        source: `${rule('R2')}；#1420`,
      },
      {
        // 列裡的鈕在 flex 容器（invoice-actions）裡、名字旁的年級在 flex 格裡：子元素 display 被 blockify，畫面一樣
        status: '樣式',
        a6: '>landmark:region\\[逾期\\]>row>(control:button|text:span)$',
        detail: '^display (inline-flex → flex|inline → block)$',
        reason:
          '工具限制：flex 子元素的 display 被瀏覽器 blockify（inline-flex→flex、inline→block），外觀相同',
        source: 'CSS Display 3「blockification」',
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
      // 標題下的「用 LINE 登入，不需要記密碼。」拿掉（表單與手機彈窗兩處）
      {
        status: '缺',
        a6: '>text:p\\[用LINE登入，不需要記密碼。\\]$',
        reason: '登入頁標題下的「用 LINE 登入，不需要記密碼。」拿掉',
        source: `${rule('R5')}「登入頁標題下的『用 LINE 登入，不需要記密碼。』」2026-11-03（使用者 11-03）`,
      },
      {
        // 連帶：那行拿掉後，下方的登入鍵與兩句說明上移；桌機的表單在版面裡垂直置中，標題反而下移約一半
        status: '位置',
        a6: 'landmark:main\\[\\]>(heading:h1\\[登入\\]|control:button\\[使用LINE登入\\]|text:p\\[(第一次使用|還沒有帳號)[^\\]]*\\])$',
        reason: '連帶：標題下那行拿掉，下方元素上移；桌機表單垂直置中，標題下移約一半',
        source: `${rule('R5')}「登入頁標題下的『用 LINE 登入，不需要記密碼。』」2026-11-03（使用者 11-03）`,
      },
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
    // 個資使用聲明（同意那一行的連結鈕）：稿用 JS showModal（`[data-privacy]`），app 是原生 dialog（#2290 換殼）
    a6Open: { privacy: { click: '[data-privacy]', root: 'dialog[open]' } },
    appOpen: { privacy: { click: 'button:has-text("個資使用聲明")', root: 'dialog[open]' } },
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
      {
        // 公開表單的課程選項是資料（同 DATA_DEPENDENT 那條）：seed 的組數與項目比稿多，最後那組的列整段往下
        status: '位置',
        a6: '>landmark:region\\[想試聽的課程可以選好幾個\\]>row$',
        detail: '^相對「想試聽的課程可以選好幾個」 Δx 0、Δy \\+',
        reason: '資料：試聽課程的選項（稿的示範課程與 seed 的開課班不同），上面的組多，列往下',
        source: '#1665（公開表單的選項是資料）；tools/a6-conformance/lib/config.mjs DATA_DEPENDENT',
      },
      ...PUBLIC_FORM_DEVIATIONS,
      ...PUBLIC_BRAND_DEVIATIONS,
    ],
  },
  enrollment: {
    a6: 'pub-enrollment.html',
    // 個資使用聲明（同意那一行的連結鈕）：稿用 JS showModal（`[data-privacy]`），app 是原生 dialog（#2290 換殼）
    a6Open: { privacy: { click: '[data-privacy]', root: 'dialog[open]' } },
    appOpen: { privacy: { click: 'button:has-text("個資使用聲明")', root: 'dialog[open]' } },
    app: '/enrollment',
    state: path.join(cache, 'state-guest.json'),
    deviations: [...PUBLIC_FORM_DEVIATIONS, ...PUBLIC_BRAND_DEVIATIONS],
  },
  student: {
    a6: 'student.html',
    // 學生 id 用 supabase/seed.sql 寫死的 v_student_id（61000000-…-001「出勤測試學生01」）；
    // seed-demo 的學生是 gen_random_uuid，reset 一次就換（原本的 e98f234f-… 在 10-31 已經不存在）
    app: '/admin/students/61000000-0000-0000-0000-000000000001',
    deviations: [
      noCampusSwitch('看的是一個學生，跨分校上課也是同一份檔案'),
      // ── 11-02：改用 seed.sql 的固定學生（出勤測試學生01）之後的資料差 ──
      {
        // 家長沒留電話：「打電話」不顯示（計畫席 11-02：沒電話不顯示）
        status: '缺',
        a6: '>landmark:region\\[這一頁的摘要\\]>control:button\\[打電話\\]$',
        reason: '資料：seed 這位的家長沒留電話，「打電話」不顯示',
        source: 'supabase/seed.sql 家長沒有電話；計畫席 11-02',
      },
      {
        status: '缺',
        a6: '>landmark:region\\[這一頁的摘要\\]>control:button\\[傳LINE\\]$',
        reason: '「傳 LINE」不做：產品不接 LINE Messaging API',
        source: `${rule('R5')}「學生檔案『傳 LINE』」2026-10-14`,
      },
      ...[
        {
          status: '文案',
          a6: '>landmark:region\\[這一頁的摘要\\]>(heading:h1\\[\\{名\\}\\]|text:p\\[小五·興隆國小·國小五年級英文班\\])$',
        },
        { status: '文案', a6: '>text:p\\[·下一堂\\]>text:strong\\[[^\\]]+\\]$' },
        {
          status: '位置',
          a6: '>landmark:region\\[這一頁的摘要\\]>text:dd\\[#\\]~2>text:small\\[分\\]$',
        },
        { status: '尺寸', a6: '>landmark:region\\[這一頁的摘要\\]>text:dt\\[最近一次考試\\]$' },
        { status: '樣式', a6: '>landmark:region\\[到班\\]>list>row$' },
      ].map((d) => ({
        ...d,
        reason:
          '資料：seed 的學生（名字、學校、班、今天有課、分數 98.47、到班多數是沒到）跟稿的示範生不同',
        source: 'supabase/seed.sql v_student_id 61000000-…-001',
      })),
      {
        // 沒到超過 3 天只列最近 3 天＋「等 N 天」，完整日期放 title（這位沒到 10 天）
        status: '文案',
        a6: '>landmark:region\\[到班\\]>text:span\\[沒到#天：#\\]$',
        reason: '資料：seed 這位沒到超過 3 天，app 縮成最近 3 天＋等 N 天（完整日期在 title）',
        source: 'student-detail.util.ts absentLine／absentTitle',
      },
      {
        // 這學期的課：整列是 role=button＋Enter／Space（#722 鍵盤操作），班名、時段是列裡的字，
        // 不是稿的 h3＋p
        status: '缺',
        a6: '>landmark:region\\[這學期的課\\]>(heading:h3\\[[^\\]]+\\]|text:p\\[[^\\]]+\\])$',
        reason: '這學期的課整列是可點的按鈕（#722 鍵盤操作），班名不是獨立的 h3',
        source: '#722；student-detail.page.spec.ts「#722 在籍班級列的鍵盤操作」',
      },
      {
        status: '多',
        app: '>landmark:region\\[這學期的課\\]>list>row(>|$)',
        reason: '這學期的課整列是可點的按鈕（#722 鍵盤操作），班名不是獨立的 h3',
        source: '#722；student-detail.page.spec.ts「#722 在籍班級列的鍵盤操作」',
      },
      {
        // 稿的摺疊列只有成績、帳單、紀錄；app 另有家長、基本資料（現況有、稿沒畫）
        status: '多',
        app: '>landmark:main\\[\\]>control:button\\[(家長|基本資料)[^\\]]*\\](>|$)',
        reason: '現況有、稿沒畫：家長、基本資料兩條摺疊列',
        source: `${rule('R2')}`,
      },
      // 手機托盤（page-actions，position: fixed）：同 scores-dirty、checkin
      ...['缺', '樣式'].map((status) => ({
        status,
        widths: [360],
        ...(status === '缺'
          ? { a6: 'landmark:toolbar\\[主要動作\\]>control:button\\[[^\\]]*\\]$' }
          : { app: '^>landmark:main\\[\\]>row(>control:button(>text:span)?)?$' }),
        reason:
          '工具限制：app 的手機托盤（page-actions，position: fixed）被認成「列」、拿掉了鈕名，' +
          '配不上稿的托盤，反而跟稿的手機摺疊列錯配（截圖底部托盤兩顆鈕都在）',
        source: 'tools/a6-conformance extract.mjs isRow；#1925',
      })),
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
    deviations: [
      // 家長詳情、匯入（#2290 換殼）：標頭是共用殼的（h2 20px＋✕ 桌機 40），稿各對話框的標頭高低不一
      ...[
        {
          status: '位置',
          a6: '>landmark:dialog\\[[^\\]]*\\]>(heading:h2\\[[^\\]]*\\]|control:button\\[關閉\\])$',
        },
        {
          status: '尺寸',
          a6: '>landmark:dialog\\[[^\\]]*\\]>control:button\\[關閉\\]$',
          detail: '^寬 32→40$',
        },
      ].flatMap((d) =>
        ['detail', 'import'].map((pop) => ({
          ...d,
          pop,
          reason: '共用殼的標頭（h2＋副標＋✕），全站對話框同一套',
          source: 'kb/wiki/architecture/dialog-frame.md「標頭」「✕」（#2290）',
        })),
      ),
      {
        status: '文案',
        pop: 'detail',
        a6: '>landmark:dialog\\[\\{名\\}\\]>heading:h2\\[\\{名\\}\\]$',
        reason: '工具限制：標題是家長姓名，app 的家長名不在工具的人名表（只收稿的假人名與登入者）',
        source: 'tools/a6-conformance/README.md（文案模板 {名}）',
      },
      // 頁面搜尋框：框畫在 input 上，稿畫在外層 label.tsearch —— 同 students／courses 那條
      ...['尺寸', '樣式', '位置'].map((status) => ({
        status,
        a6: '^>control:searchbox\\[搜尋家長\\]$',
        reason: '頁面搜尋框的框畫在 input 上（全站同款），稿畫在外層 label',
        source: '全站共用 .clessia-filter-search（p-iconfield）；高度 #1903（使用者 10-23 裁定）',
      })),
      {
        status: '位置',
        a6: '^>control:button\\[(篩選|匯入)\\]$',
        reason: '連帶：頁面搜尋框全站同款，寬度不同，「篩選」「匯入」跟著位移',
        source: '全站共用 .clessia-filter-search（p-iconfield）',
      },
      // 稿 98 位家長、13 位「還沒登入過」；seed 一頁 20 位，有人帶 3～4 個孩子、有人沒有孩子
      {
        status: '缺',
        a6: '>list>row>control:button>text:span~2>text:span\\[還沒登入過\\]$',
        reason: '資料：seed 這一頁沒有「啟用中但還沒登入過」的家長',
        source: 'supabase/seed-demo.sql（家長帳號）',
      },
      {
        status: '多',
        app: '>list>row>(control:link~[34]|text:span)$',
        reason: '資料：每位家長的孩子數（第 3、4 個孩子、沒有孩子）',
        source: 'supabase/seed-demo.sql（家長與關聯學生）',
      },
      // 手機孩子連結、「顯示」撐 44（觸控下限），內距與 display 跟著不同
      {
        status: '樣式',
        widths: [360],
        a6: '>list>row>control:link(~2)?$',
        detail: '^padding 0px → 12px 0px$',
        reason: '手機可點元素撐到 44px',
        source: `${rule('R3')}；${hardRule('A27')}`,
      },
      {
        status: '樣式',
        widths: [360],
        a6: '>control:button\\[顯示\\]$',
        detail: '^display inline-block → inline-flex$',
        reason: '手機可點元素撐到 44px',
        source: `${rule('R3')}；${hardRule('A27')}`,
      },
      {
        // PrimeNG 純圖示鈕沒有 gap（只有一個圖示，畫面一樣）
        status: '樣式',
        a6: '>list>row>control:button~2$',
        detail: '^rowGap 6px → 0px；columnGap 6px → 0px$',
        reason: '工具限制：⋯ 只有一個圖示，gap 不影響畫面',
        source: 'parents.html .prow__more 繼承 .btn 的 gap；app 是 p-button 純圖示',
      },
      {
        // 稿 98 位家長、頁面很長，置中對話框量成「相對視窗底」差 2800px
        status: '位置',
        pop: 'new-parent',
        widths: [1440],
        a6: 'landmark:dialog\\[新增家長\\]$',
        reason: '工具限制：兩邊清單長度不同，置中對話框的位置量法失真',
        source: 'tools/a6-conformance/README.md（彈出物根：距頁頂與距視窗底取差小的）',
      },
      // 新增家長：關聯學生是遠端搜尋的 autocomplete（學生數多，不一次載完整份選項），
      // 選了的學生是框裡的小標籤清單；稿是 a6.js 的下拉＋框下的小標籤
      ...[
        { status: '缺', a6: 'control:button\\[選擇：輸入姓名搜尋，可以選多位\\](>.*)?$' },
        { status: '多', app: '>list>row$' },
      ].map((d) => ({
        ...d,
        pop: 'new-parent',
        reason: '關聯學生用遠端搜尋的 autocomplete（combobox），選了的學生是框裡的標籤清單',
        source: `${rule('R7')}；同學生篩選的 app-student-autocomplete（聯絡簿那條）`,
      })),
      // 稿的提示句（Email 和手機至少填一個…）是 JS 插在 Email 欄後面，手機因此掉到下一列的左半格；
      // app 照意圖排在 Email、手機兩欄之後 —— 手機與它下面的欄位、提示句都跟著換位置
      {
        status: '位置',
        pop: 'new-parent',
        a6: 'landmark:form\\[\\]>((text:label|control:textbox)\\[(手機|關聯學生|備註)\\*?\\]|text:p\\[Email和手機至少填一個)',
        reason: '提示句排在 Email、手機兩欄之後（稿的插入位置讓手機掉到半格）',
        source:
          '稿的 JS 插入位置在手機會掉到半格，屬於稿的瑕疵，計畫席 10-30 裁定（parents.html parentForm 的 insertAdjacentHTML）',
      },
      // 手機關閉鈕 44（稿 38）
      ...[
        { status: '尺寸', detail: '^寬 38→44$' },
        { status: '位置', detail: '^相對「新增家長」 Δx -6' },
      ].map((d) => ({
        ...d,
        pop: 'new-parent',
        widths: [360],
        a6: 'landmark:dialog\\[新增家長\\]>control:button\\[關閉\\]$',
        reason: '手機關閉鈕 44px（觸控下限）',
        source: `${rule('R3')}；${hardRule('A27')}`,
      })),
    ],
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
      })),
      {
        // 批次選取（#1226 courses C1 Q3 照留）：現況有、稿沒畫，收進工具列「⋯」—— 同帳單那條
        status: '多',
        app: 'control:button\\[更多動作\\]$',
        reason: '工具列「⋯」：現況有、稿沒畫的動作收進「⋯」',
        source: `${rule('R2')}；#1226`,
      },
      // 操作紀錄彈窗：本機 seed 沒有課程的操作紀錄 → app 是空狀態「尚無操作紀錄」（稿也有這句，只是示範資料有 11 筆）
      ...[
        { status: '缺', a6: '(^|>)landmark:dialog\\[操作紀錄\\]>list(>.*)?$' },
        { status: '多', app: '(^|>)landmark:dialog\\[操作紀錄\\]>text:p\\[尚無操作紀錄\\]$' },
        // 彈窗高度隨紀錄筆數（置中的彈窗頂端跟著動）
        { status: '位置', a6: '^pop\\[log\\]>landmark:dialog\\[操作紀錄\\]$', detail: 'Δx 0、' },
      ].map((d) => ({
        ...d,
        pop: 'log',
        reason: '資料：本機沒有課程的操作紀錄，彈窗是空狀態',
        source:
          'courses.html logDialog（LOG 空時同樣寫「尚無操作紀錄」）；#1314 issuecomment-6625976591',
      })),
      {
        // 課程列：稿是 <details><summary>，summary 裡包「新增班」「⋯」按鈕（summary 是按鈕角色，裡面不能再放按鈕）；
        // app 是展開鈕＋並排的動作鈕，每門課一個 region（計畫席 10-30 #2078 同意）。結構不同，課程列裡的子項配不上，一起歸這條
        status: '多',
        app: '>landmark:main\\[\\]>landmark:region\\[[^\\]]*\\]>landmark:region\\[[^\\]]*\\](>.*)?$',
        reason: '課程列結構依元件行為：展開鈕＋並排動作鈕，不把按鈕包進 summary',
        source: `${rule('R7')}；https://github.com/mizok/clessia/pull/2078`,
      },
      // 新增課程表單：分校、科目是 app-select-field（標籤是 aria-labelledby 指到的 span）
      ...selectFieldDeviations('(分校|科目)\\*?').map((d) => ({ ...d, pop: 'new-course' })),
      {
        status: '角色',
        pop: 'new-course',
        a6: 'text:label\\[(分校|科目)\\]$',
        detail: '^text:label → text:span$',
        reason: `${SELECT_FIELD}（標籤是 aria-labelledby 指到的 span）`,
        source: `${SELECT_FIELD_SOURCE}；${rule('R7')}`,
      },
      // 手機關閉鈕 44（稿 40）：標題欄窄 4px，副標換成兩行，關閉鈕跟著垂直置中下移
      ...[
        { status: '位置', a6: 'landmark:dialog\\[新增課程\\]>control:button\\[關閉\\]$' },
        { status: '尺寸', a6: 'landmark:dialog\\[新增課程\\]>text:p\\[課程是', detail: '^高 ' },
      ].map((d) => ({
        ...d,
        pop: 'new-course',
        widths: [360],
        reason: '手機關閉鈕 44px（觸控下限），標題欄因此窄 4px',
        source: `${rule('R3')}；${hardRule('A27')}`,
      })),
      // 新增班級表單（#2089）：下一階班級、時段的星期／任課老師／教室是 app-select-field
      ...selectFieldDeviations('下一階班級|星期|任課老師|教室').map((d) => ({
        ...d,
        pop: 'new-class',
      })),
      ...[
        {
          status: '缺',
          a6: 'control:button\\[(下一階班級|教室)：[^\\]]*\\]>text:span\\[[^\\]]*\\]$',
        },
        { status: '文案', a6: 'control:button\\[教室：[^\\]]*\\]$', app: 'dropdown trigger' },
        { status: '多', app: 'control:combobox\\[(下一階班級|教室|星期|任課老師)\\]$' },
        // 稿的標籤是 label 包住 .dd 按鈕（名稱帶隱藏的必填 *）；app-select-field 的標籤是 span，稿的 label 只能依位置配到別的欄位
        ...['缺', '文案', '位置', '樣式'].map((status) => ({
          status,
          a6: 'text:label\\[(下一階班級|星期|任課老師|教室)\\](>control:button\\[[^\\]]*\\])?$',
        })),
        // 對面那一半：app-select-field 的標籤 span（字級照稿：下一階班級 13、時段裡 12，都是 600 zinc-700）
        {
          status: '多',
          app: 'landmark:dialog\\[新增班級\\]>text:span\\[(下一階班級|星期|任課老師|教室)\\]$',
        },
      ].map((d) => ({ ...d, pop: 'new-class', reason: SELECT_FIELD, source: SELECT_FIELD_SOURCE })),
      {
        // 必填星號照稿畫在標籤後，但全站慣例是 aria-hidden（讀屏不念，必填由底部「還沒填：…」說）；
        // 工具不抽 aria-hidden 的元素，所以量成「缺」
        status: '缺',
        pop: 'new-class',
        a6: 'text:(label|p)\\[(開課班名稱|人數上限|上課時段)\\]>text:span\\[\\*\\]$',
        reason: '必填星號有畫，但 aria-hidden（讀屏不念，必填由「還沒填：…」說），工具量不到',
        source:
          'apps/web/src/app/shared/components/select-field/select-field.component.ts:56（全站表單同款星號）；tools/a6-conformance/lib/extract.mjs:93',
      },
      // 時段老師選填（計畫席 11-02）：沒選時下拉的提示字是「還沒排老師」（稿「選一位老師」）
      {
        status: '文案',
        pop: 'new-class',
        a6: 'control:button\\[任課老師：選一位老師\\]',
        reason: '時段老師選填：沒選時寫「還沒排老師」',
        source: `${rule('R5')}「班級表單的時段老師選填」2026-11-02（計畫席 11-02：D4 時段可無老師，必填會擋建班）`,
      },
      // 新增班級表單：稿沒畫、照 R2 保留的欄位（公開報名、目錄參考價、班級起訖日），收在同一個整列區塊
      {
        status: '多',
        pop: 'new-class',
        app: 'landmark:dialog\\[新增班級\\]>(text:p\\[(公開報名|關掉之後|家長目錄顯示|兩邊都填)[^\\]]*\\]|text:label\\[(開放公開報名|開始日期（選填）|結束日期（選填）)\\]|control:(checkbox|textbox)\\[(開放公開報名|開始日期（選填）|結束日期（選填）)\\]|text:span\\[目錄參考價\\]|control:combobox\\[目錄參考價\\]|text:label\\[開放公開報名\\]>control:checkbox\\[開放公開報名\\])$',
        reason: '班級表單的公開報名、目錄參考價、起訖日：現況有、稿沒畫，保留',
        source: `${rule('R2')}；目錄參考價 https://github.com/mizok/clessia/issues/2089#issuecomment-6517351682`,
      },
      // 舊有新無：適合年級（API 必填），「還沒填」那句跟著多一項
      ...[
        { status: '多', app: 'text:(span|div)\\[(適合年級|選擇適合年級（至少一項）)\\]$' },
        { status: '文案', app: 'text:p\\[還沒填：[^\\]]*適合年級\\]$' },
      ].map((d) => ({
        ...d,
        pop: 'new-course',
        reason: '課程表單的「適合年級」：現況有、稿沒畫，保留',
        source: `${rule('R5')}「課程表單的適合年級、管理科目、停用模式」2026-10-30`,
      })),
    ],
  },
  class: {
    a6: 'class.html',
    // 班級 id 用 supabase/seed.sql 寫死的 math_class_id（62000000-…-001「數學班 A」）—— 不用 seed-demo 的班：
    // 那些是 gen_random_uuid，reset 一次就換，下一個人量到的是「找不到這個班」（10-31 實例）。
    // 課程 id seed.sql 也是隨機的；網址的 courseId 段頁面沒讀（class-detail.page.ts resolvedCourseId 沒有讀者），放佔位字串
    app: '/admin/courses/seed-course/classes/62000000-0000-0000-0000-000000000001',
    // 產生課堂（#2290 courses）：稿 genDialog 是原生 dialog.acset.fdlg；app 是 DialogService（共用殼）。
    // 課程頁的 gen 要先有「需介入」的班，seed 在稿的時間點沒有，量不到 —— 改在這裡量。
    // 名單的加入學生、Excel 匯入：稿是 A2.form（dialog.fdlg）。稿的「複製名單」是複製到剪貼簿，
    // 跟 app 的「從其他班複製」不是同一件事，不量
    a6Open: {
      gen: { click: '[data-gen]', root: 'dialog[open]' },
      add: { click: '[data-add]', root: 'dialog[open]' },
      import: { click: '[data-import]', root: 'dialog[open]' },
    },
    appOpen: {
      gen: { click: 'button:has-text("產生課堂")', root: '.p-dialog:has(app-generate-sessions-dialog)' },
      add: { click: 'button:has-text("加入學生")', root: '.p-dialog:has(app-student-picker-dialog)' },
      import: { click: 'button:has-text("Excel 匯入")', root: '.p-dialog:has(app-roster-import-dialog)' },
    },
    deviations: [
      // 加入學生、Excel 匯入的關閉鈕：手機 44×44（稿 34／35 寬）
      ...['add', 'import'].flatMap((pop) =>
        [
          { status: '尺寸', widths: [360], detail: '^寬 3\\d→44$' },
          { status: '位置', widths: [360] },
        ].map((d) => ({
          ...d,
          pop,
          a6: '>landmark:dialog\\[[^\\]]*\\]>control:button\\[關閉\\]$',
          reason: '可點元素基底 ≥44px',
          source: `${rule('R3')}`,
        })),
      ),
      noCampusSwitch('一個班只屬於一間分校，頂欄切到別的分校會跟頁面矛盾'),
      // 量的是 seed.sql 的「數學班 A」，稿是「國三數學A班」：班名不同，狀態標跟著位移
      {
        status: '文案',
        a6: 'heading:h1\\[國三數學A班開班中\\]$',
        reason: '資料：班名（seed.sql 固定 id 的班是「數學班 A」）',
        source: 'supabase/seed.sql math_class_id',
      },
      {
        status: '位置',
        a6: 'heading:h1\\[國三數學A班開班中\\]>text:span\\[開班中\\]$',
        detail: '^相對「國三數學A班開班中」 Δx -\\d+、Δy [-+]?[0-2]（app − A6）$',
        reason: '資料：班名較短，狀態標跟著左移',
        source: 'supabase/seed.sql math_class_id',
      },
      {
        // 副標：課程名不同（seed 的課），年級在子 span 裡（見下一條），所以 p 本身的字只剩「適合年級」
        status: '文案',
        a6: '>text:p\\[國三數學· \\{分校\\} ·適合年級國三\\]$',
        reason: '資料：課程名（seed.sql 的數學課）；年級在子 span 裡',
        source: 'supabase/seed.sql math_course_id',
      },
      {
        // 上課時段的標籤後面帶上課期間（起訖日）：現況有、稿沒畫，保留
        status: '文案',
        a6: '>landmark:region\\[這一頁的摘要\\]>text:dt\\[個上課時段\\]$',
        detail: '^「個上課時段」→「個上課時段· [^」]+」$',
        reason: '現況有、稿沒畫：上課時段後面寫上課期間',
        source: `${rule('R2')}`,
      },
      {
        // 稿的 `.sec__head .btn { margin-left: auto }`（給只有一顆鈕的章頭用）也套到 .sec__tools 裡的三顆鈕，
        // 手機一列放得下時，自動邊距把鈕撐開（間距 13～14、第一顆內縮 6）；app 照 .sec__tools 的 gap 8 靠左
        status: '位置',
        widths: [360],
        a6: '>landmark:region\\[#位學生\\]>control:button\\[(複製名單|Excel匯入)\\]$',
        detail: '^相對「#位學生」 Δx -(1[0-9]|2[0-4])、Δy [-+]?[0-2]',
        reason: '稿的 bug：章頭單顆鈕的 margin-left:auto 也套到工具組裡的鈕，手機上鈕被撐開',
        source:
          'class.html `.sec__head .btn { margin-left: auto }` 與 `.sec__tools { gap: var(--space-2) }`',
      },
      {
        // 每個年級包一個 span 當 spec 掛點（data-part=grade），文字與稿相同；課程有 ≥3 個年級時同形 span 被認成一列
        status: '多',
        app: '>text:p\\[[^\\]]*適合年級\\]>(text:span\\[[^\\]]+\\]|row)$',
        reason: '工具限制：副標的年級各包一個 span（spec 掛點 data-part=grade），文字與稿相同',
        source: 'class-detail.page.spec.ts data-part=grade',
      },
      {
        // 名單裡名字沒有數字的列（張宇軒、聯絡簿缺漏示範生）簽名跟「出勤測試學生#」那組不同，沒併進資料差
        status: '多',
        app: '>landmark:region\\[#位學生\\]>control:button\\[[^\\]#]+：看學生檔案\\](>|$)',
        reason: '資料：seed 的名單列，名字沒有數字的那幾列另成一組',
        source: 'tools/a6-conformance/README.md（列是同層同簽名）',
      },
    ],
  },
  dashboard: {
    a6: 'dashboard.html',
    app: '/admin/dashboard',
    // 稿的今天（shared/data.js：2026-10-01 17:40，週四），同 p-schedule（#1314 10-30）
    clock: '2026-10-01T17:40:00+08:00',
    // 櫃台代刷到班（#2314）：兩邊都是原生 showModal；桌機工具列鈕、手機托盤／dock 鈕都帶這幾個字
    a6Open: { checkin: { click: '[data-checkin]', root: 'dialog[open]' } },
    appOpen: { checkin: { click: 'button:has-text("櫃台代刷")', root: 'dialog[open]' } },
    deviations: [
      // ── 櫃台代刷到班（#2314）──
      // 學生：app-select-field（p-select）對稿的 .dd；稿的按鈕名「選擇：…」跟 app 的 trigger 錯配
      ...selectFieldDeviations('選擇|學生（今天還沒到的）\\*').map((d) => ({ ...d, pop: 'checkin' })),
      ...[
        { status: '角色', a6: '>landmark:form\\[\\]>text:label\\[學生（今天還沒到的）\\]$' },
        ...['文案', '位置', '樣式'].map((status) => ({
          status,
          a6: '>landmark:form\\[\\]>control:button\\[選擇：[^\\]]*\\]$',
        })),
      ].map((d) => ({ ...d, pop: 'checkin', reason: SELECT_FIELD, source: SELECT_FIELD_SOURCE })),
      // 稿的「到班時間」欄不畫：API 用伺服器時間記到班
      ...['text:label\\[到班時間\\]', 'control:textbox\\[到班時間\\*\\]'].map((part) => ({
        status: '缺',
        pop: 'checkin',
        a6: `>landmark:form\\[\\]>${part}$`,
        reason: '到班時間一律是伺服器收到的時間，不畫可填的欄',
        source: `${rule('R5')}「櫃台代刷到班對話框不畫「到班時間」」2026-11-05；#2314`,
      })),
      {
        status: '尺寸',
        pop: 'checkin',
        widths: [360],
        a6: '>landmark:dialog\\[櫃台代刷到班\\]>control:button\\[關閉\\]$',
        detail: '^寬 39→44$',
        reason: '可點元素基底 ≥44px（同直接報名的關閉鈕）',
        source: `${rule('R3')}`,
      },
      {
        // #2057（保留類，已合）：改時段改成「從某天起」，不再是整期一起改（#2246 放回捷徑時照用）
        status: '文案',
        a6: '整期一起改\\]$',
        reason: '產品功能改了：班級改時段是從某天起生效，不是整期一起改',
        source: 'https://github.com/mizok/clessia/pull/2057（#1100 #22）',
      },
      {
        // 該到沒到（#2264）：單一分校只剩 1 位，他的家長沒留電話 →「打給家長」不顯示（spec），右邊的「登記請假」
        // 往左補上那顆的寬＋間距（168＋8）。工具的連帶只算到 168，差 gap 的 8 不夠，所以在這裡登記
        status: '位置',
        widths: [360],
        app: '>landmark:region\\[該到沒到的#位，先打給家長\\]>control:button\\[登記請假\\]$',
        detail: 'Δx -17\\d',
        reason: '資料：這位的家長沒留電話，「打給家長」不顯示，「登記請假」往左補位',
        source: 'kb/wiki/specs/admin/dashboard.md:55（沒有家長電話就不給「打電話」）；計畫席 11-02',
      },
      {
        // 該到沒到：稿 2 位、seed 在稿的今天（10-01 17:40）有 6 位 —— ≥3 才成清單列，兩邊一邊成列一邊不成，列內配不上
        status: '缺',
        a6: '>landmark:region\\[該到沒到的#位，先打給家長\\]>[^>]+$',
        reason: '資料：稿該到沒到 2 位不成清單列，seed 6 位成列',
        source: 'tools/a6-conformance/README.md（列是資料：≥3 或 ≥5 個同簽名才合成 row）',
      },
      {
        status: '多',
        app: '>landmark:region\\[該到沒到的#位，先打給家長\\]>row(>.*)?$',
        reason: '資料：稿該到沒到 2 位不成清單列，seed 6 位成列',
        source: 'tools/a6-conformance/README.md（列是資料：≥3 或 ≥5 個同簽名才合成 row）',
      },
      {
        // 工具列的「登記請假」：稿頁面上有三顆同名鈕（工具列＋兩列），seed 的列進了清單列，剩下的配對錯開
        status: '缺',
        a6: '^>control:button\\[登記請假\\]$',
        reason: '連帶：該到沒到列數不同（資料），同名的「登記請假」配不上',
        source: 'tools/a6-conformance/README.md（列是資料）',
      },
      {
        status: '多',
        app: '>landmark:main\\[\\]>control:button\\[登記請假\\]$',
        reason: '連帶：該到沒到列數不同（資料），同名的「登記請假」配不上',
        source: 'tools/a6-conformance/README.md（列是資料）',
      },
      {
        status: '位置',
        a6: '^>control:button\\[櫃台代刷到班\\]$',
        detail: '連帶自待修「control:button\\[登記請假\\] 缺」',
        reason: '連帶：同上',
        source: 'tools/a6-conformance/README.md（列是資料）',
      },
      {
        // 同 scores-dirty：app 的手機托盤（page-actions，position: fixed）抽不到，截圖底部兩顆都在
        status: '缺',
        widths: [360],
        a6: 'landmark:toolbar\\[主要動作\\]>control:button\\[[^\\]]*\\]$',
        reason: '工具限制：app 的手機托盤抽不到（截圖底部「櫃台代刷」「登記請假」都在）',
        source: 'tools/a6-conformance extract.mjs；同 scores-dirty（#1925）',
      },
      {
        // 同一件事的另一面：托盤兩顆鈕跟三條摺疊列被併成同一組「列」，代表樣式取到托盤鈕
        status: '樣式',
        widths: [360],
        app: '^>landmark:main\\[\\]>row>control:button$',
        reason: '工具限制：手機托盤的鈕跟摺疊列併成同一組列，代表樣式取錯',
        source: 'tools/a6-conformance extract.mjs isRow；同 scores-dirty（#1925）',
      },
      {
        // 機構名是資料（稿「晨曦文理補習班」、seed「Demo 補習班」），分校小字跟著名字寬度位移
        status: '文案',
        a6: 'heading:h1\\[晨曦文理補習班\\{分校\\}\\]$',
        reason: '資料：機構名',
        source: 'seed.sql（organizations）',
      },
      {
        status: '位置',
        a6: 'heading:h1\\[晨曦文理補習班\\{分校\\}\\]>text:span\\[\\{分校\\}\\]$',
        reason: '資料：機構名寬度不同，旁邊的分校小字跟著位移',
        source: 'seed.sql（organizations）',
      },
    ],
  },
  enrollments: {
    a6: 'enrollments.html',
    app: '/admin/enrollments',
    // 直接報名（#1314 EN2）：兩邊都是原生 showModal 的表單對話框
    a6Open: { direct: { click: '[data-direct]', root: 'dialog[open]' } },
    appOpen: { direct: { click: '[data-testid="direct-enroll"]', root: 'dialog[open]' } },
    deviations: [
      // ── 直接報名對話框（#1314 EN2）──
      // 開課班：app-select-field（p-select）對稿的 .dd；學生：有建議清單＝combobox（R7，同頁面篩選）
      ...[
        { status: '缺', a6: '>control:button\\[選擇：選一個班\\]>text:span\\[選一個班\\]$' },
        { status: '角色', a6: '>landmark:form\\[\\]>text:label\\[開課班\\]$' },
        { status: '多', app: '>landmark:form\\[\\]>control:combobox\\[開課班\\*\\]$' },
        ...['文案', '位置', '樣式'].map((status) => ({
          status,
          a6: '>landmark:form\\[\\]>control:button\\[選擇：選一個班\\]$',
        })),
      ].map((d) => ({ ...d, pop: 'direct', reason: SELECT_FIELD, source: SELECT_FIELD_SOURCE })),
      ...[
        ...['角色', '位置', '尺寸', '樣式'].map((status) => ({
          status,
          a6: '>control:button\\[選擇：輸入姓名搜尋\\]>text:span\\[輸入姓名搜尋\\]$',
        })),
        ...['文案', '位置', '樣式'].map((status) => ({
          status,
          a6: '>landmark:form\\[\\]>control:button\\[選擇：輸入姓名搜尋\\]$',
        })),
      ].map((d) => ({
        ...d,
        pop: 'direct',
        reason: 'ARIA 角色依元件行為：學生欄有建議清單＝combobox（app-student-autocomplete）',
        source: `${rule('R7')}`,
      })),
      // 稿的「繳費單」欄＝SD9，不畫
      {
        status: '缺',
        pop: 'direct',
        a6: '>landmark:form\\[\\]>text:label\\[(繳費單|建立繳費單（待繳費）|不建立（已收款或免費）)\\](>control:radio\\[[^\\]]*\\])?$',
        reason: '直接報名不畫「繳費單」欄（SD9 #2296），建正式報名',
        source: `${rule('R5', '「直接報名不畫繳費單欄」2026-11-05')}`,
      },
      // 生效迄可留白＋說明；多一欄「費用方案」—— 下面的欄位跟著往下
      ...[
        { status: '文案', a6: '>landmark:form\\[\\]>control:textbox\\[生效迄\\*\\]$' },
        {
          status: '多',
          app: '>landmark:form\\[\\]>(text:p\\[留白＝讀到退班為止\\]|text:span\\[費用方案\\]|control:combobox\\[費用方案\\])$',
        },
        {
          status: '位置',
          a6: '>landmark:form\\[\\]>(text:label\\[生效[起迄]\\]|control:textbox\\[生效[起迄]\\*\\])$',
        },
        {
          status: '位置',
          a6: '>landmark:dialog\\[直接報名\\]>(text:p\\[[^\\]]*\\]|control:button\\[(取消|報名)\\])$',
        },
      ].map((d) => ({
        ...d,
        pop: 'direct',
        reason: '生效迄可留白（多一行說明）、多一欄同模式的費用方案',
        source: `${rule('R5', '「直接報名：生效迄可留白、手機入口在工具列」2026-11-05')}`,
      })),
      {
        status: '樣式',
        pop: 'direct',
        a6: '>landmark:form\\[\\]>control:textbox\\[生效起\\*\\]$',
        detail: '^borderTop 1px solid rgb\\(26, 22, 20\\)',
        reason:
          '稿開窗時把焦點放在第一個原生 input（生效起，前面的欄位是 .dd 按鈕），量到焦點框色；app 不搶焦點',
        source: 'a6.js form()：first.focus()',
      },
      // 關閉鈕：手機 44×44（稿 39 寬）；稿是 UA 預設 padding
      ...[
        { status: '尺寸', widths: [360], detail: '^寬 39→44$' },
        { status: '位置', widths: [360] },
        { status: '樣式', detail: '^padding 1px 6px → 0px$' },
      ].map((d) => ({
        ...d,
        pop: 'direct',
        a6: '>landmark:dialog\\[直接報名\\]>control:button\\[關閉\\]$',
        reason: '可點元素基底 ≥44px；稿的 padding 是 UA 預設（同分校表單的關閉鈕）',
        source: `${rule('R3')}`,
      })),
      // #2290 換殼：殼的內距在內容區外層（.dialog-frame__body），稿在 form 上 —— 全站那兩條只涵蓋桌機 24px；
      // 這裡補 form 本身的位移與手機 16px（同一份裁定）
      ...[
        {
          status: '位置',
          a6: '>landmark:dialog\\[直接報名\\]>landmark:form\\[\\]$',
          detail: '^相對「直接報名」 Δx \\+(16|24)、Δy \\+(8|9|1[01])（',
        },
        {
          status: '樣式',
          a6: '>landmark:dialog\\[直接報名\\]>landmark:form\\[\\]$',
          item: '^padding 8px (16|24)px 24px → 0px$',
        },
        {
          status: '位置',
          widths: [360],
          a6: '>landmark:form\\[\\]>',
          detail: '^相對「form」 Δx -16、Δy -(8|9)（',
        },
      ].map((d) => ({
        ...d,
        pop: 'direct',
        reason: '殼的內距在內容區外層（.dialog-frame__body），稿在 form 上，幾何相同',
        source:
          'https://github.com/mizok/clessia/issues/2290#issuecomment-6660276130（計畫席裁定）',
      })),
      // 手機：選第一欄後少一行（稿 .dd 的占位字）、多一欄方案 —— 計費模式那排與底部按鈕跟著位移
      ...[
        {
          status: '位置',
          widths: [360],
          a6: '>landmark:form\\[\\]>(text:label\\[(計費模式|開課班)\\]|row)$',
        },
      ].map((d) => ({
        ...d,
        pop: 'direct',
        reason: '連帶：學生欄是 combobox（高度不同）、開課班是 app-select-field',
        source: `${rule('R7')}；${SELECT_FIELD_SOURCE}`,
      })),
      // 期間、開課班、事件、狀態：稿是原生 select（a6.js 換成 .dd 按鈕），app 是 p-select（combobox＋箭頭鈕）
      ...selectFieldDeviations('期間|開課班|事件|狀態'),
      ...[
        { status: '缺', a6: '>control:button\\[近#天：近#天\\](>text:span\\[[^\\]]*\\])?$' },
        { status: '缺', a6: '>landmark:search\\[\\]>row>(text:span|control:button>text:span)$' },
        ...['位置', '樣式'].map((status) => ({
          status,
          a6: '>landmark:search\\[\\]>row>control:button$',
        })),
        { status: '多', app: '>landmark:search\\[篩選報名紀錄\\]>row>control:combobox$' },
      ].map((d) => ({ ...d, reason: SELECT_FIELD, source: SELECT_FIELD_SOURCE })),
      // 學生篩選有建議清單（app-student-autocomplete）＝combobox，同 contact-book
      ...[
        { status: '缺', a6: '>landmark:search\\[\\]>control:searchbox\\[學生新\\]$' },
        { status: '多', app: '>landmark:search\\[篩選報名紀錄\\]>control:combobox\\[輸入姓名\\]$' },
      ].map((d) => ({
        ...d,
        reason: 'ARIA 角色依元件行為：有建議清單的搜尋是 combobox',
        source: `${rule('R7')}`,
      })),
      {
        status: '文案',
        a6: '>landmark:main\\[\\]>landmark:search\\[\\]$',
        reason: '語意結構依內容：篩選區是有名字的 search landmark',
        source: `${rule('R7', '，#1590')}`,
      },
      // 列尾 ⋯（EN1）：手機 44×44（稿 36），靠右、跨兩行置中 —— 寬多 8 往左，兩行 44px 的連結把列撐高，置中點往下
      {
        status: '尺寸',
        widths: [360],
        a6: '>landmark:main\\[\\]>row>control:button$',
        detail: '^寬 36→44$',
        reason: '可點元素基底 ≥44px：⋯ 是方形鈕，寬跟著高',
        source: `${rule('R3')}`,
      },
      {
        status: '位置',
        widths: [360],
        a6: '>landmark:main\\[\\]>row>control:button$',
        detail: '^相對所在列 Δx -8、Δy \\+(1[0-9]|2[0-4])（',
        reason: '連帶 R3：鈕寬 44 靠右（Δx -8）；列內連結手機 44px 高，列變高、跨兩行置中的鈕往下',
        source: `${rule('R3')}`,
      },
      // EN2（直接報名）已裁先做不開帳單的版本（11-05），還沒做
      ...[
        { status: '缺', a6: '>control:button\\[直接報名新\\]$' },
        { status: '缺', a6: '>landmark:toolbar\\[主要動作\\]>control:button\\[直接報名\\]$' },
      ].map((d) => ({
        ...d,
        reason: 'EN2 未做：「直接報名」',
        source: '#1314 issuecomment-6647075054（11-05 裁定 EN2 先做不開帳單的版本）',
      })),
      // seed 近 30 天只有一筆退班：沒有新報名／暫停的 pill、不滿一頁，工具把稿的 pill 配到別的 span
      { status: '缺', a6: '>landmark:main\\[\\]>landmark:navigation\\[分頁\\](>.*)?$' },
      ...['位置', '樣式'].map((status) => ({
        status,
        a6: '>landmark:main\\[\\]>row>text:span\\[(新報名|暫停)\\]$',
      })),
    ]
      .map((d) =>
        d.reason
          ? d
          : {
              ...d,
              reason: '資料：seed 近 30 天只有一筆退班',
              source: 'supabase/seed-demo.sql（報名事件日期）',
            },
      )
      .concat([
        // 退班的註記（辦理退班／到期結束）：稿只有一種退班 pill，app 多一行分開兩者；列內 span 序號跟著錯開
        ...['位置', '樣式'].map((status) => ({
          status,
          a6: '>landmark:main\\[\\]>row>(text:span~3|text:div)$',
          reason: '現況有、稿沒畫：退班註記一行（辦理退班／到期結束），列內 span 序號錯開',
          source: `${rule('R2')}；enrollments.page.html event-note`,
        })),
        {
          status: '多',
          app: '>heading:h1\\[[^\\]]*\\]>text:span\\[[^\\]]*\\]$',
          reason:
            '工具限制：標題文字包一個 span 當 spec 掛點（data-testid=hero-title），文字與稿相同',
          source: 'enrollments.page.spec.ts hero-title',
        },
        {
          status: '文案',
          a6: '>landmark:main\\[\\]>text:p\\[共筆·新報名# ·退班# ·暫停# ·作廢#\\]$',
          reason:
            '工具限制：事件數各包一個 span（spec 掛點 event-count），工具把它們當列抽走，文字與稿相同',
          source: 'enrollments.page.spec.ts event-count',
        },
        {
          status: '多',
          app: '>landmark:main\\[\\]>(text:p\\[共筆\\]>row|list>row>text:div>text:span)$',
          reason:
            '工具限制：事件數、經手人那一行各包 span（spec 掛點 event-count／handler-text），稿是純文字與 <br>',
          source: 'enrollments.page.spec.ts event-count、handler-text',
        },
      ]),
  },
  leave: {
    a6: 'leave.html',
    app: '/admin/leave',
    a6Open: opensOf('leave', 'a6Open'),
    appOpen: opensOf('leave', 'appOpen'),
    deviations: [
      // 批次請假的課堂：app-select-field 對稿的 .dd（#2325，全站同一套）
      ...selectFieldInDialog('batch', '課堂', '選擇'),
      // 登記請假（#2318）：app 的日期、要請假的課、原因三格同層同子元素數，被工具合成一列（README「列是資料」的 div 格線規則）；
      // 稿同樣的三格沒觸發，於是「要請假的課」與空狀態那句報缺、app 報多一列 —— 內容與樣式照稿（.pick、.pick__none）
      ...[
        {
          status: '缺',
          a6: '>landmark:dialog\\[登記請假\\]>text:p\\[(要請假的課|先選學生，這裡會列出他那天的課。)\\]$',
        },
        { status: '多', app: '>landmark:dialog\\[登記請假\\]>row(>.*)?$' },
      ].map((d) => ({
        ...d,
        pop: 'new-leave',
        reason: '工具限制：同層三格被當成資料列，配對錯開',
        source: 'tools/a6-conformance/README.md（part key：列是資料）',
      })),
      // 登記請假（#2318）：手機內容左右 16（殼的規格，稿 24），欄位寬 +16
      {
        status: '尺寸',
        widths: [360],
        pop: 'new-leave',
        a6: '>landmark:dialog\\[登記請假\\]>(text:label|control:textbox)\\[[^\\]]*\\]$',
        detail: '^寬 312→328$',
        reason: '對話框手機內容左右 16（共用殼），稿 24',
        source: `${rule('R5', '「對話框手機內容左右 16」2026-11-05')}`,
      },
      // 登記請假（#2318）：分校、年級兩個篩選（縮小學生搜尋）現況有、稿沒有，不刪；下面的欄位跟著往下
      ...[
        {
          status: '多',
          app: '>landmark:dialog\\[登記請假\\]>(text:label\\[(分校|年級)\\]|control:combobox\\[[^\\]]*\\])$',
        },
        {
          status: '位置',
          a6: '>landmark:dialog\\[登記請假\\]>',
          detail: '連帶自待修「control:combobox\\[',
        },
      ].map((d) => ({
        ...d,
        pop: 'new-leave',
        reason: '現況有、稿沒畫：學生欄上的分校、年級篩選（縮小同名學生的搜尋），不刪',
        source: `${rule('R2')}`,
      })),
      {
        // 稿的請假用今天起算的相對日期（leave.html D(n)），所以永遠有今天、明天的章；
        // 本機 seed 的請假是 reset 當天起算，「待處理」分頁今天以後沒有，app 顯示空狀態
        status: '缺',
        a6: '>landmark:main\\[\\]>landmark:region\\[(今天|明天|#)\\](~\\d+)?(>|$)',
        reason: '資料：seed 今天以後沒有請假，沒有日期章',
        source: 'leave.html D(n) 相對日期；supabase/seed-demo.sql 請假是 reset 日起算',
      },
      {
        status: '多',
        app: '>landmark:main\\[\\]>text:p\\[今天和之後都沒有請假。\\]$',
        reason: '資料：seed 今天以後沒有請假，顯示空狀態',
        source: 'leave.html D(n) 相對日期；supabase/seed-demo.sql 請假是 reset 日起算',
      },
      {
        // 空狀態下說明「目前只看哪個分校」（#1138）；稿有資料、沒畫空狀態
        status: '多',
        app: '>landmark:main\\[\\]>text:p\\[目前只看\\{分校\\}，換分校在頂欄。\\]$',
        reason: '現況有、稿沒畫：空狀態的分校範圍提示',
        source: `${rule('R2')}；#1138`,
      },
      {
        // 章裡只有 1 筆時工具認不出是列（稿同章有好幾筆、是列），整個 summary 被當成多包一層的按鈕。
        // 兩邊都是 details＞summary（A6 `.lv`），同一章有 ≥2 筆時就配得上
        status: '多',
        app: '>landmark:main\\[\\]>landmark:region\\[[^\\]]*\\]>control:button\\[[^\\]]*\\](>.*)?$',
        reason: '工具限制「資料太少」：章裡只有 1 筆，認不出是列',
        source: 'tools/a6-conformance/README.md「資料少的日子」：只剩 1 個時認不出來',
      },
      // 稿的「新」小標（設計說明）在鈕裡；app 的鈕只有 label span，工具把它配到「新」上
      ...['文案', '位置', '樣式'].map((status) => ({
        status,
        a6: 'control:button\\[批次請假新\\]>text:span\\[新\\]$',
        reason: '工具限制：稿的「新」標記是設計說明，app 鈕的 label span 被配到它身上',
        source: '.design-explorations a6.js ddLabel（剔除 .new）',
      })),
      // 稿是文字鈕「操作紀錄」；全站統一成工具列的時鐘圖示鈕
      {
        status: '樣式',
        a6: 'control:button\\[操作紀錄\\]$',
        reason: '全站「操作紀錄」入口統一成工具列的時鐘圖示鈕',
        source: '使用者 10-23 裁定 #2006（#2014）',
      },
      {
        // 稿的操作紀錄只在桌機（only-d）；手機保留同一顆時鐘鈕
        status: '多',
        widths: [360],
        app: '>landmark:main\\[\\]>control:button\\[操作紀錄\\]$',
        reason: '手機的操作紀錄：稿沒畫，保留',
        source: `${rule('R2')}；使用者 10-23 裁定 #2006`,
      },
    ],
  },
  // 家長端報名申請（#1727 ③）：家長登入態；預設分頁「新增申請」，申請紀錄是 p-enrollment-records
  'p-enrollment': {
    a6: 'p-enrollment.html',
    app: '/parent/enrollment',
    state: PARENT_STATE,
    deviations: [
      {
        // 開課班依科目分組：稿的示範課有理化、作文，seed 的公開開課班沒有
        status: '缺',
        a6: '>landmark:form\\[\\]>heading:h3\\[(理化|作文)\\]$',
        reason: '資料：seed 的公開開課班沒有理化、作文',
        source: 'https://github.com/mizok/clessia/issues/1314#issuecomment-6515298532',
      },
    ],
  },
  // 「申請紀錄」分頁：稿與 app 都認網址 #records
  'p-enrollment-records': {
    a6: 'p-enrollment.html#records',
    // 申請詳情（點紀錄列）：兩邊都是原生 dialog（#2290 換殼）
    a6Open: { detail: { click: 'button.rq', root: 'dialog[open]' } },
    appOpen: { detail: { click: 'button[data-request]', root: 'dialog[open]' } },
    // 稿的每筆紀錄是一顆獨立的按鈕（button.rq），沒有清單結構；指名成列才跟 app 的清單配得上（#1314 10-30）
    // app 的列也是一顆按鈕（`button[appRequestRow]`，#1314）；筆數少時過不了通則的 ≥3／≥5 門檻，一起指名
    rowSel: { a6: 'button.rq', app: 'button[data-request]' },
    app: '/parent/enrollment#records',
    state: PARENT_STATE,
    deviations: [
      {
        // 列元件宿主 app-request-row 是 display: contents（版面上按鈕直接當列，同稿 div > button.rq），工具仍把宿主認成一層列
        status: '多',
        app: '^>landmark:main\\[\\]>row>row(>.*)?$',
        reason:
          '工具限制：display: contents 的列元件宿主被認成一層列（多包一層），裡面的按鈕因此配不上；版面上沒有這一層',
        source: 'https://github.com/mizok/clessia/pull/2142（request-row 宿主 display: contents）',
      },
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
    // 申請詳情（點紀錄列）：兩邊都是原生 dialog（#2290 換殼）
    a6Open: { detail: { click: 'button.rq', root: 'dialog[open]' } },
    appOpen: { detail: { click: 'button[data-request]', root: 'dialog[open]' } },
    // 稿的每筆紀錄是一顆獨立的按鈕（button.rq），沒有清單結構；指名成列才跟 app 的清單配得上（#1314 10-30）
    // app 的列也是一顆按鈕（`button[appRequestRow]`，#1314）；筆數少時過不了通則的 ≥3／≥5 門檻，一起指名
    rowSel: { a6: 'button.rq', app: 'button[data-request]' },
    app: '/parent/trial#records',
    state: PARENT_STATE,
    deviations: [
      {
        // 列元件宿主 app-request-row 是 display: contents（版面上按鈕直接當列，同稿 div > button.rq），工具仍把宿主認成一層列
        status: '多',
        app: '^>landmark:main\\[\\]>row>row(>.*)?$',
        reason:
          '工具限制：display: contents 的列元件宿主被認成一層列（多包一層），裡面的按鈕因此配不上；版面上沒有這一層',
        source: 'https://github.com/mizok/clessia/pull/2142（request-row 宿主 display: contents）',
      },
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
    // 課程詳情（點卡片）：兩邊都是原生 dialog（#2290 換殼）
    a6Open: { detail: { click: '[data-c]', root: 'dialog[open]' } },
    appOpen: { detail: { click: 'button[data-class]', root: 'dialog[open]' } },
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
    deviations: [
      {
        // 到班打卡但不是上課的紀錄照樣列出並標「非課堂」（使用者 11-02 照計畫席建議裁定：保留）
        status: '多',
        app: '>landmark:main\\[\\]>row>control:button(~\\d+)?>text:span~2>text:span\\[非課堂\\]$',
        reason: '「非課堂」標籤保留：到班打卡但不是上課的紀錄照樣列出並標明',
        source: `${rule('R5')}「家長出缺席頁的『非課堂』標籤」2026-11-02（使用者 11-02 照計畫席建議裁定）`,
      },
      {
        // 代表列取最常見的變體：稿的示範期間多是「今日無課」的日子（padding 12、日期 14/600 zinc-700、手機 flex）、
        // 堂多是請假／還沒上（600 zinc-600）；seed 多是有課的日子（16、16/700）、「到了」（700 zinc-900）。
        // 兩種變體 app 都照稿（attendance.page.html 的 day--empty 與 rec 狀態色）
        status: '樣式',
        a6: '>landmark:main\\[\\]>row(>text:span|>control:button~2>text:span)?$',
        reason:
          '資料：代表列取到的變體不同（稿多是沒課的日子與請假的堂，seed 多是有課、到了），兩種變體都照稿',
        source: 'tools/a6-conformance/README.md:96（列內 part 取最常見的那種當代表）',
      },
      {
        // 一天有 ≥3 堂時，同形的堂被認成一組列（稿的示範一天最多 2 堂）
        status: '多',
        app: '>landmark:main\\[\\]>row>row(>.*)?$',
        reason: '資料：一天 ≥3 堂時工具把堂認成列，稿一天最多 2 堂',
        source: 'tools/a6-conformance/README.md:86（同層同簽名 ≥3 個合成列）',
      },
      // 請假表單是共用元件（管理端在 p-dialog-content 裡）：左右與上方的留白在家長頁 <dialog> 的捲動容器上，
      // form 本身不帶 padding；dialog 是 flex 直排（標題列＋捲動區，送出列黏在捲動區底）
      {
        status: '樣式',
        pop: 'leave',
        a6: '>landmark:dialog\\[登記請假\\](>landmark:form\\[\\])?$',
        detail: '^(padding [\\d.]+px [\\d.]+px [\\d.]+px → 0px|display block → flex)$',
        reason: '共用請假表單：留白在外框的捲動容器、dialog 是標題列＋捲動區的 flex 直排',
        source:
          'apps/web/src/app/shared/components/leave-form-dialog/leave-form-dialog.component.ts:42（LEAVE_DIALOG_CONTENT_STYLE）；#1695',
      },
      {
        status: '位置',
        pop: 'leave',
        a6: '>landmark:form\\[\\]>(text:label|control:textbox)\\[[^\\]]*\\]$',
        detail: '^相對「form」 Δx -(1[5-7]|2[3-5])、Δy -[6-9]（',
        reason: '連帶：共用請假表單的留白在外框，不在 form 上',
        source:
          'apps/web/src/app/shared/components/leave-form-dialog/leave-form-dialog.component.ts:42（LEAVE_DIALOG_CONTENT_STYLE）；#1695',
      },
      {
        // 稿把開始／結束時間標必填；app 選填，沒填＝整天請假
        status: '文案',
        pop: 'leave',
        a6: '>landmark:form\\[\\]>control:textbox\\[(開始|結束)時間\\*\\]$',
        detail: '^「(開始|結束)時間\\*」→「\\1時間」$',
        reason: '請假的開始／結束時間選填：沒填是整天請假',
        source: '計畫席 11-02：null＝全天，管理端也是選填，API 收 null；必填會擋掉全天請假',
      },
      {
        // 稿的今天（10/1）孩子 16:42 到班；量測當天張宇軒還沒到班
        status: '文案',
        a6: '>landmark:region\\[這一頁的摘要\\]>heading:h1\\[\\{名\\}今天#到班。\\]$',
        detail: '→「\\{名\\}今天還沒到班。」$',
        reason: '資料：量測當天孩子還沒到班',
        source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968`,
      },
    ],
  },
  // 系統設定「一般」分頁（殼照 A6，#1755 計畫席另開）：稿預設落在一般，app /admin/settings 也是
  settings: {
    a6: 'settings.html',
    app: '/admin/settings/general',
    deviations: [
      noCampusSwitch('補習班層級的設定與收費期間，不分校'),
      {
        // 稿的出勤紀錄模式是常開的一節（兩張可選的卡）；使用者要求「一般」分頁全部收成可收合的列，
        // 出勤紀錄模式、誰負責點名在列裡（列數因此多 2，工具算成資料差）
        status: '缺',
        a6: '>landmark:main\\[\\]>landmark:region\\[出勤紀錄模式\\](>|$)',
        reason: '「一般」分頁全部收成可收合的列，出勤紀錄模式在列裡',
        source: '#1882（使用者 10-22「一般設定也幫我收合」）',
      },
      {
        // 繳費提醒時間點可以設好幾個（#1660），摘要全部寫出來，跟稿的「到期前 3 天提醒」對不上文案
        status: '多',
        app: '>landmark:main\\[\\]>control:button\\[繳費期限',
        reason: '現況有、稿沒畫：繳費提醒可設多個時間點，摘要逐一寫出',
        source: `${rule('R2')}；#1660`,
      },
      {
        // 「繳費」收合列裡現況有、稿沒畫的欄位與區塊：待開單提醒、連續請假可不收費、家長繳費提醒（#1660）、
        // 家長付款帳戶資訊。已經收在收合列裡，不另外搬
        status: '多',
        app: '>landmark:main\\[\\]>(control:button\\[(儲存|到期前|逾期|加入)\\](~\\d+)?|heading:h3\\[(家長繳費提醒|家長付款帳戶資訊)\\]|text:p\\[(在這些時間點|家長在「繳費」頁|到期前#天)|list|control:textbox\\[(天數|家長付款帳戶資訊)\\])',
        reason: '現況有、稿沒畫：收在「繳費」收合列裡',
        source: `${rule('R2')}；#1660`,
      },
      {
        // 收合列裡的欄位（報名流程、繳費、學年升級的天數框與說明）：收起時 Chrome 照樣回盒子，app 這邊被量成列內 part；
        // 稿同樣的欄位沒量到。兩邊都在收合列裡，不是多出來的東西
        status: '多',
        app: '>landmark:main\\[\\]>row>(control:textbox|text:small)$',
        reason: '工具限制：收合列內的欄位，app 收起時仍被量到、稿沒有',
        source:
          'tools/a6-conformance/README.md 已知限制「收合的 <details> 沒有盒子，不列」（app 的收合內容仍有盒子，10-30 實測）',
      },
    ],
  },
  // 系統設定的學校分頁（#1314 SE4）
  schools: {
    a6: 'settings.html#schools',
    app: '/admin/settings/schools',
    a6Open: opensOf('schools', 'a6Open'),
    appOpen: opensOf('schools', 'appOpen'),
    deviations: [
      noCampusSwitch('學校名單整個補習班共用'),
      // 頁面搜尋框：框畫在 input 上，稿畫在外層 label.tsearch —— 同 courses／students 那條
      ...['尺寸', '樣式', '位置'].map((status) => ({
        status,
        a6: 'control:searchbox\\[找學校\\]$',
        reason: '頁面搜尋框的框畫在 input 上（全站同款），稿畫在外層 label',
        source: '全站共用 .clessia-filter-search（p-iconfield）；高度 #1903（使用者 10-23 裁定）',
      })),
    ],
  },
  // 系統設定的科目分頁（#1314 SE5）
  subjects: {
    a6: 'settings.html#subjects',
    app: '/admin/settings/subjects',
    deviations: [noCampusSwitch('科目整個補習班共用')],
  },
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
      noCampusSwitch('這頁就是分校清單本身'),
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
      // 稿是文字鈕「操作紀錄」；全站統一成工具列的時鐘圖示鈕（手機也保留）
      {
        status: '樣式',
        a6: 'control:button\\[操作紀錄\\]$',
        reason: '全站「操作紀錄」入口統一成工具列的時鐘圖示鈕',
        source: '使用者 10-23 裁定 #2006（#2014）',
      },
      {
        status: '多',
        widths: [360],
        app: '>landmark:main\\[\\]>control:button\\[操作紀錄\\]$',
        reason: '手機的操作紀錄：稿沒畫，保留',
        source: `${rule('R2')}；使用者 10-23 裁定 #2006`,
      },
      // 教室對話框：seed 沒有任何教室（seed.sql／seed-demo.sql 都沒有 INSERT classrooms），app 是空狀態；
      // 對話框置中，內容較矮，位置跟著不同
      ...[
        { status: '文案', a6: 'landmark:dialog\\[教室：\\{分校\\}\\]>text:p\\[A教室（#人）\\]$' },
        { status: '位置', a6: '^pop\\[rooms\\]>landmark:dialog\\[教室：\\{分校\\}\\]$' },
      ].map((d) => ({
        ...d,
        pop: 'rooms',
        reason: '資料：seed 沒有教室，對話框是空狀態',
        source: 'supabase/seed.sql、seed-demo.sql 沒有 classrooms',
      })),
      // 分校表單的出勤紀錄模式：app-select-field（p-select）對稿的 .dd；說明字跟著包在欄位那一格裡
      ...[
        {
          status: '缺',
          a6: '>landmark:form\\[\\]>(control:button\\[選擇：日到班\\](>.*)?|text:p\\[預設跟著「一般」的設定\\])$',
        },
        { status: '多', app: '>row>(control:combobox|control:button|text:p|text:span)$' },
      ].map((d) => ({
        ...d,
        pop: 'campus-form',
        reason: SELECT_FIELD,
        source: SELECT_FIELD_SOURCE,
      })),
    ],
  },
  staff: {
    a6: 'staff.html',
    app: '/admin/staff',
    a6Open: opensOf('staff', 'a6Open'),
    appOpen: opensOf('staff', 'appOpen'),
    // 章名「已停用」跟列裡的狀態字同文案，自動配對會把稿的章名配到列的狀態字
    mapping: {
      '>landmark:main[]>landmark:region[已停用]>text:div[已停用]':
        '>landmark:main[]>landmark:region[已停用]>heading:h2[已停用]',
    },
    deviations: [
      // ── 停用確認（ConfirmDialog，#2290）──
      // 稿的確認是 fields: [] 的 A2.form（空 <form>）；app 的確認沒有欄位，不包 form（R7）。取消／主鈕的位置連帶
      {
        status: '缺',
        pop: 'off',
        a6: '>landmark:dialog\\[確認停用\\]>landmark:form\\[\\]$',
        reason: '確認對話框沒有欄位，不包空的 form（稿是 A2.form fields: []）',
        source: `${rule('R7')}`,
      },
      ...['取消', '停用'].map((name) => ({
        status: '位置',
        pop: 'off',
        a6: `>landmark:dialog\\[確認停用\\]>control:button\\[${name}\\]$`,
        reason: '連帶：稿的空 form 有上下內距，app 沒有 form',
        source: `${rule('R7')}`,
      })),
      // 關閉鈕：手機 44×44（稿 29 寬）
      ...[
        { status: '尺寸', widths: [360], detail: '^寬 29→44$' },
        { status: '位置', widths: [360] },
      ].map((d) => ({
        ...d,
        pop: 'off',
        a6: '>landmark:dialog\\[確認停用\\]>control:button\\[關閉\\]$',
        reason: '可點元素基底 ≥44px',
        source: `${rule('R3')}`,
      })),
      // 權限設定（#1314 ST2）。稿量第二筆「張教務」，app 量第一位管理員：人名、權限項數、頁長都是資料
      ...[
        { status: '文案', a6: '\\[張教務的權限\\]$' },
        // 產品權限 10 項、稿 7 項（稿 staff.html:82 自己註記「照產品」）：多 3 格，動作列跟著下移
        {
          status: '位置',
          a6: '>landmark:dialog\\[張教務的權限\\]>control:button\\[(儲存權限|關閉)\\](~2)?$',
          detail: 'Δx 0、Δy \\+156',
        },
        // 置中彈窗頂端隨頁面長度（工具把視窗撐到內容全高，README「黏住」節）；人員列數不同
        {
          status: '位置',
          a6: '^pop\\[perm\\]>landmark:dialog\\[張教務的權限\\]$',
          detail: 'Δx 0、',
        },
      ].map((d) => ({
        ...d,
        pop: 'perm',
        reason: '資料：量的人不同（人名）、產品權限 10 項比稿多 3 項、人員列數不同',
        source:
          'staff.html:82（權限項目「照產品」）、:239（稿示範的第一筆是本人）；#1314 issuecomment-6647755506',
      })),
      // 授課紀錄的月份：app-select-field 對稿的 .dd（#2325，全站同一套）
      ...selectFieldInDialog('teaching-log', '月份'),
      // 授課紀錄（#2290 B 批）：量的是 seed 的老師，稿是假人名 —— 標題文案是資料
      {
        status: '文案',
        pop: 'teaching-log',
        a6: 'heading:h2\\[授課紀錄· \\{名\\}\\]$',
        reason: '資料：標題帶量測那位老師的本名（稿是示範人名）',
        source: 'staff.html:251（sheet 標題「授課紀錄 · 姓名」）；#2290',
      },
      // #2290 換殼：殼的內距在內容區外層（.dialog-frame__body），稿在 form 上 —— form 本身相對對話框的位移
      // （全站那兩條只涵蓋 form 的 padding 與子項；同 enrollments「直接報名」那條，同一份裁定）
      {
        status: '位置',
        pop: 'new-staff',
        a6: '>landmark:dialog\\[新增人員\\]>landmark:form\\[\\]$',
        detail: '^相對「新增人員」 Δx \\+(16|24)、Δy \\+(8|9|1[01])（',
        reason: '殼的內距在內容區外層（.dialog-frame__body），稿在 form 上，幾何相同',
        source:
          'https://github.com/mizok/clessia/issues/2290#issuecomment-6660276130（計畫席裁定）',
      },
      // 手機關閉鈕 44（稿 38）—— 同新增家長那條
      ...[
        { status: '尺寸', detail: '^寬 38→44$' },
        { status: '位置', detail: '^相對「張教務的權限」 Δx -6' },
      ].map((d) => ({
        ...d,
        pop: 'perm',
        widths: [360],
        a6: 'landmark:dialog\\[張教務的權限\\]>control:button\\[關閉\\]$',
        reason: '手機關閉鈕 44px（觸控下限）',
        source: `${rule('R3')}；${hardRule('A27')}`,
      })),
      // 新增人員的角色、服務分校維持多選（ST7，使用者 11-02 照計畫席建議裁定）：稿是單選的下拉，app 是勾選框與多選
      ...[
        {
          status: '缺',
          a6: 'landmark:form\\[\\](>row>control:button|>control:button\\[選擇：不教課\\])$',
        },
        {
          status: '多',
          app: 'landmark:form\\[\\]>(control:checkbox\\[(管理員|老師)\\]|row>text:div)$',
        },
        { status: '樣式', a6: 'landmark:form\\[\\]>row$', detail: '^display block → flex' },
      ].map((d) => ({
        ...d,
        pop: 'new-staff',
        reason: '角色、服務分校維持多選：一個人可以同時是管理員兼老師、在多間分校服務',
        source: `${rule('R5')}「人員的角色／分校／科目」2026-11-02（使用者 11-02 照計畫席建議裁定，ST7）`,
      })),
      // 新增人員：對外暱稱（#1665 Q6）稿沒畫，舊有新無
      ...[
        {
          status: '多',
          app: 'landmark:form\\[\\]>(control:textbox\\[對外暱稱\\]|text:label\\[對外暱稱\\]|text:p\\[公開課程目錄顯示暱稱)',
        },
      ].map((d) => ({
        ...d,
        pop: 'new-staff',
        reason: '人員表單的「對外暱稱」：現況有、稿沒畫，保留',
        source: `${rule('R2')}；#1665 Q6`,
      })),
      // 手機關閉鈕 44（稿 34）：標題欄跟著窄
      ...[
        {
          status: '尺寸',
          a6: 'landmark:dialog\\[新增人員\\]>(control:button\\[關閉\\]|heading:h2\\[新增人員\\]|text:p\\[建立後會出一次性登入連結[^\\]]*\\])$',
        },
        { status: '位置', a6: 'landmark:dialog\\[新增人員\\]>control:button\\[關閉\\]$' },
      ].map((d) => ({
        ...d,
        pop: 'new-staff',
        widths: [360],
        reason: '手機關閉鈕 44px（觸控下限），標題欄因此變窄',
        source: `${rule('R3')}；${hardRule('A27')}`,
      })),
      // 頁面搜尋框：框畫在 input 上（共用 p-iconfield），稿畫在外層 label.tsearch —— 同 courses、grades-class
      ...['尺寸', '樣式', '位置'].map((status) => ({
        status,
        a6: 'control:searchbox\\[搜尋人員\\]$',
        reason: '頁面搜尋框的框畫在 input 上（全站共用 p-iconfield），稿畫在外層 label',
        source: '全站共用 .clessia-filter-search（p-iconfield）；高度 #1903（使用者 10-23 裁定）',
      })),
      // 稿是文字鈕「操作紀錄」；全站統一成工具列的時鐘圖示鈕
      ...['尺寸', '樣式', '位置'].map((status) => ({
        status,
        a6: 'control:button\\[操作紀錄\\]$',
        reason: '全站「操作紀錄」入口統一成工具列的時鐘圖示鈕',
        source: '使用者 10-23 裁定 #2006（#2014）',
      })),
      {
        // 新增掃碼機台（#1127）：現況有、稿沒畫，收進頁面「⋯」—— 同帳單、課程那條
        status: '多',
        app: 'control:button\\[更多動作\\]$',
        reason: '工具列「⋯」：現況有、稿沒畫的動作收進「⋯」',
        source: `${rule('R2')}；#1127`,
      },
    ],
  },
  'fee-templates': {
    a6: 'fee-templates.html',
    app: '/admin/fee-templates',
    // #2290 換殼的對話框：稿 A2.form（原生 dialog）↔ app DynamicDialog
    a6Open: { 'new-ft': { click: '[data-newft]', root: 'dialog[open]' } },
    appOpen: {
      'new-ft': {
        click: 'button:has-text("新增價目表")',
        root: '.p-dialog:has(app-fee-template-form-dialog)',
      },
    },
    deviations: [
      // 用模板建立：A6 放在系統設定、是一選就建的 select；使用者 11-02 搬到這裡、改成 radio＋預覽＋送出鈕，
      // 11-04 收進彈窗（#2235），頁面上只剩開彈窗的那顆鈕（列表空時在空狀態裡）
      {
        status: '多',
        app: '>landmark:region\\[收費期間\\]>(.*>)?control:button\\[用模板建立\\]$',
        reason:
          '學期與繳費週期搬到費用方案頁；用模板建立收成一顆鈕開彈窗（一年用一次，不常駐佔版面）',
        source: `${rule('R5')}「學期與繳費週期的位置」「用模板建立期間」2026-11-02、「用模板建立期間：收進彈窗」2026-11-04（使用者裁定，#2235）`,
      },
      noCampusSwitch('價目表是補習班層級'),
      // 頁面搜尋框：框畫在 input 上，稿畫在外層 label.tsearch —— 同 courses／grades-class 那條
      ...['尺寸', '樣式', '位置'].map((status) => ({
        status,
        a6: 'control:searchbox\\[搜尋方案名稱\\]$',
        reason: '頁面搜尋框的框畫在 input 上（全站同款），稿畫在外層 label',
        source: '全站共用 .clessia-filter-search（p-iconfield）；高度 #1903（使用者 10-23 裁定）',
      })),
      {
        status: '位置',
        a6: '^>control:button\\[顯示停用方案（#）\\]$',
        reason: '連帶：搜尋框寬度同上那條（全站同款），右邊的 chip 跟著位移',
        source: '全站共用 .clessia-filter-search（p-iconfield）；高度 #1903（使用者 10-23 裁定）',
      },
      {
        // 稿的「N 筆期繳報名在用」連到報名進出；`GET /enrollments` 沒有依價目／收費期間篩的參數
        status: '缺',
        a6: '收費期間\\]>row>control:link$',
        reason: '「N 筆期繳報名在用」連到報名進出：等 API（報名列表沒有依收費期間篩的參數）',
        source:
          '#1314 盤點 10-30「等 API」F1b（`GET /enrollments` 加 feeTemplateId；收費期間同一類）',
      },
      {
        // 稿 9 個期間 8 個有重疊說明（列高 83），「還沒有報名用它」那一列沒有（列高 60）；列內位置是相對各自的列量的
        status: '位置',
        a6: '收費期間\\]>row>(text:span~3|text:span~2>text:small)$',
        reason: '資料：稿與 seed 的期間重疊與否、有沒有報名不同，列高跟著不同',
        source: 'tools/a6-conformance/README.md（列內 part 取最常見那種）',
      },
      {
        // seed 每種計費模式只有 1 種價目：同章一列不成清單列（工具 ≥3 才認列），列內的名稱、金額、狀態、⋯ 散在章裡；
        // 稿每章 3 種以上，是列。兩邊列的內容一樣（名稱鈕、金額、啟用中、報名在用（有人用時是連結，F1b）、⋯）
        status: '多',
        app: 'landmark:region\\[(月繳|期繳|堂數制)\\]>(control:button|control:link|text:span)(\\[[^\\]]*\\])?(>text:small\\[[^\\]]*\\])?$',
        reason: '資料：seed 每章只有一種價目，不成清單列',
        source: 'tools/a6-conformance/README.md（列是資料：≥3 或 ≥5 個同簽名才合成 row）',
      },
    ],
  },
  notifications: {
    // 預設分頁「收到的」（#1692 起 app 也有）；「發布公告」是 notifications-publish
    a6: 'notifications.html',
    app: '/admin/notifications',
    // 稿的按鈕名帶「新」標記（全部標為已讀新），整串文案對不上，自動配對配不起來
    mapping: {
      '>control:button[全部標為已讀新]': '>landmark:main[]>control:button[全部標為已讀]',
    },
    deviations: [
      noCampusSwitch('收件匣是「寄給我的」，不分校'),
      ...NOTIFICATIONS_TABS,
      // 資料：哪一章有未讀、代表列是已讀還是未讀，都看 seed（稿「這週」全讀過、seed 有未讀）
      {
        status: '文案',
        a6: '>landmark:region\\[(今天|昨天|這週|更早)\\]>text:p\\[#則\\]$',
        detail: '^「#則」→「#則·未讀#」$',
        reason: '資料：那一章有沒有未讀（「· 未讀 N」稿同款，只在有未讀的章出現）',
        source: INBOX_DATA_SOURCE,
      },
      {
        status: '樣式',
        a6: '>landmark:region\\[(今天|昨天|這週|更早)\\]>row>control:button>text:span(~\\d+)?$',
        detail: '^fontWeight \\d+ → \\d+(；color [^；]+)?$',
        reason: '資料：代表列已讀／未讀不同（未讀是粗體深字），兩種都照稿',
        source: INBOX_DATA_SOURCE,
      },
      {
        status: '多',
        app: '>landmark:region\\[(今天|昨天|這週|更早)\\]>control:button\\[逾期帳單逾期帳單摘要：[^\\]]*\\]$',
        reason: '現況有、稿沒畫：每日逾期帳單摘要通知（管理員收）',
        source: `${rule('R2')}；#1693（overdue_digest）`,
      },
    ],
  },
  'notifications-publish': {
    // 「發布公告」分頁：稿與 app 都認網址 #publish
    a6: 'notifications.html#publish',
    app: '/admin/notifications#publish',
    deviations: [
      noCampusSwitch('發公告的對象分校是頁面自己的選單（可選全部分校），不該被頂欄改掉'),
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
      // 稿有 3 個月份章、本機公告只有 2 個月（多出的那章工具已歸資料差）；那章的章名被後綴配對配到 app 第一章的清單上
      ...['角色', '文案', '黏住', '樣式'].map((status) => ({
        status,
        a6: '>landmark:region\\[#月\\]~3>text:div\\[#月\\]$',
        app: '>landmark:region\\[#月\\]>list$',
        reason: '工具限制：稿多一個月份章（資料差），它的章名被配到 app 第一章的清單',
        source: '本頁 diff 的資料差列「A6 多一個同型區塊：landmark:region「#月」」',
      })),
    ],
  },
  meals: {
    a6: 'meals.html',
    app: '/admin/meals',
    // #2290 換殼的對話框：稿 A2.form（原生 dialog）↔ app DynamicDialog
    a6Open: { run: { click: '[data-close]', root: 'dialog[open]' } },
    appOpen: {
      run: { click: 'button:has-text("月結")', root: '.p-dialog:has(app-billing-run-dialog)' },
    },
    deviations: [
      {
        status: '黏住',
        a6: 'landmark:region\\[確認名單\\]$',
        detail: '稿宣告了 sticky 但捲動時沒黏住',
        reason:
          '稿的 .savebar 被只有自己高的 div 框住、捲動時不會動（稿的 bug）；app 確認列有黏是對的，手機 offset 照 app 現狀',
        source: 'https://github.com/mizok/clessia/pull/1761#issuecomment-6309038184（計畫席裁定）',
      },
      // 說明框後半句「今天有請假的 N 位名字下有提示」（ME1 接上之後才有）：今天沒有人請假時不寫
      ...['缺', '文案'].map((status) => ({
        status,
        a6:
          status === '缺'
            ? '>text:b\\[#位\\]$'
            : '>landmark:main\\[\\]>text:p\\[「收不收費」是人工判斷',
        reason: '資料：本機 seed 今天在量測分校的候選沒有人請假，說明框不接請假人數那半句',
        source: '#1314 ME1（名單帶 onLeave）；本機 seed 2026-11-02 文山旗艦校候選 8 位、請假 0 位',
      })),
      {
        // 列的代表樣式取最常見的列：seed 今天 18 位裡 17 位未處理、多數沒訂（名字灰、單價框灰底、收費字灰、狀態 600 近黑）；
        // 稿多數列已確認、有訂。四種樣式稿都有（.ml--off、:disabled、.stt--todo）
        status: '樣式',
        a6: '>row>(control:link|text:label~2>control:textbox|text:label~3|text:span(~2)?)$',
        detail:
          '^(color rgb\\(26, 22, 20\\) → rgb\\(87, 80, 75\\)|backgroundColor rgb\\(255, 255, 255\\) → rgb\\(245, 243, 241\\)|color rgb\\(26, 22, 20\\) → rgb\\(120, 111, 105\\)|fontWeight 400 → 600；color rgb\\(61, 55, 51\\) → rgb\\(26, 22, 20\\))(；display inline → inline-flex)?$',
        reason: '資料：seed 今天多數列未處理、沒訂，代表列是稿的 .ml--off／.stt--todo 那種',
        source: 'tools/a6-conformance/README.md（列內 part 取最常見那種）',
      },
      {
        // 稿的代表列是「今天請假 · 別訂他的便當」那種兩行列（名字下面多一行），app 的是一般列（seed 今天沒有請假的候選）
        status: '位置',
        widths: [1440],
        a6: '>row>control:link$',
        detail: '^相對所在列 Δx 0、Δy \\+\\d+（',
        reason:
          '資料：代表列取到的變體不同（稿是請假的兩行列，app 是一般列），名字的上下位置跟著不同',
        source:
          '#1314 ME1；本機 seed 今天候選沒有人請假；tools/a6-conformance/README.md（列內 part 取最常見那種）',
      },
      {
        // R3 連帶：手機名字連結撐到 44px（稿是行內字，約 21），同列第一行變高，下面的勾選、單價、狀態字整排往下
        status: '位置',
        widths: [360],
        a6: '>row>(text:label(~[23])?>control:(checkbox|textbox)|text:span)$',
        detail: '^相對所在列 Δx 0、Δy \\+(1[0-9]|2[0-9]|3[0-2])',
        reason: '連帶：手機名字連結 44px 觸控高度，列的第一行變高',
        source: `${rule('R3')}`,
      },
    ],
  },
  reports: {
    a6: 'reports.html',
    app: '/admin/reports',
    // 匯出明細確認浮層（稿 `rexp`、app 原生 popover `reports-export`）
    popovers: { rexp: 'reports-export' },
    deviations: [
      {
        // 浮層貼著匯出鈕下緣往下開（同稿的 toggle 定位）：鈕在頁上的 Δy 是資料（色面句行數），
        // 再加工具列控制項同高 40（稿 36）
        status: '位置',
        pop: 'rexp',
        widths: [1440],
        a6: '^pop\\[rexp\\]>landmark:popover\\[匯出明細\\]$',
        detail: '^相對頁面 Δx 0、Δy \\+(1[0-9]|20)',
        reason: '連帶：浮層定位在匯出鈕下緣，鈕的位置差（資料＋工具列控制項 40 高）帶過來',
        source: '工具列控制項同高 #1903（使用者 10-23 裁定）；README「列是資料」',
      },
      {
        // 手機關閉鈕是 44×44 的圓鈕（稿 36）：R3 的全站條目只管高度，方鈕的寬跟著變
        status: '尺寸',
        pop: 'rexp',
        widths: [360],
        a6: '>control:button\\[關閉\\]$',
        detail: '^寬 36→44$',
        reason: '可點元素基底 44px：圖示圓鈕寬高一起撐到 44',
        source: `${rule('R3')}`,
      },
      {
        // 稿的期間／分校／課程是 label 包原生 select；app 是 label 包 PrimeNG p-select（combobox＋dropdown 鈕），
        // 工具把 app 的 label 當成一個 part、稿的沒有。分校不在這列：在頂欄（#1138）
        status: '多',
        app: 'landmark:search\\[篩選營收報表\\]>text:label\\[(期間|課程)\\](>.*)?$',
        reason: '工具限制：p-select 不是原生 select，label 的配對方式不同',
        source: 'tools/a6-conformance extract.mjs；分校在頂欄 #1138',
      },
      {
        // 表頭第一格、合計那一格的 class 跟同列其他格不同（靠左、無左內距），工具不把它們併進同一組列
        status: '多',
        app: '>landmark:main\\[\\]>list>text:(th\\[[^\\]]*\\]|td\\[合計\\])$',
        reason: '工具限制：同列第一格簽名不同，沒有併成列',
        source: 'tools/a6-conformance/README.md（列是同層同簽名）',
      },
      {
        // 分組的名稱連結、模糊桶說明（未分類、跨分校帳單）隨資料：稿 19 組有 3 組連分校、1 組有說明，seed 2 組
        status: '缺',
        a6: '>row>(control:link|text:span)$',
        reason: '資料：分組數與哪幾組有連結／說明',
        source: 'tools/a6-conformance/README.md（列內條件式：可能隨資料）',
      },
      {
        status: '多',
        app: '>row>(control:link|text:span(~\\d)?)$',
        reason: '資料：分組數與哪幾組有連結／說明',
        source: 'tools/a6-conformance/README.md（列內條件式：可能隨資料）',
      },
      {
        // 手機上分組名稱連結撐 44（觸控下限），列的第二行起跟著下移
        status: '位置',
        widths: [360],
        app: '(>row>row|>text:td>text:small)$',
        reason: '連帶：手機分組名稱連結撐到 44px',
        source: `${rule('R3')}`,
      },
    ],
  },
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
      {
        // Δx ±8：展開內容外圍的灰框 4→12px，欄位（含學生名下的班名小字，#2080-1）跟著內縮
        status: '位置',
        a6: '>landmark:region\\[這段期間的聯絡簿\\]>row>control:button(~\\d+)?>text:span(~\\d+)?(>text:small)?$',
        detail: '^相對所在列 Δx [-+]8、Δy -?\\d+（',
        reason: '連帶：欄位因灰框加寬內縮 8px',
        source: `${rule('R5')}「摺疊摘要列（\`.coll\`）展開內容外圍的灰框」2026-10-22；#1853`,
      },
      // 代表列取最常見的變體：稿的示範多是「已簽收」（綠字、不帶底），seed 多是「未簽收」（灰底小標）。
      // 兩種變體都照稿（稿上 button~3 的「未簽收」配上了、樣式一致）；手機上小標寬不同，學生名那欄跟著不同寬
      ...['樣式', '位置'].map((status) => ({
        status,
        a6: '>landmark:region\\[這段期間的聯絡簿\\]>row>control:button~4>text:span~4$',
        reason: '資料：代表列取到的變體不同（稿是已簽收，seed 是未簽收），兩種變體都照稿',
        source: 'tools/a6-conformance/README.md:96（列內 part 取最常見的那種當代表）',
      })),
    ],
  },
  changes: {
    a6: 'changes.html',
    app: '/admin/changes',
    deviations: [
      {
        // 稿只有一個搜尋框；「月份」「異動類型」「老師或班級」三個篩選保留（使用者 11-02 照計畫席建議裁定）
        status: '多',
        app: '>landmark:search\\[篩選課務異動\\]>(text:span\\[(月份|異動類型)\\]|control:combobox\\[(月份|異動類型)\\]|control:button\\[dropdown trigger\\](~\\d+)?|text:label\\[老師或班級\\]|control:searchbox\\[老師或班級\\]|control:button\\[篩選全部異動\\])$',
        reason: '課務異動的三個篩選保留：月份、異動類型、老師或班級',
        source: `${rule('R5')}「課務異動頁的三個篩選」2026-11-02（使用者 11-02 照計畫席建議裁定）`,
      },
    ],
  },
  exams: {
    a6: 'exams.html',
    app: '/admin/grades/exams',
    a6Open: opensOf('exams', 'a6Open'),
    appOpen: opensOf('exams', 'appOpen'),
    deviations: [
      {
        // G1b 之後：手機班名連結撐 44（觸控下限），「# ／# 已登錄」整格（span~2）Δy 跟著 +N 已歸連帶；
        // 裡面的粗體數字工具只拿它跟「所在列」比、不跟父層比，連帶傳不下來，同一個 Δy 在這裡補上
        status: '位置',
        widths: [360],
        a6: '>row>text:span~2>text:b$',
        detail: '^相對所在列 Δx 0、Δy \\+\\d+（',
        reason: '連帶：班名連結手機 44px（觸控下限），已登錄人數那格整組往下',
        source: `${rule('R3')}；#1314 G1b`,
      },
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
      // 新增考試：類別／科目／分校是 app-select-field（稿 .dd 的標籤是 label、app 是 span，三個欄位外框被認成一列）
      ...[
        { status: '缺', a6: 'landmark:form\\[\\]>control:button\\[選擇：小考\\]$' },
        {
          status: '多',
          app: 'landmark:form\\[\\]>row(>(text:span|control:combobox|control:button))?$',
        },
        ...['文案', '位置'].map((status) => ({
          status,
          a6: 'landmark:form\\[\\]>text:label\\[類別\\]$',
        })),
      ].map((d) => ({ ...d, pop: 'new-exam', reason: SELECT_FIELD, source: SELECT_FIELD_SOURCE })),
      // 參加的開課班多選（稿單選「選一個班」）；科目、分校、範圍說明、及格分數的「留空＝總分的 60%」保留（R2）
      ...[
        { status: '缺', a6: 'landmark:form\\[\\]>control:button\\[選擇：選一個班\\]$' },
        { status: '多', app: 'landmark:form\\[\\]>text:div\\[選擇班級（至少一項）\\]$' },
        {
          status: '多',
          app: 'landmark:form\\[\\]>(text:span\\[留空＝總分的#%\\]|control:textbox\\[範圍說明\\])$',
        },
        {
          status: '文案',
          a6: 'text:p\\[還沒填：',
          app: 'text:p\\[還沒填：考試名稱、科目、參加的開課班\\]$',
        },
      ].map((d) => ({
        ...d,
        pop: 'new-exam',
        reason: '新增考試：開課班多選（應然）；科目、分校、範圍說明稿沒畫，保留（R2）',
        source: `${rule('R5')}「新增考試的開課班多選與保留欄位」2026-11-02（A6 exams.html:74 自己寫應然是「參加範圍（多選開課班）」、稿先畫成單選；計畫席 11-02 確認）`,
      })),
      // 手機一欄：稿沒畫的科目、分校各佔一列，後面的欄位整段下移（桌機兩欄並排，連帶得起來）
      {
        status: '位置',
        widths: [360],
        pop: 'new-exam',
        a6: 'landmark:form\\[\\]>text:label\\[(參加的開課班|滿分|及格分數)\\]$',
        detail: 'Δx 0、Δy \\+1[5-7]\\d',
        reason: '連帶：手機上科目、分校（R2 保留）各佔一列',
        source: `${rule('R5')}「新增考試的開課班多選與保留欄位」2026-11-02`,
      },
      // 滿分／及格分數：稿用共用的 money 欄型（前面一個「NT$」，輸入框因此是 flex 子項），分數不加 NT$
      ...[
        { status: '位置', detail: 'Δx -3[5-9]' },
        { status: '樣式', detail: '^display block → inline-block$' },
      ].map((d) => ({
        ...d,
        pop: 'new-exam',
        a6: 'landmark:form\\[\\]>control:textbox\\[(滿分|及格分數)\\]$',
        reason: '分數欄不加稿 money 欄型的「NT$」前綴',
        source: `${rule('R5')}「新增考試的開課班多選與保留欄位」2026-11-02（A6 exams.html:74 自己寫應然是「參加範圍（多選開課班）」、稿先畫成單選；計畫席 11-02 確認）`,
      })),
    ],
  },
  scores: {
    a6: 'scores.html',
    // seed 的考試（跟 scores-dirty 同一場）；原本的 id 是某一席本機 DB 的，seed 裡沒有（#1314 10-30）
    app: '/admin/grades/exams/academy/70000000-0000-0000-0000-000000000003/scores',
    deviations: [noCampusSwitch('看的是一場考試；班可能跨分校，誰能看由後端權限擋')],
  },
  grades: {
    a6: 'grades.html',
    app: '/admin/grades/overview',
    deviations: [
      {
        // 「還沒登錄完」列：手機名字連結撐到 44px（稿 27），同一行的人數（含 small）跟著置中下移
        status: '位置',
        widths: [360],
        a6: '>row>text:span~2(>text:small)?$',
        detail: '^相對所在列 Δx -?\\d、Δy \\+(8|9|10)（',
        reason: '連帶：手機名字連結 44px（觸控下限），同列的人數垂直置中跟著下移',
        source: `${rule('R3')}；${hardRule('A27')}`,
      },
    ],
  },
  'grades-class': {
    a6: 'grades-class.html',
    app: '/admin/grades/overview/class',
    deviations: [
      {
        // 舊有新無：稿的章頭只有課程名＋「N 個班」，app 在章名下保留科目小字
        status: '多',
        host: '^app-chapter-head$',
        // 小字是 p（#1314 11-05 起 app-chapter-head 照 A6 `.chap__meta` 改 p）
        app: 'landmark:region\\[[^\\]]*\\]>text:(span|p)\\[[^\\]]*\\]$',
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
    a6Open: opensOf('grades-student', 'a6Open'),
    // app 的篩選是 app-filter-panel：桌機 PrimeNG Popover、≤860 貼底抽屜 p-dialog（#2206）；#2079(c) 開課班／期間要打開才量得到
    appOpen: {
      filt: { click: 'button:has-text("篩選：")', root: '.p-popover, .p-dialog' },
      ...opensOf('grades-student', 'appOpen'),
    },
    deviations: [
      // 同 grades-class：工具列換成全站共用的搜尋框之後（#1314 G9），量到的是 input 不是外層 label
      ...['尺寸', '樣式', '位置'].map((status) => ({
        status,
        a6: '^>control:searchbox\\[搜尋學生姓名\\]$',
        reason: '頁面搜尋框的框畫在 input 上（全站共用 p-iconfield），稿畫在外層 label',
        source: '全站共用 .clessia-filter-search（p-iconfield）；高度 #1903（使用者 10-23 裁定）',
      })),
      // 篩選浮層：PrimeNG Popover 的根固定宣告 role=dialog，稿是原生 popover
      {
        status: '角色',
        pop: 'filt',
        a6: '(^|>)landmark:popover\\[\\]$',
        reason: 'PrimeNG Popover 固定宣告 role=dialog，跟稿的原生 popover 只差在語意',
        source: `${rule('R5')}「成績學生頁篩選浮層的根角色」2026-11-02`,
      },
      // 篩選浮層的六個下拉是 app-select-field（稿 .dd 是 label 裡的按鈕；app 是欄位外框＋combobox＋箭頭鈕）
      ...[
        { status: '缺', a6: '(^|>)landmark:popover\\[\\]>row>control:button>text:span$' },
        ...['位置', '樣式'].map((status) => ({
          status,
          a6: '(^|>)landmark:popover\\[\\]>row>control:button$',
        })),
        { status: '樣式', a6: '(^|>)landmark:popover\\[\\]>row$' },
        // 手機抽屜有可及名稱「篩選」（#2208 二讀），桌機浮層沒有
        { status: '多', app: '(^|>)landmark:dialog\\[(篩選)?\\]>row>control:combobox$' },
      ].map((d) => ({ ...d, pop: 'filt', reason: SELECT_FIELD, source: SELECT_FIELD_SOURCE })),
      // 完成鈕的上下位置：稿每列多一行「新」小標（設計說明）、多一欄分校（列數 7→6 是資料差），浮層高 419→311
      {
        status: '位置',
        pop: 'filt',
        widths: [1440],
        a6: '(^|>)landmark:popover\\[\\]>control:button\\[完成\\]$',
        reason: '連帶：稿的「新」小標各佔一行、欄位多一個分校，浮層比 app 高；完成鈕貼底跟著差',
        source: '.design-explorations a6.js ddLabel（剔除 .new）；列數差見同頁資料差',
      },
      // #2206：≤860 篩選改成貼底抽屜（全站 p-dialog 手機樣式，#1776）：根貼底、無框、以標題「篩選」為名，
      // 多一個標題列；「完成」是抽屜底部滿寬的主要鈕（稿是浮層右下的小鈕）
      ...[
        { status: '文案', a6: '(^|>)landmark:popover\\[\\]$' },
        { status: '位置', a6: '(^|>)landmark:popover\\[\\]$' },
        { status: '樣式', a6: '(^|>)landmark:popover\\[\\]$' },
        { status: '多', app: '(^|>)landmark:dialog\\[篩選\\]>heading:h2\\[篩選\\]$' },
        { status: '位置', a6: '(^|>)landmark:popover\\[\\]>row$' },
        ...['位置', '尺寸', '樣式'].map((status) => ({
          status,
          a6: '(^|>)landmark:popover\\[\\]>control:button\\[完成\\]$',
        })),
      ].map((d) => ({
        ...d,
        pop: 'filt',
        widths: [360],
        reason:
          '手機篩選是貼底抽屜（全站 p-dialog 手機樣式）：標題列「篩選」、底部滿寬「完成」，不是稿的浮層',
        source: `${rule('R5')}「手機的篩選面板：貼底抽屜」2026-11-03；#2206 issuecomment-6593157592`,
      })),
      // 稿的「新」標記是設計說明；app 欄位標籤的 span 被配到它身上（同批次請假）
      ...['位置', '樣式'].map((status) => ({
        status,
        pop: 'filt',
        a6: '(^|>)landmark:popover\\[\\]>row>text:span\\[新\\]$',
        reason: '工具限制：稿的「新」標記是設計說明，app 欄位標籤的 span 被配到它身上',
        source: '.design-explorations a6.js ddLabel（剔除 .new）',
      })),
      // ── 成績明細對話框（pop[detail]，#2186／#1314 11-05 歸零）──
      // 學生名、年級、學校是資料：{名} 只收稿的假人名與 app 登入者，點開的學生不在裡面
      {
        status: '文案',
        pop: 'detail',
        a6: '(^|>)landmark:dialog\\[\\{名\\}的成績\\](>heading:h2\\[\\{名\\}的成績\\]|>text:p\\[國三·實踐國中\\])?$',
        reason: '學生名、年級、學校是資料（點開的是 seed 的學生，不是稿的示範學生）',
        source:
          'tools/a6-conformance/README.md「part key」：{名} 只收稿的假人名與 app 登入者的 displayName',
      },
      // 型態／科目下拉：app-select-field（稿 .dd 是一顆按鈕；app 是 combobox＋箭頭鈕，箭頭鈕被配到稿的按鈕上）
      ...selectFieldDeviations('考試型態|科目').map((d) => ({ ...d, pop: 'detail' })),
      ...['文案', '位置', '樣式', '尺寸'].map((status) => ({
        status,
        pop: 'detail',
        a6: '(^|>)control:button\\[(考試型態|科目)：[^\\]]*\\]$',
        reason: SELECT_FIELD,
        source: SELECT_FIELD_SOURCE,
      })),
      // 各科摘要灰面：既有功能、稿沒畫，保留在對話框頂端
      {
        status: '多',
        pop: 'detail',
        app: '(^|>)landmark:dialog\\[[^\\]]*\\]>(text:b\\[[^\\]]*\\]|text:span\\[(#筆|近期小考|# / #|最近段考|—)\\])$',
        reason: '各科摘要（近期小考、最近段考）是既有功能，稿沒畫；保留在對話框頂端',
        source: `${rule('R5')}「成績學生頁的成績明細對話框」2026-11-05`,
      },
      // 合計列：寫「顯示 N／M 場 · 不及格 N 場」，不寫稿的跨場平均（各場總分不同，平均沒有意義）
      ...[
        { status: '文案', a6: '(^|>)text:p\\[#場·平均#分·不及格#場\\]$' },
        { status: '多', app: '(^|>)text:p\\[顯示／#場·不及格#場\\]>text:b\\[#\\]$' },
      ].map((d) => ({
        ...d,
        pop: 'detail',
        reason: '合計列不算跨場平均（各場總分不同），改寫篩選後／全部場數',
        source: `${rule('R5')}「成績學生頁的成績明細對話框」2026-11-05`,
      })),
      // 紀錄列包在 ul／li（稿是 div 列）：ul 本身由全站 R7 那條歸偏離，列跟著
      {
        status: '多',
        pop: 'detail',
        app: '(^|>)landmark:dialog\\[[^\\]]*\\]>list>row$',
        reason: '語意結構依內容：列表用 ul／li，外觀照稿',
        source: `${rule('R7', '，#1590')}`,
      },
      // 期間鈕：桌機 40（灰帶工具列控制項同高），稿 34；手機 44 由全站 R3 那條管
      {
        status: '尺寸',
        pop: 'detail',
        widths: [1440],
        a6: '(^|>)control:button\\[(近#月|近半年|全部)\\](~\\d+)?$',
        detail: '^高 34→40$',
        reason: '工具列控制項全部同高：桌機 40',
        source: `${rule('R5')}「灰帶工具列控制項高度」2026-10-23；#1903`,
      },
      // 動作列的上下位置：稿示範學生的紀錄比 seed 多（稿整頁列出、app 每頁 10 場），對話框高度不同
      {
        status: '位置',
        pop: 'detail',
        a6: '(^|>)landmark:dialog\\[\\{名\\}的成績\\]>(control:link\\[學生檔案\\]|control:button\\[關閉\\]~2)$',
        detail: '^相對「\\{名\\}的成績」 Δx -?\\d+、Δy -\\d+（',
        reason: '紀錄列數是資料：稿的示範學生場數多、整份列出；app 每頁 10 場',
        source: 'tools/a6-conformance/README.md「資料差的判定」：清單列數不同',
      },
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
      {
        status: '文案',
        a6: '>landmark:region\\[這一頁的摘要\\]>heading:h1\\[這週#堂課，#堂有異動。\\]$',
        detail: '→「這週#堂課，沒有異動。」$',
        reason: '資料差：seed 那週沒有異動',
        source: '#1923（本機 seed 2026-09-28 那週）',
      },
      {
        // 課表（日）稿有、週視圖稿沒畫；app 兩種檢視同一個工具列，時鐘鈕都在
        status: '多',
        app: '>landmark:main\\[\\]>control:button\\[操作紀錄\\]$',
        reason: '全站「操作紀錄」入口統一成工具列的時鐘圖示鈕：週視圖稿沒畫，保留',
        source: `${rule('R2')}；使用者 10-23 裁定 #2006（#2014）`,
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
      noCampusSwitch('看的是一場考試；班可能跨分校，誰能看由後端權限擋'),
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
  't-schedule': {
    a6: 't-schedule.html',
    // 老師端三支 sheet（#2290 換殼）：稿是 JS 開的 dialog.acset.fdlg，app 是 DynamicDialog（roster-sheet）
    a6Open: {
      arrivals: { click: 'button[data-roster]:has-text("到班名單")', root: 'dialog[open]' },
      log: { click: '[data-log]', root: 'dialog[open]' },
      book: { click: '[data-book]', root: 'dialog[open]' },
    },
    appOpen: {
      arrivals: {
        click: 'button:has-text("到班名單")',
        root: '.p-dialog:has(app-arrival-roster-sheet)',
      },
      log: { click: 'button:has-text("寫日誌")', root: '.p-dialog:has(app-class-log-sheet)' },
      book: {
        click: 'button:has-text("寫聯絡簿")',
        root: '.p-dialog:has(app-contact-book-roster)',
      },
    },
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
    // 課堂詳情（點課卡）：兩邊都是原生 dialog（#2290 換殼）
    a6Open: { detail: { click: '[data-s]', root: 'dialog[open]' } },
    appOpen: { detail: { click: '[data-part="session"]', root: 'dialog[open]' } },
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
      {
        // 稿同款（p-meals.html:122）：已結算的月份才有「併入 N 月的帳單」；seed 兩個月一個結算一個沒有
        status: '多',
        widths: [360],
        app: '>landmark:main\\[\\]>row>text:p(>control:link)?$',
        reason: '資料：「併入 N 月的帳單」只在已結算的月份出現',
        source: '.design-explorations p-meals.html:122（只在已結算的月份畫）',
      },
    ],
  },
  'p-dashboard': {
    a6: 'p-dashboard.html',
    // 唯讀詳情三種（課堂／聯絡簿／推薦課程）：兩邊都是原生 dialog（#2290 換殼）
    a6Open: {
      ses: { click: '[data-ses]', root: 'dialog[open]' },
      cb: { click: '[data-cb]', root: 'dialog[open]' },
      rec: { click: '[data-rec]', root: 'dialog[open]' },
    },
    appOpen: {
      ses: { click: '.dashboard__lesson', root: 'dialog[open]' },
      cb: { click: '.dashboard__log', root: 'dialog[open]' },
      rec: { click: '.dashboard__rec', root: 'dialog[open]' },
    },
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
      // 資料：量測當天（稿的今天 10/1）張宇軒沒課 —— 色面句寫「今天沒有課」、「今天的課」那章寫「接下來的課」
      {
        status: '文案',
        a6: '>landmark:region\\[這一頁的摘要\\]>heading:h1\\[\\{名\\}#到班了。\\]$',
        detail: '→「\\{名\\}今天沒有課。」$',
        reason: '資料：量測當天有沒有課',
        source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968`,
      },
      {
        status: '位置',
        widths: [360],
        a6: '>landmark:region\\[今天的課新\\]>text:span\\[#堂\\]$',
        reason: '資料：量測當天沒課，那一章是「接下來的課」，章頭的堂數跟著不同位置',
        source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968`,
      },
      // 資料：可加選的課（稿第二張是國三國文，seed 的是第一張）、代表的成績列（seed 那筆不及格、有老師評語）
      {
        status: '位置',
        widths: [1440],
        a6: '>landmark:region\\[可以加選的課新\\]>control:button\\[[^\\]]*\\]>text:span\\[[^\\]]*\\]$',
        reason: '資料：可加選的課與順序不同，同名的課卡落在不同欄',
        source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968`,
      },
      {
        status: '位置',
        widths: [360],
        a6: '>row>control:link>text:span\\[新成績\\]$',
        reason:
          '資料：代表的成績列在 seed 是不及格、有老師評語，「新成績」排在「不及格」後面、評語下面',
        source: `${rule('R5')}「家長頁量測帳號換 parent03」2026-10-23；#1968`,
      },
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
    // 學生面板（點學生名）：兩邊都是原生 dialog（#2290 換殼）
    a6Open: { panel: { click: '[data-sid]', root: 'dialog[open]' } },
    appOpen: { panel: { click: 'li > button.group', root: 'dialog[open]' } },
    app: '/teacher/students',
    state: path.join(cache, 'state-teacher.json'),
    // 篩選換成 A6 下拉（app-select-field），結構不同、外觀對齊 —— 同 p-grades
    deviations: [
      ...selectFieldDeviations('班級'),
      {
        // 稿的班 17～26 人（兩位數），seed 的班 1～10 人：數字變窄，「人」跟著左移
        status: '位置',
        a6: '>text:p\\[#\\]>text:span\\[人\\]$',
        detail: '^相對「#」 Δx -\\d+、Δy 0（',
        reason: '資料：班級人數位數不同（稿兩位數、seed 多是一位數），「人」跟著左移',
        source:
          'tools/a6-conformance/README.md:83（文案模板：數字 → #；位數不同造成的位移，工具不扣）',
      },
      // 學生面板主按鈕（#2317）：行政負責點名的機構（seed）寫「看到班名單」，老師負責照稿「到課表點名」
      {
        status: '文案',
        pop: 'panel',
        a6: '>control:link\\[到課表點名\\]$',
        reason: '行政負責點名時課表上沒有點名鈕，主按鈕改寫「看到班名單」（落點同課表）',
        source: 'kb/wiki/architecture/a6-adoption-rules.md R5「老師學生面板主按鈕」（#2317）',
      },
      {
        status: '位置',
        pop: 'panel',
        a6: '>control:link\\[到課表點名\\]$',
        reason:
          '連帶＋資料：文案不同配不上同名鈕；面板上方考試列數與家長電話是資料（稿 3 場、seed 2 場、沒留電話）',
        source: 'kb/wiki/architecture/a6-adoption-rules.md R5「老師學生面板主按鈕」（#2317）',
      },
    ],
  },
};
