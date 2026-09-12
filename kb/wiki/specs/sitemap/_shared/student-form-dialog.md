---
title: 學生表單對話框（子頁面，3 頁共用）
summary: StudentFormDialogComponent 的 UI 地圖：新增與編輯共用一支，而三個開啟點傳的 data 不同、欄位也不同。
category: spec
status: developing
tags: [sitemap, _shared, admin]
created: 2026-09-12
updated: 2026-09-12
---

# 學生表單對話框（子頁面）

`StudentFormDialogComponent`（`features/admin/pages/students/student-form-dialog.component.*`）。

## ⚠️ 同一支對話框，三個開啟點，能力不同

**這是改版最容易踩到的一點**：讀單一頁面的地圖會以為它永遠長一樣。

| 開啟點                             | 傳進去的 `data`                    | 模式 | 家長欄 |
| ---------------------------------- | ---------------------------------- | ---- | ------ |
| `/admin/students` 的「新增學生」   | `{ student: null }`                | 新增 | **有** |
| `/admin/students` 列選單的「編輯」 | `{ student }`                      | 編輯 | 無     |
| `/admin/parents` 的「新增學生」    | `{ student: null, parentId: ... }` | 新增 | **無** |
| `/admin/students/:id` 的「編輯」   | `{ student: s }`                   | 編輯 | 無     |

條件逐字是 `showParentPicker = isCreateMode() && !presetParentId`
（`student-form-dialog.component.ts:67`）—— 從家長頁建立時那個學生**必然**綁到該家長，
所以選擇器沒有意義；從學生頁建立時留空則是「無家長學生」。

**三個開啟點都確認過是真路由**（`app.routes.ts` 都是 `loadComponent`，不是 `redirectTo`）。

## 畫面區塊

無標準 dialog header（`showHeader: false`），標題在內容區自己畫，右上角一顆 `×`。
寬度 `560px`，modal。

- **標題**：`isCreateMode() ? '新增學生' : '編輯學生資料'`
- **表單**：單欄，欄位見下表
- **底部動作列**：`取消` ／ `建立學生`（新增）或 `儲存`（編輯）

## 互動元素

| 元素（畫面上的字）                                           | 類型     | 出現條件                                   | 按了之後                                            |
| ------------------------------------------------------------ | -------- | ------------------------------------------ | --------------------------------------------------- |
| `×`（右上）                                                  | 圖示鈕   | 永遠                                       | `cancel()` —— 關閉，不回傳                          |
| `姓名*`／`請輸入學生姓名`                                    | 文字輸入 | 永遠                                       | 必填之一                                            |
| `家長（選填）`／`輸入姓名搜尋既有家長，留空即建立無家長學生` | 自動完成 | **僅 `isCreateMode() && !presetParentId`** | 搜尋既有家長                                        |
| `年級*`／`選擇年級`                                          | 下拉     | 永遠                                       | 必填之一                                            |
| `就讀學校*`／`選擇或搜尋學校`                                | 下拉     | 永遠                                       | 必填之一；可就地新建（見下）                        |
| `建立` ／ `取消`（學校）                                     | 按鈕     | **僅 `creatingSchool()`**                  | `建立` 在 `!newSchoolName().trim()` 時 **disabled** |
| `生日`／`選擇生日`                                           | 日期     | 永遠                                       | 開日曆浮層                                          |
| `性別`／`選擇性別`                                           | 下拉     | 永遠                                       | —                                                   |
| `學生電話`／`0912-345-678`                                   | 電話     | 永遠                                       | —                                                   |
| `學生 Email`／`student@example.com`                          | Email    | 永遠                                       | —                                                   |
| `居住地址`／`完整居住地址`                                   | 文字     | 永遠                                       | —                                                   |
| `緊急聯絡人姓名`／`緊急聯絡人`                               | 文字     | 永遠                                       | —                                                   |
| `緊急聯絡人電話`／`緊急聯絡電話`                             | 電話     | 永遠                                       | —                                                   |
| `備註`／`特殊需求、注意事項...`                              | 多行文字 | 永遠                                       | —                                                   |
| `取消`                                                       | 按鈕     | 永遠（`loading()` 時 disabled）            | 關閉，不回傳                                        |
| `建立學生` ／ `儲存`                                         | 按鈕     | 永遠                                       | **`[disabled]="!isFormValid()"`**，見下             |

### 送出鍵的 disabled 條件

`isFormValid = name.trim() && grade && schoolId`（`component.ts:98-101`）——
**逐字對應表單上三個帶 `*` 的欄位**。

**實測**：新增模式剛打開時 `建立學生` 是 **disabled**（三個必填都空）；
編輯模式打開時 `儲存` 是 **enabled**（既有資料已填滿）。

> **「按了沒反應」跟「壞掉」長得一樣** —— 這顆鈕是那一族的標準例子。

## 狀態

`loading()` 為真時**所有輸入與取消鍵都 disabled**，送出鍵轉成 spinner 圖示。
**未驗** —— 那需要送出一次寫入，而地圖驗證不做寫入。

## 驗證紀錄

- **狀態**：已驗（新增與編輯兩種模式）
- **前端版本**：`650d257a`（自架 `:4210`，非 `:4200` —— 後者服的是主 checkout）
- **做法**：從 `/admin/students` 分別開新增與編輯，DOM + visible 濾網取元素，取消關閉後
  斷言 `.p-dialog === null`
- **先預測再實測**：依 `showParentPicker` 的條件預測「編輯模式應該少一欄（家長）、
  標題是編輯學生資料、送出鍵是儲存」—— 實測 11 欄（新增 12 欄）、逐項命中
- **未驗**：`creatingSchool()` 的就地新建學校分支（會寫入）、`loading()` 狀態、
  從 `/admin/parents` 與 `/admin/students/:id` 開啟的那兩條路徑
  （條件已從原始碼確認，畫面未實測）
