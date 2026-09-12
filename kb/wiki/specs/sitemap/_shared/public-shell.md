---
title: 公開頁外框（PublicShell，login / trial / enrollment / qr-checkin / link-line / select-role 共用）
summary: 六個公開頁共用的外框：橘色品牌面（字標、標語、流場動畫、四條輕量連結、版權）+ 白色主面。
category: spec
status: developing
tags: [sitemap, _shared, public, rwd]
created: 2026-09-12
updated: 2026-09-13
---

# 公開頁外框（PublicShell）

**元件**：`@features/public/public-shell.component`

`/login`、`/trial`、`/enrollment`、`/qr-checkin`、`/link-line`、`/select-role`
**全部走這一個外框**（`app.routes.ts` 最上層那個 `path: ''` 的 children）。

> **這一頁跟 [[specs/sitemap/_shared/shell-layout]] 是兩個不同的外框。**
> ShellLayout 是登入後的 admin / teacher / parent 用的（左側選單 + 頂列角色徽章），
> PublicShell 是公開頁用的（橘色品牌面 + 白面）。六頁的地圖**只寫 `<main>` 裡面的東西**。

## 畫面區塊

### 1. 品牌面（`<aside>`，桌機在左、手機在上）

橘色底，上面疊一層 `app-flow-field` 的流場動畫（`density=0.8`、`speed=1`，純裝飾）。
由上而下：

- **字標** `Clessia` —— 是一條連結，指向 `/login`
- 標語 `學程管家`
- 副標 `讓學習旅程更輕鬆`
- （貼底）**四條輕量連結**
- 版權 `© 2025 Clessia Academy`

### 2. 主面（`<main>`，白底）

只有 `<router-outlet>`。各頁的內容都落在這裡。

## 互動元素

**整個外框只有 5 個，而且是靜態的 —— 不依賴登入狀態、不依賴資料。**

| 元素（畫面上的字） | 類型 | 出現條件 | 按了之後           |
| ------------------ | ---- | -------- | ------------------ |
| `Clessia`（字標）  | 連結 | 永遠     | 導向 `/login`      |
| 登入               | 連結 | 永遠     | 導向 `/login`      |
| 試聽申請           | 連結 | 永遠     | 導向 `/trial`      |
| 我要報名           | 連結 | 永遠     | 導向 `/enrollment` |
| QR 到班打卡        | 連結 | 永遠     | 導向 `/qr-checkin` |

目前所在的那一條會加上 `public-shell__link--active`
（`/login` 是 `exact: true`，其餘 `exact: false`）。

### ⚠️ 這四條連結是生成的，不是手寫的

`publicRoutes = RoutesCatalog.values.filter((r) => !r.role && r.showInMenu)` ——
**沒有角色 且 `showInMenu`** 的路由。所以：

- `/link-line` 與 `/select-role` 的 `showInMenu` 是 `false`，**不在這排連結裡**
- 往 `RoutesCatalog` 加一條沒有 `role` 的路由，這排會自己多一條

## 狀態

外框沒有狀態 —— 它不取資料、不看登入狀態。**登入著看到的外框跟登出時一模一樣**
（實測：帶著 admin session 開 `/trial`，外框 5 個元素與登出時逐項相同）。

## 驗證紀錄

- **日期**：2026-09-12 ／ **前端版本**：`9f08061a`（主 checkout 的 dev server，port 4200）
- **視窗**：1504 × 695（桌機寬度）

### 兩向比對（以 `/qr-checkin` 量，外框與頁面無關）

`document` 全域可見互動元素 5 個，`<main>` 內 0 個 —— **5 個全部屬於外框**：

| tag | class                                           | 文字        | href          |
| --- | ----------------------------------------------- | ----------- | ------------- |
| a   | `public-shell__logo`                            | Clessia     | `/login`      |
| a   | `public-shell__link`                            | 登入        | `/login`      |
| a   | `public-shell__link`                            | 試聽申請    | `/trial`      |
| a   | `public-shell__link`                            | 我要報名    | `/enrollment` |
| a   | `public-shell__link public-shell__link--active` | QR 到班打卡 | `/qr-checkin` |

| 方向        | 結果                   |
| ----------- | ---------------------- |
| 地圖 ⊆ 畫面 | 5 項全部找到 ✓         |
| 畫面 ⊆ 地圖 | 5 個可見元素全部有列 ✓ |

**差異：0 筆。**

### 未驗到的

| 項目                             | 原因                                                               |
| -------------------------------- | ------------------------------------------------------------------ |
| ~~手機寬度下的外框（上下堆疊）~~ | **已於 Phase 2 量測，見下面 `## 390px`**                           |
| 五條連結實按                     | 目標由 `routerLink` 直接宣告，且四個目標本輪都另外開過網址驗過內容 |
| 流場動畫的實際行為               | 純裝飾，無互動                                                     |

## 390px

- **量測**：390 × 844 ／ 前端 `3f2197f8`（主 checkout 的 dev server，port 4200）／
  **不需登入**（外框不看登入狀態，Phase 1 已證），以 `/qr-checkin` 量（`<main>` 內 0 個互動元素）
- **手段**：同源 iframe 當 viewport（`resize_window` 在這台機器上是空操作，見方法頁 Phase 2 一節）

### 版面怎麼變：二欄 → 上下堆疊

| 視窗       | `<aside>` 品牌面             | `<main>` 白面       |
| ---------- | ---------------------------- | ------------------- |
| 390 × 844  | `390 × 304`（在上）          | `390 × 540`（在下） |
| 768 × 1024 | `768 × 330`                  | `768 × 694`         |
| 1024 × 768 | `1024 × 276`                 | `1024 × 492`        |
| 1504 × 752 | 左欄（`minmax(340px, 40%)`） | 右欄（`1fr`）       |

**切換點是 `respond-to('tablet-landscape')`，也就是 `max-width: 1024px`（含等號）** ——
所以 **1024 仍然是堆疊的，1025 才變二欄**。這比一般直覺晚很多：
「平板橫向」在這支外框上算手機那一側。

⚠️ **品牌面的高度由視窗高決定，不是由寬度**：
`calc(var(--window-height) * 0.36)`，夾在 `min-height: 232px` 與 `max-height: 330px`。
所以上表三個高度（304 / 330 / 276）是三個視窗高算出來的，**不是三個斷點**
—— 768 那格會是 330 純粹因為 `1024 × 0.36 = 368.6` 撞到上限。

捲動容器在堆疊版是 `.public-shell` 自己（`overflow-y: auto`），不是內層 `main`
—— 往下捲時品牌面會跟著捲走，長表單頁（報名 / 試聽）拿得到整個螢幕高度。
（理由寫在 `public-shell.component.scss` 的 responsive 區塊裡。）

### 差集（1504 ↔ 390 ↔ 768 ↔ 1024）

**零差異。** 四個寬度都是同樣 5 個互動元素、同樣的 `href`、同樣的可見性：

| 元素        | 390        | 768        | 1024       | 1504 |
| ----------- | ---------- | ---------- | ---------- | ---- |
| `Clessia`   | `350 × 32` | `728 × 32` | `984 × 32` | 字標 |
| 登入        | `26 × 23`  | 同         | 同         | 同   |
| 試聽申請    | `52 × 23`  | 同         | 同         | 同   |
| 我要報名    | `52 × 23`  | 同         | 同         | 同   |
| QR 到班打卡 | `74 × 23`  | 同         | 同         | 同   |

字標寬度跟著品牌面走（`350 / 728 / 984`），四條連結的尺寸**四個寬度完全相同**
—— 它們沒有任何 RWD 處理。

**沒有漢堡鍵、沒有收起來的東西、沒有手機專用元素。**

### 水平溢出

**無。** 390 / 768 / 1024 三個寬度的 `documentElement.scrollWidth` 都等於 `innerWidth`，
撐出界的元素 0 個。

### 觸控目標 < 44px

**五個全部不足，而且一個都沒有 `(pointer: coarse)` 規則接住** ——
也就是說在真手機上它們就是這個尺寸：

| 元素                  | 尺寸       | coarse |
| --------------------- | ---------- | ------ |
| `.public-shell__logo` | `350 × 32` | 無     |
| 登入                  | `26 × 23`  | 無     |
| 試聽申請              | `52 × 23`  | 無     |
| 我要報名              | `52 × 23`  | 無     |
| QR 到班打卡           | `74 × 23`  | 無     |

`.public-shell__link` 的 SCSS 只有 `padding-bottom: 2px` 與字級，**沒有任何尺寸下限** ——
那 23px 是 `--text-md` 的行高。這正是 `touch-target` gate 檔頭描述的那個形狀
（「宣告了 `cursor: pointer` 卻沒有任何尺寸下限」），**但這幾條是 `<a routerLink>`、
沒有寫 `cursor: pointer`**，所以 gate 的訊號抓不到它們。

**記現況，不在這裡判定是不是缺陷。**

### 鍵盤可達性

- 全頁**沒有正數 `tabindex`** → Tab 序列 = DOM 序。
- **Tab 序列**：`Clessia` → 登入 → 試聽申請 → 我要報名 → QR 到班打卡（5 個，**與視覺順序一致**）。
- **焦點看得見**：`outline: auto 1px rgb(0, 95, 204)`（瀏覽器預設環），`:focus-visible` 命中。
- 外框**沒有**任何 `<div>` 帶 `(click)` 的元素 —— 五個都是真的 `<a>`。
  （這一點跟 [[specs/sitemap/_shared/shell-layout]] 相反，那支有 7 個鍵盤到不了的點擊目標。）

### 未驗與原因

| 項目                   | 原因                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| 流場動畫在窄寬度的行為 | **分頁在背景，CSS 動畫與 `requestAnimationFrame` 都不跑**（坑 12）。純裝飾、無互動  |
| `Escape` / 真的 Tab 鍵 | 需要前景分頁（方法頁 Phase 2 有證據）                                               |
| 五條連結實按           | 同 1504：目標由 `routerLink` 直接宣告，四個目標本輪都另外開過網址                   |
| `(1024, 1280]` 這一段  | 四個量測寬度跳過了它 —— **而這支外框的切換點正好是 1024**，所以 1025 附近沒有人量過 |

## 載入中 / 錯誤

**不適用 —— 這個外框自己不取任何資料。**

結構事實：`features/public/public-shell.component.ts` **一個 `inject()` 都沒有**
（`grep -n "inject(" …` 回空），模板只有品牌面與四個 `routerLink`。

六個公開頁各自的狀態在各自的地圖裡，而**六頁裡五頁的請求數是 0**、
`/login` 只有一支 `GET /api/me`（見 [[specs/sitemap/public/login]]）。

> 同上一則的證據等級提醒：攔截器裝在載入之後，所以這一節不靠執行期量測，靠 `grep`。
