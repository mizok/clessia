# labor-reviewer 席 charter(代合與部署)

> **沿用 [`review-steward.md`](review-steward.md) 全文。** 2026-09-13 使用者裁定改名,
> 職責、判斷邊界、坑、部署步驟、截線表全部不動 —— **本檔只記 labor-reviewer 任內新增的判準**。
>
> **接手第一件事:讀 `review-steward.md`,不是讀這一檔。** 這裡是增補,不是摘要 ——
> 只讀這裡會漏掉那一席累積的全部內容(合併守衛、驗證器的八種壞法、部署的三條實跑判準)。

## 為什麼不把 `review-steward.md` 改名

改名會讓 README 與 kb 裡十一處「出處 review-steward」全部變成指向不存在的東西,
而**那些是歷史歸屬,不是位址** —— 它們記的是「這條規則是誰在什麼時候發現的」,
那件事發生在 review-steward 這個名字底下,改掉就等於把發現者改成了另一個人。

改的是**位址**(席位表那一列、「非保留類的綠 PR 交給誰」那兩處),不是**歷史**。

> 一般化:**重新命名一個東西時,先分辨每一處指涉是位址還是歷史。**
> 位址要跟著搬,歷史不能動 —— 兩者在文字上長得一模一樣,而 `sed -i` 分不出來。

## 任內新增的判準

### 數字只跟用同一種量法量出來的數字可比 —— 而量法不在數字旁邊

`review-steward.md` 記著「2026-09-13 那次 `openapi.json` 跟上次逐字相同(**290977 字元**)」。
本席 2026-09-13 部署前實測同一支端點:

| 量法                                        | 值                            |
| ------------------------------------------- | ----------------------------- |
| `wc -c`(bytes)                              | 257134                        |
| `wc -m`(chars)                              | 247768                        |
| `json.dumps(..., ensure_ascii=True)` 的長度 | **290977** ← 上一任量的是這個 |
| `json.dumps(..., indent=2)` 的長度          | 541616                        |

**四個數字都是對的,而它們描述的是同一份檔案。** 上一任沒寫量法,
所以下一任(我)拿 `wc -c` 一量就差了 33843,**第一反應是「有人動過 api」** ——
而那個結論會讓人去追一件沒發生的事。

這是 charter 驗證器八種壞法裡「**兩側正規化不一致**」的同一族,
但它更難察覺:那八種是**我自己的檢查前後不一致**,這條是**我跟前一任不一致**,
而前一任已經不在了,**沒有任何人可以問**。

**規則:紀錄一個數字時,把產生它的那一行指令寫在旁邊。**
數字會被下一個人拿去比,而他手上的量尺跟你的不一樣。

> 本席這次的量法是 `curl -s <workers.dev>/openapi.json | wc -c`(bytes)。

### 部署的探針要配一個「一定會 MISS」的負控

charter 有「探針裡放一個早就存在的字串當對照」—— 那是**正控**(它回 0 就是探針壞了)。
這次補上另一半:**線上抓 lazy chunk 時,同時抓一個不存在的 chunk 名**。

```bash
curl -s -o /dev/null -w 'type=%{content_type}\n' "https://demo.clessia.cc/chunk-ZZZZZZZZ.js"
# 期望 text/html —— 那證明「拿到 application/javascript」這件事有鑑別力
```

理由是 `demo.clessia.cc` 的任何路徑都回 200(charter 拓撲那節),
**所以「200 + 有內容」對「這個檔存不存在」完全沒有鑑別力** ——
真正在做判斷的是 content-type,而那道判準本身要被驗一次。
正控證明探針抓得到東西,負控證明它**抓不到不該有的東西**;
charter 的「gate 寫完塞陷阱看它會不會紅」在部署驗證上的同一件事。

> **#1283（2026-10-04）之後：正式環境由 `.github/workflows/deploy.yml` 自動部署**（接在 migrate 成功之後，
> api 先 web 後，⓪ 由結構保證、⑥⑦ 由 verify-live 自動跑）。**本席的部署工作改成讀 deploy run 的
> step summary 做部署紀錄 PR**（截線＝那顆 run 的標題 SHA、api version、web 的 main-*.js、verify-live 結果）。
> verify-live 紅了**只紅燈不自動回退**，回不回退照「出事就回退」由人判斷。
> 下面 ⓪–⑦ 的手動流程**保留為緊急本機路徑**（CI 掛掉時才用），見 kb/wiki/architecture/deploying.md。

### 部署會撞上 schema,而 git 看不到正式 DB

2026-09-13 計畫席裁定,補上 charter 部署步驟一直缺的那一步(步驟本身寫在
[`review-steward.md`](review-steward.md) 的 ⓪,**因為做部署的人讀的是那個編號清單,
不是這一檔**)。

**觸發它的是 #832**:它同時帶了 api 接線與一支 migration
(`20260913101500`,把 `subject` / `organization` 加進 `audit_logs.resource_type` 的 CHECK)。
若 api 先上線而正式 DB 沒套,`logAudit` 的 insert 會被 CHECK 擋 —— 而它是 fire-and-forget
(`apps/api/src/utils/audit.ts`:`waitUntil` 包住、`catch` 只 `console.warn`),
於是**線上靜默 0 筆**,跟 #828 原本的症狀一模一樣。

**一般形狀**:**凡是「寫入失敗被吞掉」的路徑,schema 落後就等於靜默資料遺失。**
不會有 5xx、不會有紅燈、smoke 照樣綠 —— **它跟功能正常運作長得一模一樣。**

#### 那道檢查是個代理指標,它漏掉的是「正式 DB 現在在哪」

`git log <上次截線>..<這次截線> -- supabase/migrations` 回答的是
**「這個窗口內有沒有新 migration」**,不是**「正式 DB 套到哪一支」**。兩者平常重合
(每一支都被套了),不重合的那次沒有訊號 —— 這是 charter「一份資料只在它自己的維度上正確」
的同一族:

| 我查的 | 它回答的 | 我要知道的 |
| --- | --- | --- |
| `git log <窗口> -- supabase/migrations` | 這段 commit 範圍有沒有動 schema | 正式 DB 現在的 schema 是哪一版 |

**具體的漏法**:上一輪有一支 migration 沒被套,而這一輪的窗口裡沒有新 migration ——
檢查回空、綠燈放行,**而缺的那支還是缺的**。窗口的右邊界是查得到的,**左邊界是假設出來的**。

**所以截線表加了「正式 DB 套到」一欄。** 它補的正是那個左邊界。
而它**只能由使用者填** —— repo 裡查不到(`package.json` 的 `db:*` 全指向本機 supabase),
所以那一欄不是量測值,是**宣告值**;寫下它的人是唯一知道的人。

> **這條沒有做完。** 現在的狀態是「有一道會叫停的檢查 + 一欄要人填的紀錄」,
> 而**要人填的東西在輪替面前一定會輸**(README 通則)。真正的機械解是讓正式 DB
> 自己說它套到哪(一支唯讀查詢 `supabase_migrations.schema_migrations`),
> 那需要 #495 那條「能連真 DB 的驗證環境」—— **在那之前這一欄會空著,
> 而空著比填一個猜的值誠實。**

### 代合的授權來自訊息時,代記要寫明它證明的是什麼

`steward-merge.sh` 每支都印「驗收留言 = 無 —— 確認你手上有訊息裡的驗收紀錄再合(不擋)」。
**那行提示存在就是為了逼出一個動作**:合併前在 PR 上留一則代記,寫明
**授權來自 herdr 訊息而不是 PR 留言**,以及「**這則證明的是本席收到過一則授權訊息**」
—— 不是「計畫席已驗收」。

2026-09-13 一天二十支都這樣做。成本是每支一則留言,換到的是:
**訊息會隨 session 蒸發,而留言住在它描述的那支 PR 上。**

### 批次代合時,每一支的歸屬要自己查,不要採信轉述

「不在授權清單就不動」是**以歸屬為判準**的規則 —— 歸屬錯就會擋錯或放錯。
2026-09-13 本席寫過「#870 你的」與「#870 我讀了」,**而那支是監工的、本席從來沒打開過它**,
讀的是計畫席訊息裡的轉述。兩支剛好都該收,所以沒有後果 ——**而「沒有後果」是運氣不是設計。**

每支兩秒,做這兩件:

```bash
gh pr view <n> -R <repo> --json headRefName,headRefOid   # 誰的
gh pr diff <n> -R <repo> --name-only                     # 動了什麼
```

### 綠燈屬於哪一顆 commit —— 腳本安全,快照事件不安全

**`gh pr checks` 綁的就是 head**(實測 `gh pr checks 880` 與
`gh api .../commits/<head>/check-runs` 逐項一致)—— **那條「人工看 `gh pr checks` 不安全」
是錯的,本席曾經寫過並推廣過它,見 README 第十二組條 1 的反例。**

真正會落後的是**快照式的來源**:monitor 事件是輪詢的時間點快照,
它報 `<舊 sha> success` 的那一刻 head 確實是那顆。**事件沒有錯,錯的是拿一則帶著
過期 sha 的事件去問「現在能不能合」。**

對這一席的意義:`steward-merge.sh` 鎖的是**你帶進去的審過 SHA**(第二個參數,必填),所以安全;**而別席與使用者親合時
手上多半是一則通知,不是現查** —— 收到「某某綠了可以收」時,自己再查一次 head。

### 驗收指令自己也會踩兩點 diff

2026-09-13 的硬性驗收條件是 `git diff origin/main -- <檔> | grep '^-'`,**兩點的**。
它當天沒出事,純粹因為別人合進 main 的那幾支沒有動到同一個檔;
換一支動到同檔的,整個 repo 會顯示成「78 deletions」,而那些是 main 領先你的 commit。

**一律 `git diff origin/main...HEAD`(三點)。** README 早有這條,
**而定這個驗收條件的人與照做的人當天都沒想起來** ——
**規則寫在文件裡不等於它會在你設計檢查的那一刻被讀到。**

### #915:那個「左邊界」不是推論,它已經發生了

本檔上面那節寫過:⓪ 的窗口式檢查**只回答「這個窗口內有沒有新 migration」**,
而左邊界是假設出來的;當時的結語是「這條沒有做完」。

**2026-09-30 它兌現了。** 正式 DB 沒有 `sessions.makeup_for_session_id` ——
`20260906083827` 從來沒套上,而它**不在任何一輪 ⓪ 的窗口裡**,所以每一輪都是綠的。

**本席在這件事上的錯,要寫準一點:**

1. 截線表那一欄記的是**使用者說他套了哪一支**,而本席讓它被讀成**正式 DB 的 schema 到哪一版**。
   兩者之間隔著「中間沒有漏」這個假設,**而本席從來沒有查過那個假設**。
2. 本席在 #913 的第二次檢查裡列了一張表,那一列的**查法欄寫的是「截線表」**(誠實),
   **但本席在結語寫成「四項全部實測對得上」** —— 那句把一個**引用自己紀錄**的項目
   混進了三個真的量過的項目裡。**單看那張表沒有錯,單看那句話是錯的,而讀的人會讀那句話。**

> 這是本檔「結論附上取得方式」那條的反向失敗:**表裡附了,而摘要把它洗掉了。**
> **摘要要繼承被摘要者的證據力,不能只繼承它的結論。**

判準已改成差集(見 [`review-steward.md`](review-steward.md) 的「這一欄的語意訂正」),
產生查詢的指令也在那裡。**本席不碰正式 DB,那支查詢由使用者跑。**

### 合併後要查「這支解掉的 issue 關了沒」(計畫席 2026-10-01 訂)

**`Closes #N` 沒寫在 PR 描述裡,GitHub 就不會自動關** —— 而 PR 標題裡寫「(#919)」
長得跟 `Closes #919` 一樣像「這支處理掉它了」。2026-10-01 一天內三張
(#919 / #930 / #940)**修好了還開著**,其中兩張掛在**已退場的席位**上 ——
**沒有人會回頭看一張指派給不存在的席的 issue。**

做法:合併後把 PR 標題／描述裡出現的 issue 編號逐一

```bash
gh issue view <N> -R <repo> --json state,title
```

- **全修完了** → 關它,並留言指向 squash commit
- **只修一部分** → **留言寫清楚剩什麼**,不要關

#### 「全修完」比看起來難判 —— 多切片的 issue 會騙你

2026-10-01 的 #924(impeccable audit)三個切片 P1 / P2 / P3 **全部合進 main**,
照「引用它的 PR 都合了」會判定可以關。**但它的量測表裡還有兩列是「未量」。**

> **⚠️ 本席對那兩列的第一個診斷是錯的,計畫席當天訂正**:本席寫成
> 「那兩列當初標的原因(`#915`)已經解了,所以現在量得到、只是沒人去量」——
> **不對。** `#915` 是**根因**解了(差集 0),**而那兩列要的是行為驗證**,
> 得用**帶身分的瀏覽器**重量 `/admin/sessions`,而 Chrome 擴充仍斷線。
>
> **所以它們的解鎖條件是「瀏覽器回來」,不是「#915 解了」** ——
> 本席把「擋住它的根因消失了」讀成「擋住它的東西消失了」,**而那是兩件事**:
> 根因是它為什麼量不出正確結果,瀏覽器是它**能不能被量**。
>
> 這是本檔「同一個值有幾條路」的鄰居:**「現在可以做了」有兩個前提,我只查了一個。**

> **「找出來的缺陷都修了」與「這份審查做完了」是兩件事。**
> 前者是切片,後者包含**還沒看過的部分**。只關前者會讓那些空格變成沒有人記得的東西 ——
> 而它跟「全部切片都合了」在 PR 列表上長得一模一樣。

判準:**關之前把 issue 本文讀一遍,不要只看引用它的 PR 合了沒。**
本文裡的表格、核取清單、「未量 / 待確認」那些欄位,**都是切片清單之外的範圍**。

---

# 蒸餾第二輪(2026-10-01,計畫席裁定:蒸餾先於輪替)

## 散在別處的判準 —— **這裡只指向,不搬過來**

**兩份會漂**(README 第十組)。下面每一條寫「它在哪」「為什麼這一席需要它」,
**內容以那邊為準**;那邊改了這裡不用動。

### 在 [`review-steward.md`](review-steward.md)

| 判準 | 這一席為什麼需要它 |
| --- | --- |
| **⓪ 部署前先查沒套的 migration**(含 **schema／backfill 分類**:看內容不看檔名,schema 套完才部署、backfill 部署完才套、分不出來當 schema) | **每次部署的第一步**,而且它會叫停。2026-09-30 它第一次真的擋住東西 |
| **截線選法**(最近一顆 `completed/success`,不是 HEAD)**＋那條例外** | 例外是:**當這一批的目的就是某一顆 commit 時要等它的 CI**。10-01 用了三次(#945 / #967 都是) |
| **部署的完整順序①–⑦**、**lazy chunk 用檔名抓看 content-type**、**出事就回退** | 照著跑的清單 |
| 截線表的**「正式 DB 套到」欄** | 它記的是**宣告**不是量測;#915 之後判準是**差集**不是 `max` |

### 在 [`kb/wiki/architecture/deploying.md`](../kb/wiki/architecture/deploying.md)

| 判準 | 這一席為什麼需要它 |
| --- | --- |
| **`wallTime` 對「合計／最慢」** —— 量查詢並行化 | **不要用 TTFB**:同一設定的 TTFB 離散度(0.13)比單支 PR 的改善還大 |
| **入口 `colo` 自己會變**(SJC → TPE → NRT,沒人改設定) | 任何 TTFB 比較都可能在比兩個不同的入口 |
| **線上探針自己會被快取** | 部署完**立刻**抓的那一份不算;「探針沒動」的第三條路 |
| **`/api/*` 未登入一律 401,不證明路由存在** | `authMiddleware` 在所有 `mount()` 之前。要證明路由存在看 `openapi.json` 的 `paths` |
| **陰性對照**、**tail 輸出不是 NDJSON** | 量測的兩個實作坑 |

---

## 本席自己的三件

### 一、保留類判定:三次都靠「自己去查」才判得出來,而三次的結論不同

快照寫著保留類是 **migration／金額計算路徑／授權權限邏輯,而分校範圍算授權**。
計畫席判「非保留類」時本席**沒有照抄過**,三次各自查到不同的東西:

| 支 | 計畫席說 | 本席查到什麼 | 結論 |
| --- | --- | --- | --- |
| **#957** | 非保留類(附三處行號) | 增減不是純搬移,所以兩側開檔對照 —— `main` 那三支查詢**本來就都套了範圍**;**停課計數是這支新增的**,一出生就走 helper | 非保留類 ✓,**但計畫席的描述要修正**(它寫得像兩支都已存在) |
| **#967** | 非保留類(加法) | 五支查詢全帶 `org_id`,在籍那支另套 `applyCampusFilter`;**範圍是傳遞的**(`classIds` → `.in('class_id', …)`);另追組裝端,輸出**以 sessions 為骨幹** | 非保留類 ✓,**但標出失效方向** |
| **#971** | 非保留類(收緊) | 兩支查詢各**多**一個過濾條件,沒有任何條件被移除 | 非保留類 ✓ |

> **判準**:`+N −M` 的增減數字只說「有沒有動」,不說**動的方向**。
> **要判保留類得看「誰看得到什麼」有沒有變** —— 而那要兩側開檔,不是讀 diff 的統計。

**#967 那次標的失效方向值得單獨記**,因為它後來變成 #971:

> 本席判「目前沒有外洩路徑」是對的,**但那個「沒有」是組裝端的形狀給的,不是查詢條件給的**。
> **兩者的差別只在未來**:查詢條件寫在那一行,誰改那一行都看得到;
> 組裝端的形狀是**隱含的約束** —— 下一個人把 records 加進回應時,
> **他的 diff 不會碰到任何範圍相關的字,而 code review 也不會。**

**所以判非保留類時,順手問一句「這個『安全』是靠什麼成立的」** ——
靠查詢條件是穩的,靠別處的形狀是會被改掉的。**把它寫進留言,下一個人才有東西可以接。**

### 二、「授權之後、合併之前」的訂正來得及,是時機不是守衛

2026-10-01 計畫席在授權後又訂正了三次(#938 / #952 / #959),**三次都來得及**,
而本席一度把功勞歸給 `--match-head-commit`。**那是錯的**:

| 機制 | 擋得住什麼 |
| --- | --- |
| `--match-head-commit` | **別人推了 commit** 而我沒看過 |
| 「我還在等 CI」 | **對方改了主意**而我還沒動手 |

**那三次的訂正都是以訊息到的,head 完全沒變 —— 鎖 head 不會擋下它們,也不需要擋。**
真正讓它們來得及的是**本席還沒下 merge**,而原因是在等 CI。

**所以它是時機不是守衛**:當一支 PR 的 CI 在授權時就已經綠了(10-01 的 #956、#958),
**那個窗口是零**。

> 計畫席的處置是**在它那端補**:「授權＝我讀完的那一刻,不在授權後再補看」。
> **本席這端不留窗口** —— 能做的只有「等久一點」,而那不該寫成規則
> (一條沒有人能執行的等待)。

### 三、代記:每一支都寫,而且寫明它證明的是什麼

`steward-merge.sh` 每支都印「驗收留言 = 無(不擋)」。**那行提示存在就是為了逼出一個動作。**

一天三十幾支都照做,格式固定:**授權來自 herdr 訊息不是 PR 留言** ＋
「**這則證明的是本席收到過一則授權訊息**」(不是「計畫席已驗收」)。

**成本是每支一則留言,換到的是:訊息會隨 session 蒸發,而留言住在它描述的那支 PR 上。**

而代記不只記授權 —— **本席把每一次「自己查到什麼」也寫進去**:保留類判定的依據、
陷阱測試的三步、探針為什麼換、衝突怎麼解的雙向對帳。
**下一個人翻那支 PR 就看得到,不必問任何人。**

---

## 給下一任的一句

這一席今天被推翻過三次 —— **兩次在合併前,一次在合併之後**:

| 被推翻的 | 什麼時候 |
| --- | --- |
| 401 不能區分 #915 修前修後 | #938 **合併前**(訂正推成第二顆 commit 才合) |
| #924 的解鎖條件是瀏覽器不是 #915 | #959 **合併前**(同上) |
| **placement 讓 1 次 DB 的端點快 0.08** | **#947 合進 main 之後**(02:03 合、02:44 被 #952 推翻) |

**第三列才是最該記的那一個。** 那個結論有表格、有兩輪數字、有「可歸因」的標註,
**讀起來完全成立** —— 而它一路進了 main。推翻它的不是誰起了疑心,
是**同一天第二次部署順手又量了四輪**。

> **「讀起來完全成立」的結論可以一路進 main** ——
> 而擋住它的不是審查,是**後來又量了一次**。

**三次的共同形狀是:一個站得住腳的推導 + 一個沒去查的前提。**
charter 裡那麼多條「先查」,全部是這個形狀的不同衣服。

---

## 接手後補記(2026-10-01,計畫席轉述前一任只存在訊息裡的兩件)

- **tail 時間窗**:規則寫在 [`deploying.md`](../kb/wiki/architecture/deploying.md) 的「用時間窗量一趟真人操作」
  (開 tail 前問計畫席有沒有別席在打 demo、捕獲檔原檔留著、判準本身未驗)。
- **`steward-merge.sh` 收的 PR 會刪分支,別人用 `gh pr merge` 合的不會**(10-14 起腳本預設不刪,這條只對帶 `--delete-branch` 的成立)——
  退場時 `git ls-remote --heads origin` 對一次,是唯一會發現殘留分支的時刻。

- **build 失敗時 `dist` 還在,而且是上一次的**(2026-10-03 第四次部署):merge 了一支改 `package.json`／lock 的 PR(#1055 加 tailwind／postcss)之後,
  worktree 沒重跑 `npm ci`,`nx build web` 報 `MODULE_NOT_FOUND` 失敗 —— **但 `dist/apps/web/browser/` 還留著上一次(22:41)的產物**,
  `ls` 出來的 `main-*.js` 與線上相同,於是我回報「web 不用發」。**那是舊檔,不是這次的產物。**
  抓到的契機不是 hash,而是「原始碼明明有改、兩百個檔內容卻逐一與線上相同」這個矛盾。
  做法:**build 完先看退出狀態與 `dist` 的 mtime(要是剛剛),`package.json`／lock 動過就先 `npm ci`**;
  這是 `review-steward.md`「部署前確認 dist 是這次 build 出來的」的另一個成因(那條講的是兩個 dist 目錄,這條是同一個目錄裡的舊檔)。

- **回報「已合」要以讀回為準,不要跟 merge 指令串在同一條**(2026-10-03 #1136):
  `steward-merge.sh` 回「CI 還沒報／mergeable 還在算」就停了(`exit 非 0`),但我把回報 `printf … | herdr agent prompt`
  寫在同一個 Bash 呼叫裡、**無條件**送出,於是計畫席收到一則「已合」而 PR 實際還是 OPEN。
  做法:**合併指令一個呼叫,回報另一個呼叫**,回報內容取自 `gh pr view <n> --json state,mergeCommit` 讀回的值——
  `state==MERGED` 才寫「已合」、並附 merge sha;否則寫實際狀態。
  同族:README 六「檢查與動作分開」(動作的成敗要由讀回決定,不由『我下了指令』決定)。

- **凍結邊界要自己判斷,不要等人喊**(2026-10-03 #1219／#1220):
  #1219(帶 migration 的保留類)12:51:32Z 被使用者合,**30 秒後**我合了 #1220——而那條合併指令的第一行輸出就是
  `#1219 MERGED`。我印出了它、沒有把它當成條件。計畫席的規則是「使用者合了我會喊凍結」,**但喊的人也在忙,
  訊息會晚到;而 migrate.yml 的 apply 等待會被之後 main 上的新 run 取代**(每顆 main 的 verify 一完成就開新 run)。
  做法:**每次 merge 的同一個呼叫裡**再讀一次所有「保留類 migration PR」的 state(`gh pr view <n> --json state`),
  `MERGED` 就視同凍結已開 —— 停手、盯那顆 migrate、回報計畫席,不要等訊息。
  同族:本檔「回報已合要以讀回為準」(判斷要依賴剛讀回的事實,不依賴前一個呼叫或別人的通知)。

---

# 蒸餾第三輪(2026-10-04,接手席先讀這一節)

這兩天(10-03～04)代合了上百支 PR、做了十次部署。**下面每一條都是踩過才寫的**;狀態類的東西(哪支 PR 在哪)不寫在這裡。

## 合併授權 v3 下,保留類 PR 的「獨立第二次檢查」清單

保留類(migration／金額路徑／授權範圍／公開端點／CI 碰正式 DB)由**計畫席合**,本席只做第二次檢查、**只報不合**。每支固定回這幾項(缺一項就是沒查完):

1. **head 與授權一致**、`mergeable` 是什麼(`UNKNOWN` 要再查,不要當成沒衝突)。
2. **org_id**:這支新增／改動的每一條 DB 查詢與寫入有沒有 `.eq('org_id')`;只按 `staff_id`／`session_id` 的子查詢,要確認它的 id 先在同一呼叫驗過屬於本 org。
3. **範圍**:分校範圍(`getCampusScope`、整批拒絕還是跳過)、老師範圍(`teacher-scope`,**空陣列≠不縮限**)、家長範圍(`isChildAllowed` 越權回 403 不回空、`childDb` 之外還要 `.eq('student_id')` 防兄弟姊妹混入)。
4. **誰看得到什麼有沒有變多**:新增欄位／新端點對哪些角色可見;白名單擴大要讀它回傳的欄位。公開端點:必須 fail-closed(沒設 org 就 404)、不回老師名／學生資料、費用與名額是否有意公開(**要明講,讓人裁**)、有沒有速率限制。
5. **金額路徑**:加總是不是 JS 浮點(單價兩位小數會有尾數)、不收費的是不是 0。
6. **migration**:有沒有、時間戳是否比 main 新(A16b 會擋)、是否只新增、是否在上次截線之後(⓪)。
7. **`+` 側禁用項**(vh／vw／`*ngIf`／`@Input`／`innerHTML`)與「被刪的行在 `+` 側有沒有重現」。
8. **外部假設要標出來**:例如「CLI 把一支檔放同一個 transaction」這種我沒讀原始碼驗證的前提,**寫「未驗」,不要寫成結論**。

CI／部署類(`.github/workflows`)另看:觸發條件(`workflow_run` 的 conclusion／head_branch／head_repository)、secrets 只在哪些 step 用、`environment:` 的保護規則會不會讓自動變手動、concurrency 的 **pending 會被取消**(`cancel-in-progress:false` 只保護「正在跑」的)。

## 凍結邊界(補充 #1223)

- 保留類 migration PR 一被合,本席**自己**進凍結:不合任何東西(含 docs)、盯那顆 `migrate.yml` 的 apply。**run 標題的 sha 會誤導**(守衛可能取消較新的 run、TARGET_SHA 才是真的),看 job 狀態與計畫席讀回的 TARGET_SHA。
- 每次 merge 的**同一個呼叫**先讀一次所有保留類 migration PR 的 state,`MERGED` 就停。

## 寫部署紀錄 PR 的指令:退出碼要擋住後面的提交

(#1192 的教訓)寫檔(python/sed)失敗後,後面的 commit／push／`gh pr create` 照跑,PR 就帶著錯的內容。做法:`set -e` 或全部用 `&&` 串;python 用 `assert 舊字串 in s` 再寫;**macOS 的 `sed -i` 要帶 `''`**,不然靜默失敗(我曾因此送出「見下一行讀回」);`git push` 偶爾網路瞬斷,重推前先確認 `git status` 乾淨。

## Pages 部署後驗證:先抓到舊的 ≠ 沒部署

`demo.clessia.cc` 前面有 CDN／Pages 傳播延遲:部署完立刻抓 `index.html` 可能還是舊 `main-*.js`,或某個新 chunk 短暫回 `text/html`(SPA fallback)。判法:**換 cache-buster(`?cb=$RANDOM`)重抓、再抓 `<hash>.pages.dev` 預覽網址**;兩者都對才算部署對、只有線上舊才是真有問題。「本機 js 檔線上缺 N 個」要等歸零,不是第一次就判。負控(`chunk-ZZZZZZZZ.js` 回 `text/html`)與正控(`all_parents` 出現次數)每次都跑。

## 查 `Closes` 有沒有生效

合併後 `gh issue view <n> --json state` 讀回;`Closes #N` 要寫在 **PR 描述**裡才會自動關(我查到的情形都是這樣關掉的)。**只有 `Refs` 的不會關**(代記要寫「Refs,無 Closes」)。`steward-merge.sh` 自己不查 issue,要自己查。同一支 PR 合進 main 之前被別人合掉時(我曾遇 #1206),**讀回 state/mergedAt/commits 確認合進去的就是授權的 head**,再回報「不是我合的」。

## 其他散落的小判準

- ~~`steward-merge.sh` 合併後會**自動刪分支**~~ **2026-10-14 起預設保留分支**(計畫席定:作者可能還要補、方便回查);要刪帶 `--delete-branch`,疊在上面的 PR 仍會擋住並印 `gh pr edit --base main` 指令。
- 同一 head 多筆 `verify`(重複 push 的 1 秒 CANCELLED):腳本已改取最新一筆(#1053);不要手動 `gh pr merge` 繞過(分類器會擋)。
- build 完看 `dist` 的 **mtime 與退出碼**;`package.json`／lock 動過先 `npm ci`(#1055／#1172 都踩過)。
- 回報一律從 `gh pr view <n> --json state,mergeCommit` 讀回,**不跟 merge 指令串在同一條**(#1220 的教訓)。


---

# 10-07 補:Tailwind 換版 PR 的二讀(labor-reviewer-20261004-0638,#991 Z 批)

## 「這個 class 有沒有真的產生 CSS」要編譯看,不要用讀的

換版 PR 把 SCSS 換成 utility,`去 class 去空白後逐字相同` 只證明**模板結構與綁定沒動**,證明不了 **class 有沒有生效**(任意值的跳脫、`inline-flex!`、`[&.x\_\_y]` 變體、`group-open:`、`min-[640.02px]:`…都可能編得出來也可能靜默落空)。實測可用的做法(在 PR head 的 worktree 裡,node_modules 已裝):

```js
// tw-check.mjs(跑完刪掉;不要提交)
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { readFileSync } from 'node:fs';
const base = process.cwd() + '/apps/web/src';
const c = await compile(readFileSync(base + '/tailwind.css', 'utf8'), { base, onDependency() {} });
const out = c.build(new Scanner({ sources: c.sources }).scan());
console.log(out.includes('要查的 class 或選擇器'));
```

用法:對**被 PR 刪掉的 SCSS 規則**與**PR 新寫的任意值／變體**各查一次輸出(例:#1361 查到 `.[&.popup-menu\_\_item--disabled]:opacity-50.popup-menu__item--disabled{…}` 確實產生、#1362 查到 `page-actions__cta` 在輸出裡**不存在**)。**限度**:這證明「有沒有規則」,不證明「規則的外觀對不對」;也不替代渲染。

## 規則「掉了」不等於「回歸」—— 先問舊規則有沒有命中過

#1362 我報了「`.page-actions__cta{width:100%}` 隨 scss 刪掉、手機停靠鈕會從滿版變小鈕」。**我只驗了新樹裡沒有這條規則,沒驗舊樹裡它有沒有命中**。事實是:那條規則在 encapsulated SCSS 裡,而 `styleClass` 落在 PrimeNG 內部 button(子元件 view,沒有 `_ngcontent`),**從來沒命中過**,舊畫面本來就是小鈕(#1363)。所以那不是回歸,是「換版把一條從未生效的意圖暴露出來」;處置是補 `w-full justify-center` 讓意圖第一次生效,而不是退回。

> **判準**:報「規則掉了」之前先看舊畫面(或舊規則的選擇器能不能命中那個元素:投影內容、PrimeNG 內部元素、跨 view 的 encapsulated 選擇器都是常見的『從未命中』)。**「新樹沒有」和「舊樹有效」是兩個要各自查的事實。**
> (同族:`todo-banner` 的 `strong` 規則、`leave-form-dialog` 的 `&__x` 巢狀,都是『寫了但從沒生效』。)

## `git grep` 的 alternation 我又踩了一次

`git grep -n 'a\|b'`(BRE)在這台機器上不會當 alternation,**回空**——而空長得跟「不存在」一模一樣(#1323:我第一次查 `.enrollments__summary\|skeleton-` 得空,差點據此判掛勾不在)。**一律 `git grep -E 'a|b'`**;查『不存在』的結論前,先拿一個一定存在的字串當正控。

---

# 10-08 補:更正一條、並把 10-07 的二讀流程收成一頁(labor-reviewer-20261004-0638)

## 更正:「編譯輸出裡看不到 `@media (hover: hover)`」不等於「沒有包」

#1376 我寫過『本專案 hover 沒有包 `@media (hover:hover)`』——**錯的**。Tailwind v4 的 `hover:` 預設就包 `@media (hover: hover)`;本專案編譯輸出有 9 個這樣的區塊,`.hover\:bg-warning-200:hover` 就在其中一個裡。我錯在**判斷方法**:我只截取該規則前面 80～500 字元看,而 Tailwind 把一整串 hover 規則收進**同一個** `@media (hover: hover) { … }`,開頭那一行離規則一千多字元遠,截取視窗裡沒有它,我就把『沒看到』寫成『沒有』。

> **判準**:「這條規則有沒有被某個 at-rule 包住」是**結構問題**,不能用固定長度的上下文視窗判。要做括號深度檢查:往前找最近的 `@media (…)`,數它到該規則之間 `{`/`}` 的淨深度,**≥1 才是被它包住**。

```js
const j = out.lastIndexOf('@media (hover: hover)', i);   // i = 該規則的位置
let depth = 0;
for (const ch of out.slice(j, i)) { if (ch === '{') depth++; else if (ch === '}') depth--; }
// depth >= 1 → 被包住
```

(同族:charter 前面『`git grep` 的 BRE 回空』——**「沒看到」不是證據,要先有一個正控**。這裡的正控是先對一條『一定有包』的規則跑同一個檢查。)

## 10-07 的 Tailwind 換版二讀,一頁版

1. **先看範圍**:`git diff --name-status origin/main...<pr>`;`.ts` 只能刪 `styleUrl`(或加 `host:{class}`);不該出現 `.pw-regression`、不該動消費者模板。
2. **模板去 class 比對**:去掉 `class`/`[class.x]`/`[ngClass]`/`styleClass` 後去空白應逐字相同;再比『綁定 token＋`@if/@for` 巢狀路徑』的多重集合(removed/added 皆空)。新增的 `[class.*]` 條件要逐條對回原 SCSS 的修飾 class,**表達式一字不改**。
3. **逐項對原 SCSS 的值**(字級、間距、顏色 token、斷點);斷點 `min-[Npx+0.02]`/`@container` 對 `_breakpoints` 的定義。
4. **實編譯**驗關鍵 class 有產生(上一節 `tw-check`):任意值、`!`、`[&.x\_\_y]`、`group-open:`、`empty:hidden`、hover 的 `@media`(用括號深度)。
5. **「規則掉了」先問舊規則有沒有命中**:投影內容、PrimeNG 內部元素(`styleClass`)、跨 view 的 encapsulated 選擇器——舊規則常常從來沒命中。
6. **未分層 vs `@layer`**:`ViewEncapsulation.None` 的元件 SCSS 是**未分層**,贏過 `@layer utilities`;同一個元素上要蓋它得用 `!`(#1365 的 audit-log time)。
7. **A28 對比豁免兩個陷阱**:暫刪一筆應紅在真違規(訊息有『對比 X』);加一筆指向不存在違規的假鍵應紅『豁免過期』。**兩個都紅才算 gate 活著**;誤報型要確認兩個 class 真的是相反條件。
8. **harness 測試動到 fixture 尋找**:暫把 `check-harness.mjs` 的兩條 gate 訊息改掉,應恰好 A20 與 A27/A24 兩條 not ok。
9. **`steward-merge.sh <PR> <審過的 SHA>`,SHA 必填**:帶二讀時實際驗過的那一顆(不是授權訊息裡的、也不是現查的 head)。
   head 對不上腳本就停,`--match-head-commit` 也帶它。**2026-10-16 #1656 的教訓**:我審過 `3bf54a6a`,作者在等 CI 時推了
   `e08607dc`,舊版腳本鎖的是「執行當下讀到的 head」,把沒審過的那顆合進去了(事後補審沒問題,但流程是先合後審)。
   作者常在等 CI 時追加 commit,**「等 CI → 合併」寫成一串時尤其會發生**;腳本停下來就重審那幾顆,再帶新 SHA 跑一次。
10. **暫存檔不要用 `rm -rf`**:分類器會擋(10-08 #1380 我的暫存清理被擋);用 `mktemp -d`,或只 `rm -f` 自己建的單一檔。

---

## 10-10～10-14 大量代合（約 90 支非保留／保留類）學到的，一頁版

**這一節只放知識。** 「二讀＝實跑＋自己跑突變」的流程本身見上面各節；這裡是那幾天踩到的坑與判準。

### 一、突變要能編譯、要真的套上、門檻要 ±1

1. **突變要能編譯。** 改了 `switchMap`→`mergeMap` 卻沒換 import，編譯錯誤讓 spec 一支都沒跑，
   `grep -E "Tests |×"` 什麼都不印——**「沒輸出」不是「全綠」也不是「紅」**。印不出 `Tests` 那行就當這次突變無效，重做。
2. **確認突變真的套上。** 我用一個小 Python 函式 `replace(file, old, new)` 並 `assert old in s`；macOS 的
   `sed -i` 要寫 `sed -i ''`，否則靜默不套。第一次命中的不一定是你要的那一處（`chapter.groups` 第一個出現在
   `track` 表達式，不是迴圈）——把 old 寫長到唯一。每次突變前後 `git status --short` 要乾淨。
3. **grep 摘要行會被雜訊蓋掉。** vitest 的 stderr（`loadCourses failed: boom`、`[batch-import]`）排在摘要前面，
   `| head -4` 會把 `Tests` 那行截掉。先 `grep -v "loadCourses\|batch-import"`。
4. **門檻永遠測 ±1。** 抓到缺口的全是邊界：`<`→`<=`（`end_date = today`、`effective_to`）、`3→4`（`absentDates` 恰 3／4 天）、
   `classSize = 1`、`emailVerified = null`（`=== true` 與 `as boolean` 在 true／false 兩值下不可分）。
   fixture 只放 true／false、只放兩場、只放「遠離邊界」的值，突變就看不出來。
5. **「雙向回寫」要各突變一次。** Popover 的 `(onShow)`／`(onHide)` 回寫 `filtersOpen`：拿掉其中一個全套 spec 仍綠過
   （#1546）。外點擊關閉在 jsdom 看不到，**只能實機或寫會觸發 `onHide` 的 spec**。
6. **「條件改恆 true／恆 false」是檢驗『這個 prop 到底有沒有被測』最便宜的方法**
   （`primaryOnDesktop`、`secondaryOnDesktop`、`subLarge`）。沒有任何 spec 斷言的 opt-in prop，改成恆值會全綠。
7. **對等價突變保持警覺**：`!== false` 與 `=== true` 在 boolean 輸入下等價，紅不紅取決於 fixture 有沒有 null。

### 二、時區與時鐘

- **本機 `TZ` 是 Asia/Taipei，CI 是 UTC。** 模板的 `'+0800'` 拿掉，本機 spec 全綠、`TZ=UTC` 才紅（#1557）。
  二讀日期／月份／「今天」相關的 PR 一律 `TZ=UTC npx nx test web …` 再跑一次（#1558 的規則）。
- **fake today 要不等於真實今天**，否則改回 `new Date()` 的突變不會紅（#1559 第一版：fake 與真實同為 10-14）。
  `npm run test:timetravel`（+3 個月）也抓不到「完全沒被斷言」的行為——時間旅行只擋會過期的 fixture。
- 用 `taipeiDateString`／`SystemClockService.todayTaipei`，不用 `new Date().toISOString().slice(0,10)`（UTC 日）。

### 三、合併動作的坑

- `gh pr merge --match-head-commit` **要完整 40 字元 SHA**；8 碼會 `Could not coerce value to GitObjectID`。
- **主線動過後 `mergeable` 會變 `UNKNOWN` 幾十秒**，不是紅燈；等它變 `MERGEABLE`（我的腳本回 NOT READY 時先重查，別當失敗）。
- **我自己的守門條件寫太寬**：`*apps/*` 會擋掉所有 web PR（路徑是 `apps/web/...`）。守的是 `apps/api|supabase|.github`。
  守門腳本寫完先對一支已知可合的 PR 試一次。
- **`gh run rerun` 沿用舊的 merge SHA**，不等於對新 main 重驗。主線有人合了之後要重驗用 `gh pr update-branch`（會推一顆
  merge commit 到作者分支，**只在沒有衝突、且計畫席授權時用**）。
- **兄弟 PR 以 squash 合進 main 後，另一支帶著未壓縮 commit 的分支會衝突**（#1545→#1546）；`update-branch` 做不到。
- **作者分支衝突：回報作者，不自解**（計畫席 10-14 定的）。例外只有計畫席明講請我接手（#1478）。我在這之前
  解過一次（#1538 的 import 區，並回報了增量）——之後照規則走。
- 合前先 `git merge-tree --write-tree --name-only origin/main <pr> | grep -i conflict`，一秒鐘看得出有沒有衝突。
- **併 main 後在 detached HEAD 上跑**（`git checkout --detach origin/main && git merge --no-edit <pr>`）：測的是「合進去之後」的樣子，
  #1460×#1461（各自綠、合起來 typecheck 紅）就是這樣漏的。**合前對最新 main 跑一次 typecheck**。

### 四、herdr 回報：引號會吃掉內容

`herdr agent prompt <席> "…"` 的雙引號字串裡出現反引號會**被 shell 當命令執行**（吃掉那段字、甚至整則報錯沒送出）。
一律 `"$(cat <<'MSG' … MSG)"`（單引號 heredoc）。送完看到 `sent` 才算送出；錯誤訊息是 `command not found: …` 時重送。

### 五、沒有登入態時怎麼辦（實機驗證）

- 別席留在 `~/.cache/clessia-visual-diff-*/state-admin.json` 的登入態**會過期**；`link-admin.txt` 的 magic link **單次有效**。
  過期的症狀是**頁面被導去公開登入頁**——而公開頁的 `scrollWidth`／`nav` 數字看起來很合理。**量完一定看一眼截圖。**
- Playwright 模組可借別席 `.pw-regression/node_modules`（在暫存目錄 `ln -s` 過去，ESM 不吃 `NODE_PATH`）。
  起自己的 dev server（`npx nx serve web --port=4300`，API 沿用本機 8787），量完 `pkill` 掉。
- **真的鑄不出登入態就誠實寫「算的、不是量的」**：拿 PR 自己量到的數字做算術（#1530 payments 兩顆長標籤），並指出沒有 spec 守。
- 與資料庫相關的語法（巢狀 `!inner`＋`in`、`in.()`）**可以不登入驗**：本機 supabase REST 帶 service role key，
  `HEAD` ＋ `Prefer: count=exact` 對 SQL 直接 join 的筆數（#1533，24／26／0 全對得上）。契約測試打不到的語法用這招。

### 六、資料庫與 migration

- **回填 SQL 要查目標表上的 `BEFORE UPDATE` trigger**：`guard_invoice_void` 對作廢單拒絕任何欄位變動，#1472 的回填第一次在
  有作廢單的正式 DB 就會整支回滾。暫存 DB 沒帶 trigger、seed 沒有作廢單所以作者驗不到。本機真 DB 開交易、造一張作廢單、跑回填、`ROLLBACK`
  ——共用 DB 不留痕跡（`psql -h 127.0.0.1 -p 54322 -U postgres`）。
- **migrate plan 的紅燈不是「等 Approve」**：10:59–15:00 卡死是 plan 步驟紅（schema 與 after-deploy 同批 → blocked），不是 waiting。
  說「等使用者 Approve」前先 `gh run list --workflow migrate` 看那顆 run 是不是 `waiting`。#1485 之後同批會判 `apply` 並延後回填，
  但**回填 PR 仍要等 schema 套上並部署後才合**。
- 合進 main 的 migration 含**任何一支**就觸發凍結規則（停止代合並回報）；計畫席可能口頭解凍「非 migration 的」，要照字面做。

### 七、前端特有

- **Tailwind 掃描範圍**：class 寫在 TS 字串（`text-[34px]`）要該目錄在 `tailwind.css` 的 `@source` 清單裡，且任意值不能寫成 `[class.text-[34px]]`
  （方括號讓綁定名稱解析靜默失效）。
- **A27 觸控下限看的是「靜態 class」**：把 `class="… min-h-11 …"` 改成 `[class]="layout().row"` 動態字串，gate 掃不到 → verify 紅（#1541）。
  `npm run harness` 本機跑得出來，合前對併 main 的狀態跑一次。
- **共用元件加 input 的二讀三件事**：(1) 預設值＝原行為（PrimeNG 的 `appendTo` 預設也是 `undefined`，要查原始碼不是猜）；
  (2) 每個**使用端**都跑 spec（`git grep` 找使用處，別靠記憶）；(3) 改恆值突變要紅。
- 第一次 vitest 冷啟動的偶發逾時（`contact-logs.spec` 第一支測試 5000ms）：同 head 再跑一次、再跑 main，兩邊都綠就是偶發，**但要在回報裡寫出來**。

### 八、回報的寫法

每支合併回報固定：`PR → merge commit（head、CI、檔案數、有無 migration）`＋`併 main 後的測試數`＋`每個突變→紅哪一支 spec`＋
**沒被 spec 守到的**（明講「不擋／擋」及理由）＋**沒驗的**（Tailwind 渲染、實機、登入態）。**一個要求的突變沒轉紅就不合**
（這輪因此擋了 #1537、#1540、#1542、#1549、#1551、#1559 各一次，作者補 spec 後全部重跑轉紅才合）；沒擋的缺口寫進回報讓計畫席決定。

## 10-15～10-16 代合（約 60 支，含 4 支 migration）學到的，一頁版

**只放知識。** 狀態看 PR 與 issue；交接當下的佇列寫在交接 PR 的說明裡。

### 一、合併動作

- **`tools/steward-merge.sh <PR> <審過的 SHA>`，SHA 必填**（#1666）。帶的是二讀時實際驗過的那一顆，不是授權訊息裡的、也不是現查的 head。
  #1656 就是作者在等 CI 時又推一顆、舊腳本鎖了「執行當下的 head」，把沒審過的 commit 合進去。
- 把「等 mergeable 不是 UNKNOWN → steward-merge → 找 merge commit 的 verify run → `gh run watch`」寫成一支拋棄式小腳本，
  每一支都用它。主線一動 mergeable 就變 UNKNOWN 幾十秒，手動重試很容易漏。
- **疊在別支上的 PR，前一支 squash 合進 main 後一定衝突**（add/add）。**請作者 merge main，不要建議 rebase**——
  已推的分支不 rebase、不 force push（計畫席 10-16 糾正過我）。
- **作者說「你先前審過」要自己查**：#1697 作者以為我審過，其實沒有。照 SHA 重審。

### 二、CI 的紅不一定是程式

- `supabase/setup-cli@v1` 的「Failed to resolve latest Supabase CLI release: rate limit exceeded」會讓 seed-reset／api-contract 紅。
  看 `gh run view <id> --log-failed`，是這行就 `gh run rerun <id> --failed`。
- **main 上 verify workflow 只要有一個 job 紅，migrate 就不會觸發**。migration 合併後 seed-reset 被 rate limit 打紅，
  第二支 migrate 遲遲不出現——重跑那個 job 綠了才出現。
- `build web` 起來半秒就 `Segmentation fault`（exit 139）是 runner 問題：本機 production build 綠、`rerun --failed` 綠。
- 但 **api-contract 的 `AssertionError` 是真的**（#1675 `/api/me/push-config` 404、#1672 SQL 與 REST 欄位不一致）。先讀 log 再判斷。

### 三、突變

- **「搬順序」的突變要純搬**：在新位置加一次、同時拿掉原位置那一次。只加不拿會因為「被呼叫兩次」而紅，看起來守住了，其實沒有（#1677 限速在 PoW 之前）。
- **等價突變要指認出來，不要逼作者補 spec**：`paramMap` 同步發值時 loading 初值是 true 或 false 結果一樣（#1674）；
  家長沒有 staff 列時「家長也回暱稱」不會改變輸出（#1672）；單筆路由只傳一個 id 時 abort／skip 一樣（#1655）。
- **悲觀刪除要對「改成先拿掉」做突變**；每個寫「悲觀」的動作都要有「沒回時不動」「失敗一直都在＋toast」兩支（#1674 退過一次）。
- 突變讓測試**卡死**（例如排隊的 promise 永遠不 resolve）也算守住，但要停掉背景程序再還原檔案。macOS 沒有 `timeout` 指令。
- scratchpad（`/private/tmp/...`）會被清，`mut.py` 不見了就重建；別把它當永久工具。

### 四、migration

- **交易乾跑**：`(echo BEGIN; cat migration.sql; echo <驗證 SELECT>; echo ROLLBACK) | psql "$DB_URL"`。pg_cron 的 `cron.schedule` 也會被 ROLLBACK 收掉。
  能測「中止條件」就測（#1690 先塞一列再跑，確認 RAISE）。最後查 `to_regclass`／enum 值確認沒殘留。
- `ALTER TYPE … ADD VALUE` 在交易裡可以，但同一個交易不能用新值（#1696 只加不用）。
- **連續兩支 migration**：第一支合 → 凍結 → 它的 migrate 進 waiting → 合第二支 → 第二支也 waiting → 兩個連結一起回報。
  **沒有 migration 的 PR 也別在兩支都 Approve 之前合**：它的 commit 也會觸發一個 migrate run，多一個 waiting 會干擾使用者依序 Approve（#1669 因此延後）。
- 部署接在 migrate completed 之後（deploy.yml），所以「api 讀新欄位」的 PR 跟 migration 同批合沒問題——但手動先部署 api 就會壞。

### 五、實機驗證（不寫正式、不寫共用 DB）

- 本機 api 沒有 LINE 金鑰：`npx wrangler dev --port 8788 --inspector-port 9339 --env-file <主 checkout>/apps/api/.dev.vars --var LINE_CLIENT_ID:dummy --var LINE_CLIENT_SECRET:dummy`，
  不改任何檔。web 寫死打 8787（常被別席佔用），用 Playwright `page.route('http://localhost:8787/**')` 轉到 8788；
  `page.route('https://access.line.me/**')` 攔下並記網址，**走到授權頁就停**。
- **起 dev server 前先 `lsof` 看埠**：4200 被別席佔用時 `nx serve` 會直接退出，你連到的是別人的 app（#1639 重驗時我量錯過一次）。
- **量動態不等於驗互動**：#1639 逐幀全綠，但面板在 `<main inert>` 底下、LINE 鍵點不到——要實點，用 `elementFromPoint` 看打到誰。

### 六、依賴與環境

- main 加了新依賴（`altcha-lib` 在 apps/api、`altcha` 在根目錄）之後，**根目錄與 apps/api 都要 `npm ci`**，否則 typecheck／build／harness 會以「找不到模組」紅，看起來像 PR 壞了。
- 本機 DB 的 migration 狀態會被 db-reset 席改變；跑契約測試前查 `supabase_migrations.schema_migrations`，知道自己測的是哪個 schema。

## 10-16～10-19 代合（約 35 支，含 1 支 migration）學到的，一頁版

**只放知識。** 這一任大約四成的 PR 第一輪被擋，幾乎全是「刻意改壞一個判斷，測試全綠」。狀態看 PR。

### 一、我自己的突變會失準 —— 先確認它真的跑了

- **zsh 不拆 `$VAR`**：把 spec 清單放進字串變數，vitest 收到一整串路徑、一支都沒跑，輸出只剩契約那幾行（#1716 第一輪）。**用陣列 `"${SPECS[@]}"`**；每次看到摘要少了單元那行，就當這輪無效。
- **grep 過濾會吃掉真正的結果**：契約輸出裡有「50 位管理員 **×** 200 張帳單」，含失敗符號，`head` 先截到它（#1720）；harness 失敗印的是 `✖` 不是 `✗`（#1728 本機漏看）。先 `grep -v` 雜訊，摘要行要看到 `Tests` 才算數。
- **突變要換掉呼叫本身**：`const job = f(); … if (wu) wu(job)` 這種寫法，拿掉 `wu(job)` 不算拿掉呼叫，promise 一建立就開跑（#1711）。
- **`if (false)` 可能讓 TS 收窄失敗 → 編譯錯 → spec 一支都沒跑**（#1679 的 `key === null`）。改成能編譯的寫法（改回傳值）再跑。
- **錨點命中兩次**：同一句在 `insertMany` 和 `upsert` 都有、或註解裡也有（#1709、#1734）。`mut.py` 的 assert 會擋，但要記得重跑。

### 二、反覆抓到缺口的地方（新 PR 先從這裡下手）

- **掛載層的授權**：`mount()` 的角色與權限在整個 repo 原本沒有任何測試。#1728 拿掉 `manage_students` 全套 api＋契約都綠，計畫席裁「不放行」，作者補了真 app 的 mount spec；通用版另開 #1730。**新路由一律對 `index.ts` 的 mount 做突變。**
- **fail-closed**：讀取失敗時的分支最常沒 spec，而它通常就是防線本身（#1734 讀出勤失敗 → 會把出席蓋成請假）。
- **只有一個孩子／一則／一期的 fixture 測不出範圍**：兄弟姊妹（#1734）、兩個 org 同 id（#1728）、超過 100 則（#1703、#1710）、剛好落在邊界那天（#1720 日期窗）。
- **共用元件的使用端**：元件 spec 守的是 input 做什麼，不守哪幾頁有用它（#1704 四頁拿掉 `listRow` 全綠）。
- **opt-in 的開關與 aria／修飾鍵**：Cmd／Ctrl＋點被攔（#1713）、`name` 沒在同一組（#1709）。

### 三、設計層的問題要找出來交給計畫席，不要只看「測試有沒有守」

- **共用判準在新的呼叫端可能不再安全**：`buildLeaveAttendanceUpserts` 一律覆寫既有出勤，管理端是人工判斷所以 OK，家長端補請就會把出席蓋成請假、少扣堂（#1734）。讀共用函式時問一句：**新呼叫者的信任等級跟舊的一樣嗎？**
- **讀完再寫的時序**：先讀狀態判斷、再 update 而不帶狀態條件（#1728 拒絕 vs 之後的核准）。建議 `.in('status', …)`＋0 列回 409。
- 這兩件都是我列選項、計畫席裁，我傾向哪個要寫出來但不自己決定。

### 四、合併動作

- **UNSTABLE 不一定是紅**：同一顆 commit 上有被 concurrency 取消的 check 也會 UNSTABLE（#1714）。在同一顆上 `gh run rerun <取消的那個>` 轉綠後就 CLEAN。
- **head 會在你審的時候變**：等 CI 時又推一顆（#1713、#1678）。`steward-merge` 帶審過的 SHA 會擋下，這是對的；重審新那顆。
- **作者說「只改了 spec／只 merge main」要自己證**：`git diff <merge-base> <head> -- . ':!*.spec.ts' | git patch-id --stable` 跟計畫席讀過的那顆比（#1716、#1717、#1720）。**跟「現在的 main」比會看到別支剛合的內容，要跟共同祖先比**（#1709 一度誤判成 5000 行刪除）。
- **squash 疊 PR**：下層合了，上層 merge main 會整批衝突。作者「全取 ours」之前，先確認 main 上那幾個檔跟下層審過的 head 是 0 行差（#1713）。
- **GitHub API 逾時**：`steward-merge` 可能卡住或半途失敗（10-17）。重跑前先 `gh pr view --json state` 確認沒合；腳本自己會重核 head。

### 五、migration（#1728）

- **migrate 的 head 不一定是 PR 的 merge commit**：harness 自動重生的 `[skip ci]` 會疊上去，migrate 跑在那顆上。用 `gh run list --workflow migrate.yml --limit 3` 找，不要用 `--commit <merge>` 篩。
- **確認 waiting 是對的**：`plan` 的 log 有「migration 差集」與檔名，跟 PR 的 migration 對得上才回報連結。
- 「照抄既有 CHECK 再加值」的 migration：先 `grep` 找出最後一支改那個 CHECK 的，再跟本機 DB 的 `pg_get_constraintdef` 比，確認新版是超集。

### 六、溝通

- 席位退場後 herdr 找不到它（`agent_not_found`）；跨 session 的來訊用 `SendMessage` 回 `from=` 的 uds 位址。
- 計畫席 `agent_blocked`（等人工輸入）時訊息送不到，**之後要記得重送**，不然它會在沒看到你的待裁事項下做決定（#1728 那次）。

## 10-20～10-23 代合（約 110 支，含 6 支 schema migration、1 支 backfill）學到的，一頁版

> 這幾天開始有第二審核席（review2 → review3）分擔二讀，本席只負責合併、凍結、migrate、部署，以及 migration 那一條的二讀。

### 一、突變的基準一定要先綠（兩次差點報錯）

- **基準紅，每個突變都會被算成「紅」**：#1827 的測試集含 `mount-authz.spec`，它在暫存 worktree 缺 `altcha-lib` 匯入就失敗，33 個突變全「紅」，我在 PR 上報了全紅，事後更正（實際存活 10 個）。#1814 是路徑 `src/routes/parent` 誤含 `parent-requests.mount.spec`（改成 `src/routes/parent/`）。
- **runner 內建基準檢查**：scratchpad 的 `runm.sh` 先跑一次同一組測試，非 0 就中止。web 的 runner 也照做。
- **暫存 worktree 的 `node_modules` symlink 到本席 worktree 那份**（根與 `apps/api` 兩層）。主 checkout 那份舊，缺 `altcha-lib`、`@tailwindcss/postcss`。
- **型別收窄**：`if (false)`、拿掉 `if (!x) return` 常編不過。存活的突變要再 `tsc` 一次確認能編譯（過濾掉環境造成的 altcha 錯誤）。

### 二、合併動作

- **一串合併只用一支 `mv.sh`**。不要寫背景等待去 grep 前一串的輸出檔接力：輸出會互相 cat，舊的「verify → completed」讓條件提早成立，#1864 因此在 #1834 的 main verify 出來前就合了（事後都綠，沒傷害）。要插隊，就 `TaskStop` 正在等 verify 的那串（確認它不在合併呼叫中），再用一支 `mv.sh` 重排。
- **各自綠 ≠ 合起來綠**：#1884 跟已合的 #1834 各加一次 `hideLabel`，merge-tree 無衝突、PR 的 CI 綠，合起來 TS2300。共用元件／型別有動，合前在「最新 main＋head」跑一次 `tsc`。
- **CI 紅先看是不是基礎設施**：`Failed to resolve latest Supabase CLI release: rate limit exceeded`、GitHub API 504、`error connecting to api.github.com` 都出現過，`gh run rerun --failed`／重跑 `mv.sh` 即可。在 main 綠之前不合任何東西。
- **疊 PR 被 squash 後**：上層的 base 不會自動改回 main，請作者 `gh pr edit --base main` 再 merge main。

### 三、migration（本期 6 支 schema＋1 支 backfill）

- **一次一支**：合了就凍結，migrate waiting → 計畫席轉使用者 Approve → apply success → deploy success 才解凍。凍結期間只合「只動 kb/ 或 herdr-team/、deploy 會 skip api／web」的純文件（計畫席 10-22 允許）。
- **兩支 migration 改同兩個檔**（#1830、#1832 都動 `push-run.ts`、`org-settings.ts`）：後合的那張 merge main 後要逐段確認兩邊都留（`guarded` 三支、兩組設定欄位、notify union）。
- **after-deploy backfill**：push 觸發的 migrate 只 plan、apply skipped；使用者 dispatch 時 `deployed_sha` 要填**含 backfill 檔的那顆**（workflow 會 checkout TARGET_SHA 再套），不是最後一次 deploy-api 的那顆。
- **乾跑**：本機 DB 只在 `BEGIN; …; ROLLBACK;` 裡跑，順便驗 CHECK、部分唯一索引、enum 值；`ALTER TYPE … ADD VALUE` 在交易裡可以加、可以回滾。

### 四、反覆抓到的缺口（新 PR 先從這裡下手）

- **「功能沒接上」也全綠**：每日排程不呼叫新的 enqueue（#1830、#1832 的 P1）。新 lib 一律對呼叫端打一個突變。
- **讀取失敗的分支**（fail-open）：家長端讀取、名單讀取、預覽讀取，幾乎每張第一輪都缺。
- **兄弟姊妹／別 org／別堂**：替身不照 `eq`／`in`／`event_id` 過濾，拿掉條件照樣綠（#1818 R7–R10、#1880 A1、#1896 S9：老師教過任何一堂就能讀寫每一堂）。請作者讓替身照條件過濾或攔查詢字串。
- **推播狀態與 ON CONFLICT**：只進通知中心的提醒，`push_status` 改成 pending、拿掉 `ON CONFLICT` 都照綠。
- **純視覺**（px、字級）有截圖量測就不要求 spec；**讓版面成立的 class**（`min-w-0`、`truncate`、`shrink-0`）與 **aria** 要求斷言。

### 五、分工與溝通

- 第二審核席只二讀不合；它報「#N @完整 SHA 可合」，本席核對 head 一致後照 SHA 合。開讀前互相確認沒審同一張；作者改了替身就整組重跑，提醒它照做。
- 作者退場（`agent_not_found`）就請計畫席轉派；roles-2c 只能用 `SendMessage` 回 uds。
- 使用者親合只限：既有金額路徑、migration Approve、修憲、backfill。家長讀取面、授權修正、`/api/me` 名字退路都不是（計畫席多次更正作者寫的「等使用者」）。
- iOS 實機要使用者驗的：#1854（已驗）、#1869、#1893。

### 六、手上的單（2026-10-23 交接時）

- **背景合併（一支在跑）**：#1933 @7d925b55 → 接著另一支等 #1933 合了、main verify 綠才合 #1930 @79247770 → #1929 @07340e40 → #1916 @ab429532 → #1935 @d9636e95（**migration，合了就凍結**），最後印出 migrate waiting 的連結。計畫席代按 Approve（使用者授權到 10-23 10:00）。醒來先看這五張與 migrate。
- **文件類待合（凍結中也能合）**：#1939 @319827f3（charter）、#1941（review3 charter 補件）。
- **review3 手上**：#1922（保留類，斷言被別名子字串騙過，等作者改）。
- **合後提醒**：#1920 要在 Windows／Android 看後備字型；將來加 CSP 要處理字型的 onload。
- **待使用者 iPhone 驗**：#1869、#1893、#1908。

### 七、限流的坑

- **限流前排的背景等待，醒來後還活著。** 這次有兩支舊的接力腳本在重置後醒來，跟新排的串同時合同一張（#1927、#1933）。SHA 都釘死所以沒合錯，但不該發生。**醒來第一件事：`pgrep -fl mv.sh` 與 TaskList，把舊的接力全部停掉，再排新的一支。**

## 10-23 補（labor-reviewer-20261023-0548）：合併 migration 前重驗時間戳

- **一次排多支 migration 依序合時，時間戳要晚於「佇列中先合的每一支」，不只晚於當下 main 最新。** #1988（034048）→ #1989（033540）→ #1990：二讀 #1989 時只跟 main 最新比，#1988 先套上正式後，#1989 被 migrate plan 判成「中間漏套」擋下，deploy 全停，使用者授權 c3 破例改檔名（#2025、#2026）。各 PR 的 A16b 在自己的 CI 跑，並行時看不到對方。
- **計畫席 10-23 指派：合併 migration 前由審核席的合併腳本重跑一次**（等於合併當下的 A16b）：這張的每一支 migration 時間戳，必須晚於 `origin/main` 最新與正式 DB 最新（最近一次 success 的 migrate run，plan log 的 `REMOTE_VERSIONS`）；不過就停、通知計畫席。實作在本席 scratchpad 的 `mig2.sh`（`ts_guard`），以 #1990（過）與 #1989 舊檔名（擋）驗過正反。
- **bash 變數後面直接接全形字會被吃成變數名**（`$m）`、`$id：` 展開成空）：送出的訊息變亂碼，herdr 拒收，`send` 的重試迴圈把合併腳本卡住近半小時。一律寫 `${m}`；送訊息改背景，不擋合併。
- **等待條件別用 `pgrep -f "<自己命令列裡也有的字串>"`**：會比對到自己、永遠等不完（10-23 踩兩次）。改看前一支任務的輸出檔。

## 10-23～10-28 代合（約 75 支，含 4 支 schema migration、1 次 c3 破例改名）學到的，一頁版（labor-reviewer-20261023-0548）

> 10-23 中午起第二審核席 review3 退場、計畫席決定不再補（Weekly 吃緊），**二讀與合併全由本席**。

### 一、工具（本席 scratchpad，換席要自己複製並改 `cd` 路徑）

- `mv.sh <PR> <完整SHA> …`：逐張 `cimg.sh`（等 CI 不 pending、紅就不合、head 釘死）→ 合 → 等 **main verify** 綠才下一張；紅就停。
- `mig2.sh <PR> <SHA> …`：migration 專用，一次一支：**先 `ts_guard`**（PR 的 migration 時間戳必須晚於 `origin/main` 最新與正式 DB 最新）→ 合 → 抓 migrate run、讀 plan log 的待套檔名 → **背景**送連結給計畫席 → 等 apply＋deploy 都綠才解凍下一支。
- **一律只留一支在跑**。要插隊：確認排隊那支的輸出檔還是空的（尚未動手）→ `TaskStop` → 重排一支。兩支「等前一支結束」的等待同時存在，前一支一結束它們會同時起跑。
- 等待條件用「前一支任務的輸出檔出現某行」，**不要** `pgrep -f "<自己命令列也有的字串>"`（會比對到自己、永遠等不完）。不要用 `nohup … &`（脫離任務管理，停不掉、收不到通知）。
- SHA 一律貼完整 40 碼；不要用「前 8 碼＋即時 head 後段」拼（拼了還是要再核一次，等於沒釘）。

### 二、二讀的固定動作

- **突變全在暫存 worktree**（`git worktree add --detach … pr<N>`，`node_modules` 根與 `apps/api` 兩層 symlink 到本席 worktree）。api 用 `npx vitest run <path>`；**契約**：`eval "$(npx supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY|DB_URL)=')"` 後帶 `CONTRACT_REQUIRED=1` 跑 `vitest.contract.config.mts`；web 只能走 `npx nx test web --include=…`（直接 vitest 解不了別名），多個路徑用**重複 `--include`**，大括號 glob 會找不到檔、輸出全空。
- **基準先綠**，輸出空白＝這輪無效（編譯錯、找不到檔）——不是「全綠」。`if (false)` 常讓 TS 收窄失敗，改用回傳值類的突變。
- **反覆抓到的缺口（新 PR 先打這幾個）**：pg 路徑的 `catch` 吞成空結果（只測 REST 退路的 read-failure spec 抓不到，#1952、#1936）；「接線」——lib 寫好但入口沒呼叫、或 middleware 沒把 pool 交給 childDb（#1976、#2008）；家長端讀取失敗回 200＋空清單（#2012）；spec 只斷言整段文字「含有」兩個字，對調照綠（#2013）。
- **merge main 之後的核對**：逐檔比「對 merge-base 的增刪行」（`grep '^[+-]' | md5`），不要只比 patch-id —— import 併在旁邊會讓 patch-id 變、內容其實一樣（#2014）。**squash 疊 PR**：下層合了上層一定衝突，請作者 merge main，再比「上層自己對下層」的那段（#2012）。
- **migration**：時間戳要跟**佇列裡先合的每一支**比（#1989 漏比，見上一節）；本機 `BEGIN; …; ROLLBACK;` 乾跑、回滾後確認本機沒留下；`ADD VALUE` 在同一交易用新值會被擋，是預期；檔內有 `DROP CONSTRAINT`／回填時，提醒計畫席「代按授權不含 drop／backfill」，由它問使用者（#1989 使用者明確同意才代按）。

### 三、合併動作

- main 紅先分辨：`build web` 結束碼 139（segfault）、`class-delete.contract` 的 deadlock（#2002 已修）都是重跑即綠；**重跑綠之前一張都不合**，排隊那支也要先停。
- 說「佇列空了」之前先跑 `gh pr list --state open`（10-23 晚上漏了 4 張沒送到本席的）。
- 計畫席常 `agent_blocked`：重要訊息用背景迴圈每分鐘重送到 `agent_prompted`。bash 字串裡**變數後面直接接全形字會被吃成變數名**（`$m）`），送出亂碼 → herdr 拒收 → 前台重試迴圈卡住合併。

### 四、手上的單（2026-10-28 交接時）

- **等使用者親合（金額路徑，已重驗）**：#1936 @4bc12e36 → #1964 @6421f66a（疊在 #1936 上）、#1952 @6873ce05。合併順序 #1936 先。
- 其餘開著的 PR：無。沒有任何合併腳本在跑。
- 未開 PR、不要合：分支 `fix/2037-phone-leave-skeleton`（motion 退場前的 wip）。
