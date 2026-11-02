#!/usr/bin/env bash
# 用法：tools/reviewer-merge/mv.sh <PR> <審過的完整 SHA> ...
# 一張合完等 main 的 verify 綠才合下一張（各自綠≠合起來綠）；沒合成或 main 紅就停。
# **同一時間只留一支在跑**（10-20 #1864：兩支接力同時合）。
cd "$(git rev-parse --show-toplevel)" || exit 1
D=$(dirname "$0")
while [ $# -ge 2 ]; do
  p=$1 S=$2; shift 2
  out=$(bash "$D/cimg.sh" "$p" "$S"); echo "$out"
  # 合沒合以 GitHub 的 state 為準，不靠 cimg 的輸出字樣（11-02）
  [ "$(gh pr view "$p" --json state -q .state)" = MERGED ] || { echo "#$p 沒合成，停"; exit 1; }
  m=$(gh pr view "$p" --json mergeCommit -q .mergeCommit.oid)
  until v=$(gh run list --branch main -L 30 --json workflowName,status,conclusion,headSha -q "[.[]|select(.workflowName==\"verify\" and (.headSha|startswith(\"${m}\")))][0]|.status+\" \"+.conclusion") && [ "${v%% *}" = completed ]; do sleep 30; done
  echo "verify ${m} → ${v}"
  [ "$v" = "completed success" ] || { echo "main 紅，停"; exit 1; }
done
