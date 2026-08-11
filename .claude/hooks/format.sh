#!/usr/bin/env bash
# Claude adapter for the shared per-edit formatter. Always exits 0 — never blocks an edit.
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" || exit 0
exec node "$root/tools/agent-harness/hooks/post-tool-use.mjs"
