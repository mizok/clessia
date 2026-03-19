# Root 帳號與登入擴充設計

**日期**：2026-03-19
**Phase**：1（共 5 phases，見 `doc/specs/admin/roles-and-auth.md`）
**狀態**：待實作

---

## 背景

系統部署時需要一個「第一個管理者」帳號，讓負責人可以登入後台並開始設定組織。此帳號（`root`）由初始化 seed 自動建立，不透過一般報名或人員管理流程。

---

## 現況說明

`supabase/seed.sql` 已存在 root 帳號，結構如下：
- `ba_user`: `id = 00000000-…`, `email = NULL`, `username = 'root'`（純 username，無 email / phone）
- `ba_account`: `accountId = 'root'`（對應 username），`password` 為 **scrypt** hash（Better Auth 格式：`hex_salt:hex_key`）
- `profiles`: `display_name = 'root'`, `org_id = demo_org_id`
- `user_roles`: admin（`permissions = ["*"]`）、teacher、parent 三筆

Seed 已冪等（`ON CONFLICT ... DO UPDATE`）。

---

## 範圍

1. `apps/api/src/index.ts` — `/api/login` 支援 `loginType: 'username'`
2. `apps/web` — 登入頁支援 `?role=root` query param

---

## 設計

### 1. 後端 `/api/login` 擴充

現有第 155 行將任何非 `'phone'` 的值都轉為 `'email'`，需調整為支援三個值：

```
loginType: 'email' | 'phone' | 'username'
```

新增 `'username'` 分支：
1. 跳過 `ba_user` 查詢與 staff / parent 狀態檢查
2. 直接呼叫 `signInUsername({ username: account, password })`
3. Better Auth 以 `ba_account.accountId = account` 比對 credential

安全說明：前端 readonly 僅為 UX 引導，安全性依賴後端——目前只有 `accountId = 'root'` 的 username credential 存在，傳入其他值驗證必然失敗。

### 2. 前端登入頁

**偵測邏輯**（`login.component.ts`）：
- 讀取 `ActivatedRoute.snapshot.queryParamMap.get('role')`
- 若值為 `'root'`，設定內部 signal `isRootMode = true`

**UI 變化**（`login.component.html`）：
- `isRootMode = true` 時：
  - 隱藏 email / phone 切換 tab
  - 帳號欄位改為 readonly input，固定顯示 `root`
  - placeholder 改為「請輸入密碼」
- `isRootMode = false` 時：現有 UI 完全不變

**送出邏輯**（`auth.service.ts` 的 `signIn`）：
- `loginMode` 型別擴充為 `'email' | 'phone' | 'username'`
- `isRootMode` 時，`account` 固定為 `'root'`，`loginMode` 為 `'username'`

---

## 資料流

```
使用者開啟 /login?role=root
  → LoginComponent 偵測 queryParam → isRootMode = true
  → UI 切換（readonly root 欄位，只需輸入密碼）
  → 使用者輸入密碼，送出
  → POST /api/login { account: 'root', password, loginType: 'username' }
  → 後端直接呼叫 signInUsername({ username: 'root', password })
  → Better Auth 比對 ba_account.accountId = 'root' → 驗證 scrypt hash
  → Session cookie 建立
  → 前端導向 /admin
```

---

## 邊界條件

| 情況 | 處理 |
|------|------|
| seed 執行多次 | `ON CONFLICT DO UPDATE`，冪等 |
| root 帳號密碼錯誤 | 與一般登入相同的錯誤訊息 |
| 前端 readonly 被 DevTools 繞過 | 後端只有 accountId='root' 的 credential 存在，其他值驗證必然失敗 |
| 一般使用者直接 POST loginType='username' | 只有 root credential 存在，傳入其他 username 驗證失敗 |
| root 帳號 org 綁定 | 目前綁定 demo_org_id，正式環境需在建立組織後更新 root 的 org_id（Phase 5 範疇） |

---

## 不在此 Phase 範圍

- 強制修改密碼流程（首次登入提示）
- root 帳號的個人設定頁
- 其他 username 帳號（目前只有 root）
