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

node tools/a6-conformance/run.mjs inventory              # 全部頁；或指定 students schedule …
node tools/a6-conformance/run.mjs diff students
node tools/a6-conformance/run.mjs behave                 # 第三層
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

## part key

`>landmark:main[]>landmark:region[國三]>list>row>control:link` —— 結構路徑，每段是
`kind:role[文案模板]`：

- 文案模板：數字（含千分位、時間、日期、區間）→ `#`；email → `{email}`；稿的假人名（從 `window.CLESSIA` 收）
  與 app 登入者的 `displayName`（`/api/me`）→ `{名}`；分校名（稿的 `CLESSIA.campuses`、app 的 `/api/campuses`，
  以及「全部分校」）→ `{分校}`；中文數字月份 →`#`；中文字旁的空白去掉
- **列是資料**：`ul/ol/tbody` 的子項，以及沒用 `li` 的 div 格線（同層同簽名、無標題，且 ≥5 個、或
  ≥3 個且子元素數相同）合成一個 `row`；列內 part 不帶文案、取聯集並記「幾列有」
- 列內 part 的幾何與樣式取**最常見的那種**當代表（稿的第一列可能是軸列、第一個課塊可能是「上課中」），
  並記下有幾種樣式變體；兩邊變體數不同時列成工具限制「列內狀態變體」，人工看
- 列內有底色或框線的短字（徽章：上課中、補課、待繳費）保留文案進 key，不按位置配
- landmark 與清單只認 `aria-label`，不吃整段內文
- 同層同名加 `~2`、`~3`；設計稿自帶的翻頁膠囊（`.proto-*`）不算

## 配對（`lib/diff.mjs` 的 `matchParts`）

1. `PAGES[頁].mapping`（A6 key → app key）
2. 完整 key 相同
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
| 資料差 | 列數、文字長度、隨資料增減的同型區塊造成的差 —— **不算設計差**，排最後                                     |

資料差的判定：`DATA_DEPENDENT`（config）列出的「只在某些資料下出現」的 part（例：「切換身分」只在多身分帳號出現）；清單列數不同；文字不同只解釋**寬度**（高度要行數也不同才算）；同父層下已有同型兄弟
配上的容器、或文案帶數字的選項（「高三 #」）；上方有上述東西時的 Δy。

樣式只比看得見的：字級／字重／行高／顏色只在**自己帶文字**的 part 上比（容器上是繼承值）；
0 寬或透明框線算沒有；gap 只在 flex／grid 上比；父層是 flex／grid 時 `inline-*` 被 blockify（`inline-flex`→`flex`），不算差。

## 報告的四欄

每條差異歸一欄（`classify`，依序判）：

1. **資料差**：上一節，不算設計差。
2. **工具限制**：命中下面「已知限制」裡會自動標註的那幾類 —— 工具量不準，**人工看**，不算待修也不算過。
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
