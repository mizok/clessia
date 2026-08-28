---
title: 選單開了、頁面寫了，路由還在 redirect
summary: M1 的課務異動畫面上線後完全打不開 —— 元件測試全綠，因為漏掉的東西不在元件裡，而在選單與路由表之間的縫。
category: lesson
status: active
updated: 2026-08-15
tags: [lessons, menu-entry-without-a-route]
---

# 選單開了、頁面寫了，路由還在 redirect

## 發生什麼

M1 的第二個畫面（課務異動紀錄）交付並合併進 `main`：

- `changes.component.ts` 是完整的頁面，7 個元件測試全綠
- `RoutesCatalog.ADMIN_CHANGES` 的 `showInMenu` 被打開，選單看得到
- 後端 `GET /api/sessions/changes` 11 個測試全綠

**但 `/admin/changes` 在路由表裡仍然是 `redirectTo: sessions`**（來自更早的
`6b2677c chore: retire two dead pages`，當時它確實是死頁面）。點選單會被彈到課堂管理。

功能等於沒交付，而且所有 gate 都是綠的。

## 為什麼沒被抓到

查證時我 grep 了 `ADMIN_CHANGES`，看到這一行：

```
apps/web/src/app/app.routes.ts:182:  path: RoutesCatalog.ADMIN_CHANGES.relativePath,
```

就下了「路由已接好」的結論。**下一行才是 `redirectTo`**，而 grep 預設不給後續行。

更根本的原因是這個缺陷不屬於任何一個既有的測試層：

| 測試層                   | 為什麼測不到                                   |
| ------------------------ | ---------------------------------------------- |
| 元件測試                 | 直接 `TestBed.createComponent`，根本不經過路由 |
| `routes-catalog.spec.ts` | 只斷言 label / group / showInMenu，不看路由表  |
| 後端測試                 | 跟前端路由無關                                 |

它是**選單與路由表之間的縫**。兩邊各自都對，接起來是壞的。

## 現在守它的東西

`apps/web/src/app/app.routes.spec.ts` 對每一個 `showInMenu` 的項目斷言兩件事：

1. `absolutePath` 在路由表裡找得到
2. 找到的項目載入的是頁面，不是 `redirectTo`

用 `it.each` 逐項展開，失敗時直接印出是哪一個選單項目壞了。

判斷「找得到頁面」要用 `some()` 而不是 `find()`：`/admin/grades/overview` 這種
父層只負責分組、真正的頁面掛在 `path: ''` 子路由上的結構，取第一個同名項目會誤判成 redirect。
寫這支測試時就先誤報了它一次。

## 帶得走的

- **grep 一行不足以證明接線正確。** 路由、註冊、掛載這類「一個位置決定行為」的東西，
  要嘛把上下文一起讀（`grep -A`），要嘛寫個測試證明它。
- **缺陷會住在層與層的縫裡。** 兩個模組各自測到滿分，接點沒人測 —— 而接點正是
  「功能到底能不能用」的所在。找測試缺口時，問的不是「這個檔案測夠了嗎」，
  而是「這兩個東西之間有誰在看」。
