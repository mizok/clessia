# labor-reviewer-20261112-1759 交接（2026-11-18 17:17）

> 常設審核席的交接頁。**完整 charter 在 [`labor-reviewer.md`](labor-reviewer.md)**，那一份要先讀，這一頁只記
> 本席任內（11-12 ～ 11-18）的現況與待辦。接手的是 `labor-reviewer-20261118-*`。

## 1. 代合規則（v3）與授權範圍

| 類別                                      | 誰合                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 一般類                                    | 計畫席派過＋審核席二讀 → 審核席代合                                                                                                                                                                                                                                                    |
| 保留類（migration／金額／授權與分校範圍） | 另外要 **PR 上**有計畫席「讀過 diff」或「已讀 diff」留言（訊息裡說的不算），審核席再做獨立二讀：讀碼＋突變＋契約                                                                                                                                                                       |
| migration 的 prod-db Approve              | **只有使用者按**，審核席永遠不按，也不等它；兩支 migration 不得同時停在 waiting（前一支 Approve＋deploy 完才合下一支）                                                                                                                                                                 |
| 修憲、`db:reset`                          | 不碰                                                                                                                                                                                                                                                                                   |
| backfill（after-deploy）                  | 原本是使用者親合類。11-18 計畫席依使用者「我把判斷的權力交給你」裁定可由鏈代合，**但本席把 #2559 排上 chain 時被 auto mode classifier 擋下**（Unsanctioned Communication）。結果 #2559、#2563 是計畫席依使用者 14:0x「你幫我合併」親自合的。**新席遇到 backfill 先問，不要假設能代合** |

- 使用者 11-13 在本席 pane 打過「放行本席合併與留言」—— 那是本席的放行，**不會自動帶到新席**；auto mode 擋合併或留言時，請使用者在新席 pane 再說一次，不要拿計畫席的轉述代替。
- 合前一律 `gh pr view <n> --json headRefOid` 對審過的 SHA；不符就停，問計畫席。
- 疊單或要併 main：**merge main，不 rebase、不 force push**。衝突自己解的範圍只有三種：R5 表（`kb/wiki/architecture/a6-adoption-rules.md`）、baseline JSON、a6.css／a6.js 檔尾；動到 apps 或 spec 的衝突一律回作者。另外 `package.json`／lock 的衝突，計畫席授權由審核席解（見第 4 節 #2556 的解法）。

## 2. 全機測試鎖（新規則）

```bash
L=~/.cache/clessia-fulltest.lock
until mkdir $L 2>/dev/null; do sleep 30; done
echo $$ > $L/pid; echo "<席名> <用途>" > $L/who
trap 'rm -f '$L'/pid '$L'/who; rmdir '$L'' EXIT INT TERM HUP
```

- **pid 檔只寫 `$$`**，席名寫在 `who`。本席曾把文字寫進 pid 檔，結果鎖被別人當成過期鎖清掉兩次。
- 拿鎖只用 `until mkdir` 等；**不清別人的鎖**，過期鎖只由計畫席確認 pid 已死之後清。
- 突變、harness、全套測試一律在**暫存 worktree** 跑（`<repo>/.worktrees/scratch-<席名>-<用途>`），不在席位 worktree 跑：席位 worktree 會被 Stop hook 驗，撞上突變就是假紅。

## 3. 工具

| 工具                          | 在哪                                                     | 怎麼用                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chain.sh`                    | `tools/reviewer-merge/`（進版控，見該目錄 README）       | `NOTIFY_AGENT=labor-plan-20261105-1551 REVIEWER_NAME=<席名> bash tools/reviewer-merge/chain.sh <PR> <完整SHA> [<PR> <SHA>…] > tmp/chain-x.log 2>&1`，背景跑，**一次只跑一條**。每張合完等 main verify 綠才下一張，合成才自動回報計畫席                                                                                  |
| `mutapi.py`                   | 本席 worktree 的 `tmp/mutapi.py`（gitignored，不在版控） | `python3 tmp/mutapi.py <暫存worktree> <單元spec,…> <契約,…> <muts.json>`。muts.json 每筆 `{name,f,o,n,k?}`（`f` 相對 `apps/api`，`k`＝第 k 處出現）。先跑基準，再逐筆替換→跑→還原，印單元與契約的摘要行。**沒有摘要行＝突變無效（多半是編譯錯），不是被抓到**                                                           |
| `cmpstack.sh`／`cmpstack2.sh` | 本席 worktree 的 `tmp/`（gitignored）                    | `bash tmp/cmpstack.sh <審過SHA> <原審base> <新head>`：驗併 main 後的 merge commit——審過的 SHA 在祖先、沒有夾帶非 merge 新 commit、檔案清單與逐檔 +/− 跟原審相同、R5 淨增與重複列。`cmpstack2.sh` 一樣，但用 `MAINREF` 環境變數指定比對的 main（origin/main 已經往前走時用）。R5 的「main 列缺」是本張加註的列，不是遺失 |
| 契約的環境變數                | —                                                        | `eval "$(npx supabase status -o env \| grep -E '^(API_URL\|SERVICE_ROLE_KEY\|DB_URL)=')"; export SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY DATABASE_URL=$DB_URL CONTRACT_REQUIRED=1`，在 `apps/api` 跑 `npx vitest run --config vitest.contract.config.mts <檔>`                                |

- **暫存 worktree 的 `apps/api/node_modules` 要真的 `npx -y npm@10.9.3 ci`**，不要 symlink 席位的：main 已升 better-auth 1.7.25，舊席位 worktree 的是 1.5.5，symlink 會讓 auth-google 契約假紅 4 條（本席在 #2567 踩過）。根目錄的 `node_modules` 可以 symlink，除非這張 PR 動了根 `package.json`。
- 本席的帳：`.worktrees/labor-reviewer-20261112-1759/tmp/pending-reviews.md`（每張的 pin、二讀結論、merge SHA，依時間追加）。

## 4. 本席任內的現況與坑

- 11-18 一天代合 27 張（#2549 ～ #2571，清單在帳上），main 收在 `6a2a0893`；之後新批的 #2572（a11y lint PR1）已合 `cb8607cd`。
- **migrate plan 的 blocked 不是 waiting**：#2570 第一次 plan 判 blocked，因為正式 DB 還沒套 #2559／#2563 兩支 after-deploy backfill，而 schema 比待套的 backfill 新就會擋。計畫席先 dispatch migrate 把 backfill 套掉，之後才輪到 #2570 的 Approve。
- **lock 檔衝突**（#2556）：以 main 的 lock 為底重生會 ERESOLVE（Angular 套件互相釘死版本，不能單獨升）。解法是以 **PR 的 lock** 為底，`npx -y npm@10.9.3 install --package-lock-only` 補進 main 新加的套件，不用 `--force`／`--legacy-peer-deps`；之後真 `npm ci` 確認 lock 0 改寫。
- **刪 lint 帳的 PR 併 main 後要在「無帳」狀態下重跑 lint**（#2562／#2564）：PR 自己的 CI 是在 main 還有帳時跑的，main 新進的程式碼可能在無帳下紅。
- 契約認領的突變寫法：把該端點的 `getCampusScope(c)` 換成 `null`（＝不受限），或把 `outOfCampusScope(..., getCampusScope(c))`／`studentWriteScope(..., getCampusScope(c), …)` 的範圍參數換成 `null`。**交易內的第二道範圍檢查**（`enrollWithSeatLock`、`directEnrollWithFirstInvoice` 的 `scope`）單獨拿掉測不出來：同一請求在第一道就 404 了。這算縱深防禦，不擋（#2575）。

## 5. 交接時的鏈與待辦

本席收手前合完：#2573 → #2574 → #2575 → #2576 → #2577（#2576／#2577 會撞 baseline JSON，解法：取 main 版本，再刪掉該 PR 認領的那幾筆）。**以帳上最後一行為準**；沒合完的接著合。

**留給新席二讀＋代合**（全是保留類純契約，計畫席「讀過 diff」留言都已貼；全部基於 main `6a2a0893`，只動 contract 檔與 `tools/agent-harness/campus-scope-contract-baseline.json`）：

| PR    | 範圍             | 釘                                         | baseline | 重點                                                                     |
| ----- | ---------------- | ------------------------------------------ | -------- | ------------------------------------------------------------------------ |
| #2578 | campuses         | `4832e30111d38f55baf39b0b573417c2428cf08f` | −7       | 依序模擬不撞                                                             |
| #2579 | parents          | `462cfbfa37d65fab5f3899f70f9831081f9af9bb` | −7       | 會撞 baseline，照上面解法                                                |
| #2580 | scores           | `c108fefdb1e76aaf53c976748da9b842e43cd0f8` | −6       | 動三支契約（scores-overview-1928、scores-scope-1928、scores-scope-2493） |
| #2581 | classes          | `6f639696d0af2b98b36f87eb308e634279a5016c` | −18      | 會撞 baseline；18 支，突變最多                                           |
| #2582 | invoices         | `ba7d2f8757206c4a1777abf622b3d90ef813de07` | −8       | **金額類端點，計畫席要求突變全部重跑（四組）**                           |
| #2583 | grade-promotions | `355581da338de7a56edd4bce2d846594997b0518` | −4       |                                                                          |

二讀固定兩件：①每支被認領的端點（`// scope-contract: METHOD /api/path` 標記）都有真的範圍斷言 —— harness A30 只認標記、不驗斷言，所以要讀契約本身；②突變要紅。每合一張，下一張要先併 main，再照 baseline 解法解衝突（模擬依序合併用 `git merge-tree --write-tree` 加 `git commit-tree` 串起來）。
