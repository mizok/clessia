# A6 conformance

把「頁面有沒有對齊 A6 稿」從肉眼並排變成**可重跑、可判定**的比對（#1314）。

- **第一層 `inventory`**：載入 A6 稿（跑 a6.js），在 1440／360 兩寬抽出 part 樹：landmark、標題、
  按鈕／連結／輸入（角色＋可及名稱）、清單與列、文案；逐一打開 `[popovertarget]` 彈出物再抽一次；
  另列 a6.js click handler 用到的 `[data-*]` 觸發點（第三層的素材）。
- **第二層 `diff`**：app 與 A6 同寬抽同一份 part 樹，配對後比幾何與 computed style，出差異表。
- 第三層（互動情境）還沒做。

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

- 文案模板：數字（含千分位、時間、日期、區間）→ `#`，稿的假人名（從 `window.CLESSIA` 收）→ `{名}`
- **列是資料**：`ul/ol/tbody` 的子項，以及沒用 `li` 的 div 格線（同層同簽名、無標題，且 ≥5 個、或
  ≥3 個且子元素數相同）合成一個 `row`；列內 part 不帶文案、取聯集並記「幾列有」
- landmark 與清單只認 `aria-label`，不吃整段內文
- 同層同名加 `~2`、`~3`；設計稿自帶的翻頁膠囊（`.proto-*`）不算

## 配對（`lib/diff.mjs` 的 `matchParts`）

1. `PAGES[頁].mapping`（A6 key → app key）
2. 完整 key 相同
3. key 後綴唯一：由短到長，有歧義就多帶一層祖先；依序比「嚴格」→「同類角色」
   （searchbox／textbox／combobox 同算輸入框）→「只看文案」（章名 A6 是 `div`、app 是 `h2` 也配得上）
4. 已配對的父層下，同 `kind:role` 的未配對子項數量相同 → 依 DOM 順序配

**為什麼用自動配對＋mapping 檔，不在 app 加 `data-a6-part`**：A6 key 才是真相，app 端不用先改
幾十個元件工具就能用；配不上會以「缺／多」明白報出來，不會靜默；例外集中在一個檔裡審。

## 差異分類與容差

| 狀態   | 意思                                                                                     |
| ------ | ---------------------------------------------------------------------------------------- |
| 缺／多 | 只有一邊有（只列最上層，子 part 併成「含 N 個」）；列內條件式的 part 會註明「N／M 列有」 |
| 角色   | 配上了但 kind/role 不同                                                                  |
| 文案   | 依位置配上、文案模板不同                                                                 |
| 位置   | 相對**最近的已配對祖先**，Δx 或 Δy 超過 ±4px                                             |
| 尺寸   | 寬／高超過 ±4px 或 ±3%（取大）                                                           |
| 樣式   | computed style 不同；字級／行高 ±0.5px，其餘逐字                                         |
| 資料差 | 列數、文字長度、隨資料增減的同型區塊造成的差 —— **不算設計差**，排最後                   |

資料差的判定：清單列數不同；文字不同只解釋**寬度**（高度要行數也不同才算）；同父層下已有同型兄弟
配上的容器、或文案帶數字的選項（「高三 #」）；上方有上述東西時的 Δy。

樣式只比看得見的：字級／字重／行高／顏色只在**自己帶文字**的 part 上比（容器上是繼承值）；
0 寬或透明框線算沒有；gap 只在 flex／grid 上比。

## 已知限制

- 偽元素（`::before／::after`）不量：用偽元素畫的線或圖示會被報成「沒有」，要人工確認。
  （包一層文字的 span 已處理：它的框線、底色、字會併回外層的控制項再比。）
- 兩邊同層同型子項數量不同時，第 4 步不配，會出現成對的「缺＋多」（例：單一角色帳號沒有「切換身分」，
  帳戶浮層的名字、email 也跟著配不上）。
- 收合的 `<details>` 內容沒有盒子，不列；要比展開態屬於第三層。
