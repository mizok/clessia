---
title: 釘底的面板撞上行動瀏覽器的視窗
summary: 兩個獨立的缺口都打在同一個位置——釘底面板最下面那排按鈕。一個是 --window-height 用 innerHeight 且只聽 window:resize（iOS 工具列收合發的是 visualViewport.resize），一個是全 repo 沒有任何 env(safe-area-inset-*)。兩者都未經真機確認。
category: lesson
status: active
updated: 2026-09-05
tags: [lessons, mobile, viewport, ios, known-gap]
---

# 釘底的面板撞上行動瀏覽器的視窗

`.roster-sheet` 在手機是 `position: fixed; inset: auto 0 0` —— **貼著螢幕底緣**。
點名面板與教務日誌面板（#346）都用它，所以這不是單一畫面的問題。

**兩個獨立的缺口，都正好打在同一個位置：面板最下面那排按鈕。**

## 缺口一：變數在工具列狀態改變的那一刻是舊的

`WindowSizeDirective` 寫 `--window-height` 用的是 **`window.innerHeight`**，
而且**只聽 `window:resize`**。

iOS Safari 的底部工具列收合／展開時**不會可靠地觸發 `resize`** ——
它發的是 `visualViewport` 的 `resize`。所以：

> **直接開面板直接看，很可能是好的。** 問題只在工具列**狀態切換過之後**才出現。

這一句是驗證步驟的核心，也是為什麼那份步驟要求
「先捲動讓工具列縮小 → 再開面板 → 再讓工具列恢復」。
**沒有這個理由，那三步會被下一個人當成多餘而優化掉。**

另有一層：`position: fixed` 的百分比解析對象是 ICB，而 iOS Safari 的 ICB 是
**大視窗**（工具列隱藏時的高度）—— 所以即使變數是對的，貼底元素仍可能延伸到工具列底下。

## 缺口二：會覆蓋導覽列的抽屜，撞得到 home indicator

掃過 `styles.scss`：**一處 `env(safe-area-inset-*)` 都沒有**。

### 範圍比第一版寫的窄——導覽列擋掉了大部分

原本這裡寫「任何 `position: fixed; bottom: 0` 的東西都會中」。
**那是過度歸納**，2026-09-05 使用者用實機截圖修正：管理端頁面底部有一排導覽列
（儀表板／通知中心／課程管理／課堂管理／更多），**它本身就佔住底部**，
一般頁面的內容不會延伸到那條橫槓。

歸納的方向與證據都對，**只是把一個既有的保護機制漏算了**。

### 但抽屜不受那個保護

`.roster-sheet` 是 `position: fixed; inset: auto 0 0`，它**覆蓋在導覽列上面** ——
**被覆蓋的導覽列保護不了覆蓋它的東西**。抽屜底緣就是螢幕底緣，
那排按鈕仍然落在橫槓的位置。

所以適用範圍是「**會覆蓋導覽列的 fixed 抽屜**」，不是所有貼底元素。
已知實例仍是兩個（點名、教務日誌），**仍然是模式不是個案**。

> 記下這個修正的理由，是為了讓下一個人不必重新推導出同一個過寬的結論。
> **過度歸納的代價比漏看小，但不是零。**

> **真機那一趟主要要驗的是缺口一。** 它跟導覽列無關，導覽列擋不住它；
> 缺口二降級成抽屜專屬的小補丁。

## 為什麼還沒修

**兩者都沒有在真機上確認過**，而 2026-09-05 的真機驗證要驗的正是這條假設本身。

> 現在去修，等於用猜的答案覆蓋掉唯一一次能拿到真答案的機會。

修的方向已經查好（留給拿到結果的人）：
directive 改讀 `window.visualViewport?.height` 並加聽它的 `resize` / `scroll`，
`innerHeight` 當 fallback；釘底的面板補 `padding-bottom: env(safe-area-inset-bottom)`。
**全 repo 目前沒有用過 `visualViewport`**，所以那會是第一次。

## 相關

- [[lessons/a-field-is-a-snapshot-not-a-path]] —— 同一輪的另一個「用一個值推產生它的過程」
