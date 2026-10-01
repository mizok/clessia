/**
 * `migrate.yml` 的判斷核心（#963）。`npm run harness:test` 會跑到。
 *
 * 這支的錯誤方向是靜默的：判成 `clean` 的話 CI 什麼都不套、⓪ 照常放行部署，
 * 而正式 DB 缺一支 schema —— 那正是 #915。所以每一種「不能自動套」的形狀都要有一條。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isAfterDeploy, planMigrations } from './lib/migration-plan.mjs';

const m = (version, afterDeploy = false) => ({
  version,
  file: `${version}_x.sql`,
  afterDeploy,
});

test('遠端與本機一致 → clean（差集 0）', () => {
  const plan = planMigrations({ local: [m('1'), m('2')], remote: ['1', '2'] });
  assert.equal(plan.state, 'clean');
  assert.deepEqual(plan.pending, []);
});

test('只有比遠端最新還新的 schema 待套 → apply', () => {
  const plan = planMigrations({ local: [m('1'), m('2'), m('3')], remote: ['1', '2'] });
  assert.equal(plan.state, 'apply');
  assert.deepEqual(
    plan.pending.map((p) => p.version),
    ['3'],
  );
});

test('中間漏了一支（#915 的形狀）→ blocked，不自動補', () => {
  const plan = planMigrations({ local: [m('1'), m('2'), m('3')], remote: ['1', '3'] });
  assert.equal(plan.state, 'blocked');
  assert.deepEqual(plan.outOfOrder, ['2']);
});

test('遠端有、repo 沒有（手動補記錯 version）→ blocked', () => {
  const plan = planMigrations({ local: [m('1')], remote: ['1', '9'] });
  assert.equal(plan.state, 'blocked');
  assert.deepEqual(plan.missingLocal, ['9']);
});

test('待套的全是 after-deploy → after-deploy（等部署完再套）', () => {
  const plan = planMigrations({ local: [m('1'), m('2', true)], remote: ['1'] });
  assert.equal(plan.state, 'after-deploy');
});

test('after-deploy 在部署者確認之後 → apply', () => {
  const plan = planMigrations({
    local: [m('1'), m('2', true)],
    remote: ['1'],
    deployed: true,
  });
  assert.equal(plan.state, 'apply');
});

test('schema 與 after-deploy 同批待套 → blocked（一次 db push 拆不開，要分批合）', () => {
  const plan = planMigrations({ local: [m('1'), m('2'), m('3', true)], remote: ['1'] });
  assert.equal(plan.state, 'blocked');
  assert.match(plan.reason, /分批/);
});

test('同批混合但部署者已確認 → 仍然 blocked（schema 不能晚於部署）', () => {
  const plan = planMigrations({
    local: [m('1'), m('2'), m('3', true)],
    remote: ['1'],
    deployed: true,
  });
  assert.equal(plan.state, 'blocked');
});

test('isAfterDeploy 只認第一個非空行的標記', () => {
  assert.equal(isAfterDeploy('-- clessia:apply after-deploy\nupdate t set x = 1;'), true);
  assert.equal(isAfterDeploy('\n\n-- clessia:apply after-deploy\n'), true);
  assert.equal(isAfterDeploy('-- 說明\n-- clessia:apply after-deploy\n'), false);
  assert.equal(isAfterDeploy('alter table t add column x int;'), false);
});
