---
title: 開一個新站
summary: 建立組織與第一個管理員的唯一路徑。零 demo 資料，走 Better Auth 建帳號，冪等。
category: architecture
tags: [architecture, deployment, bootstrap, onboarding]
status: active
updated: 2026-08-28
---

# 開一個新站

## 為什麼需要這個

在此之前，**唯一會建立組織的地方是 `supabase/seed.sql`** —— 一個上千行、塞滿
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

必要的環境變數：`DATABASE_URL`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`、`WEB_URL`。
缺任何一個都會乾淨報錯，不會寫一半。

> `WEB_URL` 是必填 —— 產生的登入連結要知道兌換完把人導去哪。

**它印出的是一次性登入連結，不是密碼**（這個系統沒有密碼）。連結一次有效、24 小時
過期，點開就登入，接著在畫面上綁定 LINE。

弄丟或過期就跑：

```bash
LOGIN_EMAIL=owner@example.com npm run login-link
```

那支同時是**唯一的破窗管道** —— 持有 `DATABASE_URL` 的人才產得出來。
見 [[architecture/line-oauth-login]]。

## 開站之前要先有的東西

|                                | 誰做   | 備註                                                                                                                                                                                          |
| ------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase 專案 + 推 migration   | 人     |                                                                                                                                                                                               |
| Cloudflare Worker / Pages 部署 | 人     | 見 [[architecture/deploying]]                                                                                                                                                                 |
| 四個 secret                    | 人     | `DATABASE_URL`、`BETTER_AUTH_SECRET`、`SUPABASE_SECRET_KEY`、`LINE_CLIENT_SECRET`                                                                                                             |
| **LINE Developers channel**    | **人** | 每個部署自己申請。拿到 Channel ID（非機密，`--var LINE_CLIENT_ID`）與 Channel secret（`wrangler secret put`），並在 LINE 後台把 Callback URL 設成 `https://<你的網域>/api/auth/callback/line` |

**沒有 LINE channel 就沒有人能登入** —— `socialProvidersFromEnv` 少一個變數就整個不設定，
登入頁的按鈕會靜默失效。

## 三個設計決定

### 走 Better Auth 建帳號，不寫 SQL

`ba_*` 由 Better Auth 獨佔寫入（憲法 c2），內部格式是它的細節。直接寫 SQL 的話，
它換實作時會默默壞掉——而症狀是「某些使用者登不進去」，不是報錯。

**`createUser` 刻意不帶 password** —— Better Auth 明說不給就是「magic link 或
social login only user」。給了會做一次 scrypt，那正是撞爆 Workers 10ms CPU 上限的東西。
**harness gate A11 守著這件事**（它抓過一次真實的疏漏）。

### 不是 API endpoint

一支「建立組織並給我管理員權限」的端點，就算加了一次性檢查也是攻擊面。
**開站是部署行為，不是執行期功能。**

### 冪等：slug already exists 就中止

不覆寫任何東西。重跑一次不會把客戶的組織名稱改掉，也不會多建一個管理員。

## 刻意不做

- **不預先建立分校 / 科目 / 課程** —— 那些是客戶自己的資料，猜了就是要他們先刪
- **不建立 root 帳號** —— 那是開發環境的系統帳號，不屬於客戶的部署
- **不寄任何東西** —— 沒有寄信管道。連結印在終端機，由部署者當面或用既有管道交付

## 驗證過的行為

| 情境              | 結果                                                                |
| ----------------- | ------------------------------------------------------------------- |
| 正常開站          | 組織 + 管理員 + `user_roles(admin, ["*"])` + `ba_user.orgId` 都正確 |
| 夾帶 demo 資料    | 0 學生、0 班級、0 分校                                              |
| slug 重複         | 中止，原資料未變更                                                  |
| 缺環境變數        | 明確指出缺哪一個，不會寫一半                                        |
| slug 含空白或 `;` | 拒絕（它會出現在網址與匯出檔名）                                    |
