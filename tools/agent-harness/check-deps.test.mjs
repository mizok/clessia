import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('./check-deps.mjs', import.meta.url));

function run(installed) {
  const root = mkdtempSync(join(tmpdir(), 'check-deps-'));
  try {
    mkdirSync(join(root, 'tools/agent-harness'), { recursive: true });
    copyFileSync(src, join(root, 'tools/agent-harness/check-deps.mjs'));
    for (const dir of installed) {
      mkdirSync(join(root, dir, 'node_modules'), { recursive: true });
      writeFileSync(join(root, dir, 'node_modules/.package-lock.json'), '{}');
    }
    return spawnSync('node', [join(root, 'tools/agent-harness/check-deps.mjs')], { encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('兩套都裝了 → 0', () => {
  assert.equal(run(['.', 'apps/api']).status, 0);
});

test('只缺 apps/api → 1，印出該跑的指令且不提根', () => {
  const r = run(['.']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cd apps\/api && npm ci/);
  assert.doesNotMatch(r.stderr, /cd \. && npm ci/);
});

test('兩套都缺 → 兩條指令', () => {
  const r = run([]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cd \. && npm ci/);
  assert.match(r.stderr, /cd apps\/api && npm ci/);
});
