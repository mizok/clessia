---
title: Toast：全站唯一出口 app-toast
summary: 所有 MessageService.add() 都送到 App 掛的 <app-toast>（A6 版型）；元件不得自己 provide MessageService 或掛 p-toast，底部動作列要標 data-toast-dock。
category: architecture
status: active
updated: 2026-10-15
tags: [architecture, toast, a6, feedback]
---

# Toast：全站唯一出口 app-toast

## 決定（#1615）

- `MessageService` 在 `app.config.ts` 全域提供一份；出口是 `App` 模板裡唯一的 `<app-toast>`
  （`shared/components/toast`）。
- **元件不得 `providers: [MessageService]`，也不得掛 `<p-toast>`**。元件層的 provider 會讓
  `add()` 只進那一層，全站出口收不到 —— 畫面上零訊號（#733、#809 都是這個坑的變形）。
  各頁 spec 有一條「發出的 toast 到得了全站出口」守著。
- 樣式照 A6（`kit.html`、`a6.css:674-689`）：底部置中、離底 16px、灰面 `--zinc-200`、
  最多 3 則、滑過或鍵盤移入暫停。A6 沒畫的由使用者裁：四種 severity 同一個灰面只換圖示色；
  標題一行、內文一行；錯誤 6 秒、成功 4 秒、有「復原」6 秒；呼叫端給 `life` 就照 `life`。
- `sticky: true` 的不會自己消失，給一顆「關閉」；`data.undo` 有給就出「復原」。

## 寫新頁要注意

- **固定在畫面底部的動作列要加 `data-toast-dock`**，toast 才會浮在它上面 12px
  （A6 的 `.dock` 同一招）。`page-actions` 的手機停靠列已經加了。
- **為什麼不用 `p-toast`**：root component 不加 PrimeNG UI 依賴（`app.component.ts`），
  而且它的版型、數量上限、暫停都得拆掉重做。這裡只吃 `MessageService` 的兩個 observable。
- **蓋得過對話框**：外框是 `popover="manual"`，每則訊息都重新 `showPopover()`，排在最後打開的那層之上。

## 拒絕的替代方案

- **定義 `--app-header-height` 讓 toast 留在頂部**：那個 token 從來沒有定義過，toast 才會疊在頂欄上；
  A6 是底部置中，留在頂部就要另外維護一個頂欄高度。token 連同唯一引用一起刪掉。
- **逐頁修 33 個 `p-toast` 的位置**：病灶在「出口分散」本身，修完下一頁又會再長一個。
