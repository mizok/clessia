/**
 * `migrate.yml` 的判斷核心（#963）。`npm run harness:test` 會跑到。
 *
 * 這支的錯誤方向是靜默的：判成 `clean` 的話 CI 什麼都不套、⓪ 照常放行部署，
 * 而正式 DB 缺一支 schema —— 那正是 #915。所以每一種「不能自動套」的形狀都要有一條。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isAfterDeploy,
  planMigrations,
  splitStatements,
  splitsTransaction,
  staleNewMigrations,
} from './lib/migration-plan.mjs';

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

// 10-10 事故：`20261010020730_invoice_no`（schema）與 `…021232_invoice_no_backfill`（after-deploy）
// 同批待套，舊規則判 blocked，之後每顆 main 都紅、全部沒部署。改成：先套 schema，backfill 留著
test('schema 與 after-deploy 同批待套 → apply 只套 schema，backfill 留待部署後（deferred）', () => {
  const plan = planMigrations({ local: [m('1'), m('2'), m('3', true)], remote: ['1'] });
  assert.equal(plan.state, 'apply');
  assert.deepEqual(
    plan.pending.map((p) => p.version),
    ['2', '3'],
  );
  assert.deepEqual(
    plan.deferred.map((p) => p.version),
    ['3'],
  );
});

// 先套了比 backfill 新的 schema，backfill 就成了「比遠端最新還舊卻沒套」—— dispatch 也套不上
// （CI 不帶 --include-all）。所以 backfill 之後的 schema 要等 backfill 先套
test('同批裡有比 after-deploy 還新的 schema → blocked（先 dispatch backfill）', () => {
  const plan = planMigrations({ local: [m('1'), m('2', true), m('3')], remote: ['1'] });
  assert.equal(plan.state, 'blocked');
  assert.match(plan.reason, /dispatch/);
});

test('非混合的情形 deferred 都是空的', () => {
  assert.deepEqual(planMigrations({ local: [m('1'), m('2')], remote: ['1'] }).deferred, []);
  assert.deepEqual(
    planMigrations({ local: [m('1'), m('2', true)], remote: ['1'], deployed: true }).deferred,
    [],
  );
});

test('同批混合但部署者已確認 → blocked（schema 該在部署前套，順序亂了）', () => {
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

// ── #1248：PR 新增的 migration 不能比 main 最新那支舊 ─────────────────────────────
// #1216 的形狀：PR 開著時 main 合進了更新的一支，這支合下去 CLI 就以 inserted before 拒絕
test('新增的比 base 最新那支舊 → stale（#1216 的實際檔名）', () => {
  const result = staleNewMigrations(
    ['20261003123801_class_is_recommended.sql'],
    ['20261003073117_kiosk_role.sql', '20261003124241_schedule_change_type_creation.sql'],
  );
  assert.deepEqual(result, {
    stale: ['20261003123801_class_is_recommended.sql'],
    baseLatest: '20261003124241',
  });
});

test('新增的比 base 最新那支新 → 放行', () => {
  const result = staleNewMigrations(
    ['20261004010000_new.sql'],
    ['20261003124241_schedule_change_type_creation.sql'],
  );
  assert.deepEqual(result.stale, []);
});

test('跟 base 最新那支同一個時間戳也算 stale（version 撞號）', () => {
  const result = staleNewMigrations(['20261003124241_other.sql'], ['20261003124241_a.sql']);
  assert.deepEqual(result.stale, ['20261003124241_other.sql']);
});

test('只回舊的那幾支；base 沒有任何 migration 時一律放行；不是 migration 檔名的忽略', () => {
  assert.deepEqual(
    staleNewMigrations(
      ['20261001000000_old.sql', '20261005000000_new.sql', 'README.md'],
      ['20261003000000_main.sql'],
    ).stale,
    ['20261001000000_old.sql'],
  );
  assert.deepEqual(staleNewMigrations(['20261001000000_x.sql'], []).stale, []);
});

// ── #1242：會被 CLI 拆成多個 transaction 的檔 ─────────────────────────────────
// #1146 實測：含 CONCURRENTLY 的檔，兩顆 apply 同時被按時檔內其他語句被套兩次
test('CONCURRENTLY 與其他語句混在同一支 → splitsTransaction', () => {
  assert.equal(
    splitsTransaction(
      'UPDATE public.x SET n = n + 1;\nCREATE INDEX CONCURRENTLY IF NOT EXISTS x_idx ON public.x (n);',
    ),
    true,
  );
  assert.equal(splitsTransaction('create unique index concurrently a on b (c);\nselect 1;'), true);
  assert.equal(splitsTransaction('VACUUM ANALYZE public.x;\nSELECT 1;'), true);
});

test('只有那一句的檔放行；一般檔放行', () => {
  assert.equal(
    splitsTransaction('-- 說明\nCREATE INDEX CONCURRENTLY IF NOT EXISTS x_idx ON public.x (n);\n'),
    false,
  );
  assert.equal(
    splitsTransaction('CREATE INDEX x_idx ON public.x (n);\nUPDATE public.x SET n = 1;'),
    false,
  );
});

test('註解、字串、函式本體裡出現的 CONCURRENTLY／分號不算', () => {
  const sql = [
    '-- 之後要 CREATE INDEX CONCURRENTLY 的話請獨立成一支',
    "COMMENT ON TABLE public.x IS 'VACUUM; 不是語句';",
    'CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$',
    'BEGIN PERFORM 1; PERFORM 2; END;',
    '$$;',
    '/* CLUSTER public.x; */',
  ].join('\n');
  assert.equal(splitStatements(sql).length, 2);
  assert.equal(splitsTransaction(sql), false);
});

test('待套裡有會拆 transaction 的檔 → blocked，訊息指名那支檔', () => {
  const plan = planMigrations({
    local: [m('1'), { ...m('2'), splitsTransaction: true }],
    remote: ['1'],
  });
  assert.equal(plan.state, 'blocked');
  assert.match(plan.reason, /2_x\.sql/);
  assert.match(plan.reason, /#1242/);
});

test('已經套過的檔不管它會不會拆（只看待套）', () => {
  const plan = planMigrations({
    local: [{ ...m('1'), splitsTransaction: true }, m('2')],
    remote: ['1'],
  });
  assert.equal(plan.state, 'apply');
});
