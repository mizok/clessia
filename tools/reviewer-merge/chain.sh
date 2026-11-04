#!/usr/bin/env bash
# 用法：NOTIFY_AGENT=<計畫席> bash tools/reviewer-merge/chain.sh <PR> <完整SHA> ...
# 每張走一次 mv.sh（合＋等 main verify），**以 GitHub state＝MERGED 且 mv.sh exit 0 為準**才回報；否則回報並停。
# 一律用 bash 跑：zsh 下 `set -- $pair` 不分詞，mv.sh 收不到參數會 exit 0，舊接力腳本因此送出三則假的「已合」（11-04）。
# 中文緊接在變數後面要寫 ${var}：bash 在非 UTF-8 locale 會把多位元組字元吃進變數名（11-04 `$st、` 讓通知整則沒送出）。
cd "$(git rev-parse --show-toplevel)" || exit 1
D=$(dirname "$0")
P=${NOTIFY_AGENT:?要設 NOTIFY_AGENT（計畫席的 herdr agent 名）}
ME=${REVIEWER_NAME:-reviewer}
[ $# -ge 2 ] || { echo "沒有參數"; exit 1; }
while [ $# -ge 2 ]; do
  p=$1 s=$2; shift 2
  [ ${#s} -eq 40 ] || { echo "SHA 不是 40 碼：${s}"; exit 1; }
  bash "$D/mv.sh" "$p" "$s"; rc=$?
  st=$(gh pr view "$p" --json state -q .state)
  if [ "${rc}" -eq 0 ] && [ "${st}" = MERGED ]; then
    herdr agent prompt "$P" "[${ME}] #${p} 已合（釘 ${s:0:8}），main verify 綠。" >/dev/null
  else
    herdr agent prompt "$P" "[${ME}] #${p} state=${st}、mv.sh rc=${rc}，鏈停，我來查。" >/dev/null
    exit 1
  fi
done
echo "鏈完成"
