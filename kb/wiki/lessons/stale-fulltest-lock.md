---
title: 全套測試鎖：沒有人持有的鎖會一直擋著
summary: 全套測試、整組契約、conformance compare 共用一把 mkdir 目錄鎖。持有者死掉或機器重開鎖會留著；但「等的人看 pid 已死就接手」的範本在 pid 檔是文字時會把活鎖搶走（11-13 兩次）。現行規則：pid 檔只寫純數字、等的人只排隊不清鎖、過期鎖由計畫席清，trap 含 INT、TERM、HUP。
category: lessons
tags: [lessons, concurrency, lock, herdr, testing]
status: active
updated: 2026-11-13
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

鎖裡寫持有者的 pid，**等的人只排隊，不自己判過期**（11-13 改）：

```bash
L=~/.cache/clessia-fulltest.lock
until mkdir $L 2>/dev/null; do sleep 30; done
echo $$ > $L/pid                 # 只寫純數字
echo "<席名> <用途>" > $L/who     # 給人看的寫這裡，不要寫進 pid
trap 'rm -f $L/pid $L/who; rmdir $L' EXIT INT TERM HUP
```

- **pid 檔只寫純數字 `$$`**，席名／用途另寫 `who` 檔。11-02 到 11-13 用的範本有一條「`kill -0 $pid` 失敗就 rm pid、rmdir、自己 mkdir」的接手分支；
  11-13 審核席把「labor-reviewer-… #2511/#2512」寫進 pid 檔，三個生產席的等鎖迴圈都把 `kill -0 <文字>` 的失敗讀成「持有者已死」，
  把持鎖中的鎖搶走兩次 —— 兩席各自跑全套，正是這把鎖要防的事。
- **等鎖的人不清鎖**。等超過 30 分鐘就問計畫席；過期鎖（機器重開、席位斷線）由計畫席確認 `[[ $p =~ ^[0-9]+$ ]] && ! kill -0 $p` 後才清。
  自動接手省下的那幾分鐘，抵不過兩席並跑全套的假紅與 OOM。
- **trap 要包含 `INT TERM HUP`**，不只 `EXIT`；trap 只刪自己寫的 pid／who 與目錄。
- 清鎖用「刪 pid、who 檔再 `rmdir`」，**不要用 `rm -rf`**（會被權限規則擋，也容易刪錯）；指令放在頂層，
  不要包進 `bash -c`（安全檢查看不到裡面的刪除，會整條拒絕）。
- 單檔 spec（`--include`）、單支契約、typecheck、harness 不用拿鎖。
- **鎖包在 `( … )` 子殼裡時不要寫 `$BASHPID`**：macOS 的 `/bin/bash` 是 3.2，沒有這個變數，pid 檔會是空的。見 [[lessons/bashpid-empty-on-macos-bash]]。

## See Also

- [[lessons/bashpid-empty-on-macos-bash]]
- [[lessons/herdr-team-orchestration]]
- [[lessons/silent-tool-failures]]
