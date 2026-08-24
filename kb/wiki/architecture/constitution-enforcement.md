---
title: 憲法強制機制索引
summary: 每條 clause 用什麼機制守、在哪一層擋、目前接上了沒有。改機制不算修法。
category: architecture
status: active
updated: 2026-08-11
tags: [architecture, constitution-enforcement]
---

# 憲法強制機制索引

> [[architecture/constitution|`constitution.md`]] 說**什麼構成違反**；本檔說**違反會在哪裡被擋下來**。
> 兩者刻意分家：調一條 regex、換一個 gate、把 Semantic 條款接上 LLM 稽核，
> **都不需要修法**。

## 檢查階梯

由左到右，越右邊越權威、越難繞過：

```
編輯當下              收工當下                 人工 review
PreToolUse guard  →   Stop verify gate    →    程式碼審查
（exit 2 擋寫入）      （exit 2 擋收工）         （Semantic 條款）
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
- **Harness gate**（`npm run harness`）—— 文件與現實是否同步，見下方 A1–A10。

## 條款 → 機制

| Clause                     | 分類          | 機制                                                                         | 狀態                                                                                                                        |
| -------------------------- | ------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| c1 授權在 API 層           | Semantic      | harness gate A7（每支 route 掛載必須宣告角色）+ 人工 review                  | ⚠️ 部分：准入已機器化，資料範圍靠 review                                                                                    |
| c2 `ba_*` 不得寫入         | Deterministic | pre-guard regex（只擋 insert/update/upsert/delete，讀取放行）                | ✅ 已接                                                                                                                     |
| c3 已提交 migration 不可改 | Deterministic | pre-guard + `whenTracked`（git 已追蹤才擋，新建不受影響）                    | ✅ 已接                                                                                                                     |
| c4 migration 檔名          | Deterministic | 由 `supabase migration new` 保證                                             | 依賴工具，未另外 gate                                                                                                       |
| c5 feature 不互相 import   | Semantic      | 人工 review                                                                  | ⚠️ 未機器化 —— 需要跨「路徑擷取的 feature 名」與「內容」的反向參照，目前的靜態 regex 引擎做不到。要接的話得寫一支獨立 check |
| c6 禁 viewport 單位        | Deterministic | pre-guard regex（`.scss`）                                                   | ✅ 已接                                                                                                                     |
| c7 原生 control flow       | Deterministic | pre-guard regex（`.html`）                                                   | ✅ 已接                                                                                                                     |
| c8 functional API          | Deterministic | pre-guard regex（`apps/web/**`，排除 `.spec.ts`）                            | ✅ 已接                                                                                                                     |
| c9 `kb/` 唯一              | Deterministic | pre-guard（路徑 `^docs?/`，`doc/` 與 `docs/` 都擋）+ harness gate A3         | ✅ 雙重                                                                                                                     |
| c10 `AGENTS.md` 單一真相   | Deterministic | harness gate A2（必須含 `@AGENTS.md`、行數上限 60）                          | ✅ 已接                                                                                                                     |
| c11 不手抄腐化清單         | Semantic      | A1（skill 清單）+ `feature-map.mjs`（roadmap 現況表）已機器化；其餘靠 review | ⚠️ 部分                                                                                                                     |
| c12 客戶可脫離自架         | Semantic      | harness gate A10（禁用雲端專屬服務 import）+ 人工 review                     | ⚠️ 部分：專屬服務已機器化，多租戶與 kill switch 靠 review                                                                   |

## Harness gate 檢查項

`npm run harness` 跑**兩支**腳本，兩支都是 `--check`（預設，過期 exit 1）／`--write`（重生成）雙模式：

| 腳本                | 守什麼                                                       |
| ------------------- | ------------------------------------------------------------ |
| `check-harness.mjs` | 下表的 A1–A10                                                |
| `feature-map.mjs`   | `kb/wiki/roadmap.md` 的**功能區現況表**自動生成且同步（c11） |

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
- `apps/web` 仍然沒有獨立的 typecheck target（型別檢查目前只在 build 時發生）。
- 專案沒有 eslint。PostToolUse hook 只跑 prettier；沒有任何 lint 層。
- `nx.json` 的 `defaultBase` 是 `dev`，但該 branch 不存在 → 所有 `nx affected` 都得手動帶
  `--base=main`（Stop gate 已經這樣寫死）。
- pre-guard 是**寫入時**的螢幕，繞得過去：直接用 Bash heredoc 寫檔就不會觸發 PreToolUse
  的 Edit/Write matcher。它的價值在於攔截順手的違規，不是防惡意。
