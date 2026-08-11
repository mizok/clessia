import { readFileSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';

/** Hook payloads arrive as JSON on stdin. Unparsable input yields {} — hooks must fail open. */
export function readHookPayload() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

/**
 * Repo-relative, forward-slashed path. A `.worktrees/<name>/` prefix is stripped so that
 * path anchors like `^supabase/` still match edits made into a worktree from the main checkout.
 */
export function toRepoPath(filePath, root) {
  if (!filePath) return '';
  const rel = isAbsolute(filePath) ? relative(root, filePath) : filePath;
  return rel.split('\\').join('/').replace(/^\.worktrees\/[^/]+\//, '');
}

/**
 * Pending writes as `{ filePath, text }`.
 *
 * `text` is ONLY the newly written content (Write.content / Edit.new_string) — never the
 * untouched remainder of the file. That is what makes a `forbid` rule mean "no NEW violations"
 * instead of "this file may never be edited again", which matters because the repo already
 * carries pre-existing violations of c7 and c9.
 */
export function pendingWrites(payload, root) {
  const input = payload.tool_input ?? {};
  const filePath = toRepoPath(input.file_path, root);
  if (!filePath) return [];

  const texts = [];
  if (typeof input.content === 'string') texts.push(input.content);
  if (typeof input.new_string === 'string') texts.push(input.new_string);
  for (const edit of Array.isArray(input.edits) ? input.edits : []) {
    if (typeof edit?.new_string === 'string') texts.push(edit.new_string);
  }

  return [{ filePath, text: texts.join('\n') }];
}
