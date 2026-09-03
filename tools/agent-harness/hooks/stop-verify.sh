#!/usr/bin/env bash
# Stop — verification gate.
# If the working tree changed this turn, run the deterministic gates before the agent is
# allowed to end its turn. Red → exit 2, and stderr becomes the agent's next instruction.
#
# Pass-throughs, all deliberate:
#   - stop_hook_active   anti-live-lock guard (mandatory); at most one forced fix round.
#   - clean tree         pure Q&A turns are never gated.
#   - already committed  work committed mid-turn leaves a clean tree and passes ungated.
set -uo pipefail

# hooks/ → agent-harness/ → tools/ → repo root
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$root" || exit 0

payload=$(cat)
case "$payload" in *'"stop_hook_active":true'*) exit 0 ;; esac

[ -z "$(git status --porcelain)" ] && exit 0

fail() {
  echo "$1" >&2
  echo "" >&2
  echo "收工前請先修好。要跳過這一輪，把 CLESSIA_STOP_GATE=0 帶進環境。" >&2
  exit 2
}

[ "${CLESSIA_STOP_GATE:-1}" = "0" ] && exit 0

if ! out=$(node tools/agent-harness/check-harness.mjs 2>&1); then
  fail "✖ harness gate 紅燈：
$out"
fi

# --base is passed explicitly even though nx.json's defaultBase is now `main`: a gate should not
# change behaviour because someone edits nx.json. Belt and braces, not a workaround.
#
# typecheck 必須跟 test 分開跑：它的輸出沒有 vitest 的 `FAIL <spec>` 行，若混進同一條管線交給
# test-gate 判定，基線比對會找不到任何失敗的 spec，於是把型別錯誤當成「沒事」放行。
if ! type_out=$(npx nx affected -t typecheck --base=main 2>&1); then
  fail "✖ typecheck 紅燈：
$(printf '%s' "$type_out" | grep -E 'error TS' | head -20)"
fi

# 測試結果交給基線閘門判定：只有「這一輪新弄壞的」才擋收工，既有紅燈不罰無關的工作。
test_out=$(npx nx affected -t test --base=main 2>&1)
if ! verdict=$(printf '%s' "$test_out" | node tools/agent-harness/test-gate.mjs 2>&1); then
  fail "$verdict

（完整輸出跑 npx nx affected -t test --base=main）"
fi
[ -n "$verdict" ] && echo "$verdict" >&2

exit 0
