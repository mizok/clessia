# reviewer-merge

審核席依序合 PR 的腳本（原本住在席位的 scratchpad，換席或清掉就沒了，10-28 收進來）。
合併本身一律經 `tools/steward-merge.sh`（釘審過的 SHA、查 CI 與 mergeable）。

| 指令                   | 做什麼                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `cimg.sh <PR> <SHA> …` | 逐張：等 CI 不 pending → 紅就不合 → head 對得上才合                                                             |
| `mv.sh <PR> <SHA> …`   | 一般 PR：合一張、等 main 的 verify 綠才合下一張；沒合成或 main 紅就停                                           |
| `mig.sh <PR> <SHA> …`  | 含 schema migration 的 PR，一次一支：`ts-guard` → 合 → 凍結 → migrate waiting 印連結 → apply＋deploy 綠才下一支 |
| `ts-guard.mjs`         | migration 時間戳必須晚於 `origin/main` 最新與正式 DB 最新（#2025：並行 PR 的 A16b 互相看不到）                  |

```sh
tools/reviewer-merge/mv.sh 2042 3b2d304952961d7a764bd579166dee61136ab016 2039 483f4ad3…
NOTIFY_AGENT=labor-plan-20261008-1357 tools/reviewer-merge/mig.sh 2041 <完整SHA>
```

- SHA 一律貼**完整 40 碼**、是二讀時看的那一顆。
- **同一時間只留一支在跑**；要插隊先停掉還沒動手的那支再重排。
- 背景跑時，等待條件看前一支的輸出，不要 `pgrep -f "<自己命令列也有的字串>"`（會比對到自己）。
- `ts-guard` 的自我測試在 `tools/agent-harness/reviewer-ts-guard.test.mjs`（`npm run harness:test`）。
