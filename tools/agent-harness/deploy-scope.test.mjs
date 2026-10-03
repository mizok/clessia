/**
 * `deploy.yml` 的範圍判斷（#1283）。`npm run harness:test` 會跑到。
 *
 * 錯誤方向有兩個：漏部署（線上跑舊碼、沒人知道）比多部署（冪等、只是多花幾分鐘）嚴重，
 * 所以共用的東西兩邊都算。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deployScope, shaFromTitle } from './lib/deploy-scope.mjs';

test('純文件／工具／migration／workflow → 兩個都不部署', () => {
  const scope = deployScope([
    'kb/wiki/architecture/deploying.md',
    'herdr-team/README.md',
    'AGENTS.md',
    'tools/agent-harness/check-harness.mjs',
    'supabase/migrations/20261004000000_x.sql',
    '.github/workflows/verify.yml',
  ]);
  assert.deepEqual(scope, { api: false, web: false, apiFiles: [], webFiles: [] });
});

test('只改 api → 只部署 api', () => {
  const scope = deployScope(['apps/api/src/routes/scores.ts', 'kb/wiki/x.md']);
  assert.equal(scope.api, true);
  assert.equal(scope.web, false);
  assert.deepEqual(scope.apiFiles, ['apps/api/src/routes/scores.ts']);
});

test('只改 web → 只部署 web', () => {
  const scope = deployScope(['apps/web/src/app/app.ts']);
  assert.equal(scope.api, false);
  assert.equal(scope.web, true);
});

test('packages／root 依賴 → 兩邊都部署（共用型別、lockfile 改了兩邊的產物都可能變）', () => {
  for (const file of ['packages/shared-types/src/index.ts', 'package.json', 'package-lock.json']) {
    const scope = deployScope([file]);
    assert.equal(scope.api && scope.web, true, file);
  }
});

test('只改測試檔 → 不部署（不進產物）', () => {
  const scope = deployScope([
    'apps/api/src/routes/scores-scope.spec.ts',
    'apps/web/src/app/x.component.spec.ts',
  ]);
  assert.equal(scope.api || scope.web, false);
});

test('apps/api/package.json 這種不是測試的檔案照算', () => {
  assert.equal(deployScope(['apps/api/package.json']).api, true);
});

test('shaFromTitle：deploy 標題包 migrate 標題時取最後一顆；dispatch 直接是 SHA；撈不到回 null', () => {
  const sha = 'a'.repeat(40);
  const other = 'b'.repeat(40);
  assert.equal(shaFromTitle(`deploy @ migrate @ ${sha}`), sha);
  assert.equal(shaFromTitle(`deploy @ ${other}`), other);
  assert.equal(shaFromTitle('deploy @ main'), null);
  assert.equal(shaFromTitle(undefined), null);
});
