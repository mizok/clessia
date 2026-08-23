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

## 三層 deny

`.claude/settings.json`：

| 規則 | 擋住什麼 |
| --- | --- |
| `Edit(kb/wiki/architecture/constitution.md)` | 直接編輯憲法 |
| `Edit(.worktrees/**/kb/wiki/architecture/constitution.md)` | 繞道 worktree |
| `Bash(*amend-constitution*)` | 用腳本繞過 Edit |
| `Edit(tools/amend-constitution.mjs)` | 改掉腳本自己的 TTY 檢查 |

**第三、四條缺一不可。** 只擋 `Edit` 的話，任何一支寫檔腳本都能繞過去——腳本走 Bash 不走 Edit。
只擋執行不擋編輯的話，agent 可以先把 TTY 檢查刪掉再請人執行。

## 那支腳本不是護欄

`tools/amend-constitution.mjs` 有三個限制：只新增不改既有條文、要求 TTY、寫入後跑 harness。

但**腳本無法分辨呼叫者是人還是 agent**。TTY 檢查只擋非互動執行，擋不住「改掉檢查再跑」。
所以它的安全性完全來自上面那張表，不是來自它自己的邏輯。

> **給未來的 agent（包括我）**：如果你發現自己在想「把這個檢查拿掉就能完成任務」，
> 那就是這道護欄正在生效。停下來問人。

## deny 規則本身會腐爛

規則是**路徑字串比對**。2026-08 把憲法從 `kb/architecture/` 搬到 `kb/wiki/architecture/` 時，
如果忘了同步更新 deny 規則，護欄會**靜默失效**——沒有任何測試會發現，直到有人改了不該改的東西。

那次是運氣好記得更新。所以現在有 **harness gate A9**：斷言每條指向具體路徑的 deny 規則，
它的目標檔案真的存在。

這跟 [[lessons/status-table-blind-spot]]、[[lessons/rls-backstop-drift]] 是同一個形狀：
**沉默的失效不會來找你。**
