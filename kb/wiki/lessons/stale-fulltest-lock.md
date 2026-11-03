---
title: 全套測試鎖：沒有人持有的鎖會一直擋著
summary: 全套測試、整組契約、conformance compare 共用一把 mkdir 目錄鎖；持有者在 mkdir 之後、掛上 trap 之前死掉，或機器重開，鎖就永遠留著。對策是鎖裡寫 pid、等的人看到 pid 已死就接手，trap 要包含 INT、TERM、HUP。
category: lessons
tags: [lessons, concurrency, lock, herdr, testing]
status: active
updated: 2026-11-03
---

# 全套測試鎖：沒有人持有的鎖會一直擋著

## 背景

機器只有 24GB。2026-10-30 計畫席規定：全套測試（`nx run-many -t test`）、整組契約、conformance `compare`
**一次只准一席跑**，先拿目錄鎖 `~/.cache/clessia-fulltest.lock`。第一版寫法：

```bash
until mkdir ~/.cache/clessia-fulltest.lock 2>/dev/null; do sleep 30; done
trap 'rmdir ~/.cache/clessia-fulltest.lock' EXIT
```

## 發生了什麼

| 時間                     | 怎麼卡住的                                                         | 擋了多久                                                  |
| ------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------- |
| 10-30 18:24 → 11-02 早上 | 機器重開（或席位斷線），持有者沒機會跑 trap                        | 到 11-02 早上才被發現、手動移除                           |
| 11-02 21:37              | 某席用 TaskStop 停掉一支**剛 mkdir、還沒執行到 `trap` 那行**的任務 | 21 分鐘（labor-20261102-2035 交接 charter 第四節第 5 點） |

## 為什麼表面看不出來

- 等鎖的人看到的只是「`until mkdir` 一直在 sleep」—— 跟「有人正在跑全套」**長得一模一樣**。
  目錄鎖本身不記錄是誰拿的，沒辦法分辨「有人在用」跟「沒人在用但沒收」。
- `trap … EXIT` 看起來涵蓋了所有結束方式，但：
  - **mkdir 跟 trap 之間有一段空窗**，在那裡被砍就沒有 trap 可以跑；
  - 被 SIGKILL、機器斷電或重開時，任何 trap 都不會跑；
  - 只掛 `EXIT` 時，有些 shell 被 INT／TERM／HUP 中斷不一定會走到 EXIT。

## 以後怎麼做

鎖裡寫持有者的 pid，等的人看到 pid 已經不在就接手（計畫席 11-02 22:0x 公告的寫法）：

```bash
L=~/.cache/clessia-fulltest.lock
until mkdir $L 2>/dev/null || { p=$(cat $L/pid 2>/dev/null); [ -n "$p" ] && ! kill -0 $p 2>/dev/null && rm -f $L/pid && rmdir $L && mkdir $L; }; do sleep 30; done
echo $$ > $L/pid
trap 'rm -f $L/pid; rmdir $L' EXIT INT TERM HUP
```

- **pid 寫進鎖裡**：等的人用 `kill -0` 判斷持有者還在不在，不在就接手 —— 機器重開後的殘鎖會自己解開。
- **trap 要包含 `INT TERM HUP`**，不只 `EXIT`。
- 清鎖用「只刪 pid 檔再 `rmdir`」，**不要用 `rm -rf`**（會被權限規則擋，也容易刪錯）；指令放在頂層，
  不要包進 `bash -c`（安全檢查看不到裡面的刪除，會整條拒絕）。
- 剩下的空窗（mkdir 成功、pid 還沒寫進去就被砍）：pid 檔不存在時等的人不會接手，仍要人工確認後清。
  這個窗口只有一行指令那麼長，已經比原本小很多；真的遇到時先確認沒有席位在跑再清。
- 單檔 spec（`--include`）、單支契約、typecheck、harness 不用拿鎖。

## See Also

- [[lessons/herdr-team-orchestration]]
- [[lessons/silent-tool-failures]]
