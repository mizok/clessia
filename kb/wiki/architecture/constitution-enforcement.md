---
title: 憲法強制機制索引
summary: 每條 clause 用什麼機制守、在哪一層擋、目前接上了沒有。改機制不算修法。
category: architecture
status: active
updated: 2026-08-29
tags: [architecture, constitution-enforcement]
---

# 憲法強制機制索引

> [[architecture/constitution|`constitution.md`]] 說**什麼構成違反**；本檔說**違反會在哪裡被擋下來**。
> 兩者刻意分家：調一條 regex、換一個 gate、把 Semantic 條款接上 LLM 稽核，
> **都不需要修法**。

## 檢查階梯

由左到右，越右邊越權威、越難繞過：

```
編輯當下              收工當下              push 當下            人工 review
PreToolUse guard  →   Stop verify gate  →   CI verify        →   程式碼審查
（exit 2 擋寫入）      （exit 2 擋收工）      （唯一繞不過的）      （Semantic 條款）
```

- **PreToolUse guard**（`tools/agent-harness/hooks/pre-tool-use.mjs`）
  —— 讀 `rules/pre-guard.rules.json`，比對**這次新寫入的文字**（不是整份檔案）。
  刻意窄、刻意低誤判；**fail-open**：payload 或規則壞掉一律放行，壞掉的 guard 不該讓人無法編輯。
- **Stop verify gate**（`tools/agent-harness/hooks/stop-verify.sh`）
  —— 工作樹有改動時跑 `check-harness.mjs`（注意：**不含 `feature-map.mjs`**），
  再跑 `nx affected -t typecheck` 與 `nx affected -t test` **兩條分開的指令**
  （分開是刻意的，理由見下方「已知缺口」），紅燈擋收工。
  另有 `CLESSIA_STOP_GATE=0` 的逃生口 —— 存在即可被用，別假設它不會被用。
  `stop_hook_active` 時直接放行（防 live-lock，代價是每條 stop chain 最多強制修一輪）。
  測試部分走**基線比對**（`test-gate.mjs` + `test-baseline.json`）：只擋這一輪新弄壞的 spec，
  既有紅燈只警告。基線是債務，清一支移除一支。
- **CI verify**（`.github/workflows/verify.yml`）—— 掛在**所有分支的 push** 上，
  跑 harness / harness self-test / typecheck / test / **web production build**。
  本機那三層都繞得過（heredoc 寫檔不觸發 PreToolUse、`CLESSIA_STOP_GATE=0`、
  `git commit --no-verify`、直接關掉 hook），這層繞不過 —— 它才是真正的把關。
  刻意用 `run-many` 而不是 `affected`：整套跑完很快，而 `affected` 在 CI 上要正確的 base ref
  才不會安靜失準（`defaultBase` 已於 2026-09-03 修成 `main`，但 CI 的取捨不因此改變）。
- **Harness gate**（`npm run harness`）—— 文件與現實是否同步，見下方 A1–A18。

## 條款 → 機制

| Clause                     | 分類          | 機制                                                                                                                                                | 狀態                                                                        |
| -------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| c1 授權在 API 層           | Semantic      | harness gate A7（每支 route 掛載必須宣告角色）+ 人工 review                                                                                         | ⚠️ 部分：准入已機器化，資料範圍靠 review                                    |
| c2 `ba_*` 不得寫入         | Deterministic | **雙層**：pre-guard regex（只擋 insert/update/upsert/delete，讀取放行；**單寫 `orgId` 已豁免**，見下）+ harness gate A15（存量，債 4 + 永久豁免 1） | ⚠️ 雙重，剩 4 筆真債待 billing-api 驗證 API 路徑                            |
| c3 已提交 migration 不可改 | Deterministic | **雙層**：pre-guard + `whenTracked`（寫入當下）+ harness gate A16（分支對照 `origin/main...HEAD` 的 M/D/R）                                         | ✅ 雙重 —— A16 看不到「直接推 main」的情形，理由見下                        |
| c4 migration 檔名          | Deterministic | 由 `supabase migration new` 保證                                                                                                                    | 依賴工具，未另外 gate                                                       |
| c5 feature 不互相 import   | Semantic      | **部分機器化**：harness gate A18（路徑層面的直接 import，含 `@features/` 與 `@app/` 別名）+ 人工 review                                             | ⚠️ 部分 —— **經由 `core/` / `shared/` 的間接耦合看不到**，那一半仍靠 review |
| c6 禁 viewport 單位        | Deterministic | **雙層**：pre-guard regex（`.scss`，新違規、即時）+ harness gate A12（存量、CI，掃 `apps/web/src/**/*.scss`）                                       | ✅ 雙重 —— 兩層共用 `pre-guard.rules.json` 的同一條規則，見下方邊界記錄     |
| c7 原生 control flow       | Deterministic | **雙層**：pre-guard regex（`.html`）+ harness gate A13（存量，掃 `apps/web/src/**/*.html`）                                                         | ✅ 雙重 —— 存量 0，gate 是防回歸                                            |
| c8 functional API          | Deterministic | **雙層**：pre-guard regex（`apps/web/**`，排除 `.spec.ts`）+ harness gate A14（存量，**allowlist 4 筆**）                                           | ⚠️ 雙重但有 allowlist —— 「等」字的範圍見下方邊界記錄                       |
| c9 `kb/` 唯一              | Deterministic | pre-guard（路徑 `^docs?/`，`doc/` 與 `docs/` 都擋）+ harness gate A3                                                                                | ✅ 雙重                                                                     |
| c10 `AGENTS.md` 單一真相   | Deterministic | harness gate A2（必須含 `@AGENTS.md`、行數上限 60）                                                                                                 | ✅ 已接                                                                     |
| c11 不手抄腐化清單         | Semantic      | A1（skill 清單）+ `feature-map.mjs`（roadmap 現況表，**強制點是 main 的 sync job 而非紅燈**，見下）已機器化；其餘靠 review                          | ⚠️ 部分                                                                     |
| c12 客戶可脫離自架         | Semantic      | harness gate A10（禁用雲端專屬服務 import）+ 人工 review                                                                                            | ⚠️ 部分：專屬服務已機器化，多租戶與 kill switch 靠 review                   |

## Harness gate 檢查項

`npm run harness` 跑**兩支**腳本，兩支都是 `--check`（預設，過期 exit 1）／`--write`（重生成）雙模式：

| 腳本                | 守什麼                                                                                |
| ------------------- | ------------------------------------------------------------------------------------- |
| `check-harness.mjs` | 下表的 A1–A18                                                                         |
| `feature-map.mjs`   | `kb/wiki/roadmap.md` 的**功能區現況表**自動生成且同步（c11）。**強制點在 main**，見下 |

> A1 的真相來源其實是 `skills-lock.json`：磁碟現況用來重生 lock，A1b 再比對 `AGENTS.md` ↔ lock。

| 代號 | 檢查                                                                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | `AGENTS.md` 的 skill 表與 `.agents/skills/` 磁碟現況一致（marker 區塊，自動生成）                                                                         |
| A2   | `CLAUDE.md` 含 `@AGENTS.md` 且不超過 60 行（c10）。`THIN_ENTRYPOINTS` 目前只有這一個檔                                                                    |
| A3   | 沒有 `doc/` 或 `docs/` 目錄（c9）                                                                                                                         |
| A5   | pre-guard **與 doc-router** 引用的每個 clause id 都存在於憲法中                                                                                           |
| A6   | 每個 skill 在 `.claude/skills` 與 `.codex/skills` 都有 symlink（真身在 `.agents/skills/`）。`SYMLINK_EXEMPT` 有豁免清單 —— 改動前先看 `check-harness.mjs` |
| A7   | `apps/api/src/index.ts` 每支 route 都用 `mount(path, route, roles)` 宣告角色（c1）                                                                        |
| A8   | 每張業務表都有 `ENABLE ROW LEVEL SECURITY`（c1 的 fail-closed 後盾）                                                                                      |
| A9   | `.claude/settings.json` 的 deny 規則指向的檔案真的存在（護欄不得靜默失效）                                                                                |
| A10  | `apps/api/src` 不得 import 雲端供應商專屬服務（KV / R2 / Durable Objects，c12）                                                                           |
| A11  | `apps/api/src` 的 `createUser` 不得帶 `password`（scrypt 超過 Workers 的 10ms CPU 上限）                                                                  |
| A12  | `apps/web/src/**/*.scss` 沒有拿 viewport 單位當值（c6 的**存量**那一半；規則與 pre-guard 共用）                                                           |
| A13  | `apps/web/src/**/*.html` 沒有 `*ngIf` / `*ngFor` / `*ngSwitch`（c7 的存量；目前 0 筆，防回歸）                                                            |
| A14  | `apps/web/src/**/*.ts` 沒有裝飾器版 API（c8 的存量；**allowlist 4 筆**）                                                                                  |
| A15  | `apps/api/src/**/*.ts` 沒有直寫 `ba_*`（c2 的存量；**allowlist 9 筆**）                                                                                   |
| A16  | 本分支沒有修改／刪除／改名已提交的 migration（c3；比 `origin/main...HEAD`）                                                                               |
| A17  | 掃描範圍內自己刻的可點元素有尺寸下限（44px 觸控門檻；ratchet，既有的進 baseline）                                                                         |
| A18  | `features/<a>` 不得 import `features/<b>`（c5 可判定的那一半；**無 baseline，立法時零違規**）                                                             |

### 存量 allowlist：讓債務可見且會自己收斂

A14（c8）與 A15（c2）掃到的存量不是零，而修掉它們不屬於「補 gate」這件事的範圍
（c8 那 4 筆要改 shared 元件的對外介面、c2 那 9 筆要動 Better Auth 的使用者更新路徑）。
所以兩條 gate 帶 allowlist，**鍵是檔案路徑、值是已知違規數**：

| 情形                               | 行為                                              |
| ---------------------------------- | ------------------------------------------------- |
| 某檔違規數 **> 帳面**              | ✖ 紅燈 —— 新違規擋得住，這是 allowlist 存在的前提 |
| 某檔違規數 **< 帳面**              | ✖ 紅燈，訊息請人把數字改小；歸零就整筆刪掉        |
| allowlist 上的檔案已無違規／不存在 | ✖ 紅燈，請人移除該筆                              |

**只記路徑不記數量是不夠的** —— 那樣同一個檔案裡新增的違規會靜靜溜過去，
allowlist 就從「已知債務的帳本」退化成「這個檔案免死」。

記數量的另一個效果是**不需要有人記得回來拆鷹架**：清乾淨的那天 allowlist 自然歸零，
gate 隨即變成全面覆蓋。清到一半也會被逼著更新帳面，帳本因此不會腐化。

目前的帳：

- **c8（A14）**：`jdenticon-avatar.component.ts` 3 筆、`shell-layout.component.ts` 1 筆
  —— 屬 design-web 席
- **c2（A15）**：**真債 0 筆**（2026-09-03 兩輪驗證後）。剩下的 5 筆全部是永久豁免，
  每一筆都驗證過「沒有合規路徑」而不是「還沒排到」—— 見下方兩節。

### 債與永久豁免要分開記

`scanExisting()` 收兩份清單，**語意不同**：

|                                    | 意思                             | 會歸零嗎                   |
| ---------------------------------- | -------------------------------- | -------------------------- |
| `allowlist: { 路徑: 數量 }`        | **債** —— 該修但還沒排到         | 會，歸零那天整筆刪掉       |
| `exempt: { 路徑: { count, why } }` | **永久豁免** —— 沒有合規路徑可走 | 不會，所以**必須寫 `why`** |

**混在一起的話「清到零」這個機制永遠跑不完** —— 帳面上永遠有幾筆，而沒有人知道那幾筆
是還沒修、還是根本不用修。分開之後 `allowlist` 歸零就代表債清完了，那才是可驗證的終點。

兩者都是比容許量多 → 紅燈、比容許量少 → 也紅燈（逼帳本跟上）。

### c2 的 `orgId` 豁免（2026-09-03）

**這是規則層的豁免，不是清單層的。** 三處「`admin.createUser()` 之後補寫 `orgId`」不再算違規，
理由是 `apps/api/src/auth.ts` 的宣告：

```ts
orgId: { type: 'string', required: false, input: false }
```

`input: false` 表示 **Better Auth 的 API 明確拒收這個欄位** —— 不是我們懶得走 API，是沒有 API
可走。要求合規等於要求做不到的事，那種規則只會被繞過。

豁免刻意寫得很窄：**只放行「payload 就只有 `orgId`」**（`{ orgId }` 或 `{ orgId: ident }`），
`{ orgId, email }` 這種夾帶照樣擋。有 self-test 守這條邊界 ——
放寬一格就是在 c2 上開一個長得跟合法呼叫一模一樣的洞。

> 為什麼放在規則層而不是 allowlist：allowlist 的語意是「會還清的債」，而這三處**永遠不會被修**。
> 放進去會讓帳本永遠有 3 筆假債，也讓「歸零」永遠達不到。

### c2 的 `me.ts` 永久豁免（2026-09-03，可行性驗證後）

`routes/me.ts` 的兩處直寫從**債**改成**永久豁免** —— 因為驗證後確認它們沒有合規路徑可走，
而不是還沒排到。（驗證方法：逐行讀 better-auth `1.5.5` 的原始碼，不是猜的。）

| 欄位                                        | 走 `auth.api.updateUser` 的結果                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email`（:124）                             | **明確拒絕**：`api/routes/update-user.mjs:54` 丟 `BAD_REQUEST` / `EMAIL_CAN_NOT_BE_UPDATED`                                                                |
| `username`（:151，只有無 email 的家長會寫） | **靜默丟棄**：`db/schema.mjs:35` 的 `parseInputData` 迭代的是**宣告過的 schema**（`for (const key in fields)`），未宣告的 key 連看都不看 —— 不報錯、不寫入 |

#### `email` 的合法路徑是 `changeEmail`，但三個前置這個專案一個都不成立

`update-user.mjs:432` 要求下列至少中一個：

| 前置                                      | 這個專案                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `sendChangeEmailConfirmation`             | ❌ **沒有任何寄信管道**（見 `auth.ts` 的 magic-link 註解：「這個專案不寄信」）                                                                |
| `emailVerification.sendVerificationEmail` | ❌ 同上                                                                                                                                       |
| `updateEmailWithoutVerification`          | ⚠️ 要求 `emailVerified !== true`，但 LINE 登入的使用者我們**刻意**標成 `emailVerified: true`（`lineProfileToUser`，為了讓 link-account 通過） |

**前置條件記在這裡而不是掛在待辦上**：要讓 email 走合法路徑，得先有寄信管道 ——
那是產品層的決定，不是這一席排得掉的工。**掛著假裝會被修掉，比誠實記成例外糟**：
前者會讓「allowlist 歸零」這個終點永遠達不到，而沒有人知道差的那一筆是為什麼。

> 哪天真的有了寄信管道，這一筆要重新評估 —— 那時 `changeEmail` 的第一或第二個前置
> 就成立了。

### c2 的 `parents.ts` / `staff.ts` 永久豁免（2026-09-03 第二輪）

這三筆（`parents.ts` 的 email 與 phone、`staff.ts` 的 phone）全部是「**管理員改別人的資料**」。
兩條合規路徑都走不通：

| 路徑                                       | 為什麼不行                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.api.updateUser`                      | 掛 `sessionMiddleware`，要的是**被改的那個人**的 session —— 管理員手上只有自己的                                                                                                                                                                                                 |
| admin plugin 的 `auth.api.adminUpdateUser` | 權限看的是 **`ba_user.role`**（`has-permission.mjs`：`role: ctx.context.session.user.role`，要求 `user: ['update']`），而**這個專案每一個 `ba_user.role` 都是 `'user'`** —— 管理員身分住在我們自己的 `user_roles` 表。每一次呼叫都會是 403 `YOU_ARE_NOT_ALLOWED_TO_UPDATE_USERS` |

**要讓 `adminUpdateUser` 通過只有兩條路，兩條都比直寫糟：**

1. 把管理員寫進 `ba_user.role` —— **那本身就是 c2 寫入**，而且會一併授予 Better Auth 的
   impersonate / ban / setRole 能力。為了守一條規則而開一個更大的權限面，不划算。
2. 在設定裡寫死 `adminUserIds` 清單 —— 把「誰是管理員」複製到設定檔，
   而它在 `user_roles` 是**執行期會變的**。兩份真相遲早不一致。

### 唯一走得通的是「本人改自己」

`me.ts` 的 `phone` 已改走 `auth.api.updateUser`（session headers 拿得到，
`phone` 是宣告過的 additionalField 且 `input: true`）。

> **這條分界值得記住：Better Auth 的使用者更新 API 是給「本人」用的。**
> 「管理員代改」在它的模型裡屬於 admin plugin，而 admin plugin 要求角色真相住在
> `ba_user.role` —— 那跟這個專案「角色住在 `user_roles`、一人可多角色、
> 權限存 jsonb」的設計是兩套東西。

#### 這次驗證留下的通則

> **合法的 API 不是「做同樣的事」，是「做它允許的事，其餘的靜默忽略」。**

所以 c2 的遷移不能一處一處換掉直寫，要先把每一處的欄位分成三堆：
**可以走**（宣告過的 additionalField）、**會被拒**（`email`、`input: false` 的欄位）、
**會被靜默丟棄**（未宣告的欄位）。第三堆是唯一沒有錯誤訊號的，
也是唯一會在遷移之後靜靜壞掉的 —— `username` 就在那一堆。

### A16（c3）為什麼比三點差異

其他條的「存量」是躺在樹上的違規；c3 不是 —— **樹上不可能躺著一個「已經被改壞的
migration」**，修改一定是相對某個基準的差異。所以 A16 比的是 `origin/main...HEAD`：
本分支從分岔點以來，對 `supabase/migrations/` 底下既有檔案做的 M / D / R。新增（A）放行，
那正是 c3 要求的做法。

三點而不是兩點是刻意的：兩點會把 main 自己新增的 migration 也算成本分支的改動。

**誠實的覆蓋範圍**：直接推 main 時兩端相同，這條看不到東西。本專案不在 main 上工作
（AGENTS.md），而寫入當下那一層由 pre-guard 的 c3（`whenTracked`）擋著，所以缺口可接受。
拿不到 `origin/main` 時（淺 clone、離線）只警告不紅燈 —— 環境問題不該偽裝成違憲。
CI 的 `actions/checkout` 已經是 `fetch-depth: 0`。

### 現況表的強制點是那個 job，不是紅燈

`feature-map.mjs` 的**現況表過期**在任何環境都只是 ⚠️ 警告（exit 0）——
本機、CI 的 feature branch、**CI 的 main 都一樣**。重生由 `verify.yml` 的
`sync-feature-map` job 做：main push 且 verify 綠之後跑 `harness:write`，
有 diff 就補一支 `[skip ci]` 的 bot commit，零 diff 跳過。

> **理由**：現況表是從**整個 repo 的磁碟狀態**推導的，所以任何兩支並行分支只要各自新增了
> 頁面或 route，就會各自重生出不同的表，然後在 main 上撞成衝突 —— 2026-08-29 一天內
> #66 / #68 / #71 三連撞。撞的不是任何人的實質改動，是一張**可以重新生成**的表。

**曾經有一道「main 上表過期就紅」的雙保險，已經移除 —— 它是個死結。**

讓 verify 紅的正是 `sync-feature-map` 要修的那件事，而那個 job 掛著 `needs: verify`：
**能修表的 job 只在表沒壞時才跑**，main 於是自己好不了。2026-08-30 #82 接上餐費頁之後
真的卡住，要人工代打 2 行才解堵（`5be7927`）。

評估過但否決的兩條備選：

| 備選                                  | 為什麼不行                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `if: always()` / 拿掉 `needs: verify` | 會在**真的壞掉**的 main 上疊自動 commit，正是當初加 `needs` 要避免的                                                    |
| 讓 sync job 排在 verify 之前          | 首次 run 仍然顯示紅，而 bot commit 帶 `[skip ci]` 不觸發重跑 —— main 最後一筆狀態還是紅（`5be7927` 推上去之後就是這樣） |

覆蓋沒有因此變薄：job 重生失敗（push 撞車之類）會讓**自己**紅，一樣看得見。
少掉的只是那道搶在自動修復前面把它擋掉的紅燈。

**「有東西沒被功能區認領」維持到處紅**（同一支腳本的另一組檢查）——
那是藍圖不完整，`sync-feature-map` 修不了，必須有人去改 `AREAS`。

self-test 守兩件事：過期在三種環境（分支 / main / 本機）**都不紅**（有人把 main 紅燈加回來
就是把死結加回來，症狀是 main 卡紅而不是報錯），以及 orphan 檢查仍然無條件 `exit 1`。

## KB 的健康度：不是 gate，是 skill

**`npm run harness` 不檢查 `kb/` 的內容。** 2026-08 曾經有一支自製的 `kb-gate.mjs`（`npm run kb`），
移植 fvg 的 kb-wiki 配置時整支退掉了 —— 同一件事沒必要維護兩套。

現在 `kb/` 的健康度由 **kb-wiki skill** 負責，是**人觸發**的，不在任何 hook 上：

| 指令              | 做什麼                                                             |
| ----------------- | ------------------------------------------------------------------ |
| `/kb-wiki lint`   | 結構健康：斷鏈、孤兒頁、缺 frontmatter、未 ingest 的來源、注入標記 |
| `/kb-wiki map`    | 重建 `kb/wiki/index.md` 與各分類的 `_moc.md`                       |
| `/kb-wiki verify` | **對照程式碼的漂移稽核** —— 頁面宣稱的路徑／符號／設定是否還成立   |

規範本身在 [`kb/schema.md`](../../schema.md)。

> **main 上的 `sync-feature-map` job 刻意不涵蓋 `kb/` 的索引。** 它只重生現況表與 skill 清單
> —— `kb/wiki/index.md` 與各分類的 `_moc.md` 由 kb-wiki skill 生成，而 skill 住在使用者的
> 家目錄、不在版控裡（CI 上根本沒有它）。分工是：**生成器在 repo 裡的 → CI 自動跑；
> 生成器在人的機器上的 → 計畫席在部署窗口手動跑 `/kb-wiki map`。**

> ⚠️ **這意味著 KB 沒有任何機器把關會在 commit 時擋你。** 這是刻意的取捨：KB 的內容
> 正確性是語意判斷，確定性 gate 假裝做得到只會給人虛假的安全感。代價是**要靠人記得跑**
> `/kb-wiki verify` —— 2026-08-19 那輪在 73 頁裡修了 29 頁；2026-08-24 這輪在 14 頁 code-verifiable 的頁面裡又找出 20 多處。

### 三個刻意的範圍限制

- **這兩個 gate 不證明品質。** 它們只證明「文件宣稱存在的東西確實存在、每頁有 metadata、索引沒
  過期」。一個內容早已作廢但 `status: active` 的頁面照樣過關 —— 語意判斷是 review 與 LLM 稽核
  的活，不要讓確定性 gate 假裝它做得到。
- **`summary` 的品質沒有 gate。** 自動推導只保證「有東西」，不保證那句話有用。
- **生成區塊的比對是正規化後比對**（收斂空白與表格對齊）。PostToolUse 的 prettier 擁有這些檔案，
  用原始字串比對會讓 gate 在每次格式化後變紅、而重生成的內容又會被 prettier 改回去，
  形成無限乒乓。改動版面放過，改動內容照樣紅。

## 已知缺口

- ~~`apps/api` 沒有 `test` target~~ → 2026-08-11 補上（`vitest.config.mts` + nx target）。
  `apps/api` 的 spec 現在真的會跑，Stop gate 已涵蓋 API 改動。（**不寫支數** —— 那正是 c11 禁止的手抄清單，跑 `npx nx test api` 看現況。）
- ~~`apps/api` 從未型別檢查~~ → 2026-08-11 補上 `typecheck` target 並接進 Stop gate；
  當時累積的 19 個型別錯誤已全數清除。**typecheck 與 test 在 gate 裡分開跑** ——
  typecheck 的輸出沒有 vitest 的 `FAIL <spec>` 行，混在一起會讓基線比對把型別錯誤當成沒事放行。
- ~~`apps/web` 沒有獨立的 typecheck target~~ → 2026-09-03 補上（`ngc -p tsconfig.app.json
--noEmit`，**含模板檢查**，6 秒）。Stop gate 跑的是 `nx affected -t typecheck`，
  所以加了 target 就自動涵蓋，hook 一行沒改。
  **CI 已補上 `nx build web --configuration=production`**（放在序列最後，模板型別錯誤靠它抓），
  但 Stop gate 沒有 —— 本機收工時模板錯誤照樣過得去，要到 push 才紅。
- 專案沒有 eslint。PostToolUse hook 只跑 prettier；沒有任何 lint 層。
- ~~`nx.json` 的 `defaultBase` 指向不存在的 `dev`~~ → 2026-09-03 改成 `main`。
  Stop gate 仍然明寫 `--base=main`：**gate 的行為不該因為有人改 nx.json 而變**。
- pre-guard 是**寫入時**的螢幕，繞得過去：直接用 Bash heredoc 寫檔就不會觸發 PreToolUse
  的 Edit/Write matcher。它的價值在於攔截順手的違規，不是防惡意。
- ~~c6 只守新違規，存量沒有覆蓋~~ → 2026-08-29 補上 gate A12。**這個缺口的形狀值得記住**：
  pre-guard 只看新寫進去的那段文字（`pendingWrites` 只取 `new_string`，不然修掉違規反而會被擋），
  所以任何「只有 hook、沒有 gate」的 clause 對存量都是零覆蓋，而 enforcement 表上它看起來是
  「✅ 已接」。目前 c2 / c3 / c7 / c8 都還是這個狀態。

## 邊界記錄

條文本身不動（修憲只有專案擁有者能做），這裡記的是**條文適用到具體寫法時的解釋**，
免得每個 agent 各猜一次。

### c6：`var()` 的 fallback 不算違規

**拿 viewport 單位當值 → 違規；當 `var()` 的 fallback → 放行。**

```scss
min-height: 100vh; // ✗ 違規
max-height: calc(var(--window-height, 100dvh) * 0.55); // ✓ 放行
```

理由：c6 的立論是「這些單位在 mobile Safari 位址列伸縮與巢狀 scroll container 下行為
不可靠」，講的是 layout 值。而 `var()` 的 fallback 是「變數在這裡解不到」的那條分支 ——
它有時候**就是真正生效的值**：`--window-height` 由 `appWindowSize` 寫在 app 根節點上，
但 PrimeNG 的 dialog 走 `appendTo: overlayContainer ?? 'body'` 時會落在那個節點外面。
那種情況下換成某個 px 數字，是把「不精確」變成「一定是錯的」。

**註解不豁免** —— 註解裡出現 `100dvh` 這種字面值一樣紅燈。豁免邏輯（判斷這是不是註解）
本身會腐化，成本高於「要求註解換個講法」。

使用者 2026-08-29 裁決。強制機制：`pre-guard.rules.json` 的 c6 用 fallback-aware 的
lookbehind（`(?<!var\([^()]*)`），gate A12 **餵同一條規則給同一支 matcher**，兩層不會漂
—— 分開寫兩份 regex 的話，漂掉的方向一定是 gate 比 hook 寬。

### c8：「等裝飾器 API」的範圍

條文列的是 `@Input()` / `@Output()` / `@ViewChild()`。**「等」= 這三個 + 同類的
query API**（`@ContentChild` / `@ViewChildren` / `@ContentChildren`）—— 也就是有
functional 對應物（`input()` / `output()` / `viewChild()` / `contentChild()`）的那些。

**`@HostListener` 不在內。** 它沒有 functional 對應物，`apps/web/src/app/shared/directives/window-size.directive.ts`
目前在用，維持現狀。使用者 2026-08-29 釐清。
