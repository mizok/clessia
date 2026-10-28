#!/usr/bin/env bash
# 用法：tools/reviewer-merge/mig.sh <PR> <審過的完整 SHA> ...   （含 schema migration 的 PR，一次一支）
# 每支：ts-guard（時間戳晚於 main 與正式 DB 最新）→ 合 → 凍結 → migrate 停在 waiting 時印連結（＋送計畫席）
#      → 等 apply 與 deploy 都綠才解凍、下一支。任何一步不綠就停。
# 送訊息：設了 NOTIFY_AGENT（例：labor-plan-20261008-1357）才用 herdr 背景送；送不到不擋合併。
# 注意：bash 字串裡變數後面直接接全形字會被吃成變數名，一律寫 ${var}。
cd "$(git rev-parse --show-toplevel)" || exit 1
D=$(dirname "$0")
notify() {
  echo "$1"
  [ -n "${NOTIFY_AGENT:-}" ] || return 0
  ( for _ in $(seq 1 60); do herdr agent prompt "$NOTIFY_AGENT" "$1" 2>&1 | grep -q agent_prompted && exit 0; sleep 60; done ) &
}
prod_latest() {
  local run job
  run=$(gh run list --workflow migrate.yml -L 10 --json databaseId,conclusion -q '[.[]|select(.conclusion=="success")][0].databaseId')
  job=$(gh run view "$run" --json jobs -q '.jobs[]|select(.name=="plan")|.databaseId')
  gh api "repos/{owner}/{repo}/actions/jobs/${job}/logs" 2>/dev/null | grep -m1 'REMOTE_VERSIONS:' | grep -oE '[0-9]{14}' | sort | tail -1
}
while [ $# -ge 2 ]; do
  p=$1 S=$2; shift 2
  v=$(gh run list --branch main --workflow verify.yml -L 1 --json status,conclusion -q '.[0]|.status+" "+.conclusion')
  [ "$v" = "completed success" ] || { echo "main 不綠（${v}），停在 #${p} 之前"; exit 1; }
  git fetch -q origin
  main_max=$(git ls-tree --name-only origin/main supabase/migrations/ | sed 's#.*/##' | cut -c1-14 | sort | tail -1)
  prod_max=$(prod_latest)
  [ -n "$main_max" ] && [ -n "$prod_max" ] || { echo "拿不到 main／正式 DB 最新的時間戳，停"; exit 1; }
  # shellcheck disable=SC2046
  node "$D/ts-guard.mjs" --main "$main_max" --prod "$prod_max" $(gh pr view "$p" --json files -q '.files[].path') \
    || { notify "審核席：#${p} 的 migration 時間戳沒過 ts-guard，停下不合。"; exit 1; }
  out=$(bash "$D/cimg.sh" "$p" "$S"); echo "$out"
  m=$(echo "$out" | grep -o 'merge=[0-9a-f]*' | cut -d= -f2)
  [ -n "$m" ] || { echo "#${p} 沒合成，停"; exit 1; }
  echo "#${p} 已合 ${m} → 凍結"
  until r=$(gh run list --workflow migrate.yml -L 5 --json databaseId,headSha,status,url -q "[.[]|select(.headSha|startswith(\"${m}\"))][0]|\"\(.databaseId) \(.status) \(.url)\"") \
        && [ -n "$r" ] && [ "$r" != "null" ] && { [ "$(echo "$r" | cut -d' ' -f2)" = waiting ] || [ "$(echo "$r" | cut -d' ' -f2)" = completed ]; }; do sleep 30; done
  id=${r%% *}; url=${r##* }
  notify "審核席：#${p} 已合（${m}），migrate 停在 waiting，請 Approve：${url}"
  until c=$(gh run view "$id" --json status,conclusion -q '.status+" "+.conclusion') && [ "${c%% *}" = completed ]; do sleep 30; done
  [ "$c" = "completed success" ] || { notify "審核席：#${p} 的 migrate ${id} 結果 ${c}，停下不合後面的。"; exit 1; }
  until d=$(gh run list --workflow deploy.yml --branch main -L 10 --json headSha,status,conclusion -q "[.[]|select(.headSha|startswith(\"${m}\"))][0]|.status+\" \"+.conclusion") && [ "${d%% *}" = completed ]; do sleep 30; done
  [ "$d" = "completed success" ] || { echo "deploy ${m} → ${d}，停"; exit 1; }
  echo "#${p} 解凍（migrate＋deploy 綠）"
done
