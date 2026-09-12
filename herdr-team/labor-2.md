# labor-2 席 charter（執行席）

> **這一席原本沒有 charter。** 2026-09-12 開了 `labor-1` / `labor-2` / `labor-3` 三席，
> 而 README 的席位表沒有它們、`herdr-team/` 底下也沒有對應的檔 —— 於是
> 「session 會死，席位不死」那個前提對這三席**從第一天就不成立**：
> 新 session 接手時沒有東西可以繼承。這份是 labor-2 自己補的第一版。
>
> ⚠️ **席位表那三列、以及這一席的 domain 欄位要由計畫席填** —— 那是配置決定，
> 不是執行席能自己宣告的。下面「實際做過什麼」只描述觀察到的，不當成定義。

## 這一席實際做過什麼（2026-09-12，供計畫席定 domain 時參考）

跨領域，不綁單一 feature。一天內做過：**測試修復**（#670 時間炸彈、#661 搜尋競態）、
**產品缺陷**（#686 儀表板停課）、**工具與架構**（#693 路由 access、#702 UTC）、
**UI 地圖**（#685 的 ADMIN_STUDENT_AFFAIRS 六頁 + `admin/index`、`admin/notifications`）、
以及**團隊文件**（herdr README 數則）。

**共同點是「需要同時讀程式碼與跑東西」的工作** —— 純設計與純後端都沒碰到。

## 開席前置（不做的話第一個小時會追錯方向）

**新 worktree 沒有 `node_modules`，root 與 `apps/api` 各要 `npm ci` 一次。**

只裝 root 的話 web 測試跑得動，而 `npm run harness` 會紅成這樣：

```
Error: Command failed: npx tsx .api-param-probe.mjs
    at collectApiParams (tools/agent-harness/lib/api-param-coverage.mjs:124:17)
```

**訊息一個字都沒提到依賴**，它指著 harness 自己的檔案 —— 讀起來就是「這道 gate 壞了」。
完整成因與「為什麼不加 gate」在 issue #676。

## 跑單一支測試（本 repo 的坑，別處抄來的指令都不對）

| 想做的事        | 正確寫法                                                        | 錯的寫法會怎樣                                                                    |
| --------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 跑一支 web spec | `npx nx test web --include='**/foo.spec.ts'`                    | `npx vitest run <路徑>` → `Cannot find package '@core/…'`（path alias 要走 nx）   |
| 同上            | glob 要用 `**/`，不要給 `src/…` 相對路徑                        | 給相對路徑 → `No tests found matching the following patterns`                     |
| 傳 vitest 參數  | 用 builder 的選項（`--include` / `--filter` / `--setup-files`） | `-- --run` → nx 回 `'run' is not found in schema`                                 |
| 跑一支 api spec | `cd apps/api && npx vitest run src/…/foo.spec.ts`               | api 是 `nx:run-commands` 包 vitest，CLI 不吃 `--setupFiles`（要用 `-c <config>`） |

**每一種錯法的輸出都可以被讀成別的意思**（「這個檔壞了」「這個測試不存在」），
這就是 README 那條「指令跑了，但不是你以為的那個指令」在本 repo 的具體形狀。

## `npm run test:timetravel`

把時鐘推 `TT_MONTHS` 個月（預設 3）跑全庫，抓 fixture 日期寫死的測試。
**用法與觸發條件在 `AGENTS.md`，不在這裡**（同一條規則不要兩份，會漂）。

這一席要記得的只有一件：**它的 setup 為什麼必須在 top-level 而不是 `beforeAll`** ——
理由寫在 `apps/web/timetravel.setup.ts` 的正上方，**動它之前去讀那一段**。
第一版包在 `beforeAll` 裡誤報了 4 支寫得完全正確的測試。

## 這一席撞出來的一個程式碼形狀，值得認得

**「用日期窗口重建列表」跟「把 API 回來的清單過濾一下」長得很像，而行為差很多。**

`fillMissingDays`（`parent/pages/attendance/attendance.util.ts`）從
`[dateFrom, dateTo]` **逐日重建**整份列表 —— 窗外的紀錄**不是排到後面，是整筆消失**。
於是測試替身餵進去的 fixture 在畫面上完全不存在，而斷言只會說「找不到」。

**全 repo 只有一個呼叫端**，所以下一個寫這種寫法的人不會知道它是陷阱。

## 交付紀律（這一席真的靠它擋下東西的幾條）

這些是 README 通則的**本席載體**，寫在這裡是因為它們各救過至少一次：

1. **驗證失敗時先懷疑驗證器。** 時光機第一版誤報 4 支寫得完全正確的測試，
   是這條在報給計畫席**之前**擋下的 —— **那是唯一不用花第二個人時間的攔截點**。
2. **要判斷成敗的指令不要接管線。** `… | grep …; echo "(exit=$?)"` 拿到的是 `grep` 的 0。
   **先存變數**：`OUT=$(指令 2>&1); echo "退出碼=$?"`。
3. **force-push／疊分支之前，`gh pr view <N> --json state` 要是獨立的一次呼叫。**
   計畫席合得很快 —— 有兩支 PR 在我**兩次工具呼叫之間**被合掉。
4. **⚠️ 正控要挑「真的具備待測屬性」的那個位置，不只是「看起來同類」的。**
   查 #714 時我拿 `/admin/sessions` 的某支對話框當正控，理由是「那個檔案裡有
   明式 `closable: true`」—— **而那三處是給別支對話框的，我開的那支一樣沒傳**。
   **兩個同類互相比較，它們當然一樣**，而「做了正控」這個動作讓我以為已經驗過。
   **檢查點：你正要說「我拿 X 當正控」的那一刻 —— 去確認 X 真的有那個屬性，
   不是它旁邊的東西有。**
5. **引用 PR 編號當「它在哪裡」的證據之前先 `gh pr view <n> --json state,headRefName`。**
   我在一天內把別席的 commit 掛到錯的 PR 號**兩次**，兩次都是一查就分得出來的。

## 畫 UI 地圖（#685）—— 方法頁沒收、但會再撞到的幾件

**方法頁（`kb/wiki/specs/sitemap/README.md`）是唯一真相，這裡只放它沒有的。**

- **列元素時不要用文字過濾。** 關閉鈕常常是 icon-only、`innerText` 是空字串 ——
  `.filter(Boolean)` 會讓一支關得掉的對話框看起來關不掉。
- **`document.querySelector('.p-dialog')` 只回第一個。** 兩支疊著時第二支的探測會讀回
  第一支的內容、**一字不差**，看起來像「沒關乾淨」。用 `querySelectorAll` 逐個列舉。
- **合成的 `KeyboardEvent` 不等於真實按鍵。** CDK overlay 的 `keydownEvents()` 掛在
  overlay pane 上，派到 `document` 不會觸發；PrimeNG 的遮罩點擊也挑元素。
  **要宣告「關不掉」之前，用 `computer` 工具按真的 Escape、點真的座標。**
- **`closable` 沒帶不等於用預設值**（#714／#717）：`DynamicDialogComponent` 一律把
  `[closable]="ddconfig.closable"` 綁給內層 `p-dialog`，**`undefined` 會蓋掉它自己的 `true`**。
- **展示資料多半只有一種狀態**（學生全在籍、家長全 active、缺漏名單今天是空的）。
  **繫結存在但這輪量不到，是「未驗」不是「不會發生」** —— 每一項都要寫原因。

### 這一批留下的未驗清單（要補驗得先有資料）

| 頁面 | 未驗的分支 | 要什麼資料 |
| --- | --- | --- |
| `admin/students` | 停用列的選單、`・停用 M` 錨點 | 至少一名 `isActive: false` 的學生 |
| `admin/parents` | `inactive` / `archived` 列的選單（`啟用帳號`、disabled 的四項） | 各一位那兩種狀態的家長 |
| `admin/students/:id` | `加入班級` 消失、`主要` 家長徽章 | 一名停用學生、一位 `isPrimary` 家長 |
| `admin/leave` | `active` / `past` 兩種取消文案 | 進行中與已過期的請假各一筆 |
| `admin/contact-book` | 缺漏名單有資料時（`補寫`、展開／收合） | 今天有課卻沒寫聯絡簿的班 |
| 全部 | 空狀態、載入失敗、寫入路徑 | 需要斷網或清空，或本來就不驗 |

**這張表的用途是給造展示資料的人看的** —— 補上這幾種狀態，這批地圖才驗得完。

## 給下一個接手的人

- **charter 會腐化，接手時先驗一遍再信它。** 上面的指令表尤其 —— nx / vitest 升版會改。
- **方法類的知識先看 `kb/wiki/specs/sitemap/README.md` 與 `herdr-team/README.md`**，
  這份只放它們沒有的。同一條規則兩個地方各一份會漂。
- 這份**刻意不寫**「現在在做什麼、哪支 PR 在飛」。要查現況用
  `gh issue list --label seat:labor-2 --state open` 與 `gh pr list --state open`。
