---
title: 模板事件運算式回 false，Angular 會替你 preventDefault
summary: (click)="$event.target === dialog && close()" 點在 dialog 裡面時整句是 false，Angular 把 false 當成 preventDefault —— 對話框裡的 radio 點不下去。DOM 事件的 handler 要嘛呼叫方法、要嘛確保不回 false。
category: lesson
status: active
updated: 2026-10-21
tags: [lessons, angular, template, events, dialog]
---

# 模板事件運算式回 false，Angular 會替你 preventDefault

## 那次

#1314 SE3 的分校表單改成原生 `<dialog>`，點背景關閉寫成一行：

```html
<dialog #dialog (click)="$event.target === dialog && close()"></dialog>
```

點在 dialog **裡面**時，`===` 是 false，`&&` 短路，整個運算式的值是 `false`。
Angular 對 DOM 事件的模板 handler 有一條舊規則：**回傳值 `=== false` 就呼叫 `event.preventDefault()`**。
於是對話框裡每一次點擊都被 preventDefault —— radio 點不下去、checkbox 勾不了。

文字輸入框照常能打字（`click` 的預設動作不管輸入），所以手動試的時候很容易只覺得「狀態選不到」，
不會聯想到整個對話框的點擊都被擋了。抓到它的是 spec：「選停用、送出 isActive false」那支紅了，
`off.click()` 之後 `checked` 仍是 false。

## 規則

- DOM 事件（`click`、`change`、`contextmenu`、`keydown`…）的模板 handler **呼叫方法**，
  條件寫在方法裡（方法回 `void`）。家長端請假的 `onLeaveBackdrop`、分校頁的 `onBackdrop` 都是這個寫法。
- `a && b()` 這種短路只適合元件的 `output`（不是 DOM 事件，回傳值沒有意義）。
- 要 preventDefault 就明講 `$event.preventDefault()`，不要靠回傳值。

## 還在的同形狀

`schedule-list.component.html` 的 `(contextmenu)="pressed && $event.preventDefault()"`：
`pressed` 為 false 時運算式也是 false，一樣會被 preventDefault。是不是本意（右鍵選單一律擋）要看那張單的脈絡，
寫在這裡讓下一個碰它的人知道兩條路徑效果相同。
