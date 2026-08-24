---
title: 行號引用會腐爛，符號不會
summary: 第一次 drift 稽核發現 KB 裡 13 條 file:line 引用有 5 條指錯位置——不是內容錯，是每支 PR 都在推移行號。
category: lessons
tags: [lessons, kb, drift, citation]
status: active
updated: 2026-08-19
---

# 行號引用會腐爛，符號不會

## 發現

第一次跑 `/kb-wiki verify` 時，抽查 KB 裡所有 `file.ts:NNN` 形式的引用：

| 引用                                            | 實際位置 |
| ----------------------------------------------- | -------- |
| `enrollments.ts:777`（衝堂 409）                | 547      |
| `enrollments.ts:1082`（batch-match 的學校比對） | 1118     |
| `enrollments.ts:688`（退班寫 effective_to）     | 708      |
| `enrollments.ts:289`（請假同步）                | 281      |
| `attendance.ts:579`（課堂名單閘門）             | 580      |

**內容全部還在，位置全部跑掉。** 這些頁面是同一個工作階段寫的，而同一階段後續的
PR（角色授權、公告、RLS）在同一批檔案上下插了行。

## 為什麼這比看起來嚴重

行號引用是**設計文件用來證明主張的證據**。「`effective_from` 是課堂名單的閘門
（`attendance.ts:579`）」這句話的說服力來自那個行號可以被驗證。當它指向別的東西：

- 讀的人跳過去看到不相干的程式碼，會懷疑整份文件
- 更糟的是**它仍然「看起來對」** —— 行號在檔案範圍內，只有真的跳過去看才知道錯

驗證腳本只檢查「行號有沒有超出檔案長度」會全部放行。**範圍內不代表指對東西。**

## 現在的寫法

改引用**穩定的符號**：

| 原本                                                | 改成                                            |
| --------------------------------------------------- | ----------------------------------------------- |
| `enrollments.ts:688`                                | `enrollments.ts` 的 `PATCH /:id/status` handler |
| `apps/api/src/routes/enrollments/validation.ts:128` | `checkEnrollmentPreconditions()` 的人數上限判斷 |
| `enrollments.ts:289`                                | `syncLeaveAttendanceForEnrollment()`            |

函式名與路由路徑會跟著改名一起被 grep 到，行號不會。

## 兩個例外：保留行號

- **`lessons/` 裡引用的 grep 輸出** —— 那是「當時什麼誤導了我」的證據
  （見 [[lessons/menu-entry-without-a-route]]），改掉會毀掉教訓本身
- 一次性的歷史紀錄，明確標注了時間點的

判準是：**這個行號是在主張現況，還是在保存當時的觀察？** 前者要維護，後者不要動。

## 帶得走的

- 引用要挑**跟著內容一起移動**的錨點。行號是位置，符號是身分。
- 稽核腳本本身要被懷疑。這次檢查器有兩個誤判（正則沒含大寫、同名檔案挑錯），
  兩次都差點讓我下錯結論 —— 見 [[lessons/rls-backstop-drift]] 的同類教訓。
