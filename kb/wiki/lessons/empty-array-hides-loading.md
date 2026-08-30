---
title: 空陣列把「還沒載入」講成「真的沒有」
summary: signal 初始 [] 或 computed 把 null 壓成 [] 之後，畫面就無法區分「還不知道」與「確定沒有」—— 而失敗態通常有人想到，載入態沒有。含一個已知但暫不修的實例（ReferenceDataService → 批次面板的老師名單）。
category: lesson
status: active
updated: 2026-08-30
tags: [lessons, loading-state, signals, known-issue]
---

# 空陣列把「還沒載入」講成「真的沒有」

## 這個模式長什麼樣

```ts
protected readonly items = signal<Item[]>([]);   // 初始就是空的
// …非同步填
```

```html
@if (items().length === 0) {
<app-empty-state title="還沒有任何資料" />
}
```

畫面在資料到達之前就宣稱「沒有」。使用者看到的是一句**確定的否定句**，而事實是
「還不知道」。

## 為什麼它特別容易溜過去

**因為失敗態通常有人想到，載入態沒有。**

儀表板的三態 signal 是這個現象最乾淨的標本（`dashboard.component.ts`，已由 #110 修正）：

```ts
private readonly todaySessions = signal<EventSessionSummary[] | 'error' | null>(null);

protected readonly todaySessionList = computed(() => {
  const sessions = this.todaySessions();
  if (sessions === null || sessions === FAILED) return [];   // ← 三態壓成兩態
  …
});
```

signal 層的三態是**完整**的（`null` = 載入中、`'error'` = 失敗、陣列 = 有值），
模板也確實用 `sessionsFailed()` 把失敗救回來了 —— **只有載入中沒有出口**，
它在 computed 降型的那一步就跟「真的沒有」合流了。

> **通則：三態 signal 降成陣列時，「載入中」是最容易被壓掉的那一態。**
> 寫 `if (x === null || x === FAILED) return []` 的時候，`FAILED` 那半通常是刻意的
> （模板另有分支），`null` 那半是順手加的。

## 怎麼寫才對

`session-assign-dialog` 的寫法是這個 repo 裡最短的正解：

```html
@if (!loadingTeachers() && teachers().length === 0) {
<p>目前沒有符合條件的老師。</p>
}
```

**一行內就把「還不知道」排除掉**，不需要多一層巢狀。

頁面層級則用既有的骨架慣例：

```html
@if (loading()) {
<div class="skeleton-list">…</div>
} @else if (failed()) { … } @else if (items().length === 0) {
<app-empty-state … />
}
```

**修在型別層比修在模板層值錢**：讓 computed 不要吞掉 `null`（回 `T[] | null`），
「忘記處理載入中」就變成編譯錯誤，下一個加卡片的人躲不掉 —— 而模板層的修法
每加一個消費者就要記得一次。

## 已知但暫不修：批次面板的老師名單

**位置**：`admin/pages/sessions/dialogs/mobile-batch-dialog/mobile-batch-dialog.component.html:40` 與 `:115`
（「所選課堂目前沒有符合科目與分校的老師」）

**根因鏈**：

```
core/reference-data.service.ts  teachers = signal<Staff[]>([])   ← 初始空、非同步填、沒有載入態
  → sessions.page  staff() → activeTeachers() → batchAssignableTeachers()
    → openBatchSheet() 取「快照」放進 config.data
      → dialog 的 ngOnInit 同步 set 進自己的 signal
```

**觸發條件**：在 `refData.loadTeachers()` 回來之前就完成「選取課堂 → 開批次面板」。
`loadTeachers()` 在頁面 init 就發了，所以實務上很難碰到。

**碰到會怎樣**：因為傳進 dialog 的是**快照**，資料後來到了也不會更新 ——
那個面板會**永遠**顯示「沒有符合的老師」，直到重開。

**為什麼不修**（2026-08-30 計畫席裁決）：

- 修 dialog 沒有用 —— 它沒有東西在載入，補 loading signal 是假的
- 在 `sessions.page` 擋是治標，`ReferenceDataService` 三態化之後那段碼要拆掉，等於付兩次
- 正解是 `ReferenceDataService` 加載入態並盤點所有消費者，但單為這條低風險路徑動
  `core/` 的共用服務不划算 —— 等它跟別的 core 改動（例如 `OrgSettings` 的
  APP_INITIALIZER）一起做

## 怎麼盤點這個模式

2026-08-30 掃過一次全站，方法值得重複：

1. 找模板裡的空狀態（`app-empty-state` 或「尚無 / 還沒有 / 目前沒有」文案）
2. **追它的完整祖先 `@if` 鏈，外加同一條 `@if / @else if` 鏈上前面的分支** ——
   只看最近那個 `@if` 會把「外層已經擋掉 loading」的正確寫法誤報
3. 對每個活下來的候選**開 `.ts` 確認那份資料是不是真的非同步**

60 處初篩 → 祖先鏈過濾剩 11 → 查證資料來源後真陽性 3 處（儀表板兩處 + 本頁記的這處）。

> ⚠️ **第 3 步不能省。** 我第一次盤點時看到 grep 結果裡有 `subscribe` 就推論
> 「這份資料是非同步載入的」，結果那是批次操作的 subscribe，資料其實是同步傳入的。
> **自己 grep 出來的推論比別人給的前提更危險 —— 它披著「我親自掃過」的外衣。**

## See Also

- [[lessons/status-table-blind-spot]] — 另一種「看起來正常但其實沒說實話」的畫面
