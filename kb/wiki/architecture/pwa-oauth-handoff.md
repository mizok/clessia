---
title: iOS 主畫面 PWA 的 LINE 登入（現況：留在 App 內；交接碼已被取代）
summary: 現況（#2063，10-28）：iOS 主畫面 App 的 LINE 登入整段留在 App 裡 —— 前端拿到授權網址加 disable_auto_login=true（不跳 LINE App），由同一個視窗發起與回呼，state cookie 在同一個 jar；其他平台照舊。原本的交接碼（#2027：Safari 輸入 4 位數、回 App 兌換）因使用者判斷對家長不直覺而被取代，前端已拿掉，後端路由與 auth_handoffs 表暫留待移除。
category: architecture
tags: [architecture, auth, pwa, line, oauth]
status: active
sources: [https://github.com/mizok/clessia/issues/2027]
updated: 2026-10-28
---

# iOS 主畫面 PWA 的 LINE 登入（#2027 → #2063）

## 現況（10-28，#2063）

- **iOS 主畫面 App**（`navigator.standalone === true`）：LINE 鍵走 `AuthService.signInWithLineInline()`。
  `signIn.social({ disableRedirect: true })` 拿到授權網址，前端加 `disable_auto_login=true`（不跳 LINE App，
  留在網頁登入；LINE 文件建議用它取代舊的 `disable_ios_auto_login`），再由**這個視窗**頂層導航。
  發起與回呼都在 App 這個視窗，Better Auth 的 state cookie 在同一個 jar，回呼通過，session 直接寫進 App。
  Better Auth 的 LINE provider 不傳額外參數，所以參數在前端加，伺服器不用動。
- **其他平台（含 Android 的 PWA）**：照舊 `signInWithLine()`，不加參數。Android 的 PWA 跟 Chrome 共用 cookie，
  不需要「不跳 LINE App」。**Android 待實機確認**。
- 使用者 10-28 iPhone 實測 #2065（實驗入口）成功後裁定轉正。
- **已知代價**：關掉 auto login 後，iPhone 上不會自動用 LINE App 的登入狀態，家長要在 LINE 網頁登入。
  瀏覽器沒有 LINE 的網頁 SSO 時，LINE 文件說會顯示 email＋密碼（或要另一支裝置掃的 QR），
  沒設過 LINE email／密碼的家長可能過不了。實測的那位過得了；之後若有家長卡在這裡，就要回頭看交接碼或其他做法。
- `onAPIError.errorURL = <WEB_URL>/login`（#2064 加的）保留：讀到 errorCallbackURL 之前的 OAuth 失敗回登入頁，不丟到首頁。

## 交接碼為什麼被取代

#2027 的交接碼（以下各節是當時的設計紀錄）在 #2064 修到能走完，但流程是：App 顯示號碼 → 到 Safari 用 LINE 登入
→ 在 Safari 輸入號碼 → 手動切回 App。**使用者判斷這對家長太不直覺**，改試「整段留在 App 裡」並實測成功。

- **前端已拿掉**（#2063 轉正 PR）：登入頁的號碼 UI、`/login/handoff`、`/login/handoff/start`、`AuthHandoffService`。
- **後端暫留**：`/api/auth-handoff/*`、`/api/me/auth-handoff/*` 路由與 `auth_handoffs` 表還在（加法優先，先上線觀察）。
  移除路由另開一張；`drop table` 是破壞性操作，要使用者決定。

---

以下是 #2027 交接碼的設計紀錄（**已不是現況**）。

> **狀態：使用者 10-23 裁定方案 A＋Safari 自動登出；10-28 實機確認會跳 Safari；已實作（#2041 schema＋程式 PR）。**

## 原因

`AuthService.signInWithLine()` 用 `authClient.signIn.social()` 整頁導到 LINE，callback 在我們的 API 設 session cookie 再導回 `/select-role`。
iOS 主畫面 PWA（`display: standalone`）是獨立 WebView，**cookie／storage 不跟 Safari 共用**；導到 scope 外（LINE）會跳出 PWA，
LINE App 授權完交回預設瀏覽器 Safari —— session 寫進 Safari，PWA 仍未登入。**改 callbackURL 解不了。**
Android（Chrome 的 PWA／WebAPK）與 Chrome 共用 cookie，預期沒事，要實機確認。綁定 LINE（`linkSocial`）也會跳出，但綁定已寫進伺服器、PWA 原本就登入著，影響小。

## 裁定的做法：交接碼

1. PWA（`display-mode: standalone`）按「用 LINE 登入」→ `POST /api/auth-handoff/start` → 伺服器存 `{ handoffId, secretHash, status: pending, expiresAt: +10 分 }`，回 `handoffId`＋`secret`。**secret 只留在 PWA，不進任何 URL**。
2. 外部流程的 `callbackURL` 是 `/login/handoff?h=<handoffId>`（只有 id）。
3. Safari 登入完成 → `/login/handoff` 頁呼叫 `POST /api/me/auth-handoff/{id}/complete { handoffId }`（要已登入；只能完成 pending、未過期的）→ 標 `{ status: done, userId }` → **登出 Safari 這邊的 session**（使用者裁定）→ 顯示「已登入，請回到 App」。
4. PWA 回前景（`visibilitychange`）→ `POST /api/auth-handoff/{id}/redeem { handoffId, secret }` → 比對 hash、一次性（用過即刪）、未過期 → 用既有的 `mintLoginLink`（magic link）替 `userId` 鑄連結 → PWA 在**自己的視窗**打開，session 寫進 PWA。

**安全性**：拿到 `handoffId` 的人（LINE、瀏覽紀錄）沒有 secret 換不到；10 分鐘＋一次性；`complete` 只能由已登入的本人標；`redeem` 失敗一律同一個錯誤；`start`／`redeem` 都限流。
**通用**：只認「外部流程後 Safari 有 session」，跟 provider 無關 —— Google 登入（#1842）同一套。

## 防交接劫持（10-28 計畫席讀 diff 擋，已加）

第一版 `complete` 只要已登入就能標任何 handoffId，Safari 頁又一打開就自動 complete —— 攻擊者自己 `start`，
把 `/login/handoff?h=<他的 id>` 傳給受害者，受害者一點，攻擊者用自己的 secret 就換到受害者的帳號。現在：

1. **session 必須晚於交接建立**（`authMiddleware` 把 `session.createdAt` 放進 context）：早就登入著、點別人傳來的連結不算。
2. **配對碼**（OAuth device flow 的防釣魚做法）：`start` 回 4 位數（DB 存綁 id 的雜湊），PWA **先顯示號碼**、
   按鈕變「記下號碼，前往 LINE」，再按一次才去 LINE；Safari 頁**不自動完成**，問「把這次登入交給 App？」、
   要輸入相同的號碼並按確認。錯 5 次失效 —— **每次猜都先用 CAS 把次數 +1 佔到名額才比對**（審核席二讀：先比對、錯了才 +1 的話，並發的錯誤猜測只有一個算到次數，平行送就繞過上限）。號碼打錯不登出 Safari（還能再試），完成或失效才登出。
3. **每個來源的上限**：`start` 存發起 IP 的 HMAC（同招生表單的 `hashClientIp`，表裡沒有可還原的 IP），
   同一來源同時未過期最多 5 筆，防有人灌滿全域上限讓所有人 10 分鐘登不了。

## OAuth 必須在 Safari 發起（#2063，10-28 實機修正）

第一版是 **PWA 自己呼叫 `signIn.social`**、帶交接的 callbackURL。實機上永遠走不完：使用者落在登入頁
「LINE 登入沒有完成」，沒有地方輸入號碼。

- **原因**：Better Auth 1.5.5 的 state 存在 DB，但回呼時**還會比對發起時設下的簽章 `state` cookie**
  （`state_security_mismatch`，防 login CSRF）。PWA 發起 → cookie 寫在 PWA 的 jar；LINE App 授權完回到
  **Safari** → 沒有那顆 cookie → `/api/auth/error?error=state_mismatch` → 首頁。桌機會成功，是因為發起和回呼
  在同一個瀏覽器。正式站用兩個 cookie jar 重現過（#2063 留言有每一步的網址）。
- **修法（計畫席裁 A）**：PWA 按下只發起交接、顯示號碼，LINE 鍵換成一條連結，打開外部瀏覽器的
  `/login/handoff/start?h=<id>`。**那一頁在 Safari 裡呼叫 `signIn.social`**，state cookie 跟回呼在同一個瀏覽器。
  之後照原設計：`/login/handoff?h=` 輸入號碼 → PWA 回前景兌換。發起頁只收 id，不帶秘密。
- **怎麼開到 Safari**：iOS（`navigator.standalone`）用 `x-safari-https://`（iOS 17 起）指名 Safari ——
  一般的 `target=_blank` 可能開在 PWA 內嵌的瀏覽頁，那裡的 jar 跟 Safari 不同。其他平台用一般網址。
  iOS 17 以前不認 `x-safari-`：連結下方附一行「沒有打開 Safari？複製這個網址貼到 Safari」與一般網址（可選取），非 iOS 不顯示。
  **要靠實機確認**（iPhone、Android 各一次）。
- **不採用 `skipStateCookieCheck`**（計畫席裁）：會全站拿掉 login CSRF 保護，攻擊者能讓受害者登入成攻擊者的帳號。
- 另加 `onAPIError.errorURL = <WEB_URL>/login`：讀到 errorCallbackURL 之前的 OAuth 失敗，不再丟到首頁。

## 拒絕的替代方案

- PWA 內 `window.open` 彈窗＋`postMessage`：iOS standalone 的彈窗也是外部瀏覽器、沒有 `opener`、不共用 cookie。
- 引導家長改用 Safari、不裝 PWA：iOS 推播只在主畫面 PWA 才有。
- LINE LIFF：解決不了 PWA 本身的登入，範圍大。

## 實作（10-28）

- **API**（`routes/auth-handoff.ts`）：`start`、`redeem` 掛在 `/api/auth-handoff`、`authMiddleware` **之前**（PWA 還沒登入；自己建 service client，同 `publicOrgMiddleware`）。
  不放 `/api/public/*`：那會被 `PUBLIC_ORG_SLUG` 綁住，登入不能依賴招生頁的開關 —— 所以在 harness 的 app.route 例外與 `mount-authz.spec` 的 `UNMOUNTED` 明列。
  要登入的 `complete` 掛在已經是 `ANY_ROLE` 的 `/api/me/auth-handoff`（不跟公開的兩支共用 mount 前綴：mount 前綴底下第一個註冊的必須是守衛）。
- `start`：全域同時未過期上限 500（公開端點防灌爆），順手清過期的。`redeem`：`id＋secret 雜湊＋未過期` 一起查 —— secret 不對跟不存在分不出來，**還沒完成時 secret 不對也是 404**（不洩漏「還在等」）；換的時候 `delete … returning` 一次性，再 `mintLoginLinkForRequest` 鑄連結。
- **web**：`AuthHandoffService`（standalone 偵測、localStorage 存 id＋secret、redeem、complete＋登出 Safari）；`AuthService.signInWithLine` 在 standalone 時 callbackURL 換成 `/login/handoff?h=<id>`；登入頁進頁與 `visibilitychange` 時換；落地頁 `/login/handoff` 是 `access: 'public'`（不能 guest-only —— 落地時 Safari 是登入狀態）。

## 影響

一張短效表（migration，schema 與程式分開）、`routes` 三支端點、web 的登入頁與 `/login/handoff` 頁、`AuthService` 依 standalone 分流。保留類：認證。

相關：[[architecture/line-oauth-login]]
