#!/usr/bin/env bash
# Claude adapter for the shared constitution guard. Logic lives in tools/agent-harness/.
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" || exit 0
exec node "$root/tools/agent-harness/hooks/pre-tool-use.mjs"
