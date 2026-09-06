# 計畫席狀態快照

> 額度逼近或輪替時落檔。**任何 session（含復活的計畫席）接手先讀這裡**，
> 然後 `gh issue list --state open` 與 `gh pr list --state open` 現查 ——
> **本檔記的是「為什麼」，不是「還剩什麼」**。狀態一律用查的。
>
> 最後更新：**2026-09-06 台北 23:2x**（review-steward 補紅燈那節；本體由計畫席 clessia-48 寫於同日 23:21）
>
> ⚠️ 上一版這一行寫「台北 16:5x」，而寫它的 commit `d79ae905` 是 **23:21:51+08:00** ——
> **漂了六個半小時**，就漂在「接手第一件事：報時間一律實跑」的正上方。
> 沒有害到人是因為它旁邊就是那條規則；**但那條規則救不了寫它的人自己。**

## ⚠️ 讀 main 的 CI 狀態之前先看這一節（2026-09-07 04:5x）

**`gh run list --workflow verify.yml --branch main` 現在會顯示一批 `cancelled`,而那不是故障。**

`concurrency` 的修法(PR #603, commit `fa90fce2`)只對**它之後的 commit** 生效 ——
GitHub 讀的是**該 run 自己那顆 commit 上的 workflow 檔**,
所以修法之前的 commit 照舊會互相取消,**而它們會在列表上停留幾小時直到排空**。

**判定方法**:

```bash
git merge-base --is-ancestor fa90fce2 <run 的 sha>   # 回 0 才是修法之後的
gh run list --workflow verify.yml --branch main      # 一定要加 --workflow,否則 smoke 的成功會混進來
```

**真正的驗證要等下一顆 main commit**:看 `fa90fce2` 那顆 run 有沒有**活著跑完**。

**在那之前,板上的 `cancelled` 不是訊號 —— 而它跟真的故障長得一模一樣。**

## 接手第一件事

1. `TZ=Asia/Taipei date` —— **報時間一律實跑**。前一任在這件事上憑感覺漂了四小時。
2. `herdr agent list` —— 誰在 working、誰 idle。**不要用 issue 板推論席位活動**（前一任犯過）。
3. `gh pr list --state open` —— 非 draft 且 CI 綠的**非保留類**直接合。
4. 讀 `herdr-team/README.md` 的「計畫席消失時怎麼辦」與全席通則（2026-09-06 新增二十幾條）。

## 保留類（只有使用者能合）

**migration（schema）／金額計算路徑／授權權限邏輯。** 這三類 CI 綠也不要合，
攢到使用者窗口。其餘計畫席自己合，或交 `review-steward` 代合。

## 這一輪在飛的東西：為什麼還沒完，不是進度快照

| 主題 | 卡在哪 |
| --- | --- |
| **補課功能** | schema 已合（PR #548）。API 那片卡在**寫入順序**：PostgREST 沒有跨語句 transaction，裁定走「先寫 FK、再寫 `schedule_changes`、加補償」，理由是**先寫流水的失敗態跟一個合法狀態長得一模一樣**。RPC 記成觸發條件（第二個地方也需要原子性時再評估）。 |
| **PR #535**（儀表板可點訊號） | CI 綠但**押著**。那筆缺陷是在 fine pointer 下量的，而**這個環境沒有真的 device emulation**。等 design-web 用注入法（charter 坑 34）驗證那個問題在 coarse 下是否真的存在。**結論若是「不存在」，不要 revert**——它加的鍵盤 focus 樣式無論如何都對。 |
| **issue #502 第 1 項** | 已裁：寫入點擋（先停課後請假不再寫 `on_leave`）、既有的保留（那是當時正確的歷史）。**尚未實作。** |
| **issue #488**（六個從沒執行的 TODO） | 報告已交。**甲（點名時寫 `completed`）vs 乙（時間過了寫）的語意歧義沒解**，而乙需要 Cloudflare Cron Trigger（這個專案沒有排程基礎設施）。 |
| **issue #464**（`requirePermission` 盤點） | 表已做好、右欄留空。**計畫席刻意壓著沒推給使用者**——它不阻塞任何人，而使用者手上已有保留類要合。三個前提問題要跟空表一起送。 |

## 今天證實的三個環境限制（會讓你誤判）

1. **本機 DB 可能落後 migration** —— 錯誤訊息（`column … does not exist`）跟真的欄位被 DROP **一模一樣**。手動驗證前先 `supabase migration list`。
2. **MCP 瀏覽器沒有真的 device emulation** —— `matchMedia('(pointer: coarse)')` 永遠是 false。繞道法在 design-web charter 坑 34。
3. **瀏覽器 session 是共享的機器狀態** —— 換身分要先登出，會踢掉別席。三席今天各撞一次。權宜做法：**資料連通性用 API 驗，畫面才用瀏覽器**。

## 紅燈：main 上有一支時序 flake（2026-09-06 23:2x 查）

`663d0254` 的 verify **failure**，單一測試：

```
apps/web/src/app/core/chunk-recovery.spec.ts
  > 防迴圈旗標 > 時間窗內再失敗 → 擋住（這是防迴圈的核心）
  Tests  1 failed | 1274 passed
```

**這是 flake，不是真紅，而且是可以從程式碼推出來的**（不必等它再紅一次）：

| 位置 | 做什麼 |
| --- | --- |
| `markReloadAttempted()` | 存 `at = Date.now()` — 記為 `T0` |
| 測試斷言 | `hasReloadBeenAttempted(Date.now() + RELOAD_WINDOW_MS - 1)` — 那個 `Date.now()` 是 `T1 ≥ T0` |
| 實作 | `return now - at < RELOAD_WINDOW_MS` |

代進去：`(T1 + WINDOW - 1) - T0 < WINDOW` → **`T1 - T0 < 1`**。
**也就是這條測試只有在兩次 `Date.now()` 落在同一毫秒時才會過。**
CI 負載一高、跳過 1ms 就紅。

隔壁那條（`+ WINDOW + 1`，期望 false）反而永遠安全：`T1 - T0 < -1` 恆不成立。
**同一支檔案裡，一條恆真、一條靠運氣，而它們讀起來對稱。**

這是 README「**測試不能用被測程式碼自己的算法當裁判**」的鄰居，但更薄一層：
它連算法都沒共用，只是**把期望值建在第二次讀時鐘上**。
判準補一句：**斷言裡出現第二次 `Date.now()` / `new Date()`，就是把時序寫進期望值了。**

**修法**（不歸 review-steward，交給 web 側）：`markReloadAttempted()` 收一個可注入的
`now`，或測試改用 fake timer；不要只把 `-1` 調成 `-2`，那只是把機率壓小。

**對其他 PR 的意義**：這支 flake 會讓**任何一支 PR 隨機紅一次**，而它紅的樣子跟真紅一樣。
看到 PR 紅在 `chunk-recovery.spec.ts` 就直接重跑，不要去查那支 PR 的改動。

## 額度行為（今天觀察到的，不是推論）

**額度耗盡不會殺死 session。** review-steward 今天 Session 掉到 0%、出現 `/low-priority` 橫幅，
**沒有人介入，重試之後回到 49% 繼續工作**。真正會終結 session 的是 context 滿或機器重開。

## 前一任計畫席自己犯的（留給下一任，別重犯）

- **拿代理指標代替查證**，一天五次：issue 指派當席位活動、pane 動靜當工作狀態、issue 開著當未交付、板上新 PR 當某席的產出、記憶當時間。
- **開了五支前提錯誤的工單**（#427/#429/#430/#449/#450/#521），全部是「站得住腳的推導 + 沒查前提」。
- **用 `sleep` 迴圈輪詢 CI** 一整天，工具說明第一行就寫著那是被擋的、該用 Monitor。
- **裁了一條架構上不存在的機制**（「同一個 transaction」，而寫入路徑是 PostgREST over HTTP）。
- **README 自己兩條規則一條說兩點一條說三點**，害別席撞到假警報。
