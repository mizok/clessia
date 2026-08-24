---
title: 修憲的機制
summary: 憲法只能由人修改，agent 被三層 deny 規則擋住。`tools/amend-constitution.mjs` 是給人用的便利工具，不是護欄——護欄留在 harness 層。
category: architecture
tags: [architecture, constitution, guardrail]
status: active
updated: 2026-08-23
---

# 修憲的機制

## 為什麼 agent 不能修憲

三層真相是**憲法 ▸ 程式碼 ▸ 描述性文件**。agent 能改程式碼與文件，但改法會讓
「約束」變成「建議」——被約束的一方能修改約束，那就不是約束。

## 兩條 deny

`.claude/settings.json`：

| 規則 | 擋住什麼 |
| --- | --- |
| `Edit(kb/wiki/architecture/constitution.md)` | 直接編輯憲法 |
| `Edit(.worktrees/**/kb/wiki/architecture/constitution.md)` | 繞道 worktree |

**這兩條擋的是 `Edit` 工具，不是所有寫入途徑。** 一支用 Bash 執行的腳本繞得過去 ——
這是已知的、刻意接受的缺口：真正的界線是「人有沒有決定要修法」，而不是技術上封死每條路。

曾經有一支互動式的修憲工具（`tools/amend-constitution.mjs`），連同為它而設的
三條 deny 規則，在 2026-08 一起移除。**它是過度建造**：使用者要的是一支一次性腳本，
我做成了帶護欄、gate 與文件的工具產品。修憲一年發生幾次，不值得一個常設工具；
而那支工具的 deny 規則寬到連 `ls` 那個檔名都會被擋。

需要修憲時：寫一支拋棄式腳本，跑完刪掉。

## deny 規則本身會腐爛

規則是**路徑字串比對**。2026-08 把憲法從 `kb/architecture/` 搬到 `kb/wiki/architecture/` 時，
如果忘了同步更新 deny 規則，護欄會**靜默失效**——沒有任何測試會發現，直到有人改了不該改的東西。

那次是運氣好記得更新。所以現在有 **harness gate A9**：斷言每條指向具體路徑的 deny 規則，
它的目標檔案真的存在。

這跟 [[lessons/status-table-blind-spot]]、[[lessons/rls-backstop-drift]] 是同一個形狀：
**沉默的失效不會來找你。**
