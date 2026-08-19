# Claude Code 設定說明 — Clessia

`.claude/settings.json` 是機器讀的設定；本檔是人類讀的版本。**動 hook 之前先讀這裡。**

所有 hook 都只是**薄 adapter**，真正的邏輯在 `tools/agent-harness/`。改行為改那邊，
不要把邏輯寫進 `.claude/hooks/*.sh`。

那些腳本刻意寫成 runtime-neutral（stdin 收 JSON、用 exit code 表態、不依賴 `CLAUDE_*` 以外
的東西且該變數有 fallback），所以其他 CLI 要接的時候直接 exec 同一支即可，不必複製一份邏輯。
目前只有 Claude Code 接上了。

## Hooks

### PreToolUse — 憲法 guard

- **Matcher**：`Edit|Write|MultiEdit`；`.claude/hooks/pre-guard.sh`（timeout 10s）
- **做什麼**：寫入落地前，把 repo 相對路徑 + **這次新寫入的文字**比對
  `tools/agent-harness/rules/pre-guard.rules.json`（目前 c2、c3、c6、c7、c8、c9）。
  命中就 **exit 2** 擋掉，並把 clause id 與修法方向回饋給 Claude。
- **只比對新內容，不比對整份檔案**：repo 已有 4 個檔案違反 c6、4 個違反 c8。若比對全檔，
  「去修掉那個違規」這件事本身會被擋住 —— 荒謬。所以規則的語意是「不准新增違規」。
- **c3 的 `whenTracked`**：只有 git 已追蹤的 migration 才擋，新建 migration 不受影響。
- **Fail-open**：payload 或規則解析失敗一律放行。壞掉的 guard 絕不能讓人無法編輯。
- **繞得過去**：用 Bash heredoc 寫檔不會觸發 Edit/Write matcher。它防的是順手違規，不是惡意。
- 誤判？調 rules JSON 的 regex 即可，**不用改程式碼，也不算修法**。

### PostToolUse — 每次編輯後格式化

- **Matcher**：`Edit|Write|MultiEdit`；`.claude/hooks/format.sh`（timeout 30s）
- **做什麼**：對剛寫入的檔案跑 `npx prettier --write`。**永遠 exit 0** —— 格式化失敗不該擋編輯。
- 專案沒有 eslint，所以這層只有 prettier。若日後導入 eslint，順序是 eslint 先（自動修）、
  prettier 最後（格式最終權威）。
- 另一支既有的 PostToolUse hook（`code-review-graph update --skip-flows`）保持不動。

### UserPromptSubmit — doc router

- 無 matcher（每個 prompt 都跑）；`.claude/hooks/doc-router.sh`（timeout 10s）
- **做什麼**：比對 `rules/doc-router.rules.json` 的關鍵字，命中就注入相關 `kb/` 頁面與程式碼位置
  當 `additionalContext`（最多 8 條）。
- **純 advisory**：不擋、沒命中就完全靜默、只加 context 不改寫 prompt。
- **為什麼是 hook 不是 skill**：只有 hook 能在**每個**相關 prompt 上確定性地把對的頁面推上來。
  更重要的是，它讓那些頁面**不必進 always-load context** —— 指標幾乎不花 token，
  頁面只在真的需要時才花。

### Stop — 收工驗證 gate

- 無 matcher；`.claude/hooks/stop-verify.sh`（timeout 600s）
- **做什麼**：工作樹有任何改動（含未追蹤檔案）時，依序跑
  `npm run harness` 與 `npx nx affected -t test --base=main`。
  紅燈 **exit 2** 擋住收工，stderr 尾巴成為 Claude 的下一條指令。
- **測試採基線比對**：測試輸出交給 `tools/agent-harness/test-gate.mjs`，只有**這一輪新弄壞的**
  spec 才擋收工；`tools/agent-harness/test-baseline.json` 裡的既有紅燈只印警告。
  基線項目恢復通過時會提示移除，但不擋人。
  重錄基線：`npm run test:baseline`。清空 `knownFailing` 就回到「非全綠不可」。
  > 為什麼：這個 repo 在 harness 建立前就有 3 支紅燈。「非全綠不可」的閘門會在每一輪都擋人，
  > 而且擋的是跟這輪改動無關的東西 —— 那種閘門的下場是被關掉，等於沒有。基線讓它只回答
  > 「這輪有沒有弄壞新東西」。基線是**債務**不是豁免。
- **刻意放行的情況**：
  - `stop_hook_active` → exit 0。防 live-lock 的強制設計；代價是每條 stop chain 最多強制修一輪。
  - 工作樹乾淨 → exit 0。純問答的回合不受管。
  - 回合中已經 commit → 工作樹變乾淨，這輪就不受管。已知缺口。
- **臨時關掉**：`CLESSIA_STOP_GATE=0`。
- ⚠️ **這個 gate 目前對 API 改動形同虛設** —— `apps/api` 沒有 `test` target，那 12 支
  `.spec.ts` 不會被執行。見 `kb/wiki/architecture/constitution-enforcement.md` 的已知缺口。

## Permissions

`allow` 是讓長時間工作不被權限提示打斷的白名單；`deny` 是**壓過所有 allow** 的安全底線。

- **allow**：測試 / 建置 / harness gate / nx affected / prettier / 新增 migration /
  `git add`·`commit`·`fetch`·`worktree` / code-review-graph 的唯讀查詢工具。
- **deny**：force push、delete push、`rm -rf`、`db:reset`（會清掉本機資料與 seed），
  以及 `Edit(kb/wiki/architecture/constitution.md)` —— **修法是人類的行為**，任何 agent session
  都不得直接改法條，不論 allow 怎麼寫。

⚠️ **`deny` 是字面比對**：`rtk git push --force` 這種前綴包裝會直接繞過去。本專案的全域規則
要求高輸出指令用 `rtk` 包，所以每條 deny 都補了 `rtk ` 與 `rtk proxy ` 變體。**新增 deny 時
一定要一起補**。

刻意**不**開放的：`npm install` / `npm add`、`node`·`python3` 等直譯器、`curl`、
`git push`。這些每次都會問。

## Hook 契約速查

- payload 走 **stdin JSON**（`tool_name`、`tool_input.file_path`、`cwd`、`stop_hook_active`…）
- `${CLAUDE_PROJECT_DIR}` 在 `command` 字串裡會展開成 repo 根目錄
- exit `0` = 通過（stdout 可回 JSON）；exit `2` = 擋下（PreToolUse 擋工具呼叫、**Stop 擋收工**，
  stderr 回饋給 Claude）；其他 exit code = 非阻塞錯誤，只出現在 transcript
- settings.json 的改動會被 file watcher 撿到，但**新加的 hook 要開新 session 才穩定生效**

## 品質層次

| 層          | 時機       | 阻塞? | 內容                                 |
| ----------- | ---------- | ----- | ------------------------------------ |
| pre-guard   | 每次寫入   | ✅    | 憲法確定性條款                       |
| format      | 每次寫入後 | ❌    | prettier                             |
| stop-verify | 每回合收工 | ✅    | harness gate + `nx affected -t test` |
| 人工 review | PR         | ✅    | Semantic 條款（c1、c5、c11）         |
