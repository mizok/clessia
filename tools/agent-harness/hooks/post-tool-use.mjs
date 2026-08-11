#!/usr/bin/env node
/**
 * PostToolUse — per-edit formatting.
 * Runs prettier on the file that was just written. ALWAYS exits 0: formatting must never
 * block an edit. The repo has no eslint, so prettier is the whole story here — if eslint
 * lands later, run it first (auto-fixes) and keep prettier last (formatting authority).
 */
import { execFileSync } from 'node:child_process';

import { readHookPayload, toRepoPath } from '../lib/hook-io.mjs';

const FORMATTABLE = /\.(ts|html|scss|css|json|md|mjs)$/;

const payload = readHookPayload();
const root = process.env.CLAUDE_PROJECT_DIR ?? payload.cwd ?? process.cwd();
const filePath = toRepoPath(payload.tool_input?.file_path, root);

if (filePath && FORMATTABLE.test(filePath) && !filePath.startsWith('node_modules/')) {
  try {
    execFileSync('npx', ['prettier', '--write', '--ignore-unknown', filePath], {
      cwd: root,
      stdio: 'ignore',
      timeout: 20_000,
    });
  } catch {
    // non-blocking by design
  }
}

process.exit(0);
