---
title: 十個檔案的載入態跳版問題 —— 統一做法
summary: #508——#426 掃到但根因不同的 10 個檔案，逐檔分類後發現「整塊被文字取代」與「沒有骨架尺寸／會跳版」在這批檔案裡是同一件事，分三類統一做法，全部重用既有 .p-skeleton／.skeleton-list，不新增第三種配方。
category: architecture
status: proposed
updated: 2026-09-06
---

# 十個檔案的載入態跳版問題

## 背景

#426 掃過全站 18 個含「載入中」文字的檔案，只有 dashboard 的兩處數值卡是「三態被渲染成
同一形狀」的病，已由 #497 修好。另外 10 個檔案當時標出來但沒處理——這份文件是 #508 的
STOP-gate 設計提案，處理那 10 個檔案。

## 掃描結論：病 1 跟病 2/3 在這批檔案裡是同一件事

issue 原本假設三種病可能獨立出現，但逐檔查過對應的 `.scss` 後，**這 10 個檔案沒有一個的
`載入中` 容器有 `min-height`/`height`**——只要是「整塊被單行文字取代」，跳版必然發生
（那行文字的高度遠小於真實內容）。所以不必分開列，直接按「最終內容的形狀」分三類提做法。

**沒有找到任何一個檔案是刻意的**（例如浮動高度、下方沒有內容被推擠）——10 個全部要修。

## 分類與統一做法

### 類別 A —— 標準垂直列表（7 個檔案）

`enrollments.page.html:34`、`changes.component.html:36`、`notifications.component.html:68`、
`contact-book.page.html:27`、`announcement-inbox.component.html:19`、
`students.page.html:25`（teacher）、`contact-book-roster.component.html:8`。

最終內容都是 `<ul>` 列表（標題/姓名 + meta + 偶爾一顆按鈕）。**直接重用全站既有的
`.skeleton-list`/`.skeleton-bar`**（`styles.scss:1156-1180`，`dashboard.component.html:287-291`
已經在用同一組類別）——不寫任何新 CSS，只把每一檔的

```html
@if (loading()) {
<p class="X__state">載入中…</p>
}
```

換成

```html
@if (loading()) {
<div class="skeleton-list" [attr.aria-label]="'X載入中'">
  @for (i of [1, 2, 3]; track i) {
  <span class="skeleton-bar"></span>
  }
</div>
}
```

`students.page.html` 比其他 6 個多一層分組標題（班名），骨架多加一條
`skeleton-bar--label`（既有修飾詞，40% 寬、0.6 透明度）模擬標題列，其餘列表項用一般
`skeleton-bar`。

### 類別 B —— 固定值方塊 + 列表混合（1 個檔案）

`teaching-log-dialog.component.html:13-31`。載入完成後是「兩個統計方塊（`小時`/`堂`，
`--metric-value` 1.75rem/600）+ 條件式 tag + 底下一張 `app-responsive-table`」——不是單純列表，
套類別 A 的形狀不對。

做法：兩個統計值各用一個局部（元件自己的 `.scss`，不進全站共用）`&__metric-skeleton`
element，`display:inline-block` + `.p-skeleton`，寬高卡 `1.75rem` 字級（跟 #497 的
`.dashboard__value-skeleton` 同一份 recipe，但**不共用那個 class**——它是 `dashboard`
block 自己的 element，跨元件借用會被 Angular 的 view encapsulation 擋掉，而且兩邊的尺寸
本來就不同，共用一個參數化 utility 換不到什麼，徒增一層抽象）。底下的表格部分重用類別 A
的 `.skeleton-list`。

### 類別 C —— 各自形狀的固定容器（2 個檔案）

- `class-log-sheet.component.html:16`：最終內容是一個 `rows="4"` 的 `<textarea>`。骨架用
  一塊局部 `&__field-skeleton`（`.p-skeleton` + 高度卡住 textarea 實際渲染高度，實作時
  現場量測，不用猜的數字）。
- `schedule.page.html:39`：最終內容是橫向、固定 7 格的週條（`schedule-page__weekbar-days`，
  每格「星期＋日期＋堂數狀態點」）。骨架用 7 個局部 `&__weekbar-skeleton` 方塊橫向排列，
  寬高卡住 `.schedule-page__weekbar-day` 實際尺寸。

  **這一檔範圍比其他 9 支大，需要額外小心**：`loading()` 目前同時控制 band 裡的
  `app-band-anchor`（`schedule.page.html:23`）、週條（`:58`）、以及下面的 `#track`
  水平軌道——三塊一起被 `@if` 藏起來，只有 `<p>載入中…</p>` 一行代表全部。這支的骨架
  除了週條本身，band-anchor 那個數字錨點在載入中要不要也給骨架（目前 `@if (!loading())`
  直接不渲染，不是文字問題）是另一個決定，這份文件只處理週條 + `<p>` 那一行本身的跳版，
  **band-anchor 隱藏不渲染不算本 issue 定義的三種病**（不是文字取代，是條件式不渲染，
  沒有跳版風險——它本來就沒有佔位）。

## 共同原則

- 三類都只重用 `.p-skeleton` 的動畫/配色（`styles.scss` 全站共用），沒有新增第三種骨架配方
- 類別 A 完全不寫新 CSS，直接套現成的 `.skeleton-list`/`.skeleton-bar`
- 類別 B、C 的尺寸各自局部定義、卡住各自的最終內容形狀，不強行共用一個參數化 utility
  ——兩邊尺寸本來就不同，共用只是多一層抽象，換不到重複程式碼的減少
- 「載入中」文字保留在 `aria-label`（列表）或維持元件既有的錯誤態文字模式，不是完全拿掉
  ——只是不再用它取代整塊視覺內容

## 影響範圍

10 個檔案的 `.html`（模板改動，換掉 loading 分支的標記）+ 3 個檔案（`teaching-log-dialog`、
`class-log-sheet`、`schedule.page`）各自的 `.scss` 新增局部 element。不影響
`.skeleton-list`/`.skeleton-bar`/`.p-skeleton` 本身的定義，不新增共用元件。

## 驗證方式

- 逐檔既有 spec（如果有 loading 狀態的測試斷言「載入中」文字，改成斷言骨架元素存在）
- `npm run harness`（c6 禁 viewport 單位；BEM 命名走 `angular-scss-bem-standards`）
- Chrome 截圖驗證至少一個代表案例（類別 A 選一檔、類別 B、類別 C 的兩檔）資料到位時
  高度變化在可接受範圍內（不完全零跳版，但骨架高度要貼近真實內容，不是原本的一行文字）
