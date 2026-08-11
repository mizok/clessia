#!/usr/bin/env node
/**
 * UserPromptSubmit — doc router.
 * Matches the prompt against rules/doc-router.rules.json and injects pointers to the
 * relevant kb/ pages as additionalContext. Advisory only: never blocks, silent on no match.
 *
 * Why a hook and not a skill: only a hook can deterministically surface the right page on
 * *every* relevant prompt. It also keeps those pages OUT of the always-loaded context —
 * pointers cost ~0 tokens per session, the pages cost tokens only when they matter.
 */
import { readHookPayload } from '../lib/hook-io.mjs';
import { routeHints } from '../lib/rules.mjs';
import rulesDocument from '../rules/doc-router.rules.json' with { type: 'json' };

const MAX_HINTS = 8;

let hints = [];
try {
  hints = routeHints(String(readHookPayload().prompt ?? ''), rulesDocument.rules ?? []);
} catch {
  process.exit(0);
}

if (hints.length > 0) {
  const body = [
    'Clessia 相關參考（動手前先看，advisory）：',
    ...hints.slice(0, MAX_HINTS).map((hint) => `- ${hint}`),
    '(binding law 是 kb/architecture/constitution.md。)',
  ].join('\n');

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: body },
    }),
  );
}
