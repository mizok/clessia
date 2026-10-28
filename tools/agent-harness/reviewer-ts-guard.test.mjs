import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { migrationStamp, staleMigrations } from '../reviewer-merge/ts-guard.mjs';

const M = (stamp) => `supabase/migrations/${stamp}_x.sql`;

test('ts-guard：migrationStamp 只認 migrations 的 14 碼檔名', () => {
  assert.equal(migrationStamp(M('20261023034347')), '20261023034347');
  assert.equal(migrationStamp('apps/api/src/x.ts'), null);
  assert.equal(migrationStamp('supabase/migrations/2026_x.sql'), null);
});

test('ts-guard：晚於 main 與正式兩者才放行', () => {
  // #1990 實例：034347 晚於 main 034100、正式 034048
  assert.deepEqual(staleMigrations([M('20261023034347')], '20261023034100', '20261023034048'), []);
});

test('ts-guard：#1989 的形狀 —— 早於已套的那支就擋', () => {
  const stale = staleMigrations([M('20261023033540')], '20261022195530', '20261023034048');
  assert.deepEqual(
    stale.map((s) => s.stamp),
    ['20261023033540'],
  );
});

test('ts-guard：等於也算不晚於（同一秒的兩支會撞）', () => {
  assert.equal(
    staleMigrations([M('20261023034100')], '20261023034100', '20261023034048').length,
    1,
  );
});

test('ts-guard：非 migration 的檔不看', () => {
  assert.deepEqual(staleMigrations(['apps/web/a.ts', 'kb/x.md'], '20991231000000', '0'), []);
});

test('ts-guard：CLI 擋下時 exit 1、放行 exit 0、缺參數 exit 2', () => {
  const run = (...a) =>
    spawnSync(process.execPath, ['tools/reviewer-merge/ts-guard.mjs', ...a], { encoding: 'utf8' })
      .status;
  assert.equal(run('--main', '20261023034100', '--prod', '20261023034048', M('20261023034347')), 0);
  assert.equal(run('--main', '20261023034100', '--prod', '20261023034048', M('20261023033540')), 1);
  assert.equal(run('--main', '20261023034100', M('20261023034347')), 2);
});
