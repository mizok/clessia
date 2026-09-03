---
title: 拆成 lazy chunk 不等於延後下載
summary: xlsx 早就是獨立的 lazy chunk，但被兩個頁面靜態 import，所以打開那兩頁一定會抓它的 96 kB。真正的分界不是「有沒有拆成 chunk」，是「有沒有人靜態指到它」。
category: lesson
status: active
updated: 2026-09-03
tags: [lessons, bundle-size, angular, code-splitting]
---

# 拆成 lazy chunk 不等於延後下載

2026-09-03 做「lazy chunk 內部拆分」評估時挖出來的。承
[[lessons/root-component-pins-the-bundle]] —— 那一篇講的是初始 bundle，這一篇講的是
**lazy chunk 之間**同一個錯誤的第二種形狀。

## 現象

`npx nx run web:build --verbose` 的 lazy chunk 表最上面那一列：

```
chunk-6WQPDSTN.js   | -   | 337.56 kB |  95.69 kB transfer
```

**比整個初始 bundle 的傳輸量（141.86 kB）的三分之二還大**，而且沒有名字。

它是 **xlsx（SheetJS）**。名字空白是因為它不對應任何一條路由 —— 它是「兩個以上的 lazy
chunk 都用到，所以被抽出來共用」的那種 chunk。

**看起來很健康**：套件被拆出去了、沒有進初始 bundle、只有需要的頁面才載入。

## 但它其實是必抓的

從建置產物驗證（不是從原始碼推理）：

```
$ grep -l "chunk-6WQPDSTN" *.js
chunk-BDNAGGSO.js     # parents-page
chunk-OMUB23B4.js     # class-detail-page
```

而那兩處是 `import{…}from"./chunk-6WQPDSTN.js"` —— **靜態**。

原始碼上的原因很單純：

```
parents.page.ts       → ParentImportDialogComponent → import * as XLSX from 'xlsx'
class-detail.page.ts  → RosterImportDialogComponent → import * as XLSX from 'xlsx'
```

兩個 dialog 都被父頁面**靜態 import**（它們要出現在 `imports: []` 裡）。所以：

**打開「家長管理」或任何一個「班級詳情」，就會下載 96 kB 的 Excel 解析器 ——
不管使用者有沒有要匯入。而多數人進那兩頁只是看名單。**

## 規則

> **`import()` 才是延後，`chunk` 只是切開。**
> 判斷一個 chunk 會不會被抓，看的是**有沒有人靜態指到它**，不是它有沒有被切出來。

檢查方法（**用建置產物，不要用原始碼推理**）：

```bash
npx nx run web:build --verbose        # 找出可疑的大 chunk
cd dist/apps/web/browser
grep -l 'from"\./chunk-XXXX\.js"' *.js    # 靜態引用者 → 這些頁面一定會抓它
grep -o 'import("\./chunk-XXXX\.js")' *.js # 動態引用者 → 只在跑到那行才抓
```

兩種寫法在原始碼裡長得很像，在 chunk 表裡**完全看不出差別** —— chunk 表只說「它是
lazy chunk」，不說「誰會拉它」。

## 修法與它的代價

把 `import * as XLSX from 'xlsx'` 換成解析當下的 `await import('xlsx')`。
使用者已經選了檔案才會走到那一行，那是唯一需要它、而且等一下也合理的時刻。

**代價要說出來**：

|            | 靜態（改前）                      | 動態（改後）                                |
| ---------- | --------------------------------- | ------------------------------------------- |
| xlsx chunk | 337.56 kB / **95.69 kB** transfer | 432.16 kB / **119.49 kB** transfer          |
| 什麼時候抓 | **開啟那兩頁就抓**                | 選了檔案才抓                                |
| 不匯入的人 | −                                 | **省 95.69 kB**                             |
| 要匯入的人 | −                                 | **多 23.80 kB**，但延後到他本來就在等的時刻 |

**動態 import 讓 chunk 變大了。** 試過 `const { read, utils, SSF } = await import('xlsx')`
想救回 tree-shaking —— **一個位元組都沒差**（SheetJS 是單一模組，本來就不可搖）。
所以那 23.8 kB 是這個修法的固定成本，不是可以調的東西。

淨值仍然明確：**絕大多數人省 95.69 kB，少數人多付 23.80 kB 且付在對的時刻。**

## 順帶查過、結論是不用動的

| chunk                               | 大小                | 結論                                                              |
| ----------------------------------- | ------------------- | ----------------------------------------------------------------- |
| `@angular/animations/browser`       | 67.75 kB / 17.80 kB | **已經是動態的**（`main` 用 `import()` 拉），PrimeNG 的動畫要它   |
| PrimeNG table / datepicker / select | 132 / 104 / 104 kB  | vendor 程式碼，內部拆不動。要省只能是「這一頁真的需要這個元件嗎」 |

**「lazy chunk 內部拆分」這個題目的答案是：能拆的只有 xlsx 這一種 ——
應用程式碼在 lazy chunk 裡的比例很小，大頭都是 vendor。** 下一次要再擠，
方向是「少用一個 PrimeNG 元件」而不是「把 chunk 切得更細」。
