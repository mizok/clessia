---
title: 對話框與貼底面板的共用規則（app-dialog-frame）
summary: 全站對話框收斂成共用殼 app-dialog-frame（h2＋副標＋關閉、內距、sticky 底部、手機貼底抽屜的底部留白）；寬三種 --dlg-w-sm/md/lg、左右內距 --dlg-pad-x（24／手機 16）、貼底底部留白 --sheet-foot-gap＋safe-area 只墊一次；進退場時長走 --motion-* token，減少動態時只淡入淡出。手機操作量分級（L1～L4：選填收合、抽屜內分步 app-dialog-steps、整頁），送出鈕一律在 sticky 底部列。#2290 第 3 步分批遷移中。
category: architecture
status: developing
updated: 2026-11-10
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
- **確認對話框**（`ConfirmDialogComponent`）：關窗結果主鈕 `true`、次要鈕 `false`、✕／Esc `undefined` —— 次要鈕本身是第二個動作時（請假「完全刪除」）用 `=== false` 分辨；只是告知、沒有第二個選擇時給 `rejectVisible: false`（學校「它已經停用了」）。訊息可用 `\n` 分行。全站已無 `p-confirmdialog`／`ConfirmationService`（#2290）。
- 開窗端（DynamicDialog）：`width: 'var(--dlg-w-md)'`、`showHeader: false`；**不寫 `breakpoints`**（≤860 會被全站 `.p-dialog` 的 `width: 100% !important` 蓋掉，寫了也沒作用）。
- 原生 `<dialog>`：殼放在 `<dialog>` 裡；`<dialog>` 自己帶 `aria-labelledby` 或靠殼的 `appDialogTitle`（找最近的 `[role=dialog]`）。

## 規則

| 項目           | 規則                                                                                                                                                                                                                                                                                                                                                                         | 出處                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 標頭           | h2 20px 粗體＋（副標 13px）＋右邊 ✕；沒有分隔線、圖示、頭像、麵包屑                                                                                                                                                                                                                                                                                                          | A6 `.acset__head`、`.fdlg__sub` |
| 可及名稱       | h2 掛 `appDialogTitle`（殼內建）。`showHeader: false` 時 PrimeNG 不掛 `aria-labelledby`，不補就只念「對話框」                                                                                                                                                                                                                                                                | `dialog-title.directive.ts`     |
| ✕              | `aria-label="關閉"`；手機 44、桌機 40                                                                                                                                                                                                                                                                                                                                        | A6 `.acset__x`；R3／A27         |
| 標頭內距       | 桌機 `16 16 8 24`；手機左距 16（跟內容對齊，A6 是 24）                                                                                                                                                                                                                                                                                                                       | A6；#2290                       |
| 寬             | `--dlg-w-sm` 420（單一欄位的小對話框；**確認對話框用 md**：A6 `confirmDel` 是 `.fdlg` 520，#2290 ConfirmDialog）／`--dlg-w-md` 520（預設：表單、詳情）／`--dlg-w-lg` 760（寬內容）                                                                                                                                                                                           | A6 `.fdlg` 520、`.gdlg` 760     |
| 內容內距       | `--dlg-pad-x` 24／手機 16；上 8、下 24（手機 16）；`.p-dialog-content` 歸 0                                                                                                                                                                                                                                                                                                  | A6 `.acset__body`               |
| 底部           | 有動作就 sticky；靠右、次要在左主要在右；左邊可放「還沒填」                                                                                                                                                                                                                                                                                                                  | A6 `.fdlg__foot`、`.gdlg__foot` |
| 貼底抽屜的底部 | 底部列下內距＝`--sheet-foot-gap`（**24**，使用者 11-06 #2396；原 16）＋safe-area；沒有底部列時內容區最後留同一個值。**沒走殼的也一樣**：p-dialog 的 `.p-dialog-footer`、貼底 p-drawer 的內容區（styles.css 全站規則）、原生 dialog 的貼底面板自己寫 `pb-[calc(var(--sheet-foot-gap)+env(safe-area-inset-bottom,0px))]`。**抽屜本體照 A6 貼底**（`margin: auto 0 0`），不浮起 | 使用者 11-05；#2290 Q1(b)       |
| safe-area      | 只墊一次：用殼／a6 底部列的對話框，`.p-dialog` 本體不墊                                                                                                                                                                                                                                                                                                                      | #2290                           |
| 手機形狀       | ≤860 一律貼底抽屜（**白底** `--sheet-bg`、上兩角 12px；稿是灰底，使用者 11-05 改白，原生 `<dialog>` 寫 `max-wide:bg-(--sheet-bg)`）。例外：選身分（置中，A6 `.rp-dlg`）、登入（置中，R5 10-23）、全站搜尋、桌機篩選浮層、快速選取與成績編輯（永遠貼底）                                                                                                                      | A6 `.acset`；#2290 第 2 步 §6   |

## 操作量分級（手機）

> 出處：使用者 11-06（#2396 裁定 4）「手機版的彈窗一次塞了太多操作手續，會變得很難操作」；規則 gate：#2396 issuecomment-6676943057（計畫席過）。盤點 91 支在 #2396。**只管手機（≤860），桌機不變。**

**怎麼數**：可填欄位＝一個 input／select／textarea／日期，或一組 radio／checkbox 算 1（可重複列每列另計）；清單＝勾選或可操作的名單、預覽表；多步＝預覽→確認、分頁、tab。

| 級      | 判準                              | 手機做法                                                                                                                                      |
| ------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| L1 輕量 | ≤4 欄、沒有內嵌清單               | 單一抽屜                                                                                                                                      |
| L2 中量 | 5～8 欄                           | 主要／必填在上；選填收進一個原生 `<details>`「更多設定（N 項）」預設收合，**編輯時選填已有值就預設展開**；「還沒填：…」照舊列出收在裡面的必填 |
| L3 重量 | >8 欄、或清單＋表單、或本來就多步 | 抽屜內分步（下面）                                                                                                                            |
| L4 整頁 | L3 且有可重複列或會疊第二層對話框 | 手機改整頁（開課班、學生表單，各自設計）                                                                                                      |

**全級共通**：送出／主要動作一律在殼的 sticky 底部列，**不放內容區**；底部列最多「1 主要＋1 次要」，其他動作進標題旁「⋯」或內容區的連結樣式。

**L3 分步怎麼寫**：

- 一步一件事；**內容區第一行**放 `<app-dialog-steps [current] [total] [label]>`（「第 2／3 步 · 計費」，只在手機顯示、`aria-live`）
- **內容區第一行的先後**（計畫席 11-10 裁，#2404）：步驟標示（導覽）在前，B 類識別資訊（是誰／哪天／哪班，`data-part="dialog-context"`，副標拆掉後搬進內容區的那行）緊接其後，兩者都有時各一行；只有一個時就它是第一行。字級（計畫席 11-10 裁）：**B 類識別資訊一律 `text-sm text-zinc-600`**，不分有沒有步驟標示；**C 類內容本體**（確認訊息、「X／Y 已登錄」、帳單狀態、停用／改時段／收款要看的說明）是做決定要讀的正文，用 **`text-base text-zinc-700`**
- 底部列：第一步左「取消」；之後左「上一步」（次要）、右「下一步」（橘 cta —— A6 `DIRECTION.md:17`「步驟頁『下一步』是橘」）；最後一步主鈕寫動作名
- **只在手機分步、桌機單頁**：每段都渲染，手機用 `max-wide:hidden` 藏起不是目前那步的段落；上一步／下一步只在 `max-wide:` 出現，桌機只有原本的送出。表單狀態只有一份
- 驗證：按「下一步」只驗這一步，沒過寫在底部列左側「還沒填：…」，不前進
- Enter：照上面 `<form>` 那條（`type="submit" form="<id>"`、只走 `(ngSubmit)`）；`ngSubmit` 用 `dialogStepsActive()` 在送出那一刻判斷 —— 手機且還沒到最後一步＝下一步，否則＝送出。spec 守點鈕／Enter 各一次，手機與桌機各一
- 換步後焦點移到新一步的第一個欄位；上一步回來保留已填的值
- Esc／✕ 照舊關整個對話框（不是上一步）
- 編輯、或有預帶的步驟（例：預帶學生），從下一步開始，沒有「上一步」回到預帶那步

**L4 整頁怎麼寫**（#2396 issuecomment-6764246224，開課班 gate 過；學生表單沿用）：

- **桌機照舊對話框，手機導到頁面路由**：開窗端在點擊當下用 `dialogStepsActive()` 判斷，手機就 `router.navigate` 到頁面（例 `/admin/courses/:courseId/classes/new`、`…/:classId/edit`；`new` 要排在 `:id` 路由前面）。路由進 `RoutesCatalog`（`showInMenu: false`），直接打網址也能用
- **同一支表單、兩種宿主**：頁面元件只做三件事 —— 抓表單要的資料（開窗端原本塞進 `data` 的那些）、在自己的 `providers` 換上 `PageDialogRef`（`shared/utils/form-page.util.ts`，`close()`＝站內進來回上一頁、直接打網址回 `fallback`）與空的 `DynamicDialogConfig`、資料到了才渲染表單（表單在建構時讀 `config.data`）。**表單元件不分兩份、不改**，只多一個唯讀 `hasChanges()`
- **結果不用帶回**：回到來源頁時元件重建、本來就會重抓；來源頁的篩選與展開要存在 root service（課程頁 `CoursesFilterStateService`），不然回來會重設
- **離開保護**：路由掛 `canDeactivate: [formPageLeaveGuard]`，頁面實作 `canLeave()`：沒改過放行；改過開 `ConfirmDialogComponent`「放棄未儲存的變更？」（主鈕「放棄」才放行，「繼續編輯」與 ✕ 留下）；存檔成功（`close` 帶了結果）之後不問。對話框模式不加這層
- **版面**：頁面宿主 host 掛 `form-page`，shell 看到它就不加內距（`.shell-content` 的 `has-[app-page-open,.form-page]`）—— 有內距的話表單底部列的 sticky 會浮在內距上方；殼（`app-dialog-frame`）照用，✕＝返回。host 還要給殼白底（`[&_.dialog-frame]:bg-white`）：殼的底部列是 `background: inherit`，頁面裡外層沒底色就變透明，捲動中的欄位會從底部列下面透出來
- **第二層對話框**：照舊由表單自己的 `DialogService` 開，疊在頁面上
- **已知缺口：Enter 不送出**。開課班、學生表單都沒有 `<form>`、送出鈕直接綁 `(click)`，欄位按 Enter 不送出（對話框模式本來就這樣）；整頁只換載體、行為不動，所以照舊沒補。要補時照上面「有 `<form>` 的對話框」那條（計畫席 11-10 gate，#2396）
- **conformance**：稿沒有整頁版 → R5 一列；compare 的 `appOpen.root` 寫成對話框與頁面皆可

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
