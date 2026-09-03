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

**有一條檢查刻意不站在這個階梯上：現況表。** `feature-map.mjs` 的「表過期」在分支上只警告，
**main 也只是警告**，重生交給 `verify.yml` 的 `sync-feature-map` job。
理由是這條檢查的輸入是**整個 repo 的磁碟狀態**而不是你改的檔案，所以並行分支必然互撞
（2026-08-29 一天內 #66 / #68 / #71 三連撞，撞的都是一張可以重生的表）。

> **設計新檢查時的判準**：這條檢查的輸入是「你改的東西」還是「整個 repo 的狀態」？
> 前者放分支（越左越好），後者交給 main 上會**自動修好它**的東西，各處只提醒。
> 錯放的代價不是漏檢，是每個人都要為別人的改動重生一次產物。

**而且：自動修復的 job 不可以被它要修的那個檢查擋住。** #74 原本在 main 上還留了一道
「表過期就紅」的雙保險，而 `sync-feature-map` 掛著 `needs: verify` —— 讓 verify 紅的正是
它要修的那件事，於是**能修的人只在沒壞時才來**，main 自己好不了（2026-08-30 真的卡住，
人工代打 `5be7927` 才解堵；#89 移除紅燈）。
加雙保險之前先問：**這道保險擋掉的，會不會就是解藥？**

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

**刻意用 `run-many` 不用 `affected`**：整套跑完很快，而 `affected` 在 CI 上要有正確的 base ref
才不會安靜失準。為了省幾秒換一個會安靜失準的東西不划算。
（`defaultBase` 曾經指向不存在的 `dev`，2026-09-03 修成 `main` —— 但 CI 的取捨不因此改變。）

**觸發條件是 `on: push`（所有分支），沒掛 `pull_request`**：
這個專案實際上在長期 feature branch 直接推、PR 開得晚。只掛 main + PR 的話開發全程零回饋。

---

## 三、harness gate：編號慣例與測試模式

### 兩支腳本，都是 check/write 雙模式

| 腳本                | 守什麼                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-harness.mjs` | A1–A16（文件宣稱存在的東西是否真的存在；A12–A16 是 hook-only clause 的存量那一半）                                                          |
| `feature-map.mjs`   | `kb/wiki/roadmap.md` 功能區現況表自動生成且同步（c11）。**表過期到處都只警告**（main 的 sync job 會重生）；「有東西沒被功能區認領」則到處紅 |

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

## 五、查 CI 紅燈的兩條紀律

這兩條是 2026-08-30 一個上午繳的學費，都不是「知道就好」，是**繞路的順序**。

### 紅燈會遮住紅燈 —— 修好一層要立刻看下一層

`verify.yml` 是**串列**的：`harness → harness self-test → typecheck → test → build web`。
前面紅了，後面**根本不會跑**。所以「main 現在只有一個問題」永遠是錯的推論 ——
你只知道**第一個**問題。

實例：現況表死結讓 main 卡在 `harness` 步驟，於是 `test` 從來沒跑到。等死結一解，
`web:test` 立刻紅 —— 那個破口**在 main 上已經存在好幾支 PR 了**，只是被前面的紅燈遮著。

**修好一層之後，先假設下一層也是壞的**，不要宣告「main 綠了」。

### 看不到錯誤訊息時，先懷疑 reporter，不要先推測死因

同一次事件裡我繞了兩圈冤枉路：

1. CI log 顯示 `✔ Building...` → bundle 清單 → `exit 1`，**零測試輸出**
2. 看到最後一行 log 寫到一半被截斷 → 推測是 SIGKILL
3. 由 SIGKILL 推測 OOM → 本機用 `--max-old-space-size` 壓，壓不出來
4. 加 `--verbose` 重跑一次 CI → **一行就給了答案**：`Test timed out in 5000ms`

真相是預設 reporter 的失敗摘要被 bundle 清單淹掉，而「log 被截斷」是 GitHub log
渲染的假象。**沒有錯誤訊息 ≠ 進程被殺**，它更常只是「訊息被沖掉了」。

順序應該是：**先把訊息挖出來**（`--verbose`、換 reporter、拋棄式分支加診斷步驟），
拿到訊息再談死因。第 2、3 步那種「從症狀外觀反推機制」的推理很有說服力，
而且錯了不會有人告訴你 —— 它只會讓你去驗證一個不存在的假設。

> 拋棄式診斷分支是好工具（`on: push` 涵蓋所有分支，推上去就有 CI），
> 但**查完立刻刪掉遠端與本地** —— 它裡面的 workflow 改動絕不能留在 repo 裡。

## 六、動手之前的兩個判斷習慣

這兩條是 2026-08~09 幾次驗收裡被點名的判斷，不是流程規定 —— 是「什麼時候該停下來」。

### 證據顯示問題不存在，就不該付那個權限

被指派做某件事，不代表那件事需要做。動手前先問：**我要解決的那個問題，證據顯示它存在嗎？**

實例（2026-09-02）：工單要求清完 Docker 之後跑 TRIM 讓 `Docker.raw` 還空間給主機，
建議的做法是拉一個第三方映像、以 `--privileged --pid=host` 進 VM。
但刪掉 7 GB 映像之後 `Docker.raw` 自己就從 162G 掉到 156G —— **自動回收本來就在運作**。
那條指令要付出的代價（第三方映像 + 特權 + 主機 PID namespace）真實，而它要買的效果
已經免費發生了。所以沒跑，回報理由。

> 這條特別適用於**特權、破壞性、或動到別人環境**的操作：
> 它們的成本是確定的，而收益常常只是假設。先驗證收益存在。

### 推之前先確認 PR 還開著

**合併的決定發生在別人手上，你的本地認知永遠可能過期。**

實例（2026-09-02）：我在一支 docs PR 上追加了一段內容並 `git push` 成功 ——
但那支 PR **在我推之前就被計畫席合併了**。push 成功、CI 也不會抱怨，
而那個 commit 落在一支已合併的分支上，**永遠不會自己進 main**。
是計畫席發現內容不在 `origin/main` 才攔下來。

所以要追加內容到一支已開的 PR 之前：

```bash
git fetch origin
gh pr view <n> --json state -q .state      # 必須是 OPEN
```

合併了就**從最新 `origin/main` 開新分支重放**，不要往舊分支推。
重放前先用 `diff` 對照 main 確認**到底缺哪幾行** —— squash merge 之後
`git log origin/main..HEAD` 會把已合併的 commit 也列出來（SHA 不同），
照它重放會重複貼上已經在 main 的內容。**權威是檔案內容的 diff，不是 commit 清單。**

> 同族：[[lessons/merged-does-not-mean-main]]。
> 也跟第五節的「先懷疑 reporter」一脈：`git push` 回報成功，不代表你的內容到得了目的地。

### 不要交出「看起來嚴謹但站不住」的量化

實例（2026-08-30）：被要求把慢測試排名、標出接近門檻的地雷。我想先算「本機 → CI」的
倍率好劃紅線，結果實測是 **CI 比本機快**（中位數 x0.34）—— 那條紅線根本沒有基礎。

交出一份按本機 ms 排序的名單會**看起來**很有用，而且沒人會去驗證那個倍率假設。
所以改用**枚舉**取代閾值：全 repo 掃「有沒有測試真的渲染大陣列」，只有兩支，
一支已修、另一支小一個數量級 —— 結論同樣是「零殘留」，但推導方式站得住。

> 附帶一個真訊號：原始事件裡會抖的是**變異度**不是絕對值（同一台機器 2327ms ↔ 6080ms，
> 2.6 倍）。踩在邊界上的徵兆是抖，不是慢。

## 七、幾個會再踩一次的坑

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
- **不要讓 worktree 停在別席的分支上。** 代解別人 PR 的衝突是可以的（infra 席常被指派，
  因為衝突多半落在 `feature-map.mjs` / `roadmap.md`），但**推完立刻放開**：
  `git checkout --detach origin/main`，並把本地那份分支刪掉。停著不放，對方就動不了。
  動手之前先 `git rev-parse --abbrev-ref HEAD` 看自己在哪。
- **合併進行中時 `HEAD` 還指在分支原本的 tip**，incoming 的檔案是 staged 狀態。
  這個中間態很容易被誤讀成「停在舊 commit 卻帶著一堆來路不明的改動」——
  2026-08-29 有人（包含我自己）這樣誤判過兩次。要比對遠端請用 `git rev-parse HEAD`，
  **不是 `HEAD^1`**（合併中那是分支的上一個 commit，不是遠端）。

## 八、接工單的查證習慣

**工單指名的目標本身也要查證，不是只查它描述的問題。** 派工的人看到的症狀通常是對的，
但他歸因的那個具體目標可能不是。

實例（2026-08-29，PR #68）：工單說「繳費功能區的 routes 缺 `invoices`」。症狀正確
（繳費被誤判成 🚧 空殼），但 `invoices` 不是答案 —— web 端當時沒有任何程式碼碰
`/api/invoices`，真正接上的是 `fee-templates` 與 `billing-periods`。
照工單補會讓「已掛載 API」欄位宣稱一條不存在的連線。

兩件從這裡長出來的事：

- **認領表反映的是「連線」不是「主題」。** `feature-map.mjs` 的「已掛載 API」語意是
  「**這區的頁面接得到幾支**」，不是「這個主題有幾支 API」。所以認領前要去看頁面實際
  import 了哪些 `@core/<domain>.service`，不是看名字像不像。
  這也是「課務異動認領 `sessions`」那條註解的原意。
- **時間差要問清楚。** 你查的是 `main`，但別席可能有 in-flight PR 正要新增你判定「不存在」
  的東西。上面那次就是：`core/invoices.service.ts` 在 admin-pages 席的待合 PR 裡。
  查證結論要標明「以哪個 commit 的 main 為準」，並回報時直接問有沒有相關的待合 PR。

## 已知缺口（接手時的待辦池 —— 這節會過期，接手第一件事：重寫它）

> 上次除鏽 **2026-09-03**，每條都當場查證過而不是照抄。
> 除鏽的方法：**逐條跑指令驗一次**（下面每條都附怎麼驗），已解的劃掉並寫解法，
> 不確定的就去量 —— 這節最大的風險不是漏記，是**留著已經解掉的條目**，
> 讓接手的人把力氣花在不存在的問題上。

### 還在的

- **`apps/web` 沒有獨立的 typecheck target**（驗：`npx nx show project web --json`）。
  CI 已用 production build 補上模板檢查，**但 Stop gate 沒有** ——
  本機收工時模板型別錯誤照樣過得去，要到 push 才紅。
- **c5（feature 不互相 import）未機器化。** 需要跨「路徑擷取的 feature 名」與「內容」的
  反向參照，現在的靜態 regex 引擎做不到，要接得寫一支獨立 check。
- **c2 還有 4 筆真債**（驗：`npm run harness` 的 A15 帳目）——
  `me.ts:124`、`parents.ts:621` 的 email 與 `parents.ts:625`、`staff.ts:1150` 的 phone。
  卡點不是難改，是**全 repo 零前例**：沒有任何一處用 `auth.api.updateUser` 更新過使用者。
  要先由 billing-api 席驗一處（能不能寫 additionalFields、email 重複時的錯誤形狀）再推廣。
  另有 1 筆**永久豁免**（`me.ts:151`，username 無 API 路徑且仍是唯一性鍵）。
- ~~`nx.json` 的 `defaultBase` 指向不存在的 `dev`~~ → 2026-09-03 修成 `main`，
  `nx affected` 可以直接跑。Stop gate 仍明寫 `--base=main`：**gate 的行為不該因為
  有人改 nx.json 而變**。
- **`test-baseline.json` 裡有 3 個既有紅燈**（驗：讀那個檔）。基線是債，清一支移除一支。
- **dagger 的建置快取沒有 GC 政策，磁碟會反覆爆。**
  fvg 的 engine `/etc/dagger/engine.toml` 是空的，而它在 VM 裡看到的可用空間是假的
  → 自動 GC 永遠不觸發。2026-09-02 清掉 126 GB，**不到一天長回 136 G**。
  已同步 fvg 席並建議設常設上限，**但那是他們的引擎設定**。
  本席掛了 watch（20 GB 警戒 / 10 GB 自動 prune），但那是止血不是解法 ——
  真正的問題「這台機器要不要繼續當 CI runner」不是本席能裁的。

### 這輪解掉的（保留一行，讓下一個人知道不用再查）

- ~~hook-only clause 對存量零覆蓋~~ → 2026-08-30 補上 A13（c7）/ A14（c8）/ A15（c2）/ A16（c3）。
- ~~c8 的 4 筆裝飾器債~~ → design-web 席已清零，allowlist 整筆移除，**gate 現在是全面覆蓋**。
- ~~c2 的 9 筆~~ → 2026-09-03 盤點收斂：3 筆 `orgId` 改**規則層豁免**（API 明確拒收，沒有合規路徑）、
  1 筆冗餘直接刪除、1 筆永久豁免，剩 4 筆真債（見上）。
- ~~等繳費頁 PR 合併後補 `'invoices'`~~ → 已補，`feature-map.mjs` 的「繳費」已認領。
