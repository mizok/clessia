# teacher-pages 席 charter

**Domain**:老師端頁面（`features/teacher/`）—— 行動優先。老師在教室用手機操作,
桌機是次要情境;每個畫面先畫窄的再撐寬,跟 admin 端相反。

## 開席時的既定事實（2026-08-30）

- 規格真相在 `kb/wiki/specs/teacher/`（#102 重寫,含 dashboard/schedule/attendance/assessments/students/notifications）
- 手機課表已定調:**單日檢視＋水平滑動換日**,不是縮小的週表
- 成績邊界已定案(A3,#106):老師可自建校內考、他人的只能登分;段考目錄唯讀、成績可登;
  範圍限自己任課的班,server 端已強制,前端照著做即可,**不要自己再發明權限判斷**
- 補登窗:server 強制(`0`=無限制),前端讀 org 設定顯示,不要寫死 7 天
- 設計語言:方向 D 內部頁(橘帶+白工作面,`app-page-band`/`app-band-anchor`);
  狀態編碼用 `app-status-dot`/`app-data-chip`(刀系列),**不要新開 p-tag**
- 「上完了沒」一律用 `shared/utils/session-time.util.ts` 的 `hasSessionEnded`,不要自己判斷
- 老師/管理/家長共用 `ShellLayoutComponent`,選單由角色+permissions 生成 —— 不要建自己的 shell

## ⚠️ 點名面板是共用的（#138 / #159 各踩一次）

**老師端最核心的互動不住在 `features/teacher/`。** 點名走
`shared/components/attendance-roster-panel`,而 **admin 出勤頁用的是同一支**
(`features/admin/pages/attendance/attendance.page.ts` 開的就是它)。

所以改它的**行為**時,改的是兩個角色的畫面:
- #138 的「零預選」(不再預設全班缺席) —— admin 出勤頁同步生效
- #159 的「請假標註不鎖」—— 同樣兩邊生效

兩次我都是自己想起來才去查誰在用,charter 沒寫。**動它之前先 grep 誰 import 它**,
並在 PR 裡明寫「這支共用,請 admin-pages 掃一眼」。方向對兩邊都對不代表可以不講 ——
那是別席的畫面。

（admin 另外有一支 `session-attendance-dialog`,那是**不同的元件**,不要搞混:
它跟這支同時在修「預選缺席」時是兩支獨立 PR,#135 與 #138。）

判準跟 design-web-2 給的同源:**只影響自己這一頁的自己決定;動到 `shared/` 的,
PR 要標出來給對應席。**

## 工作方式

- 讀 README 通用協定與開分支規範;寫 SCSS 前 invoke `angular-scss-bem-standards`
- 行動優先的驗證:每支 PR 用 390px 寬實測過再交(**怎麼做見下一節** —— 直接縮視窗做不到)
- 缺 API 不自己在前端湊 —— 開需求單回計畫席,由 billing-api 席做

## 行動優先的量測（#125 提煉）

這一席每支 PR 都要做 390px 實測,以下四條是那件事的操作知識。
個案的數字歸 kb（課表那組見 [`kb/wiki/architecture/teacher-schedule-mobile-day.md`](../../kb/wiki/architecture/teacher-schedule-mobile-day.md)),
這裡只放方法。

### 1. 390px 要用同源 iframe 取,不是縮視窗

**Chrome 把視窗寬夾在 598px**,`resize_window` 回報成功但 `innerWidth` 還是 598 ——
照著它的回報寫「已在 390px 驗過」會是假的。

作法:在 `localhost:4200` 開一個同源 iframe,`width:390px`,`src` 指向要測的頁,
從 `iframe.contentWindow` / `contentDocument` 量。media query 與 container query 都對
iframe 的 viewport 求值,所以這是真的 390px 渲染,不是模擬。session cookie 同源共用,不必重登。

兩個坑:iframe 給 `border` 會被 `box-sizing: border-box` 從寬度裡扣掉(要框線用 `outline`);
量完把 iframe 移除,不然它會留在頁面上影響後續截圖。

### 2. 視窗斷點在內部頁不可信 —— shell sidebar 會偷走 240px

`ShellLayoutComponent` 的 sidebar 在 >=768px 展開並吃掉 240px,所以**內容區寬度不是視窗寬度**。
拿視窗斷點決定「內容排得下幾欄」必然算錯:課表七欄在 viewport 768 只有 59px/欄,
不是照 viewport 除出來的 109px。

內部頁的版面門檻一律掛在 `shell-content` 這個具名容器上
(`shell-layout.component.scss` 已定義,admin sessions 系列頁在用)。
好處是 sidebar 收合時版面會自動受益,不必再猜視窗寬。

### 3. `@container` 量的是 content box,不是 border box

用 `getBoundingClientRect()` 量出來的數字直接拿去當 `@container (min-width: X)` 的門檻會**偏大**,
結果是「該翻的寬度沒翻」。差的就是容器的 padding(課表那次是 64px)。

要嘛量 `clientWidth` 系的內距值,要嘛照下一條反推,不要用 border-box 的數字。

### 4. 門檻從「每欄最低可用寬」反推,不要挑裝置斷點

課表的 820px 是這樣來的:先定「每欄至少 110px 才塞得下時間+班名+chip+狀態點」,
然後 `7 × 110 + 6 × 8px 間距 ≈ 818` → 取 820。

這樣得到的門檻**跟裝置無關**,它回答的是「內容排得下嗎」,那才是真正的問題。
所以這種值刻意**不取 `shared/_breakpoints.scss` 的 token** —— 那些是視窗尺度的值,
混用會讓下一個人以為門檻跟裝置寬有關。

推論**一定要用實測數字收尾**:#125 原本被裁成 768px 視窗斷點,理由是「約 109px/欄」,
量了才發現實際 59px,裁決因此被推翻。**前提是算出來的就去量它。**

## 狀態列舉的文案（#132 提煉）

這一席大量用 `app-status-dot`,而 `StatusTone` 是**會長出新成員的列舉**
(`done` / `pending` / `overdue` / `inactive` / `failed`,以後還會再加)。

### 帶 `default` 的 `switch` 在這種地方一律出事

#132 的實際災情:狀態文案原本寫成

```ts
switch (tone) {
  case 'done': return '已點名';
  case 'overdue': return '漏點名';
  default: return '還沒上';        // ← inactive 掉進這裡
}
```

停課的 tone 是 `inactive`,掉進 `default` 顯示成**「還沒上」**——
一堂停掉的課在畫面上看起來像老師還沒去上。**型別完全沒擋住**,
測試也沒抓到(當時沒有停課的案例),是在 390px 實測時用眼睛看到的。

`default` 的意思是「其他情況都這樣」,但列舉長出新成員時,
「其他情況」會**靜靜地**多出一個成員,而它需要的是不一樣的話。

### 改法:`Record<Tone, string>`

```ts
export const ATTENDANCE_TONE_LABELS: Record<StatusTone, string> = {
  done: '已點名',
  pending: '還沒上',
  overdue: '漏點名',
  inactive: '已停課',
  failed: '點名異常',
};
```

少一個 case 是**編譯錯誤**,不是一句錯的話。而且新增 tone 的那個人會被編譯器
直接帶到每一個需要補文案的地方,不必仰賴他記得全域搜尋。

同樣的做法在 `core/attendance.service.ts` 已有前例
(`ATTENDANCE_STATUS_LABELS` / `ATTENDANCE_STATUS_SEVERITIES`)—— 跟著那個寫。

### 推論到整席

**任何「列舉 → 使用者看得到的字」的對應,一律用 `Record`,不要用 `switch`。**
狀態、角色、繳費狀態、考試類型都適用。`switch` 留給真的有行為分支的地方。
