---
title: 部署
summary: 三個元件（Supabase / Workers / Pages）、哪些步驟只有人能做、為什麼 API 必須能在 Node 底下跑，以及正式 DB 的 migration 怎麼由 CI 代套。
category: architecture
tags: [architecture, deployment, cloudflare, supabase]
status: active
updated: 2026-10-01
---

# 部署

## 三個元件

|        | 跑在哪                                                 | 誰付錢                                              |
| ------ | ------------------------------------------------------ | --------------------------------------------------- |
| 資料庫 | Supabase（建議 `ap-northeast-1` 東京，對台灣延遲最低） | **客戶**（見 [[architecture/vendor-relationship]]） |
| API    | Cloudflare Workers                                     | 供應商或客戶                                        |
| Web    | Cloudflare Pages                                       | 同上                                                |

部署目標寫在 `apps/api/wrangler.toml`。**允許的來源不寫死在任何檔案裡** —— 見下方「每個客戶自己的網域」。
`AGENTS.md` 曾寫「Deploy: Vercel」，那是文件漂移，已修。

## API 必須能在 Node 底下跑

`apps/api/src/server.ts` 是 Node 入口點：

```bash
node --import tsx apps/api/src/server.ts
```

**這是憲法 [[architecture/constitution|c12]] 的實作證明**。沒有它，「客戶能自架」在程式碼層面
只是理論——`wrangler dev` 是唯一跑法，而 wrangler 不能自架。

已實測：根路徑回 200、未登入的 `/api/me` 回 401（middleware 有作用）。

## 機密不進版控，但非機密**必須**進版控

`wrangler.toml` 會進版控，**只放非機密設定** —— 而且非機密設定**只能放這裡**。
用 `--var` 跟著部署指令給的值只活在那一次部署：下一個人裸跑 `wrangler deploy`
就會把它們全部丟掉。2026-08-29 正式站的 LINE 登入就是這樣斷的
（`PROVIDER_NOT_FOUND` —— LINE_CLIENT_ID 隨著一次乾淨的重新部署蒸發）。
`[env.production.vars]` 必須列出全部非機密設定；secrets 有跨部署保留機制，不受影響。

四個機密走 `wrangler secret`：

```bash
npx wrangler secret put SUPABASE_SECRET_KEY --env production
npx wrangler secret put BETTER_AUTH_SECRET --env production
npx wrangler secret put DATABASE_URL --env production
npx wrangler secret put LINE_CLIENT_SECRET --env production
```

非機密的部署值用 `--var` 在部署時傳（不寫進 `wrangler.toml`，每個客戶不同）：

```bash
npx wrangler deploy --env production \
  --var SUPABASE_URL:https://<ref>.supabase.co \
  --var BETTER_AUTH_URL:https://<你的網域> \
  --var WEB_URL:https://<你的網域> \
  --var ALLOWED_ORIGINS: \
  --var LINE_CLIENT_ID:<Channel ID>
```

> ⚠️ **忘記帶 `LINE_CLIENT_ID` 就沒有人能登入。** `socialProvidersFromEnv` 少一個變數
> 就整個不設定 provider，登入頁的 LINE 按鈕會**靜默失效**，而且沒有任何錯誤指向設定缺失。
> 唯一的退路是 `npm run login-link`。

本機開發放 `apps/api/.dev.vars`（已 gitignore）。

> 2026-08 之前 `wrangler.toml` 直接寫了這三個值，其中 `DATABASE_URL` 含 `postgres:postgres`
> 明文。那是本機值不是正式值，但格式本身就在教人把正式值也寫進去。

## 每個客戶自己的網域

允許的來源不寫死。每個客戶是自己的部署、自己的網域（c12），寫死等於只有一個客戶能用。
三個來源合併（`apps/api/src/lib/origins.ts` 的 `allowedOrigins()`）：

| 來源                  | 說明                                                         |
| --------------------- | ------------------------------------------------------------ |
| `WEB_URL`             | 這個部署的前端。**依定義可信，不必再列進 `ALLOWED_ORIGINS`** |
| `ALLOWED_ORIGINS`     | 逗號分隔的額外來源（自訂網域、第二個前端）                   |
| localhost / 127.0.0.1 | 本機開發，任意 port                                          |

都沒設定時只剩本機來源，正式站會全部被 CORS 擋掉。這是刻意的 fail-closed：忘記設定的
症狀是「連不上」，不是「誰都連得上」。

> ⚠️ **允許清單一定要從 `c.env` 讀，不能在模組層級算好。** Cloudflare Workers 的環境變數
> 在 request-scoped 的 `c.env` 上，不在 `process.env`（`compatibility_date` 早於 Cloudflare
> 開始填 `process.env` 的版本）。2026-08 第一次上線時就是這樣：模組層級的常數在載入時
> 讀 `process.env` 拿到空字串，正式站前端整個被 CORS 擋，而本機測試全綠 —— 因為測試呼叫
> `app.request(url, init)` 時沒帶第三個參數 `env`，走的是同一條 localhost 路徑。
> `process.env` 的退路只服務 Node 自架（`server.ts`）。

## 前端與 API 必須同源

**部署方式是兩者掛在同一個 hostname 上**：

```text
demo.clessia.cc/         → Cloudflare Pages（前端）
demo.clessia.cc/api/*    → Cloudflare Worker（API，用 route 不是 custom domain）
```

Worker route 的優先權高於 Pages，所以 `/api/*` 會被 Worker 接走，其餘走 SPA。
⚠️ **一定要選 Route 不是 Custom domain** —— Custom domain 會接管整個 hostname，把前端也吃掉。

`environment.production.ts` 的 `apiUrl` 因此是**空字串**（相對路徑）。

### 為什麼不是子網域

`app.example.com` + `api.example.com` 是**同站但不同源**，cookie 仍受 SameSite 規則管。
同源則完全不適用那些規則，而且連 CORS 都不需要。

### 這裡踩過的坑（別再回去）

2026-08 曾經是跨站部署（`clessia.pages.dev` 對 `*.workers.dev`），為此加了
`SameSite=None; Secure; Partitioned`。兩個後果：

1. **iOS 18.3 以下的 Safari 完全登不進去** —— 它封鎖所有非分區的第三方 cookie，
   而 `Partitioned`（CHIPS）要 Safari 18.4 才支援
2. **`Partitioned` 打斷了 OAuth** —— state cookie 在「前端發的 XHR」時被設定
   （分區鍵是前端），但 callback 是「LINE 導回來的頂層導航」（分區鍵不同），
   cookie 送不出去，每次登入都 `state_mismatch`

同源之後這兩個問題都消失，`crossSiteCookieAttributes()` 整段已刪除。

> `.cc` 不在 HSTS 預載清單裡（`.app` / `.dev` 才有），所以強制 HTTPS 要在
> Cloudflare 的 SSL/TLS → Edge Certificates → HSTS 手動開。**開之前先確認網站
> 能正常用 HTTPS** —— HSTS 生效後瀏覽器會記住一段時間，設錯很難救。

## SPA fallback

`apps/web/public/_redirects`：

```
/*    /index.html   200
```

沒有它，任何非根路徑重新整理都會 404——Angular 的路由在瀏覽器端，
`/admin/students` 在伺服器上沒有對應檔案。`200` 是 rewrite 不是 302。

## Hyperdrive（正式環境的資料庫連線）

Workers **不能跨請求重用 I/O 物件**，所以每個受保護的請求都自己開一個連線池
（見 [[architecture/auth-pool-lifecycle]]）。代價是每次都要對 Supabase 重做一次
TCP + TLS + 認證握手，而 Worker 跑在使用者附近、資料庫在新加坡 —— 這段握手是實測
延遲裡的主要成分，不是慢查詢。

Hyperdrive 在 Cloudflare 邊緣維持到 origin 的長連線，Worker 連的是本地的它。程式碼
不必改連線邏輯，只是連線字串換來源：`src/lib/database-url.ts` 優先讀 binding 的
`connectionString`，**沒有 binding 就退回 `DATABASE_URL`**。那條退路是 c12 的一部分 ——
`server.ts` 的 Node 自架路徑根本沒有 Cloudflare。

啟用順序（`wrangler.toml` 裡的那段預設是註解掉的，因為填了不存在的 id 會讓部署直接失敗）：

1. `npx wrangler hyperdrive create clessia-production --connection-string="<連線字串>"`
2. 把回傳的 id 填進 `apps/api/wrangler.toml` 的 `env.production.hyperdrive` 區段(TOML 陣列表頭,寫作雙中括號)，取消註解
3. `npx wrangler deploy --env production`

**用 Supabase 的 Direct connection（port 5432），不要用 pooled 的那條。** Hyperdrive
自己就是連線池，疊在 Supavisor 上面沒有意義。例外：專案沒有 IPv4 add-on 時 direct 主機
可能只有 AAAA 記錄、Hyperdrive 連不到（錯誤碼 2008 / 2010），那就退而求其次用 Supavisor
的 **session mode（port 5432）**；**transaction mode（6543）不行** —— 它不保證同一個
連線，pg 的 prepared statement 會錯亂。

免費方案可用（每日 10 萬次查詢，快取與未快取都計數）。Hyperdrive **只加速走 `pg` 的那條路**
（Better Auth 的 session 查詢，也就是每一個受保護的請求）；業務路由走 supabase-js 的 HTTP
介面，不經過它。

## Worker 放在哪裡執行（placement hint，#944）

**現象**（2026-09-30，從台灣量）：`demo.clessia.cc/cdn-cgi/trace` 回 `colo=SJC` —— 台灣的請求在
**聖荷西**跑 Worker，而資料庫在**新加坡**。同一台機器打 `www.cloudflare.com` 是 `colo=TPE`，
所以不是使用者網路的問題，是這個 zone 的入口路由。於是每一次 DB 往返都跨太平洋。

**資料庫在哪一區的查法**（不要照記憶寫，換專案時重查）：

```bash
dig +short AAAA db.<project-ref>.supabase.co          # 2026-09-30：2406:da18:1691:a200::2c66
curl -s https://ip-ranges.amazonaws.com/ip-ranges.json # AWS 官方 IP 範圍表，比對那個位址落在哪個 prefix
```

結果：`2406:da18::/35` → `ap-southeast-1`（服務 `AMAZON` / `EC2`）。

**改動前基準**（各 10 次、TTFB 中位數）：`/api/system-time`（不碰 DB）0.50s、
`/api/auth/magic-link/verify?token=<假>`（查 1 次 DB）0.86s ⇒ 一次往返約 0.36s。

**設定**：`apps/api/wrangler.toml` 頂層 `[placement] region = "aws:ap-southeast-1"`。
Cloudflare 會把它對應到「到那個雲端區域延遲最低」的機房執行，**不需要分析期**。
`placement` 是可繼承鍵，`env.production` 會吃到（用 wrangler 的 `unstable_readConfig` 讀過解析後的設定；
wrangler 只寫 `region` 時上傳的是 `{ mode: "targeted", region }`）。
**換資料庫區域時這一行要跟著改。**
c12：這只是 Cloudflare 的部署提示，`server.ts` 的 Node 自架路徑不受影響。

**為什麼不是 Smart Placement（`mode = "smart"`）**：它需要**來自多個地點的持續流量**、最多 15 分鐘分析，
流量不夠時停在 `INSUFFICIENT_INVOCATIONS` 不搬。demo 站幾乎只有台灣流量，部署一輪大概白等。
兩者互斥。客戶的正式站若流量分布廣、或後端不只一個，再重新評估。

**官方文件講的機制**（查證於 2026-09-30）：

- placement 只影響 `fetch` handler；靜態資源永遠由最近的機房回。
  （[Workers › Placement](https://developers.cloudflare.com/workers/configuration/placement/)）
- 啟用 placement 時所有回應都帶 `cf-placement` 標頭：`remote-XXX` = 在 XXX 執行；`local-XXX` = 沒搬。
  官方註明這個標頭**可能在 beta 結束前拿掉**。
- **Hyperdrive 文件：每個請求只查一次時，placement 不會改善端到端延遲** —— 往返只是換一段路走
  （[Hyperdrive › How it works](https://developers.cloudflare.com/hyperdrive/configuration/how-hyperdrive-works/)）。

**預期與判準 —— 量的時候不要看錯欄位**：

| 端點形狀 | 預期 |
| --- | --- |
| 不碰 DB（`system-time`） | **可能略慢**：多一段入口 SJC → 新加坡的轉送。**這不是沒效** |
| 查 1 次 DB（`magic-verify`） | **大致持平或小降**：往返從「Worker↔DB」移到「入口↔Worker」 |
| 一個請求依序查 N 次（多數業務 API：auth 身分查詢 + 業務查詢） | **主要受益者**：省下約 (N−1) × 0.36s |

依序看三樣：

1. **`cf-placement` 是 `remote-*`** —— 不是的話先查設定，不要量延遲
2. **`npx wrangler tail --env production --search "[probe]"`** —— `middleware/auth.ts` 的 probe 印
   `[probe] <method> <path> 查詢 N 支、合計 Xms、最慢 Yms`，是 **Worker 端**每次 Supabase 呼叫的耗時。
   搬過去之後每支應該從數百毫秒掉到個位數～數十毫秒。有 wrangler 權限就能看，不需要登入
3. **查多次 DB 的端點的 TTFB**（例：管理端帳單列表）—— 要登入 cookie

**結果**（2026-10-01 09:4x 部署，labor-reviewer 量）：

**判準 a 成立**：`cf-placement: remote-SIN`（`demo.clessia.cc` 與 `workers.dev` 都是），
入口仍是 `colo=TPE`／`cf-ray: …-TPE` —— **搬的是執行位置，不是入口**，與官方文件一致。

**TTFB（各 10 次中位數，同一台機器、同一支腳本、兩輪確認不是抖動）**：

| 端點 | 部署前 | 部署後 | 差 | 預期 |
| --- | --- | --- | --- | --- |
| `system-time`（0 次 DB） | 0.07 / 0.06 | 0.14 / 0.14 | **+0.08** | **略慢 —— 符合**（多一段 TPE→SIN） |
| `magic-verify`（1 次 DB） | 0.26 / 0.23 | 0.17 / 0.16 | **−0.08** | 預期「持平或小降」—— **比預期好一點** |

> **這一組前後都是 `colo=TPE`**（部署前 09:11 與 09:12 兩輪、部署後兩輪，全部 TPE），
> 所以**差值可以歸因到 placement**。

**⚠️ 另一組不可歸因，但也記下來**：計畫席的基準是 2026-09-30 17:00 在 `colo=SJC` 量的
（0.50 / 0.86），它 10-01 重量得到 0.16 / 0.21 —— **看起來是大幅改善，但入口從 SJC 變成 TPE**，
而 `system-time` **不碰 DB**，它從 0.50 掉到 0.16 **不可能是 placement 的功勞**（placement 只會讓它略慢）。
**那一組的改善主要是入口變近。** 入口為什麼從 SJC 變 TPE（時段？路由？與本次部署有關？）—— **未知**。

> **兩組並列的理由**：同一件事有兩組數字，而**只有控制了 colo 的那一組能回答「placement 做了什麼」**。
> 不並列的話，下一個人會拿 0.50 → 0.16 去講 placement 的效果，而那個數字裡**混了一個沒有被控制的變數**。

**判準 b（Worker 端每支 Supabase 呼叫的毫秒數）：沒有量到，而且它在未登入下量不到。**

`lib/supabase-latency-probe.ts` 的 `format()` 在 `stats.count === 0` 時回 `null`，
所以**未登入的請求不會印 `[probe]`** —— 它們一次 DB 都沒查。實測（部署前後各一次，同一方法）：

| | 事件 | 我的請求 | log 筆數 | `[probe]` |
| --- | --- | --- | --- | --- |
| 部署前 | 8 | 8 | **17** | **0** |
| 部署後 | 10 | 10 | **20** | **0** |

**log 筆數非 0 是正控** —— 捕獲管道是活的，所以那個 `0` 是「**沒有 `[probe]` 行**」，
**不是「log 沒抓到」**。（兩者在 `grep -c` 的輸出上都是 `0`。）

> **所以 PR #945 判準表裡「誰做得到」那格寫的「reviewer 部署時就能跑，不用登入」不成立。**
> 判準 b 與 c 都需要 session：**b 要有人登入後點幾下**（tail 由有 wrangler 權限的人同時開著），
> c 要 cookie。

## 量「查詢並行化有沒有生效」—— 用 `wallTime` 對「合計／最慢」，不要用 TTFB

> **判準先寫在前面**（計畫席 2026-10-01 採用）：
>
> | 查詢是怎麼跑的 | `wallTime` 會接近 |
> | --- | --- |
> | **循序** N 支 | **`合計`**（各查詢耗時的總和） |
> | **並行** N 支 | **`最慢`**，而 `合計` 明顯大於它 |
>
> **`合計 / 最慢` 的比值本身就是並行度**：N 支全並行時約等於 N、循序時約等於 1。
> **判準：`wallTime` 從「≈合計」變成「≈最慢」= 並行生效；沒變 = 沒生效。**

三個數字都在 `wrangler tail --format json` 的同一筆事件裡：

- **`wallTime`**：事件頂層（毫秒）
- **`合計` / `最慢`**：`middleware/auth.ts` 印的 `[probe]` 行，實作在 `lib/supabase-latency-probe.ts`
  （`totalMs += elapsed` 是**總和**、`slowestMs` 是**最大值**）

### 為什麼不用 TTFB

1. **對網路雜訊免疫** —— 三個數字全是 Worker 內部量的，不含入口↔執行機房那一段。
   2026-10-01 實測：同一設定下 `magic-verify` 的 TTFB 中位數在 **0.16～0.29** 之間跑
   （跨度 0.13），**比單支 PR 可能帶來的改善還大**。
2. **單筆請求就能判** —— 不需要中位數、不需要前後各量三四輪。
3. **不需要把 session 交出去** —— 只要有人登入後正常點幾頁，量的人同時開 `wrangler tail`；
   **session 留在使用者的瀏覽器裡，量的人只拿到 Worker 的 log。**
4. **前後比的是同一件事** —— 同一支端點、同一組欄位，而不是「未登入端點」對「登入端點」。

### 涵蓋不到的，先講

- **瀏覽器端的發出時序 tail 看不到**（例：#951 讓 `/api/me` 與 `/api/system-time` 同時出發）——
  Worker 只看到兩個獨立請求。那要看 waterfall 裡兩筆的**起點是否重疊**，**只有瀏覽器量得到**。
- **未登入的請求不會印 `[probe]`**：`format()` 在 `count === 0` 時回 `null` ——
  它們一次 DB 都沒查。所以這個判準**只能在登入後的流量上用**。
- `wallTime` 含 Worker 內的其他工作（序列化等），所以是「接近」不是「等於」——
  **但循序與並行的差距是 N 倍級的，不會被那點開銷蓋掉。**
- **「沒變」有兩條路**：並行沒生效，或**改動根本沒進這一版**。
  後者要用**只有新版才有的字串**去 bundle 裡驗（例：`announcement.publish`），
  **不要拿這個判準回答那個問題。**

### 入口 `colo` 自己會變 —— 這是「為什麼不用 TTFB」的第三個理由

同一台機器、同一支腳本，三次觀察到三個入口機房：

| 時間 | `colo` |
| --- | --- |
| 2026-09-30 17:00 | **SJC**（聖荷西） |
| 2026-10-01 09:1x–10:4x | **TPE**（台北） |
| 2026-10-01 12:2x | **NRT**（東京） |

**沒有人改過任何設定。** 而入口機房決定了「使用者 → Worker」那一段的距離,
所以**任何 TTFB 比較都可能在比兩個不同的入口** —— 2026-09-30 → 10-01 那組
「0.50 → 0.16」就是這樣來的(見上面那節的訂正)。

> **`wallTime` 對「合計／最慢」免疫於這件事**:三個數字都在 Worker 內部量,
> 入口在哪裡都一樣。**這是改用那個判準的第三個理由,而且它是事後才被觀察到的** ——
> 前兩個(雜訊、不必交出 session)是設計時想到的。

### 線上探針自己會被快取 —— 部署完立刻抓到的可能是舊的

2026-10-01 實例:部署後立刻抓 `openapi.json` 找新端點 `student-day` → **0 命中**,
看起來像「新端點沒上線」。加 `-H 'Cache-Control: no-cache'` 重抓 → **1 命中**,
而且檔案大小從 258872 變成 260712 bytes。

> **「探針沒動」有第三條路**:不只「沒生效」與「探針寫錯」,還有**拿到的是快取**。
> **部署完立刻抓的那一份不算** —— 重抓一次,或比檔案大小。

### `/api/*` 底下任何路徑未登入都回 401 —— 它不能證明路由存在

同一天實測:`/api/attendance/student-day`(真的存在)與
`/api/attendance/no-such-thing-xyz`(不存在)**未登入都回 `401 application/json`**。

成因是 `app.use('/api/*', authMiddleware)` 掛在所有 `mount()` 之前(`index.ts`)——
**請求根本走不到路由表。**

> **所以「新端點回 401 而不是 404」不構成「它上線了」的證據。**
> 要證明路由存在,用 **`openapi.json` 的 `paths`**(本席用它確認 126 條路徑裡有
> `/api/attendance/student-day`),或帶身分打它。
> 這跟 #915 那次的 401 是同一族:**同一個 401 有好幾條路變成它。**

### 量的時候要帶一個陰性對照

挑一支**這一批沒有改到**的多查詢端點（2026-10-01 那次用管理端帳單列表，
`git show <squash> --name-only | grep -i invoice` 是空的）—— **它前後應該不變**。
不變才證明「有變的那幾支是改動造成的，不是整站在那個時段剛好比較快」。

### 分析腳本（`wrangler tail` 的輸出不是 NDJSON）

`--format json` 吐的是**pretty-print 的 JSON 串接**，所以 `wc -l` 的行數**不是事件數**
（2026-10-01 踩過：935 行其實是 8 筆）。要逐個 `raw_decode`：

```python
import json, sys
s = sys.stdin.read(); dec = json.JSONDecoder(); i = 0
while i < len(s):
    while i < len(s) and s[i] in ' \n\r\t': i += 1
    if i >= len(s): break
    e, i = dec.raw_decode(s, i)
    probe = next((str(l.get('message')) for l in (e.get('logs') or [])
                  if '[probe]' in str(l.get('message'))), None)
    if probe:
        print(e.get('wallTime'), probe)
```

**捕獲檔裡的 log 筆數要一起報** —— 它是正控：log 非 0 而 `[probe]` 是 0，意思是
「**沒有 probe 行**」；log 也 0 則是「**管道沒抓到**」。**兩者在 `grep -c` 上都是 `0`。**

**判準 c（一個請求查多次 DB 的端點）：未量** —— 要登入 cookie。
而**那正是 placement 的主要受益形狀**，所以目前的結論只涵蓋 0 次與 1 次 DB 的端點。

### ⚠️ 訂正（2026-10-01 10:4x，同一席）：上面那個 **−0.08 落在雜訊裡**

同一天 10:4x 又部署一次（api `07cda777`，**placement 設定完全沒動**、`colo=TPE`、
`cf-placement: remote-SIN` 都一樣），連量四輪：

| 輪 | `system-time` 中位 | `magic-verify` 中位 |
| --- | --- | --- |
| 09:4x ① | 0.14 | 0.17 |
| 09:4x ② | 0.14 | 0.16 |
| 10:4x ① | 0.27 | 0.29 |
| 10:4x ② | 0.17 | 0.29 |
| 10:4x ③ | 0.20 | 0.28 |
| 10:4x ④ | 0.18 | 0.19 |

**設定沒變，而 `magic-verify` 的中位數在 0.16～0.29 之間跑** —— **跨度 0.13，
比上面量到的「placement 讓它快 0.08」還大。**

**所以那個 −0.08 不能說是 placement 的效果** —— 它是在兩輪背對背的量測裡算出來的
（那控制了時間），**但一旦把觀察窗拉長到一小時，同一個設定的離散度就蓋過它**。

> **判準：一個差值要能歸因，它必須大於「同一設定重複量測的離散度」** ——
> 而那個離散度**只有多量幾輪才看得到**，兩輪背對背量不出來（背對背的兩輪很像，
> 那正是它讓人放心的地方）。
>
> **這是 charter「一份資料只在它自己的維度上正確」的又一件衣服**：
> 背對背的那兩輪**在「同一時刻的前後差」這個維度上是正確的**，
> 而我拿它回答了「placement 的效果有多大」—— 那是另一個維度。

**現在能說的**：
- **判準 a 成立**（`cf-placement: remote-SIN`，可重複觀察、不是數字）
- **0 次 DB 的端點沒有變快**（符合預期）
- **1 次 DB 的端點：量不出可歸因的差** —— 官方文件本來就說「每個請求只查一次時不會改善」，
  **所以「量不出來」與文件一致，不是量壞了**
- **判準 c（查多次 DB）仍未量，而它才是會超出雜訊的那一個**

### 用「時間窗」量一趟真人操作 —— `wrangler tail` 抓全部流量，事件沒有身分

靠使用者說「開始 → 說結束」切出時間窗，窗內的事件才算這一趟。三點（計畫席 2026-10-01 交代）：

1. **開 tail 前先問計畫席「現在有沒有別席在打 demo」** —— 有的話別席的請求會混進窗內，
   而事件上沒有任何欄位能把它們分開，**混進去看不出來**。
2. **捕獲檔原檔留著，不要只留結論** —— 時間窗事後發現畫錯，還能用原檔重切；只留結論就只能重量。
3. **判準（`wallTime` 對 合計／最慢）本身還沒被真實 `[probe]` 驗過** ——
   數字對不上時**先懷疑判準，再懷疑 PR**。

## 正式 DB 的 migration：CI 代套（#963）

**本 repo 的正式站**由 `.github/workflows/migrate.yml` 套 migration，**不再手貼 SQL**。
它接在 verify（main 上綠）後面：

1. **plan**（只讀）：撈 `supabase_migrations.schema_migrations`，跟 `supabase/migrations/` 比**全部 version**，
   判斷在 `tools/agent-harness/lib/migration-plan.mjs`（有測試）。結果寫進 step summary：
   `clean`（差集 0）／`apply`／`after-deploy`／`blocked`（紅）。
2. **apply**：停在 `prod-db` environment 等使用者按 Approve，再 `supabase db push --db-url … --yes`。
   套前重算一次（等核准期間 DB 被動過就停），套後差集必須是 0。

| 規則 | 理由 |
| --- | --- |
| **永不帶 `--include-all`** | 中間漏套（#915 的形狀）時 CLI 會以 `Found local migration files to be inserted before the last migration on remote database.` 拒絕 —— 補哪一支要人決定 |
| backfill 檔**第一行**寫 `-- clessia:apply after-deploy` | schema 要「套完才部署」、backfill 要「部署完才套」（#905），一次 `db push` 拆不開；有標記的 plan 不自動套，部署完由使用者 dispatch（填 `deployed_sha`） |
| schema 與 backfill **分批合** | 同批待套 plan 會紅 |
| 一支檔是一個隱式 transaction | 失敗整支回滾、不留 history 列；`CREATE INDEX CONCURRENTLY` 例外，要寫就獨立成一支檔 |
| 套壞了用新的 migration 往前修 | c3：已提交的檔不可改；沒有 down migration |

**設定**（一次性，使用者做）：GitHub repo → Settings → Environments 建 `prod-db`（Required reviewers =
使用者、Deployment branches = `main`）與 `prod-db-plan`（只限 `main`），兩者各放 environment secret
`SUPABASE_DB_URL` = Supabase Dashboard → Connect → **Session pooler** 的連線字串。
GitHub hosted runner 沒有 IPv6，而 direct connection 預設只有 IPv6 —— ⚠️ 這點是依文件推論，
**第一次 plan 實跑就是它的驗證**。

**自架客戶不受影響（c12）**：沒有 `SUPABASE_DB_URL` 時 migrate.yml 印「未設定，略過」並綠燈結束；
下一節第 2 步的 `supabase db push` 照樣是手動套的方式。退回手動流程 = 刪掉 environment secret。

## 只有人能做的步驟

1. **建 Supabase 專案**、拿 service role key 與 connection string
2. **`npx supabase link --project-ref <ref>`** 然後 `supabase db push` 套用 migration
   （之後的 migration 可以改由 CI 代套，見上一節；不設定就照這一步手動）
3. **`npx wrangler login`**、`wrangler secret put`（上面四個）
   、以及 **`wrangler hyperdrive create`**（見上一節；連線字串是機密，只有部署的人碰得到）
4. **決定網域**與 Cloudflare 帳號歸屬。在 Dashboard 掛上：
   Pages 的 custom domain（`<網域>`）與 Worker 的 **route**（`<網域>/api/*`，
   **不是 custom domain** —— 那會接管整個 hostname 把前端吃掉）
5. **申請 LINE Developers channel**，把 Callback URL 設成
   `https://<網域>/api/auth/callback/line`
6. **`npm run bootstrap`** 建組織與第一個管理員（見 [[architecture/bootstrapping-a-deployment]]）
7. 用它印出的**一次性登入連結**登入，在畫面上綁定 LINE

## 已知待處理

- **initial bundle 超出 500 kB 的預算**（`apps/web/project.json` 的 `maximumWarning`）。目前只是警告，但那是真的大。跑 `npx nx build web --configuration=production` 看現值 —— **不在這裡抄數字**（c11）。
  多數來自 PrimeNG 與 xlsx —— 值得檢查有沒有被不必要地打進 initial chunk（`pdfmake` 已於 2026-08 移除）
- **Supabase 免費方案閒置 7 天會暫停**。天天用不會碰到；先開著給人看會踩到
