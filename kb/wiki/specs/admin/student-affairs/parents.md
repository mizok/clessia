---
title: 家長資料
summary: 管理家長帳號，關聯學生，處理帳號相關操作。
category: spec
status: active
updated: 2026-08-28
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
- 新增時系統產生一次性登入連結

**帳號建立流程（新增時）**：

1. 前端送出表單
2. 後端呼叫 `Better Auth admin.createUser()` 建立 `ba_user`
3. 同步建立 `parents` 記錄，關聯 `ba_user.id`
4. 若有關聯學生，建立 `parent_student_relations` 記錄
5. 回傳一次性登入連結，畫面顯示 QR 讓家長當場用自己的手機掃

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

| 功能         | 說明                                 | 實作方式                                                                   |
| ------------ | ------------------------------------ | -------------------------------------------------------------------------- |
| 產生登入連結 | 一次性、24 小時過期、單次使用        | `POST /api/login-links`（見 [[architecture/line-oauth-login]]）            |
| 更換登入帳號 | 修改 Email 或手機                    | 更新 `ba_user`（email 透過 BA `updateUser`，phone 直接寫 `ba_user.phone`） |
| 顯示 QR      | 把連結變成 QR，可瀏覽器列印          | `LoginLinkDialogComponent`                                                 |
| 停用帳號     | 暫停登入權限，資料保留，可恢復       | `PATCH /deactivate`，更新 `parents.status = 'inactive'`                    |
| 啟用帳號     | 恢復登入權限（從停用恢復）           | `PATCH /activate`，更新 `parents.status = 'active'`                        |
| 封存帳號     | 孩子已離校，單向封存，從預設列表隱藏 | `PATCH /archive`，更新 `parents.status = 'archived'`；前端需顯示警告       |

**這個系統沒有密碼**（見 [[architecture/line-oauth-login]]）。家長點一次性連結登入、
綁定 LINE，之後直接用 LINE。

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
