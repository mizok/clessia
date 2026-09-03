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
import { bandContrastViolations } from './lib/band-contrast.mjs';
import { readTokenPalette, usageContrastViolations } from './lib/scss-contrast.mjs';
import { countDesktopFirst, desktopFirstFiles } from './lib/mobile-first.mjs';
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
