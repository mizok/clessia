---
title: Google 登入的設計（第二個 OAuth provider）
summary: Google 跟 LINE 走同一套：合成 `<sub>@google.internal` 並標成已驗證、不能建帳號、不能用真 email 對上既有帳號，只能經一次性綁定連結綁上；provider 清單由 API 從環境變數推出，沒設憑證的部署完全看不到 Google 按鈕（c12）。
category: architecture
status: draft
tags: [architecture, auth, oauth, google]
sources: [https://github.com/mizok/clessia/issues/1842]
created: 2026-10-23
updated: 2026-10-23
---

# Google 登入的設計（第二個 OAuth provider）

**裁定**：使用者 10-22 選 A（#1842）：Google 回來的身分不用真 email，合成 `<google sub>@google.internal`；不能建新帳號、不能自動對上既有帳號，只能透過一次性綁定連結綁到校方建好的帳號。
**前提**：[[architecture/line-oauth-login]]（決策二「Google 延後但架構預留」、綁定連結、`allowDifferentEmails` 的安全前提）。
**狀態**：設計稿，**使用者拿到 Google 憑證前不實作**。

## 查過的事實（better-auth 1.5.5，`apps/api/node_modules`）

LINE 那頁的教訓是「寫了『實作前先確認』卻沒人確認」，所以這裡每一條都附出處：

| 事實                                                                                                                                                                      | 出處                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Google provider 的 `getUserInfo` 解 `id_token`，回 `email: user.email`、`emailVerified: user.email_verified`，**`mapProfileToUser` 的結果最後展開、會覆寫這兩欄**         | `@better-auth/core/dist/social-providers/google.mjs:83-99`                    |
| 登入（非綁定）時用 `findOAuthUser(email, accountId, providerId)` 找人；**找到同 email 但沒綁這個 provider 的人時，只要 `emailVerified` 為真就自動綁上並登入**（隱式綁定） | `better-auth/dist/oauth2/link-account.mjs:11,18-48`                           |
| 隱式綁定可用 `accountLinking.disableImplicitLinking: true` 整條關掉                                                                                                       | 同上 `:22`                                                                    |
| 明確綁定（`link-social` 的 callback）**不看** `disableImplicitLinking`；它要求 provider 受信任或 `emailVerified` 為真，email 不同時要 `allowDifferentEmails`              | `better-auth/dist/api/routes/callback.mjs:102-135`                            |
| 找不到人時 `disableSignUp` 回 `signup disabled`，不建帳號                                                                                                                 | `link-account.mjs:73-78`；`callback.mjs` 傳 `provider.options?.disableSignUp` |
| Google 預設 scope 是 `email profile openid`；`disableDefaultScope` 加 `scope` 可只要 `openid`                                                                             | `google.mjs:22-28`                                                            |

**為什麼真 email 危險**：Google 的 `email_verified` 幾乎都是 true。如果直接用真 email，員工 `ba_user.email` 剛好是他的 Gmail 時，第一次按「用 Google 登入」就會被隱式綁定直接登入，**完全跳過校方背書的綁定連結**。更糟的情況是：只要有人能在 Google 註冊一個跟某位員工 `ba_user.email` 相同的帳號（例如公司網域停用後被別人拿走），他就能登入那位員工的帳號。合成 email 會讓 `findOAuthUser` 的 email 那條永遠對不上真人，`allowDifferentEmails: true` 的安全前提（合成 email 不可能撞到真人）也照樣成立。

## 一、`apps/api/src/auth.ts` 要改的地方（逐項對照 LINE）

| #   | 位置                                                     | LINE 現在                                                                          | Google 怎麼做                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `AuthBindings`（:8-18）、`index.ts` 的 `Bindings`（:91） | `LINE_CLIENT_ID`、`LINE_CLIENT_SECRET`                                             | 加 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。`bootstrap-org.ts:55`、`login-link.ts:39` 組 env 的地方一起補（它們目前帶 LINE 的空值）                                                                                                                                                                                                                 |
| 2   | profile 對應（`lineProfileToUser`，:44-72）              | LINE 有 email 就用真的（不宣稱已驗證），沒有才合成 `<sub>@line.internal`、標已驗證 | 新增 `googleProfileToUser`：**一律合成** `<sub>@google.internal`、`emailVerified: true`，**不論 Google 有沒有給 email、給的有沒有驗證都不用**。沒有 `sub` 就丟錯，不合成出 `undefined@google.internal`（同 LINE :55-59 的理由：UNIQUE 撞號＝第二個人登入變成第一個人）。標已驗證的理由同 LINE :61-71：不標，`link-social` 會在 `callback.mjs:103` 被擋 |
| 3   | `socialProvidersFromEnv`（:74-96）                       | 兩個變數都有才掛 `line`；`disableSignUp: true`；`mapProfileToUser`                 | 同一張 map 加 `google`：兩個變數都有才掛；`disableSignUp: true`；`mapProfileToUser: googleProfileToUser`；**`disableDefaultScope: true` 加 `scope: ['openid']`**（只拿 `sub`，不拿 email 與姓名：本來就用不到，也不會把它們存進 `ba_account.idToken`）；`prompt: 'select_account'`（櫃台共用電腦上已登入別人的 Google 帳號時，讓使用者自己選）         |
| 4   | `accountLinking`（:173-188）                             | `allowDifferentEmails: true`，註解只講 `@line.internal`                            | **加 `disableImplicitLinking: true`**：合成 email 已經讓隱式綁定對不上任何人，這行是第二道牆，萬一哪天有人拿掉合成也守得住。明確綁定不受影響（`callback.mjs:102-135` 不看它）。註解改成「合成的 email 有 `@line.internal`／`@google.internal` 命名空間」                                                                                               |
| 5   | **不改**                                                 | `trustedProviders` 沒設                                                            | Google 也不加進 `trustedProviders`：加了就等於信任它給的任何 email，而 email 可以拿來對上既有帳號（同 LINE :68-70 的理由）                                                                                                                                                                                                                             |

### 新增：provider 清單端點

- `GET /api/auth-providers`（**不需登入**，登入頁在登入前就要用）→ `{ providers: ['line', 'google'] }`。
- 值就是 `Object.keys(socialProvidersFromEnv(c.env))`，**跟 `createAuth` 用同一支函式推出來**，不另寫清單（c11）；只回 id，不回任何憑證。
- 不放在 `/api/public/*`：那組要 `PUBLIC_ORG_SLUG`，招生頁沒開的部署也要能登入。也不放在 `/api/auth/*`，那是 better-auth 的命名空間。

## 二、provider 清單不寫死：前端三處

前端只有一份**外觀表**：`id → { 名稱, 圖示, 按鈕樣式 }`（LINE 綠、Google 白底灰框照 Google 品牌規範）。**要顯示哪幾顆一律看 `/api/auth-providers` 回什麼**；外觀表裡有、API 沒回的不畫，API 回了、外觀表裡沒有的也不畫（不猜樣式）。

| 地方                                                 | 現在                                                                   | 改成                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/auth.service.ts`                               | `signInWithLine()`、`linkLine()` 寫死 `provider: 'line'`（:233、:255） | `signInWith(provider)`、`linkProvider(provider)`；錯誤訊息從外觀表取名稱（「Google 登入失敗…」）。新增 `providers` signal，app 啟動或登入頁進來時讀一次                                                              |
| 登入頁 `public/pages/login`                          | 一顆 LINE 鍵、「用 LINE 登入」字樣                                     | 依清單畫按鈕。只有 LINE 時畫面跟現在一樣；兩個都有時兩顆並排（手機直排）；說明文字改成不點名 provider（「用 LINE 或 Google 登入，不需要記密碼」由清單組字）                                                          |
| 綁定頁 `public/pages/link-line`                      | 「綁定 LINE」一顆鍵                                                    | 依清單每個 provider 一顆「綁定 ○○」。**路由維持 `/link-line`**：已經印出去、傳出去的綁定連結都導到這個路徑，改名會讓舊連結落空；只改頁面內容與標題（「綁定登入方式」）                                               |
| 帳號設定 `shared/components/account-settings-dialog` | **目前沒有登入方式這一段**（新 UI）                                    | 新增「登入方式」：依清單列每個 provider，已綁定的寫「已綁定」，沒綁的給「綁定」鍵（走同一支 `linkProvider`）。已綁定狀態用 better-auth 的 `listAccounts`。**解除綁定不做**：解掉最後一個就登不進來，那要另外設計防呆 |

## 三、沒設 Google 憑證的部署：完全看不到 Google（c12）

- `socialProvidersFromEnv` 少一個變數就不掛 → `/api/auth-providers` 不回 `google` → 前端三處都不畫。沒有灰掉的按鈕、沒有「尚未開放」字樣。
- **同一條規則也套到 LINE**：今天 LINE 鍵永遠在，沒設 LINE 的部署按了才會失敗（`deploying.md:64` 記過「靜默失效」）。改成依清單之後，沒設 LINE 就不畫 LINE。**清單是空的**（兩個都沒設）時，登入頁寫一行「這個部署還沒有設定登入方式，請聯絡系統管理員」，不留一個空白的登入頁。
- `/api/auth-providers` 讀不到（網路錯誤）時，前端**退回只畫 LINE**：今天的行為就是這樣，讀不到清單時不能讓所有人都登不進來。

## 四、使用者在 Google Cloud 要做的設定（每個部署各自做，c12）

1. 到 Google Cloud Console 建一個專案（每個補習班的部署一個，不共用）。
2. 「API 和服務 → OAuth 同意畫面」：
   - 使用者類型選 **外部**（家長的 Gmail 不在補習班的網域裡；只給員工用的話，有 Google Workspace 的可以選「內部」）
   - 應用程式名稱填補習班名稱，支援 email 填補習班的聯絡信箱
   - 「已授權網域」填正式站網域
   - 範圍只加 **`openid`**（不加 email、profile）
   - 發布狀態改成 **「正式版」**：維持「測試中」的話只有列在測試使用者裡的人能登入，而且授權 7 天就失效。只要 `openid` 的應用程式不需要 Google 審查
3. 「API 和服務 → 憑證 → 建立憑證 → OAuth 用戶端 ID」：
   - 應用程式類型選 **網頁應用程式**
   - 「已授權的重新導向 URI」填 **`https://<API 網域>/api/auth/callback/google`**，必須跟 `BETTER_AUTH_URL` 完全一致（協定、網域、沒有結尾斜線）
   - 本機開發另加 `http://localhost:8787/api/auth/callback/google`，或另開一個開發用的用戶端
4. 拿到的兩個值：
   - 用戶端 ID 不是機密：`--var GOOGLE_CLIENT_ID:<值>`（跟 `LINE_CLIENT_ID` 一樣，**乾淨重新部署會被洗掉**，見 `deploying.md:40-41`、`:64`）
   - 用戶端密鑰：`npx wrangler secret put GOOGLE_CLIENT_SECRET --env production`
5. 部署後打開登入頁，確認出現 Google 鍵；再用一次性連結登入，在綁定頁綁 Google，登出後用 Google 登入一次。

這幾步寫進 `bootstrapping-a-deployment.md`、`deploying.md`，跟 LINE 的步驟放在一起，標明是選用的。

## 五、spec 要守的清單

**API（`auth.spec.ts`，單元）**

1. `googleProfileToUser`：回 `<sub>@google.internal`、`emailVerified: true`；**Google 給了 `email` 加 `email_verified: true` 也不用**；沒有 `sub` 丟錯；`sub` 是空字串也丟錯。
2. `socialProvidersFromEnv`：兩個 Google 變數都有才有 `google`、少一個就沒有；`google` 的 `disableSignUp` 為 true、scope 只有 `openid`；LINE 的設定不受影響；兩組都設時兩個都在。
3. `createAuth`：`accountLinking.disableImplicitLinking` 為 true、`allowDifferentEmails` 仍為 true；`trustedProviders` 不含 `google`。
4. `GET /api/auth-providers`：回的就是有設定的那幾個；回應裡沒有任何 `clientId`／`secret` 字樣；不需登入。

**API（新的 `auth-google.contract.ts`，對本機 Postgres 跑 better-auth 的真 handler）**
Google 的 token 端點用 fetch 替身回一個自己簽的 `id_token`（`getUserInfo` 只 `decodeJwt`、不驗簽），其餘全走 better-auth 本體：

5. **不能建新帳號**：沒綁過的 `sub` 走登入 callback → 導回 `errorCallbackURL` 帶 `signup_disabled`；`ba_user`、`ba_account` 筆數不變。
6. **不能用真 email 對上既有帳號**：先建一位 `ba_user.email = alice@gmail.com`、`emailVerified = true` 的員工，再用 `email: alice@gmail.com, email_verified: true` 的 Google 身分走登入 callback → 不登入、不建 `ba_account`。（再加一條：把 `disableImplicitLinking` 拿掉、只靠合成 email 也要守得住，證明兩道牆各自有效）
7. **綁定流程正常**：拿一次性連結兌換 session → `link-social` 綁 Google → 登出 → 用同一個 `sub` 登入 → 登進那位員工的帳號。
8. **已經綁給別人的 Google 帳號不能再綁**：同一個 `sub` 綁第二位員工 → `account_already_linked_to_different_user`。
9. **綁定連結過期或用過就拒絕**：兌換第二次 → 失敗、沒有 session；把 `ba_verification.expires_at` 改成過去 → 失敗。（這條測的是 magic-link，LINE 也受惠；現在沒有任何一支 spec 走過這條）

**Web** 10. 登入頁：清單只有 `line` → 只有 LINE 鍵；`['line','google']` → 兩顆；`[]` → 沒有鍵、有那行說明；讀清單失敗 → 只有 LINE。11. 綁定頁：每個 provider 一顆，按下呼叫 `linkSocial` 帶那個 provider。12. 帳號設定：已綁的寫已綁定、沒綁的有綁定鍵；清單沒有的 provider 不出現。

## 上線前必驗（設計階段驗不到，拿到憑證後的第一步）

這幾條在拿到真憑證之前沒辦法驗，**實作 PR 的第一個 commit 前要先實打一次**，不能留成文件裡的一句提醒（LINE 那次就是這樣出事的）：

- 只要 `openid` 時，Google 回的 `id_token` 確實有 `sub`，better-auth 的 callback 不會因為少了 `email` 在 `callback.mjs:139` 回 `email_not_found`。`mapProfileToUser` 會先補上合成 email，照原始碼看是過得了，但要用真憑證實際走一次。
- 同意畫面在「正式版」、只要 `openid` 時，不需要 Google 審查就能讓任意帳號登入。
- Workers 上 callback 的 CPU 時間（`decodeJwt` 加一次 token 交換）跟 LINE 同一個量級。

## 拒絕的替代方案

| 方案                                      | 為什麼不                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 用 Google 的真 email、靠 `email_verified` | 隱式綁定會讓 email 相同的員工直接登入，跳過綁定連結（見上方「為什麼真 email 危險」）；使用者 10-22 已裁 A |
| 把 `google` 加進 `trustedProviders`       | 等於信任它給的任何 email；合成之後也用不到                                                                |
| 前端寫死兩顆鍵，沒設就灰掉                | 違反 c12 的「沒設定就不存在」，而且清單會跟 API 的設定漂開                                                |
| provider 清單放進前端的環境設定           | 前端的設定是建置時決定的，API 的憑證是部署時決定的，兩邊會不同步；只有 API 知道自己掛了哪些               |
| 綁定頁路由改名成 `/link`                  | 已經發出去的綁定連結會全部落空                                                                            |

## 不做

- 解除綁定（要先設計「最後一個登入方式不能解」的防呆）
- 用 Google 建帳號、Google Workspace 網域自動放行（`hd`）
- 其他 provider（Apple、Facebook）：架構容得下，但沒有需求
