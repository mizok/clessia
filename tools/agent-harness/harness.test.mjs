/**
 * Harness self-check. Runs on the stdlib test runner — no framework, no config:
 *   npm run harness:test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pendingWrites, toRepoPath } from './lib/hook-io.mjs';
import { matchWriteRules, routeHints } from './lib/rules.mjs';
import guardRules from './rules/pre-guard.rules.json' with { type: 'json' };
import routerRules from './rules/doc-router.rules.json' with { type: 'json' };
import { compareToBaseline, failingSpecs } from './test-gate.mjs';

const ROOT = '/repo';
const guard = (filePath, text) =>
  matchWriteRules([{ filePath, text }], guardRules.rules).map((v) => v.id);

test('toRepoPath 去掉 worktree 前綴，路徑錨點才咬得住', () => {
  assert.equal(toRepoPath('/repo/apps/web/a.scss', ROOT), 'apps/web/a.scss');
  assert.equal(toRepoPath('/repo/.worktrees/x/apps/web/a.scss', ROOT), 'apps/web/a.scss');
});

test('pendingWrites 只取新寫入的內容，不取整個檔案', () => {
  const payload = {
    tool_input: {
      file_path: '/repo/a.scss',
      old_string: 'height: 100vh;',
      new_string: 'height: 100%;',
    },
  };
  const [write] = pendingWrites(payload, ROOT);
  assert.equal(write.text, 'height: 100%;');
  assert.ok(!write.text.includes('100vh'), '舊內容不該進入判斷 — 否則修掉違規反而會被擋');
});

test('c6 擋新的 viewport 單位，不擋既有檔案的其他編輯', () => {
  assert.deepEqual(guard('apps/web/a.scss', 'height: 100vh;'), ['c6']);
  assert.deepEqual(guard('apps/web/a.scss', 'height: calc(var(--window-height) * 1);'), []);
});

test('c7 擋舊版結構指令', () => {
  assert.deepEqual(guard('a.component.html', '<div *ngIf="x">'), ['c7']);
  assert.deepEqual(guard('a.component.html', '@if (x) { <div></div> }'), []);
});

test('c8 擋裝飾器 API，但放過 spec 檔', () => {
  assert.deepEqual(guard('apps/web/src/app/a.component.ts', '@Input() name!: string;'), ['c8']);
  assert.deepEqual(guard('apps/web/src/app/a.component.spec.ts', '@Input() name!: string;'), []);
  assert.deepEqual(
    guard('apps/web/src/app/a.component.ts', 'readonly name = input<string>();'),
    [],
  );
});

test('c9 擋平行文件目錄', () => {
  assert.deepEqual(guard('docs/foo.md', '# hi'), ['c9']);
  assert.deepEqual(guard('kb/foo.md', '# hi'), []);
});

test('c2 擋寫入 ba_* 表，但放過讀取', () => {
  assert.deepEqual(
    guard('apps/api/src/routes/students.ts', "await supabase.from('ba_user')\n  .insert({ id })"),
    ['c2'],
  );
  assert.deepEqual(
    guard(
      'apps/api/src/routes/students.ts',
      "await supabase.from('ba_user').select('id').eq('id', x)",
    ),
    [],
  );
});

test('c3 只在檔案已進版控時才由 hook 生效', () => {
  const [hit] = matchWriteRules(
    [{ filePath: 'supabase/migrations/20260101000000_x.sql', text: 'alter table foo;' }],
    guardRules.rules,
  );
  assert.equal(hit.id, 'c3');
  assert.equal(hit.whenTracked, true, 'whenTracked 缺失會讓新建 migration 也被擋');
});

test('doc router 命中才出手，沒命中保持安靜', () => {
  assert.ok(routeHints('幫我改 migration 加欄位', routerRules.rules).length > 0);
  assert.deepEqual(routeHints('今天天氣如何', routerRules.rules), []);
});

// ── 收工閘門的基線比對 ───────────────────────────────────────────────────────────────────

test('failingSpecs 從 vitest 輸出撈出失敗的 spec 檔，且去重', () => {
  const output = [
    ' ✓  web apps/web/src/app/a.spec.ts (3 tests)',
    ' FAIL  web apps/web/src/app/b.spec.ts > Suite > case one',
    ' FAIL  web apps/web/src/app/b.spec.ts > Suite > case two',
    ' FAIL  web apps/web/src/app/c.spec.ts > Other',
  ].join('\n');
  assert.deepEqual(failingSpecs(output), [
    'apps/web/src/app/b.spec.ts',
    'apps/web/src/app/c.spec.ts',
  ]);
});

test('failingSpecs 不把通過的檔案算進去', () => {
  assert.deepEqual(failingSpecs(' ✓  web apps/web/src/app/a.spec.ts (3 tests)'), []);
});

test('基線內的紅燈不算 regression，基線外的才算', () => {
  const known = ['apps/web/a.spec.ts'];
  assert.deepEqual(compareToBaseline(['apps/web/a.spec.ts'], known).regressions, []);
  assert.deepEqual(
    compareToBaseline(['apps/web/a.spec.ts', 'apps/web/b.spec.ts'], known).regressions,
    ['apps/web/b.spec.ts'],
  );
});

test('基線項目恢復時要被指出來，但不擋人', () => {
  const result = compareToBaseline([], ['apps/web/a.spec.ts']);
  assert.deepEqual(result.recovered, ['apps/web/a.spec.ts']);
  assert.deepEqual(result.regressions, [], '恢復不該被當成 regression');
});

// ── 現況表的掃描範圍 ─────────────────────────────────────────────────────────
// 這組測試存在的理由：feature-map 曾經只掃 features/admin/pages，於是家長端 11 個空殼
// 從來沒出現在任何報告裡，而所有優先順序決策都以那張表為依據。
// 見 kb/wiki/lessons/status-table-blind-spot.md

const featureMap = await import('./feature-map.mjs');

test('現況表掃遍三個角色，不是只有 admin', () => {
  assert.deepEqual(featureMap.ROLES, ['admin', 'teacher', 'parent']);

  for (const role of featureMap.ROLES) {
    const found = featureMap.diskPages.filter((p) => p.startsWith(`${role}/`));
    assert.ok(found.length > 0, `${role} 底下一個頁面都沒掃到，掃描範圍可能又縮回去了`);
  }
});

test('磁碟上每個角色的頁面都被藍圖認領，沒有靜默消失的', () => {
  assert.deepEqual(featureMap.failures, []);
});

test('產出的表格每個角色各一欄', () => {
  const body = featureMap.render();

  for (const label of ['管理端', '老師端', '家長端']) {
    assert.ok(body.includes(label), `表頭少了「${label}」欄`);
  }
});
