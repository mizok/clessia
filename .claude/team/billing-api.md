# billing-api 席

> 金流、API、auth 核心、Workers 執行環境。session 會死，席位不死 —— 這頁是給下一個
> 接手的人的，不是流水帳。5 分鐘讀完能開工就算合格。

## 管什麼

| 路徑                                           | 說明                                      |
| ---------------------------------------------- | ----------------------------------------- |
| `apps/api/**`                                  | routes / middleware / lib / scripts，全部 |
| `supabase/migrations/**`、`supabase/seed.sql`  | schema 的唯一入口                         |
| `apps/web/src/app/core/auth*.ts`、`*.guard.ts` | auth 的前端接線（不含畫面）               |
| `apps/web/src/app/core/*.service.ts`           | **只做型別同步**，API 改了跟著改          |
| `tools/agent-harness/**`                       | 當 gate 要守 API／schema 的規則時         |

**不管**：web 的 features / 元件 / SCSS / UX、非金流 domain 的 kb spec、
`kb/wiki/architecture/constitution.md`（**agent 一律禁寫，含任何繞道**）。

## 必讀（照這個順序）

1. `AGENTS.md` —— 專案唯一指引
2. `kb/wiki/architecture/constitution.md` —— 法條。**動架構前必讀**
3. `kb/wiki/architecture/constitution-enforcement.md` —— 每條 clause 靠什麼守，含「邊界記錄」
4. `kb/wiki/architecture/line-oauth-login.md` —— 為什麼沒有密碼，破窗怎麼做
5. `kb/wiki/architecture/auth-pool-lifecycle.md` —— 連線池，Workers 的坑寫在這
6. `kb/wiki/rules/billing-rules.md` —— 金流的業務真相（P1 設計輸入）
7. `apps/api/src/index.ts` —— `mount()` 是所有授權的入口
8. `apps/api/src/middleware/auth.ts` —— roles + permissions 都在這裡進 context

## 這個 domain 的坑

### Workers 執行環境

- **不能有模組層 singleton**。I/O 物件不能跨請求（`Cannot perform I/O on behalf of a
different request`）。方向永遠是 per-request 建、請求結束收。
- **`waitUntil(pool.end())` 會當場把池關掉。** `pool.end()` 是呼叫當下就同步設
  `ending = true`（`pg-pool/index.js:494`），而 `waitUntil` 只延長 isolate 壽命、
  **不延後 promise 執行**。收尾一定要在 `await next()` 之後的 middleware 裡做 ——
  `lib/get-auth.ts` 的 `authPoolCleanup` 就是。這條坑值得記住的形狀是：
  **「延長壽命」不等於「延後執行」**。
- **`c.executionCtx` 在沒有 ExecutionContext 時會丟例外**（測試的 `app.request()`）。
  用 try/catch，不是 optional chaining。
- **10ms CPU 上限**是很多設計的源頭：密碼登入整條路被移除就是因為 scrypt 超過它，
  而任何安全的雜湊都會超過。不要試著「優化」回來。

### Better Auth 與 c2

- `ba_*` **可讀不可寫**（c2）。新增使用者走 `admin.createUser()`，**刻意不給
  password**（harness gate A11 守著）。
- **既有的 c2 違規存量**：`me.ts` / `parents.ts` / `staff.ts` 有直寫 `ba_user` 的
  email/phone。**不要新增，也不要順手修** —— 已列「`ba_user` 寫入路徑收斂」切片。
  你若新增，pre-guard hook 會當場擋你（它只看新寫入的文字，所以存量它看不見）。
- **magic-link 的 capture callback 綁在實例上**。共用 auth 實例之後不能再用建立時
  綁死的 callback —— 走 `c.set('magicLinkCapture', ...)` 這個每請求的可變槽，
  **用完立刻清成 undefined**。見 `routes/login-links/mint.ts`。

### 已經死掉的東西（別復活）

- **`profiles` 表沒有任何建立路徑**（`handle_new_user()` 在 Better Auth 遷移時被
  DROP，沒有替代品）。顯示名稱走 `lib/display-name.ts` 的 fallback 鏈，
  **不要「到處補 profiles 列」** —— 那是跟殭屍賽跑。
- **`payment_cycle` 與它的 enum 已 DROP**，取代者是 `billing_mode`
  （`monthly` / `period` / `session_pack`），欄位在 `enrollments` 上。
- **密碼、忘記密碼、username 登入全部不存在。** 程式碼裡約 20 處「這個系統沒有密碼」
  的墓碑註解**是資產不要清** —— 它們回答「為什麼這裡少了一段」，那是最容易被下一個人
  重新加回去的地方。`ba_user.username` 例外：那是 phone-only 家長的唯一性鍵，刪了
  匯入的重複偵測會壞。

### 授權

- **角色在 `mount()` 宣告，忘了寫連編譯都過不了**（gate A7 守著）。
- **`requirePermission` 是新的（#49 才有）。目前只有兩支金流路由掛了它。**
  其餘 API 仍然只有角色層 —— `permissions` 在那之前只是畫面控制，API 裸奔。
  鋪到既有路由需要先跟使用者定映射表，是獨立切片。
- 一律 **fail-closed**：context 沒有 roles/permissions、清單是空的 → 拒絕。
  授權的洞幾乎都長在「不確定的時候放行」上。
- `*` 通吃，規則必須與 web 的 `auth.hasPermission()` 一致，否則會出現
  「畫面看得到、API 打不進去」。
- **開放一個角色之前先問「這張表是誰的資料」，不要把同一套 scope 套上去。**
  P3 開放成績給老師時，三支路由要三種處理：`academy_exams` 有 `created_by`（老師自建
  的自己管）、`school_exams` 沒有 `created_by` 也沒有班級關聯（它是機構層目錄，老師
  唯讀，但**成績照樣是老師登錄的**）、`scores` 依學生範圍。當時的設計文件寫「school-exams
  唯讀」，實作時才發現那會把段考成績登錄整個擋掉 —— **STOP gate 通過不等於停止思考**。
- **查詢參數可以繞過範圍。** 範圍算出一份 id 清單之後，使用者傳來的 `class_id` 之類的
  篩選要跟它取**交集**，不能覆蓋 —— 覆蓋等於給了一個用參數跳出範圍的入口，而它看起來
  完全像正常的篩選。
- **加上 fail-closed 之後既有測試變紅，那是證據不是災難。** 紅的通常是「沒有宣告身分
  的測試 context」，正確的修法是補上身分並註明那組測試的主題，不是放寬檢查。

### lazy 生成的東西，寫入端一定看不到全部

`sessions` 的出勤 `event` 是**懶生成的** —— `ensureAttendanceSessionEvents` 在有人查
課堂列表時才補建。所以任何「建立 X 時順便去更新相關的 event」的 eager 連動，
**只寫得到那一刻已經存在的 event**，之後才生出來的一筆都拿不到，而且沒有人會回頭補。

實際踩到（#153）：建立請假時 `leaves.ts` 把當日的 event 寫成 `on_leave`，但
「家長提前請假 → 那堂課之後才生成 event」是最常見的順序，於是**未點名的課堂完全不知道
學生請假**。修法是**讀取時推導**（roster join 當日有效的 `leave_requests`），
不是補更多 eager 連動 —— 要補就得在補建 event 時回頭查請假並寫入，
也就是在一個 GET 裡再多做一次寫入。

**判準：資料是懶生成的，跟它有關的衍生狀態就該用推導的。** eager 寫入只在
「來源與目標的生命週期一致」時才安全。

### 資料細節

- **postgrest 的 `numeric` 回來是字串。** mapper 一定要 `Number()`，不然前端加總會變
  字串串接。`agreedAmount` / `fee_templates.amount` 都是。
- 金額用 `numeric(10,0)` —— 台幣沒有小數，整數存避免 `1000.00 vs 1000.0`。

### 效能

- **看到「空資料庫也慢」就別再找慢查詢。** 資料量無關的症狀要配資料量無關的原因：
  冷啟動、連線建立、每請求的固定成本、CPU 競爭。
- **fan-out 本身有成本，發生在任何 DB 工作之前。** 實測完全不碰 DB 的請求，並行 8 條時
  TTFB 從 0.46s 惡化到 ~1.1s（2.4 倍）。完整量測見
  [[lessons/workers-fanout-costs-before-the-db]]。
- 量到能**分開兩件事**為止：「重用連線 vs 新連線」分出網路／TLS，「並行 vs 序列」分出
  併發劣化。兩組對照就不用猜了。
- **N+1 在空資料庫上是隱形的。** 課堂列表原本每堂各發兩支查詢，空 DB 時是 0 次額外
  往返 —— 它不會出現在任何「空站很慢」的量測裡，但它隨資料線性成長。

## 慣例與模式

### test-first 在這裡長什麼樣

- **先寫測試看它紅，再實作。** 紅的證據要留在回報裡。
- 路由測試的慣例是**測 exported 的純函式**，不是打整支 handler
  （`schools.spec.ts` 是範本）。所以寫 route 時把值得測的邏輯抽成 export。
- 假 supabase：物件字面量 + 呼叫端 `as never`（`enrollments.spec.ts`）。要**打整支
  handler** 時用可鏈式的版本 —— `select/eq/range` 各自回自己、`range()` 真的切、
  `order()` 回 `{ data, count }`，外面包一層 Hono 把 `supabase` / `orgId` set 進 context
  （`invoices.spec.ts` 是範本）。
- **測「會回歸的東西」而不是「好測的東西」**。例：`requirePermission` 最重要那條是
  「context 裡根本沒有 permissions 時拒絕而不是全開」；harness 的 c6 gate 最重要那條是
  「規則被改名時 gate 不能靜默變成空掃」。
- **驗證要打到出錯的那一層，不是最好測的那一層。五次了，這是模式不是巧合：**

  | 事故                       | 錯在哪一層                     | 純函式測試為什麼看不到       |
  | -------------------------- | ------------------------------ | ---------------------------- |
  | seed 42702                 | plpgsql 的名稱解析             | 抽出來的段落裡沒有那些變數   |
  | 帳單列表 `meta.total`      | total 取自 `.range()` 之後     | 它不知道 total 從哪裡來      |
  | 聯絡簿週彙總（#129）       | 用錯欄位分組（`session_date`） | 它拿到的是已經分好組的 Map   |
  | `recorded_by_role`（#145） | 路由寫死 `'admin'` 沒傳 roles  | 函式本身是對的，沒人呼叫它   |
  | 密集日 seed 的「不破壞」   | 重跑會不會刪掉既有資料         | 筆數比對看不到「刪了再種回」 |

  共同形狀：**bug 在「資料怎麼餵進純函式」那一層，而純函式測試從定義上就在那一層之後。**
  所以動手寫測試之前先問一句：**這條規則是誰決定的？** 答案若是查詢、分組、參數解析、
  或執行環境，那測試就得跨到那裡去，抽再乾淨的純函式都補不上。
  代價通常只是一個假 supabase —— 比事故便宜得多。

  **第六個案例的盲區不在測試層級，在資料**（#158）：`profiles.id` 宣告成 `uuid`
  卻存 `ba_user.id`。Better Auth 產的是 nanoid，塞不進 uuid 欄位 ——
  但 **seed 的使用者 id 剛好都是 uuid 形狀的字串**，所以本機怎麼點都不炸，
  第一個真實的 LINE 帳號才踩到。
  **測試資料的形狀比正式資料窄時，型別／格式錯了也沒有一筆資料能證明它錯。**
  凡是「正式環境的值由外部系統產生」（Better Auth 的 id、OAuth 的 profile、
  第三方 webhook），就要問一句：**我的測試資料涵蓋得到它的形狀嗎？**

  **前面兩行是不同的兩種盲區，值得分開記：**
  - 第 4 行：函式正確但**沒人正確地呼叫它**。抽出純函式**沒有**讓路由被驗到，
    反而容易讓人以為驗過了。抽完要問「誰呼叫它、那個呼叫有被測到嗎」。
  - 第 5 行：**測量的指標本身有盲區**。冪等用筆數證明，而「刪掉 N 筆再種回 N 筆」
    在筆數上完全隱形。證「有沒有多出來」與證「有沒有弄壞既有的」是兩句話，
    要各自設計一個會失敗的情境。

### migration

- `npx supabase migration new <description>` 產檔，**已提交的不可改**（c3）。
- 新表**一律 `ENABLE ROW LEVEL SECURITY` 不建 policy** —— service role 會繞過它，
  這是 fail-closed 後盾（gate A8 會抓漏）。
- 改 `audit_logs.resource_type` 是 `DROP CONSTRAINT` + `ADD` **完整清單** ——
  也就是**時間戳最晚的那支說了算**（執行順序是時間戳，不是合併順序）。
  多軌並行時：由**時間戳最晚**的一方寫聯集；若兩軌時間戳交錯，後合的一方
  **另開一支時間戳最晚的 migration** 專門收斂清單（先例：
  `20260829110000_audit_logs_billing_resource_types.sql`，檔頭有完整的坑描述）。
  「先合的併進後合的清單」這條舊規則是錯的 —— 先合不代表先執行，照做會讓
  後執行的舊清單把新值靜默清掉，直到有人寫那種 audit log 才炸。
- 對應的 TS union 在 `utils/audit.ts`，**兩邊要一起改**否則 typecheck 紅。
- 換欄位時**不留雙軌**：兩個欄位並存的代價是每個讀寫點都要決定「聽哪一個」，
  而那個決定會在不同檔案裡做出不同答案。

### 「兩支各自綠、合起來紅」是一整類問題

`audit_logs` 的 constraint（**先合併的不一定先執行** —— 判斷依據是時間戳）踩過一次；
c8 的 allowlist 又踩了一次（清掉違規的 PR 對著較舊的 base 是綠的，合進 main 才不同步）。

共同形狀：**gate 的結果同時取決於 main 的狀態與這支 PR 的改動**。這類 gate 至少有
`audit_logs` constraint、`feature-map` 的 route 認領、c8/c6 的 allowlist。
碰到它們的時候，「我的分支 CI 綠」不代表「合進去之後還綠」。

### plpgsql 與 seed 的坑（2026-08-29 db:reset 事故後補）

- **plpgsql 變數一律 `v_` 前綴。** 裸名變數會跟同名欄位在 SQL 裡撞成 42702
  （column reference is ambiguous），而且**只在特定語句形狀發作** ——
  `ON CONFLICT` 的目標欄位、裸 `WHERE`。所以它可以潛伏很久，
  直到有人加了一句剛好那個形狀的 SQL。
- **transaction + ROLLBACK 抽段法驗不到 plpgsql 的名稱解析。**
  抽出來的版本裡沒有那些變數。**新程式碼落在 `DO $$ ... $$` 裡的話，
  必須把整份 seed 原樣執行**（一樣可以包在 transaction 裡 ROLLBACK，非破壞性）。

### transaction + ROLLBACK 驗證法

`npm run db:reset` 在這個席位的環境**被權限規則擋下**（會清空本機 DB）。替代做法：

```bash
{ echo "BEGIN;"; cat <新 migration>; echo "<斷言用的 SELECT>"; echo "ROLLBACK;"; } \
  | psql "postgresql://postgres:postgres@localhost:54322/postgres" -v ON_ERROR_STOP=1
```

**適用邊界**：它驗的是「這段 SQL 套到現行 schema 上會不會過、結果對不對」，
**不驗 migration runner 的排序與全新建庫**。而且本機 seed 常常沒有你要測的舊資料
（例：搬遷 `payment_cycle` 時 `UPDATE 0`）—— **要先在同一個 transaction 裡造資料，
不然你測到的是「空集合上跑得過」**。全流程 `db:reset` 要請有權限的人跑。

### 其他工具面的坑

- **`wrangler deploy --dry-run` 不驗證 binding 的 id 存不存在。** 實測填
  `<HYPERDRIVE_ID>` 照樣過 dry-run，只有真正的 deploy 才炸。所以凡是「要先 create
  才拿得到 id」的 binding（Hyperdrive、D1、KV…），**配置一律留成註解 + 啟用步驟**，
  不要填佔位值 —— 那等於在正式部署路徑上埋一顆下次有人裸跑 `wrangler deploy` 才引爆的雷
  （跟 2026-08-29 的 `--var` 事故同一類：只活一次的設定看起來像永久設定）。
- **`nx affected` 一律自己帶 `--base=main`**（`defaultBase` 指向不存在的 `dev`）。
- **web 沒有獨立 typecheck target** —— 模板改動（改個方法名）只有 `nx build web`
  抓得到，測試與 typecheck 都不會發現。動到 web 就跑 build。
- **root 依賴的升版流程在 [`infra.md`](infra.md) 第四節**，不在這裡抄一份（c11）。
  這裡只留一條跨席通用的：**絕不用 `--legacy-peer-deps`**（它會砍掉 67 個 peer
  帶進來的套件，含整包 eslint）。
  ⚠️ 這條原本寫著「root lock 無法從零重建、要用 `--force`」——**那個 ERESOLVE 已於
  #51 修掉**（workers-types 與 wrangler 一起升）。腐化的原因就是把別席的細節抄過來。
- `apps/api` 是獨立 package，要另外 `cd apps/api && npm ci`。

### 加欄位給消費端時的兩條預設

- **不要替既有欄位發明過濾規則。** #129 的課堂列表要標「這天有考試」，很容易順手把
  `status = 'draft'` 的濾掉 —— 但專案其他地方（`academy-exams` 列表）並沒有把 draft
  當隱藏。**同一個欄位在專案裡已有的處理方式就是預設值**；要偏離得有產品指示。
  自己加的過濾會製造「明明排了卻沒顯示」這種沒人查得出來的怪事，而且症狀離原因很遠。
  做法：照既有語意做，**把這個選擇寫進 PR 並附上「要改是一行」**，讓決定權回到產品。
- **形狀不同就另開端點，不要給舊端點加參數。** #129 的聯絡簿週彙總（每天一列）與既有的
  `/missing`（每生一列）是兩種形狀。同一個端點回兩種形狀，消費端就得先判斷自己拿到哪一種
  —— 那個判斷會在不同的呼叫點寫出不同答案。**加參數只在「同一種形狀、換一組資料」時才對。**

### 自動寫入 vs 人工修改（#145）

判準是**「來源是不是一個人的決定」，不是「是不是自動觸發的」**。

- 到班掃碼 → **不得覆蓋**既有紀錄（機器讀到一張卡，不該推翻老師的判斷）
- 請假 / 報名連動 → **覆蓋是刻意的**（請假也是人工，只是不同的人；業務規則允許事後補請）

兩者長得一模一樣（都是 upsert 撞既有紀錄），所以**看到後者不要當成前者那種 bug 修掉**。
完整說明在 `kb/wiki/rules/attendance-rules.md` 的「自動寫入與人工修改的優先順序」。

### 交付

- 一個切片一個分支一個 PR，**絕不自行 merge**。
- Conventional commits。PR 內文寫清楚：問題、做法、**取捨與理由**、驗證方式、
  **沒驗到的部分**。
- 設計層面的疑問**先問計畫席**，不要自行變更設計 —— 但**不受影響的部分照做**，
  不要整個停下來等。
- 回報用 SendMessage。**誠實回報驗證缺口**比宣稱全綠重要。

## 現在的狀態（2026-09-03 —— 這節會過期，接手第一件事：重寫它）

> **這節過期過兩輪，實害是真的**：2026-09-03 計畫席點名時，我照著它回報了三個
> 「卡在使用者」的阻塞，而那三件早就完成了（migration 已 push、Worker 已部署、
> demo 資料已灌）。**寫下的狀態比記得的狀態更容易錯**，因為它不會自己更新。
> 接手時先用內容驗證一遍，不要相信這節。

**P2 金流後端全齊**（A1 計費地基 → A2 帳單收款 → A3 餐務與月結 → 營收報表 → CSV 匯出）。

**P3 的 API 側目前沒有未完成的切片** —— 下列全部已合併並部署：

| 主題                                               | PR          |
| -------------------------------------------------- | ----------- |
| Hyperdrive 接入（**已上線，實測延遲砍半**）        | #128        |
| 課堂列表：停課、代課、`examCount`；聯絡簿週彙總    | #123 / #131 |
| 老師任課範圍查空（`schedules` 沒有 `org_id`）      | #134        |
| `attendance_records.status` 拔掉 `'absent'` 預設   | #137        |
| seed 補上出勤學生的家長關聯                        | #143        |
| 掃碼不覆蓋人工點名 + `recorded_by_role` 記實際角色 | #145        |
| 點名名單認得請假（讀取時推導）                     | #153        |
| `profiles.id` uuid → text（nanoid 阻斷 bug）       | #158        |
| auth middleware 的身分查詢失敗留下線索             | #163        |

**#129 中了幽靈合併** —— base 沒轉就被合進 #123 的死分支，內容從來沒進 main，
用 `git cherry-pick` 原封搬成 #131。**疊 PR 鐵律第 1 條的第二個案例**。

**觀察中（不瞎修）**：新增課程偶發「第一次 500、第二次 201」，而課程沒有重複 ——
證明 insert 從未發生、炸點在 handler 之前。唯一吻合的路徑是 `middleware/auth.ts`
三支身分查詢任一失敗時 `return` 的 500。冷測未能重現。#163 部署後，
下一次發生會在 tail 留下 `[auth] 身分查詢失敗：<表>=<訊息>`，那時才有得修。
**排查提醒：那是 `return` 出來的 500 不是拋出來的例外，`wrangler tail --status error`
很可能抓不到（它濾的是 invocation outcome，不是 HTTP 碼）—— 用 `--method POST`。**

**不進版控的交付**：密集日 demo 資料補丁（`dense-day-seed.sql` + README，在 scratchpad），
規格來自 design-web，**已灌進 demo 並驗收完畢**。

改善清單（依價值排序）：

1. **PostgREST 那一段還沒量過。** Hyperdrive 已上線、延遲砍半，但它**只加速走 `pg`
   的那條路**（Better Auth 的 session 查詢，每個受保護請求都會跑到）；業務路由走
   supabase-js 的 HTTP，**不經過它**。若要再進一步，先把 PostgREST 的延遲拆成
   **HTTP 往返 vs 查詢執行**兩段 —— 大頭在前者才值得談改走 `pg`，在後者就該去看
   查詢與索引。**沒拆之前不要立案**
2. **`ba_user` 寫入路徑收斂** —— c2 存量違規，加上 phone-only 家長改電話後合成 email
   不同步、管理員改與家長自己改兩條路徑對 `username` 處理不一致
3. **hook-only clause 對存量零覆蓋** —— c2 / c3 / c7 / c8 都是「有 hook 沒有 gate」，
   enforcement 表上卻寫「✅ 已接」。c6 已於 #41 補上 gate A12，那支可以當範本
4. **`requirePermission` 鋪到既有路由** —— 目前只有金流與報表掛了它，其餘 API 仍只有
   角色層。需要先跟使用者定映射表
5. `attendance` 的課堂列表在查詢**之前**會跑 `ensureAttendanceSessionEvents`，也就是
   一個 GET 端點在讀之前做寫入。沒展開查過；pooler 換完仍慢的話這是下一個該看的
6. 出勤補登窗的預設值（目前所有機構都是 `0` ＝ 無限制）要不要改成 7 天 —— 產品決定
7. web 的 CI 驗證面收斂（build 進 verify 序列或補 typecheck target）
8. **`seed.sql` 不可重入** —— 對已 seed 過的庫重跑會在清理 `staff` 時撞上
   `sessions_teacher_id_fkey`（清理順序沒先處理 `sessions` 對 `staff` 的參照）。
   `db:reset` 會先 drop schema 所以正常流程碰不到；哪天動 seed 清理段時順手理對
9. **`c.executionCtx` 的處理兩處不一致** —— `lib/get-auth.ts` 是 try/catch，
   `PATCH /api/attendance/batch` 的稽核紀錄直接丟。Workers 上一定有 executionCtx，
   正式站沒有實害，是整理不是修復；下次動同一段時順手收
