#!/usr/bin/env node
/**
 * PreToolUse — constitution guard.
 * Screens a pending write against the deterministic clauses in rules/pre-guard.rules.json
 * and blocks it (exit 2) with the clause id + fix direction, shifting feedback from CI to
 * the edit itself. Fails open: an unparsable payload or a broken rule lets the write through.
 */
import { execFileSync } from 'node:child_process';

import { pendingWrites, readHookPayload } from '../lib/hook-io.mjs';
import { matchWriteRules } from '../lib/rules.mjs';
import rulesDocument from '../rules/pre-guard.rules.json' with { type: 'json' };

const payload = readHookPayload();
const root = process.env.CLAUDE_PROJECT_DIR ?? payload.cwd ?? process.cwd();

function isTracked(filePath) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', filePath], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

let violations = [];
try {
  violations = matchWriteRules(pendingWrites(payload, root), rulesDocument.rules ?? []).filter(
    (violation) => !violation.whenTracked || isTracked(violation.filePath),
  );
} catch {
  process.exit(0); // a broken guard must never block editing
}

if (violations.length > 0) {
  const lines = violations.map(({ id, filePath, message }) => `- ${id} (${filePath})：${message}`);
  console.error(
    [
      '憲法 guard — 這次寫入被擋下：',
      ...lines,
      '',
      '法條全文：kb/architecture/constitution.md',
      '誤判？調 tools/agent-harness/rules/pre-guard.rules.json 的 regex 即可，不用改程式碼。',
    ].join('\n'),
  );
  process.exit(2);
}
