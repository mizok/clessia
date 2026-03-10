# 手機版清單視圖 UX 重設計

## 問題

手機版清單視圖有三個嚴重的可用性問題：

1. **Batch bar 佔半個螢幕** — 4 個操作按鈕 + 計數 + 取消選取，inline 在 card 底部擠成多行
2. **表格可視區域極小** — card 雙層裝飾框（cal__card + responsive-table border）吃空間，加上篩選器和 header，表格不到螢幕 40%
3. **篩選器被截斷** — 水平捲動的篩選器在手機上看不到全部，也不知道還有更多

### 使用情境

手機端主要是「瀏覽 + 單堂操作」，批次操作偶爾使用。

## 設計

### 1. 空間最大化

- **移除手機版 card 裝飾** — `cal__card` 在手機上去掉 border-radius / box-shadow / border，變成全寬平面區域。responsive-table border 改成只留 top/bottom 分隔線
- **表格佔滿剩餘高度** — card 區域用 `flex: 1; min-height: 0` 撐滿可用空間
- **Checkbox 欄縮小** — 從 48px 改成 36px

### 2. Bottom Sheet 批次操作

手機版的 batch bar / batch panel 從 inline 改成 bottom sheet 模式。

**Floating bar：** 勾選後固定在螢幕底部（nav bar 上方），高度 48px：

```
┌─────────────────────────────────┐
│  ✓ 已選 4 堂    [操作]   [✕]   │
└─────────────────────────────────┘
```

**Bottom sheet（PrimeNG Drawer position=bottom）：** 點「操作」從底部滑出：

- 初始狀態：4 個操作選項，每個是一整行 list item（icon + label），類似 iOS action sheet
- 點選操作後：sheet 內容切換成該操作的表單（選老師 select / 時間 input / 原因 input），底部有「預覽」→「確認」按鈕
- 有 backdrop 遮罩，點外部關閉

**桌面版不變** — batch bar + batch panel 保留現有 inline 設計。

### 3. 篩選器收合

手機版篩選器改成一行兩元素：

```
┌──────────────────────────────────┐
│  [3/5 – 3/31  📅]   [篩選 ▾]   │
└──────────────────────────────────┘
```

- 左：日期範圍 picker（永遠可見）
- 右：「篩選」按鈕 + badge（顯示啟用中的篩選數量）

**點「篩選」→ 展開 overlay panel：**

```
┌──────────────────────────────┐
│  分校    [示範分校      ▾]  │
│  課程    [所有課程      ▾]  │
│  老師    [所有老師      ▾]  │
│  班級    [所有班級      ▾]  │
│                    [清除全部] │
└──────────────────────────────┘
```

- 每個 select 佔滿寬度
- 不自動收合，點外部或按鈕關閉
- 桌面版保留現有水平排列

## 技術選型

| 元件 | 實作方式 |
|------|---------|
| Bottom sheet | PrimeNG `Drawer` (`position="bottom"`) |
| 篩選器 overlay | `@if` 切換顯示 + backdrop |
| Floating bar | `position: fixed; bottom: var(--mobile-nav-height)` |
| 手機判斷 | 現有 `BrowserStateService.isMobile` signal |

## 不變的部分

- 桌面版所有功能和佈局不變
- 單堂 `⋯` context menu 不變（已經是 popup，手機上沒問題）
- 行事曆格子視圖不變（本次只改清單視圖的手機版）
