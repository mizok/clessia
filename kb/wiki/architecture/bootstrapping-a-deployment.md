---
title: 開一個新站
summary: 建立組織與第一個管理員的唯一路徑。零 demo 資料，走 Better Auth 建帳號，冪等。
category: architecture
tags: [architecture, deployment, bootstrap, onboarding]
status: active
updated: 2026-08-24
---

# 開一個新站

## 為什麼需要這個

在此之前，**唯一會建立組織的地方是 `supabase/seed.sql`** —— 一個 1263 行、含 165 處
demo 資料的檔案（Demo 補習班、出勤測試學生 01–08、測試國中）。沒有任何 API 能建立組織，
所以第一個管理員也無處誕生。

要交付給真實客戶，只有兩條路：把 demo 資料一起塞進去然後手動刪，或手寫 SQL。
兩個都不是產品。

這同時是 [[architecture/constitution|c12]] 的前提：**客戶要能自架，就得能開一個乾淨的站。**

## 用法

```bash
ORG_NAME="向上補習班" ORG_SLUG=xiangshang \
ADMIN_EMAIL=owner@example.com ADMIN_NAME="王主任" \
npm run bootstrap
```

環境變數同 `apps/api` 的執行期設定（`DATABASE_URL`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`）。

不給 `ADMIN_PASSWORD` 就自動產生一組，**只在終端機顯示一次、不存任何地方**。

## 三個設計決定

### 走 Better Auth 建帳號，不寫 SQL

`ba_*` 由 Better Auth 獨佔寫入（憲法 c2），密碼雜湊格式是它的內部細節。直接寫 SQL
的話，它換演算法時會默默壞掉——而症狀是「某些使用者登不進去」，不是報錯。

`seed.sql` 確實直接寫 `ba_user` / `ba_account`，那是開發用的既存做法；**新的路徑不沿用**。

### 不是 API endpoint

一支「建立組織並給我管理員權限」的端點，就算加了一次性檢查也是攻擊面。
**開站是部署行為，不是執行期功能。**

### 冪等：slug already exists 就中止

不覆寫任何東西。重跑一次不會把客戶的組織名稱改掉，也不會多建一個管理員。

## 刻意不做

- **不預先建立分校 / 科目 / 課程** —— 那些是客戶自己的資料，猜了就是要他們先刪
- **不建立 root 帳號** —— 那是開發環境的系統帳號，不屬於客戶的部署
- **不寄密碼** —— 沒有寄信設定（見 [[specs/public/login|忘記密碼的現況]]），
  而且當面交付比信件安全

## 驗證過的行為

| 情境 | 結果 |
| --- | --- |
| 正常開站 | 組織 + 管理員 + `user_roles(admin, ["*"])` + `ba_user.orgId` 都正確 |
| 夾帶 demo 資料 | 0 學生、0 班級、0 分校 |
| slug 重複 | 中止，原資料未變更 |
| 缺環境變數 | 明確指出缺哪一個，不會寫一半 |
| slug 含空白或 `;` | 拒絕（它會出現在網址與匯出檔名） |
