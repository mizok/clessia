---
title: 表格破版用 responsive-table 解,不用 scroll
summary: 使用者裁定的表格慣例:手機下表格撐破版面的正解是遷移到 app-responsive-table(欄位收合進 detail row),橫向捲動容器只是止血不是解法。
category: patterns
tags: [patterns, responsive-table, mobile, tables]
status: active
updated: 2026-09-03
---

# 表格破版用 responsive-table 解,不用 scroll

**使用者 2026-09-03 裁定**:手機寬度下表格撐破版面時,**正解是遷移到
`shared/components/responsive-table`**(`appRtColDef` 依 priority 收合欄位進
detail row,身分欄 `collapsible=false` 保留)—— 而不是包一層 `overflow-x: auto`
讓使用者橫向捲。

## 為什麼 scroll 不是解

- 橫向捲動在手機上是**盲捲**:看不到的欄位不存在於使用者的認知裡,
  「捲得到」不等於「用得到」(至高原則:最佳操作體驗,不是版面不壞就好)
- 它把「哪些欄位重要」的設計判斷丟給使用者的手指
- 專案已有正確的元件與先例(營收報表 #117 就是 responsive-table,
  並修過「身分欄不可收合」的教訓)

## 什麼時候 overflow 容器仍然正確

- **列印版面**(`print-doc__table`)—— 紙張本來就是固定寬
- 真正的大數據網格(如成績批次編輯)在**桌機**上的兜底 —— 但手機版仍應收合
- 作為**遷移前的臨時止血**可以,但要開單追遷移,不能當終態

## 遷移要點(從 #117 的教訓)

- 身分欄(誰的列)`collapsible=false` —— 否則手機上剩一排無名數字
- 同 priority 的欄位誰留下不能靠 DOM 順序,要明確指定
- 手機上留下的欄位選「可行動的那個」,不是「第一個」
