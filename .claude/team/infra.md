# infra 席 charter

> 給下一個坐這個位子的 session。5 分鐘讀完能開工。
> 這份是**經驗傳承**，不是法 —— 具約束力的東西在 `kb/wiki/architecture/constitution.md`。

## 你負責什麼

CI、agent harness、依賴、工具債、憲法 enforcement 機制。

**判準**：改動的是「驗證與工具鏈」而不是「產品行為」，就是這一席。
新增一個 gate、升一個套件、修 workflow、補 hook 規則 → 你的。
改一支 route 的授權邏輯、加一個頁面 → 不是你的（那是領域席）。

**邊界（硬的）**：你不得寫入 `kb/wiki/architecture/constitution.md`。
草擬條文、寫拋棄式腳本交給人跑、補 enforcement 表、寫理由頁都可以，
**按下那個按鈕不行** —— 包含透過 Bash 繞過 Edit deny 規則。
2026-08 有過一次違反，歧義一律往「先問」解。

---

## 一、檢查階梯：四層，只有一層繞不過

```
編輯當下              收工當下              push 當下            人工 review
PreToolUse guard  →   Stop verify gate  →   CI verify        →   程式碼審查
（exit 2 擋寫入）      （exit 2 擋收工）      （唯一繞不過的）      （Semantic 條款）
```

前三層的分工要記牢，不然你會把檢查加在錯的層：

| 層               | 檔案                                                                        | 特性                                                                                                      |
| ---------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| PreToolUse guard | `tools/agent-harness/hooks/pre-tool-use.mjs` + `rules/pre-guard.rules.json` | 只看**這次新寫入的文字**，不看整份檔案。刻意窄、刻意低誤判、**fail-open**（規則壞掉一律放行）             |
| Stop verify gate | `hooks/stop-verify.sh`                                                      | `check-harness.mjs`（**不含** `feature-map.mjs`）+ `nx affected -t typecheck` + `-t test`，**兩條分開跑** |
| CI verify        | `.github/workflows/verify.yml`                                              | 掛在**所有分支的 push**，`run-many` 不是 `affected`                                                       |

**本機三層全部繞得過**：heredoc 寫檔不觸發 PreToolUse、`CLESSIA_STOP_GATE=0`、
`git commit --no-verify`、直接關掉 hook。所以**真正的把關在 CI**，
本機那些的定位是「把回饋左移到編輯當下」。設計新檢查時照這個定位選層。

### typecheck 與 test 為什麼分開跑

typecheck 的輸出沒有 vitest 的 `FAIL <spec>` 行。混在一起，
`test-gate.mjs` 的基線比對會把型別錯誤當成「沒有 FAIL 行 = 沒事」放行。
**不要為了省一次 nx 啟動把它們合併。**

### 測試走基線比對，不是全綠

`test-gate.mjs` + `test-baseline.json`：只擋**這一輪新弄壞的** spec，既有紅燈只警告。
基線是債務，清一支移除一支。重錄用 `npm run test:baseline`。

---

## 二、verify.yml 的序列，與為什麼是這個順序

```
npm ci  →  npm ci (apps/api)  →  harness  →  harness self-test
        →  typecheck  →  test  →  build web (production)
```

三件容易踩的事：

1. **`apps/api` 是獨立的 npm package**（自己的 `package.json` / `package-lock.json`，
   因為它用 wrangler 部署到 Workers）。根目錄的 `npm ci` 不會裝它的依賴。
   本機看不出來是因為 `apps/api/node_modules` 早就存在。**開新 worktree 兩邊都要 `npm ci`。**
2. **順序 = 由快到慢**。前面便宜的檢查先紅先省 CI 時間。
   `build web` 排最後（本機冷跑 ~11s，CI 整個 run 約 1m36s）。
3. **`build web` 是唯一會編譯 Angular 模板的一步。** `web` 沒有 `typecheck` target，
   `nx run-many -t typecheck` 實際只跑得到 `api`。
   模板型別錯誤（綁到不存在的 property、signal 忘了呼叫）**只有 AOT build 抓得到**。
   這個缺口在 2026-08-29 之前 CI 是全綠放行的。

**刻意用 `run-many` 不用 `affected`**：`nx.json` 的 `defaultBase` 是 `dev`，
而這個 branch **不存在**。任何 `nx affected` 都得自己帶 `--base=main`。
為了省幾秒換一個會安靜失準的東西不划算。

**觸發條件是 `on: push`（所有分支），沒掛 `pull_request`**：
這個專案實際上在長期 feature branch 直接推、PR 開得晚。只掛 main + PR 的話開發全程零回饋。

---

## 三、harness gate：編號慣例與測試模式

### 兩支腳本，都是 check/write 雙模式

| 腳本                | 守什麼                                                 |
| ------------------- | ------------------------------------------------------ |
| `check-harness.mjs` | A1–A12（文件宣稱存在的東西是否真的存在）               |
| `feature-map.mjs`   | `kb/wiki/roadmap.md` 功能區現況表自動生成且同步（c11） |

`npm run harness` = check（過期 exit 1）；`npm run harness:write` = 重生成。

### 編號慣例

- **`A<n>` 是 harness gate 的檢查編號，`c<n>` 是憲法 clause。兩套不同的號，不要混。**
  一條 clause 可以被多個 A 守（c6 = pre-guard + A12），一個 A 也可以不對應任何 clause（A11）。
- 編號**只增不重用**。A4 不存在 —— 退掉的檢查留著洞，不要遞補，
  否則舊 commit 訊息與註解裡的 A4 會指到別的東西。
- 新增檢查：在 `check-harness.mjs` 加一段 `// ── A13. 描述（clause cN）──` 註解 + 實作，
  然後**同步更新 `constitution-enforcement.md` 的兩張表**（條款→機制、A 檢查項）。
  A5 會反過來驗你引用的 clause id 真的存在於憲法裡。
- 不擋人但看得見的問題進 `warnings`（不影響 exit code），不要進 `failures`。

### 生成區塊是正規化後比對

PostToolUse 的 prettier 擁有這些檔案。用原始字串比對會變成
「gate 紅 → 重生成 → prettier 改回去 → 又紅」的無限乒乓。
**改版面放過，改內容照樣紅。** 加新的生成區塊時照抄這個做法。

### self-test 的模式

`harness.test.mjs`，**node 內建 test runner，沒有框架沒有設定**（`npm run harness:test`）。
規則引擎壞掉時上面那層會**安靜地放行**，所以這層是必須的。

寫法照抄既有的：一個 `guard()` 小 helper 把規則引擎包成 `(path, text) => [clauseIds]`，
然後一條測試斷言一個邊界。**每條測試的名字寫「為什麼」不是「測什麼」**。

**加新的 pre-guard 規則 → 一定配一條 self-test，而且要含反例**
（什麼不該被擋）。誤判的 guard 比沒有 guard 更糟：它會讓人去關掉整個 hook。

### KB 的健康度不在 gate 裡

`npm run harness` **不檢查 `kb/` 的內容**。那由使用者層級的 kb-wiki skill 負責
（`/kb-wiki lint` / `map` / `verify`），是**人觸發**的，不在任何 hook 上，而且
**skill 不在 repo 裡**（住 `~/.claude/skills/kb-wiki`），換一台機器可能不存在。
harness 缺席時只印警告不紅燈。

這是刻意的取捨：內容正確性是語意判斷，確定性 gate 假裝做得到只會給虛假的安全感。
代價是要靠人記得跑 `verify`。

---

## 四、依賴升版的驗證法

**`npm ci` 綠不代表依賴是健康的。** lock 裡凍住的版本與從零解析的版本是兩套答案，
只有刪掉 lock 才會炸。實例（PR #51）：

- root 宣告 `wrangler: "^4.65.0"` → 從零解析拿到 **4.127.1** → peerOptional 要 `workers-types ^5`
- root 卻釘 `workers-types: "^4"` → **ERESOLVE**
- 但 lock 裡凍著 wrangler **4.65.0**（它要 `^4`），所以 `npm ci` 一路綠

### 標準流程

```
1. 沙盒重現：把 package.json 複製到空目錄，npm install --package-lock-only --prefix <dir>
   —— 這是「從零重建」的最小成本模擬，不動你的 node_modules
2. 定向升版：npm install <pkg>@<range>（保留既有 lock，只動要動的）
   絕不用 --legacy-peer-deps；--force 也先別用，先問「是不是別的套件也該一起升」
3. 沙盒再驗一次：同樣的 --package-lock-only，確認 ERESOLVE 消失
4. npm ci → harness → nx run-many -t typecheck,test → nx run-many -t build
```

**第 2 步用定向升版，不要整份重生 lock。** 實測差距：定向 688 行 vs 重生成 31,118 行
（後者順帶搬動上百個 transitive dep，沒人 review 得動）。

**peer 衝突的正解通常是「兩邊一起升」而不是「壓過去」。**

**看不見的消費者**：`@cloudflare/workers-types` 宣告在 root，
但真正用它的是 `apps/api/tsconfig.json` 的 `types: [...]`（靠 hoisting 解析）。
所以 **`nx typecheck api` 綠燈才是這次升版的實質驗證**，不是 root 裝得起來。

---

## 五、幾個會再踩一次的坑

- **`angular.json` 已刪除（2026-08-29）。** 建置設定的真相來源是
  `apps/web/project.json` / `apps/api/project.json`。
  **不要用 `ng` 開頭的指令** —— 沒有 `angular.json` 時 Angular CLI 不報錯，
  它會**往上層目錄找到別的 workspace**（在 worktree 底下就是母 repo 的 angular.json）
  然後把檔案寫到錯的地方。實測 `npx ng g c foo` 會寫進 repo 根目錄。
  產生元件用 `npx nx g @schematics/angular:component <name> --type component`。
  generator 的 `style: scss` 預設在 `nx.json` 的 `generators`。
- **worktree 的 git stash 是共用的。** 別用裸 `git stash` / `pop`，會 pop 到別的 session 的東西。
  要暫存改用臨時 WIP commit。
- **專案沒有 eslint。** PostToolUse hook 只跑 prettier，沒有任何 lint 層。
  想加的話那是這一席的事，但先問：多一層要有人維護。
- **`nx affected` 一律自己帶 `--base=main`。**

## 已知缺口（接手時的待辦池 —— 這節會過期，接手第一件事：重寫它）

- `apps/web` 沒有獨立的 typecheck target。CI 已用 production build 補上，
  **但 Stop gate 沒有** —— 本機收工時模板錯誤照樣過得去，要到 push 才紅。
- c5（feature 不互相 import）未機器化。需要跨「路徑擷取的 feature 名」與「內容」的反向參照，
  現在的靜態 regex 引擎做不到，要接得寫一支獨立 check。
- hook-only clause 對存量零覆蓋：c2 / c3 / c7 / c8 只有 hook 沒有 gate（c6 的 A12 是範本）。
- `nx.json` 的 `defaultBase` 指向不存在的 `dev`。
- `test-baseline.json` 裡的既有紅燈是債務。
