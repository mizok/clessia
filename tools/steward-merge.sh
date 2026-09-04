#!/usr/bin/env bash
# review-steward 的合併流程,原子化成一支指令。
#
# 為什麼存在:這些檢查原本散在 charter 裡靠人記得執行,而 2026-09-04 已經證明
# 反射會在忙的時候失效 —— 合完 #268 反射性刪分支,害疊在上面的 #276 被 GitHub
# 自動關閉。charter 的「原子化讓紀律不必存在」適用於這裡。
#
#   tools/steward-merge.sh <PR 編號> [--dry-run]
#
# 任何一步不符就停,不繼續。每一步都印證據,回報可以直接引用。
set -euo pipefail

REPO="${STEWARD_REPO:-mizok/clessia}"
PR="${1:?用法: $0 <PR 編號> [--dry-run]}"
DRY=""
[ "${2:-}" = "--dry-run" ] && DRY=1

q() { gh pr view "$PR" -R "$REPO" --json "$1" -q ".$1"; }
die() { echo "✗ $*" >&2; exit 1; }

# ── 1. state 必須是 OPEN ────────────────────────────────────────────────
# mergeable/mergeStateStatus 在已關閉的 PR 上永遠是 UNKNOWN 且不會再算,
# 所以「有沒有處理完」只能看 state。
state=$(q state)
echo "state          = $state"
[ "$state" = "OPEN" ] || die "PR 不是 OPEN(是 $state)—— 已合併或已關閉的 PR 不該再走這支"

# ── 2. CI 必須有 conclusion 且為 SUCCESS ────────────────────────────────
# 空值不等於終態:statusCheckRollup 在 check 還沒註冊時是空陣列。
verify=$(gh pr view "$PR" -R "$REPO" --json statusCheckRollup \
  -q '[.statusCheckRollup[] | select(.name=="verify") | .conclusion // ""] | join("")')
echo "verify         = ${verify:-（還沒有 conclusion）}"
[ -n "$verify" ] || die "CI 還沒跑完 —— 空值不是綠燈"
[ "$verify" = "SUCCESS" ] || die "CI 不是 SUCCESS(是 $verify)"

# ── 3. mergeable 必須已算完且乾淨 ───────────────────────────────────────
mss=$(q mergeStateStatus); mrg=$(q mergeable)
echo "mergeable      = $mss/$mrg"
[ "$mss" != "UNKNOWN" ] || die "GitHub 還在算 mergeable —— 等 30~40 秒再試"
[ "$mss" = "CLEAN" ] && [ "$mrg" = "MERGEABLE" ] || die "狀態非 CLEAN/MERGEABLE"

# ── 4. 鎖住驗過的 SHA ───────────────────────────────────────────────────
# 查證與合併之間的空窗塞得下一次 force push,交給平台原子化。
head=$(q headRefOid); branch=$(q headRefName)
echo "head           = $head"
echo "branch         = $branch"

# ── 5. 先查有沒有 PR 疊在這個分支上(決定事後刪不刪)────────────────────
# GitHub 會把 base 分支消失的 PR 自動關閉。
dependents=$(gh pr list -R "$REPO" --state open --base "$branch" --json number -q '.[].number' | tr '\n' ' ')
echo "疊在它上面的   = ${dependents:-（無）}"

if [ -n "$DRY" ]; then
  echo "— dry-run,不執行合併 —"
  [ -n "$dependents" ] && echo "  註:合併後**不會**刪分支,要先把 #${dependents% } 的 base 轉成 main"
  exit 0
fi

# ── 6. 合併 ─────────────────────────────────────────────────────────────
gh pr merge "$PR" -R "$REPO" --squash --match-head-commit "$head"
sleep 5

# ── 7. 確認真的合了才可能刪分支 ─────────────────────────────────────────
# gh pr merge 失敗不會讓串起來的後續指令停下來(2026-09-04 誤刪 #215 分支的成因)。
after=$(q state)
echo "合併後 state   = $after"
[ "$after" = "MERGED" ] || die "沒有合併成功,分支保留不動"

# ── 8. 條件刪除 ─────────────────────────────────────────────────────────
if [ -n "$dependents" ]; then
  echo "⚠ 不刪 $branch —— #${dependents% } 疊在它上面,先把它們的 base 轉成 main:"
  for d in $dependents; do echo "    gh pr edit $d -R $REPO --base main"; done
else
  git push origin --delete "$branch"
  echo "✓ 已刪 $branch"
fi
