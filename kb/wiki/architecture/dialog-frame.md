---
title: 對話框與貼底面板的共用規則（app-dialog-frame）
summary: 全站對話框收斂成共用殼 app-dialog-frame（h2＋副標＋關閉、內距、sticky 底部、手機貼底抽屜的底部留白）；寬三種 --dlg-w-sm/md/lg、左右內距 --dlg-pad-x（24／手機 16）、貼底底部留白 --sheet-foot-gap＋safe-area 只墊一次；進退場時長走 --motion-* token，減少動態時只淡入淡出。#2290 第 3 步分批遷移中。
category: architecture
status: developing
updated: 2026-11-06
tags: [architecture, dialog, a6, motion, accessibility]
---

# 對話框與貼底面板的共用規則

> 出處：#2290（使用者 11-05「全面盤一下 dialog 與從下往上開的 panel，統一 layout」）。盤點（93 個）與提案在
> issue 的第 1、2 步留言；Q1～Q3 照建議（計畫席 11-05 轉達）。**遷移是分批的**：還沒換殼的對話框照舊，
> 換殼時照這一頁。

## 用法

```html
<app-dialog-frame title="從某日起改時段" [sub]="說明" (closed)="cancel()">
  …內容…
  <ng-container dialogFoot>
    <p class="form-dialog__why">還沒填：…</p>
    <!-- 選填，靠左 -->
    <button …>取消</button><button …>確定</button>
  </ng-container>
</app-dialog-frame>
```

- 副標要放按鈕或清單（教室對話框的教室清單＋「⋯」）：投影 `<p dialogSub class="dialog-header-inline__sub">…</p>`，放在 h2 之後；字串 `sub` 照舊，兩者擇一。
- **有 `<form>` 的對話框**：送出鈕在殼的底部列、已經在 form 外面，要寫 `<button type="submit" form="<form 的 id>">`，**不綁 `(click)`**，只留 form 的 `(ngSubmit)` 一條路 —— 不指回表單，欄位按 Enter 就不送出（鍵盤退步）；兩條都留，按一次送兩次（#2362 二讀）。
- 開窗端（DynamicDialog）：`width: 'var(--dlg-w-md)'`、`showHeader: false`；**不寫 `breakpoints`**（≤860 會被全站 `.p-dialog` 的 `width: 100% !important` 蓋掉，寫了也沒作用）。
- 原生 `<dialog>`：殼放在 `<dialog>` 裡；`<dialog>` 自己帶 `aria-labelledby` 或靠殼的 `appDialogTitle`（找最近的 `[role=dialog]`）。

## 規則

| 項目           | 規則                                                                                                                                                                                                                                                    | 出處                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 標頭           | h2 20px 粗體＋（副標 13px）＋右邊 ✕；沒有分隔線、圖示、頭像、麵包屑                                                                                                                                                                                     | A6 `.acset__head`、`.fdlg__sub` |
| 可及名稱       | h2 掛 `appDialogTitle`（殼內建）。`showHeader: false` 時 PrimeNG 不掛 `aria-labelledby`，不補就只念「對話框」                                                                                                                                           | `dialog-title.directive.ts`     |
| ✕              | `aria-label="關閉"`；手機 44、桌機 40                                                                                                                                                                                                                   | A6 `.acset__x`；R3／A27         |
| 標頭內距       | 桌機 `16 16 8 24`；手機左距 16（跟內容對齊，A6 是 24）                                                                                                                                                                                                  | A6；#2290                       |
| 寬             | `--dlg-w-sm` 420（單一欄位的小對話框；**確認對話框用 md**：A6 `confirmDel` 是 `.fdlg` 520，#2290 ConfirmDialog）／`--dlg-w-md` 520（預設：表單、詳情）／`--dlg-w-lg` 760（寬內容）                                                                                                                                                              | A6 `.fdlg` 520、`.gdlg` 760     |
| 內容內距       | `--dlg-pad-x` 24／手機 16；上 8、下 24（手機 16）；`.p-dialog-content` 歸 0                                                                                                                                                                             | A6 `.acset__body`               |
| 底部           | 有動作就 sticky；靠右、次要在左主要在右；左邊可放「還沒填」                                                                                                                                                                                             | A6 `.fdlg__foot`、`.gdlg__foot` |
| 貼底抽屜的底部 | 底部列下內距＝`--sheet-foot-gap`（16）＋safe-area；沒有底部列時內容區最後留同一個值。**抽屜本體照 A6 貼底**（`margin: auto 0 0`），不浮起                                                                                                               | 使用者 11-05；#2290 Q1(b)       |
| safe-area      | 只墊一次：用殼／a6 底部列的對話框，`.p-dialog` 本體不墊                                                                                                                                                                                                 | #2290                           |
| 手機形狀       | ≤860 一律貼底抽屜（**白底** `--sheet-bg`、上兩角 12px；稿是灰底，使用者 11-05 改白，原生 `<dialog>` 寫 `max-wide:bg-(--sheet-bg)`）。例外：選身分（置中，A6 `.rp-dlg`）、登入（置中，R5 10-23）、全站搜尋、桌機篩選浮層、快速選取與成績編輯（永遠貼底） | A6 `.acset`；#2290 第 2 步 §6   |

## 動態

時長只在 `styles.css` 的 `:root` 定：`--motion-enter` 200ms、`--motion-exit` 140ms、`--motion-sheet-enter` 240ms、`--motion-sheet-exit` 160ms；曲線 `--arrive`／`--leave`（#1634）。

| 形狀                                                                                     | 進場             | 出場  |
| ---------------------------------------------------------------------------------------- | ---------------- | ----- |
| 置中對話框                                                                               | 淡入＋scale 0.97 | 反向  |
| 貼底抽屜（含手機上所有 DynamicDialog、`overlay-motion--from-bottom(-narrow)`、p-drawer） | 由下滑入 240ms   | 160ms |
| 側面板（`overlay-motion--from-right`）                                                   | 由右 24px＋淡入  | 反向  |
| 浮層／選單                                                                               | 淡入＋往下 6px   | 反向  |
| toast                                                                                    | 由下 12px        | 反向  |

**減少動態**（`prefers-reduced-motion`）：彈出物**只淡入淡出**，不位移、不縮放（`--pop-from: none`；p-drawer 換成只動透明度的 keyframes；toast 拿掉位移）。這是**偏離 A6** 的（A6 全部關掉）—— 使用者 11-05 #2290 Q2，R5 有登記。收合段落與換頁不在此列（見 [[architecture/motion]]）。

內容載入用骨架換內容，不在外框之外再疊 opacity；只改 hash 的導覽不跑換頁 VT（#2297）。

## 遷移進度

#2290 第 3 步分批（每張 ≤400 行、兩寬 compare）。① 殼＋token＋動態，示範：衝堂提醒、拆時段（開課班表單裡）。
其餘家族的批次在 #2290 第 2 步 §10。報名／請假／人員頁的對話框由另兩席遷移。
