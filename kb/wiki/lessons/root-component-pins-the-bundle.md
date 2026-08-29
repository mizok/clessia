---
title: Root component 掛什麼，所有人就下載什麼
summary: 一個只有多重角色使用者看得到的角色選擇 dialog，把 PrimeNG 整棵 dialog 依賴樹釘在初始 bundle 上，佔 756 kB 中的 140 kB。順帶記錄 angular.json 其實不生效這個會再踩一次的坑。
category: lesson
status: active
updated: 2026-08-29
tags: [lessons, bundle-size, angular, primeng, nx]
---

# Root component 掛什麼，所有人就下載什麼

2026-08 查 `apps/web` 初始 bundle 為何是 756.63 kB（預算 500 kB）時挖出來的。
瘦身後 **575.35 kB / transfer 139.13 kB**（−181 kB，−24%）。

## 一、初始 bundle 的定義是「從 root 靜態可達」

`app.component.ts` 曾經長這樣：

```ts
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SelectRoleComponent } from '@features/select-role/select-role.component';
```

角色選擇器只有**多重角色**的使用者在登入後看得到。但它掛在 root component 上，於是
`dynamicdialog → dialog → button → dom / motion / focustrap / icons / ripple / badge`
整棵樹加上 `@primeuix/styles/button` 那個 22 kB 的 CSS-in-JS 字串，全部變成初始 chunk 的一部分
——**約 140 kB，所有人都下載**。

路由那邊其實做得很好：43 條路由全部 `loadComponent`，一條沒漏。lazy loading 的邊界不是被
路由破壞的，是被 root component 破壞的。

> **規則**：root component 只放 `<router-outlet>`。任何 UI 元件、任何 `providers` 裡的
> UI service（`DialogService` 這種），放上去就等於放進初始 bundle。

`providePrimeNG` 本身只需要 `primeng/config` + `primeng/api` + `primeng/base` + `@primeuix/styled`
（約 36 kB），那是無法避免的地板；其餘全部是 dialog 拖進來的。

## 二、DynamicDialog 的 injector 會沿父元件往上找

移除 root 的 `DialogService` provider 之前，擔心的是那些自己沒有 local provider、
靠 root 拿到 `DialogService` 的巢狀 dialog 會壞掉。查了 `primeng-dynamicdialog.mjs`：

```js
const componentRef = createComponent(DynamicDialog, {
  environmentInjector: this.appRef.injector,
  elementInjector: new DynamicDialogInjector(this.injector, map), // ← this.injector 是開啟方的
});
```

`this.injector` 是 `DialogService` **被建立時所在的 injector**。父頁 `providers: [DialogService]`
→ 它拿到的是頁面級 injector → 由它開出來的 dialog 元件沿 elementInjector 鏈往上，
一樣找得到頁面級的 `DialogService`。所以只要**開啟方**有 local provider 就安全，
被開的那一支不需要自己 provide。

## 三、`/select-role` 是一條沒有註冊的路由（順手修掉的 bug）

四個地方導向 `/select-role`：`core/guest.guard.ts`、`core/role.guard.ts`、
`features/public/pages/link-line/link-line.component.ts`，以及 `auth.service.ts` 裡 LINE 登入的
`callbackURL`。而 `app.routes.ts` 從來沒有註冊過這條路由 —— 它會被 `path: '**'` 收去 `/login`，
`guestGuard` 再把已登入的多角色使用者送回 `/select-role`，**兩邊互踢成無限重導向**。

角色選擇一直是靠 shell header 上的按鈕手動開 dialog，但要進得了 shell 得先有 `activeRole`，
多角色又沒選過的人根本進不去。把 dialog 改成 `/select-role` 路由頁同時修掉了這件事。

教訓跟 [[lessons/menu-entry-without-a-route]] 同源：**導向的目的地沒有人驗證它存在**。
`app.routes.spec.ts` 現在多了一條真的用 `Router.navigateByUrl` 走一遍的測試。

## 四、`angular.json` 不生效 —— 改了會以為自己改了

這個坑值得單獨記：本 repo **同時有** `angular.json` 和 `apps/web/project.json`，兩份都定義了
`styles`、`budgets`、`fileReplacements`。**Nx 用的是 `apps/web/project.json`**，`angular.json`
是殘留。

改 `angular.json` 的 budget 之後 build 照樣印 `Budget 500.00 kB`，清了 `ng cache` 和 `nx reset`
還是一樣 —— 因為那份設定根本沒被讀。兩份的內容當時已經漂移（`anyComponentStyle` 一份寫
8 kB、另一份 6 kB；`allowedCommonJsDependencies: ["qrcode"]` 只有 project.json 有）。

> **要改 web 的建置設定，改 `apps/web/project.json`。** 目前兩份已對齊，但這是重複設定，
> 遲早再漂移一次，建議收斂成一份。

## 五、還沒做的

`@primeuix/themes` 的 Aura preset 是**全量**匯入（90 個元件的 design token，105.6 kB），
專案只用得到其中 25 個 —— 約 43 kB 是死重。技術上可以只 import 需要的子路徑
（`@primeuix/themes` 的 exports 是 `"./*": "./dist/*/index.mjs"`，93 個子目錄都能單獨 import），
但**忘了補 preset 不會有編譯期錯誤，只會樣式壞掉**，所以要先有一條比對
`from 'primeng/x'` 與 preset 清單的 gate 才值得做。已明確延後。

Angular framework 本身佔 291 kB（core 152.8 + router 78.4 + common 44.8 + platform-browser 15.3）
是地板 —— 這也是為什麼 initial budget 從 500 kB 調成務實的 620 kB / 800 kB：
500 kB 是一個永遠達不到、因此沒有人會認真看的紅燈。
