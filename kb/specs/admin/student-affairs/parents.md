---
title: 家長資料
summary: 管理家長帳號，關聯學生，處理帳號相關操作。
category: spec
status: active
updated: 2026-03-19
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
- 帳號建立時系統自動產生初始密碼，不使用 SMS OTP
- Email 和手機號碼在整個系統內必須唯一（建立/更新時需檢查）

## MVP 功能

### 家長列表

- 篩選：姓名/手機/Email 搜尋、帳號狀態（預設只顯示 `active / inactive`，封存需手動切換顯示）
- 每筆顯示：姓名、登入帳號（Email 或手機）、關聯學生數、帳號狀態
- 點擊進入編輯或查看詳情

### 新增/編輯家長 Popup

| 欄位     | 類型   | 必填   | 說明                                     |
| -------- | ------ | ------ | ---------------------------------------- |
| 姓名     | 文字   | 是     |                                          |
| Email    | 文字   | 二擇一 | 優先作為登入帳號；需通過 email 格式驗證  |
| 手機     | 文字   | 二擇一 | 無 Email 時作為登入帳號（存入 username） |
| 關聯學生 | 多選   | 否     | 可搜尋並選擇學生，支援多個               |
| 備註     | 長文字 | 否     |                                          |

> 帳號狀態（active / inactive / archived）不在新增/編輯表單中設定，由列表頁的操作按鈕管理。

**驗證規則**：

- Email 和手機至少填一個，可同時填
- Email/手機唯一性：若已被其他帳號使用，顯示「此 Email/手機已被使用」
- 新增時系統自動產生隨機初始密碼

**帳號建立流程（新增時）**：

1. 前端送出表單
2. 後端呼叫 `Better Auth admin.createUser()` 建立 `ba_user`
3. 同步建立 `parents` 記錄，關聯 `ba_user.id`
4. 若有關聯學生，建立 `parent_student_relations` 記錄
5. 回傳初始密碼（僅此時顯示一次），管理員據此產生帳號資訊卡

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
- 登入狀態由 `/api/login` 查 `parents.status` 判斷，非 active 一律拒絕
- 封存前 UI 需顯示確認警告

### 帳號管理功能

| 功能           | 說明                                        | 實作方式                                                                   |
| -------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| 重設密碼       | 產生新的隨機密碼                            | `Better Auth admin.setPassword()`                                          |
| 更換登入帳號   | 修改 Email 或手機                           | 更新 `ba_user`（email 透過 BA `updateUser`，phone 直接寫 `ba_user.phone`） |
| 產生帳號資訊卡 | 顯示目前帳號 + 最新密碼（PDF 或可列印格式） | 前端產生，含補習班名稱、帳號、密碼、說明                                   |
| 停用帳號       | 暫停登入權限，資料保留，可恢復              | `PATCH /deactivate`，更新 `parents.status = 'inactive'`                    |
| 啟用帳號       | 恢復登入權限（從停用恢復）                  | `PATCH /activate`，更新 `parents.status = 'active'`                        |
| 封存帳號       | 孩子已離校，單向封存，從預設列表隱藏        | `PATCH /archive`，更新 `parents.status = 'archived'`；前端需顯示警告       |

**重設密碼後**：新密碼必須顯示給管理員（提示「請記下或立刻產生帳號資訊卡」），不發送 email 通知（因為不一定有 email）。

**忘記初始密碼**：管理員隨時可重設密碼，重設後再次顯示新密碼並提供帳號資訊卡入口。

### 忘記密碼邏輯

- 有 Email 的家長：管理員透過 Better Auth 發送重設連結（或直接後台重設）
- 沒有 Email 的家長：只能由管理員後台手動重設密碼

## 資料依賴

| 操作 | 資料表                                                       |
| ---- | ------------------------------------------------------------ |
| 讀取 | `parents`, `parent_student_relations`, `students`, `ba_user` |
| 寫入 | `parents`, `parent_student_relations`, `ba_user`             |

## 實作註記

- `parents.user_id` 為 NOT NULL，每筆家長記錄必須對應一個 BA 帳號；建立流程失敗時需 rollback（呼叫 `auth.api.removeUser()`）
- `parents.status` 為 enum（`active / inactive / archived`），取代原本的 `is_active` 布林欄位
- Email/手機唯一性在後端 API 層驗證，回傳明確錯誤訊息
- 所有帳號操作（建立、重設密碼、停用/啟用/封存）記錄於稽核紀錄
- Email/手機統一儲存在 `ba_user`（`ba_user.email`、`ba_user.phone`），`parents` 表不含這兩個欄位
- phone 直接寫 `ba_user.phone`；email 透過 Better Auth `admin.updateUser()` 更新（BA 負責唯一性驗證）
- 登入狀態不使用 `ba_user.banned`，由 `/api/login` 查 `parents.status` 判斷
- 初始密碼建議格式：8 碼英數混合，可用 `crypto.randomBytes` 產生

## 相關規則與流程

- [報名申請流程](../../../flows/enrollment.md) — 新生透過報名完成才建立家長帳號的情境
- [報名與繳費規則](../../../rules/enrollment-rules.md) — 第 1.4 條：`public_form` 繳費完成後才建立家長資料

## PRD 參考

- 5.2 家長
- 7.5 管理員頁面
