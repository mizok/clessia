---
title: Better Auth 的「本人模型」與我們的多角色授權是兩套東西
summary: 使用者更新 API 只服務「本人改自己」；「管理員代改」屬 admin plugin，而它要求角色真相住在 ba_user.role——跟本專案「角色住 user_roles、一人多角色、權限存 jsonb」不相容。想接 admin plugin 之前先讀這頁。
category: architecture
status: active
updated: 2026-09-03
tags: [architecture, auth, better-auth, authorization]
---

# Better Auth 的「本人模型」與我們的多角色授權是兩套東西

**要動 `ba_user` 的寫入路徑、或想「順手把 admin plugin 接起來」之前，先讀這頁。**

這不是「我們還沒做完」的待辦，是**兩個模型不相容**的結構事實。搞錯這件事的代價是
在 c2（`ba_*` 不得寫入）上開一個比它守護的東西更大的洞。

## 一句話

> Better Auth 的使用者更新 API 是給**本人**用的。
> 「管理員代改別人」在它的模型裡屬於 admin plugin，而 admin plugin 要求
> **角色真相住在 `ba_user.role`**。

## 三條路各自的邊界

| 想做的事 | 走得通嗎 | 卡在哪 |
| --- | --- | --- |
| **本人改自己**的宣告過欄位（`phone`） | ✅ `auth.api.updateUser` | 需要**本人的** session headers；欄位要是宣告過的 additionalField 且 `input: true` |
| 本人改自己的 `email` | ❌ | `api/routes/update-user.mjs` 明著擋：`if (body.email) throw … EMAIL_CAN_NOT_BE_UPDATED`。合法路徑是 `changeEmail`，而它的三個前置本專案一個都不成立（見 [[architecture/constitution-enforcement]]） |
| 本人改自己的**未宣告**欄位（`username`） | ⚠️ **靜默丟棄** | `db/schema.mjs` 的 `parseInputData` 迭代的是**宣告過的 schema**（`for (const key in fields)`）——未宣告的 key 連看都不看：**不報錯、不寫入、沒有任何跡象** |
| **管理員改別人** | ❌ | `updateUser` 掛 `sessionMiddleware`，要的是**被改者**的 session；管理員手上只有自己的 |
| 管理員改別人（走 admin plugin） | ❌ | `adminUpdateUser` 的權限檢查看 **`ba_user.role`**（`has-permission.mjs`：`role: ctx.context.session.user.role`，要求 `user: ['update']`）。**本專案每一個 `ba_user.role` 都是 `'user'`** —— 每次呼叫都是 403 `YOU_ARE_NOT_ALLOWED_TO_UPDATE_USERS` |

## 為什麼不能「把管理員寫進 `ba_user.role` 就好」

這是最直覺、也最該擋下來的提案。三個理由，任一個都足夠：

1. **那本身就是 c2 寫入。** 為了讓某處合規而在另一處違規，帳是負的。
2. **它一併授予 impersonate / ban / setRole。** admin plugin 的 `admin` 角色不是一個
   標籤，是一組能力 —— 包含**冒用他人身分登入**。為了讓「改別人的電話」合規而打開
   那個能力面，**代價遠大於它守護的東西**。
3. **角色真相會有兩份。** 本專案的角色住在 `user_roles`（junction table，**一人可多角色**，
   細部權限存 `permissions` jsonb）。`ba_user.role` 是單一字串。兩份真相遲早不一致，
   而不一致的那一刻沒有人會發現 —— 直到有人用其中一份做了授權判斷。

同理，**`adminUserIds` 設定清單也不行**：那是把「誰是管理員」從執行期會變的資料
複製到部署時的設定檔。

## 結論：管理員代改「必須」直寫，而那是永久豁免

`routes/parents.ts`、`routes/staff.ts` 的直寫**不是債**。它們在
[[architecture/constitution-enforcement]] 的 A15 帳本裡是 `exempt` 而不是 `allowlist` ——
分野的意思是「沒有合規路徑可走」而不是「該修還沒排到」。

> **c2 的 allowlist 在 2026-09-03 歸零。** 剩下的五筆全部是有名有姓的永久豁免。
> 空的 allowlist 代表「沒有欠著沒做的事」，而不是「有五筆假裝不存在」。

## 這頁真正要防的失敗模式

**「合法的 API 不是做同樣的事，是做它允許的事，其餘的靜默忽略。」**

所以要把直寫換成 API 呼叫時，先把每一個欄位分成三堆：

| 堆 | 徵狀 |
| --- | --- |
| **可以走** | 宣告過的 additionalField、`input: true` |
| **會被拒** | `email`、`input: false` 的欄位（如 `orgId`）—— 至少會炸，看得見 |
| **會被靜默丟棄** | 未宣告的欄位（如 `username`）—— **唯一沒有錯誤訊號的一堆** |

第三堆是遷移後會靜靜壞掉的那一堆。`username` 就在裡面，而它是無 email 家長的
唯一性鍵（`parents.ts` 有 4 處 `buildPostgrestEq('username', phone)` 靠它做匯入的
重複偵測）—— 換掉之後不報錯、不寫入，症狀要等到有人做家長匯入、撞到重複偵測失準
才浮現。

## 相關

- [[architecture/constitution-enforcement]] —— A15 的帳本與五筆豁免的 `why`
- [[architecture/line-oauth-login]] —— 為什麼 LINE 使用者的 `emailVerified` 是刻意標成 true
- [[architecture/role-authorization]] —— 本專案的角色與權限住在哪
