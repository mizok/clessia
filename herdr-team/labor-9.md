# labor-9 席 charter（通用執行席）

> **開席日 2026-09-13。** 內容先薄 —— 退場前才蒸餾「下一個接手的人必須知道的事」。
> **這一頁只放別處沒有的**：團隊通則看 [`README.md`](README.md)，
> 修 bug 的判準看 [`labor-6.md`](labor-6.md)（修前紅、反向對照、工單前提先開檔驗），
> 量測方法看 [`kb/wiki/specs/sitemap/README.md`](../kb/wiki/specs/sitemap/README.md)。

## 開席前置

- **新 worktree 沒有 `node_modules`，root 與 `apps/api` 各 `npm ci` 一次**
  （理由見 [`labor-6.md`](labor-6.md)：少了 `apps/api` 那次，`login-link.ts` 會缺 `pg`）。
- 跑單支 web spec：`npx nx test web --include='**/foo.spec.ts'`（glob 要 `**/`，見
  [`labor-2.md`](labor-2.md)）。

## 佇列怎麼查（不寫快照）

```sh
gh issue list --label seat:labor-9 --state open
gh pr list --state open --search "labor-9"   # 共用 GitHub 帳號，要用分支名或標題過濾
```

## 這一席自己的判準

### 「只有 SPA 導航才炸」這類時序 bug，去讀框架的原始碼，不要靠推論

#804 的形狀：`/admin/settings` 完整載入正常、app 內點進去整頁空白。
issue 已經附了 console 堆疊指到 `route.firstChild?.snapshot.routeConfig`，
**而「加一個 `?.`」是這裡最容易走上的路** —— 它會讓畫面不再空白，
但 tab 會退回第一個（導到 `/general` 卻亮「分校」），而且**沒有回答為什麼完整載入不會炸**。

去讀 `node_modules/@angular/router/fesm2022/_router-chunk.mjs` 的 `activateRoutes` 就全部有答案：

```
advanceActivatedRoute(殼)              ← 殼自己的 snapshot 在這裡填好
outlet.activateWith(殼)                ← 元件在這裡建構（欄位初始化跑在這一刻）
activateChildRoutes(...)               ← 子路由的 snapshot 在這之後才填
```

於是 **`route.snapshot` 可靠、`route.firstChild.snapshot` 在建構當下是 `undefined`**；
而整頁載入時 outlet 還沒建好（`if (context.outlet)` 不成立），元件改由
`RouterOutlet.ngOnInit` 在整棵樹 advance 完之後才建，所以看不到。

**修法因此不是補 `?.`，是換讀取來源**：`route.snapshot.firstChild?.routeConfig?.path`
—— snapshot 子樹在 recognize 階段連 redirect 一起解完，拿到的是網址真正指的那個 tab。

> 一般化：**「只有某一條路徑會炸」等於「有一個順序你還不知道」。**
> 順序寫在框架裡，`node_modules` 的 fesm bundle 是可讀的純 JS，
> `grep -n` 一次就看到呼叫順序 —— 比從症狀反推便宜，而且結論不是猜的。

### 重現時序 bug 的 mock 要把「階段」做成參數

同一支 spec 既要測「活化跑完之後」也要測「建構當下」，
所以 `ActivatedRoute` 的替身用 getter + 一個 `childAdvanced` 旗標，
兩種狀態共用一份形狀。原本的替身只有一個 `firstChild` getter、`snapshot` 永遠都在，
**所以它從定義上就測不到這個 bug** —— 而那支 spec 有 7 條綠燈。

> **替身少一個欄位，等於把那個欄位的所有狀態都斷言成「永遠正常」。**

**斷言不要只寫「不要炸」**：#804 那條斷言的是 `activeTab() === 'general'`，
不是 `expect(() => setup()).not.toThrow()` —— 後者連「退回第一個 tab」也會放過，
而那正是最容易誤修成的樣子。

### 替身少記一個東西，等於把那件事斷言成「永遠正常」

**這一輪撞到五次，五次形狀都不同，而且每一次那些 spec 都是全綠的。**
它不是某一支測試寫壞了，是一族：

| 工單 | 替身少了什麼                                                   | 於是測不到                                                  |
| ---- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| #804 | `ActivatedRoute` 只有 `firstChild` getter，`snapshot` 永遠都在 | SPA 導航建構當下 `snapshot` 是 undefined 這件事             |
| #805 | `getSettings` 的成功值用 `per_session`（＝硬編碼預設）         | 「渲染讀到的值」與「渲染預設值」在斷言上分不開              |
| #809 | `MessageService` 是 `{ add: vi.fn() }`（沒有 observable）      | `<p-toast>` 存不存在                                        |
| #809 | `overrideComponent` 把元件層 `providers` **整個換掉**          | 「元件自己 provide 會不會斷開出口」——**成因那一層被抹掉了** |
| #815 | `in: () => query` 丟掉參數；`campusScope` 寫死 `null`          | 條件下到哪一欄、下了哪些 id；而且永遠是不受限的身分         |
| #815 | `from: () => builder` 回同一個物件                             | 主清單與 `activeCount` **各自**下了什麼（漏的只有後者）     |

> **可操作的版本：看替身丟掉了什麼參數、寫死了什麼值、把哪一層抹平了** ——
> 那三件事各自對應一整類「永遠不會紅」的斷言。
> 尤其 `overrideComponent` 那種「把整層 providers 換掉」的替身：**它移除的正是成因所在的那一層。**

**fixture 的值也算**：#805 的成功值刻意改成 `daily_checkin`（≠ 硬編碼的 `per_session`），
否則那個 bug 在測試裡跟在本機一樣看不見。

### 探針的還原不能接在會被管線截斷的指令之後

[`labor-6.md`](labor-6.md) 那條「探針要寫成『改完一定還原』的**單一指令**」我做到了字面 ——
**而單一指令內部也會斷**：

```sh
# 壞的：head 提早結束 → SIGPIPE → 後面的 && 鏈整串不跑，陷阱留在檔案裡
cp bak f && 塞陷阱 && npx vitest ... | head -4 && cp bak f
```

那一次（#821）陷阱真的留在 `parents.ts` 裡，**下一個呼叫查出來才還原**。

**修法**：還原用 `;` 不用 `&&`，而且不要放在接了管線的指令後面；
**還原之後印一次計數自證**（`grep -c '<陷阱特徵>'` 該是 0、`grep -c '<守衛特徵>'` 該是 1）。
同一輪還有一次相關的：`for f in $FILES` 的 `$FILES` 是多行字串時
**zsh 不做 word splitting**，`cp` 報錯而測試回綠 —— **那個綠是假的**。用陣列 `FILES=(a b c)`。

> 兩件事的共同點：**「陷阱有沒有真的塞進去」本身要被驗證。**
> 所以塞完之後先印剩餘數量，看到 0 才跑測試。

### 「兩處各自推論同一件事」是一整族缺陷，修法是讓它們問同一支函式

#815 的根因不是「`!inner` 忘了跟著 scope」——是 `buildSelect` 問
「使用者有沒有傳 `campusId`」而 `applyCampusFilter` 問「scope 與 campusId 的交集」，
**兩個答案在某個輸入上分岔**。#815 第 2 節（`activeCount` 自己算一次）、
#821（9 個端點各算一次）都是同一族。

**修法一律是抽出單一判準，不是在第二處多寫一個條件** ——
多寫一個條件的話，下一個加同類程式碼的人還是會各自推論一次。

`isParentWithinScope` 因此刻意走 `resolveScopedParentIds` 再 `includes`，
**不寫反向查詢**（從 id 往回找）：多兩支查詢，換「判準只有一份」。
上限與升級路徑寫成 `ponytail:` 註解。

### 只有某一條路徑會炸 → 有一個順序你還不知道，去讀 `node_modules`

#804 的完整推導在上面。一般化：**`node_modules` 的 fesm bundle 是可讀的純 JS**，
`grep -n` 一次就看到呼叫順序，比從症狀反推便宜而且結論不是猜的。
這一輪用了三次：`activateRoutes`（#804）、`RouterOutlet.activateWith` 的
`OutletInjector`（#809）、`DialogService.open` 的 `DynamicDialogInjector`（#809）。

### `apps/api` 測試的三個環境坑

| 症狀                                             | 成因                                                          | 處置                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `Internal Server Error`（500）                   | handler 讀 `c.env.X`，裸 Hono 的 `c.env` 沒有值               | `app.request(path, {}, { X: '…' })` **第三個參數是 env**                 |
| `TS2589: Type instantiation is excessively deep` | lib 收 supabase 時用最小結構型別，撞上 supabase 的泛型展開    | 用 repo 慣例的 `SupabaseClient`（**不帶泛型參數**，七支既有 lib 都這樣） |
| 端點回 400 而你以為是實作壞了                    | query 參數走 `DbUuidSchema`，fixture 不是 UUID 就被驗證先擋掉 | fixture 用真 UUID；**而且替換字串時檢查 URL 裡的裸文字**（我漏過一次）   |

### 什麼時候必須疊 PR

**下一支要改的東西還在前一支的未合 PR 裡**，就必須疊 —— #821 要把 #820 內嵌的判準抽出來，
基於 main 開的話得重寫那段，而那正是要消滅的東西。
照 README 鐵律 1：**開成 draft，base 指前一支的分支，等它合進 main 才轉 ready 並轉 base。**

### kb 與格式化

**`kb/` 不要跑 prettier，格式化一律指名檔案** —— 理由與實例已收進
[`README.md`](README.md) 的全席通則（#812 的 59 檔）。這裡只放指標。

## 給下一個接手的人

- **charter 會腐化，接手時先驗一遍再信它。**
- 瀏覽器是共享的獨占資源（auth cookie 是 host 層級、不分 port，任何一席登入都會把別席踢掉），
  要實機驗證走計畫席排班，**不要自己登入**；驗收以單元測試為主。
