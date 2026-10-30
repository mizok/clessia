# A6 conformance

把「頁面有沒有對齊 A6 稿」從肉眼並排變成**可重跑、可判定**的比對（#1314）。

- **第一層 `inventory`**：載入 A6 稿（跑 a6.js），在 1440／360 兩寬抽出 part 樹：landmark、標題、
  按鈕／連結／輸入（角色＋可及名稱）、清單與列、文案；逐一打開 `[popovertarget]` 彈出物再抽一次；
  另列 a6.js click handler 用到的 `[data-*]` 觸發點（第三層的素材）。
- **第二層 `diff`**：app 與 A6 同寬抽同一份 part 樹，配對後比幾何與 computed style，出差異表。
- **第三層 `behave`**：`lib/scenarios.mjs` 裡的情境，兩邊各開一頁照步驟操作，比操作前後的變化量。

A6 稿不進版控；輸出也不進版控（預設 `~/.cache/clessia-a6-conformance/out/<頁>/`）。

## 安裝與執行

```sh
npm install --prefix tools/a6-conformance          # 只裝 playwright，不碰 root 依賴樹
npx --prefix tools/a6-conformance playwright install chromium   # 機器上沒有瀏覽器時

# 登入態（第二層才需要）。WEB_URL 用 API 信任的 origin；連結一次有效，別先 curl
( set -a; . apps/api/.dev.vars; set +a; WEB_URL=http://localhost:4200 \
  LOGIN_EMAIL=admin@demo.clessia.app npx tsx apps/api/src/scripts/login-link.ts )
node tools/a6-conformance/login.mjs '<印出的連結>'
# 多身分帳號（teacher0001 也是家長）會被導到 /select-role：state 檔的 origins 補
#   localStorage clessia:active-role=teacher（state-teacher.json，t-students 用）
# 家長頁（p-*）用多孩子的家長 parent03（3 個孩子）：單孩子帳號量不到切換孩子這類東西（#1932）
( set -a; . apps/api/.dev.vars; set +a; WEB_URL=http://localhost:4200 \
  LOGIN_EMAIL=parent03@demo.clessia.app npx tsx apps/api/src/scripts/login-link.ts )
node tools/a6-conformance/login.mjs '<印出的連結>' ~/.cache/clessia-a6-conformance/state-parent03.json

node tools/a6-conformance/run.mjs inventory              # 全部頁；或指定 students schedule …
node tools/a6-conformance/run.mjs diff students
node tools/a6-conformance/run.mjs behave                 # 第三層
node tools/a6-conformance/run.mjs compare billing --base main --head <PR 分支>   # PR 驗收的前後對照
npm test --prefix tools/a6-conformance                   # spec
```

| 環境變數     | 預設                                               | 用途                                                               |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------------ |
| `A6_DIR`     | `.design-explorations/973-layout/a6-editorial`     | A6 稿目錄                                                          |
| `A6_APP_URL` | `http://localhost:4200`                            | web dev server                                                     |
| `A6_API_URL` | `http://localhost:8787`                            | API；不是 8787 時，工具在瀏覽器層把 8787 的請求轉過去（不改 repo） |
| `A6_STATE`   | `~/.cache/clessia-a6-conformance/state-admin.json` | 登入態                                                             |
| `A6_OUT`     | `~/.cache/clessia-a6-conformance/out`              | 輸出                                                               |

app 被導離目標路由（登入態失效、API 沒在跑）會直接報錯，不會拿登入頁去比。

頁面對照（稿檔 ↔ 路由、非原生彈出物怎麼打開、手動配對）在 `lib/config.mjs` 的 `PAGES`。
非原生彈出物（`a6Open`／`appOpen`）：`click` 可給陣列依序點（app 的「新增考試」先開選單再選補習班）；
量完先按 Escape，PrimeNG 動態彈窗不吃的話改點根裡的「取消」／關閉鈕 —— 不關掉的話遮罩會擋住後面每一次點擊。
A6 用 JS 開的表單彈窗（`A2.form` → `dialog.fdlg`）集中在 config 的 `FORM_DIALOGS`（#1772）。

## PR 驗收：`compare`

**PR 一律貼這張表**（10-15 計畫席）：各席自己切前後報告、混用工具版本時，數字不是同一把尺。

```sh
node tools/a6-conformance/run.mjs compare billing schedule --base main --head <PR 分支或 sha>
# 已有在跑的 web：--base-url http://localhost:4205 --head-url http://localhost:4206
```

同一個工具版本對兩個 app 版本各跑一次。每個 ref **每次執行**開一個自己的臨時 detached worktree
（`~/.cache/clessia-a6-conformance/wt/<sha>-<pid>-<亂數>`，同時跑幾個 compare 都不互相干擾）、起一個 web、
量完收掉（停 server、只移自己的 worktree）。API 與登入兩邊共用，表上會註明。

- ref 是分支名時，origin 與本機挑新的那顆（本機有未推的 commit 就用本機）；兩邊分叉就報錯，請直接給 sha
- 那個 ref 的 `package-lock.json` 跟本 repo 工作目錄的一樣 → 借用本 repo 的 `node_modules`；不一樣 → 在臨時
  worktree 裡 `npm ci`（log：`~/.cache/clessia-a6-conformance/install-*.log`）
- 冷編譯可能要幾分鐘（上限 600 秒）。編譯錯誤（`✘ [ERROR]`）會馬上停、報 log 路徑，不量 vite 的錯誤畫面；
  起不來或編譯失敗時 worktree 留著供查，看完自己刪（`git worktree remove --force <路徑>`）
- web 的 log：`~/.cache/clessia-a6-conformance/serve-<worktree>-<port>.log`

輸出在 `A6_OUT/compare/<頁>-<base>-<head>.md`：

- 表頭：工具 commit（**有未提交修改會標出來＝不可重現**）、base／head 的 ref 與 sha
- 每個寬度一張：殼層／頁面 × 待修／已記錄偏離／資料差／工具限制（base → head），全站（#1591）條數與命中處數
- **head 新增的待修**（回歸先看這裡，不會被總數抵銷）、修掉的待修條數

## part key

`>landmark:main[]>landmark:region[國三]>list>row>control:link` —— 結構路徑，每段是
`kind:role[文案模板]`：

- 文案模板：數字（含千分位、時間、日期、區間）→ `#`；email → `{email}`；稿的假人名（從 `window.CLESSIA` 收）
  與 app 登入者的 `displayName`（`/api/me`）→ `{名}`；分校名（稿的 `CLESSIA.campuses`、app 的 `/api/campuses`，
  以及「全部分校」）→ `{分校}`；中文數字月份 →`#`；中文字旁的空白去掉
- **列是資料**：`ul/ol/tbody` 的子項，以及沒用 `li` 的 div 格線（同層同簽名、無標題，且 ≥5 個、或
  ≥3 個且子元素數相同）合成一個 `row`；列內 part 不帶文案、取聯集並記「幾列有」
  - **頁面指名的列**（`PAGES[頁].rowSel`，`{ a6?, app? }` 的 CSS）：稿把每筆申請紀錄做成一顆獨立的 `button.rq`、沒有清單結構，
    指名之後它就是列、列裡保留那顆按鈕（key `row>control:button`，跟 app 的 `li>button` 一樣）。
    不用「按鈕並排就當列」的通則：週列的日期鈕、選身分的角色鈕也是同形按鈕並排，兩邊段數又不一樣，通則會讓一邊成列一邊不成
  - **欄位組不算「資料少的日子」的列**：下面那條「稿在這一層有列、app 同層 ≥2 個同形容器也認成列」不套用在
    `fieldset`、或有 `label[for]` 指向自己裡面欄位的容器（app 報名表的「開始日期」「備註」外框）。
    ≥3／≥5 的一般門檻照舊 —— 成績列裡也有帶 label 的分數框
- 列內 part 的幾何與樣式取**最常見的那種**當代表（稿的第一列可能是軸列、第一個課塊可能是「上課中」），
  並記下有幾種樣式變體；兩邊變體數不同時列成工具限制「列內狀態變體」，人工看
- 列內有底色或框線的短字（徽章：上課中、補課、待繳費）保留文案進 key，不按位置配
- 列內 part 的位置用「相對所在那一列」比（兩邊代表可能取自不同列）
- 資料少的日子：先抓稿，把「稿在哪些父層有列」傳給 app 端，app 同層 ≥2 個同形容器也認成列；
  只剩 1 個時認不出來，歸工具限制「資料太少」
- landmark 與清單只認 `aria-label`，不吃整段內文
- 同層同名加 `~2`、`~3`；設計稿自帶的翻頁膠囊（`.proto-*`）不算
- 稿的「新」標記（`span.new`）是設計說明（a6.js 的 ddLabel 也剔掉它）：key 照常帶「新」，另外記一份拿掉它的 `alt` 給配對用

## 配對（`lib/diff.mjs` 的 `matchParts`）

1. `PAGES[頁].mapping`（A6 key → app key）
2. 完整 key 相同；再用稿的 `alt`（拿掉「新」）比一次。下面的後綴配對也用 `alt`
3. key 後綴唯一：由短到長，有歧義就多帶一層祖先；依序比「嚴格」→「同類角色」
   （searchbox／textbox／combobox 同算輸入框）→「只看文案」（章名 A6 是 `div`、app 是 `h2` 也配得上）
   →「拿掉 `list` 那層」（稿的 div 列對 app 的 ul／li 列）。完全不帶文案的短後綴（`text:span`、
   `control:button>text:span`）不當依據 —— 剩下沒配上的很少時它常「剛好唯一」而配錯 —— 要延伸到有文案的段或整串 key
4. 已配對的父層下，同 `kind:role` 的未配對子項數量相同 → 依 DOM 順序配

**為什麼用自動配對＋mapping 檔，不在 app 加 `data-a6-part`**：A6 key 才是真相，app 端不用先改
幾十個元件工具就能用；配不上會以「缺／多」明白報出來，不會靜默；例外集中在一個檔裡審。

## 差異分類與容差

| 狀態   | 意思                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| 缺／多 | 只有一邊有（只列最上層，子 part 併成「含 N 個」）；列內條件式的 part 會註明「N／M 列有」                   |
| 角色   | 配上了但 kind/role 不同                                                                                    |
| 文案   | 依位置配上、文案模板不同                                                                                   |
| 位置   | 相對**最近的已配對祖先**，Δx 或 Δy 超過 ±4px；彈出物根沒有祖先時，距頁頂與距視窗底取差小的（手機抽屜貼底） |
| 尺寸   | 寬／高超過 ±4px 或 ±3%（取大）                                                                             |
| 樣式   | computed style 不同；字級／行高 ±0.5px，其餘逐字                                                           |
| 黏住   | 捲動後，稿還黏在視窗內的 part 在 app 被捲走（或反過來：app 多黏）。只比效果，不比寫法 —— 見下節            |
| 資料差 | 列數、文字長度、隨資料增減的同型區塊造成的差 —— **不算設計差**，排最後                                     |

資料差的判定：`DATA_DEPENDENT`（config）列出的「只在某些資料下出現」的 part（例：「切換身分」只在多身分帳號出現）；清單列數不同；文字不同只解釋**寬度**（高度要行數也不同才算）；同父層下已有同型兄弟
配上的容器、或文案帶數字的選項（「高三 #」）；上方有上述東西時的 Δy。

樣式只比看得見的：字級／字重／行高／顏色只在**自己帶文字**的 part 上比（容器上是繼承值）；
0 寬或透明框線算沒有；gap 只在 flex／grid 上比；父層是 flex／grid 時 `inline-*` 被 blockify（`inline-flex`→`flex`），不算差。

## 報告的分欄

每條差異歸一欄（`classify`，依序判）：

1. **資料差**：上一節，不算設計差。
2. **工具限制**：命中下面「已知限制」裡會自動標註的那幾類 —— 工具量不準，**人工看**，不算待修也不算過。
   例外：「同型段落數不同」的列若命中已記錄偏離，歸偏離（那個限制的意思就是請人工對，登記過＝對過了；
   「更多」選單稿有「通知中心」、app 有「公開申請」就是這樣，偏離歸好之後，後面各列的位移才連帶得起來）。
3. **全站**：`SITE_WIDE`（config）列的每頁都有的差（#1591：基底字級、main 範圍與盒子、頁面搜尋框框線），
   每頁收成一條、記命中幾處，不計入頁面待修。
4. **已記錄偏離**：命中 `lib/config.mjs` 的 `DEVIATIONS`（全站）或 `PAGES[頁].deviations`（單頁）。
   每條必須有 `reason` 與 `source`（kb 頁:行、issue 留言），報告逐條印出來。
5. **待修**：其餘。**目標是每頁歸零**。

偏離條目的寫法（欄位都是 regex 字串，`status` 必填）：

```js
{ status: '尺寸', kind: 'control', widths: [360], detail: '^高 \\d+→(4[4-9]|[5-9]\\d)',
  reason: '可點元素基底高 ≥44px，只管手機', source: 'kb/wiki/architecture/a6-adoption-rules.md:32-34（R3）' }
```

硬性規則（constitution-enforcement.md 的 A 條）用 `hardRule('A28')` 當 `source`：條號手寫、行號執行時查，查不到就報錯。
`item`（regex）：只拆樣式列裡的那一項（A28 的對比色），同列其他樣式差照算。

欄位：`status`（必填）、`detail`／`a6`／`app`／`host`（regex；host＝元件宿主，例如 `p-paginator`）、`kind`、`pop`（哪個彈出物）、`widths`（只在這些寬度生效）。
包裝層本身是偏離時（R7 的 search landmark），裡面真正多出／缺少的最上層東西各自拆列、各自歸欄。
缺／多的容器若裡面某一顆命中，會拆成自己一列歸偏離，容器本身仍是待修。

**沒有出處的不寫進來**。「近似」「差不多」不是理由；找不到出處就留在待修，請 gate 裁，裁完把留言連結當 source。

### 連帶

位移或容器尺寸的差，若能被**同一個參考容器裡已歸偏離或資料差**的變化量解釋，就跟著原因歸欄，
詳細欄註明「連帶自 N 處」。判定是「夠不夠」：每一軸，已歸好的原因加起來＋容差 ≥ 位移量就成立，不要求
所有可能原因都歸好。可用來解釋的量：

- 多出／少了的 part（寬或高＋父層 gap），**看方向**：往左（上）移＝左（上）邊少了、或（x 軸）右邊多了；
  往右（下）移相反。包住自己的多出區塊不算，但裡面跟自己並排的要算（工具列的「⋯」在多出的 search 區塊裡）
- 前面鄰居變高（變寬）的量
- 自己變大的整個增量（靠左 0、置中一半、靠右全部，取上限）
- 參考容器變大的一半 —— **只在稿上置中時**
- 參考容器的 padding 差（章節 padding 32→0，子項全部 Δy −32）

要算上**待修**的原因才夠時，自己仍是待修，但註明「連帶自待修『…』」—— 修好那一條它多半就跟著消失。

**參考容器**：最近的已配對祖先，但跳過「兩邊包的範圍不同」的（≥3 個或 ≥20% 子項一邊在裡面、一邊在外面，
例如 app 的 main 包住色面）。跳過後沒有祖先可用時，改量跟**上方最近一個已配對 part** 的間距。

## 黏住（sticky）

靜態幾何是在撐開到內容全高的視窗裡量的，什麼都不捲 —— sticky 漏了也量不出來（10-21 使用者發現 A6 的
章節左欄、彈窗動作列、週視圖欄頭在 app 大多沒黏，工具卻是「待修 0」）。所以分兩步：

1. **提名**（`diff.mjs`）：extract 給每個 part 記「被誰釘住」（`pin`：自己或最近的 `position: sticky` 祖先，
   含 `top／bottom／left／right`）。sticky 容器常不是 part（A6 的 `.chap__side` 是 div），所以記在裡面的 part 上。
   任一邊是**某個釘點最上層的 part**（父 part 不在同一個釘點）就提名一列，細節是兩邊的 offset（`sticky top 80px → 無`）。
2. **行為檢查**（`lib/sticky.mjs`，`diff` 時自動跑）：兩邊各用正常視窗高（`WIDTHS` 的 `height`）再開一次頁，
   往釘住的方向捲到「不黏就會離開視窗」，看元素還在不在可視區（視窗 ∩ 會裁切的祖先，該軸至少一半）；
   兩邊都黏住時再比**落點**：釘點容器（最上層 sticky 祖先）離視窗那一邊的距離，±4px：
   - top／left：最近的捲動容器捲到元素不黏時的位置整個越過起點；bottom／right：捲回起點，不黏時要在終點之外
   - **墊高**：資料少時容器太短、黏不黏都捲不出差別。量的時候暫插一塊兩個視窗長的空白 —— 有 sticky 的插在釘點的
     容器裡（黏住的範圍才會變長），沒有的插在最近的捲動容器裡（插在元素旁邊會把 dialog 的 footer 撐爆）
   - 捲動容器只算 overflow auto／scroll 的祖先；html／body 是 `overflow: hidden` 時文件不算（app 殼層）

判定（`stickyVerdict`）：效果一致的**不列**（報告表頭記「提名 N 處、一致 M 處」，看得出有沒有真的檢查）；

| 情況                                                                                  | 歸欄                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 稿捲過去還在、app 被捲走                                                              | 待修                                                    |
| 稿被捲走、app 還黏著，而稿**沒有**宣告 sticky（多黏）                                 | 待修                                                    |
| 稿宣告了 sticky 卻沒黏住（被只有自己高的容器框住，例：meals 的 `.savebar`），app 有黏 | 待修 —— 稿的 bug 由計畫席裁定後登記偏離（meals 已登記） |
| 稿這裡捲不出效果、或 app 墊高後仍捲不到                                               | 工具限制                                                |
| app 那邊沒有捲動容器（頂欄在殼層的捲動區外）                                          | 一致                                                    |

彈出物裡的也會檢查（重新打開同一個彈出物再捲）。要先操作才出現的（週視圖、改過分數才出現的儲存列）用
`PAGES[頁].prep`：`{ a6: [步驟], app: [步驟] }`，步驟格式同 `scenarios.mjs`，可加 `widths` 只在某些寬度做。
每頁每寬的逐項結果存在 `A6_OUT/<頁>/sticky-<d|m>.json`。

## 第三層：互動情境（`behave`）

情境寫在 `lib/scenarios.mjs`：`{ name, a6: [步驟], app: [步驟], ignore?, checkFocus? }`。步驟是
`{ click | fill: [目標, 字] | press | hover | wait }`，目標是 CSS 或 `{ role, name（regex）, nth }`。
觸發點從 inventory 的「互動觸發點」表找（a6.js 的 click handler）。

每個情境兩邊各開一頁（狀態不互相漏），操作前後各抽一次 part 樹，比**變化量**（兩邊資料不同，絕對狀態
本來就不會一樣）：

- 出現／消失的文案（列內文案與純數字不比；`ignore` 與 `PAGES[頁].behaveIgnore` 放隨資料變的文案）
- 變成選中／展開、取消的控制項 —— aria-current／pressed／expanded／selected／checked 任一，**不分是哪個屬性**
- 開著的浮層數變化、有沒有捲動
- 原生 `popovertarget` 的開啟鈕：瀏覽器不寫 `aria-expanded` 屬性，工具依目標是否 `:popover-open` 補上，兩邊才可比
- 只給螢幕閱讀器的文字（1px／clip，例如篩選結果的 live region）不比，報告另列「螢幕閱讀器」；第二層也排除它
- PrimeNG 分頁器的出現／消失不比（第二層已報 app 多分頁器）
- 焦點：只在情境宣告 `checkFocus` 時比。稿多半用 `innerHTML` 重畫，點完按鈕焦點掉回 body 是原型的副作用

## 已知限制

**會自動標註成「工具限制」的**：

| 標註           | 什麼時候                                                                                | 例子                                                        |
| -------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 結構範圍不同   | 配上的兩個容器（landmark／清單）包住的已配對 part 不一樣 —— 它自己的位置／尺寸不可比    | app 的 `main` 包住色面，稿的 `main` 在工具列之後（Δy −269） |
| 偽元素         | 底色或框線「一邊有、一邊沒有」，而**沒有的那一側**帶 `::before／::after`                | 線可能畫在偽元素上                                          |
| 同型段落數不同 | 父層配上了，對面同一個父層下也有沒配上的同 kind:role —— 第 4 步不配，成了一組「缺＋多」 | 兩邊同一個浮層裡的說明段落數不同、文案又對不上              |

**不會自動標註、讀報告時要知道的**：

- 偽元素本身不量（只用它來標註上面那一類）。
- `canvas`、`svg` 不量（色面的流場、圖示）。色面的底色若畫在 canvas 上，會顯示成透明。
- 收合的 `<details>`、沒打開的彈出物沒有盒子，不列；展開態屬於第三層。
- 包一層文字的 span 已處理：它的框線、底色、字會併回外層的控制項再比（app 導覽「目前頁」底線畫在 span 上）。

## 逐幀跳動（`jump.mjs`，#1859）

量「版面有沒有跳」用**實際畫出來的畫面**，不用 layout-shift。

```sh
A6_APP_URL=http://localhost:4212 A6_API_URL=http://localhost:8794 \
  node tools/a6-conformance/jump.mjs students dashboard --widths 1440,390 --out /tmp/jump.json
# 追區塊內部的東西：--sel 用分號隔開，每個選擇器一個標記色（最多 8 個）
node tools/a6-conformance/jump.mjs dashboard --sel 'app-dashboard .colls;app-dashboard nav.flex-col'
```

**做法**

1. 注入一段 CSS，替要追的區塊各加一條向內的純色 outline（`outline-offset: -2px`，不佔版面）。預設是頁面的頂層區塊（`main.shell-content > * > :nth-child(k)`）。
2. CDP `Page.startScreencast` 從導覽開始錄到 networkidle＋1.5 秒，每一幀 PNG。
3. 每一幀找各標記色的最上緣（水平每 8px 取樣），就是那一塊**畫在畫面上**的頂端。
4. 相鄰兩幀頂端的差＝那一幀跳了多少；輸出每頁的**單幀最大跳動 px**、是第幾塊、在第幾 ms，以及有變化的幀的時間軸（`--out`）。

**為什麼不用 layout-shift（`PerformanceObserver('layout-shift')`）**

- 它把 ResizeObserver 回呼**之前**那次排版也記成一次位移。
- 「用 WAAPI 把高度滑過去」這種修法，動畫是在 RO 回呼裡起的，所以會量到一對 +X／-X（間隔約 1ms），而那一幀畫面上根本沒畫出來。
- 結果是：跳改成滑之後，「單幀最大位移」看起來沒變，CLS 總分反而變高（每一幀的小位移都累加）。
- 逐幀畫面量的是使用者真正看到的東西：一次跳 300px 是 300，滑過去是每幀幾 px。

**限制**

- 只看得到可視範圍內的東西，所以視窗高度設成 2400。
- screencast 在負載下會掉幀，相鄰兩幀可能隔了不只 16ms。掉幀會讓滑的那一步看起來大一點，不會把跳變小。
- 標記色是純綠、洋紅、青、黃、藍、紅等，頁面上剛好有完全一樣顏色的東西時會誤判（容差 8）。
