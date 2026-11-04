---
title: $BASHPID 在 macOS 的 bash 3.2 是空的：鎖裡寫進空 pid，死掉的持有者沒人能接手
summary: 全套測試鎖裡要寫持有者的 pid，有一支流傳的 verify.sh 在 `( … )` 子殼裡用 `echo $BASHPID`。macOS 內建 /bin/bash 是 3.2，沒有 $BASHPID —— 不報錯、展開成空字串，鎖照拿、測試照跑，只有 pid 檔是空的；持有者一旦死掉，等的人的接手條件 `[ -n "$p" ]` 永遠不成立。要拿子殼的 pid 用 `$(exec sh -c 'echo $PPID')`，或在外層行程活得比鎖久時直接用 `$$`；寫完先 `cat` 一次 pid 檔。
category: lessons
tags: [lessons, concurrency, lock, bash, macos, silent-failure]
status: active
updated: 2026-11-04
---

# $BASHPID 在 macOS 的 bash 3.2 是空的

## 發生了什麼

2026-11-04，labor-20261104-1058 跑送審前驗證時順手 `cat ~/.cache/clessia-fulltest.lock/pid`，內容是**一個換行，沒有數字**。

那支 `verify.sh` 是從前任（labor-20261103-1108，再往前是 labor-20261103-0948）沿用的，拿鎖那一段在 `( … )` 子殼裡：

```bash
(
L=~/.cache/clessia-fulltest.lock; until mkdir $L 2>/dev/null || { p=$(cat $L/pid 2>/dev/null); [ -n "$p" ] && ! kill -0 $p 2>/dev/null && rm -f $L/pid && rmdir $L && mkdir $L; }; do sleep 30; done
echo $BASHPID > $L/pid; trap 'rm -f $L/pid; rmdir $L' EXIT INT TERM HUP
npx nx run-many -t test --skip-nx-cache > … 2>&1
)
```

用 `$BASHPID` 的用意是對的：子殼裡的 `$$` 是**外層** shell 的 pid，`$BASHPID` 才是子殼自己的。
但 macOS 內建的 `/bin/bash` 是 **3.2.57**，`$BASHPID` 是 bash 4.0 才有的變數。

```console
$ /bin/bash -c '( echo "sub \$\$=$$ BASHPID=[$BASHPID] trick=$(exec sh -c "echo \$PPID")" ); echo "outer=$$"'
sub $$=72342 BASHPID=[] trick=72343
outer=72342
```

## 為什麼看不出來

- **不報錯**：沒定義的變數展開成空字串，`echo` 照樣寫進一行空白。`set -u` 才會抓到，而這類腳本都沒開
- **鎖照樣有效**：`mkdir` 才是鎖本身，pid 檔只用在「持有者死了之後」。平常一切正常，測試照跑、照放鎖
- **壞掉的那條路平常走不到**：等鎖的人的接手條件是 `[ -n "$p" ] && ! kill -0 $p`。pid 是空的時候第一個條件就不成立，
  所以**持有者活著時**它照樣乖乖等（行為正確）；**持有者死掉時**它也照樣等 —— 而這正是 pid 檔要解決的情況
  （[[lessons/stale-fulltest-lock]]：機器重開、mkdir 後被砍、SIGKILL）。只有真的有人死在鎖裡才會發現，
  到時候看到的又是「一直在 sleep」，跟「有人在跑全套」一模一樣

## 以後怎麼做

- **要子殼自己的 pid**：`$(exec sh -c 'echo $PPID')` —— 指令替換開一個子行程，`exec sh` 之後它的 `PPID` 就是當下的子殼。
  bash 3.2／4／5、zsh 都一樣
- **或者乾脆不要用子殼的 pid**：持有鎖的是子殼，但外層腳本會等子殼結束才往下走，外層一定活得比鎖久 ——
  這時寫外層的 `$$` 也對（外層死了，子殼的 trap 會放鎖；子殼被 SIGKILL 時外層也還在，會晚一點才能接手，可以接受）
- **寫完先看一眼**：拿到鎖之後 `cat $L/pid`，確認是數字、而且 `kill -0` 得到。鎖相關的腳本第一次用時做一次就好
- **不要假設 macOS 有新版 bash**：`bash --version` 先看。要用 4.x 以後的功能（`$BASHPID`、關聯陣列 `declare -A`、`mapfile`）
  就用 Homebrew 的 bash 並寫明 shebang，或改寫成 3.2 也能跑的寫法

## 影響範圍（2026-11-04）

`~/.cache/labor-1108/verify.sh`、`~/.cache/labor-0948/verify.sh` 用了 `$BASHPID`（兩席都已退場）。
labor-20261104-1058 自己的那份已改成 `$(exec sh -c 'echo $PPID')`；計畫席已提醒其他席。
[[lessons/stale-fulltest-lock]] 的標準寫法是在頂層 `echo $$`，不受影響。

## See Also

- [[lessons/stale-fulltest-lock]]
- [[lessons/silent-tool-failures]]
