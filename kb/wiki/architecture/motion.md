---
title: 全站動態規則（設計稿：換頁方向、頁內切換、列表補位、數字變化）
summary: 設計稿（#1635，未批准）。2026-10-16 在本機實跑盤點：頁內的狀態變化（換週、換日、日／週、篩選切換、tab）全部是瞬間替換；換頁只有內容區淡入淡出，而且沒有處理「減少動態」。提案：換頁依網址深度給方向（往深從右進、返回從左、同層從右 12px 淡入（#1849 使用者 10-22 改））；低頻的模式切換用同文件 view transition；連點型控制項（換週箭頭）不能用 VT —— 實測 VT 動畫期間的第二下點擊會被吞掉（規格：期間點擊一律打到 document element），改成內容層的 animate.enter；新增／刪除列照 A6 的 row-new，補位只在刪除時用 VT。曲線沿用 #1634 的 --arrive／--leave，不另訂。
category: architecture
status: draft
updated: 2026-10-22
tags: [architecture, motion, view-transition, a6, accessibility, performance]
---

# 全站動態規則（設計稿）

> **狀態：設計稿，未批准，不得據此寫實作碼。** 工單 #1635。
> **彈出物（dialog／popover／側面板／底部面板／`details` 收合）的進場與出場是 #1634，不在這裡。**
> 這一頁只沿用 #1634 已經在 `styles.css` 定義的兩條曲線 `--arrive`／`--leave`，不另訂曲線。
> 標「未證實」的地方是查不到官方文件，不是推論後當成事實。

## 結論先講

| 狀態變化                                | 現況（實測）                         | 提案                                                                                    |
| --------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| 換頁                                    | 內容區淡出 150ms／淡入 250ms，無方向 | 依網址深度：往深一層從右進、返回從左、同層從右 12px 淡入（#1849）；**補上「減少動態」** |
| 頁內模式切換（日／週、tab、篩選分段鈕） | 瞬間                                 | 同文件 view transition（`startViewTransition`），共同元素用 `view-transition-name` 平移 |
| 換週／換日（箭頭、日期格）              | 瞬間                                 | **不用 VT**（會吞掉連點，見 §3）。新內容依方向從左／右 12px 淡入（`animate.enter`）     |
| 新增一列                                | 瞬間                                 | A6 的 `row-new`：從上方 4px 淡入，240ms                                                 |
| 刪除一列、其餘列補位                    | 瞬間                                 | 被刪的列淡出（`animate.leave`），其餘列用 VT 補位                                       |
| 數字變化（「今天 N 堂課」、計數）       | 瞬間                                 | A6 的 `dd__v.is-new`：新值從下方 4px 淡入，170ms。**不做滾動數字**                      |

不加任何新的動畫套件：VT 是瀏覽器原生，`animate.enter`／`animate.leave` 是 Angular 21 編譯器內建（repo 現在是 `@angular/core` 21.1.3）。

---

## 1. 盤點（2026-10-16 本機實跑）

### 方法

Playwright（獨立瀏覽器 context，不碰共用的 Chrome session），admin／teacher／parent 三個角色，桌機 1440×900 與手機 390×844。
每個操作之後的 700ms 內，每一幀都取樣 `document.getAnimations()`（含 `::view-transition-*` 偽元素），同時攔截 `document.startViewTransition` 量快照時間。
**只點切換類的控制項**（tab、`aria-pressed`、上一／下一、分頁、`summary`），不點任何會寫入或刪除的按鈕 —— 所以「新增／刪除一列」是從程式碼確認的，不是實測（程式碼裡沒有任何 `animate.enter`／`animate.leave`／`.is-new`／`startViewTransition`）。

**使用頻率的排序是推估**：系統沒有使用量統計，排序依據是各角色每天的主要動線（行政開課表、老師看課表、家長看課表與帳單）。

### 結果（依推估頻率排序）

| #   | 頁面                        | 操作                                 | 現況                                                  | DOM 變動（次） |
| --- | --------------------------- | ------------------------------------ | ----------------------------------------------------- | -------------- |
| 1   | 全站                        | 換頁（選單、返回）                   | 內容區淡入淡出，無方向                                | —              |
| 2   | `/teacher/schedule`（手機） | 上一週／下一週、點日期格             | 瞬間                                                  | 39–132         |
| 3   | `/admin/sessions`           | 日／週切換、上一週／下一週、點日期格 | 瞬間                                                  | 178–545        |
| 4   | `/parent/schedule`（手機）  | 上一週／下一週                       | 瞬間                                                  | 77–111         |
| 5   | `/admin/dashboard`          | 三個摺疊區（到班、請假、逾期帳單）   | 瞬間（屬 #1634 的 `details`）                         | 1–2            |
| 6   | `/admin/leave`              | 「全部」篩選                         | 瞬間                                                  | 515            |
| 7   | `/admin/contact-book`       | 「只看未簽收」                       | 瞬間                                                  | 37             |
| 8   | `/parent/attendance`        | 近 30 天／選月份                     | 瞬間                                                  | 80–106         |
| 9   | `/parent/grades`            | 期間切換                             | 瞬間                                                  | 2–4            |
| 10  | `/admin/grades/exams`       | 全部／學校考試、分頁                 | 瞬間                                                  | 16–103         |
| 11  | `/admin/reports`            | 課程／月份                           | 瞬間                                                  | 118–147        |
| 12  | `/admin/fee-templates`      | 顯示停用方案                         | 瞬間                                                  | 49             |
| 13  | `/admin/settings/*`         | 分校／學校／科目／一般 tab           | 是換頁，走路由的 VT；tab 底線有 PrimeNG 的 250ms 平移 | 1103           |

現在**唯一有過程的狀態變化**：換頁的內容區淡入淡出、設定頁 tab 的底線（PrimeNG 自帶）、家長成績明細展開時箭頭的 120ms 旋轉。

### 盤點順手抓到的兩個問題

1. **換頁的 VT 沒有處理「減少動態」**：`styles.css` 的 `::view-transition-*(route-content)` 規則外面沒有 `prefers-reduced-motion`，開了「減少動態」的人照樣看到淡入淡出。這是無障礙的缺口，排在實作清單第一項。
2. **VT 動畫期間點擊會被吞掉**（§3）。現在的換頁 VT 已經有這個問題：內容區淡入的 250ms 內，點新頁面上的按鈕不會有反應。換頁很少連點，所以影響小；但如果把同一招套到換週箭頭上，影響就很大。

---

## 2. 動態規則

### 共通

- **曲線只有兩條，沿用 #1634**：進場 `--arrive`（`cubic-bezier(0.23, 1, 0.32, 1)`）、出場 `--leave`（`cubic-bezier(0.4, 0, 1, 1)`）。出場一律比進場短（A6 #990 原則：否則下一個東西要等它或跟它疊在一起）。
- **時長**：進場 200ms、出場 140ms（同 #1634）；新增列 240ms、數值變化 170ms（A6 原值）。**換頁例外**：使用者 2026-10-22 說「可以再慢一點」（#1891），換頁放慢約 1.4 倍 —— 往深一層／返回進 280ms、出 200ms，同層進 460ms、出 400ms；頁內切換（分段鈕、列增刪）維持 200／140ms。
- **位移只用小距離**：最多 24px（同 #1634 的側面板），不做整頁寬度的滑動 —— A6 唯一的整面平移是公開頁手機的兩面切換（`a6.css` 的 `.ps`，320ms），那是兩個並排的面，不是一般換頁。
- **減少動態**：一律關掉位移與過程，資訊直接出現。Chrome 官方提醒「減少動態」不等於完全不要動，建議改用更輕微的動畫（[Chrome：Same-document view transitions](https://developer.chrome.com/docs/web-platform/view-transitions/same-document)），**但 A6 的做法是全部關掉**（`a6.css:195` 把 transition 壓到 0.01ms）。A6 全採（[[architecture/a6-adoption-rules]] R1），所以照 A6。
- **不支援 VT 的瀏覽器直接瞬間切換**，不做替代動畫。

### 縮放：viewport `maximum-scale=1`（#1867）

iOS Safari 聚焦字級小於 16px 的輸入框會自動放大整頁（#1817 之後基底是 14px，全站輸入框都會中）。使用者 10-22 裁定**禁止放大**：
`index.html` 的 viewport 加 `maximum-scale=1`，**不加** `user-scalable=no`。推翻了原本「觸控裝置輸入框至少 16px、不關縮放」的做法。

- iOS 10 以後的 Safari 忽略 scale 限制，使用者自己兩指放大仍然可以；Android Chrome 會遵守，兩指放大被擋 —— 使用者接受的取捨。
- 輸入框字級照設計稿，不強制 16px。
- `app/ios-input-zoom.spec.ts` 守 meta（有 `maximum-scale=1`、沒有 `user-scalable`）。
- Playwright WebKit 的 iPhone 模擬**重現不了**聚焦放大（main 上 14px 的輸入框聚焦後 `visualViewport.scale` 也是 1），所以模擬器的 scale=1 不能當作這個問題修好的證據，要實機確認。

### 換頁：依網址深度決定方向

| 從 → 到                            | 例                                     | 動態                                          |
| ---------------------------------- | -------------------------------------- | --------------------------------------------- |
| 往深一層（目的地的網址段數比較多） | 學生列表 → 學生詳情；課程 → 開課班詳情 | 舊內容往左 24px 淡出，新內容從右 24px 淡入    |
| 返回（段數比較少）                 | 學生詳情 → 學生列表                    | 方向相反                                      |
| 同層                               | 選單在課表、學生、繳費之間切換         | 新內容從右 12px 淡入，舊內容原地淡出（#1849） |

- **同層的位移**（使用者 2026-10-22 裁定，#1849）：原本同層只淡入淡出，使用者覺得「比起瞬間淡入，還不如加上一點水平位移」，方向選「固定從右邊滑進」。距離 12px，比往深一層的 24px 小，兩種換頁分得出來；**舊內容原地淡出、不往左推** —— 推了會看起來像「返回」。時長原本沿用 #1681 的 340／300ms，#1891 放慢成 460／400ms；減少動態時照樣整個跳過。
- 判斷依據用網址段數（`/admin/students` 是 2 段、`/admin/students/:id` 是 3 段），**不另外維護一份層級表**。設定頁的 tab（`/admin/settings/campuses` ↔ `/admin/settings/schools`）同為 3 段，所以是同層（從右 12px 淡入），符合 tab 的語意。
- **瀏覽器的「上一頁」也是看段數**，不看是不是 popstate：從詳情按上一頁回列表是「返回」，從列表按上一頁回到某個詳情是「往深」。用段數比追蹤歷史紀錄簡單，而且結果跟使用者看到的層級一致。
- 只有 `route-content`（`.shell-content`）在動，側欄與頂欄不動（現況已經這樣做，保留）。

### 頁內模式切換：同文件 VT

**適用**：低頻、一次一下的切換 —— 日／週、篩選分段鈕（全部／學校考試、課程／月份、只看未簽收、近 30 天／選月份）、顯示停用方案。

- 共同元素用 `view-transition-name` 平移：分段鈕的「選中底色」、週列的「選中底線」。**名字必須唯一**，兩個元素同時用同一個名字，整個 transition 會被跳過（同上 Chrome 文件）—— 所以只把名字放在「目前選中的那一個」上。
- 其餘內容淡入淡出，不位移。
- 要用 types 區分「頁內」與「換頁」：頁內 VT 的時候 `route-content` 不能再整塊淡一次。用 `startViewTransition({ update, types: ['in-page'] })` 搭配 `:active-view-transition-type(in-page)` 把 `route-content` 的動畫關掉。

### 連點型控制項：不用 VT

**適用**：換週／換日的箭頭、日期格、分頁。

這類控制項的使用方式是「連按好幾下」，而 VT 動畫期間點擊會被吞掉（§3），所以**不用 VT**。改成：

- 內容區（課表格子、列表）依方向從右或左 12px 淡入，200ms，用 `animate.enter` 加一個方向 class。
- `animate.enter` 只在元素被建立時跑，不會擋住點擊。連點時新內容一直被替換，看到的是內容持續往同一個方向推進，不會累積。
- 週列「選中底線」用一般的 CSS transition（`left`／`width`）平移，不靠 VT。

### 列表：新增、刪除、補位

- **新增一列**：A6 的 `row-new` 原樣（`a6.css:803`：`translateY(-4px)`＋淡入，240ms，`--arrive`），用 `animate.enter`。
- **刪除一列**：`animate.leave` 淡出 140ms（`--leave`），Angular 會等動畫跑完才把元素移除（[Angular：Animations](https://angular.dev/guide/animations)）。
- **補位**：只在刪除時用 VT，畫面上看得到的列各給一個唯一名字，共用的動畫樣式用 `view-transition-class` 寫一次（同上 Chrome 文件）。新增不需要補位動畫：新列從上方淡入，下面的列只是被往下推。
- **前提是 `@for` 用真正的 id 當 `track`**。repo 裡有 11 處 `track $index`，大多是固定清單；套用到某個列表之前要先檢查那一處，否則被刪的會是錯的那一列。
- 「重新整理整份列表」（篩選、換分校）不算新增或刪除，照「頁內模式切換」處理，**不讓每一列都跑一次進場**。

### 資料回來撐開版面：高度滑過去（#1853）

使用者 10-22：「跳改成滑沒有問題」。骨架換成真資料、內容變高變矮這種**不是使用者操作造成**的位移，不用 VT（VT 期間點擊被吞，§3），
改成容器高度用 WAAPI 從舊高度滑到新高度：`shared/directives/height-follow.directive.ts`（`appHeightFollow`，200ms `--arrive`）。

- 掛在容器上，量的是它的**第一個子元素**（要是 block）。第一次從 0 長出來（例如 `<details>` 剛打開）不動 —— 那段交給元件自己的展開過渡，不疊兩段。
- 減少動態時不動；動畫中 `overflow: clip`，結束就拿掉。
- 舊內容是空的時候（第一次載入、上次失敗）不要再包 VT 換場 —— 沒有東西可以交叉淡化，只剩高度要滑。
- **區塊要從第一幀就在**（#1859 第 4 張）：資料回來才出現的區塊包一層 `appHeightFollow` 沒有用（從 0 長出來不動）。
  骨架放在區塊**裡面**（共用 `app-skeleton`，形狀跟內容一樣，#1879），區塊一開始就有高度，資料回來是「變高」而不是「出現」。
  儀表板就是這樣：待處理＋主段包成一塊，模式（日到班／逐堂）還不知道時先放段標＋列的骨架。
- **真的只能從 0 長出來的**（帳單頁「N 筆報名還沒開帳單」提示：沒有待辦就不佔位）加 `appHeightFollowGrow`：
  連 0 → N、N → 0 也滑；頁面剛畫出來那一次量到的高度只記下、不動。
- **距離長的滑久一點**：`--arrive` 前快後慢，200ms 滑 1300px 第一幀就走掉 1/3（儀表板手機實測一步 445px，看起來還是跳）。
  每 px 0.4ms、500ms 封頂，500px 以內維持 200ms。
- **建立的那一幀先停在舊高度、下一幀才開始走**：建立動畫的那一幀常常很重（剛畫出一整串列，dev 實測 60ms），
  直接 play 的話畫面上第一次看到的已經是 1/3 的位置。
- 驗收用逐幀跳動（`tools/a6-conformance/jump.mjs`，相鄰兩幀最大跳動 px），不用 layout-shift —— 理由在工具 README。
  機器負載高時 screencast 會掉幀、單次數字很吵：**同一頁量 5 次取中位數**，main 跟分支交替跑。

### 數字變化

A6 已經定好做法（`a6.css:702`，`.dd__v.is-new`）：新值從下方 4px 淡入，170ms。套到「今天 N 堂課」、未讀數、計數徽章。**不做逐位滾動的數字** —— A6 沒有，而且它會讓數字在動畫期間看不清楚。

---

## 3. 技術評估

### 瀏覽器支援

| 功能                                         | Chrome／Edge | Safari（含 iOS） | Firefox             | 出處                                                                         |
| -------------------------------------------- | ------------ | ---------------- | ------------------- | ---------------------------------------------------------------------------- |
| 同文件 VT（`startViewTransition`）           | 111          | 18.0             | 144（Android：157） | [caniuse：View Transitions](https://caniuse.com/view-transitions)            |
| VT types（`:active-view-transition-type()`） | 125          | 18.2             | 147                 | [caniuse](https://caniuse.com/mdn-css_selectors_active-view-transition-type) |

- MDN 標為 Baseline 2025（[MDN：startViewTransition](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition)）。
- 不支援時，Angular router 照常導覽、不啟動 transition（[Angular：withViewTransitions](https://angular.dev/api/router/withViewTransitions)）。頁內的 helper 也一樣：沒有 `startViewTransition` 就直接執行更新。
- **types 的支援比 VT 本身晚**（Safari 18.0–18.1 有 VT 沒 types）。這些版本上方向 class 不會生效，**退回現在的淡入淡出**，不會壞。
- `withViewTransitions` 是 developer preview（同上 Angular 文件）。

### Angular 掛點

- 換頁：`withViewTransitions({ onViewTransitionCreated })`。callback 拿得到 `transition`、`from`、`to`（`ActivatedRouteSnapshot`）（[ViewTransitionsFeatureOptions](https://angular.dev/api/router/ViewTransitionsFeatureOptions)、[ViewTransitionInfo](https://angular.dev/api/router/ViewTransitionInfo)）。在裡面比較兩邊的網址段數，`transition.types.add('forward' | 'back' | 'lateral')`。
  **⚠️ 未證實**：`ViewTransition.types` 能不能在 transition 建立之後才加。規格上是 `ViewTransitionTypeSet`（可以改），實作時要在 Safari 18.2 上實測；不行的話改成在 `<html>` 上暫時掛一個 class，`finished` 之後拿掉。
- 頁內：一支 `shared/` 的小函式 `runViewTransition(update, types)`，負責四件事：不支援就直接 `update()`、「減少動態」就直接 `update()`、`document.hidden` 就直接 `update()`、其餘情況呼叫 `startViewTransition`。
- **VT 要包在「資料套進 signal」那一刻，不是點擊那一刻。** 換週會打 API，點擊當下 DOM 只變了標頭；資料回來時才是真正的換畫面。包錯地方的話，VT 只做了標頭，內容還是瞬間跳。
- Angular 21 是 zoneless，update callback 裡要等 Angular 把 DOM 更新完。實測用 `await new Promise(r => setTimeout(r, 0))` 等兩次可行。**正式做法要改用 `ApplicationRef` 等這一輪渲染完成**，不靠 setTimeout 的時間差（實作時查清楚對應的 API）。
- **一次只會有一個 VT**：新的 `startViewTransition` 會把進行中的那個以 `AbortError` 跳過（[W3C CSS View Transitions §6.1.1](https://www.w3.org/TR/css-view-transitions-1/)）。所以換頁與頁內 VT 撞在一起不會疊加，只是前一個被截掉。

### ⚠️ VT 動畫期間點擊會被吞掉（實測＋規格）

**實測**：老師課表手機版，用真的滑鼠在「下一週」連點兩下，間隔 120ms。

| 情況                                                | 結果                                              |
| --------------------------------------------------- | ------------------------------------------------- |
| 不包 VT                                             | 前進兩週                                          |
| 包 VT                                               | **只前進一週**，第二下點擊的 `target` 是 `<html>` |
| 包 VT＋`::view-transition { pointer-events: none }` | 一樣只前進一週                                    |

**規格**：VT 期間，被擷取的元素「不回應點擊（如同 `pointer-events: none`）」，而且擷取期間「所有點擊都打到 document element」（[W3C CSS View Transitions §4.2、§7.1.1](https://www.w3.org/TR/css-view-transitions-1/)）。

這就是「連點型控制項不用 VT」那條規則的來源。

### 效能（實測，dev 建置）

數字是 **dev 建置**量的，正式建置的絕對值會比較小；這裡要看的是「VT 多花了多少」，所以每一組都有不用 VT 的對照。

**換頁**（admin 桌機，各跑 3 次）：

| 換頁                                 | 最長一幀：有 VT | 最長一幀：沒有 VT | VT 多花 |
| ------------------------------------ | --------------- | ----------------- | ------- |
| 儀表板 → 課表                        | 100ms           | 75–83ms           | 約 20ms |
| 課表 → 學生                          | 92ms            | 74–83ms           | 約 15ms |
| 學生 → 繳費                          | 116–125ms       | 100–109ms         | 約 20ms |
| 繳費 → 課程                          | 158–167ms       | 133–142ms         | 約 25ms |
| 老師手機，CPU 降速 4 倍：課表 → 學生 | 267ms           | 242ms             | 約 25ms |

**凍結的主體是新頁面本身的渲染**，不是 VT。VT 多出來的大約是一到兩幀。

**頁內 VT**（課表「下一週」，同一個操作包與不包）：

| 條件                | 最長一幀：不包 | 最長一幀：包 VT | 快照（`ready`） |
| ------------------- | -------------- | --------------- | --------------- |
| 桌機                | 9–10ms         | 17–18ms         | 12–19ms         |
| 手機，CPU 降速 4 倍 | 9–25ms         | 25ms            | 28–33ms         |

**列表補位**（學生列表 20 列，移除一列）：

| 條件                | 不帶名字：快照／最長一幀 | 每列帶名字：快照／最長一幀 |
| ------------------- | ------------------------ | -------------------------- |
| 桌機                | 11–17ms／16–18ms         | 14–20ms／9–25ms            |
| 桌機，CPU 降速 4 倍 | 18–22ms／17–18ms         | 39–42ms／34–50ms           |

20 列在降速 4 倍時多約 20ms。刪除是低頻動作，可以接受。**超過 20 列的成本沒有量**（未證實），所以只給畫面上看得到的列名字，不給整份列表。

**甘特圖／時間軸沒有量**：本機 seed 的資料量撐不出大列表的情境。這兩處不在第一版範圍（見下方清單），要做時再量。

---

## 實作清單（依優先序）

| 序  | 項目                                                  | 範圍                                                       | 理由                               |
| --- | ----------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------- |
| 1   | 換頁 VT 補上「減少動態」                              | `styles.css` 幾行                                          | 無障礙缺口，現在就存在             |
| 2   | 換頁方向（往深／返回／同層）                          | `app.config.ts` 的 `onViewTransitionCreated`＋`styles.css` | 頻率最高、全站一次到位             |
| 3   | 換週／換日的方向淡入（`animate.enter`）＋週列底線平移 | 老師課表、行政課表、家長課表                               | 三個角色最常用的頁面，現在全部瞬間 |
| 4   | `runViewTransition` helper＋頁內模式切換              | 日／週、篩選分段鈕（盤點表 #6–#12）                        | 一支 helper，各頁一行              |
| 5   | 新增列 `row-new`、刪除列 `animate.leave`＋補位        | 聯絡紀錄、課程、報名等有新增刪除的列表                     | 要逐處確認 `track` 是 id           |
| 6   | 數字變化 `dd__v`                                      | 儀表板計數、未讀數                                         | 低風險、小範圍                     |
| —   | `details` 摺疊、所有彈出物                            | **#1634**                                                  | 不重疊                             |
| —   | 甘特圖／時間軸                                        | 暫不做                                                     | 沒量過，要做時先量                 |

**驗收**（每一項各自）：錄一段進場與出場（Playwright video 或逐幀截圖），開「減少動態」時沒有過程；換週那一項另外要驗**連點兩下前進兩週**（§3 的實測反過來當測試）。

---

## 待裁（一題一行，附建議）

| #   | 問題                                         | 建議                                                                         |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| Q1  | 換頁的方向感用網址段數判斷，可以嗎？         | **可以**：不用另外維護層級表；設定頁的 tab 自然落在「同層」                  |
| Q2  | 換頁的位移距離                               | **24px＋淡入淡出**（同 #1634 側面板），不做整頁寬度的滑動                    |
| Q3  | 「減少動態」時要完全不動，還是保留淡入淡出？ | **完全不動**，照 A6（`a6.css:195`）；Chrome 建議可以保留淡入淡出，但 A6 全採 |
| Q4  | 換週箭頭不用 VT、改用內容淡入，可以接受嗎？  | **可以**：VT 會吞掉連點（已實測），連點換週是老師的日常操作                  |
| Q5  | 數字要不要做逐位滾動？                       | **不要**，用 A6 的新值淡入（170ms）                                          |
| Q6  | 第一版做到清單第幾項？                       | **1–4**；5、6 排下一輪                                                       |
