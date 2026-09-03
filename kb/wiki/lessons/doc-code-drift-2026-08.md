---
title: 2026-08 文件與程式碼漂移稽核
summary: 建立 agent harness 時逐項驗證文件宣稱，找出五處與程式碼不符之處。含一個活的 bug（查詢不存在的資料表）與兩個沉默失效的設定。
category: lesson
status: active
updated: 2026-08-19
tags: [lessons, doc-code-drift-2026-08]
---

# 2026-08 文件與程式碼漂移稽核

2026-08-11 建立 agent harness 時，把專案文件的每一項宣稱拿去對程式碼驗證。以下是**已驗證**的
不符之處，全部附 `file:line`。這一頁的價值不只是清單，而是它示範了「沒有 gate 的敘述會漂移到
什麼程度」—— 這正是憲法 c11 的實證基礎。

## 一、活的 bug：查詢不存在的資料表（已於 2026-08 修復）

當時 `apps/api/src/routes/enrollments.ts` 有一處查 `from('attendances')`。

> **2026-08-19 複驗**：全 repo 已無任何 `from('attendances')`，這個 bug 已修。
> 以下保留當時的分析，因為「查一張不存在的表卻沒有人發現」這個機制本身才是教訓。

**這張表在任何 migration 裡都不存在。** 出勤主表是 `attendance_records`（全 repo 12 處使用）。
這行是唯一使用 `attendances` 的地方。

## 二、三個 agent 指引檔描述的是不存在的架構

當時 `CLAUDE.md`（283 行）/ `AGENTS.md`（232 行）/ `GEMINI.md`（189 行）是三份近似副本，
實測漂出 53 行分歧，而分歧的部分描述的是已經不存在的東西：

| 文件宣稱                                                                                | 實際                                                                                |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `AdminShellComponent` / `TeacherShellComponent` / `ParentShellComponent` 三個獨立 shell | 只有一個 `shared/components/layout/shell-layout/ShellLayoutComponent`，三個角色共用 |
| `admin_permissions` 表                                                                  | `user_roles.permissions` jsonb 欄位（`20260208165500_refactor_roles.sql`）          |

→ 直接導致憲法 c10（單一真相）與 harness gate A2。

## 三、Skill 對照表 76% 是假的

`AGENTS.md` 手抄了 17 個 skill 的「情境 → Skill」對照表，實際 `.agents/skills/` 只有 9 個目錄，
**13 個名稱不存在**（`angular-coding`、`angular-signals`、`angular-rxjs-patterns`、
`supabase-schema-from-requirements` 等）。而這張表每個 session 都會載入。

比一般的清單腐化更致命：它會讓 agent 去呼叫不存在的 skill。

→ 直接導致憲法 c11（不得手抄會腐化的清單）與 harness gate A1（改成從磁碟自動生成 + 斷言）。

## 四、兩個沉默失效的設定

- **`apps/api` 有 12 支 `.spec.ts`，但 `project.json` 沒有 `test` target** → 這些測試從來沒有被
  執行過。任何跑 `nx affected -t test` 的閘門對 API 改動都是瞎的。
- **`nx.json` 的 `defaultBase` 是 `dev`，但這個 branch 不存在** → 所有 `nx affected` 都得手動帶
  `--base=main`，否則行為未定義。**（2026-09-03 已修成 `main`。）**

兩者都不會報錯，只會安靜地不做事。

## 五、文件與程式碼各說各話

- **RLS**（2026-08-11 已解決）：文件說「業務表不使用 RLS」，但實際有 **12 張表**開著 RLS。

  查清楚之後結論不是「文件錯」也不是「該關掉」：**沒有任何非 service-role client 存在**
  （web 端沒有 supabase-js、環境沒有 anon key，全部資料走 Hono API 的 service role key，
  而 service role 繞過 RLS），所以 RLS 目前碰不到。9 張表零 policy，另外 3 張
  （`classes`/`schedules`/`sessions`）剩下的 policy 同時依賴 `auth.uid()`（Better Auth 遷移後
  永遠 NULL）與死表 `profiles`，一樣永遠不會 match。

  處置：**保留 RLS 啟用**（零 policy 是 fail-closed，將來接上 anon client 會被全拒而不是全放；
  關掉反而危險），只刪掉那 3 條會誤導人的殭屍 policy
  （`20260811034702_drop_zombie_rls_policies.sql`），並把文件用詞改成準確描述。

- **org_id 來源**（2026-08-11 已解決，而且它不是爭議、是 bug）：舊筆記說「必須用
  `session.user.orgId`」是對的，只是**那個修復從來沒有被套用**。

  真相：寫入端早在 Better Auth 遷移（20260222000001）就整批搬到 `ba_user.orgId` ——
  `staff.ts` 與 `parents.ts` 建帳號後都會 `UPDATE ba_user SET "orgId"`。同一支 migration
  DROP 掉了自動建立 profiles 列的 `handle_new_user()` 觸發器，而且沒有替代品。於是
  `profiles` 成為死表（全 repo 只剩 `seed.sql` 會寫入），但**讀取端 `middleware/auth.ts`
  留在原地**。

  後果：**任何透過 app 建立的員工或家長，每個 API 請求都拿到 `400 NO_ORG`，完全無法使用系統**；
  `staff.ts` 的角色篩選也會讓這些人整批消失。只有 seed 出來的帳號能用 —— 這就是它能潛伏
  近半年沒被發現的原因。

  修法見 `apps/api/src/org-source.spec.ts`（同時是防回歸的守門測試）。

## 可遷移的原則

1. **沒有 gate 的敘述一定會腐化**，而且腐化的速度與它被讀的頻率無關 —— 每個 session 都載入的
   skill 表照樣爛掉 76%。
2. **狀態類清單要嘛自動生成 + 斷言，要嘛改寫成「指向目錄」**，沒有第三條路。
3. **「已修復」的筆記要當成待驗證的宣稱，不是事實。** 修復可能從未套用、可能在重構中被還原、
   可能檔案被搬走。引用前先開檔確認 —— 本頁第五節那個 org_id 就是實例：筆記說已修，實際上
   那行修改從來沒有進入程式碼，而錯誤的那一版又剛好只在 seed 帳號上正常，於是潛伏了近半年。
4. **搬家要搬兩端。** 寫入端換了資料來源、讀取端沒跟上，是本頁兩個最嚴重問題的共同形狀
   （org_id 如此，`attendances` 表也如此）。改資料來源時把 reader 一起 grep 出來。
