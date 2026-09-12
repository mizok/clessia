---
title: 整站 UI 地圖 —— 方法頁
summary: 怎麼畫一頁 UI 地圖、怎麼用瀏覽器兩向比對驗證它，以及十二個會讓驗證靜靜失效的坑。
category: spec
status: developing
tags: [sitemap, method]
created: 2026-09-12
updated: 2026-09-13
---

# 整站 UI 地圖 —— 方法頁

這份地圖記的是**現在長什麼樣**，不是應該長什麼樣。`specs/` 底下其他規格記的是「應該」——
**兩者不同時記下差異，不要調和**（issue #685 的邊界）。

**一份沒驗過的地圖對改版是負債**：改版會照著它做，它錯在哪裡，改版就錯在哪裡。

## 檔案怎麼來

`kb/wiki/specs/sitemap/<role>/<slug>.md`，一條路由一個檔，**由腳本生成骨架**：

```sh
npx tsx tools/sitemap/generate-sitemap-skeletons.ts          # 生成 / 更新
npx tsx tools/sitemap/generate-sitemap-skeletons.ts --check  # 缺檔就 exit 1
```

腳本**import `RoutesCatalog` 本人**（不是 regex 掃原始碼），所以路由、角色、選單位置、
`showInMenu`、`permission` 永遠對得上程式碼。53 條路由 → public 6、admin 30、teacher 5、parent 12。

**重跑不會蓋掉你寫的東西**：只有 `<!-- generated:route-facts ... -->` 兩個標記之間歸腳本，
其餘一字不動。（Phase 1 多席同時寫，一次重跑洗掉別人半天的工作是這支腳本唯一真正危險的
失敗模式，所以它預設就不具備那個能力。）

⚠️ **frontmatter 的 `title` 不在生成區塊裡** —— 路由標籤改名時它不會自己更新。這是已知缺口。

## 每一頁寫什麼

骨架見任一個已生成的檔案。四個段落：**畫面區塊**、**互動元素**（表格）、**狀態**、
**子頁面：<對話框>**，最後是**驗證紀錄**。

### 「出現條件」欄是改版最需要的那一欄

一個只在「有停課」時才出現的按鈕，改版時要知道它存在。條件寫得出機制就寫機制
（例：`status === 'scheduled' 且 assignmentStatus === 'assigned'`），
**驗不到的狀態要明講「未驗」**，不要留白也不要猜。

### 不要把外框寫進頁面

左側選單與頂列屬於 [[specs/sitemap/_shared/shell-layout]]，53 頁共用。
頁面地圖**只寫 `<main>` 裡面的東西**。同理，多頁共用的對話框獨立成 `_shared/`，
各頁只放連結（例：[[specs/sitemap/_shared/attendance-roster-panel]]）。

判斷方法：`grep -rl <DialogComponent> apps/web/src/app`，排除元件自己與 `.spec`。
**≥ 2 個開啟點就獨立。**

> ⚠️ **`grep` 的命中數不等於「從幾頁開得到」** —— 中間隔著「那條路由渲不渲染它」。
>
> `AttendanceRosterPanelComponent` 的 `grep` 回四筆，我照著寫成「從四個地方開得到」。
> **第四筆是死的**：`features/admin/pages/attendance/attendance.page.ts` 確實引用了它，
> 但 `/admin/attendance` 在 `app.routes.ts` 是純 `redirectTo`，而那個頁面元件
> **全庫沒有任何地方 import**（issue #698 —— **那支孤兒已於 2026-09-12 刪除**，
> 但這條規則留著：下一個孤兒出現時 `grep` 一樣會把它算進去）。實際開得到的是三頁。
>
> **命中之後多做一步**：那一頁在 `app.routes.ts` 裡是 `loadComponent` 還是 `redirectTo`？
> 是 `redirectTo` 就不算一個開啟點。

## 驗證：兩向比對

0. **先確認你的資料能讓每一種列渲染出來**（⚠️ 這一步不能省，理由見下）
1. 登入正確角色，開那一頁 —— **並用 `GET /api/me` 確認身分，不要看畫面上的角色徽章**
   —— **同時量一次 `document.visibilityState`**（`'hidden'` 的話動畫與真滑鼠都不可信，見坑 12）
2. 取得畫面上**可見**的互動元素清單（做法見下）
3. **地圖 ⊆ 畫面**：地圖列的每個元素都找得到 →「沒有捏造」
4. **畫面 ⊆ 地圖**：畫面上每個互動元素都有列 →「沒有遺漏」
5. 每個「會開對話框」的，真的按一次，比對子頁面段落
6. 每個「會導向」的，核對它的目標
7. **差異全部要處理**：改地圖，或記成「未驗到 + 原因」
8. **再打一次 `GET /api/me`** —— 跟第 1 步不一致就作廢重做

**什麼算屬實：兩向比對為空，或每一筆差異都有明講的原因。沒有第三種。**

### 第 0 步：空資料的兩向比對會在錯的數字上收斂，而且是 0 差異

**這是量之前要做的事，不是出事之後才查的事** —— 所以寫在這裡，不只寫在坑裡
（詳細案例見坑 8）。

**Phase 0 的 [[specs/sitemap/parent/attendance]] 用的孩子在本機出勤是 0 筆。**
逐日清單每一天都是「今日無課」，`button.attendance__record` **一顆都沒有渲染出來** ——
可見互動元素收斂在 **4 個**，地圖列 4 個，**差異 0 筆**。
換一個有 11 筆出勤的孩子重量是 **5 個**，而那顆漏掉的按鈕可以按、會展開明細。

**沒有任何東西會報錯**，因為比對的兩邊都看不到它。

動手前跑一次這三個問題：

| 問題                                                               | 做不到的話                         |
| ------------------------------------------------------------------ | ---------------------------------- |
| 這個帳號 / 孩子 / 篩選條件**有資料**嗎？                           | 換一筆（切孩子、換帳號、改篩選）   |
| 每一種**列的型態**都有實例嗎？（已付款 / 停課 / 未評分 / 錯誤列…） | 把「這個狀態下量不到」寫進未驗清單 |
| 我挑的那筆**有鑑別力**嗎？                                         | 見下                               |

直接查 DB 比在畫面上翻快很多：

```sql
select s.name,
  (select count(*) from invoices i where i.student_id = s.id) as invoices,
  (select count(*) from attendance_records ar where ar.student_id = s.id) as attend
from students s ...;
```

**「有資料」還不夠，要「分得出來」**：驗期間篩選器時，17 天前那筆成績**四個期間全都包含它**，
切來切去結果一樣 —— 那種「兩邊一樣」什麼都證明不了。
53 天前那筆**只有「近1月」排除得掉**，那才叫驗過。

**第 0 步失敗不是「不能量」，是「量了要標」** —— 計數不要讓它自己收斂在一個錯的數字上。

### 元素清單以 DOM 為準，不是以 `read_page` 為準

> ⚠️ **這一條推翻了工單原本寫的步驟。** 工單說用 `read_page` 的 `interactive` 無障礙樹當畫面真相。
> **`/admin/dashboard` 實測：`read_page` 在 `<main>` 內回報 6 個，DOM 實際有 10 個。**
> 漏掉的包含兩條整列連結（`在籍學生` → `/admin/students`、`本月報名異動` → `/admin/enrollments`）
> 與一顆可按的課表列。同一頁用 `find` 去問，那幾列又正確回報成 link ——
> **同一個頁面，兩個工具兩個答案。**
>
> **而漏掉的樣子跟「本來就沒有」一模一樣**：照原步驟做，地圖會少 4 筆，
> 兩向比對仍然是「0 差異」，因為比對的兩邊來自同一個瞎掉的來源。

用這一段取得清單（`javascript_tool`）：

```js
const visible = (e) => {
  const r = e.getClientRects();
  if (!r.length) return false;
  const cs = getComputedStyle(e);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && e.offsetParent !== null;
};
const main = document.querySelector('main') || document.body;
const all = [
  ...main.querySelectorAll(
    'a,button,input,select,textarea,[role="button"],[role="tab"],[role="link"],[role="checkbox"],[tabindex]:not([tabindex="-1"])',
  ),
];
const vis = all.filter(visible);
({
  total: all.length,
  visible: vis.length,
  list: vis.map((e) => ({
    tag: e.tagName.toLowerCase(),
    text: (e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 30),
    href: e.getAttribute('href') || '',
    disabled: e.disabled ?? false,
  })),
});
```

**`disabled` 這一欄不能省。** `/admin/courses` 的垃圾桶（刪除課程）按下去**完全沒有反應**、
連 overlay 都沒有，差一點被記成「刪除按鈕沒作用」的缺陷。

實際是 `[disabled]="group.classes.length > 0"` —— **有班級的課程本來就不能刪**，
而那一頁 20 顆垃圾桶裡 **7 顆 disabled、13 顆可按**，我隨手抓到的第一顆剛好是 disabled 的。

**清單沒有記 `disabled` 的時候，「按了沒反應」讀起來跟「壞掉」一模一樣。**
而且它會連帶影響「出現條件」欄：那一格該寫的不是「永遠」，
是「**永遠出現，但 `<條件>` 時 disabled**」。

> **比執行期快照更強的一招（labor-5 / labor-2 補）**：
> **去查模板有沒有 `[disabled]` 繫結** —— 沒有繫結就代表它**結構上不會**進入 disabled。
> 上面那份清單只證明「我量的那一刻」，模板繫結證明的是所有時刻。
>
> 反過來也成立：**繫結存在但你這輪全部量到 `false`**，代表你的資料沒有觸發那個條件，
> 那是「未驗」不是「不會發生」。

> ⚠️ **`[tabindex]:not([tabindex="-1"])` 那一段不能省**（labor-2 於 `/admin/enrollments` 抓到）。
>
> 這個 repo 有**可點但沒有 `role` 的列**：
>
> ```html
> <tr
>   appRtRow
>   class="enrollments__row"
>   tabindex="0"
>   (click)="openClass(row)"
>   (keydown.enter)="openClass(row)"
> ></tr>
> ```
>
> 沒有 `[tabindex]` 那一段時，`/admin/enrollments` 取樣到 **3 個**；加上之後 **18 個** ——
> **漏掉的 12 個 `<tr>` 是整頁最主要的互動**（點下去導向班級詳情）。
>
> **而兩向比對照樣是 0 差異**，因為地圖是照取樣器寫的 ——
> 跟本節開頭推翻 `read_page` 的理由一模一樣，只是這次瞎掉的是**選擇器清單**。
> 一頁「只有 3 個互動元素」的唯讀頁地圖，讀起來甚至很合理。
>
> 副作用是會多抓到下拉的重複 `span`（enrollments 上是 3 個）。**留著** ——
> 多報看得見、漏報看不見，方向跟下面 `disabled` 那條的判準一致。
> 不要再加 `cursor === 'pointer'` 之類的啟發式去濾：那又是一層可能瞎掉的東西。
>
> **反方向也存在**：`/admin/students/:id` 的在籍班級列是 `<div>` 帶 `(click)`、
> **沒有 `tabindex`** —— 可以點但鍵盤到不了。取樣器一樣看不到它，
> 而那是頁面本身的問題，不是取樣器的（記成現況，見那一頁）。

**`visible` 那道濾網不能省**：`/admin/sessions` 的 57 個元素裡有 3 個是手機版專用
（`session-filters__mobile-toggle` 與它自己的日期輸入），桌機寬度下在 DOM 裡但看不到。
**`read_page` 會漏報，裸 DOM 查詢會多報，兩個方向都會讓兩向比對說謊。**

`read_page` 仍然有用（它給 `ref`，`computer` 工具可以直接點），只是**不要拿它當清單的真相**。

## Phase 2：同一頁在 390 / 768 / 1024 再量一次（#756）

Phase 1 的 53 頁 + 10 支 `_shared` **全部只量 1504px 桌機**。改版要決定 RWD 策略，窄寬度的
現況是必要輸入。**方法是 Phase 1 的九步不變，只換視窗寬度**，另加四件手機專屬的量測
（溢出、觸控目標、差集、鍵盤可達性）。上面所有的坑在窄寬度下**一條都沒有失效**，
下面只寫 Phase 1 沒有的那幾層。

### ⚠️ `resize_window` 在這台機器上是空操作，而它回報成功

2026-09-13 實測（labor-6）：

```
resize_window(390, 844)  → "Successfully resized window …"，innerWidth 仍是 1504
resize_window(1000, 800) → 同上，outerWidth/outerHeight 一個都沒動
```

**兩個獨立的旁證說明這不是偶發**：

- MCP 的分頁**永遠** `document.visibilityState === 'hidden'`。把 Chrome 用
  `osascript … to activate` 帶到前景之後 `document.hasFocus()` 變成 `true`，
  **`visibilityState` 還是 `hidden`** —— 我們的分頁不是那個視窗裡被選中的那一個。
- `osascript` 問 Chrome 要視窗與分頁清單，**列不到任何一個 localhost 分頁**
  （只有 `chrome://whats-new` 與 `chrome://newtab`），而同一時刻擴充功能正在那個分頁上跑。

**所以坑 6（真滑鼠點擊整片失效）與坑 12（動畫不跑）在這個環境是常態而不是意外**，
不是「這一次剛好分頁在背景」。

**它的失敗形狀是最壞的那一種**：工具說成功、頁面照樣渲染、每一個數字都合理 ——
**你會拿 1504 的數字寫成 390 的地圖，而兩向比對照樣 0 差異**（跟坑 6、坑 8 同一族：
比對的兩邊來自同一個錯的寬度）。

**做法：不要用 `resize_window`。量之前一定要斷言寬度**，見下。

### 做法：同源 iframe 就是 viewport

把要量的路由載進一個 390px 寬的 `<iframe>`。**iframe 有自己的 viewport**，所以
media query、`matchMedia`、container query、ResizeObserver 寫的 `--window-width`
**全部跟著 iframe 走**（四項都實測過）。

宿主頁面用同源的任一頁即可（`/qr-checkin` 最輕）。整份探測工具：

```js
window.__P = {
  async open(path, w, h) {
    document.querySelectorAll('#__probe').forEach((e) => e.remove());
    const f = document.createElement('iframe');
    f.id = '__probe';
    f.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;border:0;z-index:2147483647;background:#fff`;
    f.src = path;
    document.body.appendChild(f);
    await new Promise((r) => f.addEventListener('load', r, { once: true }));
    await new Promise((r) => setTimeout(r, 2000));
    return f;
  },
  get f() {
    return document.getElementById('__probe');
  },
  get w() {
    return this.f.contentWindow;
  },
  get d() {
    return this.f.contentDocument;
  },

  // 每一次量測的第一件事：確認你真的在你以為的寬度上
  env() {
    const w = this.w;
    return {
      iw: w.innerWidth,
      ih: w.innerHeight,
      windowWidthVar: w
        .getComputedStyle(this.d.documentElement)
        .getPropertyValue('--window-width')
        .trim(),
      mq: {
        max640: w.matchMedia('(max-width:640px)').matches,
        max768: w.matchMedia('(max-width:768px)').matches,
        max1024: w.matchMedia('(max-width:1024px)').matches,
        max1280: w.matchMedia('(max-width:1280px)').matches,
      },
    };
  },
};
```

**每個寬度重新 `open()` 一次，不要改既有 iframe 的寬度。** 載入後才變寬與載入時就那麼寬
是兩種情境，後者才是使用者會遇到的；而**只有前者會讓「只在初始化時算一次」的程式碼
留在舊寬度上**，那是量測產生的假象，不是現況。

它的三個界限，都要知道：

| 界限                                                                                 | 影響                                                                                               |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 宿主視窗內高只有 752 —— **844 高的 iframe 底部 92px 在截圖裡看不到、真滑鼠也點不到** | DOM 量得到（`getBoundingClientRect` 照常）。底部固定列要靠 DOM 不靠眼睛                            |
| 宿主頁面自己也是 Angular app                                                         | 它的元素被 iframe 蓋住，但**全域鍵盤監聽仍在**。鍵盤量測讀 iframe 的 `activeElement`，不要讀外層的 |
| `@media (pointer: coarse)` **模擬不了**                                              | 見下面「觸控目標」那一節 —— 這是 Phase 2 最容易寫出假結論的地方                                    |

**一個附帶的好處，順便解掉了坑 7 的排班問題**：iframe 不動共用視窗，所以
**兩席可以同時量不同寬度而不互相干擾**。要協調的只剩登入身分。

### 三個寬度分別落在哪一段 —— 以及沒有人量的那一段

斷點的真身是 [`apps/web/src/app/shared/_breakpoints.scss`](../../../../apps/web/src/app/shared/_breakpoints.scss)：
`640 / 768 / 1024 / 1280`，兩個方向的 mixin **邊界不對稱**：

- `respond-to($bp)` → `@media (max-width: $bp)`，**含等號**
- `respond-from($bp)` → `@media (min-width: $bp + 0.02px)`（`+ 0.02` 是刻意的，
  讓兩者互斥，理由寫在那個檔案裡）

**所以「量 768」量到的是 `≤ 768` 那一側**，不是 768 以上那一側。要看邊界另一邊得量 769。

| 量測寬度       | 落在哪一段    | 誰量的                 |
| -------------- | ------------- | ---------------------- |
| **390**        | `(0, 640]`    | Phase 2                |
| **768**        | `(640, 768]`  | Phase 2（只記差集）    |
| **1024**       | `(768, 1024]` | Phase 2（只記差集）    |
| `(1024, 1280]` | —             | **沒有人量過**（見下） |
| **1504**       | `(1280, ∞)`   | Phase 1                |

⚠️ **`(1024, 1280]` 這一段目前沒有任何量測** —— 四個寬度跳過了它。
**不要把「量了四個寬度」讀成「四個斷點都驗過」**；需要那一段就補量 1280，
不需要就讓這一行留著，免得下一個人以為涵蓋完整。

### 高度也會改版面，所以每頁要寫「寬 × 高」

不是所有版面只看寬度。`public-shell` 的品牌面高度是
`calc(var(--window-height) * 0.36)`，夾在 `min-height: 232px` 與 `max-height: 330px` 之間：

| 視窗       | 算出來                         | 實測 |
| ---------- | ------------------------------ | ---- |
| 390 × 844  | 844 × 0.36 = 303.8             | 304  |
| 768 × 1024 | 1024 × 0.36 = 368.6 → 夾到上限 | 330  |
| 1024 × 768 | 768 × 0.36 = 276.5             | 276  |

**同一個寬度換個高度就是不同的畫面。** 固定值（讓每頁可比對、也可重驗）：

| 寬   | 高   | 對應     |
| ---- | ---- | -------- |
| 390  | 844  | 手機直向 |
| 768  | 1024 | 平板直向 |
| 1024 | 768  | 平板橫向 |

### 每頁加一節 `## 390px`，不重抄整張元素表

1504 那半**一個字都不要動**。新增一節，五個小段：

```markdown
## 390px

- **量測**：390 × 844 ／ 前端 `<commit>` ／ 身分 `<email>`（量測前後各打一次 `/api/me`）

### 版面怎麼變

（側欄 → 底欄？表格 → 卡片？哪一個斷點翻的？）

### 差集（1504 ↔ 390）

| 只在 390 可見 | 只在 1504 可見 | 兩邊都有但形狀不同 |

### 水平溢出

有／無；有就寫哪個元素撐開的

### 觸控目標 < 44px

| 元素 | 量到的尺寸 | `(pointer: coarse)` 有沒有接住 |

### 鍵盤可達性

Tab 序列、focus 看不看得見、click-only 而鍵盤到不了的元素

### 未驗與原因
```

**768 / 1024 只寫差集**：跟 390 比、跟 1504 比，哪些元素出現或消失。
**沒有差異就寫「與 390 同」一行**，不要把同一張表抄三遍（c11）。

### 水平溢出：斷言 + 指出是誰撐開的

```js
__P.overflow = function () {
  const de = this.d.documentElement,
    iw = this.w.innerWidth;
  return {
    innerWidth: iw,
    scrollWidth: de.scrollWidth,
    overflow: de.scrollWidth > iw,
    culprits: [...this.d.querySelectorAll('*')]
      .filter((e) => e.getBoundingClientRect().right > iw + 0.5 && this.vis(e))
      .slice(0, 8)
      .map((e) => e.tagName.toLowerCase() + '.' + (e.getAttribute('class') || '').split(' ')[0]),
  };
};
```

`+ 0.5` 不是隨手寫的：`getBoundingClientRect` 是小數，剛好貼齊右緣的元素會回
`right = 390.0000001` 之類的值，沒有容差的話**每一頁都會回報一堆假的溢出元素**，
而在一份「全部都有溢出」的報告裡，真的那一筆看起來跟其他一樣。

**表格與程式碼區塊有自己的 `overflow-x: auto` 是設計，不是溢出** ——
斷言的是 `documentElement`，不是每個容器。

### 觸控目標：你量到的是「滑鼠指標下」的尺寸

**`@media (pointer: coarse)` 在這個環境模擬不了**（要 DevTools 的裝置模擬，MCP 沒有）。
而這個 repo **有 20 支 SCSS 用它把命中區抬到 44px**
（查法：`grep -rl "@media (pointer: coarse)" apps/web/src | grep \.scss$`），所以：

> **一份沒有交叉比對 coarse 規則的 `< 44px` 清單，會把「桌機 42px、手機 44px」的元素
> 記成缺陷，同時把「桌機 34px、手機還是 34px」的元素記成同一件事。**
> 兩者在清單上長得一模一樣，而只有後者是改版要處理的。

交叉比對不必去翻 SCSS，直接問 CSSOM：

```js
__P.coarseRules = function () {
  const out = [];
  const walk = (rules) => {
    for (const r of rules) {
      if (r.type === 4 /* CSSMediaRule */) {
        if (/pointer:\s*coarse/.test(r.conditionText || r.media.mediaText || '')) {
          for (const inner of r.cssRules) if (inner.selectorText) out.push(inner.selectorText);
        } else walk(r.cssRules);
      } else if (r.cssRules) walk(r.cssRules);
    }
  };
  for (const ss of this.d.styleSheets) {
    try {
      walk(ss.cssRules);
    } catch (e) {}
  }
  return out;
};
// 對每個 < 44px 的元素：coarse.filter((s) => el.matches(s))
```

兩個實測的對照（`_shared/shell-layout`，admin）：

| 元素                      | 量到   | coarse 命中                               | 真機上      |
| ------------------------- | ------ | ----------------------------------------- | ----------- |
| `.shell-header__user`     | 136×42 | `.shell-header__user { min-height:44px }` | **44** ✓    |
| `.sidebar__item`（18 條） | 223×34 | **無**                                    | **還是 34** |

> **這一節跟既有的 gate 互補，不要互相取代。**
> `tools/agent-harness/lib/touch-target.mjs` 掃的是**自刻元件的 SCSS 宣告**，
> 它**看不到 PrimeNG 元件、看不到從父層繼承的尺寸**（它自己的檔頭就寫著這件事）。
> Phase 2 量的是**執行期的實際矩形**，涵蓋 PrimeNG 與繼承，但**只涵蓋你這一輪渲染出來的東西**。
> **gate 綠 ≠ 觸控目標合格**，而 Phase 2 的清單也不是全集。

### 取樣器要補兩道濾網 —— Phase 1 的版本在窄寬度下會灌水

「元素清單以 DOM 為準」那一節的 `visible()` 只看 `display` / `visibility` / `offsetParent`。
**三種在 Phase 2 會出事的東西它全部放行**：

| 形狀                             | 實例                                                    |
| -------------------------------- | ------------------------------------------------------- |
| 寬或高是 0                       | 390px 下的 `app-sidebar` 是 `0 × 724`                   |
| 祖先 `opacity: 0`                | 收合的側欄群組（`collapsible` 用 `0fr` + `opacity: 0`） |
| 被祖先的 `overflow: hidden` 裁掉 | 同上，子元素照樣回報 `223 × 34`                         |

補強版（`why()` 回 `null` 才算看得見，回字串就是它為什麼看不見）：

```js
__P.why = function (e) {
  const b = e.getBoundingClientRect();
  if (b.width <= 0 || b.height <= 0) return 'zero-size';
  const cs = this.w.getComputedStyle(e);
  if (cs.visibility === 'hidden' || cs.display === 'none' || e.offsetParent === null)
    return 'display/visibility';
  for (let p = e; p; p = p.parentElement) {
    if (this.w.getComputedStyle(p).opacity === '0')
      return 'opacity:0 @ ' + (p.getAttribute('class') || p.tagName);
  }
  const cx = b.left + b.width / 2,
    cy = b.top + b.height / 2;
  if (cx < 0 || cy < 0 || cx > this.w.innerWidth || cy > this.w.innerHeight) return 'offscreen';
  const hit = this.d.elementFromPoint(cx, cy);
  if (!hit || (!e.contains(hit) && !hit.contains(e))) return 'clipped/covered';
  return null;
};
```

**這解掉了坑 4 的一半。** 實測 `/admin/dashboard` 1504px：側欄的 18 條 `a.sidebar__item`
裡 **16 條是 `opacity:0 @ collapsible__inner`，只有 2 條真的看得見**。
Phase 1 只能說「樹裡有但使用者看不到」，現在分得出來是哪 16 條。

> ⚠️ **反過來會誤判，而且誤判方向是「把環境當成產品」**：
> `opacity: 0` 且該元素的 `animationName` 不是 `none` → **那是坑 12（背景分頁動畫不跑），
> 不是它被藏起來了**。實測 `/admin/dashboard` 390px 的底欄「更多」面板：
> `animation: sheet-up`、`opacity: 0`、`transform: translateY(366px)`，
> 十四個項目尺寸全部正確（84×73）**但永遠停在動畫的第 0 幀**。
>
> **判準：`opacity:0` 先問 `getComputedStyle(el).animationName`。** 有名字就先懷疑環境。

### 鍵盤可達性：真的 Tab 鍵在這個環境按不動

實測：把焦點放進 iframe 的第一個連結、用 `computer` 按 `Tab`，
**`activeElement` 一動也不動**（成因同上：分頁不在前景）。

**所以 Tab 序列用推導，不用實按 —— 但推導要先驗前提**：

```js
// 前提：全頁沒有正數 tabindex。有的話 tab 序列就不是 DOM 序，這個推導作廢
[...d.querySelectorAll('[tabindex]')].filter((e) => Number(e.getAttribute('tabindex')) > 0).length;

__P.tabbables = function (root) {
  const sel =
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
    'textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),iframe,area[href],[contenteditable]';
  return [...(root || this.d.body).querySelectorAll(sel)].filter((e) => !this.why(e));
};
```

**焦點看不看得見**用程式焦點就量得到（`el.focus()` 是真的焦點，不是合成事件）：

```js
e.focus();
const cs = getComputedStyle(e);
({
  focused: d.activeElement === e,
  outline: cs.outlineStyle + ' ' + cs.outlineWidth,
  boxShadow: cs.boxShadow,
  focusVisible: e.matches(':focus-visible'),
});
```

**`Escape` 關對話框量不到** —— 它要真鍵盤，而合成的 `KeyboardEvent` 打不到 CDK overlay
（labor-2 已證）。**標「未驗：分頁在背景」**，不要用合成事件湊一個答案。
`document.visibilityState === 'visible'` 的那一天再補。

#### 這一趟最常撞到的形狀：`<div>` 帶 `(click)`、沒有 `tabindex`

**它同時造成兩件事，而兩件都是靜靜發生的**：取樣器看不到它（地圖漏列），
鍵盤也到不了它（可達性缺口）。README 上面已經記過一個
（`/admin/students/:id` 的在籍班級列），Phase 2 在外框上又撞到兩個，
而且是**整個導覽的入口**：

| 元素                        | 後果                                                      |
| --------------------------- | --------------------------------------------------------- |
| `.sidebar__group-header` ×6 | 六個群組只能用滑鼠展開 → 側欄 18 條裡 **16 條鍵盤到不了** |
| `.shell-header__user`       | 帳號設定與登出只能用滑鼠                                  |

**做法：每一頁除了跑取樣器，另外掃一次「`cursor: pointer` 但不在 tabbable 集合裡」的元素。**
那一份差集就是這一類。

### Phase 2 的邊界（跟 Phase 1 相同的那幾條照舊）

- **零寫入。** 對話框只開與關；會直接寫入的動作一律不按，記「未驗 + 原因」
- **不順手修。** 溢出、`< 44px`、鍵盤到不了都是**記現況**；缺陷另開 issue 給計畫席
- **不動 1504 那半的內容。** 發現 Phase 1 寫錯了，在 `## 390px` 裡註明，由計畫席裁定要不要改

## 十二個會讓驗證靜靜失效的坑

### 1. toggle：你以為元件壞了，其實你按了兩次

**這一輪撞了三次**，每一次的症狀都是「按了沒反應，看起來是 bug」：

| 元件             | 當下的錯誤結論                                       |
| ---------------- | ---------------------------------------------------- |
| 課堂列的 ⋮ 選單  | 「已完成的列沒有選單」                               |
| 家長端孩子切換器 | 「有 3 個孩子的家長換不了孩子」——差一點送出的一支 P1 |
| 對話框           | 「取消鍵沒作用」                                     |

**下拉、選單、對話框幾乎都是 toggle**：開、關。探測時先確保是乾淨狀態，**只按一次**，
然後才讀。按兩次等於沒按。

### 2. 殘留的對話框：下一支讀到上一支

連續探測「停課」再探測「調課」，第二支回來的內容與第一支**一字不差** ——
點背景關不掉 PrimeNG 的 modal，讀到的還是上一支。

**如果兩支內容剛好不同，這個錯誤不會被發現。**

做法：關閉一定按對話框自己的「取消 / 關閉」，而且**下一步先斷言
`document.querySelector('.p-dialog') === null` 再繼續**。

### 3. 選擇器抓錯，而它「有回東西」

列的動作選單是專案自己的 `PopupMenuComponent`
（`cdk-overlay-pane.popup-menu__panel`，項目**沒有** `role="menuitem"`），**不是 PrimeNG 選單**。
先用 `.p-menu, [role="menu"], .p-tieredmenu` 去抓，四種列狀態裡兩種回 `null`、
兩種回了看起來很合理的清單。

**一個選擇器在部分情況下有回東西，不代表它抓的是你要的東西。**

本 repo 的正確選擇器：

| 東西               | 選擇器                                                                              |
| ------------------ | ----------------------------------------------------------------------------------- |
| 列動作選單         | `.popup-menu__panel` / 項目 `.popup-menu__item` / 文字 `.popup-menu__label`         |
| 對話框             | `.p-dialog`                                                                         |
| 遮罩               | `.cdk-overlay-backdrop`                                                             |
| **底部抽屜**       | `.p-drawer`（**不是** `.p-dialog`）／遮罩 `.p-drawer-mask`                          |
| **孩子切換器下拉** | `.child-switcher-overlay`（PrimeNG `p-popover`）／項目 `.child-switcher__list-item` |
| **下拉選單浮層**   | `.p-overlay`／選項 `.p-select-option, li[role="option"]`                            |

⚠️ **`p-select` 的清除鍵是 `<svg class="p-select-clear-icon">`，不是 `<button>`** ——
上面那段標準 DOM 查詢的選擇器清單裡沒有 `svg`，**所以它抓不到**。
它是一個真的可以按、而且會改變畫面的東西（實測：按下去被篩掉的資料立刻出現）。
**「畫面 ⊆ 地圖」會在這裡漏水**：數字對得起來，但少了一個元素。

⚠️ **對話框／抽屜的內容通常不在 `<main>` 裡**（`appendTo="body"`），
所以頁面的兩向比對**量不到它們** —— 要另外查。

### 4. 收合／隱藏的內容仍然在樹裡

- admin 側欄六個群組是收合的，**18 條連結照樣出現在 `read_page` 與 DOM 查詢裡**
- 儀表板「收合時間軸」之後那一區是 `height:0 / opacity:0`，**內容仍在 DOM 且 `visibility: visible`**

「樹裡有」不等於「使用者看得到」。這是「畫面 ⊆ 地圖」最容易灌水的地方。

### 5. 探測動作本身會關掉你要看的東西

家長端的孩子下拉**失焦就關**，所以「先按開、再下一次工具呼叫去讀 DOM」會讀到空的。
這種一次性浮層要**在同一次互動裡讀完**，或直接用截圖存證。

### 6. 按了但根本沒送到 —— 而症狀跟坑 1 一模一樣

**`computer` 工具的真滑鼠點擊會整片失效，而它不報錯。** 2026-09-12 labor-5 在 `/login` 撞到：
同一個 session 的前半段真滑鼠點擊完全正常（`/link-line` 的「稍後再說」就是真按的），
後半段**連續 8 次不同座標的空點加上 `hover` + `click`，一個 click 事件都沒有記錄到**，
而同一批次的 `javascript_tool` 與截圖都正常。

**沒有裝監聽器之前，這件事看起來是**：「按 ✕ 沒反應」「按重試沒反應」——
**跟坑 1（按兩次等於沒按）的症狀一字不差**，而排除了坑 1 之後最自然的下一個結論是
「這個元件壞了」。

**更毒的一種**：「重試」那顆鍵按下去的正確行為是 `location.reload()` 到**同一個網址**，
所以**按成功與沒按到的畫面完全相同**。當時差一點就把「沒按到」寫成
「按了，而且參數不會被清掉所以錯誤會回來」—— **一個內容正確、但根本沒驗過的結論。**
（這是「一個『兩邊一樣』的比較結果可能是比較本身沒有鑑別力」在按鍵上的形式。）

**做法：每一次按鍵都留一個「這一下有沒有送到」的證據。** 按之前先在 `document` 上掛
capture 監聽器，按完讀它：

```js
window.__hits = [];
document.addEventListener(
  'click',
  (e) =>
    window.__hits.push({
      x: e.clientX,
      y: e.clientY,
      t: e.target.tagName + '.' + e.target.className,
      trusted: e.isTrusted,
    }),
  { capture: true },
);
```

`__hits` 是空的 → **你沒按到，不要對元件下任何結論**。

**先排除座標**（本輪順手校正出來的，直接拿去用）：截圖的座標框與 viewport
**是純比例、沒有偏移**。1568×725 的框對 1504×695 的 viewport，
`viewport = frame × 1504/1568`（y 用 `× 695/725`）。驗法：

```js
document.elementFromPoint((frameX * innerWidth) / 框寬, (frameY * innerHeight) / 框高);
```

回傳的是你要按的東西 → 座標沒問題，問題在別的地方。

**真滑鼠不行時的退路是 `element.click()`，但它換掉了你的證據等級。**
它會觸發 Angular 的 `(click)` 繫結（實測：同一顆 ✕ 真滑鼠沒反應、`click()` 正常關閉），
但它是 `isTrusted: false` 的合成事件，**驗不到依賴真實指標事件的東西** ——
`pointerdown`、hover 才出現的、**失焦才關的浮層（坑 5 那一族）**。
用了就要在該頁的驗證紀錄裡寫出來，不要混在「實按驗過」裡面。

> 🔴 **2026-09-13：成因找到了 —— 分頁在背景。見坑 12。**
> 在那之前這一條只有症狀與對策，沒有解釋；現在它有一個可以「先量一下」的前置檢查。

**而且它可能只生效一半 —— 那比完全不生效更難看出來。** labor-4 在 `/admin/payments`
用 `element.click()` 依序點三個催繳篩選（`p-togglebutton`），**network 確實送出了
`outstanding=true` / `dueWithin=7` / `overdue=true` 三支請求，但表格與選中狀態
自始至終停在「全部」**。真滑鼠點下去才整組換掉。

**所以「有送出請求」不能當作「這個控制項被切換了」的證據** —— 它只證明處理函式跑過，
沒有證明元件的狀態跟著走。兩邊都只驗到一半，而**兩個一半湊不成一個完整的驗證**。

### 7. 量到一半身分被換掉，而畫面不會告訴你

**auth cookie 是 host 層級、不分 port，而全席共用同一個 Chrome profile** ——
**任何一席登入都會把你踢掉。** 2026-09-12 labor-5 做家長端時被踢**三次**，
其中一次在量測中途。

**它長得像產品缺陷**：`/parent/payments` 切到另一個孩子之後顯示
「**載入失敗 —— 沒有讀到繳費紀錄，可能是連線問題**」，而 DB 明明有 2 張帳單。
真相是別席在那幾秒登入了 admin，`GET /api/me/billing` 回 `403 NOT_PARENT`。

**而頂列徽章還寫著「家長／林志明」。** shell 不會因為 cookie 變了而重繪，
所以**從 DOM 讀身分會給你一個假的安全通過** ——
「我有檢查過身分」跟「身分是對的」是兩件事。

**做法：身分斷言一律打 `GET /api/me`，而且量測前後各一次。**

```js
const who = async () => {
  const r = await fetch('http://localhost:8787/api/me', { credentials: 'include' });
  const j = await r.json();
  return j.email + ' ' + JSON.stringify(j.roles);
};
// 量測前後各呼叫一次，兩次都寫進驗證紀錄
```

前後兩次不一致（或跟你要的角色不符）→ **那次量測作廢重做**，不要「修一下再用」。

**例外要單獨標等級**：labor-5 有一次按期間篩選鈕時 `who()` 回 admin，
但那個操作是**純前端 computed、完全不打 API**，而資料是在確認為家長時載入的 ——
**結論成立，但它跟「乾淨 session 驗過」不是同一個等級**，所以在該頁單獨寫了一段。

> **這一條也是排程問題，不只是技術問題**：連續量測要跟別席協調一個獨佔窗口。
> 開工前用 peer message 講一聲，被踢了要講第二聲。

### 8. 空資料讓地圖漏掉元素，而兩向比對照樣是 0 差異

**Phase 0 的 [[specs/sitemap/parent/attendance]] 是用 `林子璿` 量的，
而那個孩子在本機的出勤紀錄是 0 筆。**

於是逐日清單每一天都是「今日無課」，**`button.attendance__record` 一顆都沒有渲染出來**，
可見互動元素收斂在「4 個」，地圖列 4 個，**差異 0 筆**。

切到 `王柏翰`（11 筆）重量是 **5 個**。那顆漏掉的按鈕可以按、會就地展開明細。

**這是坑 6 之外的第二種「兩邊來自同一個瞎掉的來源」** ——
不是工具瞎掉，是**你手上的資料讓那一類元素根本沒有機會出現**。

**做法**：畫任何清單型頁面之前，先問「**我的資料能讓每一種列都渲染出來嗎**」。

- 能 → 量
- 不能 → **換一筆資料**（切孩子、切篩選、換帳號；本輪就是查 DB 找出哪個孩子有資料）
- 都不能 → **把「這個狀態下量不到」寫進未驗清單**，不要讓計數自己收斂

查資料分佈比猜快很多。例：

```sql
select s.name,
  (select count(*) from invoices i where i.student_id = s.id) as invoices,
  (select count(*) from attendance_records ar where ar.student_id = s.id) as attend
from students s ...;
```

**挑資料的時候順便挑「有鑑別力」的那一筆**：驗期間篩選器時，
王柏翰那筆是 17 天前 —— 四個期間**全都包含它**，切來切去結果一樣，
那種「兩邊一樣」什麼都證明不了。盧安琪那筆是 53 天前，
**只有「近1月」排除得掉**，這才叫驗過。

> **元素清單一定要帶 `disabled`** —— 全文在上面「元素清單以 DOM 為準」那一節，
> 連同「查模板繫結比執行期快照耐用」那一招。
>
> （這裡原本有一份完整的副本。**同一條規則寫在兩個地方會漂**，所以留位階高的那份 ——
> 它就在取樣程式碼旁邊，是這條規則真正被執行的地方。）

### 9. 關閉對話框之後**不要固定等待再斷言** —— 要輪詢

坑 2 要求「關閉後先斷言 `document.querySelector('.p-dialog') === null` 再探下一支」。
**那條規則沒說要等多久，而預設的猜測會太短。**

實測（`/admin/payments`）：`.p-dialog` 從按下關閉到真的從 DOM 消失要 **1.8–2.0 秒**。
先用 700ms、再用 1200ms 去問，兩次都得到「還在」——
於是先後判定「關閉鍵沒作用」與「連 ✕ 也沒作用」，**而截圖顯示它早就關了**。

**這是坑 1 的第三種變體：不是按兩次，是問得太早。**（坑 1 是按兩次，坑 6 是沒按到。）

```js
const gone = async (ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!document.querySelector('.p-dialog')) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false; // 這時候才可以懷疑元件
};
```

⚠️ **對話框會疊。** `/admin/payments` 的帳單詳情裡按「記錄收款」會開第二層，
`.p-dialog` 同時存在兩個。疊起來的情境要比對**數量**，
`=== null` 會把「上面那層關掉了、下面那層還在」讀成「沒關掉」。

### 10. 元件原始碼寫了什麼，跟使用者看到什麼，中間隔著一層版面計算

**讀原始碼比從畫面推論可靠**（見「不要做的事」），但它有一個特定的失效面：
**凡是由容器寬度決定的東西，原始碼上看得到、畫面上不一定在。**

`_shared/audit-log-dialog` 的前一版有兩句從原始碼讀出來的敘述，**兩句都是錯的**：

| 原始碼上看到的                                           | 實際畫面（1504px 桌機）                                                                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expandControlPosition="start"` → 「每列可展開詳細資訊」 | **一顆展開鍵都沒有** —— 它由 `responsive-table` 的 `hasCollapsedColumns()` 決定，四欄 min-width 合計 640px、對話框內容區塞得下，所以不收合也就不產生 |
| `currentPageReportTemplate: '顯示 {first} - {last}…'`    | **顯示 `第 1 / 2 頁`** —— 容器 ≤ 768px 時 `responsive-table` 切 compact 分頁器，**改寫樣板**並藏掉頁碼與首末頁鍵；800px 寬的對話框正好落在門檻內     |

**兩句讀起來都跟量過的事實一模一樣**，這是它們危險的地方。

判準：**元件有 `ResizeObserver` / `containerWidth` / `collapsible` / `compact` 這一族的字眼，
就不要從原始碼下結論**，去量。反過來也成立 —— 量到的東西要標寬度，換個寬度它就不是那樣。

### 11. 抽樣幾筆就寫成「本機沒有」—— 坑 8 的反方向

坑 8 是**資料太少，所以地圖漏列元素**。這一條是**查太少，所以把「我沒找到」寫成「不存在」**，
而它會直接關掉別人補驗的路：後面的人讀到「本機一筆都沒有」，就不會再去找了。

2026-09-12 兩個實例，都是 labor-4 自己寫的：

| 地圖上的敘述                                        | 實際                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `admin/meals`：「整個本機資料庫沒有任何一筆餐記錄」 | `select count(*) from meal_records` = **18**（8/19、8/20、8/21 各 6 筆）。當時抽查了 5 個日期都是空的 |
| `admin/payments`：「本機沒有已收款的帳單」          | 37 張裡 **9 張** `netPaid > 0`。當時只點開了**第一列**                                                |

**兩句話的形狀一樣**：拿一個小樣本的「沒有」推論整個資料集的「沒有」。
而**兩者都不需要新資料就能驗** —— 只是要挑對那一筆。

**做法：宣告「本機沒有 X」之前，去問資料庫，不要問畫面。**

```sh
psql "$DATABASE_URL" -c "select count(*) from <表> where <那個條件>"
```

寫成「未驗」時把這一步的結果寫進去 ——
**「查過 DB，全庫 0 筆」與「我看的那幾筆沒有」是兩種強度完全不同的宣稱**，
而它們在地圖上長得一模一樣。

### 12. 分頁在背景 —— 動畫不跑、rAF 不觸發、真滑鼠不落地

**這是坑 6 的成因，而且它同時製造另外兩種「看起來像缺陷」的現象。**

2026-09-13 labor-5 在查「抽屜關閉後 `.p-drawer-mask` 殘留」時量到：

```js
document.visibilityState; // → "hidden"
document.hasFocus(); // → false
```

**對照實驗**（建一個 200ms 的 CSS transition，量它會不會完成）：

```
rafRan: 0                  ← requestAnimationFrame 1.9 秒內一次都沒跑
transitionendFired: 0
opacityAfter1500ms: "1"    ← 200ms 的 transition 連開始都沒有
```

**背景分頁裡 CSS 動畫不會跑、`requestAnimationFrame` 不會觸發。**

#### 它會讓三種東西看起來像缺陷

| 現象                                                                                                  | 真正的原因                                                 |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **按了沒反應**（`computer` 的真滑鼠點擊整片失效）                                                     | 分頁不在前景（坑 6）                                       |
| **遮罩／浮層關不掉**（`.p-drawer-mask` 卡在 `leave-active` 十秒以上，`pointer-events:auto` 蓋住整頁） | PrimeNG 靠**離場動畫結束**才移除元素，動畫沒跑完就永遠留著 |
| **過場中的畫面量不到**（skeleton、進場動畫、`--enter` 類別）                                          | 同上                                                       |

**`.p-drawer-mask` 那一條本來被標成「排除不掉量測環境」** —— 現在排除掉了，
**是環境不是產品**。地圖上原本那個未決的問號可以收掉了。

#### 做法：把它加進每一次量測的前置檢查

```js
({ visibilityState: document.visibilityState, hasFocus: document.hasFocus() });
```

- **`'hidden'`** → **不要對「按了沒反應」「元素沒消失」「動畫沒結束」下任何產品結論**。
  能做的：改用 `element.click()`（但要標證據等級，見坑 6）、或把那一項標成
  「**未驗：分頁在背景，這一類量不到**」
- **`'visible'`** → 才輪到去懷疑元件

> 🔴 **2026-09-13 再訂正（labor-6）**：這不是「這一次剛好在背景」——
> **MCP 的分頁在這台機器上永遠是 `hidden`**（三個獨立旁證見 Phase 2 一節）。
> 所以「先量一下 `visibilityState`」的結果**預設就是壞的那一邊**，
> 動畫、真滑鼠、真鍵盤三類全部要當成量不到，而不是偶爾量不到。

> **這條跟坑 7（身分被換掉）是同一族**：**環境的失效方向跟產品缺陷長得一模一樣**，
> 而分辨它們的唯一辦法是**去量環境本身**，不是盯著畫面推理。

## 環境：先確認你量的是哪一版

**dev server 可能服務別的 checkout。** 開工前：

```sh
lsof -nP -iTCP:4200 -sTCP:LISTEN -t | head -1 | xargs -I{} lsof -p {} -a -d cwd -Fn | grep '^n'
```

2026-09-12 實測：4200 是**主 checkout**，而主 checkout 當時停在 `a2c00d39`，
**落後 origin/main 兩支產品 commit**（#677 人員表單、#679 搜尋取消）。
本輪三頁因此改用自己 worktree 的 dev server（4201）並在每頁記下 commit。

**每一頁的驗證紀錄都要寫前端版本**，否則地圖無法被重驗。

### 登入

一次性 magic link（`npm run login-link`，需 `LOGIN_EMAIL`）。
**被別席踢掉時自己重發就好，不必等對方讓路** —— 但在 worktree 裡直接跑會停在
「缺少環境變數 `DATABASE_URL`」，補完又停在 `WEB_URL`（原因就是上面那段：
`WEB_URL` 在 `wrangler.toml` 不在 `.dev.vars`，而這支腳本不讀 `wrangler.toml`）。
**在 worktree 根目錄**跑這一行：

```sh
set -a; source <主 checkout>/apps/api/.dev.vars; set +a
WEB_URL=http://localhost:4200 LOGIN_EMAIL=admin@demo.clessia.app \
  npx tsx apps/api/src/scripts/login-link.ts
```

（`cd` 到別的目錄跑會 `ERR_MODULE_NOT_FOUND` —— 腳本路徑是相對的。）

**auth cookie 是 host 層級不分 port**，所以：

- 4201 的頁面可以用 callback 指向 4200 的連結登入
- **換角色會踢掉前一個** —— 做完一個角色再換，或用獨立 Chrome profile
- **`callbackURL` 不在 `WEB_URL` 上時，頂層導覽會被拒**（`INVALID_CALLBACK_URL`）——
  從已開啟的頁面用 `fetch(..., {credentials:'include'})` 兌換就會帶上 `Origin` 而過關

  規則本身（`apps/api/src/lib/origins.ts`）：

  > `trustedOrigins` = `allowed` ∪ { 請求的 `Origin`，若通過 `isAllowedOrigin` }
  > ，其中 `allowed` = 跑著那台 server 的 `WEB_URL` + `ALLOWED_ORIGINS`，
  > 而 `isAllowedOrigin` 對 `localhost` / `127.0.0.1` **有開發豁免、不分 port**。

  本機四種情況實測（用無效 token 打 `/api/auth/magic-link/verify`，
  callback 驗證發生在 token 查詢之前，所以不必燒掉真的 token）：

  | callbackURL | `Origin` 標頭           | 結果                           |
  | ----------- | ----------------------- | ------------------------------ |
  | `:4200`     | 無                      | **302**                        |
  | `:4210`     | 無                      | **403 `INVALID_CALLBACK_URL`** |
  | `:4210`     | `http://localhost:4210` | **302**                        |
  | `:4200`     | `http://localhost:4200` | 302                            |

  **`WEB_URL` 從哪來**：不在 `apps/api/.dev.vars` 裡（那份沒有這個鍵），
  是 `apps/api/wrangler.toml` 的 `[vars]` 寫死 `WEB_URL = "http://localhost:4200"`。
  **只看 `.dev.vars` 會以為 `allowed` 是空的** —— 我就看錯過一次。

  > 這一段原本寫成「頂層導覽**沒有 Origin** 會被拒」，**範圍太寬**：
  > callback 指向 `:4200` 的頂層導覽是會過的（上表第一列）。
  > 由 labor-2 從反方向抓到並在本機重現 —— 它自己那則寫成「只信任 `:4200` 的 port 白名單」，
  > **同一個現象、兩種錯的機制解釋**，兩邊都是只量了兩種情況就推論。
  > 分開它們的是第三列（`:4210` + Origin → 302）：**那一列同時否證了兩種說法**。

## 不要做的事

- **不要送出任何寫入**。對話框只開啟與取消。會直接寫入而不開對話框的動作
  （例如課堂列的「取消停課」）**一律不按**，記成「未驗 + 原因」
- **發現產品缺陷不要順手修** —— 開 issue 給計畫席，地圖裡記現況
- **不要抄 `specs/` 既有規格**
- **宣告缺陷之前先排除自己**：三次「看起來是 bug」有三次是量測方式的問題。
  去讀那個元件的原始碼，比從畫面推論可靠

## 已完成的範本

- [[specs/sitemap/admin/dashboard]] —— 最簡單的一頁，示範資料來源與條件式元素
- [[specs/sitemap/admin/sessions]] —— 最複雜的一頁，7 支對話框、依列狀態而異的選單
- [[specs/sitemap/parent/attendance]] —— 另一個角色
- [[specs/sitemap/public/login]] —— 條件式元素最多的一頁（五種狀態各量一次，全靠網址參數切換）
- [[specs/sitemap/public/trial]] —— **佔位殼**長什麼樣、怎麼寫（`<main>` 內 0 個互動元素）
- [[specs/sitemap/_shared/shell-layout]]（登入後三角色共用）／
  [[specs/sitemap/_shared/public-shell]]（公開六頁共用，**跟前者是兩個不同的外框**）／
  [[specs/sitemap/_shared/attendance-roster-panel]]

**Phase 2（`## 390px` 那一節怎麼寫）**：

- [[specs/sitemap/_shared/shell-layout]] —— **版面真的換了一套**（側欄 ↔ 底欄 + 「更多」面板），
  差集表最完整，也是「`<div>` 帶 `(click)` 導致鍵盤到不了」的示範
- [[specs/sitemap/_shared/public-shell]] —— **差集為零**長什麼樣：四個寬度同樣 5 個元素，
  只有版面方向與品牌面高度在變。**零差異的頁也要寫，而且要寫出你量過哪幾個寬度**
