# 帳號設定與家長身份啟用 設計

**日期**：2026-03-19
**Phase**：3（共 5 phases，見 `doc/specs/admin/roles-and-auth.md`）
**狀態**：待實作

---

## 背景

admin / teacher 帳號由管理者在人員管理頁建立，但基本個人資料（姓名、Email、電話、生日）應允許帳號持有者自行維護。此外，具備 admin 或 teacher 角色的使用者，若本身也有子女就讀，需要能自助啟用 `parent` 角色，而不需要另外開一個新帳號。

> **注意**：此 Phase 的使用者皆為 admin 或 teacher，必定有對應的 `staff` 記錄。純 parent 帳號（無 staff 記錄）的個人設定頁留待後續 Phase 處理。

---

## 範圍

1. Header user dropdown 新增「帳號設定」入口
2. 帳號設定 Dialog（基本資料編輯 + 修改密碼捷徑 + 家長身份啟用）
3. 後端 `/api/me` 新增 `PATCH` 與 `POST /activate-parent` handler（與現有 `GET /api/me` 整合至 `apps/api/src/routes/me.ts`）

---

## 設計

### 1. Header User Dropdown

位置：`shell-layout.component.html` 右上角頭像點擊後的 Popover。

**修改前：**
- 使用者資訊（頭像 + 姓名 + email）
- 分隔線
- 修改密碼
- 登出

**修改後：**
- 使用者資訊（頭像 + 姓名 + email）
- 分隔線
- **帳號設定**（開啟 AccountSettingsDialogComponent）
- 登出

「修改密碼」從此選單移除，改整合至帳號設定 Dialog 內。

---

### 2. 帳號設定 Dialog（`AccountSettingsDialogComponent`）

路徑：`apps/web/src/app/shared/components/account-settings-dialog/`

Dialog 內容分三個區塊：

#### 區塊一：基本資料

| 欄位 | 行為 |
|------|------|
| 顯示名稱 | 直接儲存，呼叫 `PATCH /api/me` |
| Email | 儲存前跳確認 dialog「確定要將 Email 改為 X 嗎？改後需用新 Email 登入」，確認後呼叫 `PATCH /api/me` |
| 電話 | 儲存前跳確認 dialog「確定要將電話改為 X 嗎？改後需用新電話登入」，確認後呼叫 `PATCH /api/me` |
| 生日 | 直接儲存，呼叫 `PATCH /api/me` |

Email 與電話需要確認 dialog 的原因：兩者皆為登入憑據，變更後需用新值登入。

#### 區塊二：安全性

- 「修改密碼」按鈕：關閉 dialog，導航至 `/{activeRole}/change-password`（例如 `/admin/change-password`）。各 role 的 change-password 路由已存在於 app.routes.ts，保留現有邏輯。

#### 區塊三：家長身份

- **顯示條件**：使用者目前**沒有** `parent` role 時才顯示此區塊。
- 說明文字：「啟用後可使用家長 portal 查看子女的出缺席與課表。」
- 「啟用家長身份」button → 觸發 inline stepper（在同一個 Dialog 內切換視圖）。

---

### 3. 家長身份啟用流程（Inline Stepper）

在 AccountSettingsDialog 內切換，不開新的 Dialog。

**Step 1 — 填寫子女資料**

| 欄位 | 必填 |
|------|------|
| 子女姓名（name） | ✓ |
| 年級（grade，Select） | ✓ |

按「下一步」→ Step 2。

**Step 2 — 確認**

- 顯示 Step 1 填寫的資訊。
- 「確認啟用」→ 呼叫 `POST /api/me/activate-parent`。
- 成功後呼叫 `AuthService.refreshRoles()`，更新前端 roles signal。
- 顯示訊息：「家長身份已啟用，下次切換角色時即可使用。」
- 「完成」→ 回到帳號設定主畫面，`parent` 區塊消失（因為已有 parent role）。

---

### 4. 後端 API

#### 路由整合策略

現有 `GET /api/me` 定義在 `apps/api/src/index.ts`。此 Phase 將：

1. 新增 `apps/api/src/routes/me.ts`，包含 `GET`、`PATCH`、`POST /activate-parent` 三個 handler
2. 將 `apps/api/src/index.ts` 的 `GET /api/me` 移入 `me.ts`，並在 `index.ts` 中 `app.route('/api/me', meRoutes)` 統一掛載

#### `GET /api/me`（擴充）

現有 response 僅含 `userId, orgId, displayName, roles, permissions`。移入 `me.ts` 時，需同時回傳帳號設定 Dialog 預填所需的欄位，加上：`email`、`phone`、`birthday`（JOIN `staff` 表取得）。

#### `PATCH /api/me`

更新目前登入使用者的個人資料。

**Request body（所有欄位皆為 optional）：**
```json
{
  "displayName": "string",
  "email": "string",
  "phone": "string | null",
  "birthday": "string | null"
}
```

**行為：**

- `displayName`：同時更新 `profiles.display_name`（Supabase）與 Better Auth `auth.api.updateUser({ body: { name } })`
- `email`：呼叫 BA `auth.api.updateUser({ body: { email } })`，直接更新（不寄驗證信）；若 email 已被他人使用，BA 回傳錯誤，轉為 422 `EMAIL_ALREADY_IN_USE`
- `phone`：
  - 直接更新 `ba_user.phone`
  - 若該使用者為 phone-only 帳號（`ba_user.email IS NULL`），則同步更新 `ba_user.username`（phone-only 登入時 `username = phone`）
- `birthday`：更新 `staff.birthday`（此 Phase 的使用者皆為 admin/teacher，必有 staff 記錄）

**Response：** 更新後的使用者資料（displayName, email, phone, birthday）。

#### `POST /api/me/activate-parent`

建立子女學生資料、關聯 parent-student、賦予呼叫者 `parent` role。

**Request body：**
```json
{
  "studentName": "string",
  "grade": "GradeLevel"
}
```

**行為（需在 transaction 內執行）：**

1. 建立 `students` 記錄：`{ name: studentName, grade, orgId: c.get('orgId'), isActive: true }`（其他欄位為 null）
2. 建立 `student_parents` 關聯：`{ student_id, parent_user_id: userId, relation: null, is_primary: true }`
3. 在 `user_roles` 新增 `{ user_id: userId, role: 'parent', org_id: orgId }`（若已存在則忽略）
4. 回傳更新後的完整 roles 清單

**Response：**
```json
{
  "studentId": "string",
  "roles": ["admin", "parent"]
}
```

---

### 5. AuthService 變更

在 `AuthService` 新增公開方法 `refreshRoles()`：

```typescript
async refreshRoles(): Promise<void> {
  // 重新呼叫 GET /api/me，更新 _roles signal
}
```

前端在 `activate-parent` 成功後呼叫此方法，確保 `roles()` signal 立即反映新增的 `parent` role。

---

## 資料流

```
使用者點擊頭像 → Popover → 「帳號設定」
  → AccountSettingsDialog 開啟
  → 從 AuthService 取得目前 profile / roles

修改基本資料：
  → (email/phone) 確認 dialog → PATCH /api/me → 更新 AuthService profile signal

修改密碼：
  → 關閉 dialog → navigate /{activeRole}/change-password

啟用家長身份：
  → Step 1 填寫子女 → Step 2 確認
  → POST /api/me/activate-parent
  → 成功：AuthService.refreshRoles() 更新 roles signal
  → 下次開啟 /select-role 會出現「家長」選項
```

---

## 邊界條件

| 情況 | 處理 |
|------|------|
| 使用者已有 parent role | 帳號設定不顯示「家長身份」區塊 |
| email 改為已被他人使用的信箱 | 顯示「此 Email 已被使用」 |
| phone-only 帳號更新電話 | 同步更新 `ba_user.username` |
| activate-parent 部分失敗 | Transaction rollback，不留下孤兒 student 記錄 |
| activate-parent 成功後立即切換角色 | `refreshRoles()` 後 `/select-role` 即可看到 parent 選項 |

---

## 不在此 Phase 範圍

- Email 變更驗證信流程
- 頭像自訂上傳
- 家長啟用後關聯多個子女（此 phase 只支援一次建立一筆學生）
- 解除家長身份
- 純 parent 帳號（無 staff 記錄）的帳號設定頁

---

## 檔案清單

| 動作 | 檔案 | 說明 |
|------|------|------|
| 修改 | `apps/web/src/app/shared/components/layout/shell-layout/shell-layout.component.html` | dropdown 換成「帳號設定」 |
| 修改 | `apps/web/src/app/shared/components/layout/shell-layout/shell-layout.component.ts` | 開啟 AccountSettingsDialog |
| 新增 | `apps/web/src/app/shared/components/account-settings-dialog/account-settings-dialog.component.ts` | Dialog 主元件 |
| 新增 | `apps/web/src/app/shared/components/account-settings-dialog/account-settings-dialog.component.html` | Dialog 模板 |
| 新增 | `apps/web/src/app/shared/components/account-settings-dialog/account-settings-dialog.component.scss` | Dialog 樣式 |
| 修改 | `apps/web/src/app/core/auth.service.ts` | 新增 `refreshRoles()` 公開方法 |
| 新增 | `apps/api/src/routes/me.ts` | GET + PATCH + POST /activate-parent |
| 修改 | `apps/api/src/index.ts` | 移除舊 GET /api/me，改用 `app.route('/api/me', meRoutes)` |
