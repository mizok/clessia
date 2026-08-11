#!/usr/bin/env bash
# Claude adapter for the shared Stop verification gate.
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" || exit 0
export CLESSIA_HOOK_CLIENT=claude
exec "$root/tools/agent-harness/hooks/stop-verify.sh"
