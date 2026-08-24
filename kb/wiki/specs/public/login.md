---
title: 登入頁
summary: 使用者輸入帳號密碼登入系統。
category: spec
status: active
updated: 2026-08-24
tags: [specs, public, login]
---

# 登入頁

**路徑**: `/login`
**角色**: 無需登入

## 核心目的

使用者輸入帳號密碼登入系統。

## MVP 功能

- 登入方式切換：**Email** / **手機號碼** 兩個 Tab（滑動 pill 指示器動畫），切換後 input 類型與 placeholder 對應改變
  - Email Tab：`type="email"`，placeholder「Email」
  - 手機 Tab：`type="tel"`，placeholder「手機號碼（09xxxxxxxx）」
- 密碼輸入與顯示/隱藏切換
- 忘記密碼連結（⚠️ 尚未完整實作，見下方 Backlog）
- 錯誤訊息提示。**三種**：「帳號或密碼錯誤」與「帳號已停用」——
  帳號不存在與密碼錯誤刻意共用同一則訊息，**不洩漏某個 email／手機有沒有註冊**
  （另有第三種：登入成功但讀不到帳號資料，見 `auth.service.ts` 的 `signIn`）
- 登入成功後依角色導向對應首頁

## 登入端點

統一登入端點：`POST /api/login`

- `account`：Email 或手機號碼或 username
- `loginType`：`'email' | 'phone' | 'username'` —— **由前端決定並送出**，
  後端據此查對應欄位，**不做 `@` 判斷**
- `password`：密碼
- 後端查 `ba_user` 後，委派 Better Auth `signInEmail` / `signInUsername` 完成驗證與 session 建立
- 停用/封存帳號回傳 `ACCOUNT_DISABLED`（HTTP 401）

## Backlog

### 忘記密碼完整實作（獨立 branch）

功能目前前端流程已完成，但 email 實際上不會送出。完整實作需要：

1. **Resend** 串接（寄信服務，免費方案 100 封/天，成長後升級 Pro $20/月）
2. **per-email 冷卻時間**（Cloudflare KV，同一 email 15 分鐘內只能發一封）
3. **Turnstile 完全未接**——widget 只在前端渲染，token **從未送到後端**
   （`auth.service.ts` 的參數是 `_captchaToken`，底線即未使用），`/api/login` 的
   request body 也沒有 captcha 欄位。落差比「有收但未驗證」大得多
4. 以上三項需一起實作，不建議分批補

## 資料依賴

| 操作 | 資料表                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------- |
| 讀取 | `/api/login` 讀 `ba_user`, `staff`, `parents`；登入成功後的 `GET /api/me` 另外讀 `profiles`, `user_roles` |

## PRD 參考

- 7.1 公開頁面

## 相關頁面

- `/forgot-password` - 忘記密碼
- `/reset-password` - 重設密碼
