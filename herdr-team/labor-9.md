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

## 給下一個接手的人

- **charter 會腐化，接手時先驗一遍再信它。**
- 瀏覽器是共享的獨占資源（auth cookie 是 host 層級、不分 port，任何一席登入都會把別席踢掉），
  要實機驗證走計畫席排班，**不要自己登入**；驗收以單元測試為主。
