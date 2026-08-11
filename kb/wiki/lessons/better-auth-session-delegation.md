---
title: Better Auth 的 session 一律委派官方 API，不要手刻
summary: adminCreateSession 不存在；手寫 ba_session + HMAC cookie 會耦合 BA 內部格式。最終做法是把密碼驗證與 session 建立都交給 signInEmail / signInUsername。
category: lesson
status: active
updated: 2026-08-11
---

# Better Auth 的 session 一律委派官方 API，不要手刻

## 情境

實作統一登入端點 `POST /api/login`（取代舊的 `POST /api/parents/login`）時，原始計畫打算自己
掌控密碼驗證與 session 建立。

## 踩到什麼

1. **`auth.api.adminCreateSession` 不存在。** Better Auth 的 admin plugin 沒有這個方法，計畫寫的
   時候是憑印象假設它存在的。
2. **退而求其次的「手動建 session」更糟**：直接寫 `ba_session` 再自己用 HMAC-SHA256 簽 cookie，
   等於把應用程式綁死在 BA 的內部儲存格式與簽章細節上。BA 一次改版就會無聲壞掉。

## 最終做法

`/api/login` 只做兩件自己該做的事，其餘全部委派：

1. 從 `ba_user` 查帳號（含 `@` → email；否則 phone）
2. 檢查 `staff` / `parents` 狀態，全非 active → `401 ACCOUNT_DISABLED`
3. **密碼驗證 + session 建立完全交給 BA 官方 API**
   - email 用戶 → `auth.api.signInEmail({ email, password, asResponse: true })`
   - phone-only 用戶 → `auth.api.signInUsername({ username: phone, password, asResponse: true })`

現行程式碼：`apps/api/src/index.ts:210-223`。

## Phone-only 用戶的 username 策略

BA 要求 credential 帳號必須有 email **或** username。沒有 email 的家長採用 `username = phone`：
建立時只在沒有 email 的情況下才設（`apps/api/src/routes/parents.ts:366`），登入時走
`signInUsername`。

## 可遷移的原則

- **要擴充登入行為（OTP、magic link、SSO）時，先找 BA 的官方 API，不要碰 `ba_session` 或模擬
  cookie 格式。** 這是憲法 c2 的由來：`ba_*` 表可讀不可寫。
- **不要憑印象假設某個 SDK 方法存在。** 這次的整段彎路起點就是計畫階段寫了一個不存在的方法名。
  寫進計畫前先查型別定義或官方文件。

## 相關

- 憲法 c2（`ba_*` 表由 Better Auth 獨佔寫入）：[`kb/architecture/constitution.md`](../../architecture/constitution.md)
- 原始的實作計畫已隨 `kb/superpowers/` 一併移除（2026-08-11）。需要當時的完整推導過程時從
  git 歷史取回 —— 注意**要用舊路徑 `doc/superpowers/`**，該目錄是在刪除的同一批改動裡才更名為
  `kb/` 的，所以新路徑查不到歷史：

  ```bash
  git log --oneline --all --full-history -- 'doc/superpowers/plans/2026-03-17-unified-login.md'
  git show <sha>:doc/superpowers/plans/2026-03-17-unified-login.md
  ```
