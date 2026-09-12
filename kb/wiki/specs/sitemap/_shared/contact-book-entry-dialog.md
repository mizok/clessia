---
title: 聯絡簿編輯對話框（子頁面，2 頁共用）
summary: ContactBookEntryDialogComponent 的 UI 地圖：管理端與老師端各開一次，而兩邊傳的 data 形狀不同。
category: spec
status: developing
tags: [sitemap, _shared, admin, teacher]
created: 2026-09-12
updated: 2026-09-13
---

# 聯絡簿編輯對話框（子頁面）

`ContactBookEntryDialogComponent`（`shared/components/contact-book-entry-dialog/`）。

## 兩個開啟點，兩種 `data` 形狀

| 開啟點                                      | 路由                                     | 傳進去的 `data`                                | 寬度    |
| ------------------------------------------- | ---------------------------------------- | ---------------------------------------------- | ------- |
| `admin/contact-book` 的列（編輯既有）       | `/admin/contact-book`（`loadComponent`） | `{ entry }`                                    | `560px` |
| `admin/contact-book` 的 `補寫`（新寫）      | 同上                                     | `{ …缺漏那筆的學生與日期 }`                    | `560px` |
| `teacher/schedule` 的 `contact-book-roster` | `/teacher/schedule`（`loadComponent`）   | `existing`（**直接傳那一筆，不是包在物件裡**） | `480px` |

> ⚠️ **兩邊的寬度與 `data` 形狀都不同。** 老師端傳的是 `existing` 本身、管理端傳
> `{ entry }` —— 讀單一頁的地圖會以為它永遠一樣。這跟
> [[specs/sitemap/_shared/student-form-dialog]] 是同一個形狀。

**兩個開啟點都逐筆回 `app.routes.ts` 確認過是 `loadComponent` 不是 `redirectTo`。**

> 📌 驗這件事的時候我先 grep 到 `app.routes.ts:366` —— **那一行是
> `TEACHER_DASHBOARD` redirect _到_ schedule，不是 schedule 本身**，
> 差點得出「老師端那條是死的」。真正的路由在 `:378-382`。
> **grep 命中要看清楚是哪一筆，這是 #698 那條的第二個實例。**

## 畫面（管理端，實測）

- **標題**：學生姓名 + 第二行 `YYYY-MM-DD · 最後由 <姓名> 編輯`
- 簽收狀態徽章：`未簽收` / `已簽收`
- `內容` 多行輸入，佔位字 `今天的上課狀況…`
- 說明文：「每生每日一則，不分科目。**共同編輯會直接覆寫並記下最後編輯者。**」
- 底部：`取消` ／ `儲存`

## 互動元素

| 元素   | 類型     | 出現條件 | 按了之後                                            |
| ------ | -------- | -------- | --------------------------------------------------- |
| `內容` | 多行輸入 | 永遠     | —                                                   |
| `取消` | 按鈕     | 永遠     | 關閉，不回傳                                        |
| `儲存` | 按鈕     | 永遠     | **剛開啟時 `disabled`**（內容未改動）；按下去會寫入 |

## 驗證紀錄

- **狀態**：已驗（管理端「編輯既有」那一條路徑）
- **前端版本**：`650d257a`，自架 `:4210`
- **未驗，附原因**：
  - 管理端的 `補寫`（新寫）路徑 —— 展示資料在「今天」沒有缺漏，摸不到那顆按鈕
  - **老師端那條整條** —— 不在本批次（`ADMIN_STUDENT_AFFAIRS`）範圍內，
    `data` 形狀差異是**讀原始碼確認的，畫面未實測**
  - `儲存` —— 會寫入

## 390px

- **量測**：390 × 844 與 1504 × 752（對話框只記「版面怎麼變」，不重抄元素表）
- **前端**：主 checkout 的 dev server（port 4200），`543e5eda`
- **手段**：同源 iframe 當 viewport；**開啟一律用 `element.click()`（合成事件，坑 6 的等級標記）**，
  關閉後用輪詢斷言消失（坑 9），疊層時比對**數量**不是 `=== null`

### ⚠️ 未驗 —— 兩個開啟點的資料狀態都開不到

**本輪沒有量到這一支。** 照方法頁坑 8「量不到就寫進未驗清單，不要讓計數收斂在錯的數字上」。

| 開啟點 | 為什麼開不到 |
| --- | --- |
| `admin/contact-book` 的列／`補寫` | **那一頁在預設期間是空的** —— 畫面逐字：`這天該寫的都寫了` / `這段期間沒有聯絡簿`，可見按鈕只有 `只看未簽收` 與 `更多`，**一顆可開的列都沒有** |
| `teacher/schedule` 的 `寫聯絡簿` | **本輪的老師這一週沒有這顆按鈕** —— `teacher0026` 9/7–9/13 兩堂課，DOM 全部按鈕只有 `開始點名` / `寫日誌` / 前後週鍵 / 7 顆週條（`有沒有寫聯絡簿: false`） |

### 資料查過了，不是「本機沒有」

```sql
select count(*), min(entry_date), max(entry_date) from contact_book_entries;
-- 6 筆，2026-08-28 ~ 2026-08-29
```

**本機有 6 筆，但都在兩週前**，而 `/admin/contact-book` 的期間篩選是
`p-datepicker` 的 range 模式、**不吃網址參數**（`contact-book.page.ts` 沒有 `ActivatedRoute`，
日期只活在元件狀態裡）。

用 `window.ng.getComponent()` 直接改元件狀態試過一次，**沒有成功**
（`dateRange` 在那個實例上是 `undefined`，不是 signal 也不是陣列）——**沒有繼續硬鑽**。

### 下一個人怎麼量

1. **最省事**：把日期範圍手動選到 **2026-08-28 ~ 08-29**（390 下篩選收在「更多」裡），
   那一段有 6 筆聯絡簿，列就會出現
2. 或者換一個**那一週有帶班**的老師帳號走 `teacher/schedule` 那條路
3. ⚠️ **兩個開啟點的寬度與 `data` 形狀本來就不同**（管理端 `560px` + `{ entry }`，
   老師端 `480px` + `existing` 本身）——**量了一個不能推論另一個**，Phase 1 已經記過這件事
