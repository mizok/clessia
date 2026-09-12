# labor-2 席 charter（執行席）

> **這一席原本沒有 charter。** 2026-09-12 開了 `labor-1` / `labor-2` / `labor-3` 三席，
> 而 README 的席位表沒有它們、`herdr-team/` 底下也沒有對應的檔 —— 於是
> 「session 會死，席位不死」那個前提對這三席**從第一天就不成立**：
> 新 session 接手時沒有東西可以繼承。這份是 labor-2 自己補的第一版。
>
> ⚠️ **席位表那三列、以及這一席的 domain 欄位要由計畫席填** —— 那是配置決定，
> 不是執行席能自己宣告的。下面「實際做過什麼」只描述觀察到的，不當成定義。

## 這一席實際做過什麼（2026-09-12，供計畫席定 domain 時參考）

跨領域的**測試與修復**工作，不綁單一 feature：`#670`（家長端測試的時間炸彈 →
全庫掃描 → 把驗收方法做成工具）。計畫席提過可能會分 `#661`（全站搜尋沒有取消
在途請求）的 B 類三支過來，形狀相同：**開檔逐支確認「看起來已經修好」的那些**。

## 開席前置（不做的話第一個小時會追錯方向）

**新 worktree 沒有 `node_modules`，root 與 `apps/api` 各要 `npm ci` 一次。**

只裝 root 的話 web 測試跑得動，而 `npm run harness` 會紅成這樣：

```
Error: Command failed: npx tsx .api-param-probe.mjs
    at collectApiParams (tools/agent-harness/lib/api-param-coverage.mjs:124:17)
```

**訊息一個字都沒提到依賴**，它指著 harness 自己的檔案 —— 讀起來就是「這道 gate 壞了」。
完整成因與「為什麼不加 gate」在 issue #676。

## 跑單一支測試（本 repo 的坑，別處抄來的指令都不對）

| 想做的事        | 正確寫法                                                        | 錯的寫法會怎樣                                                                    |
| --------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 跑一支 web spec | `npx nx test web --include='**/foo.spec.ts'`                    | `npx vitest run <路徑>` → `Cannot find package '@core/…'`（path alias 要走 nx）   |
| 同上            | glob 要用 `**/`，不要給 `src/…` 相對路徑                        | 給相對路徑 → `No tests found matching the following patterns`                     |
| 傳 vitest 參數  | 用 builder 的選項（`--include` / `--filter` / `--setup-files`） | `-- --run` → nx 回 `'run' is not found in schema`                                 |
| 跑一支 api spec | `cd apps/api && npx vitest run src/…/foo.spec.ts`               | api 是 `nx:run-commands` 包 vitest，CLI 不吃 `--setupFiles`（要用 `-c <config>`） |

**每一種錯法的輸出都可以被讀成別的意思**（「這個檔壞了」「這個測試不存在」），
這就是 README 那條「指令跑了，但不是你以為的那個指令」在本 repo 的具體形狀。

## `npm run test:timetravel`

把時鐘推 `TT_MONTHS` 個月（預設 3）跑全庫，抓 fixture 日期寫死的測試。
**用法與觸發條件在 `AGENTS.md`，不在這裡**（同一條規則不要兩份，會漂）。

這一席要記得的只有一件：**它的 setup 為什麼必須在 top-level 而不是 `beforeAll`** ——
理由寫在 `apps/web/timetravel.setup.ts` 的正上方，**動它之前去讀那一段**。
第一版包在 `beforeAll` 裡誤報了 4 支寫得完全正確的測試。

## 這一席撞出來的一個程式碼形狀，值得認得

**「用日期窗口重建列表」跟「把 API 回來的清單過濾一下」長得很像，而行為差很多。**

`fillMissingDays`（`parent/pages/attendance/attendance.util.ts`）從
`[dateFrom, dateTo]` **逐日重建**整份列表 —— 窗外的紀錄**不是排到後面，是整筆消失**。
於是測試替身餵進去的 fixture 在畫面上完全不存在，而斷言只會說「找不到」。

**全 repo 只有一個呼叫端**，所以下一個寫這種寫法的人不會知道它是陷阱。

## 交付紀律（這一席今天真的靠它擋下東西的三條）

這些是 README 通則的**本席載體**，寫在這裡是因為它們今天各救了一次：

1. **驗證失敗時先懷疑驗證器。** 時光機第一版誤報 4 支，是這條在報給計畫席**之前**擋下的。
   →「那是唯一不用花第二個人時間的攔截點」（#614 裁定）。
2. **要判斷成敗的指令不要接管線。** `… | grep …; echo "(exit=$?)"` 拿到的是 `grep` 的 0。
   **先存變數**：`OUT=$(指令 2>&1); echo "退出碼=$?"`。
3. **force-push / 疊分支之前，`gh pr view <N> --json state` 要是獨立的一次呼叫。**
   計畫席合併很快 —— 2026-09-12 有兩支 PR 在我**兩次工具呼叫之間**被合掉。
   判準：`git rev-list --count <我的分支>..origin/main` 不是 0 就從新 main 重建，
   **轉 base 沒有用**（README 有完整一則）。

## 給下一個接手的人

- **charter 會腐化，接手時先驗一遍再信它。** 上面的指令表尤其 —— nx / vitest 升版會改。
- 這份**刻意不寫**「現在在做什麼、哪支 PR 在飛」。要查現況用
  `gh issue list --label seat:labor-2 --state open` 與 `gh pr list --state open`。
