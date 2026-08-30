---
title: 修寫法時被喚醒的舊測試，比新測試更會咬人
summary: 把 @Input/@ViewChild 換成 functional API 這種「機械」重構，讓一段從來沒真正執行過的程式碼第一次跑起來，連帶暴露六支靠「那行沒跑到」才綠的 spec 與一顆 node 解析條件的地雷。
category: lesson
status: active
updated: 2026-08-30
tags: [lessons, awakened-tests-bite, angular, testing]
---

# 修寫法時被喚醒的舊測試，比新測試更會咬人

2026-08-30 清 c8 存量（裝飾器 API → functional API）時遇到的三層連鎖。表面上這是
一筆「換寫法、行為不變」的重構，實際上它讓一段**從來沒有真正執行過的程式碼**第一次
跑起來，於是連著兩層被掩蓋的問題一起浮出來。

## 第一層：一個沒讀任何 signal 的 effect

`jdenticon-avatar` 的建構子裡有 `effect(() => { ... })`，但它讀的是 `this.svgIcon`
與 `this.value` —— 兩個都是**非 signal 的 class field**。effect 只在建構時跑一次，
之後再也不會重跑。真正在做事的是 `ngOnChanges`。

程式碼裡的註解甚至承認了這件事（「Since Inputs are not signals by default…」），
但它讀起來像是「所以我們另外用 ngOnChanges 補」，而不是「所以上面那個 effect 是死的」。

> **要看的是 effect 讀了什麼，不是它寫了什麼。** 一個不讀 signal 的 effect 不是
> 「效果比較弱」，它是一次性的建構子程式碼穿了 effect 的外衣。

## 第二層：六支 spec 靠「那行沒跑到」才綠

`ngOnChanges` 裡有 `if (this.svgIcon)` 守衛，而非 `static` 的 `@ViewChild` 在
**第一次 `ngOnChanges` 時必然是 `undefined`**（view query 要到 view init 之後才解析）。
所以 `jdenticon.update()` 在測試環境裡從來沒有被呼叫過。

六支相關的 spec 一直是綠的 —— 不是因為那段邏輯對，而是因為那段邏輯沒跑到。

改成 signal input + signal view query 之後，effect 開始依賴真的 signal，view query
解析完成時會再觸發一次，於是那行第一次真的執行，六支 spec 同時變紅。

> **測試綠有兩種：「跑了而且對」與「根本沒跑到」。** 重構把後者變成前者的時候，
> 紅燈不是你弄壞的，是你把既有的壞燈接上了電。

## 第三層：node 解析條件的地雷

那行一跑起來就炸：

```
Error: jdenticon.update() is not supported on Node.js.
```

`jdenticon` 的 `exports` 依條件分流，裸的 `import * as jdenticon from 'jdenticon'`
在 **node 條件**下拿到 `jdenticon-node`，它的 `update()` 直接拋錯。app 建置走的是
browser 條件所以 production 沒事 —— 只有測試環境會踩到。

三個修法，只有一個修在根上：

| 做法                                | 為什麼不是它                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 包 try/catch                        | 把真的錯誤一起吞掉                                                                                        |
| 在 spec 裡 mock jdenticon           | 每支新 spec 都要記得 mock；根因還在                                                                       |
| **指名 `jdenticon/browser` 子路徑** | 這支元件只可能在瀏覽器裡跑（它操作真的 SVG 元素），指名比讓解析條件決定誠實，而且 production 行為完全不變 |

> **依環境分流的套件，import 路徑要指名，不要讓解析條件替你決定。** 尤其是
> 「production 走 A、測試走 B」這種分流 —— 它保證你在 CI 上看到的不是使用者會遇到的。

## 最後一步：測試綠證明不了畫得出來

那六支 spec 之所以能長期說謊，正是因為它們驗證的是「元件建得起來」而不是
「圖畫得出來」。所以修完之後**另外開了真站看頭像**，確認 identicon 真的被畫進 SVG。

> 一個從來沒被執行過的呼叫被修好之後，要用**執行它的環境**去確認，不能只看
> 那六支剛剛才變綠的 spec。

## 怎麼提早發現

- 看到 `effect()`，先問「它讀了哪些 signal」。一個都沒有 → 它是死的
- 看到 `if (someViewChild)` 這種守衛，先問「它在第一次執行時是不是必然為 false」
- 機械重構讓既有測試變紅時，**先假設是舊碼的問題**，而不是急著讓紅燈消失
- 相關案例：[[lessons/local-green-is-not-repo-green]]（本機狀態 ≠ 版控狀態）與
  [[lessons/generated-tables-need-verifying]]（生成物看起來對不等於真的對）
