# 課堂管理班級多選設計

日期：2026-03-10

## 目標

將教務管理 `課堂管理` 的班級篩選從單選改為多選，桌機與手機一致支援，且可透過 URL 保留目前視角。

## 設計決策

- 前端狀態由 `selectedClassId` 升級為 `selectedClassIds`
- URL 寫入 `classIds=a,b,c`
- URL 讀取時優先吃 `classIds`，若只有舊 `classId`，則自動轉為單元素陣列
- 後端 API 本次不擴充 `classIds`
  - 若只選 1 個班級，仍送單一 `classId` 到 API
  - 若選多個班級，先取回目前其他條件下的課堂，再於前端做班級集合過濾

## 範圍

- `sessions.page`
- `session-filters.component`
- `mobile-filter-dialog.component`
- `sessions.page.spec.ts`

## 不調整

- 既有 `/api/sessions` query schema
- 其他篩選條件的資料流

## 驗證

- 桌機班級改為可複選
- 手機班級改為可複選
- URL 會寫入 `classIds`
- 舊 `classId` 深連結仍可讀取
