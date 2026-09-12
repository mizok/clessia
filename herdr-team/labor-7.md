# labor-7 席 charter（通用執行席）

> **開席日 2026-09-13。** 第一輪（#762 → #756 的 public 6 + parent 12）做完後蒸餾過一次，
> **下面第五節以後是那一輪的產物**。**這一頁只放「別處沒有的」**：量測方法看
> [`kb/wiki/specs/sitemap/README.md`](../kb/wiki/specs/sitemap/README.md)，
> 團隊通則看 [`README.md`](README.md)，前兩任的坑看
> [`labor-4.md`](labor-4.md) / [`labor-5.md`](labor-5.md)。

## 佇列怎麼查（不寫快照，快照明天就是假的）

```sh
gh issue list --label seat:labor-7 --state open
gh pr list --state open --search "labor-7"     # 共用 GitHub 帳號，要用分支名或標題過濾
```

## 一、驗 PostgREST 查詢語意：唯讀、不造資料、用「已知不同」的對照組

#762 要證明 `.or('session_date.lt.X,status.eq.completed')` 真的是
`class_id IN (...) AND (date < X OR status = completed)`。**單元測試的替身不求值**
（本 repo 每支 spec 各寫一份假 supabase，沒有一份會套用條件），所以那一層只釘得住
「條件的逐字形狀」。

**直接打本機 PostgREST 就能驗，零寫入**：

```sh
set -a; . <主 checkout>/apps/api/.dev.vars; set +a   # DATABASE_URL / SUPABASE_SECRET_KEY 都在這
curl -s -o /dev/null -D - "$SUPABASE_URL/rest/v1/sessions?select=id&<條件>" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "Prefer: count=exact" -H "Range: 0-0" | grep -i '^content-range'
```

**對照組要挑「已知會不同」的**（README 那條「兩邊一樣可能是比較分不出來」）：

| 對照                                    | 證明什麼                      |
| --------------------------------------- | ----------------------------- |
| 兩半條件都改成不可能命中 → 應回 `0`     | `or=` 不會退化成「回全部」    |
| `class_id` 換成不存在的 uuid → 應回 `0` | `class_id` 與 `or=` 是 **AND**|
| 日期門檻往前挪，看筆數從 2 跳到 60      | `OR` 真的多抓到已完成的那批   |

**第三列是關鍵**：本機沒有「今天且 `completed`」的課堂可以當 fixture，而**零寫入鐵律
不准造一筆**。把門檻往前挪是等價的唯讀替代 —— 「日期不夠舊但已點名」跟「今天已點名」
在查詢上是同一個形狀。

## 二、替身缺一個方法時，修前的紅是**編譯的紅**，證明不了行為

寫 #762 的測試時第一版把替身的 `lt` 拿掉、只留 `or`。修前那一跑確實紅了 ——
**紅在 `lt is not a function`**，也就是 labor-2.md 第 7 條那個「編譯失敗的紅 vs
斷言的紅」。**那個紅只證明我換了替身的介面，證明不了條件錯。**

處置：**兩個方法都留著並各自記錄**，斷言「`orArgs` 有東西且 `ltArgs` 是空的」。
修前於是紅在 `AssertionError`，而那才是行為的紅。

**可操作版本**：拿掉替身的某個方法來製造修前紅時，先問「這一紅是斷言給的嗎」。

## 三、工單裡的歸因也要當前提驗

#762 寫「本機 DB 已有 60 筆 completed（**seed 寫的**），可直接當 fixture」。
`grep -c completed supabase/seed.sql` → **0**。原始報告 #488 明確查過這件事並寫著
「不在任何進版控的檔案裡」，**括號裡那三個字是轉述時加上的**。

沒有造成傷害（那 60 筆確實存在、確實能當 fixture），但**如果我照著它去 `db:reset`
再驗一次，fixture 會整批消失而我會以為是自己弄壞的**。

這是 README「轉述時證據等級不會自己跟過來」的又一個實例，方向是**歸因**而不是強度。

## 四、跨席協調：claude-peers 會雙向靜默失效

**2026-09-13 與 labor-6 之間，兩個方向都沒送到，而兩邊的工具都回 `success`。**

我送出**四則**，每一則 `mcp__claude-peers__send_message` 都回
`Message sent to peer u25ikw25`；它送我的 A/B/C 排班提議我**一則都沒收到**
（`check_messages` 一直回 `No new messages`）。**兩邊都以為自己送到了，兩邊都在等對方。**

> 這是團隊 README「寫在自己 pane 上的字別人看不到」的機器版，**但更難察覺**：
> 那一條至少沒有任何東西跟你說「送出成功」。

**處置**：跨席協調**不要靠 claude-peers 當唯一通道**。我最後是靠計畫席把訊息轉進終端才知道對方在等。
**回別席的話同時寫進自己的終端輸出**，讓計畫席看得到 —— 那是這個團隊實際上可靠的第二通道。

## 五、兩席獨立做出同一件事時，怎麼收（2026-09-13 實例）

限速停機 90 分鐘期間，labor-6 的 #768 合進 main，**獨立發現了我正在修的同一族取樣器缺口**，
而且修法更強（真的 `scrollIntoView` 再測，而我只判「捲得到就算可見」）。

照通則「**誰先開 PR**」切，我把自己那版**整支撤掉**，方法頁以 main 為準。
**但那條通則的後半才是重點：「要比對一次有沒有獨有的正確性」。** 比對之後：

| 我發現的 | 對方有沒有涵蓋 | 處置 |
| --- | --- | --- |
| 垂直捲動容器不是視窗 | 有 | 撤 |
| 水平捲動容器 | 有（`inline:'center'` + `scroller()` 含橫向） | 撤 |
| 被 `fixed` 底欄壓住 ≠ 看不到 | 有 | 撤 |
| **焦點環在這個環境量不到** | **沒有** | **保留** |

**撤掉之後還有一步：用對方的版本重驗自己已經量到的數字。**
我九頁一頁都沒變，但**不驗就不知道** —— 交付用被取代的方法量出來的數字，
跟交付一個沒驗過的數字是同一件事。

## 六、接手一份「已經被別人驗過」的工具時，先找它的歸因句

**方法頁裡最值錢的一句話，通常是寫著「這是量測限制」的那一句。**

#768 記著「`/admin/courses` 390 量到 19/20，少的那一顆是量測位置造成的」。
我在另一頁撞到**逐字同形**的 19/20，追下去是濾網自己的洞（`inView()` 拿 `innerHeight`
當可視區，而內容區只到底欄上緣；底欄是 `position: static` 所以 `fixed`/`sticky` 的
例外判定整條落空）。

> **「量測限制」這四個字的作用跟「沒事」一樣：它會終止調查。**
> 而它比「沒事」更難質疑，因為**它已經承認有問題了**，只是把問題歸給環境。

**可操作**：讀別人的方法頁時，把「這是環境／量測造成的」那幾句**當成待驗清單**，
不是當成結論。驗法就是拿一個**同形的第二實例**去撞 —— 同一個機制會在別的頁面重現，
歸因錯的那些不會。

## 七、量「錯誤狀態」不必停服務 —— 把 XHR 的位址改指到死 port

`#760` 的工單原本寫「停掉 8787（精準 kill，量完重啟）」。**不需要。**

```js
// 在**已載入完成**的 iframe 上裝，之後只能用 SPA 導航觸發（window 會在導頁時被換掉）
const Orig = w.XMLHttpRequest;
w.__seen = [];
w.XMLHttpRequest = function () {
  const x = new Orig();
  const open = x.open;
  x.open = function (m, u, ...rest) {
    let url = String(u);
    if (url.includes(':8787/api/')) { w.__seen.push(m + ' ' + url); url = url.replace(':8787', ':8799'); }
    return open.call(this, m, url, ...rest);
  };
  return x;                       // 載入中那一半：改成把 x.send 用 setTimeout 延後
};
```

**只影響那一個 iframe，不動共享資源** —— 於是這一類工單不需要計畫席批准停服務。

**三個一定要記住的**：

1. **patch 的是 `XMLHttpRequest` 不是 `fetch`。** 這個 app 的 `provideHttpClient` 沒有
   `withFetch()`，全站零個直接 `fetch(` —— **patch `fetch` 只會攔到你自己的身分探針
   （`GET /api/me`），所以它「看起來有在運作」。**
2. **`window` 在導頁時被換掉**，所以裝完只能用 **SPA 導航**（點 `routerLink`）觸發，
   不能 `location.href` 或重設 `iframe.src`。
3. **`__seen` 是空的就作廢那一輪。** 我有兩次量到「請求數 0」——
   都是因為**導航起點就是那一頁**（SPA 導航到自己不會重新取數）。
   **沒有攔到請求就對畫面下結論，等於量了一個沒有發生的錯誤。**

## 八、分類器的失效方向要先想清楚，改寬之後一定要跑負控

Phase 2-D 要把 23 頁分成「誠實 / 謊稱沒資料」，我寫了一個 regex 分類器。

**第一版只收「載入失敗|查詢失敗」**，於是把 `/admin/dashboard` 判成「看不出訊號」——
而它其實逐字寫著「**讀取失敗**」。補上之後**四頁從「有問題」改判為「誠實」**。

> **那個失效方向是「把誠實的判成有問題」—— 它會讓缺陷清單看起來比實際長。**
> 而放寬 regex 的反方向是「把謊稱的判成誠實」，**那會讓清單看起來比實際短**。

**所以改寬之後跑了負控**：`students` / `courses` / `parents` 在新 regex 下**仍然是
「謊稱沒資料」**（它們的 `app-empty-state` 逐字說「尚未…」而完全沒有失敗字樣）。

**可操作**：**寫分類器的當下就問「它錯的時候會往哪邊錯」**，改它的時候兩個方向各留一組
已知案例回跑。只驗一個方向的分類器，跟沒驗一樣。

## 九、一個「看起來完全成立的 P1」怎麼長出來的（#784 的完整形狀）

我開了 #784（P1），然後**自己撤回**。值得完整記，因為每一步都是對的：

| 我做了什麼 | 對不對 |
| --- | --- |
| 量到對話框 `390 × 1130`、關閉鈕 `top -112`、按鈕在畫面外 | ✅ 量到的都是真的 |
| 測了三種捲動方式（`mask.scrollTop` / `document` / `scrollIntoView`）都到不了 | ✅ |
| 查 `dismissableMask` 的程式碼，與實測兩個來源對上 | ✅ |
| 比對 #714，指出「它是那條規則在窄寬度下失效」 | ✅ 推導站得住腳 |
| 估範圍時標了「73 是候選上限不是實際數量」 | ✅ 證據分級做了 |
| **問「這個環境的 ResizeObserver 活著嗎」** | ❌ **沒問** |

成因：`InheritSizeDirective` 只在 **ResizeObserver** callback 裡寫
`--shell-layout-body-height`，而 **ResizeObserver 在 MCP 的背景分頁 iframe 裡不觸發**
（實測 600ms 內 0 次）→ `styles.scss:722` 的 `calc()` 無效 → `max-height: none`。

**手動補上那個變數，對話框當場自己收好**（`1130 → 700`、關閉鈕 `-112 → 103`、
按鈕 `913 → 698`、內容區變可捲）——**三件事本來就都有。**

**我是被一句正確的話誤導的**：方法頁寫「…container query、**ResizeObserver 寫的
`--window-width`** 全部跟著 iframe 走」。那句話沒錯，**但 `--window-width` 不是
ResizeObserver 寫的**（`WindowSizeDirective` 用 `ngOnInit` + `HostListener`）。
**我把它讀成「ResizeObserver 在這個環境有效」。**

> **可操作的版本**：**量測環境的能力清單要自己驗，不要從別人的一句話推。**
> 目前已知缺三項：`matchMedia('(pointer: coarse)')` 恆 `false`、
> `visibilityState` 恆 `hidden`、**ResizeObserver 完全不觸發**。
> 三個的共同形狀：**環境少了一項能力，而缺席的樣子跟「產品就是這樣」一模一樣。**
>
> **檢查在方法頁 Phase 2，一行就跑得完。量之前做，不是覺得可疑才做。**

## 十、給下一個接手的人

**未完成的工作**（#760 Phase 2-D 只做了一半）：

| 還沒做 | 狀態 |
| --- | --- |
| **載入中那一半** | **做法驗過**（把 XHR 的 `send` 用 `setTimeout` 延後 3 秒），**三個角色都沒鋪開**。已知形狀：`/parent/attendance` 切篩選時 **3 秒內畫面完全沒反應**，沒有 skeleton／spinner／disabled |
| **10 支 `_shared` 的錯誤態** | **一支都沒量** |
| `/admin/settings/*` 四頁 | 頁籤不是 `<a href>`，SPA 導航進不去。**沒有硬鑽** |
| 有路由參數的頁（`students/:id` 等） | 沒量 |
| `public/login`、`public/select-role` 的錯誤態 | 各需要一個特定身分（登出 / 多重角色） |
| `_shared/contact-book-entry-dialog` 的 390px | 兩個開啟點的資料狀態都開不到（頁面裡寫了怎麼量） |
| 重試鈕按了會不會真的重打 | 需要真滑鼠（方法頁坑 12） |

**環境上會再撞到的**（不是狀態，是這台機器的性質）：

- **登入身分的競爭沒有結構解**：`environment.ts` 的 `apiUrl` 寫死
  `http://localhost:8787`，所以**換 host 也分不開 cookie**（試過 `127.0.0.1`）；
  `list_connected_browsers` 只有一個瀏覽器。**做法是把每輪量測壓短、前後各打一次
  `GET /api/me`、被踢就作廢重做那一輪。**
- **CDP 會在 45 秒逾時把分頁打掛** —— 一次工具呼叫裡不要塞超過 3~4 個
  `__P.open()`；長清單頁用方法頁的 `visibleFast`（兩站先不捲動判定、只對剩下的複驗）。
- **`overflow()` 曾經是逾時元凶**（它對每個 DOM 節點呼叫 `why()`），已改成不捲動的版本。
