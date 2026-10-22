---
title: 家長資料
summary: 管理家長帳號，關聯學生，處理帳號相關操作。
category: spec
status: active
updated: 2026-10-22
tags: [specs, admin, student-affairs, parents]
---

# 家長資料

**路徑**: `/admin/parents`
**角色**: Admin
**分組**: 學務管理

## 核心目的

管理家長帳號，關聯學生，處理帳號相關操作。

## 帳號設計原則

- 家長帳號由管理員後台建立，不提供自助註冊
- 登入方式以 Email 優先；無 Email 時使用手機號碼作為 username（存入 `ba_user.username`）
- 帳號建立時系統產生一次性登入連結（畫面顯示 QR），不使用 SMS OTP
- Email 和手機號碼在整個系統內必須唯一（建立/更新時需檢查）

## MVP 功能

### 家長列表

- 篩選：姓名/手機/Email 搜尋、帳號狀態（預設只顯示 `active / inactive`，封存需手動切換顯示）
- 每筆顯示：姓名、識別帳號（Email 或手機）、關聯學生數、帳號狀態
  （API 與前端的欄位名還叫 `loginAccount`，那是密碼時代留下的命名，**沒有人用它登入**）
- 點擊進入編輯或查看詳情

### 新增/編輯家長 Popup

| 欄位     | 類型   | 必填   | 說明                                                      |
| -------- | ------ | ------ | --------------------------------------------------------- |
| 姓名     | 文字   | 是     |                                                           |
| Email    | 文字   | 二擇一 | 產生登入連結時的查人鍵；需通過 email 格式驗證             |
| 手機     | 文字   | 二擇一 | 聯絡方式；無 Email 時另存入 `ba_user.username` 當唯一性鍵 |
| 關聯學生 | 多選   | 否     | 可搜尋並選擇學生，支援多個                                |
| 備註     | 長文字 | 否     |                                                           |

> 帳號狀態（active / inactive / archived）不在新增/編輯表單中設定，由列表頁的操作按鈕管理。

**驗證規則**：

- Email 和手機至少填一個，可同時填
- Email/手機唯一性：若已被其他帳號使用，顯示「此 Email/手機已被使用」
- 新增時系統產生一次性登入連結

**帳號建立流程（新增時）**：

1. 前端送出表單
2. 後端呼叫 `Better Auth admin.createUser()` 建立 `ba_user`
3. 同步建立 `parents` 記錄，關聯 `ba_user.id`
4. 若有關聯學生，建立 `parent_student_relations` 記錄
5. 回傳一次性登入連結，畫面顯示 QR 讓家長當場用自己的手機掃

### 新增家長：Email／手機已是本機構教職員的帳號（#1844）

> **狀態：已實作**（#1844，設計稿 #1848 經計畫席 10-22 批准）。判斷在 `lib/staff-as-parent.ts`
> （`decideExistingAccount`／`findExistingAccounts`／`linkStaffAsParent`），路由在 `routes/parents.ts` 的 `POST /`。
> 使用者 10-22 選 A：老師或行政兼家長時，**由行政在這一頁一次完成**，取代帳號設定的「啟用家長身份」
> （那條路建出沒有孩子的家長列，行政也不知道有人啟用了，見 [[specs/admin/roles-and-auth]]）。
> 孩子的驗證直接用 #1843 的 `checkChildren`（`lib/parent-children.ts`），不另寫一份。

**現況**：建立家長時 `createUser` 遇到既有 email／手機就回 409 `DUPLICATE_EMAIL`／`DUPLICATE_PHONE`
（`routes/parents.ts:495-498`），行政沒辦法把一位老師設成家長。

**新流程**：

1. 送出前，後端先用表單的 Email（精確比對 `ba_user.email`）與手機（`ba_user.phone` 或 `username`，
   同 `batch-import` 的比對）找既有帳號。找不到 → 照現有流程建新帳號。
2. 找到了，依序判斷（第一個成立的就回）：

   | 情況                                             | 回應                                                                                                         |
   | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
   | 帳號屬於**別的機構**（`ba_user.orgId` ≠ 本機構） | 照舊 409 `DUPLICATE_EMAIL`／`DUPLICATE_PHONE`，**不透露是誰**（不能跨機構接人）                              |
   | Email 與手機分別對到**兩個不同**的帳號           | 409 `ACCOUNT_CONFLICT`：「Email 與手機分別屬於不同帳號」                                                     |
   | 掃碼機台帳號（`kiosk`）                          | 照舊 409 —— 機台不是人                                                                                       |
   | 這個帳號在本機構**已經有家長資料**（任何狀態）   | 409 `PARENT_ALREADY_EXISTS`，回 `parentId`、`status`：「已經是家長「○○」，去編輯那筆」，**不自動恢復**（Q1） |
   | 對到的帳號是**操作者本人**、操作者沒有 `*`       | 403 `SELF_LINK_FORBIDDEN`：「請由其他管理員把你設為家長」（Q3）                                              |
   | 本機構的教職員帳號，但**教職員已停用或封存**     | 409 `STAFF_NOT_ACTIVE`：「○○ 的教職員帳號已停用，不能設為家長」（Q5）                                        |
   | 本機構的**啟用中教職員**、還沒有家長資料         | 409 `STAFF_ACCOUNT_EXISTS`，回 `userId`、教職員姓名 → 畫面確認（見下）                                       |

   沒有教職員身分、也沒有家長資料的本機構帳號（孤兒），維持現狀的 409（見「不做」）。

3. **確認框**：「這是 ○○（教職員）的帳號，要把他設為家長嗎？家長資料會用「○○」這個名字。」
   按「設為家長」後，前端帶 `linkExistingUserId: <userId>` **原表單再送一次**。後端**重新做一次上面的判斷**，
   不信前端帶來的 id，只在仍然是「本機構啟用中教職員、還沒有家長資料」而且 id 一致時才往下做。
   不一致、或已經對不到任何帳號（兩次送出之間 Email／手機被改了），回 409 `LINK_TARGET_CHANGED`「帳號資料已經變了，請重新送出」，
   **不會**改去建一個新帳號。
4. **一次完成、同一個交易**（`withTx`，見 [[architecture/pg-pool-writes]]）：
   - 建 `parents` 列：`org_id`＝本機構，`status = active`，名字用**教職員姓名**（`staff.display_name`），
     不用表單填的姓名（Q2）
   - `user_roles` 加 `parent`（已經有就不重複）
   - `parent_student_relations`：勾選的孩子先過 #1843 的 `checkChildren`（本機構＋操作者的分校範圍），
     不合格整筆回滾：別 org／不存在 404 `STUDENT_NOT_FOUND`、範圍外 403 `STUDENT_OUT_OF_SCOPE`（同 #1843 的 POST）
   - 稽核：`resource_type = parent`、`action = create`，`details.linkedExistingUser = true`
   - 任一步失敗整筆 ROLLBACK，不會留下「有角色沒資料」或「有資料沒孩子」的半成品
5. 回應 201，`loginUrl: null` —— 對方已經有帳號、平常怎麼登入就怎麼登入，**不發新的登入連結**。
6. 呼叫 `invalidateIdentity(對方 userId)`。它只清得到**當下這個 isolate**，對方的請求多半落在別的 isolate，
   所以**最遲 30 秒**才看得到家長身分（`lib/identity-cache.ts` 的上限，跟管理員改別人權限一樣）。
   成功訊息照實寫：「已把 ○○ 設為家長，稍後重新整理即可切換到家長身分」。

**授權**：跟新增家長同一道門（`ADMIN_ONLY`＋寫入 `manage_students`），把自己設成家長另見上表（Q3）。
`SELF_LINK_FORBIDDEN` 排在 `STAFF_ACCOUNT_EXISTS` 之前，沒權限的人不會先看到確認框。

**孩子的驗證**：用 #1843 的 `checkChildren`。理由：家長端的資料範圍**只來自** `parent_student_relations`
（`lib/child-scope.ts`），不再比 org 或分校 —— 關聯一旦指錯，家長身分就看得到不該看的孩子。
既有的 `POST`／`PUT /api/parents` 由 #1843 補；其他插入關聯的路徑記在 #1845。

**不做**：批次匯入（`batch-import`）遇到教職員帳號仍照現狀失敗、逐筆標記（要設為家長請在這頁單筆做）；
「孤兒帳號」（`ba_user` 存在但沒有任何身分）的接管，維持現狀。

**裁定**（計畫席 10-22）：

- **Q1 帳號已經有家長資料**（含停用、封存）→ 擋下、指去編輯那筆，**不自動恢復**。狀態只由列表頁的停用／啟用／封存按鈕改；
  封存依規則是單向的（見「帳號狀態」），自動恢復等於第二條解除封存的路。停用的那筆，行政按「啟用」再編輯孩子即可。
- **Q2 家長資料的名字** → 用教職員姓名，確認框寫出來。同一個人兩個身分顯示同一個名字（`updateDisplayName` 本來就兩處一起改）。
- **Q3 把自己設成家長** → 只有持有 `*` 的人可以。家長身分的資料範圍不受分校限制，受限的管理員設了自己就繞過了分校範圍；
  跟「提權要經過另一個人」同一個理由，例外也跟 #1829 一樣給 `*`。
- **Q4 既有建立／編輯家長沒驗證孩子** → 不在這張補，由 #1843 補（`checkChildren`、交易）；#1844 疊在 #1843 上直接用它。
- **Q5 教職員帳號已停用** → 擋下。登入判定是「任一身分 active 就放行」（`middleware/account-status.ts`），而角色不看身分資料的狀態
  （`middleware/auth.ts:71-79`）—— 停用的老師被設成家長後會重新登入得了、還切得到老師身分。那個洞本身是 #1846（保留類）。

### 帳號狀態

家長帳號採三態設計，與 Staff 一致：

| 狀態 | DB 值      | 說明                                                    |
| ---- | ---------- | ------------------------------------------------------- |
| 啟用 | `active`   | 正常狀態，可登入                                        |
| 停用 | `inactive` | 暫停登入，資料保留，可恢復                              |
| 封存 | `archived` | 孩子已畢業/離校，永久停用，從預設列表隱藏，歷史紀錄保留 |

狀態轉換規則（對齊人員管理）：

- `active` ↔ `inactive`：可雙向切換
- `active` / `inactive` → `archived`：單向，無法透過 API 解除封存
- 登入狀態由 `authMiddleware` **每個請求**查 `parents.status` 判斷，非 active 一律拒絕（`/api/login` 已隨密碼登入一起移除）
- 封存前 UI 需顯示確認警告

### 帳號管理功能

| 功能               | 說明                                 | 實作方式                                                                                         |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 產生登入連結       | 一次性、24 小時過期、單次使用        | `POST /api/login-links`（見 [[architecture/line-oauth-login]]）                                  |
| 更換識別／聯絡資訊 | 修改 Email 或手機                    | 更新 `ba_user`（**實作偏離：目前 email 與 phone 都直寫 `ba_user`，未走 BA `updateUser`**，見下） |
| 顯示 QR            | 把連結變成 QR，可瀏覽器列印          | `LoginLinkDialogComponent`                                                                       |
| 停用帳號           | 暫停登入權限，資料保留，可恢復       | `PATCH /deactivate`，更新 `parents.status = 'inactive'`                                          |
| 啟用帳號           | 恢復登入權限（從停用恢復）           | `PATCH /activate`，更新 `parents.status = 'active'`                                              |
| 封存帳號           | 孩子已離校，單向封存，從預設列表隱藏 | `PATCH /archive`，更新 `parents.status = 'archived'`；前端需顯示警告                             |

**這個系統沒有密碼**（見 [[architecture/line-oauth-login]]）。家長點一次性連結登入、
綁定 LINE，之後直接用 LINE。**Email 與手機都不是登入憑證** —— Email 是產生連結時的
查人鍵，手機是聯絡方式。

> **已知偏離（不在文案清理的範圍）**：上表的「更換識別／聯絡資訊」寫的是 email 透過
> Better Auth 的 `updateUser`，但 `routes/parents.ts` 實際是 `supabase.from('ba_user').update()`
> 直寫 —— 也就是憲法 c2（`ba_*` 可讀不可寫）的存量違規。這不是有意識的取捨，是實作偏離了
> 本規格。已列入「`ba_user` 寫入路徑收斂」的改善項目，另案處理。

**連結弄丟或過期**：管理員在家長頁按「產生登入連結」重發。連結會過期、只能用一次；
密碼會被寫在便條紙上留著。

**沒有 email 的家長**：不影響。magic-link 用的是佔位 email
（`0912345678@phone.internal`），那個 domain 不存在於公開網路，而且我們從不寄信。

## 資料依賴

| 操作 | 資料表                                                       |
| ---- | ------------------------------------------------------------ |
| 讀取 | `parents`, `parent_student_relations`, `students`, `ba_user` |
| 寫入 | `parents`, `parent_student_relations`, `ba_user`             |

## 實作註記

- `parents.user_id` 為 NOT NULL，每筆家長記錄必須對應一個 BA 帳號；建立流程失敗時需 rollback（呼叫 `auth.api.removeUser()`）
- `parents.status` 為 enum（`active / inactive / archived`），取代原本的 `is_active` 布林欄位
- Email/手機唯一性在後端 API 層驗證，回傳明確錯誤訊息
- 所有帳號操作（建立、停用/啟用/封存）記錄於稽核紀錄。**產生登入連結目前沒有寫稽核 —— 那是個缺口**（發放登入憑證卻不留紀錄）
- Email/手機統一儲存在 `ba_user`（`ba_user.email`、`ba_user.phone`），`parents` 表不含這兩個欄位
- phone 直接寫 `ba_user.phone`；email 透過 Better Auth `admin.updateUser()` 更新（BA 負責唯一性驗證）
- 登入狀態不使用 `ba_user.banned`，由 `authMiddleware` 查 `parents.status` 判斷 —— 停用是**立即生效**的，不必等 session 過期

## 相關規則與流程

- [[flows/enrollment|報名申請流程]] — 新生透過報名完成才建立家長帳號的情境
- [[rules/enrollment-rules|報名與繳費規則]] — 第 1.4 條：`public_form` 繳費完成後才建立家長資料

## PRD 參考

- 5.2 家長
- 7.5 管理員頁面
