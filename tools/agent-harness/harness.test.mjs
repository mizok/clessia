/**
 * Harness self-check. Runs on the stdlib test runner — no framework, no config:
 *   npm run harness:test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatGenerated } from './lib/format.mjs';
import { crossFeatureImports } from './lib/feature-boundaries.mjs';
import { touchTargetViolations } from './lib/touch-target.mjs';
import { pendingWrites, toRepoPath } from './lib/hook-io.mjs';
import { missingUserSkills } from './lib/user-skills.mjs';
import { matchWriteRules, routeHints } from './lib/rules.mjs';
import { bandContrastViolations } from './lib/band-contrast.mjs';
import { readTokenPalette, usageContrastViolations } from './lib/scss-contrast.mjs';
import { countDesktopFirst, desktopFirstFiles } from './lib/mobile-first.mjs';
import { orphanModuleImports } from './lib/orphan-imports.mjs';
import { destructivePrimaryActions, headerActionButtons } from './lib/page-actions.mjs';
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
// orgId 的機制豁免：Better Auth 的 API 明確拒收它（auth.ts 宣告 input: false），
// 直寫是唯一路徑。但豁免必須**只放行「payload 就只有 orgId」** —— 夾帶其他欄位就是
// 把整條 c2 開了個洞，而那種洞不會有人發現（它長得跟合法呼叫一樣）。
test('c2 只豁免「單寫 orgId」，夾帶其他欄位照樣擋', () => {
  assert.deepEqual(
    guard('apps/api/src/routes/x.ts', "supabase.from('ba_user').update({ orgId })"),
    [],
  );
  assert.deepEqual(
    guard('apps/api/src/routes/x.ts', "supabase.from('ba_user').update({ orgId: orgId })"),
    [],
  );
  // 換行寫法（三處實際程式碼都是這種）
  assert.deepEqual(
    guard('apps/api/src/routes/x.ts', "supabase\n  .from('ba_user')\n  .update({ orgId })"),
    [],
  );
  // **反例**：夾帶就不再是「沒有 API 路徑」的情境
  assert.deepEqual(
    guard('apps/api/src/routes/x.ts', "supabase.from('ba_user').update({ orgId, email })"),
    ['c2'],
  );
});

test('c2 跨行也要抓得到；讀取放行', () => {
  const multiline = "await supabase\n  .from('ba_user')\n  .update({ name })";
  assert.deepEqual(guard('apps/api/src/routes/x.ts', multiline), ['c2']);
  assert.deepEqual(
    guard('apps/api/src/routes/x.ts', "await supabase.from('ba_user').select()"),
    [],
  );
});

// ── 橘帶對比地板 ─────────────────────────────────────────────────────────────────────────
const bandCss = ({ ink = 'rgb(26 22 20 / 80%)', rule = 'rgb(26 22 20 / 60%)' } = {}) => `
:root {
  --zinc-900: #1a1614;
  --accent-vivid: #ff6a3d;
  --accent-vivid-2: #ff8557;
  --band-ink-muted: ${ink};
  --band-rule: ${rule};
}
`;

test('橘帶地板：現行值（次要字 0.80、描邊 0.60）全部合格', () => {
  assert.deepEqual(bandContrastViolations(bandCss()), []);
});

test('橘帶地板：次要字 0.72 掉出 AA，深端與亮端都要報', () => {
  const found = bandContrastViolations(bandCss({ ink: 'rgb(26 22 20 / 72%)' }));
  assert.equal(found.length, 2, '兩個漸層端各一則');
  assert.ok(
    found.every((m) => m.includes('--band-ink-muted') && m.includes('4.5:1')),
    '訊息要指出是哪個 token、門檻是多少',
  );
  // 反直覺但實測如此：近黑降透明度壓在**深端**對比更低，不是亮端
  assert.ok(found.some((m) => m.includes('--accent-vivid 上只有 4.00:1')));
  assert.ok(found.some((m) => m.includes('--accent-vivid-2 上只有 4.43:1')));
});

test('橘帶地板：0.78 是文字的臨界點，剛好過', () => {
  assert.deepEqual(bandContrastViolations(bandCss({ ink: 'rgb(26 22 20 / 78%)' })), []);
  assert.equal(bandContrastViolations(bandCss({ ink: 'rgb(26 22 20 / 77%)' })).length, 1);
});

test('橘帶地板：描邊走 3:1 不是 4.5:1，所以 0.60 過而 0.34 不過', () => {
  assert.deepEqual(bandContrastViolations(bandCss({ rule: 'rgb(26 22 20 / 60%)' })), []);
  const found = bandContrastViolations(bandCss({ rule: 'rgb(26 22 20 / 34%)' }));
  assert.equal(found.length, 2);
  assert.ok(found.every((m) => m.includes('--band-rule') && m.includes('3:1')));
});

test('橘帶地板：近黑字跟 --zinc-900 脫鉤要擋（#97 的教訓）', () => {
  const found = bandContrastViolations(bandCss({ ink: 'rgb(24 24 27 / 80%)' }));
  assert.ok(
    found.some((m) => m.includes('--band-ink-muted') && m.includes('--zinc-900')),
    '硬編碼的三元組漂掉會讓橘帶留在上一代色系',
  );
});

test('橘帶地板：token 還沒鑄進去的分支不該報錯', () => {
  assert.deepEqual(bandContrastViolations(':root { --zinc-900: #1a1614; }'), []);
});

// ── 使用處的文字對比 ─────────────────────────────────────────────────────────────────────
const palette = readTokenPalette(`
:root {
  --zinc-50: #faf9f8;
  --zinc-600: #57504b;
  --warning-100: #fef3c7;
  --warning-200: #fde68a;
  --warning-600: #b45309;
  --warning-800: #92400e;
  --accent-500: #c93f14;
  --color-white: #fff;
}
`);
const scan = (scss) => usageContrastViolations(scss, palette);

test('對比掃描：hover 換底 + 繼承的文字色（琥珀 chip 陷阱）', () => {
  const found = scan(`
.chip {
  background: var(--warning-100);
  color: var(--warning-600);

  &:hover {
    background: var(--warning-200);
  }
}
`);
  // 靜止態 4.51 過關，hover 態 4.03 不過 —— 只該報 hover 那一個
  assert.equal(found.length, 1);
  assert.equal(found[0].fg, 'var(--warning-600)');
  assert.equal(found[0].bg, 'var(--warning-200)');
  assert.ok(found[0].ratio > 4.0 && found[0].ratio < 4.1, `ratio=${found[0].ratio}`);
});

test('對比掃描：hover 改用 --warning-800 就過', () => {
  assert.deepEqual(
    scan(`
.chip {
  background: var(--warning-100);
  color: var(--warning-800);

  &:hover {
    background: var(--warning-200);
  }
}
`),
    [],
  );
});

test('對比掃描：宣告順序不影響判斷（收合時才判，不是看到就判）', () => {
  // color 在 background 前面。看到 color 就判斷的話會拿祖先的白底去比，誤報白字白底
  assert.deepEqual(
    scan(`
.card {
  background: var(--color-white);

  &__badge {
    color: var(--color-white);
    background: var(--accent-500);
  }
}
`),
    [],
  );
});

test('對比掃描：background: transparent 會遮蔽祖先的底，不是被略過', () => {
  // --zinc-600 疊在 --accent-500 上只有 1.58，但 transparent 之後真正的底
  // 是這支檔案不知道的東西 —— 不知道就不要報
  assert.deepEqual(
    scan(`
.pill {
  background: var(--accent-500);

  &--off {
    background: transparent;
    color: var(--zinc-600);
  }
}
`),
    [],
  );
});

test('對比掃描：::before 的裝飾方塊不算文字的底', () => {
  assert.deepEqual(
    scan(`
.item {
  color: var(--zinc-600);

  &::before {
    content: '';
    background: var(--accent-500);
  }
}
`),
    [],
  );
});

test('對比掃描：算不出來的值一律跳過，不猜', () => {
  assert.deepEqual(
    scan(`
.x {
  background: linear-gradient(140deg, var(--warning-100), var(--warning-200));
  color: var(--warning-600);
}
.y {
  background: color-mix(in srgb, var(--warning-100) 70%, white);
  color: var(--warning-600);
}
`),
    [],
  );
});

// ── 手機優先的 ratchet ───────────────────────────────────────────────────────
// 守的是「桌機優先的寫法只准變少」。這支 gate 的紅綠判定單位是**檔案**不是次數，
// 因為遷移的單位是檔案 —— 一支檔案改到一半沒有意義。

test('手機優先：抓得到 respond-to，放過 respond-from', () => {
  assert.deepEqual(
    desktopFirstFiles([
      { path: 'a.scss', source: "@include bp.respond-to('mobile') { color: red; }" },
      { path: 'b.scss', source: "@include bp.respond-from('mobile') { color: red; }" },
      { path: 'c.scss', source: '.x { color: red; }' },
    ]),
    ['a.scss'],
  );
});

test('手機優先：respond-to-container 也算桌機優先', () => {
  assert.deepEqual(
    desktopFirstFiles([
      {
        path: 'a.scss',
        source: "@include bp.respond-to-container(main, 'mobile') { color: red; }",
      },
    ]),
    ['a.scss'],
  );
});

// 這條是給正則的 `g` flag 留的防線：`g` 的 lastIndex 有狀態，
// 沿用同一個實例跑第二個檔案會從上一次的位置繼續找 —— 症狀是**間歇性漏報**，
// 而漏報的 gate 看起來跟通過的 gate 一模一樣。
test('手機優先：連續多檔不會因為正則的 lastIndex 而漏報', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({
    path: `f${i}.scss`,
    source: "@include bp.respond-to('mobile') { color: red; }",
  }));
  assert.equal(desktopFirstFiles(many).length, 5);
});

test('手機優先：沒有斷點的檔案不算違規（它是另一個問題）', () => {
  assert.deepEqual(desktopFirstFiles([{ path: 'a.scss', source: '.x { display: flex; }' }]), []);
});

test('手機優先：countDesktopFirst 數的是次數，給人看規模用', () => {
  assert.equal(
    countDesktopFirst("@include bp.respond-to('mobile'){} @include bp.respond-to('desktop'){}"),
    2,
  );
  assert.equal(countDesktopFirst("@include bp.respond-from('mobile'){}"), 0);
});

// ── A17：可點元素的尺寸下限 ──────────────────────────────────────────────────────────
//
// 這支的規則是**反過來**的，而「反過來」正是最容易在重構時被改回直覺版的地方。
// 改回去的症狀不是報錯，是**最嚴重的那類違規再也抓不到**（它們沒有數字可抓）。

const tt = (source) => touchTargetViolations([{ path: 'a.scss', source }]).map((v) => v.kind);

test('沒有尺寸下限的可點元素要抓到 —— 那是實際踩過的形狀', () => {
  // 老師端 dashboard 改動前的原樣：整頁僅有的兩個導覽動作，實測 100×20
  assert.deepEqual(
    tt(`.d {
      &__link { padding: 0; border: none; cursor: pointer; font-size: 0.875rem; }
    }`),
    ['no-floor'],
  );
});

test('40px + pointer:coarse 抬到 44 是合規形狀，不可誤報', () => {
  // 誤報這個形狀會逼人把桌機也做成 44px —— design-web 席實測過那會讓桌機退步
  assert.deepEqual(
    tt(`.d {
      &__link { min-height: 40px; cursor: pointer; }
    }
    @media (pointer: coarse) { .d__link { min-height: 44px; } }`),
    [],
  );
});

test('明寫的過小尺寸也要抓，但裝飾性元素不算', () => {
  assert.deepEqual(tt('.b { cursor: pointer; min-height: 32px; }'), ['below-threshold']);
  // 狀態圓點：沒有 cursor: pointer 就不是點擊目標
  assert.deepEqual(tt('.dot { width: 6px; height: 6px; border-radius: 50%; }'), []);
});

// 頂層 `@use ...;` 不清 buffer 的話會跟下一個 selector 黏成一體，而它以 `@` 開頭
// → 整個區塊被當 at-rule、selector 變空字串，所有 `&__x` 的父層解析全毀。
// 症狀是安靜的：不報錯，只是合規比對對不上 —— 第一版就是這樣把已修好的程式碼誤報成違規。
test('頂層 @use 不能污染後續 selector 的父層解析', () => {
  assert.deepEqual(
    tt(`@use 'shared/breakpoints' as bp;

    .d {
      &__link { min-height: 40px; cursor: pointer; }
    }
    @media (pointer: coarse) { .d__link { min-height: 44px; } }`),
    [],
  );
});

// ── PrimeNG 模組的孤兒 import ────────────────────────────────────────────────
// Angular 的 NG8113 不涵蓋 NgModule，所以這個坑在 repo 裡長出來過兩次。

test('孤兒 import：模板沒用到就抓出來', () => {
  assert.deepEqual(
    orphanModuleImports([
      { path: 'a.ts', ts: 'imports: [TagModule],', template: '<div></div>' },
      { path: 'b.ts', ts: 'imports: [TagModule],', template: '<p-tag value="x" />' },
    ]),
    [{ path: 'a.ts', module: 'TagModule' }],
  );
});

// **這條防的是誤報，而誤報的 gate 會被關掉。**
// 第一版的對映表只列了元件選擇器 `<p-button`，結果 7 支用 `<button pButton>`
// 指令的檔案全部被誤判成孤兒。一個模組常常同時提供元件與指令，兩種都要列。
test('孤兒 import：pButton 指令算有用到 ButtonModule，不是孤兒', () => {
  assert.deepEqual(
    orphanModuleImports([
      { path: 'a.ts', ts: 'imports: [ButtonModule],', template: '<button pButton>送出</button>' },
    ]),
    [],
  );
});

test('孤兒 import：inline template 也算', () => {
  assert.deepEqual(
    orphanModuleImports([
      { path: 'a.ts', ts: 'imports: [TagModule], template: `<p-tag value="x" />`', template: '' },
    ]),
    [],
  );
});

// 對映表上沒有的模組不掃 —— 寧可漏報不要誤報
test('孤兒 import：不認識的模組不掃', () => {
  assert.deepEqual(
    orphanModuleImports([{ path: 'a.ts', ts: 'imports: [SomeUnknownModule],', template: '' }]),
    [],
  );
});

// ── 拇指區的兩條規則 ─────────────────────────────────────────────────────────

test('拇指區：抓得到標頭裡直接放的 p-button', () => {
  assert.deepEqual(
    headerActionButtons([
      { path: 'a.html', source: '<div class="x__header-actions"><p-button label="新增" /></div>' },
      {
        path: 'b.html',
        source: '<app-page-actions [primary]="p"><p-button label="匯入" /></app-page-actions>',
      },
      { path: 'c.html', source: '<div class="x__header-actions"></div>' },
    ]),
    ['a.html'],
  );
});

// 投影進 app-page-actions 的次要行動**不算違規** —— 它們本來就該在標頭。
// 這條防的是 gate 誤報，而誤報的 gate 會被關掉，那比沒有 gate 更糟。
test('拇指區：投影進 app-page-actions 的按鈕不算違規', () => {
  assert.deepEqual(
    headerActionButtons([
      {
        path: 'a.html',
        source:
          '<app-page-actions [primary]="p">\n  <p-button label="操作紀錄" />\n</app-page-actions>',
      },
    ]),
    [],
  );
});

test('拇指區：破壞性動詞當主要行動會被抓到', () => {
  const hits = destructivePrimaryActions([
    { path: 'a.ts', source: "readonly primaryAction: PageAction = { label: '刪除課程' };" },
    { path: 'b.ts', source: "readonly primaryAction: PageAction = { label: '新增課程' };" },
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'a.ts');
  assert.equal(hits[0].word, '刪除');
});

test('拇指區：破壞性清單涵蓋停用與結束，不只刪除', () => {
  const hits = destructivePrimaryActions([
    { path: 'a.ts', source: "PageAction = { label: '停用班級' };" },
    { path: 'b.ts', source: "PageAction = { label: '結束考試' };" },
  ]);
  assert.equal(hits.length, 2);
});

// ── A18：feature 之間不得互相 import（c5）────────────────────────────────────────────
//
// 這支跑真的檔案系統（它的工作就是解析相對路徑），所以用 mkdtemp 建一棵小樹，
// 而不是餵字串 —— 餵字串會把「路徑解析」這個唯一的重點測掉。
test('c5 只擋跨 feature，同 feature 與 features 外都放行', () => {
  const root = mkdtempSync(join(tmpdir(), 'c5-'));
  const features = join(root, 'features');
  const mk = (rel, body) => {
    mkdirSync(dirname(join(features, rel)), { recursive: true });
    writeFileSync(join(features, rel), body);
  };

  mk('admin/pages/a.ts', "import { x } from '../../teacher/pages/b';");
  mk('admin/pages/same.ts', "import { y } from '../other/c';");
  mk('admin/pages/out.ts', "import { z } from '../../../core/svc';");
  mk('teacher/pages/b.ts', 'export const x = 1;');

  const hits = crossFeatureImports(features, root);
  assert.equal(hits.length, 1, `只該有一筆跨 feature：${JSON.stringify(hits)}`);
  assert.equal(hits[0].from, 'admin');
  assert.equal(hits[0].to, 'teacher');
});

// **第一版漏掉別名。** 我掃了實際 import 用法、看到零次 `@features/`，就下了
// 「沒有這個別名」的結論 —— 但 tsconfig 裡它一直都在。**「沒有人用」不等於「不能用」**：
// 別名擺在那，任何人明天就能寫出一個只擋相對路徑的 gate 看不見的跨 feature import。
// 這條測試同時釘住兩件事：別名要抓得到、而且 tsconfig 真的有定義它們。
test('c5 也要抓別名寫法（@features/ 與 @app/features/）', () => {
  const root = mkdtempSync(join(tmpdir(), 'c5a-'));
  const app = join(root, 'app');
  const features = join(app, 'features');
  const mk = (rel, body) => {
    mkdirSync(dirname(join(features, rel)), { recursive: true });
    writeFileSync(join(features, rel), body);
  };
  const aliases = { '@features/': features, '@app/': app };

  mk('admin/a.ts', "import { x } from '@features/teacher/b';");
  mk('admin/b.ts', "import { y } from '@app/features/teacher/b';");
  mk('admin/c.ts', "import { z } from '@core/svc';"); // 不在 features 底下 → 放行
  mk('admin/d.ts', "import { w } from '@features/admin/other';"); // 同 feature → 放行
  mk('teacher/b.ts', 'export const x = 1;');

  const hits = crossFeatureImports(features, root, aliases);
  assert.equal(hits.length, 2, `兩種別名寫法都該抓到：${JSON.stringify(hits)}`);
  assert.ok(hits.every((h) => h.from === 'admin' && h.to === 'teacher'));
});

// tsconfig 真的定義了那些別名 —— 前提變了（例如有人加 @pages/*）這條會提醒去擴充 gate
test('c5 的別名清單與 tsconfig 對得上', () => {
  const raw = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../apps/web/tsconfig.json'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const paths = Object.keys(JSON.parse(raw).compilerOptions?.paths ?? {});
  const reachFeatures = paths.filter((p) => p === '@features/*' || p === '@app/*');
  assert.deepEqual(
    reachFeatures.sort(),
    ['@app/*', '@features/*'],
    `能走到 features 的別名變了（現有：${paths.join(', ')}）—— check-harness 的 aliases 要跟著改`,
  );
});

// icon 是非文字元素，WCAG 1.4.11 的門檻是 3:1 不是 4.5:1。
// warning-600 疊 warning-200 = 4.03，正好落在兩個門檻之間，四種情況一次分得開。
const ICON_BG = 'var(--warning-200)';
const ICON_FG = 'var(--warning-600)';

test('對比掃描：4.03 是文字就要抓', () => {
  // fixture 一律寫多行 —— 掃描是逐行的，而 PostToolUse 的 Prettier 保證 repo 裡
  // 不存在單行規則，所以這不是漏洞，但測試也不能寫成單行否則等於什麼都沒測
  assert.equal(
    scan(`
.x {
  background: ${ICON_BG};
  color: ${ICON_FG};
}
`).length,
    1,
  );
});

test('對比掃描：同樣的 4.03 落在 .pi 裡走 3:1，放行', () => {
  assert.deepEqual(
    scan(`
.x {
  background: ${ICON_BG};

  .pi {
    color: ${ICON_FG};
  }
}
`),
    [],
  );
});

test('對比掃描：class 名字帶 icon 也算非文字', () => {
  assert.deepEqual(
    scan(`
.x__icon {
  background: ${ICON_BG};
  color: ${ICON_FG};
}
`),
    [],
  );
});

test('對比掃描：icon 的 3:1 不是免死金牌 —— 2.35 連 3:1 都不過，照抓', () => {
  const dim = readTokenPalette(`
:root {
  --zinc-100: #f4f4f5;
  --zinc-400: #a1a1aa;
}
`);
  const found = usageContrastViolations(
    `
.y {
  background: var(--zinc-100);

  .pi {
    color: var(--zinc-400);
  }
}
`,
    dim,
  );
  assert.equal(found.length, 1, 'zinc-400 疊 zinc-100 只有 2.35，是 icon 也救不了');
  assert.ok(found[0].ratio < 3, `ratio=${found[0].ratio}`);
});
