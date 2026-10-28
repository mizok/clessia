#!/usr/bin/env bash
# 用法：tools/reviewer-merge/cimg.sh <PR> <審過的完整 SHA> ...
# 逐張：等 CI 不 pending → 紅就不合 → head 對得上才用 steward-merge.sh 合（mergeable 還在算就等）。
cd "$(git rev-parse --show-toplevel)" || exit 1
while [ $# -ge 2 ]; do
  p=$1 S=$2; shift 2
  until st=$(gh pr checks "$p" --json bucket -q '[.[].bucket]|unique|join(",")' 2>/dev/null) && [ -n "$st" ] && ! [[ "$st" == *pending* ]]; do sleep 30; done
  [[ "$st" == *fail* ]] && { echo "#$p CI 紅（${st}），不合"; continue; }
  for _ in 1 2 3 4 5 6; do
    h=$(gh pr view "$p" --json headRefOid -q .headRefOid)
    [ "$h" = "$S" ] || { echo "#$p head 變了 ${h}"; break; }
    out=$(tools/steward-merge.sh "$p" "$S" 2>&1)
    [ "$(gh pr view "$p" --json state -q .state)" = MERGED ] && break
    echo "$out" | grep -q "還在算" || { echo "#$p 合不成"; echo "$out" | tail -4; break; }
    sleep 40
  done
  gh pr view "$p" --json state,headRefOid,mergeCommit -q '"#'"$p"' \(.state) head=\(.headRefOid[0:8]) merge=\(.mergeCommit.oid//""|.[0:8])"'
done
