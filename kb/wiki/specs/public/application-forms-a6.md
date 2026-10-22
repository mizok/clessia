---
title: 公開試聽申請、我要報名表單照 A6（設計稿）
summary: 設計稿（#1637；Q1–Q6、Q5′、Q6′ 已於 10-16 裁定完畢）。後端（public_applications、/api/public/*、honeypot＋Postgres 速率限制）與行政收件頁（/admin/applications）早已上線，缺的是 /trial、/enrollment 兩個前端頁。依裁定加：試聽表單補「與學生關係」（A6 偏離）、機器人驗證預設自架的 ALTCHA、部署可切換成 Turnstile、班級「開放公開報名」旗標、老師暱稱（對外只露暱稱，沒設就不露）、申請保存 6 個月由 pg_cron 刪除；三個 schema 變更合成一支 migration。拆成四支實作單。
category: spec
status: draft
updated: 2026-10-23
tags: [specs, public, trial, enrollment, a6, security, privacy, migration]
---

# 公開試聽申請、我要報名表單照 A6（設計稿）

> **狀態：設計稿。Q1–Q6（15:04）、Q6 補充（15:09）、Q5′／Q6′（15:25）已全部裁定（#1637 留言）；Q4′（15:38，#1665 留言）改了 Q4 的範圍，沒有待裁題。**
> 實作照 §6 拆單，每一單仍走 `clessia-feature-slice`；migration 屬保留類，正式 DB 由使用者 Approve。
> 稿：`.design-explorations/973-layout/a6-editorial/pub-trial.html`、`pub-enrollment.html`（以下 `D/`）。
> A6 全採（[[architecture/a6-adoption-rules]]），偏離逐條列在 §1 與該頁 R5。

## 結論先講

工單原本假設要從頭設計匿名送出與行政收件，**但這兩件事已經上線**：

| 部分                   | 現況（2026-10-16 查）                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 資料表                 | `public_applications`＋`public_application_targets`（migration `20261003172458`、`20261004054133`、`20261004055339`）                                                                                          |
| 匿名 API               | `GET /api/public/org`（外框的補習班名稱，只回 `name`，#1858）、`GET /api/public/catalog`、`POST /api/public/trial-applications`、`POST /api/public/enrollment-applications`（`apps/api/src/index.ts:290-293`） |
| 防濫用                 | honeypot → Postgres 速率限制 → 可選 Turnstile（`routes/public/application-common.ts`，測試 `abuse-guard.spec.ts`）                                                                                             |
| 這個部署屬於哪個 org   | 環境變數 `PUBLIC_ORG_SLUG`（`lib/public-org.ts`），沒設就回 404 `PUBLIC_DISABLED`                                                                                                                              |
| 行政收件               | `/admin/applications`（#1245）：新申請／已聯絡／已轉入／不受理／垃圾送件，可寫內部備註                                                                                                                         |
| **前端 `/trial`**      | **佔位**：「試聽頁面開發中」                                                                                                                                                                                   |
| **前端 `/enrollment`** | **佔位**：「報名頁面開發中」                                                                                                                                                                                   |

依裁定，除了把兩個前端頁照 A6 做出來，還要做：

| 裁定    | 內容                                                                                                                      | 落在哪                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Q1      | 試聽表單**補**「與學生關係」，行政頁照常顯示                                                                              | 前端（§1）                     |
| Q2＋Q3  | 申請保存 6 個月，pg_cron 每天刪，**已轉入的也刪**                                                                         | migration（§4.3）              |
| Q4＋Q4′ | 機器人驗證**預設 ALTCHA**（自架、不連外），**Turnstile 保留為可切換的部署設定**；兩者都不能被略過；honeypot、速率限制照舊 | API＋前端（§4.4）              |
| Q5      | 班級加「開放公開報名」旗標，行政在班級設定切換，公開目錄只列開放的班                                                      | migration＋API＋行政頁（§3）   |
| Q6      | 暱稱：staff 加 `nickname`（所有人員都能設），對外只露暱稱，**沒設就不露，絕不退回本名**                                   | migration＋API＋行政頁（§4.5） |

---

## 1. 表單內容（照 A6）

兩頁共用同一套版面（A6 `.pf`），掛在既有的 `PublicShellComponent` 右面；手機 ≤1024px 是 A6 的兩面切換（`.ps`，左面品牌、右面表單，`#form` 直接落在右面）。

### 共同欄位

| 欄位         | 型別                  | 必填 | 驗證／提示（A6 原文）                                                                      |
| ------------ | --------------------- | ---- | ------------------------------------------------------------------------------------------ |
| 家長姓名     | text                  | ✔    | 「還沒填家長姓名」                                                                         |
| Email        | email                 |      | 提示「不是登入帳號，是之後寄登入連結用的」；格式錯「Email 格式不對，例：name@example.com」 |
| 手機號碼     | tel                   |      | 去掉 `-`、空白後 `^09\d{8}$`，錯「手機要是 09 開頭的 10 碼數字」                           |
| （上兩欄）   |                       |      | 都空：「Email 和手機至少填一個」（DB 也有同一條 CHECK）                                    |
| 與學生的關係 | radio 三選一          | ✔    | 父親／母親／其他，預設不選；「還沒選與學生的關係」。**兩張表單都有**（Q1）                 |
| 學生姓名     | text                  | ✔    | 「還沒填學生姓名」                                                                         |
| 年級         | select（小一～高三）  | ✔    | 「還沒選年級」；選項用 web 既有的 `GRADE_LEVELS`／`GRADE_LEVEL_LABELS`，見下方註           |
| 就讀學校     | text                  | ✔    | 「還沒填就讀學校」                                                                         |
| 備註         | textarea              |      | 最多 500 字（API 上限）                                                                    |
| 個資同意     | checkbox＋聲明 dialog | ✔    | 「要先同意個資使用聲明，補習班才能聯絡你」；聲明內容見 §4.3                                |
| 機器人驗證   | ALTCHA（§4.4）        | ✔    | A6 那一列「已通過機器人驗證」照稿，ALTCHA 真的算完才顯示                                   |
| honeypot     | 隱藏的 `website`      |      | 真人看不到；有值時 API 回假成功                                                            |

> **年級清單怎麼共用**：API 的 `GRADES`（`routes/public/application-common.ts:12`）沒有 export，也不在 `packages/` 底下，前端拿不到。
> 但 web 已經有一份同值的 `GRADE_LEVELS`＋中文標籤（`core/students.service.ts:135`、`:150`），學生頁、匯入都在用 —— 公開表單直接用它，**不新增第三份**。
> 兩份的真相都是 DB 的 `grade_level` enum；把 API 與 web 合併到 `packages/shared-types` 是跨模組的清理，不在這張單裡做（年級十二級多年不變，漂移風險低）。

**A6 偏離（Q1，使用者指定）**：A6 的試聽稿沒有「與學生的關係」，這裡補上，版面照報名稿的同一欄。API／DB 本來就規定必填，後端不用改；行政頁本來就顯示關係（`applications.page.html:59`），也不用改。登記到 [[architecture/a6-adoption-rules]] R5。

### 試聽（`/trial`）多的

| 欄位         | 型別          | 必填 | 說明                                                                                                                                                                 |
| ------------ | ------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 想試聽的課程 | checkbox 多選 | ✔    | 「至少選一個想試聽的課程」。來源是 `GET /api/public/catalog`（只有開放公開報名的班，§3），**依 courseId 合併成課程**，依科目分組；選了年級後適合的課程標「適合小五」 |
| 方便的時段   | text          |      | 例「週三晚上」                                                                                                                                                       |

### 報名（`/enrollment`）多的

| 欄位           | 型別             | 必填 | 說明                                                                                                                                                                    |
| -------------- | ---------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 想報名的開課班 | checkbox 多選    | ✔    | 「至少選一個開課班」。每列：班名、學費、週X 起訖、**老師暱稱（有設才顯示，§4.5）**、剩 N 位；額滿的照樣可勾，寫「已額滿 · 勾選即登記候補」（API 回 `waitlistClassIds`） |
| 期望開始日期   | date，`min=今天` |      | 「開始日期不能早於今天」                                                                                                                                                |

頂部提示連到試聽表單（A6 原樣）。

### 送出

- **送出鈕不停用**（A6 notes:95）。按下去：逐欄標紅、按鈕旁寫「還沒填好：…」並抖一下、捲到第一個錯的欄位並 focus；之後每次輸入即時重驗。
- 送出中：按鈕換「送出中…」＋12px spinner（A6 處理中樣式）。ALTCHA 還在算時也是這個狀態（§4.4）。
- **成功**：換成結果畫面（不是另一頁，資料還在記憶體裡）。
  - 試聽：「試聽申請已送出」、摘要、「接下來」三步、`tel:` 電話、「再幫另一個孩子申請」（保留家長、清掉孩子和課程）、「已經是我們的家長？用 LINE 登入」。
  - 報名：「申請已送出」；全部額滿時改「已登記候補」，部分額滿加一句「其中 X 已額滿，已為您登記候補」；四步（審核 → 繳費單 → 付款確認 → 一次性登入連結＋LINE 綁定）。
- **失敗**（A6 只畫了速率限制，其餘照同一個位置與語氣補）：`role=alert`，**填的資料都留著**。
  - 429：「送出太多次了，請 {N} 分鐘後再試，或直接打 {電話}。你填的資料都還在。」—— **N 讀 HTTP header `Retry-After`（秒）換算、無條件進位**（API 只放 header，body 沒有秒數：`trial-applications.ts:78`、`enrollment-applications.ts:92`）；讀不到 header 時不寫分鐘數，只寫「請稍後再試」。
  - 400 驗證失敗：照欄位標紅；前端驗證和 API 同一套規則，正常不會走到。
  - 400 `CAPTCHA_FAILED`（題目過期或驗不過）：重新取一題、自動再算一次並重送；再失敗才顯示「驗證沒通過，請再按一次送出」。
  - 404 `PUBLIC_DISABLED`：整頁換成「這個補習班目前沒有開放線上申請，請直接來電」—— 自架的部署可以不開公開頁（c12）。
  - 網路／500：「沒送出去，請再試一次」＋重試，資料留著。

---

## 2. 家長登入後看得到公開申請嗎？—— **看不到**，維持現狀

- 公開申請**不建家長、學生、帳號**（[[rules/enrollment-rules]]：家長與學生在首次收款時才建），送出時沒有任何東西可以把它掛到一個家長帳號上。
- 行政在 `/admin/applications` 處理，「建立家長」開預填表單、不自動轉檔。轉入之後，家長登入看到的是正式的報名／試聽紀錄。
- A6 也這樣畫：公開頁 notes 寫明「沒有申請紀錄可以追」（`D/pub-trial.html:90`、`D/pub-enrollment.html:102`）。
- **公開端與家長端的差別刻意保留**：家長端是單選班、開始日期必填、可取消；公開端是多選、開始日期選填、不能取消（沒有身分可以驗證是本人）。

---

## 3. 多分校與「開放公開報名」（Q5）

**分校**：A6 公開稿沒有分校選擇。不加分校這一步，改在選項上標分校 —— 只有一個分校時什麼都不顯示（跟稿一樣），多於一個時：

- 報名：每一列開課班的時間後面加「· {分校名}」；分組維持依科目。
- 試聽：課程的簡介列出有開這門課的分校。試聽申請只記到課程，**由行政打電話時約分校和班**（[[flows/trial]]：pending → scheduled）。

拒絕「先選分校再列課」：多一步，也多一個「選錯分校之後課程清單整份換掉」的狀態。

**開放公開報名旗標（Q5）**：`classes.is_public_enrollment boolean NOT NULL DEFAULT true`（Q5′ 已裁：既有與新開的班預設都開放，要藏的由行政關掉）。

| 地方                                                       | 行為                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/public/catalog`                                  | 多一個條件 `.eq('is_public_enrollment', true)`                                                                                                               |
| `POST /api/public/enrollment-applications`                 | `classIds` 裡有不開放的 → 400，跟「班已結束」走同一條驗證（現在就會驗 classId 屬於開課中的班，不符回 `INVALID_CLASS`：`enrollment-applications.ts:111-117`） |
| `POST /api/public/trial-applications`                      | 一門課**至少有一個開放的班**才收（現行規則是「至少有一個開課中的班」，加上旗標）                                                                             |
| 行政：班級新增／編輯 dialog（`courses/class-form-dialog`） | 開關「開放公開報名」，說明「關掉之後，公開的報名、試聽表單看不到這一班；已送來的申請不受影響」                                                               |
| 行政：課程頁的班級列                                       | 關掉的班加小標「不公開」，讓人知道為什麼公開頁上找不到它                                                                                                     |
| 家長端（登入後）報名                                       | **不受影響** —— 旗標只管匿名的公開目錄                                                                                                                       |

**外洩面**：公開目錄只回開放、開課中、未結束的班；欄位是班名、年級、課程名與簡介、科目、分校名與聯絡資訊（§4.2）、時段、名額、預設學費、老師暱稱（§4.5）；不含老師本名、學生、內部備註。

---

## 4. 缺口與做法

### 4.1 試聽的「與學生關係」（Q1）

照裁定補欄位，見 §1。API、DB、行政頁都不用改。

### 4.2 成功畫面的電話、地址

稿的成功畫面與失敗訊息都要「補習班電話」，試聽還要「分校地址」。公開端現在拿不到：目錄只回 `campusName`。

`GET /api/public/catalog` 回應多一個 `campuses: [{ name, phone, address }]`（只含有開放班級的分校）。這三欄本來就是對外的聯絡資訊（`campuses.address`、`phone`，`20260215000002_create_campuses.sql:5-6`）。營業時間系統沒有欄位 —— **不顯示**，不為它加欄位。
多分校時成功畫面列出申請涉及的分校；試聽沒選到分校，列出有開這些課的分校。

### 4.3 個資保存 6 個月（Q2＋Q3）

A6 的個資聲明（`D/pub-trial.html:174-177`）寫「保存 6 個月，可以打電話要求查詢／更正／刪除」，照稿用這段文字。執行靠 pg_cron：

- 每天刪除 `created_at` 超過 6 個月的 `public_applications`，**不分狀態，含已轉入**（Q3：資料已經在正式的家長／學生表）。`public_application_targets` 是 `ON DELETE CASCADE`（`20261003172458_public_applications.sql:66`），一起刪。
- **稽核紀錄不用另外清**：行政改狀態時寫的稽核（`routes/public-applications.ts:243`）把「學生（家長）」姓名放在 `resource_name`，但 `audit_logs` 本來就有 90 天的刪除排程（`20260223140000_schedule_audit_log_cleanup.sql`），早於 6 個月。**這個前提若改了（稽核保存拉長到超過 6 個月），這裡要補去識別化** —— 寫進 migration 註解。
- pg_cron 在 repo 已有前例（`20260222000002_session_cleanup_cron.sql`、上述稽核清除），不是新依賴；它是 Postgres 擴充，自架的 Postgres 也裝得到（c12）。不用 Workers Cron Trigger：那是 Cloudflare 專屬能力。
- 查詢／更正／刪除請求走電話，行政在 `/admin/applications` 手動處理。**單筆刪除按鈕不在這張單**：沒有被裁到，要的話另開。

### 4.4 機器人驗證：ALTCHA（Q4）

**為什麼預設 ALTCHA**：MIT 授權、proof-of-work，伺服器端出題與驗算都在自己的程式裡，不連任何外部服務（c12）。Turnstile 是 Cloudflare 的服務，自架的客戶用不了 —— **Q4′（15:38）裁定保留為可選**：部署設 `CAPTCHA_PROVIDER=turnstile` 才走它，沒設預設 `altcha`。

**兩者都不能被略過**（Q4′ 原文要求 spec 守住）：沒附、驗不過 → 400 `CAPTCHA_FAILED`；`CAPTCHA_PROVIDER` 是不認得的值、或設成 turnstile 卻缺 `TURNSTILE_SECRET_KEY` → 503 `CAPTCHA_UNAVAILABLE`。**沒有「不驗」的設定**（原本「沒設 Turnstile secret 就不驗」的行為拿掉）。

**釘的版本與出處**（2026-10-16 查 npm，都已發布滿兩週）：

| 套件                    | 版本    | 發布日     | 出處                                                                                                                |
| ----------------------- | ------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `altcha-lib`（伺服器）  | `2.5.0` | 2026-09-10 | <https://github.com/altcha-org/altcha-lib>（README「API Reference → v2」；2.6.0 未滿兩週，兩版這兩段 API 逐字相同） |
| `altcha`（前端 widget） | `3.2.4` | 2026-09-30 | <https://github.com/altcha-org/altcha>                                                                              |

`altcha-lib` 的預設入口是 v2 API；v1 在另一個子路徑 `altcha-lib/v1`。**這裡只用 v2，不用 v1。**

流程（PR-2 實作後的樣子）：

1. 表單一打開，前端打 `GET /api/public/captcha`（`no-store`）：
   - `altcha` → `{ provider: 'altcha', challenge: { parameters, signature } }`。API 用 v2 `createChallenge`，`PBKDF2/SHA-256`、WebCrypto 版 `deriveKey`（`altcha-lib/algorithms/web/pbkdf2`）、確定式模式（帶 `counter`＋key 簽章，驗證只做 HMAC）、10 分鐘過期。cost 500、counter 300–600（PR-4 在 Playwright CPU 降速 4 倍下量到中位 2.0 秒；量測過程寫在 `ALTCHA_PARAMS` 的註解）。
   - `turnstile` → `{ provider: 'turnstile', siteKey }`（`TURNSTILE_SITE_KEY`）。site key 改由 API 給，web 的 `environment*.ts` 不再寫死。
2. 前端：`altcha` 時用 `altcha@3.2.4` 的 `altcha/lib`（`solveChallenge`＋WebCrypto 的 `pbkdf2.deriveKey`）在背景解題，**不掛 `<altcha-widget>`** —— A6 只畫一列「已通過機器人驗證」，widget 自己的勾選框與文案用不到（PR-4 實作時改的；payload 格式跟 widget 交出的一樣）；`turnstile` 時**一定要渲染 Turnstile widget**（token 只能從它拿；計畫席 10-16 16:31）。驗證失敗或逾時（ALTCHA 30 秒）顯示「重試驗證」，**這時不能送出**。A6 那一列「已通過機器人驗證」等驗證完成才顯示；按送出時還沒好，就等它好了再送（處於送出中狀態）。
3. 兩支 `POST` 的 body 仍用 `captchaToken`（兩家共用一個欄位；ALTCHA 時是 widget 的 payload）。守門順序維持 **honeypot → 速率限制 → 機器人驗證**。ALTCHA 那一步：payload 是 base64(JSON `{ challenge: { parameters, signature }, solution }`)，解開後交給 v2 `verifySolution`（過期、簽章、解答都由它判），格式壞掉一律當沒通過。
4. **金鑰**：`ALTCHA_HMAC_KEY`；沒設時用 `BETTER_AUTH_SECRET` 經 HMAC 衍生（題目簽章與 key 簽章各衍生一把）。

**§4.4 原本列的三個未證實項，PR-2 第一步查完（10-16）**：

- **Workers 上能不能跑**：可以。`altcha-lib` 2.5.0 的 `algorithms/web/*` 與簽章只用 `crypto.subtle`；在 `wrangler dev`（workerd）下實際出題 → 解題 → 送出，正確解答過守門、竄改與未附回 `CAPTCHA_FAILED`。
- **widget payload 格式**：altcha 3.2.4 `dist/main/altcha.js` 的 `verify()` 交出 `btoa(JSON.stringify({ challenge: { parameters, signature }, solution }))`；只有題目帶 `_version: 1` 時才改出 v1 格式。test 模式交 `{ challenge: null, … }`，API 拒收。
- **widget 3.x 解的是不是 lib v2 題目**：是。widget 內建的就是 lib v2 的 `createChallenge`／`solveChallengeWorkers`（`dist/lib/index.js`），counterMode `uint32`。

**刻意不做重放防護表**：同一份解答在 10 分鐘有效期內可以重送。不另建「用過的題目」表，因為速率限制已經把同一來源壓在每小時 5 筆、同一聯絡方式每天 3 筆，重送拿不到更多額度。（Email 不分大小寫：寫入時轉小寫、比對用跳脫過萬用字元的 `ilike`，舊資料不 backfill 也算得到，#1335。）程式碼用 `ponytail:` 註解寫明這個上限與升級路徑：出現濫用時，加一張 Postgres 表記錄用過的 signature，過期就刪。（README 有 `/docs/store.md`，可以參考它的介面，但儲存一律放 Postgres，不用 KV，c12。）

**載入**：widget（ALTCHA 或 Turnstile 擇一）只在 `/trial`、`/enrollment` lazy 載入，不進主 bundle。

### 4.5 暱稱（Q6，15:09 補充：開給所有 staff）

- `staff.nickname text NULL`，去掉頭尾空白後長度 1–20（CHECK）。
- **欄位開給所有 staff**（老師、行政、管理員都能設；`staff` 表本來就是所有人員共用一張）。人員管理的新增／編輯表單對任何人員都顯示「對外暱稱」欄，說明「對外的頁面只會顯示暱稱；不填就不顯示這個人」。編輯權限沿用人員資料的 `manage_staff`，不另訂。
- **對外顯示的規則不因此擴大**：只有實際出現在公開頁的人會被露出 —— 目前只有班級的任課老師（下一點）。行政、管理員設了暱稱也不會出現在任何公開回應裡，除非之後有新的公開頁要顯示他們（那時另裁）。
- **本人也可以改（Q6′ 已裁）**：帳號設定 dialog（`shared/components/account-settings-dialog`，現在可自己改顯示名稱、生日、Email）加「對外暱稱」欄，走 `/api/me` 更新；長度與 CHECK 同一條，不另設審核。家長也會開這個 dialog，暱稱欄只對有 staff 身分的人顯示。管理員仍可在人員管理改。
- 公開目錄每一班多一個 `teacherNicknames: string[]`：取這一班**目前有效的 schedules**（`effective_to` 為空或未過）的 `teacher_id`，只 select `staff(nickname)`，去掉 null 與重複。**select 字串裡不出現 `display_name`** —— 從查詢那一步就拿不到本名，而不是拿到再濾掉。
- **spec 守住**（裁定原文要求）：有一位老師 `display_name='王小明'`、`nickname=null` 時，`GET /api/public/catalog` 的回應**序列化成字串後不含 `王小明`**，且那一班的 `teacherNicknames` 是空陣列；另一條是有暱稱時只出現暱稱。
- 前端：有暱稱才在班級列顯示，沒有就整格不顯示（不寫「未定」之類的字）。

---

## 5. Migration（一支，保留類）

Q2、Q5、Q6 合成一支：`supabase/migrations/<時間戳>_public_forms_flag_nickname_retention.sql`。它只加欄位（帶預設值）和排程，不改既有資料的值，**不是 backfill**，不需要 `-- clessia:apply after-deploy`，可以跟程式碼同一支 PR（§6 PR-1）。

```sql
-- #1637（使用者 2026-10-16 15:04 裁定 Q2／Q5／Q6）

-- Q5：班級是否出現在公開的報名／試聽表單（只管匿名公開目錄，家長端不受影響）
ALTER TABLE public.classes
  ADD COLUMN is_public_enrollment boolean NOT NULL DEFAULT true;  -- Q5′ 已裁：預設開放

-- Q6：對外顯示用的暱稱（所有 staff 都能設）；沒設就不對外顯示，絕不退回 display_name
ALTER TABLE public.staff
  ADD COLUMN nickname text
  CONSTRAINT staff_nickname_len CHECK (nickname IS NULL OR char_length(btrim(nickname)) BETWEEN 1 AND 20);

-- Q2＋Q3：公開申請保存 6 個月，不分狀態（含已轉入）；targets 是 ON DELETE CASCADE。
-- 稽核 resource_name 含姓名，但 audit_logs 有 90 天清除（20260223140000），早於 6 個月；
-- 若稽核保存期限改到超過 6 個月，這裡要補去識別化。
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule('purge-public-applications') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'purge-public-applications'
);
SELECT cron.schedule(
  'purge-public-applications',
  '30 18 * * *',  -- UTC 18:30 = 台北 02:30，錯開稽核清除的 18:00
  $$ DELETE FROM public.public_applications WHERE created_at < NOW() - INTERVAL '6 months' $$
);
```

- `ADD COLUMN … NOT NULL DEFAULT <常數>` 在 Postgres 11+ 只改目錄、不重寫表，不會長時間鎖表。
- 不另建索引：公開目錄已經用 `org_id`＋`is_active` 篩，開放旗標在這之後濾，班級數是幾十到幾百。
- 本機驗證：`npm run db:reset` 被 deny；migration 在本機由 `labor-db-reset` 席代跑，或用 `supabase migration up` 套到本機，經計畫席排班（實作單內決定）。

---

## 6. 實作拆單

| 單   | 內容                                                                                                                                                                                                                                                                | 類別                    | 依賴       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------- |
| PR-1 | **migration（§5）＋公開目錄 API**：開放旗標過濾、兩支 POST 拒收不開放的班／課、`teacherNicknames`（含「無暱稱不露本名」spec）、`campuses` 聯絡資訊（§4.2）                                                                                                          | **保留類**（migration） | —          |
| PR-2 | **ALTCHA 為預設、Turnstile 可切換（API 端）**：先查掉 §4.4 的三個未證實；`GET /api/public/captcha`、`verifySolution`、金鑰衍生、`CAPTCHA_PROVIDER`；`abuse-guard.spec.ts` 改寫                                                                                      | 保留類（防濫用屬安全）  | —          |
| PR-3 | **行政頁**：班級 dialog 的「開放公開報名」開關＋課程頁「不公開」小標、人員表單的「對外暱稱」欄（所有人員）；班級／人員更新 API 收這兩欄；帳號設定 dialog 加暱稱欄（只對 staff 顯示）與 `/api/me` 對應更新（Q6′）                                                    | 一般                    | PR-1       |
| PR-4 | **公開表單前端**：`/trial`、`/enrollment` 照 A6（§1）、ALTCHA widget、成功／失敗畫面；訂正 `specs/public/trial.md`、`enrollment.md` 已過期的資料依賴（寫 `trial_requests`／`enrollment_requests`，實際是 `public_applications`）；a6-adoption-rules R5 登記 Q1 偏離 | 一般                    | PR-1、PR-2 |

PR-1 與 PR-2 可以並行。兩支都會碰兩個 POST 路由檔（PR-1 改選班驗證，PR-2 改守門），後合的那支 merge main 解衝突。
PR-4 的驗收照 [[architecture/a6-adoption-rules]] R4：附 `tools/a6-conformance` 報告。

## 7. 明確不做

- 公開申請自動轉成家長／學生／報名（規則：行政手動轉入）。
- 家長登入後看到自己先前的公開申請（§2）。
- 申請人自己取消或查進度（沒有身分可以驗證）。
- 寄確認信或簡訊、LINE 通知（LINE Messaging API 已否決）。
- 行政頁的單筆刪除按鈕（§4.3）。
- ALTCHA 的重放防護表（§4.4）。
- 「不驗」的機器人驗證設定（Q4′：兩者都不能被略過）。
- 年級清單合併到 `packages/shared-types`（§1）。

## 8. 裁定紀錄（#1637 留言）

沒有待裁題。

### 已裁

| #                   | 裁定                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Q1                  | 試聽表單補「與學生關係」，行政頁顯示；登記為 A6 偏離                                         |
| Q2                  | pg_cron 每天刪超過 6 個月的申請（一支 migration，要 Approve）                                |
| Q3                  | 已轉入的申請到期也刪                                                                         |
| Q4                  | 加機器人驗證，用 ALTCHA；不用 Turnstile；honeypot、速率限制保留                              |
| Q4′（15:38，#1665） | 折衷：預設 ALTCHA，保留可切換成 Turnstile 的部署設定（`CAPTCHA_PROVIDER`）；兩者都不能被略過 |
| Q5                  | 班級加「開放公開報名」旗標，行政在班級設定切換，公開目錄只列開放的班                         |
| Q6                  | staff 加 nickname，對外只公開暱稱；沒暱稱不顯示，絕不退回本名；spec 守住                     |
| Q6 補充（15:09）    | 暱稱開給所有 staff（含管理員、行政）；對外只露實際出現在公開頁的人（目前只有任課老師）       |
| Q5′（15:25）        | `is_public_enrollment` 預設 `true`                                                           |
| Q6′（15:25）        | 本人可在帳號設定改自己的暱稱；管理員也可在人員管理改                                         |
