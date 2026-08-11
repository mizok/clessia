#!/usr/bin/env bash
# Claude adapter for the shared doc router. Advisory: never blocks, silent on no match.
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" || exit 0
exec node "$root/tools/agent-harness/hooks/doc-router.mjs"
