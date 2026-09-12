# labor-6 席 charter（執行席）

> 2026-09-13 開席當天建檔。**內容刻意先薄** —— 退場前才蒸餾「下一個接手的人必須知道的事」。
> 現在寫進來的只有兩類：**開席就會用到的前置**，以及**這一席第一天撞出來、而位階高的那份
> 文件已經收走的東西的指標**（同一條規則兩個地方會漂，所以這裡只放指標）。
>
> ⚠️ **domain 由計畫席定**。跟 `labor-1` / `labor-2` / `labor-3` 同型：通用執行席，不綁領域。

## 開席前置

- **新 worktree 沒有 `node_modules`，root 與 `apps/api` 各 `npm ci` 一次。**
  只裝 root 的話 `npm run harness` 會紅在一個完全沒提到依賴的訊息上
  （成因見 [`labor-2.md`](labor-2.md) 第一節，不重寫）。
  **`apps/api` 那一次不只是為了 harness** —— `login-link.ts` 需要 `pg`，
  少了它第一次自產 magic link 就會 `Cannot find module 'pg'`。
- 跑單支測試的 `--include` glob 寫法：同樣看 [`labor-2.md`](labor-2.md)。

## 做過什麼

| 工單 | 形狀                                                                        |
| ---- | --------------------------------------------------------------------------- |
| #756 | 整站 UI 地圖 Phase 2（53 頁在 390 / 768 / 1024 再量一次），負責 admin 30 頁 |

## UI 地圖：方法的唯一真相是 `kb/wiki/specs/sitemap/README.md`

**量測方法、取樣器、十二個坑、Phase 2 的多寬度做法全部在那裡**，這份 charter 不複製。
第一天撞出來而收進那份的幾件（指標，細節去讀）：

- **`resize_window` 在這台機器上是空操作，而它回報成功** —— 連帶解釋了坑 6 與坑 12
  在這個環境是常態不是意外
- **同源 iframe 就是 viewport**：media query / container query / `--window-width` 全部跟著它走。
  附帶好處是**不動共用視窗，所以多席可以同時量不同寬度**
- 取樣器要補 `opacity` 祖先與 `elementFromPoint` 兩道濾網
- `@media (pointer: coarse)` 模擬不了 → `< 44px` 清單一定要交叉比對 CSSOM

## 這一席自己的判準（不在方法頁裡的那些）

**工具回報成功不等於它做了那件事。** 第一天最貴的一次是 `resize_window`：
它回 `"Successfully resized window …"`，而視窗紋風不動。
**如果我沒有在 resize 之後去問一次 `innerWidth`，接下來三十頁的地圖全部會是 1504 的數字
掛在 390 的標題底下** —— 而每一頁的兩向比對都會是 0 差異，因為比對的兩邊來自同一個錯的寬度。

> 一般化：**凡是「改變環境」的呼叫，回報成功之後要再量一次環境本身。**
> 這跟 README 那條「宣告缺陷之前先排除自己」是同一件事的上游 ——
> 那一條講的是量到奇怪的東西之後怎麼辦，這一條講的是**量之前**。

## 給下一個接手的人

- **charter 會腐化，接手時先驗一遍再信它。**
- 方法類知識先讀 `kb/wiki/specs/sitemap/README.md` 與 `herdr-team/README.md`，
  這份只放它們沒有的。
- 現況用 `gh issue list --label seat:labor-6 --state open` 與 `gh pr list --state open` 查，
  **這份刻意不寫「現在在做什麼」。**
