---
title: 儀表板數值卡的載入態骨架化
summary: 修 #426——CardValue 的 null/'error' 原本渲染成跟真數字同量級的粗體文字，改用既有的 .p-skeleton 動畫取代純文字，錯誤態改用小圖示+短字降級處理，兩者都不能被誤讀成資料本身。
category: architecture
status: proposed
updated: 2026-09-06
---

# 儀表板數值卡的載入態骨架化

## 問題（#426，Tester 前置發現，P1）

`dashboard.component.ts` 的 `CardValue = number | 'error' | null` 三態約定本身沒問題（震央在
`herdr-team/admin-pages.md:30` 記的三態約定：`null` = 載入中、`'error'` = 失敗、有值 = 成功）。
出問題的是**呈現層**：`dashboard.component.html` 兩處（`dashboard__todo-value`、
`dashboard__fact-value`）用

```html
@if (card.value === null) { 載入中 } @else if (card.value === 'error') { 讀取失敗 } @else { {{
card.value }} }
```

三個語意不同的狀態被 render 成**同一種視覺形狀**——都是站在數字位置上、同樣字重
（`--font-bold`）、同樣字級（`--text-2xl` / `--text-xl`）、同樣顏色（`--zinc-900`）的純文字。
Tester 的原話：「讀起來像一個狀態值，不像還在載」。

## 掃描結果：全站同一形狀只有這兩處

派 agent 對 `grep -rln "載入中"` 找到的 18 個檔案逐一讀過上下文，另外用型別本身
（`number | 'error' | null` 這個具體形狀）擴大搜尋，確認沒有漏網的「卡片數值」實例：

- **只有 dashboard.component.html 的兩處是真的同病**——單一數值站在資料位置上，可能被誤讀。
- 其餘 16 個檔案裡的「載入中」文字分三類，都不是這個病：
  - 有 spinner icon + 文字的獨立 loading 區塊（`school-exam-form-dialog`、`schools.page` 等）
  - 使用者主動觸發、按鈕文字暫時變化（`attendance.page`、`payments.page` 的「載入更多」）
  - **10 個檔案共用同一句 `<p class="X__state">載入中…</p>` 取代整個清單/表格區塊**
    （`enrollments`、`changes`、`teaching-log-dialog`、`notifications`、`contact-book`、
    `teacher/schedule.page`、`announcement-inbox`、`class-log-sheet`、`teacher/students.page`、
    `teacher/contact-book-roster`）——這 10 個檔案的問題不是「單一數值被誤讀成資料」，是
    「一段文字取代一整個區塊、高度跟真正內容差很多、資料到了會跳版」，跟 Tester 在 #426
    裡點名的 #2/#3/#4（手風琴、tab 底線、課程列表展開）是**同一類「狀態轉換期間畫面是壞的」**，
    但根因（列表區塊 vs 單一數值）不同，修法也不同（那邊要的是骨架列表或固定高度容器，
    不是這裡要的單值骨架條）。

**這份設計文件只處理 dashboard 那兩處。** 10 個列表檔案的跳版問題另開 issue，理由見下方
「拒絕的方案」第三條。

## 修法：重用既有的 `.p-skeleton`，不再發明第三種骨架語言

本專案已經有兩套骨架呈現，各自為自己的情境發明：

1. `.p-skeleton`（`styles.scss`）——全站共用的動畫骨架：漸層 shimmer + `skeleton-wave` 動畫，
   PrimeNG 元件與少數自訂用法在用
2. `.dashboard__band-skeleton`（本檔）——橘帶專用，靜態方塊 + `opacity: 0.45`，配色是
   `--band-rule`（近黑的半透明），因為橘帶的骨架不能用 `.p-skeleton` 的灰階漸層（會在橘帶上
   突兀）

這兩處數值卡**不在橘帶上、在白卡片上**，沒有理由不用 (1)。**新增第三種骨架配方**（例如
方塊+opacity 但配灰階）只會讓「骨架」這個詞在這個檔案裡有兩種長得不一樣的實作，
之後改一個不會想到要改另一個。

### 數字骨架（loading）

```html
@if (card.value === null) {
<span class="dashboard__value-skeleton p-skeleton" aria-hidden="true"></span>
<span class="u-sr-only">載入中</span>
} @else if (card.value === 'error') { ... } @else { {{ card.value }} }
```

```scss
// 尺寸卡住最終內容的形狀——寬度用 2ch（絕大多數卡片數字是 1-2 位數，
// 3 位數以上時骨架比實際數字窄一點點，資料到位那一刻寬度變化在可接受範圍內，
// 比骨架比數字寬造成的「資料變瘦」更不明顯）、高度用 1em 卡住行高，
// 不然骨架跟真數字切換時上下會跳
.dashboard__value-skeleton {
  display: inline-block;
  width: 2ch;
  height: 1em;
  border-radius: var(--radius-sm);
  vertical-align: middle;
}
```

`.p-skeleton` 自己的 `background`/`animation` 都是 `!important`（見 `styles.scss` 既有註解：
PrimeNG 元件樣式是執行期動態插入，優先度打平時它必贏），這裡只補寬高與圓角，顏色跟動畫
完全交給它，不重複定義。

### 錯誤骨架（'error'）

錯誤態**不能長得像骨架**（會被讀成「還在載入，只是特別慢」）**也不能長得像數字**
（會被讀成一個異常大的數值）。改用小圖示 + 短字，字級明顯小於真數字：

```html
} @else if (card.value === 'error') {
<span class="dashboard__value-error" title="讀取失敗">
  <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
  讀取失敗
</span>
}
```

```scss
.dashboard__value-error {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-sm); // 明顯小於 --text-2xl / --text-xl 的真數字
  font-weight: var(--font-medium); // 不是 --font-bold
  color: var(--error-600); // 全站既有的錯誤文字色階，白底已驗證過對比
}
```

字級從 `--text-2xl`（22px）/`--text-xl`（18px）降到 `--text-sm`（12px），字重從 `--font-bold`
降到 `--font-medium`——這個量級差本身就排除「被讀成一個數字」的可能，不需要額外的視覺裝置。

## 拒絕的方案

1. **文字骨架化**（把「載入中」三個字改成更輕的字重/顏色，不做骨架條）——被拒。輕量文字
   還是文字，字重再輕，一段完整的中文詞彙仍然會被當「這是資料」讀（尤其是快速掃視時），
   問題的本體是「文字站在數值位置」，不是「文字不夠淡」。
2. **`—`（em dash）取代載入中與錯誤**——被拒。這個符號在本專案已經有明確的既有語意
   （`dashboard__spine-meta` 的 `student.grade ?? '—'` 代表「這個欄位真的沒有值」）。
   拿同一個符號表達「還沒查到」與「查失敗」會製造第三種語意去搶佔一個已經有主人的符號，
   使用者會把「載入中」跟「這個學生沒有年級」混成同一件事。
3. **這一刀順手把 10 個列表檔案的跳版問題也修掉**——被拒。根因不同（單一數值 vs 整塊區域），
   修法不同（骨架條 vs 骨架列表/固定高度容器），影響檔案數是這裡的 5 倍。混進同一支 PR
   會讓 review 範圍炸開，而且這兩類問題的驗收方式不同（這裡看一個數字，那邊要看一整張表
   的版面穩不穩）。另開 issue，標成同一個「狀態轉換期間畫面是壞的」家族的第 5 個成員
   （Tester 原本點的 #2/#3/#4 之外的第四個）。

## 影響範圍

- `apps/web/src/app/features/admin/pages/dashboard/dashboard.component.html`（兩處 `@if` 區塊）
- `apps/web/src/app/features/admin/pages/dashboard/dashboard.component.scss`（新增
  `.dashboard__value-skeleton`、`.dashboard__value-error` 兩個 class）
- 不影響其他頁面、不影響 `CardValue` 型別本身、不新增共用元件（只有兩個使用點，抽元件是
  未驗證過的抽象，等第二個消費者出現再抽）

## 驗證方式

- test-first：既有的 `dashboard.component.spec.ts` 斷言 DOM 目前應該還在找「載入中」/
  「讀取失敗」這兩段字——測試要先改成找 `.dashboard__value-skeleton` 是否存在、
  `.dashboard__value-error` 的 `title`/文字是否正確，紅了才開始改模板
- `npm run harness`：新增的 color/background 配對要過對比 gate（`--error-600` 對白已經是
  既有引用、無新配對）
- Chrome 截圖驗證：loading 態骨架有跑動畫、error 態明顯比真數字小一號、資料到位時骨架寬度
  跟數字寬度差距在視覺可接受範圍
