---
title: PWA＋Web Push 推播（設計稿，第一個用途：家長繳費提醒）
summary: 設計稿（#1626，8 題 10-16 全部裁定，仍是 draft —— 實作第一步量 CPU）。手寫最小 service worker（只處理 push／notificationclick，不攔 fetch、不快取）＋ manifest，不用 @angular/service-worker，不碰 #1611 的 immutable 快取。加密與 VAPID 自寫在 WebCrypto 上（RFC 8291／8292，用 RFC 測試向量驗），Workers 與 Node 共用。提醒時間點是機構設定 organizations.invoice_reminder_offsets（預設到期前 3 天、當天、逾期 1、7 天，最多 6 個，manage_finance），去重鍵含時間點。第一版只開家長，但偏好與發送紀錄帶 role，之後開給老師／行政不改 schema。Cron 台北 09:00–11:00 每 10 分鐘送一小批 —— 免費方案每次 Cron 只有 10ms CPU、50 個 subrequest，K 先量再定。實作拆成 #1657–#1663。
category: architecture
status: draft
updated: 2026-10-16
tags: [architecture, pwa, push, parent, billing, cron, settings, c12]
---

# PWA＋Web Push 推播（設計稿）

> **狀態：設計稿（draft）。** 工單 #1626 的 8 題已在 2026-10-16 全部裁定（見文末「裁定紀錄」），
> 實作拆成 #1657–#1663（見 §6）。**仍是 draft 的原因：免費方案能不能送得動還沒量**，#1657 量完才確定 K
> 與可行性；量完、第一版上線後改 `active`。
> 使用者已定的方向（#1625）：**推播為主（自動、精準），電話和簡訊為輔。**
> 標「未證實」的地方是查不到官方文件，不是推論後當成事實。

## 結論先講

| 問題           | 建議                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Service worker | **手寫一支 `sw.js`，只處理 `push` 與 `notificationclick`**，不攔 `fetch`、不快取任何東西                       |
| Angular SW     | **第一版不用** `@angular/service-worker`（理由見 §1）                                                          |
| 加密／簽章     | **自寫在 WebCrypto 上**（RFC 8291 aes128gcm＋RFC 8292 VAPID），零新依賴，Workers 與 Node ≥ 20 跑同一份         |
| 資料表         | `push_subscriptions`、`notification_preferences`、`push_deliveries` 三張＋`organizations` 一欄，一支 migration |
| 提醒時間點     | **機構設定**（Q2）：預設到期前 3 天、當天、逾期第 1、7 天；最多 6 個；`manage_finance` 才能看與改              |
| 對象           | **第一版只開家長**（Q7）；偏好與發送紀錄帶 `role`，之後開給老師／行政不必改 schema                             |
| 排程           | Workers Cron Trigger（UTC）在早上窗口每 10 分鐘觸發；自架用系統 cron 打同一支端點，`CRON_SECRET` 保護          |
| 最大的風險     | **免費方案每次 Cron 只有 10ms CPU、50 個外部 subrequest** —— 一次只能送一小批，批量要先量（#1657）             |
| 費用           | 目前查到的全部在免費額度內；**唯一可能要花錢的是「量完發現 10ms 不夠」→ Workers Paid 每月 5 美元**（§7）       |

---

## 1. 現況與 PWA 基礎

**現況**：repo 裡沒有 manifest、沒有 service worker，`apps/web/public/` 只有 `_headers`、`_redirects`、
`404.html`、`favicon.ico`、`assets/`。`assets/brand/` 只有 `line-logo.png`，**沒有 App 圖示**。
部署是同源：`demo.clessia.cc/api/*` 由 Worker route 接走，其餘是 Pages（見 [[architecture/deploying]]「前端與 API 必須同源」）。

### 為什麼不用 `@angular/service-worker`

Web Push 只需要「有一支註冊好的 service worker，而且它處理 `push` 事件」。Angular SW 帶來的是**離線快取**，
那是這張單沒有要的東西，而它跟現有的兩個設計會互相干擾：

1. **它會自己快取 `index.html` 和所有 chunk，版本由 `ngsw.json` 的雜湊決定**
   （快取的對象與 `index` 設定見 [Angular：Service worker configuration](https://angular.dev/ecosystem/service-workers/config)；版本與 `ngsw.json` 雜湊見 [Angular：Service worker in production](https://angular.dev/ecosystem/service-workers/devops)）。
   [[architecture/chunk-load-recovery]] 處理的「舊分頁要不到新 chunk」會多一層：瀏覽器快取之外還有 SW 快取，
   而 SW 的版本切換是「下次載入才生效」—— 換版後第一次開到的是舊版。
2. **它對導覽請求會回快取的 `index.html`**，#1611 刻意讓「不存在的路徑回 `404.html`」那條，
   在 SW 接管的分頁上就不再成立（雜湊檔本身因為有副檔名不受影響）。
   出處：[Angular：Service worker configuration](https://angular.dev/ecosystem/service-workers/config) 的 `navigationUrls` 預設（全部網址，排除最後一段帶副檔名的與含 `__` 的）
   與 `navigationRequestStrategy` 預設 `performance`（回快取的 index 檔）。
3. 出事時的退場方式是「刪掉 `ngsw.json`」或「永久在同一個網址提供 `safety-worker.js`」
   （[Angular：Service worker in production](https://angular.dev/ecosystem/service-workers/devops)）—— **永久**是官方原話。

手寫的 `sw.js` 不註冊 `fetch` 監聽器，**瀏覽器的所有請求照舊走網路與 HTTP 快取**，
跟 #1611 的 `_headers` 完全無關。

### 跟 #1611 的 `_headers`／`_redirects` 怎麼搭

| 新檔                    | 會不會被 immutable                           | 要不要動 `_redirects`    |
| ----------------------- | -------------------------------------------- | ------------------------ |
| `/sw.js`                | 不會：`_headers` 只比對 `/main-*` 等五個前綴 | 不用：靜態檔存在就直接回 |
| `/manifest.webmanifest` | 不會                                         | 不用                     |
| `/assets/icons/*.png`   | 不會（`/assets/*` 本來就刻意不 immutable）   | 不用                     |

- `sw.js` **檔名不能帶雜湊**（註冊網址要固定），所以它天然落在 Pages 的預設
  `max-age=0, must-revalidate`（#1611 實測）。**不要**把它加進 `_headers` 的長快取。
  `spa-fallback.spec.ts` 守的是路由清單，不受影響。
- **⚠️ 未證實**：Pages 對 `.webmanifest` 回的 `Content-Type`。預覽部署時用 `curl -I` 看一次；
  不是 `application/manifest+json` 的話在 `_headers` 補一條（這條不影響快取）。
- SW 不能放在 redirect 後面（同上 Angular 文件；這是瀏覽器規則，不是 Angular 的）—— `sw.js` 是直接命中的靜態檔，沒有這個問題。

### Manifest

`display: standalone`（iOS 要求 `standalone` 或 `fullscreen` 才能推播，見 §4）、`start_url: /parent`、
`scope: /`、`lang: zh-TW`、圖示 192／512 PNG＋`apple-touch-icon` 180。**圖示素材現在沒有** → Q6 裁定：設計席出一版字標，使用者看過再上（#1662）。

### 安裝提示

Chrome 從 108（行動）／112（桌機）起，選單裡的「安裝應用程式」不再需要 fetch handler；
但**自動跳出的安裝提示仍然需要**（[Chrome：Revisiting installability criteria](https://developer.chrome.com/blog/update-install-criteria)）。
所以不攔 fetch 的代價是：Android 不會自動跳安裝提示。**這不影響推播** —— Android 的 Chrome 分頁本身就能訂閱推播，
不需要安裝；iOS 本來就沒有自動提示。引導一律走我們自己畫面上的說明（§4）。

---

## 2. Web Push：VAPID 與加密

### 金鑰

- **一份部署一組 VAPID 金鑰**（P-256）。c12：每個客戶自己產、自己保管。
- 產生：repo 加一支 `apps/api/src/scripts/generate-vapid-keys.ts`（WebCrypto `generateKey`，十幾行，跟 `login-link.ts` 同一個資料夾的慣例），
  **使用者自己跑**，輸出兩行字串。
- 存放：
  - `VAPID_PRIVATE_KEY` → `npx wrangler secret put VAPID_PRIVATE_KEY --env production`（機密，使用者自己設）
  - `VAPID_PUBLIC_KEY`、`VAPID_SUBJECT`（`mailto:` 補習班聯絡信箱）→ `[env.production.vars]`（非機密，**必須整份重列**，見 `wrangler.toml` 註解）
  - 前端從 `GET /api/me/push-config` 拿公鑰，不 bake 進建置（一份建置可以給不同客戶用）
  - 自架（Node）：同名環境變數
- **換金鑰 = 所有既有訂閱失效**（訂閱時綁的是 `applicationServerKey`）。所以不要輪替；
  真要換，前端每次開啟時比對「訂閱用的公鑰」跟 `push-config` 回的是否一致，不一致就重訂。

### 用哪個 library

| 選項                               | 結論                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web-push`（官方 Node 套件）       | **不用**。依賴 Node 的 `crypto`／`https` 模組（[web-push](https://github.com/web-push-libs/web-push)）；靠 `nodejs_compat` 能不能跑**未證實**，不值得賭 |
| `web-push-neo`／`web-push-browser` | 宣稱支援 Workers，但是非官方 fork／個人專案，Workers 上的實測**未證實**                                                                                 |
| **自寫在 WebCrypto 上（建議）**    | 見下                                                                                                                                                    |

**建議自寫**，理由：

1. 需要的原語 Workers 全都有：ECDSA（簽 VAPID JWT）、ECDH（協商）、HKDF、AES-GCM
   （[Workers：Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)）。
   **⚠️ 那頁沒有逐條寫出 P-256 曲線**，實作第一步就是在 `wrangler dev` 跑一次 `generateKey({name:'ECDH', namedCurve:'P-256'})` 確認。
2. Node ≥ 20 的 `globalThis.crypto.subtle` 是同一套 API（[Node.js：Web Crypto API](https://nodejs.org/api/webcrypto.html)；ECDH／ECDSA／HKDF／AES-GCM 都在。
   那頁沒寫哪一版起全域不需旗標、也沒逐條列 P-256 → 實作時在 Node 端同樣跑一次 `generateKey` 確認），**c12 的 Node 自架路徑跑同一份程式碼，不用任何分支**。
3. **RFC 8291 第 5 節附了固定金鑰的完整範例，附錄 A 列了每一步的中間值**
   （[RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html)）—— 單元測試直接對那組向量，加密寫錯一個 byte 就紅。
   這比信任一個沒有測試向量的第三方套件更可驗證。
4. 只實作 `aes128gcm`（RFC 8291），不做舊的 `aesgcm`。VAPID 是 [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292.html)。

規模：一支 `lib/web-push.ts`，估 150 行內（JWT 簽章＋加密＋送出），外加測試。Q5 裁定照此（#1657）。

### 送出的 header（[RFC 8030](https://www.rfc-editor.org/rfc/rfc8030.html)）

- `TTL`：**必填**，少了推播服務回 400（§5.2）。繳費提醒建議 `86400`（隔天才收到就沒意義）
- `Urgency: normal`（§5.3）
- `Topic`：同一張帳單的提醒用同一個 topic，**手機離線時累積的舊提醒會被新的蓋掉**，不會一開機跳三則（§5.4，最多 32 字元 base64url）
- payload 上限：推播服務對 4096 bytes 以內不得回 413（§7.2）。我們的 payload 是標題＋一句內文＋網址，遠小於此

### 為什麼要帶加密 payload，而不是「空推播、SW 再回頭抓內容」

空推播可以省掉加密的 CPU，但 SW 回頭抓內容要帶登入 cookie —— **家長幾週沒開 App、session 過期，就只能顯示「您有新通知」**，
而繳費提醒最該送到的正是這種家長。所以內容放在加密 payload 裡。加密是端對端的（RFC 8291），推播服務看不到內文。

**payload 不放金額**（Q3）：鎖定畫面旁人看得到。內文像「王小明 10 月學費 10/20 到期」，點開才看金額。

---

## 3. 資料表（一支 migration，純加表）

```sql
-- 一人多裝置；同一台裝置換人登入時改綁（見下）
CREATE TABLE public.push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         text NOT NULL REFERENCES public.ba_user(id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  vapid_public_key text NOT NULL,          -- 訂閱時用的公鑰；換金鑰時找得出誰要重訂
  user_agent      text,                    -- 設定頁「這台裝置」的顯示用
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz
);
CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions (user_id);

-- 想收哪些類型，照角色分（Q7：同一個人有多個角色時各自設定）。沒有這一列 = 開（預設收）
CREATE TYPE public.notification_kind AS ENUM ('invoice_due', 'invoice_overdue');
CREATE TABLE public.notification_preferences (
  user_id  text NOT NULL REFERENCES public.ba_user(id) ON DELETE CASCADE,
  org_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role     public.user_role NOT NULL,
  kind     public.notification_kind NOT NULL,
  enabled  boolean NOT NULL,
  PRIMARY KEY (user_id, role, kind)
);

-- 發送佇列兼去重。UNIQUE 是冪等的來源
CREATE TABLE public.push_deliveries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES public.ba_user(id) ON DELETE CASCADE,
  role        public.user_role NOT NULL,   -- 以哪個身分收（決定點開的網址與套用哪一組偏好）
  kind        public.notification_kind NOT NULL,
  dedupe_key  text NOT NULL,               -- 例：invoice_reminder:<invoice_id>:-3（見 §5）
  payload     jsonb NOT NULL,              -- { title, body, url, topic }
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,                 -- null = 還沒送
  attempts    smallint NOT NULL DEFAULT 0,
  last_error  text,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX push_deliveries_pending_idx ON public.push_deliveries (created_at) WHERE sent_at IS NULL;

-- 提醒時間點（Q2）：相對到期日的天數，負＝到期前、0＝當天、正＝逾期第 N 天
ALTER TABLE public.organizations
  ADD COLUMN invoice_reminder_offsets smallint[] NOT NULL DEFAULT '{-3,0,1,7}'
  CHECK (cardinality(invoice_reminder_offsets) <= 6
         AND -30 <= ALL (invoice_reminder_offsets)
         AND 60 >= ALL (invoice_reminder_offsets));
```

⚠️ **`organizations` 已經有一欄 `billing_reminder_days`（#1305，預設 14）**，那是**行政的「待開單提醒」**
（`billing-periods.ts`），跟這裡的家長繳費提醒是兩件事。新欄位刻意取不同的名字，不要合併、不要沿用。
範圍 [-30, 60] 是提案值（Q2 只裁定「要有範圍」），#1658／#1660 的 PR 一併給計畫席看；不重複由 API 的 zod 擋。

業務表照慣例啟用 RLS、不加 policy（fail-closed，見 AGENTS.md）。三張表都**引用** `ba_user(id)`，不寫它（c2；`invoices.created_by` 已有同樣的 FK）。

**刻意的決定**：

- **enum 先只放第一版用得到的兩個值**。之後加 `announcement`／`leave`／`attendance` 是 `ALTER TYPE ... ADD VALUE`，便宜；先放了用不到的值會讓設定頁出現「選得到但永遠不會來」的開關 —— 跟公告當初 `audience` 的教訓同型（[[architecture/announcements]]）。
- **`endpoint` UNIQUE，訂閱時 upsert 並覆寫 `user_id`**：補習班的共用平板、家長換手機給另一位家長登入，同一個 endpoint 要跟著**現在登入的人**走。
  **登出時前端先呼叫 `DELETE /api/me/push-subscriptions`（帶自己的 endpoint）再登出** —— 否則上一個人的繳費提醒會跳在下一個人的裝置上。
- **失效自動清**：送出回 `404` 或 `410` 就刪那一列。RFC 8030 §7.3 規定過期是 `404`；實務上推播服務也會回 `410`（**未證實**哪家回哪個），兩個都當失效處理。
- **`push_deliveries` 這一版只是發送佇列**，不是通知中心的收件匣。之後公告要「站內＋推播」時再決定要不要合併 —— 現在合併是替想像中的需求設計。
- **偏好和發送紀錄都帶 `role`，訂閱不帶**：通知權限是一台裝置一個網站給的，跟現在用哪個身分無關；
  同一台裝置上「以家長身分收繳費提醒」「以老師身分收課務異動」靠 `role` 分開。第一版只會寫 `parent`。
- **保留期**：每次 run 順手刪 `created_at` 超過 90 天的列（Q4）。刪掉後同一個去重鍵理論上可以再排入，
  但要 `due_date + offset = 今天` 再成立一次，90 天後只有改了到期日才可能 —— 接受。

### 授權（c1）

| 端點                                        | 角色     | 範圍怎麼來                                                                                              |
| ------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `GET /api/me/push-config`                   | ANY_ROLE | 只回公鑰                                                                                                |
| `POST /api/me/push-subscriptions`           | ANY_ROLE | `user_id`、`org_id` **一律取自 session**，body 只收 `{endpoint, keys}`                                  |
| `DELETE /api/me/push-subscriptions`         | ANY_ROLE | 只刪 `user_id = 自己` 且 endpoint 相符的列                                                              |
| `GET／PUT /api/me/notification-preferences` | ANY_ROLE | 只讀寫自己的，而且 `role` 必須是自己擁有的；第一版只接受 `parent`                                       |
| `GET／PATCH /api/org-settings`（既有）      | admin    | 新 key `invoiceReminderOffsets` 加進既有的**財務設定名單**（`manage_finance`，跟 `paymentInfo` 同權限） |
| `POST /api/internal/push/run`               | 無使用者 | `CRON_SECRET`（§5）。收件人由資料關聯推導，不收任何外部指定的對象                                       |

`run` 的收件人推導：**帳單的 `student_id` → `parent_student_relations` → 家長的 `user_id`**，全在帳單自己的 `org_id` 內。
不收「要推給誰」的參數，所以這支端點就算密鑰外洩，能做的也只有「提早觸發今天本來就要送的提醒」（而且被 UNIQUE 去重）。
掛在 `/api/me` 底下的路由沿用 `mount('/api/me', meRoute, ANY_ROLE)`，不新開掛載點。

---

## 4. iOS 限制與家長引導

**官方事實**（[WebKit：Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)）：

- iOS／iPadOS **16.4 起**，**加入主畫面的 Web App** 才能要求推播權限
- manifest 的 `display` 必須是 `standalone` 或 `fullscreen`
- 要求權限**必須是使用者直接操作觸發**（按鈕），不能一進頁面就跳
- **不需要** Apple Developer Program 會員
- 推播端點在 `*.push.apple.com`
- 一般 Safari 分頁能不能訂閱：那篇文章沒講 → **未證實**（實作時用功能偵測，不靠版本號推斷）

### 引導流程（家長端）

狀態機只看瀏覽器給的事實，不猜：

| 狀態           | 怎麼判斷                                                                                     | 畫面                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 不支援，可安裝 | iOS 且 不是 standalone（`matchMedia('(display-mode: standalone)')`／`navigator.standalone`） | 「先把 Clessia 加入主畫面」：分享鈕 → 加入主畫面，三步驟圖示；附「iOS 16.4 以上」                       |
| 不支援         | 沒有 `PushManager` 或 `Notification`，且不是上一列                                           | 「這個瀏覽器收不到通知，請改用電話聯絡補習班」—— 不藏起來，明講                                         |
| 尚未決定       | `Notification.permission === 'default'`                                                      | 一顆「開啟繳費提醒」按鈕（按了才 `requestPermission`）                                                  |
| 已開啟         | `granted` 且有訂閱                                                                           | 各類型開關＋「這台裝置已開啟」＋「關閉這台裝置的通知」                                                  |
| 被拒絕         | `denied`                                                                                     | **瀏覽器不讓網頁再問一次**，只能說明怎麼去系統設定打開（iOS：設定 → 通知 → Clessia；Android：網站設定） |
| 已授權但沒訂閱 | `granted` 但 `pushManager.getSubscription()` 是 null（換金鑰、被清掉）                       | 開啟時自動重訂，不打擾使用者                                                                            |

**入口**：

- 家長首頁（dashboard）一張可關閉的提示卡，只在「尚未決定」或「可安裝」時出現；關掉後 30 天內不再出現（記在 `localStorage`，丟了也只是再出現一次）。
- 家長「通知」頁（現在是公告收件匣）上方加「通知設定」區塊，放上表的狀態與類型開關。

---

## 5. 排程

### 觸發

- **Workers**：`wrangler.toml` 的 `[env.production.triggers] crons = ["*/10 1-2 * * *"]`
  —— **Cron 是 UTC**（[Workers：Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)），
  所以是台北 09:00–10:50，每 10 分鐘一次、一天 12 次。台北沒有夏令時間，不會漂。
  `triggers` 會不會從頂層繼承到 env → **未證實**，直接寫在 `env.production` 底下就不用賭。
- `index.ts` 從 `export default app` 改成 `export default { fetch: app.fetch, scheduled }`，
  `scheduled()` 裡**用 `app.fetch(new Request('…/api/internal/push/run', { headers: { authorization: 'Bearer ' + env.CRON_SECRET } }), env, ctx)` 呼叫同一支端點** ——
  這是行程內呼叫，不是網路請求，**跟自架的系統 cron 走完全相同的程式碼路徑**。
- **自架（Node）**：系統 cron 每 10 分鐘 `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<網域>/api/internal/push/run`。寫進 [[architecture/deploying]]。
- 本機測試：`wrangler dev` 時打 `/cdn-cgi/local/scheduled`（同上文件）。

### 端點保護

- `POST /api/internal/push/run` 註冊在 `app.use('/api/*', authMiddleware)` **之前**（跟 `/api/system-time` 同一個做法，`index.ts` 已有註解說明）。
- `Authorization: Bearer <CRON_SECRET>`，`CRON_SECRET` 是 `wrangler secret`（使用者自己設）。
  **沒設 `CRON_SECRET` → 一律 404**（跟 `PUBLIC_ORG_SLUG` 沒設就關著同一個慣例）。
- 比對用**固定時間比較**。注意 `crypto.subtle.timingSafeEqual` 是 Workers 專屬（官方原話「non-standard extension」，[Workers：Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)）、Node 的 Web Crypto 沒有 → 用「兩邊各做一次 HMAC-SHA256 再逐 byte XOR」的寫法，兩邊都能跑（c12）。

### 每一次 run 做什麼

1. **排入**（冪等）：找出今天要提醒的帳單 → 推導收件家長 → 過濾掉關閉該類型的人、沒有任何訂閱的人 →
   `INSERT INTO push_deliveries ... ON CONFLICT (user_id, dedupe_key) DO NOTHING`。
   `dedupe_key = invoice_reminder:<invoice_id>:<offset>`，**同一張帳單、同一位家長、同一個時間點只會有一列**——
   不管 cron 一天跑 12 次、Workers 與自架 cron 同時開著、還是有人手動多打一次。
   **時間點在鍵裡、日期不在**（Q2）：機構改了設定，已經推過的時間點不會重推；新加的時間點只在
   `due_date + offset` 落在之後的日子才會觸發，不補發過去的。
2. **送出一批**：取 `sent_at IS NULL AND attempts < 3` 最舊的 K 筆，對每筆的每台裝置送一次；任一台成功就記 `sent_at`；
   404/410 刪訂閱；其他錯誤 `attempts + 1`、記 `last_error`，下一輪重試。
3. 刪 90 天前的列。

**今天要提醒哪些帳單**（未繳清 = `isOpenInvoice`，逾期 = `isOverdueOn`，日期基準 = `getCurrentTaipeiDateString()`，**全部重用既有定義**，不另寫一套）：

- 每個 org 讀自己的 `invoice_reminder_offsets`；`due_date + offset = 今天` 的帳單要提醒
- `offset ≤ 0` → `invoice_due`（即將到期／當天），`offset > 0` → `invoice_overdue`（家長的兩個開關照這個分）
- 作廢（`voided_at`）、沒有到期日的跳過

### ⚠️ 免費方案的兩個硬限制決定了「一批」多大

[Workers：Limits](https://developers.cloudflare.com/workers/platform/limits/)：

| 限制                       | Free      | Paid（每月 5 美元）    |
| -------------------------- | --------- | ---------------------- |
| 每次 Cron 的 CPU 時間      | **10 ms** | 30 秒（間隔 < 1 小時） |
| 每次呼叫的 subrequest      | **50**    | 10,000                 |
| 每個帳號的 Cron Trigger 數 | 5         | 250                    |
| Cron 的 wall time          | 15 分鐘   | 15 分鐘                |

- **50 個 subrequest**：每送一台裝置就是一次 `fetch`。DB 查詢要走 `pg`／Hyperdrive 那條路
  （Hyperdrive 有自己的每日 10 萬次查詢額度，文件沒有說它算 subrequest —— 這是**從定義推論，未證實**）；
  **`supabase-js` 走 HTTP，一定算 subrequest，這支端點不要用它。**
- **10 ms CPU**：每台裝置要做一次 ECDH＋HKDF＋AES-GCM；VAPID JWT 每個推播服務（Google／Apple／Mozilla）每次 run 簽一次就好。
  **WebCrypto 一次運算花多少 CPU 時間：未證實，必須量。** 本 repo 已經被這個限制咬過一次（scrypt，[[architecture/line-oauth-login]]）。
- 所以 **K（每次 run 送幾台裝置）是校準旋鈕**，不是寫死的常數：**#1657 在免費方案的真 Worker 上量**每則加密與每次 VAPID 簽章的 `cpuTime`（本機 `wrangler dev` 不執行 10ms 限制，量了不算），量完才定 K。
  送不動時照 Q8：先降 K、拉長窗口；仍不夠才升 Workers Paid，**升級前一定回報使用者**。
  一天 12 次 × K=20 = 240 台裝置／天；送不完的留到隔天的窗口前段（`TTL` 一天，過期的推播服務自己丟）。
- **帳號裡現在用了幾個 Cron Trigger：未證實**（本 repo 沒有，但同一個 Cloudflare 帳號底下的其他 Worker 看不到）。這個設計只用 1 個。
- 自架（Node）沒有這些限制，同一份程式可以把 K 調大。

---

## 6. 範圍：第一版做什麼、之後做什麼

### 第一版（家長繳費提醒）—— 實作工單

| 順序 | 工單  | 內容                                                        | 分類                                         |
| ---- | ----- | ----------------------------------------------------------- | -------------------------------------------- |
| 1    | #1657 | `lib/web-push.ts`（RFC 向量）＋**在免費方案 Worker 量 CPU** | 非保留；部署 bench Worker 是對外動作，先授權 |
| 2    | #1658 | migration：三張表＋enum＋`invoice_reminder_offsets`         | **保留類，migration，使用者 Approve**        |
| 3    | #1659 | `/api/me/push-*`、`notification-preferences`                | **保留類**（身分／授權）                     |
| 3    | #1660 | 系統設定「繳費」區塊的提醒時間點（`manage_finance`）        | **保留類**（權限）                           |
| 3    | #1661 | `/api/internal/push/run`、`scheduled()`、排入去重、分批送出 | **保留類**（不經登入的端點、收件人推導）     |
| 4    | #1663 | manifest、`sw.js`、家長引導與通知設定、登出前取消訂閱       | 非保留（登出那段請審核席特別看）             |
| 平行 | #1662 | App 圖示字標（設計席），使用者看過才合 #1663                | 非保留                                       |

**#1657 是閘門**：量完回報數字與 K，確定免費方案送得動（或照 Q8 回報使用者）之後，其餘才動工。
第 3 列的三張都只依賴 #1658，可以平行。

**`sw.js` 的 `notificationclick`**：開 payload 的 `url`（例：`/parent/payments`）；已有開著的分頁就 focus 它，不重開。

**要留下的測試**（各一支，最小能咬的）：加密對 RFC 8291 向量；同一天跑兩次只有一列；改設定不重推；404/410 會刪訂閱；
不相關的家長收不到（突變：拿掉 `parent_student_relations` 的條件要紅）；沒帶／帶錯 `CRON_SECRET` 拿 401、沒設拿 404；
沒有 `manage_finance` 讀改不到提醒時間點。

### 之後（結構已經接得住，只是加 enum 值與排入的來源）

| 用途                 | 觸發方式                                                        | 要多做的                                                     |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| 公告                 | 發布時排入（不在請求裡直接送 —— 請求一樣受 50 subrequest 限制） | cron 改成全天每 5～10 分鐘 drain；`visibility.ts` 決定收件人 |
| 請假核准結果         | 審核時排入                                                      | 同上                                                         |
| 點名結果（缺席通知） | 點名送出時排入                                                  | 同上；要先裁「遲到要不要通知」這類業務規則                   |
| 老師／行政           | 同一套表（偏好與發送紀錄已帶 `role`）                           | Q7 一度提案後撤回：**等實測過免費方案的推送餘裕再提**種類    |
| App 圖示紅點         | Badging API（iOS 16.4 起支援，同上 WebKit 文件）                | 第一版不做                                                   |

---

## 7. 費用

| 項目                           | 費用            | 依據                                                                                                                                                                                               |
| ------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workers Cron Trigger           | 免費方案內      | Free 每帳號 5 個（[Limits](https://developers.cloudflare.com/workers/platform/limits/)）                                                                                                           |
| Workers 請求數                 | 免費方案內      | Free 每日 10 萬次；這個設計一天多 12 次                                                                                                                                                            |
| Hyperdrive 查詢                | 免費方案內      | Free 每日 10 萬次（`wrangler.toml` 註解、[Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)）                                                                    |
| Apple 推播                     | 免費            | 不需要 Apple Developer Program（[WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)）                                                                                 |
| Google（Chrome）／Mozilla 推播 | **未見收費**    | VAPID 不需要 Firebase 專案或 API key（[Chrome：Web Push interop wins](https://developer.chrome.com/blog/web-push-interop-wins)）；**沒有找到官方明文寫「免費」→ 未證實**，但沒有帳號就沒有計費對象 |
| 新 npm 依賴                    | 無              | 自寫在 WebCrypto 上                                                                                                                                                                                |
| **Workers Paid**               | **每月 5 美元** | **只有在量完 CPU、10 ms 連一小批都塞不下時才需要** —— 到那時停下來回報，不自己升                                                                                                                   |

---

## 8. 家長端設定

見 §4 的狀態表。具體內容：

- **總開關是「這台裝置」**（訂閱／取消訂閱），因為權限本來就是一台一台給的
- **類型開關是「這個人的這個身分」**（`notification_preferences`，帶 `role`），在任何一台裝置上改，所有裝置都生效
- 第一版兩個類型：「帳單即將到期」、「帳單逾期」；關掉的類型在排入時就被濾掉，不會進佇列
- 「已開啟通知的裝置」列表（顯示 `user_agent` 的簡化名稱與開啟日期）可以個別移除 —— 手機掉了、換手機時用得到

**機構端（行政）**：系統設定「繳費」區塊新增「家長繳費提醒時間點」—— 可新增、刪除，選「到期前 N 天」或「逾期第 N 天」，
最多 6 個；只有 `manage_finance` 看得到、改得了（Q2）。這取代舊規格的「繳費到期前提醒 3 天」（從未實作），
見 [[specs/admin/system/settings]]。

---

## 裁定紀錄（2026-10-16，#1626 留言）

| #   | 問題             | 裁定                                                                                                                                                 |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Service worker   | **手寫 `sw.js`**（只推播、不離線快取）                                                                                                               |
| Q2  | 提醒時間點       | **放進系統設定**，機構自己調；預設到期前 3 天、當天、逾期第 1、7 天；最多 6 個、有範圍；`manage_finance`；去重鍵含時間點，改設定不重推；舊規格一起改 |
| Q3  | 鎖定畫面顯示金額 | **不顯示**                                                                                                                                           |
| Q4  | 推播時段與保留期 | **台北 09:00–11:00、紀錄留 90 天**                                                                                                                   |
| Q5  | 加密自寫或第三方 | **自寫**，用 RFC 8291 測試向量驗                                                                                                                     |
| Q6  | App 圖示         | **設計席出字標，使用者看過再上**                                                                                                                     |
| Q7  | 第一版對象       | **只開家長**（老師／行政的提案撤回，等實測過免費方案餘裕再提）；資料結構做成通用，之後開放不改 schema                                                |
| Q8  | 免費方案送不動   | **先降 K、拉長時段**；仍不夠才升級，**升級前一定回報使用者**                                                                                         |
