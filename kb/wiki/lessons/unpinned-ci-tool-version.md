---
title: CI 工具用 version latest，上游一升版 main 就紅
summary: verify.yml 的 supabase/setup-cli 用 version latest，Supabase CLI 3.0.0 拒收 config.toml 的 [inbucket]，main 的 verify 紅、deploy 被 skip，而 migrate.yml 早就釘在 2.119.0（#2158）；對策是三處 setup-cli 釘同一個版本變數，加 harness 檢查。
category: lessons
tags: [lessons, ci, supabase, version-pinning, deploy]
status: active
updated: 2026-11-03
---

# CI 工具用 version latest，上游一升版 main 就紅

## 發生了什麼

2026-11-02：main 的 `verify` 紅在 `api-contract`，`deploy` 因此被 skip —— **正式站從 #2156 起沒有再部署**。

根因（#2158）：`.github/workflows/verify.yml` 的 `supabase/setup-cli@v1` 寫 `version: latest`。
Supabase CLI 出了 3.0.0，它拒絕 `supabase/config.toml` 裡的 `[inbucket]`：

> `[inbucket] … is no longer supported. Use [local_smtp] instead.` — #2158 PR 內文

同一個 repo 的 `migrate.yml`（對正式 DB 套 migration）**早就釘在 2.119.0**。所以在這之前，
CI 驗證用的 CLI 跟正式 DB 實際套 migration 用的 CLI，本來就不是同一版，只是剛好沒出事。

修法（#2158）：`[inbucket]` 改名 `[local_smtp]`（2.119.0 也認得，原始碼與實測都確認過）；`verify.yml` 兩處、`migrate.yml`
一處的 setup-cli 都改用 workflow 的 `SUPABASE_CLI_VERSION`，值都是 `2.119.0`；harness 加 `supabase-cli-pin` 檢查。

## 為什麼表面看不出來

- **沒有任何一個 commit 改了相關的東西**。前一天綠、今天紅，觸發點在 repo 外面（上游發版），
  看 git log 找不到兇手。第一個中彈的 PR 跟 CI 設定毫無關係。
- `latest` 讀起來像「最新、最好」，實際意思是「每次跑的版本可能不一樣」。
- 兩支 workflow 一支釘版、一支 latest，**看單一支檔案都合理**；要把兩支並排看才看得出「驗證的不是正式用的那一版」。
- 本機的 `npx supabase` 也可能是另一版（這次本機是 3.0.0），本機跑得過不代表 CI 跑得過，反過來也一樣。

## 以後怎麼做

- **CI 裡的工具一律釘確切版本**（`x.y.z`），不用 `latest`、也不用只釘大版號。
- **同一個工具在多支 workflow 出現時，用同一個變數**，讓「驗證用的版本＝正式用的版本」由結構保證。
  Supabase CLI 現在是三處 setup-cli 都讀 `SUPABASE_CLI_VERSION`。
- **用 gate 守**：harness 的 `supabase-cli-pin`（`tools/agent-harness/lib/supabase-cli-pin.mjs`）檢查每個 setup-cli
  都用這個變數、值是 `x.y.z`、各 workflow 同值。改回 `latest` 的突變會紅。
- 升版是一張刻意的 PR：改變數、跑一次 CI，跟其他改動分開。
- main 突然紅、而最近的 commit 都跟它無關時，先懷疑「外部東西換版了」：CI log 裡印出來的工具版本跟上一次綠的那輪比一下。

## See Also

- [[lessons/local-green-is-not-repo-green]]
- [[architecture/deploying]]
