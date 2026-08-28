---
title: 登入頁
summary: 一顆「使用 LINE 登入」按鈕。這個系統沒有密碼——首次進入靠管理員發出的一次性連結，綁定 LINE 之後才走這一頁。
category: spec
status: active
updated: 2026-08-28
tags: [specs, public, login, oauth, line]
---

# 登入頁

> 2026-08-28 重寫。先前這一頁規格化的是帳號密碼登入、忘記密碼、Turnstile ——
> 那整套在 PR #24 被移除，**沒有一條還成立**。原因見
> [[architecture/line-oauth-login]]：密碼雜湊超過 Cloudflare Workers 的 10ms CPU 上限，
> 登入間歇性 503，而任何安全的雜湊都會超過。

## 核心目的

讓已經被登記在系統裡的人進來。**不負責讓人加入系統** —— 那是報名流程的事。

## 畫面

只有三個東西：

1. 標題「登入」
2. **一顆「使用 LINE 登入」按鈕**（進行中會鎖住並顯示「前往 LINE...」）
3. 一句提示：「第一次使用？請向補習班索取專屬連結，點開後即可綁定 LINE。」

沒有輸入欄位、沒有密碼、沒有記住我、沒有忘記密碼、沒有 `?role=root` 隱藏入口。

## 錯誤訊息

OAuth 的失敗**不是函式回傳值** —— 使用者被導去 LINE、再被導回來，錯誤寫在網址上
（`?error=`）。`oauth-error.ts` 把它翻成三種：

| `?error=`         | 顯示                                                                     | 額外                                     |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------------- |
| `signup_disabled` | 「這個 LINE 帳號還沒有被登記。如果你已經報名，請向補習班索取專屬連結。」 | **露出「還沒報名？前往報名」連結**       |
| `access_denied`   | 「已取消 LINE 登入。」                                                   | 使用者自己在 LINE 按取消，語氣中性不嚇人 |
| 其他              | 「LINE 登入沒有完成，請稍後再試。」                                      | —                                        |

第一種是**招生宣傳連過來的家長**會撞到的。他不是「稍後再試」就會成功 ——
他根本還不是客戶，所以訊息要指向報名，不是重試。

## 進得來的人是怎麼進來的

```text
櫃檯／管理端建立帳號  →  畫面出現一次性登入連結的 QR
   ↓
對方掃碼  →  直接登入  →  落在 /link-line
   ↓
按「綁定 LINE 帳號」
   ↓
之後才走這一頁的按鈕
```

管理端隨時可以重發連結（人員頁與家長頁的「產生登入連結」）。
供應商的破窗管道是 `npm run login-link`，見 [[architecture/line-oauth-login]]。

## 資料依賴

登入本身**不碰任何業務表** —— Better Auth 自己處理 `ba_user` / `ba_account` /
`ba_session` / `ba_verification`。

登入成功後前端呼叫 `GET /api/me`，那支讀 `profiles`、`user_roles`、`staff`、`ba_user`。
`authMiddleware` 另外讀 `staff` / `parents` 的 `status` 判斷帳號有沒有被停用。

## 相關頁面

- [[architecture/line-oauth-login]] —— 為什麼沒有密碼、破窗怎麼做
- `/link-line` —— 綁定畫面（一次性連結兌換後的落點）
- `/select-role` —— 多重角色時的分流
