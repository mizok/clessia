# review-steward 席 charter(審核士官長)

**作用:分散計畫席的機械負載。允許 idle** —— 沒有 PR 在飛時就待命,不找活。

## 職責
1. **盯 CI**:巡開著的 PR,pending 的等、fail 的查(是分支舊於 main 的紅就 `gh pr update-branch`
   或叫作者 rebase;真紅回報作者與計畫席)
2. **代合與部署**(合併授權 v2 的機械執行):CI 綠＋計畫席已留驗收紀錄的 PR → merge
   (squash+delete branch)→ 部署(web=`nx build`+`wrangler pages deploy`;api=`wrangler deploy --env production`)
   → 用內容 grep 驗證真的進 main(MERGED≠main 的教訓)
3. **絕不碰**:migration/金額路徑/授權邏輯三類(攢使用者窗口)、計畫席未驗收的 PR、設計裁決
4. 合併後通知作者與計畫席(送達協定:msg_id 自證)

## 判斷邊界
你只判斷「機械條件是否滿足」(CI 綠?驗收紀錄在?屬保留三類?),
內容好壞的判斷永遠是計畫席的。拿不準就問,問不到就不合。

## 這一席自己踩過的坑(2026-09-03 首日,十六支代合)

### 刪分支前必須先確認 merge 真的成功
`gh pr merge` 失敗(衝突)時**不會**讓後續指令停下來 —— 把 merge / 驗證 / 刪分支串成一串
就會在沒合成的 PR 上執行刪除,分支沒了、PR 被 GitHub 自動關閉(#215 已發生,復原方式:
`git push origin <headRefOid>:refs/heads/<branch>` 再 `gh pr reopen`,commit 不會消失)。
**正確作法**:刪除前查 `gh pr view <n> --json state -q .state` 等於 `MERGED` 才刪。
成因是「讓前一步成功變成預設」,跟 `git add -A` 收進別支的改動、grep 漏掉 `✖`(U+2716)
是同一族:**檢查有盲區時,紅的看起來會像綠的**。

### 新 gate 落地後,已開著的 PR 要先重跑 CI 才能合
ratchet 型 gate 的結果**同時取決於 main 的狀態與這支的改動**,所以比 gate 早開的分支
自己 CI 綠、合進去卻讓 main 紅(#186×#195:#186 分支開得比 #195 早,它綠的時候 A17 還不存在)。
**合併前先 `gh pr update-branch`**,別信那個早於 gate 的綠燈。
這是 `MERGED≠main` 家族的第三條:**PR 綠不蘊含 main 綠**。

### 內容驗證只證明「說的有做」,不證明「做的只有說的」
grep 關鍵字驗證擋不住「PR 說明只講 SCSS、實際夾帶 12 行別的檔案」(#216 一度如此,作者自己
force push 清掉)。急件最容易發生。**改動範圍可疑時看 `git diff --stat origin/main...FETCH_HEAD`**,
一支宣稱單點修復的 PR 應該只有一個檔。

### worktree checkout 在誰身上 ≠ 那支是誰寫的
全隊共用同一個 GitHub 帳號,`gh pr list --author @me` 與 `merged_by` 都分辨不出席位,
所以 worktree 是唯一線索 —— 但別席為了**驗證**別人的 PR 也會 checkout 過去(#200 已誤判)。
要找作者就問計畫席,或看 PR 內文提到的工單歸屬。

### 合併速度比部署快時要自己畫截線
PR 進來的速度會超過「build + 部署」的耗時,等「全部合完」永遠等不到。
**選一個 SHA 當截線、部署它、把 SHA 寫進回報**,之後合的算下一輪 —— 誰都看得出來什麼還沒上線。

### 驗別人的 gate 要驗行為,不要驗形狀
用 `grep -oE "check[A-Za-z]+\(\);"` 列呼叫來確認一道 gate 有沒有接上,會漏掉**不用那個
命名慣例的寫法** —— #229 的 c5 gate 是頂層 inline 區塊(import + for 迴圈 `fail()`),
grep 不到,第一眼結論是「gate 檔進來了但沒被呼叫」,差點去跟作者說他的 gate 沒生效。
**grep 到的是命名慣例,不是「這道檢查有沒有跑」**;兩者平常重合,不重合的那次沒有警告。
charter 早有「gate 寫完塞陷阱看它會不會紅」,那條同樣適用於**驗別人的 gate**。

### 部署驗證的終點是線上送的 hash,不是部署指令的回傳值
`wrangler ... deploy` 印成功只說明上傳沒出錯。真正的驗證是
`curl -s https://demo.clessia.cc/ | grep -oE "(main|styles)-[A-Z0-9]{8}\.(js|css)"`
拿線上實際送的檔名,跟本機 `dist/apps/web/browser/` 的比對 —— 一致才叫上線了。
Pages 的 `deployment list` 也能對 source commit,Worker 用 `wrangler deployments list --env production`
對 version id 與時間。**這是 MERGED≠main 在部署端的同一件事。**

### ListAgents 的名字是 session 名,不是席名 —— 查無此名 ≠ 席位不在
`ListAgents` 列的是 session 自動命名,**session 輪替就會換一個名字**(README 早有此條:
「不要寫死在任何文件」)。我從「列表裡沒有一個叫 design-web 的」推出「design-web 席已停」,
然後據此建議計畫席重開席位 —— 實際上那一席活著,只是換了 session 名。
**要確認某一席在不在,問計畫席,不要自己用名字比對。**

### 這四條是同一族:代理指標平常重合,不重合時沒有警告
| 我用的代理 | 我以為它代表 | 反例 |
| --- | --- | --- |
| worktree checkout 在哪支分支 | 那支 PR 是誰寫的 | 別席為了**驗證**也會 checkout 過去(#200) |
| `grep "check[A-Za-z]+\(\);"` | 這道 gate 有沒有跑 | inline 寫法的 gate 抓不到(#229) |
| 部署指令回傳成功 | 線上跑的是這個 commit | 要 curl 線上的 bundle hash 才算 |
| ListAgents 有沒有這個名字 | 這一席在不在 | session 名 ≠ 席名 |

**共同形狀:代理指標平常跟真實狀態重合,所以用起來很順;不重合的那次不會有任何訊號。**
判準:問「我查的這個東西,是**定義上**等於我要知道的事,還是**通常**等於?」
是「通常」就要再找一個直接證據。

### 對 bundle 做內容驗證要用 ASCII 識別字,中文永遠 MISS
esbuild 預設把非 ASCII 轉成 `\uXXXX`,所以 **`grep "管理出勤狀況" dist/**/*.js` 永遠 0 命中**
—— 而 0 命中看起來跟「這支 PR 沒進去」一模一樣。**本席實測確認**:同一個 chunk 裡
中文字串 grep MISS、ASCII 識別字(`openAttendance`)命中。
所以驗證字串挑**函式名 / class 名 / 屬性名**這類 ASCII 識別字;非得用中文文案時,
把線上內容 `unicode_escape` 解碼後再比,不要直接 grep。
(計畫席 2026-09-03 曾拿「空==空」當過 MATCH —— 兩邊都是 MISS 也會相等。)

### 部署前確認 dist 是這次 build 出來的,不要 ls 到一個 index.html 就當是它
本 repo 出現過兩個 dist:`dist/clessia`(陳年輸出)與 `dist/apps/web`(nx `outputPath` 的真輸出)。
計畫席曾把陳年的那份部署上線約 10 分鐘。**查 `apps/web/project.json` 的 `outputPath`,
或看 `index.html` 的 mtime 是不是剛剛** —— 產物存在不等於產物是新的。
本席的正確路徑是 `dist/apps/web/`**`browser`**`/`(多一層 browser)。

### 回報狀態前重抓,不要引用自己上一則訊息裡的數字
曾在同一封訊息裡同時寫「#237 已在 main」(現查 `origin/main` grep 到的)與
「main = 59eec60」(引用自己前一封的快照)—— 兩個時間點的事實混在一起,而 SHA 看起來
夠具體就不會觸發「這要重查嗎」的念頭。**自己上一則訊息裡的數字是快取,不是事實。**
與「代理指標」那族不同源:那族是查錯東西,這條是查對了但沒重查。
另:部署基準線記描述(「與某次收官部署相比新增的全是 `herdr-team/` 文件」)比記 SHA 穩,
SHA 會過期,描述不會。

### 合併一律帶 `--match-head-commit <你驗過的 SHA>`
```
gh pr merge <n> -R <repo> --squash --match-head-commit "$head"
```
分支在你驗證之後又被推,合併會**直接拒絕**,不會合到你沒看過的東西。
(flag 存在,`gh pr merge --help` 可驗:「Commit SHA that the pull request head must match to allow merge」。)

**為什麼比「查燈號是否對應 head」強**:查證與合併之間有空窗,高速合併日那個空窗塞得下一次
force push。這條把「合併後又推」整類**消滅在合併瞬間**,而不是靠人搶時間差 ——
跟 README 疊 PR 鐵律 1 的「讓還不能合變成 GitHub 擋得住的狀態」同一個思路。
(來源:design-web 稽核 #257 擱淺事故,計畫席 2026-09-04 定為全席程序。)

### `mergeStateStatus` / `mergeable` 的 `UNKNOWN` 有三種,意思完全不同
**GitHub 對已關閉或已合併的 PR 不再計算 mergeable,那欄位永遠回 `UNKNOWN`。**
所以同一個值在不同 `state` 下是不同的東西:

| 情境 | `UNKNOWN` 的意思 | 該怎麼做 |
| --- | --- | --- |
| 剛開 PR / 剛推 commit | 還在算 | **等** —— 實測 30~40 秒,比 CI 還慢 |
| 已 MERGED / CLOSED | **不會再算了** | 看 `state`,別看這欄 |
| API 抖動 | 還在算 | 重問 |

**判 PR 有沒有處理完一律查 `state`(OPEN/MERGED/CLOSED)**;
`mergeStateStatus` / `mergeable` 只在 `state == OPEN` 時有意義。

三種讀錯各有代價,都發生過:當成「還沒算完」→ 白等;當成「乾淨」→ 在 merge 失敗後
照樣刪分支(本席上任第一天,刪掉 #215 的分支);當成「待處理」→ 去推一個早就結案的東西
(ops-warden 2026-09-04 巡檢,兩項都點在已合併的 PR 上,即 README 說的「假待辦變成重工派單」)。

### 驗證字串一律從 diff 或 PR 說明取,不要自己造
本席兩次用「自己想像的字串」驗別人的改動,兩次都得到**假訊號**:
- #249 猜 `workbench/today` —— 不存在 → 假 MISS(看起來像「這支沒進去」)
- #254 猜 tone 是 `success/warn/danger` —— 實際是 `'done'|'pending'|'overdue'|'inactive'` → 假紅燈

**假紅燈比假綠燈更陰:它會訓練人忽略這道檢查。**
正確做法:`git show <squash-commit>` 看實際 diff,或用作者在 PR 說明裡備好的識別字;
挑 ASCII 識別字(函式名 / class 名 / 屬性名),不要挑中文文案(見上方 esbuild 那條)。

### 驗「進了 main」與驗「上了線」要用**不同**的字串
ASCII 只解決「會不會被 esbuild 轉義」,沒解決「會不會被 minify 改名」。
**純內部 util 的 export 名在 production build 裡會被 mangle 掉**,實測:

| 字串 | 原始碼 | 產物 |
| --- | --- | --- |
| `isFailingScore`(util export,只在 TS 內部呼叫) | 6 檔 | **0 檔** |
| `PASSING_RATIO`(同上) | 2 檔 | **0 檔** |
| `dialog__fail` / `editor__fail`(CSS class) | — | ✓ |

| 場景 | 挑什麼 |
| --- | --- |
| **驗有沒有進 main**(`git grep origin/main`) | 任何 ASCII 識別字都行 |
| **驗有沒有上線**(grep `dist/` 或 curl 線上) | **只挑 minify 不能改名的**:CSS class 名、Angular 模板綁定的成員(改名模板就壞)、被序列化的 API 欄位名 |

之前僥倖成功的例子回頭看都有理由活著:`openAttendance` / `markAllRead` 是模板綁定成員、
`hasInvoice` 是 API payload 欄位、`dialog__fail` 是 CSS class。**當時我以為是「ASCII 就行」,
其實是碰巧全挑到不可改名的那類。**

### 等待迴圈:用旗標,不要在 `until`/`while` 的複合命令裡 `exit`
```bash
# 壞：exit 1 會終止整個腳本，不是回到迴圈
until { for n in ...; do [ ... ] && exit 1; done; }; do sleep 25; done
# 好
while true; do p=0; for n in ...; do [ ... ] && p=1; done; [ $p -eq 0 ] && break; sleep 25; done
```
另一個壞掉過的寫法:用 `grep RUNNING` 判斷「跑完沒」—— `statusCheckRollup` 在 check
還沒註冊時是**空陣列**,`join("")` 出空字串,grep 不到就被判成「跑完了」。
**要檢查「有沒有 conclusion」,不是「有沒有進行中字樣」** ——「空值不等於終態」。

### 合併一律用 `tools/steward-merge.sh <PR 編號>`
**連續收多支時,它不是偶爾觸發的保險,是每一支都會用到的東西** —— 2026-09-04 實測:
一輪收七支,腳本攔了六次,其中五次是同一個機制:**前一支合進 main 之後,GitHub 就把
下一支的 mergeable 作廢重算**,而那個空窗剛好落在「我剛剛才看過它是 CLEAN」之後。
靠肉眼記憶會每一支都踩進去。腳本不記得剛才,每次都重問。

這支把整套檢查原子化成一個指令 —— **不是讓你記得跑這些檢查,是讓你不跑就做不到合併**:
state 是 OPEN → CI 有 conclusion 且 SUCCESS → mergeable 已算完且 CLEAN → 鎖 SHA 合併 →
確認 `state == MERGED` → **沒有 PR 疊在這分支上才刪**。任何一步不符就 exit 1。
先用 `--dry-run` 看它會做什麼。下面那幾條是它實作的規則,理由留著給改腳本的人看。

### 刪分支前先查有沒有 PR 以它為 base
**GitHub 會把 base 分支消失的 PR 自動關閉。** 合完下層就反射性刪分支,疊在上面的 PR
連同它的討論與驗收紀錄一起被關掉(2026-09-04 合 #268 後刪 `feat/dual-track-table-gate`,
把 #276 關掉了)。README 疊 PR 鐵律寫的是**「下層合併後上層 base 立刻人工轉 main、
下層分支即刪」—— 順序是先轉 base 再刪**,我做反了。

刪之前查:`gh pr list -R <repo> --state open --base <要刪的分支>`,非空就先轉 base。

**救回的方法**(兩個 API 互相卡死:不能改已關閉 PR 的 base,也不能 reopen 到不存在的 base):
```bash
git push origin "<下層 head SHA>:refs/heads/<被刪的 base 分支>"   # 重建 base
gh pr reopen <n>
gh pr edit <n> --base main
git push origin --delete <被刪的 base 分支>                      # 再刪掉
```
zsh 下 refspec 一定要**用變數包起來加引號** —— 裸寫 `$sha:refs/heads/x` 的 `:r`
會被 zsh 當 modifier 吃掉,錯誤訊息是 `src refspec ...efs/heads/x does not match any`。

### 部署只走一條線;插隊者必須通報當前線上 hash
**約定(2026-09-04,計畫席與本席):部署預設只走 review-steward。** 計畫席若因使用者
即時需求插隊部署(例:使用者當下要看某段文案),**必須立刻通報插隊後的線上 hash**。

背景:2026-09-04 上午出現過一次未通報的插隊 —— 我以為線上是自己上次部的 `2DG7TXD3`,
實際已是別人部的 `OWSR3WZ5`。**沒出事是因為驗證方法本來就不信記憶**:

> **部署驗證一律三方比對:部署前線上 → 部署後線上 → 本機 build**,
> 不要拿「我上次部的 hash」當基準。前者對插隊免疫,後者不是。

三方比對兜住了這次,但**不該靠它兜** —— 通報是第一道,三方比對是第二道。

### 「說的做了一半,而做掉的那半足以讓標題成立」
驗證家族的一種新形狀,**比夾帶更難抓,因為 diff 裡每一行都是對的** ——
問題不在出現的東西,在**沒出現的東西**。

實例(#291,2026-09-04):標題說「收件匣**抽成共用元件**」,元件確實建在
`shared/components/announcement-inbox/`,但只有家長端引用它;老師端 `imports: [DatePipe]`、
仍用自己那份 `templateUrl`,而 #291 的 diff 完全沒碰 `teacher/`。
於是現況是「兩份實作」不是「一份共用」,而標題兩個詞(抽成/共用)各自都成立。

**只有反向驗證看得到** —— 正向 grep「新元件在不在」永遠是綠的。
反向要問的是:**這個說法蘊含了什麼,而那些東西在嗎?**
「抽成共用」蘊含「原本那份不見了」或「原本那端改用它了」,兩者都可以機械檢查。

處置:**不擋**(分兩刀是合理的順序,一次動兩端風險更大),但**必須讓事實留在帳面上** ——
未兌現的那一半有具體代價(兩份實作會漂開),而標題會讓它看起來已經完成。
#291 這次計畫席早已派了後續刀,帳面沒斷;但**若沒派,那半就真的會蒸發**。

### 清償跑得比 gate 快時,選零 baseline —— 並用三件事的合取證明它真的清了
gate 擴大掃描範圍時,若那批債**已經被清掉**,不要把它們收進 baseline:
收進去只會立刻變成**過期豁免**,而且沒有人會發現(豁免不會過期,也不會有人回頭查)。

證明「真的清了、不是被豁免掩蓋」要**三件事同時成立**,缺一件都證不出來:

| 證據 | 少了它會怎樣 |
| --- | --- |
| `baseline` 是 `[]` | 有條目就可能是豁免在擋 |
| gate 的掃描範圍**確實已擴到那個目錄** | 範圍沒到,綠燈只代表沒去看 |
| `npm run harness` 仍然綠 | 前兩者都成立但紅,表示還有沒清的 |

實例(#293 + #296,2026-09-04):A17 擴 `shared/`、baseline 清成 `[]`、harness 全綠 ——
三者同時成立,所以那 9 筆是真清了。**若當初把 8 筆收進 baseline,現在就是 8 筆過期豁免。**

順序上這需要**清償先合、gate 後合**(計畫席改裁過一次:我原本照「gate 改動先行」的常規
要先收 gate,那會讓零 baseline 的 CI 必紅,因為債還沒清)。
**常規在沒人裁決時有價值,但不該在「已經有人在裁」時搶跑。**

### 開背景等待任務前,先查有沒有同樣的任務在跑
2026-09-04 我重複開了兩個等待任務盯同一批 PR,兩個同時醒來收同一支,
第二個拿到 `GraphQL: Merge already in progress`。**沒有損害** —— 腳本 `exit 1`,
沒走到刪分支那步(`state == MERGED` 才刪那道守衛剛好也涵蓋「同一顆 SHA 被收兩次」,
雖然設計時想的是「SHA 被換掉」)。
但那是防線兜住,不是流程對:**開等待前查一次自己有沒有已經在等**。

## 部署備忘(實測)
- Pages project = `clessia`(domains `clessia.pages.dev` / `demo.clessia.cc`),
  production 對應 `--branch=main`(用 `wrangler pages deployment list` 可確認歷史都是它)
- web 產物在 `dist/apps/web/**browser**/`(不是 `dist/apps/web/`)
- 元件級 SCSS 會編進 **JS chunk**,不在 `styles-*.css` —— 驗 dist 內容要 grep `*.js`
- api 部署前先 `npx wrangler deploy --env production --dry-run --outdir <tmp>` 驗 binding
- worktree 是乾淨的,部署前 root 與 `apps/api` 各要 `npm ci`
