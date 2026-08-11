/**
 * Rule evaluation, shared by the pre-write guard and the doc router.
 * Pure functions only — no I/O, no process access — so `harness.test.mjs` can exercise them.
 */

/**
 * Match pending writes against constitution guard rules.
 *
 * Rule shape:
 *   { id, message, path, forbid?, whenTracked? }
 *   path        — regex the repo-relative path must match for the rule to apply (required)
 *   forbid      — regex that must NOT appear in the newly written text; omit to block on path alone
 *   whenTracked — advisory flag consumed by the hook (only block if the file is already in git)
 */
export function matchWriteRules(writes, rules) {
  const hits = [];
  for (const { filePath, text } of writes) {
    for (const rule of rules) {
      if (!new RegExp(rule.path).test(filePath)) continue;
      if (rule.forbid && !new RegExp(rule.forbid, 'm').test(text)) continue;
      hits.push({ ...rule, filePath });
    }
  }
  return hits;
}

/** Prompt keywords → doc pointers, de-duplicated in rule order. */
export function routeHints(prompt, rules) {
  const hints = new Set();
  for (const rule of rules) {
    if (!new RegExp(rule.match, 'i').test(prompt)) continue;
    for (const hint of rule.hints) hints.add(hint);
  }
  return [...hints];
}
