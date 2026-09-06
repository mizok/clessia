#!/bin/sh
# 主機磁碟水位看門狗 —— 20 GB 警戒、10 GB 自動 prune dagger 建置快取。
#
# **這是止血不是解法。** 根因是 fvg 的 dagger engine 沒有 GC 政策
# （`/etc/dagger/engine.toml` 是空的，而 engine 在 VM 裡看到的可用空間是假的，
# 所以它的自動 GC 永遠不觸發）。見 kb/wiki/lessons/docker-disk-exhaustion.md。
#
# 為什麼是一支檔案而不是「輪到的人記得下那行指令」：
# 這支看門狗前一次是掛在某個 session 的背景任務上，**那個 session 輪替時它就死了**，
# 而 charter 裡記的是它的 PID —— 一個輪替之後必然為假的值。下一任被告知「它還在跑」，
# 實際上沒有。**壞掉的監控比沒有監控糟**，所以這支每一輪都寫一行 heartbeat：
# log 的最後一行過期了，就是它死了。沒有 heartbeat 的看門狗，死掉跟安靜長得一模一樣。
#
# 用法：
#   nohup sh tools/disk-watch.sh >/dev/null 2>&1 &
# 查它還在不在（**看 log 的時間戳，不要看 PID** —— PID 會過期，時間戳不會）：
#   tail -3 ~/Library/Logs/clessia-disk-watch.log
#
# ponytail: 固定 10 分鐘輪詢；水位從 175 GB 跌到 20 GB 至少要好幾天，不需要更密。

LOG="$HOME/Library/Logs/clessia-disk-watch.log"
WARN_GB=20
PRUNE_GB=10
INTERVAL=600

mkdir -p "$(dirname "$LOG")"

while :; do
  # df 的 4 欄是可用 KB（-k 固定單位，不受 BLOCKSIZE 影響）
  avail_gb=$(df -k / | awk 'NR==2 {print int($4/1024/1024)}')
  ts=$(date '+%Y-%m-%d %H:%M:%S')

  if [ "$avail_gb" -le "$PRUNE_GB" ]; then
    echo "$ts CRITICAL 可用 ${avail_gb}GB ≤ ${PRUNE_GB}GB —— 自動 prune dagger 快取" >>"$LOG"
    engine=$(docker ps --filter name=dagger-engine --format '{{.Names}}' 2>/dev/null | head -1)
    if [ -n "$engine" ]; then
      # 兩個參數缺一不可 —— 只給 --max-used-space 的話會印
      # 「dagql prune skip policy: no reclaim target」然後 exit 0 什麼都沒清。
      docker exec "$engine" /usr/local/bin/dagger core engine local-cache prune \
        --max-used-space 20GB --target-space 20GB >>"$LOG" 2>&1
      echo "$ts prune 結束，可用 $(df -k / | awk 'NR==2 {print int($4/1024/1024)}')GB" >>"$LOG"
    else
      echo "$ts prune 跳過：找不到 dagger-engine 容器" >>"$LOG"
    fi
  elif [ "$avail_gb" -le "$WARN_GB" ]; then
    echo "$ts WARN 可用 ${avail_gb}GB ≤ ${WARN_GB}GB" >>"$LOG"
  else
    echo "$ts ok ${avail_gb}GB" >>"$LOG"
  fi

  sleep "$INTERVAL"
done
