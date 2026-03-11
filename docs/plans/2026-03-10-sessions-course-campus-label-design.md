# 課堂管理課程選單分校標註設計

日期：2026-03-10

## 目標

在教務管理的 `課堂管理` 中，桌機篩選列與手機篩選彈窗的「課程」選單，都在每個課程名稱下方補上分校小字，降低跨分校課程名稱相近時的辨識成本。

## 設計決策

採用 `p-multiselect` 的自訂 option template：

- 第一行顯示課程名稱
- 第二行顯示灰色小字分校名稱
- 已選取後的 input 顯示維持原本簡潔樣式，不額外堆疊分校資訊

## 範圍

- 桌機：`session-filters.component`
- 手機：`mobile-filter-dialog.component`

不調整：

- 篩選資料流
- 已選標籤的摘要顯示
- 其他下拉選單的視覺樣式

## 資料來源

課程項目優先使用 `course.campusName`；若 API 回傳未帶值，則 fallback 到目前已載入的 `campuses` 清單，以 `campusId` 反查名稱。

## 搜尋行為

課程 multiselect 的 `filterBy` 擴充為 `name,campusName`，讓使用者可用課程名或分校名搜尋。

## 驗證

- 桌機課程選單每列顯示「課程名 + 分校小字」
- 手機課程選單同樣顯示兩行
- 無 `campusName` 時仍可正確回退顯示
- `sessions` 既有篩選測試不中斷
