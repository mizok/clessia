/**
 * Harness self-check. Runs on the stdlib test runner — no framework, no config:
 *   npm run harness:test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatGenerated } from './lib/format.mjs';
import { pendingWrites, toRepoPath } from './lib/hook-io.mjs';
import { missingUserSkills } from './lib/user-skills.mjs';
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

/**
 * c6 的邊界：**拿 viewport 當值**是違規，**`var()` 的 fallback** 不是。
 *
 * 理由是 fallback 就是「變數解不到」的那條分支 —— 例如 dialog 被 appendTo 到 <body>，
 * 落在寫入 `--window-height` 的節點外面，那時 fallback 就是真正生效的值，
 * 換成某個 px 數字只會把「不精確」變成「一定是錯的」。使用者 2026-08-29 裁決。
 *
 * 同一份規則同時餵給 PreToolUse hook（新違規）與 harness gate A12（存量），
 * 所以這四條也就是 gate 的驗收案例。
 */
test('c6 放過 var() 的 fallback，但註解裡的 viewport 單位照樣抓', () => {
  // 直接當值 → 違規
  assert.deepEqual(guard('apps/web/a.scss', 'min-height: 100vh;'), ['c6']);
  assert.deepEqual(guard('apps/web/a.scss', '  max-height: 55vh;'), ['c6']);
  // 註解不豁免 —— 豁免邏輯本身會腐化，寧可要求註解別寫那個字面值
  assert.deepEqual(guard('apps/web/a.scss', '// flex col 100dvh 之後高度交給 flex'), ['c6']);
  // var() 的 fallback → 放行
  assert.deepEqual(guard('apps/web/a.scss', 'height: var(--window-height, 100dvh);'), []);
  assert.deepEqual(
    guard('apps/web/a.scss', 'width: calc(var(--window-width, 100vw) - 32px) !important;'),
    [],
  );
  // 同一行先有 var() 收尾、後面才拿 viewport 當值 —— 不能被前面的 var( 蓋掉
  assert.deepEqual(guard('apps/web/a.scss', 'margin: var(--space-2, 8px); height: 100vh;'), ['c6']);
});

// A12（存量 gate）靠 id 從 pre-guard.rules.json 撈 c6 出來掃全部 .scss。
// 規則被改名或移除的話它會靜靜地什麼都不掃，而且**永遠是綠的** —— 這條守那個。
test('c6 規則存在於 pre-guard.rules.json，A12 才撈得到', () => {
  const c6 = guardRules.rules.filter((rule) => rule.id === 'c6');

  assert.equal(c6.length, 1, 'A12 用 id === c6 撈規則，改名的話存量 gate 會靜默失效');
  assert.match(c6[0].path, /scss/);
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

// ── 使用者層級 skill 的可見度 ─────────────────────────────────────────────────
// kb-wiki 裝在使用者的 home、不進版控，但 AGENTS.md 的指令表把它寫得像專案工具。
// 換一台機器就撲空 —— 真的踩過。這裡守的是「看得見但不擋人」這個性質。

test('使用者層級 skill：裝了不吭聲，沒裝才報', () => {
  assert.deepEqual(
    missingUserSkills('/home/nobody', () => true),
    [],
  );
  assert.deepEqual(
    missingUserSkills('/home/nobody', () => false).map((skill) => skill.name),
    ['kb-wiki'],
  );
});

// 這條刻意整支跑起來而不是測純函式：會回歸的不是偵測邏輯，是有人把它從 warnings
// 挪進 failures，於是別人的機器（和 CI）第一次跑 harness 就紅。
test('使用者層級 skill 缺席只警告，exit code 仍是 0', () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'check-harness.mjs');
  const run = spawnSync(process.execPath, [script], {
    // os.homedir() 在 POSIX 上優先讀 $HOME —— 指到一個不存在的家目錄就等於「沒裝」
    env: { ...process.env, HOME: '/nonexistent-home-for-test' },
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, `缺 skill 不該讓 gate 紅：\n${run.stderr}`);
  assert.match(run.stderr, /kb-wiki 是使用者層級 skill/);
  assert.match(run.stdout, /harness gate 全綠/);
});

// 格式化是 --write 的收尾，不是它的目的。prettier 掛掉（沒裝、逾時、路徑不存在）時
// 必須讓重生成照樣算成功 —— 否則一個格式化問題會偽裝成「現況表重生失敗」。
test('formatGenerated 失敗只警告，不往上拋', () => {
  assert.doesNotThrow(() =>
    formatGenerated(
      ['this-file-does-not-exist-anywhere.md'],
      dirname(fileURLToPath(import.meta.url)),
    ),
  );
});

// ── 現況表的強制點在 main，不在分支 ────────────────────────────────────────────────────
//
// 為什麼要測：這條分流的價值全在「分支上不紅」。有人把它改回無條件 process.exit(1)，
// 或把條件寫反，症狀都不是報錯而是**衝突稅默默回來** —— 沒有測試的話沒人會發現。

const FEATURE_MAP = join(dirname(fileURLToPath(import.meta.url)), 'feature-map.mjs');

/** 把現況表弄過期，跑一次 feature-map，然後**一定**還原。 */
function withStaleRoadmap(env = {}) {
  const roadmap = join(dirname(fileURLToPath(import.meta.url)), '../../kb/wiki/roadmap.md');
  const original = readFileSync(roadmap, 'utf8');
  const stale = original.replace(/^\| 請假 .*$/m, (row) => row.replace('| 1 ', '| 9 '));
  assert.notEqual(stale, original, '沒有成功弄過期 —— 表格格式變了，這條測試要跟著改');
  try {
    writeFileSync(roadmap, stale);
    return spawnSync(
      process.execPath,
      [join(dirname(fileURLToPath(import.meta.url)), 'feature-map.mjs')],
      { env: { ...process.env, ...env }, encoding: 'utf8' },
    );
  } finally {
    writeFileSync(roadmap, original);
  }
}

// **這條守的是一個死結不要復活。** 一度是「分支警告、main 紅燈」，而讓 main 紅的正是這一行；
// 但會重生表的 `sync-feature-map` job 掛著 `needs: verify`，於是能修的人只在沒壞時才來
// —— main 自己好不了，2026-08-30 真的卡住過（5be7927 人工代打解堵）。
// 有人把 main 的紅燈加回來 = 把死結加回來，症狀是 main 卡紅而不是報錯，所以要測。
test('現況表過期在哪個環境都只警告，main 也不例外', () => {
  for (const ref of ['refs/heads/feat/whatever', 'refs/heads/main', undefined]) {
    const run = withStaleRoadmap(ref ? { GITHUB_REF: ref } : {});
    assert.equal(run.status, 0, `${ref ?? '(本機)'} 不該紅：\n${run.stderr}`);
    assert.match(run.stderr, /現況表過期/);
  }
});

// 對照組：同一支腳本的另一組檢查沒有被降級。降錯範圍的話藍圖破洞會靜靜溜過去。
test('「有東西沒被功能區認領」維持紅燈 —— 那個 job 修不了', () => {
  const source = readFileSync(FEATURE_MAP, 'utf8');
  assert.match(
    source,
    /failures\.length > 0 && mode !== 'write'[\s\S]{0,200}process\.exit\(1\)/,
    'orphan 檢查必須無條件 exit 1',
  );
});

// 自動重生的 job 靠「零 diff 就不 commit」避免每次 main push 都疊一支 bot commit。
// 那個判斷的前提是 --write 冪等 —— 不冪等的話 main 會被無限追加 commit。
test('--write 冪等：第二次不再改動檔案', () => {
  const roadmap = join(dirname(fileURLToPath(import.meta.url)), '../../kb/wiki/roadmap.md');
  const original = readFileSync(roadmap, 'utf8');
  const script = join(dirname(fileURLToPath(import.meta.url)), 'feature-map.mjs');
  try {
    spawnSync(process.execPath, [script, '--write'], { encoding: 'utf8' });
    const first = readFileSync(roadmap, 'utf8');
    spawnSync(process.execPath, [script, '--write'], { encoding: 'utf8' });
    assert.equal(readFileSync(roadmap, 'utf8'), first, '--write 不冪等 → main 會被無限追加 commit');
  } finally {
    writeFileSync(roadmap, original);
  }
});

// ── hook-only clause 的存量那一半（A13–A16）──────────────────────────────────────────
//
// 這幾條 gate 與 PreToolUse hook **共用 pre-guard.rules.json 的同一條規則**。所以真正會
// 回歸的不是 regex 本身（hook 的測試已經蓋住），而是「gate 有沒有把規則餵對」——
// 尤其 c8 的路徑排除與 c2 的跨行比對，兩者都只有在整份檔案餵進去時才成立。

test('c7 擋舊版結構指令，@if / @for 放行', () => {
  assert.deepEqual(guard('apps/web/a.html', '<div *ngIf="x">'), ['c7']);
  assert.deepEqual(guard('apps/web/a.html', '<div *ngFor="let x of xs">'), ['c7']);
  assert.deepEqual(guard('apps/web/a.html', '@if (x) { <div></div> }'), []);
});

test('c8 擋裝飾器版 API，但 @HostListener 不在範圍內', () => {
  assert.deepEqual(guard('apps/web/src/app/a.component.ts', '  @Input() value = 1;'), ['c8']);
  assert.deepEqual(guard('apps/web/src/app/a.component.ts', "  @ViewChild('op') op!: X;"), ['c8']);
  // 使用者 2026-08-29 釐清：沒有 functional 對應物，window-size.directive.ts 還在用
  assert.deepEqual(guard('apps/web/src/app/a.directive.ts', "  @HostListener('resize')"), []);
  assert.deepEqual(guard('apps/web/src/app/a.component.ts', '  readonly value = input(1);'), []);
});

// gate 掃 .ts 時是**整棵樹**餵進去的，路徑排除因此是 gate 正確性的一部分，
// 不只是 hook 的細節：漏掉它會讓既有的 spec 檔（真的有 @ViewChild）變成假紅燈。
test('c8 排除 .spec.ts —— 測試檔裡的裝飾器不算違規', () => {
  assert.deepEqual(guard('apps/web/src/app/a.component.spec.ts', "  @ViewChild('t') t!: X;"), []);
});

// c2 的 regex 跨行（from 與 .update 之間容許 120 字元），所以 gate **必須整份檔案餵**。
// 逐行掃的話這條會完全看不到東西 —— 而且是靜靜地看不到。
test('c2 跨行也要抓得到；讀取放行', () => {
  const multiline = "await supabase\n  .from('ba_user')\n  .update({ name })";
  assert.deepEqual(guard('apps/api/src/routes/x.ts', multiline), ['c2']);
  assert.deepEqual(
    guard('apps/api/src/routes/x.ts', "await supabase.from('ba_user').select()"),
    [],
  );
});
