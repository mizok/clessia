---
title: 登入體驗與角色選擇的設計
summary: 登入頁重設計（品牌卡片 + LINE 官方規範按鈕）與角色選擇回歸彈窗體感 —— /select-role 路由保留為唯一入口，薄殼自動開動態載入的彈窗，bundle 不回胖、無限重導向不回歸。
category: architecture
status: active
updated: 2026-08-29
tags: [architecture, login, select-role, ux]
---

# 登入體驗與角色選擇的設計

> 2026-08-29 設計。回應使用者對 #34 之後體驗的三點回饋：路由跳轉延遲
> （已由 route preloading 解，另一支 PR）、登入頁太陽春、偏好彈窗式角色選擇。

## 一個先想清楚的事實：OAuth 之後沒有「原地彈窗」這回事

密碼時代的角色彈窗是 SPA 內互動：送出表單 → 回應 → 原頁開彈窗，零導航。
LINE OAuth 是**整頁離開再整頁回來**（導去 LINE → 授權 → 導回 callbackURL）——
登入後的第一眼**必然**是一次全新的頁面載入。所以「彈窗 vs 路由」不是二選一：

**`/select-role` 路由是唯一入口，它的長相是彈窗。**

## 角色選擇：彈窗體感 + 路由骨架

| 層     | 設計                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------- |
| 路由   | `/select-role` 保留（LINE callbackURL、guards、shell 的「切換角色」全部指向它 —— #34 修好的無限重導向不回歸）             |
| 元件   | 薄殼：品牌底（同登入頁的背景語言）+ 進場即開角色彈窗。彈窗**不可關閉略過**（沒選角色就沒有下一步），Esc/backdrop 點擊不關 |
| 載入   | DynamicDialog 與彈窗元件**動態 import**（`await import(...)`）—— 初始 bundle 維持 575 kB，一克不回胖                      |
| 單角色 | 根本不進這條路：既有邏輯直接導向對應 shell，不變                                                                          |
| 收斂   | 開彈窗的邏輯只有一份（薄殼裡），不再有 root component / route 兩套各做一半                                                |

**拒絕的替代方案**：

- 回到 root component 掛 DialogService —— 140 kB 回到初始 bundle，且 OAuth 流程下根本沒有它服務的「原地」場景
- 純整頁（#34 現狀）—— 使用者明確偏好彈窗體感

## 登入頁重設計

現狀：一顆孤零零的按鈕。目標：家長與提案對象的第一眼要有品牌與信任感。

方向（實作時 invoke `frontend-design` + `ui-ux-pro-max` + `angular-scss-bem-standards`）：

1. **置中卡片**：Clessia 品牌名 + 一句補習班場景的 tagline、卡片陰影用既有 tokens
2. **背景**：Zinc 底 + Sky accent 的柔和漸層或幾何紋理 —— 用既有 design tokens，
   不引入新色票；禁 viewport 單位（c6），用 `--window-*` 變數
3. **LINE 按鈕遵循 LINE 官方品牌規範**：官方綠 `#06C755`、LINE logo、規範留白 ——
   家長認得的按鈕長相就是信任感。這是唯一允許的 token 外顏色（第三方品牌色）
4. 按鈕下方輔助文案：說明用 LINE 登入、以及「還沒有帳號？請聯絡櫃檯」的出口
5. 既有的報名連結顯示邏輯（`showEnrollmentLink`）保留
6. 角色彈窗同一設計語言：角色卡片（圖示 + 管理員/老師/家長標籤），點選即進

## 文件同步

- AGENTS.md「多重角色 → 登入後進 `/select-role`」改為「→ `/select-role`
  （彈窗式角色選擇的載體，見本文件）」—— 使用者判定原措辭過時
- [[specs/public/login]] 隨新版面更新

## 影響的既有元件

- `features/select-role/`（改為薄殼 + 彈窗內容拆分）
- `features/public/pages/login/`（重設計）
- `app.routes.ts` 不動（路由已存在）；root component 不動（維持純 router-outlet）
- 測試：多角色導向的既有測試全部沿用；新增「彈窗不可略過」「動態 import 成功」
