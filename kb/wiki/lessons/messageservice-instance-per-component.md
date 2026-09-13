---
title: MessageService 是每個元件一個實例，toast 的出口跟著注入層走
summary: 元件宣告 `providers: [MessageService]` 就拿到自己的實例，而 `<p-toast>` 訂閱的是注入它的那一層 —— 兩者不同層時，`messageService.add()` 的每一則都沒有訂閱者，畫面上零訊號而原始碼看起來完全正確（#809，四支元件）。附從原始碼查到的兩條注入鏈事實，供將來要把出口收斂成一處時當依據。
category: lessons
tags: [lessons, angular, primeng, dependency-injection, silent-failure]
status: active
updated: 2026-09-13
---

# MessageService 是每個元件一個實例，toast 的出口跟著注入層走

## 症狀

**原始碼有寫 toast，畫面上零訊號。**

`/admin/grades/overview/class`、`/admin/grades/overview/student`、`/admin/students` 的新增學生
對話框，在取數失敗時各自都呼叫了 `messageService.add({ severity: 'error', … })`，
而整份 document 裡量到的 `.p-toast-message` 是 **0 則**（#809）。
使用者看到的是「無符合的課程／請嘗試調整篩選條件」，或者必填的「就讀學校」下拉**靜靜是空的**。

## 機制

PrimeNG 的 `MessageService` **不是** `providedIn: 'root'`。它靠 `providers` 陣列被提供，
所以：

- 元件宣告 `providers: [MessageService]` → **它拿到自己的那一個實例**
- `<p-toast>` 訂閱的是**注入它的那一層**的 `MessageService`

兩者不在同一層時，`add()` 推進去的訊息沒有任何訂閱者。執行期實測（#809）：

```
ng.getComponent(<students 頁>).messageService
  === ng.getComponent(<對話框>).messageService     →  false
```

> **這個失效模式沒有任何訊號。** 沒有 console 錯誤、沒有型別錯誤、`add()` 正常回傳。
> 它跟 [[lessons/broken-looks-identical-to-normal]] 同族：**「toast 沒出現」與
> 「這一頁沒有錯誤處理」在畫面上逐字相同** —— 所以修法會被導向「補一則 toast」，
> 而補第二則一樣不會出現。

## 本 repo 的慣例（2026-09-13 清點）

**每支需要 toast 的元件自己 `providers: [MessageService]` + 自己模板放一個出口。**
`ShellLayoutComponent`、`app.component`、`app.config.ts` **都沒有**全域的 toast 出口或
provider —— 而 `app.component.html` 的註解明寫「不要再往 root component 加 UI 依賴」
（曾因 `DynamicDialog` 讓初始 bundle 多 140 kB）。

出口的寫法也分兩種，依元件是不是對話框：

| 情境   | 寫法                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| 頁面   | `<p-toast appendTo="body" [baseZIndex]="25000" />`（13 支）                                                  |
| 對話框 | `<p-toast position="top-center" [baseZIndex]="30000" />`（`contact-book-entry-dialog`、`login-link-dialog`） |

## 兩條注入鏈事實（將來要收斂成一處時的依據）

#809 裁定走「四支都模板加出口」，理由是不要讓「靠上層 provider」變成第二種活著的說法。
但**「靠上層」在技術上是可行的**，兩條鏈都從 `node_modules` 的原始碼查過 —— 記在這裡，
免得下一個人重新押注一次：

**① 子路由元件注入得到 outlet 所在元件提供的實例。**
`@angular/router` 的 `RouterOutlet.activateWith` 建元件時用的是
`new OutletInjector(activatedRoute, childContexts, location.injector, …)`，
而 `OutletInjector.get` 的最後一行是 `return this.parent.get(token, notFoundValue)` ——
`parent` 就是 `location.injector`，也就是**outlet 所在元件的 ElementInjector**。

**② `DialogService` 開的元件注入得到呼叫端那一層的實例。**
`primeng/dynamicdialog` 的 `DialogService.open` 是

```js
createComponent(DynamicDialog, {
  environmentInjector: this.appRef.injector,
  elementInjector: new DynamicDialogInjector(this.injector, map),
});
```

`this.injector` 是 `DialogService` **自己被注入時所在的那一層**（元件若
`providers: [DialogService]`，就是該元件的 ElementInjector），
而 `DynamicDialogInjector.get` 同樣 fallback 到 `this._parentInjector.get(...)`。
內容元件由 `DynamicDialog` 用自己的 `viewContainerRef.createComponent()` 建立，
所以它的注入鏈是 內容元件 → `DynamicDialog` → `DynamicDialogInjector` → 呼叫端那一層。

> **兩條鏈都成立，但它們是「還沒被任何測試釘住的前提」** —— P1 的修法不押在上面。
> 要收斂成一處的話，這兩條各需要一支測試先把它變成「已知」。

## 測試怎麼寫才抓得到

**替身用 `{ add: vi.fn() }` 的話，這件事從定義上測不到** —— 假物件沒有 observable，
`<p-toast>` 存不存在都一樣。#809 的四支裡有三支就是這樣，而它們的 spec 全綠。

三個要點：

1. **元件層的 `MessageService` 必須是真實例**（`new MessageService()`）。
   `overrideComponent` 若把元件層 `providers` 整個換掉，**要把它補回去** ——
   那一層正是成因所在，拿掉它注入鏈就往上找到 TestBed 那一個，於是測不到斷開。
2. **斷言查 `document` 不是 `fixture.nativeElement`**：`appendTo="body"` 會把 toast
   搬出元件。
3. **斷言查渲染出來的 `.p-toast-message`，不是「`add` 有沒有被呼叫」** ——
   後者是意圖，前者是結果（見 `herdr-team/README.md` 的「斷言要落在畫面而不是屬性」）。

## 沒有立 gate 的理由

工單原本建議一道「`providers` 含 `MessageService` 的元件，模板必須有 `p-toast`」的
機械檢查。**目前刻意不立**：一旦有任何元件改成靠上層的出口（上面兩條鏈都允許），
那道 gate 就會把它判成違規。要立的話條件得是「元件發 `add` 且**注入鏈上沒有任何出口**」，
而那要走注入鏈，不是 regex 看得出來的 —— **一道綠燈與紅燈都不可信的 gate 比沒有 gate 糟**。

現在守這件事的是四支各一條「發出的 toast 有出口」的單元測試（規則放在它守護的東西旁邊）。
