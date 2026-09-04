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
import { dualTrackTables } from './lib/dual-track-table.mjs';
import { touchTargetViolations } from './lib/touch-target.mjs';
import { pendingWrites, toRepoPath } from './lib/hook-io.mjs';
import { missingUserSkills } from './lib/user-skills.mjs';
import { matchWriteRules, routeHints } from './lib/rules.mjs';
import { blankComments } from './lib/comments.mjs';
import { inlineCarriers } from './lib/inline-carriers.mjs';
import { recordScope, collectedScopes, diffScopes } from './lib/scan-scope.mjs';
import {
  findOrphanEndpoints,
  matchesPrefix,
  sendsParam,
  servicePrefixes,
  stripComments,
} from './lib/api-param-coverage.mjs';
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
test('c6 放過 var() 的 fallback 與註解，直接當值才擋', () => {
  // 直接當值 → 違規
  assert.deepEqual(guard('apps/web/a.scss', 'min-height: 100vh;'), ['c6']);
  assert.deepEqual(guard('apps/web/a.scss', '  max-height: 55vh;'), ['c6']);
  // var() 的 fallback → 放行
  assert.deepEqual(guard('apps/web/a.scss', 'height: var(--window-height, 100dvh);'), []);
  assert.deepEqual(
    guard('apps/web/a.scss', 'width: calc(var(--window-width, 100vw) - 32px) !important;'),
    [],
  );
  // 同一行先有 var() 收尾、後面才拿 viewport 當值 —— 不能被前面的 var( 蓋掉
  assert.deepEqual(guard('apps/web/a.scss', 'margin: var(--space-2, 8px); height: 100vh;'), ['c6']);
});

/**
 * **這一條反轉了先前的決定。** 舊版明文斷言「註解不豁免」，理由是
 * 「豁免邏輯本身會腐化，寧可要求註解別寫那個字面值」。
 *
 * 推翻它的兩個理由：
 *
 * 一、那個負擔的實際形狀是「**你不能寫下「不要用 90vw」這句話**」——
 * 而那正是最該留在檔案裡的註解（解釋為什麼不這樣做的那種）。
 * design-web 席 2026-09-04 實際中招。
 *
 * 二、原理由擔心的是**逐案豁免清單**會腐化，那個擔心是對的。但抹白註解不是清單，
 * 是**詞法規則** —— 它沒有要維護的條目，不會過期。
 *
 * 判斷權在共用 matcher，所以修這裡等於 gate 與 pre-write hook 同時修好。
 */
test('c6 不打註解裡的 viewport 單位 —— 解釋「為何不用」的那種註解最該留著', () => {
  assert.deepEqual(guard('apps/web/a.scss', '// flex col 100dvh 之後高度交給 flex'), []);
  assert.deepEqual(guard('apps/web/a.scss', '/* 這裡不能用 90vw，容器不是視窗寬 */'), []);
  // 程式碼與註解同時存在時，**程式碼那筆照樣擋**
  assert.deepEqual(guard('apps/web/a.scss', '// 別用 90vw\n.a { width: 90vw; }'), ['c6']);
  // 抹白保長度 —— 行號與位移不變，gate 報的第幾行才點得到
  assert.equal(blankComments('// 90vw\n.a{}', 'x.scss').length, '// 90vw\n.a{}'.length);
  // `https://` 不是註解，別把它後面的東西洗掉
  assert.equal(blankComments("const u = 'https://x/a';", 'x.ts'), "const u = 'https://x/a';");
  // c7：註解掉的舊寫法是死程式碼，不是違規
  assert.deepEqual(guard('apps/web/a.html', '<!-- 舊版是 *ngIf，已改 @if -->'), []);
  assert.deepEqual(guard('apps/web/a.html', '<div *ngIf="x"></div>'), ['c7']);
});

// A12（存量 gate）靠 id 從 pre-guard.rules.json 撈 c6 出來掃。
// 規則被改名或移除的話它會靜靜地什麼都不掃，而且**永遠是綠的** —— 這條守那個。
//
// c6 有**兩條**規則（.scss 與 .ts），因為兩種檔的**出路不一樣**：
// SCSS 改用 --window-* 變數，TS（PrimeNG dialog 寬度）改用 breakpoints 選項。
// 同一段訊息餵給兩邊，其中一邊拿到的建議會是行不通的。
test('c6 三個載體的規則都在，A12 的三次掃描才撈得到', () => {
  const c6 = guardRules.rules.filter((rule) => rule.id === 'c6');

  // **斷言涵蓋的載體，不是規則數量。** 數量是會一直要維護的脆判準
  // （加第三個載體時這條就紅了，而紅得沒有意義）；
  // 「`.scss` / `.ts` / `.html` 三種都有人守」才是真正的不變量。
  const covered = (ext) => c6.some((r) => new RegExp(r.path).test(`apps/web/src/app/a.${ext}`));
  for (const ext of ['scss', 'ts', 'html']) {
    assert.ok(covered(ext), `c6 的 .${ext} 載體沒人守 —— 那個檔型會靜默失效`);
  }

  // 每個載體的出路不一樣，訊息就不能共用：
  // SCSS 用 --window-* 變數、TS 用 PrimeNG breakpoints、HTML 是 [style.] 綁定與 index.html。
  // 訊息重複代表有人複製貼上，其中一邊拿到的建議會是行不通的。
  assert.equal(new Set(c6.map((r) => r.message)).size, c6.length, 'c6 各載體的訊息不該重複');
});

/**
 * c6 的 TS 側（2026-09-04 上線，**零 baseline**）。
 *
 * 存量是 #273 清成 0 的：14 處 PrimeNG dialog 的寬度從 min(400px, 96vw)
 * 換成 width: '400px' 配 breakpoints: { '640px': '96%' }。
 *
 * **為什麼 TS 這側不能叫人改用 var(--window-*)**：dialog 都掛在 body 上
 * （appendTo: 'body'），而變數是 WindowSizeDirective 寫在 .app 元素上的 ——
 * overlay 在它外面，變數解不到，那條路走不通。PrimeNG 自己的 breakpoints 才是出路。
 * 所以兩條規則的訊息不能共用：給 TS 的人一句「改用 CSS 變數」等於叫他繞遠路撞牆。
 */
test('c6 TS 側：dialog 寬度不准用 vw，breakpoints 放行', () => {
  assert.deepEqual(guard('apps/web/src/app/a.component.ts', "width: 'min(400px, 96vw)',"), ['c6']);
  // 正解 —— 不能連它一起擋，不然這道 gate 就是死路
  assert.deepEqual(
    guard('apps/web/src/app/a.component.ts', "breakpoints: { '640px': '96%' },"),
    [],
  );
  // spec 排除：測試可以合法斷言含 vw 的字串
  assert.deepEqual(guard('apps/web/src/app/a.component.spec.ts', "width: '96vw'"), []);
  // 掃描範圍是 web，不是 api
  assert.deepEqual(guard('apps/api/src/routes/a.ts', "const x = '96vw';"), []);
  // 註解豁免同樣適用（靠 blankComments）—— #273 之後最可能被寫的正是這種註解
  assert.deepEqual(guard('apps/web/src/app/a.component.ts', '// 別用 96vw，改 breakpoints'), []);
});

/**
 * c2 的 SQL 側（2026-09-04 上線，載體盲區掃描的產物）。
 *
 * gate 原本只掃 `apps/api/**\/*.ts`。它在那一側精確追蹤 5 筆永久豁免、每筆都有查證過的
 * `why`，程式碼裡還寫著「真債歸零」—— 而 `seed.sql` 有 9 條直接寫 ba_* 的語句，
 * `session_cleanup_cron` migration 還有 1 條 DELETE，**全都在掃描範圍外**。
 *
 * 「真債歸零」當時的真實含義是「**在我們碰巧會掃的那個載體裡**歸零」。
 *
 * ## 判準：擋 DML，不擋 schema
 *
 * `REFERENCES public.ba_user(id) ON DELETE SET NULL` 與 `ALTER TABLE public.ba_user`
 * 都**不是**違規 —— 那是關聯與約束，不是動資料。migrations 裡這兩種形狀有十幾處，
 * 全部要放行，不然這道 gate 第一天就會被關掉。
 *
 * `ON DELETE` 特別容易誤傷：它含 "DELETE" 但不是 `DELETE FROM`。
 */
test('c2 SQL 側：擋 DML，放行 schema 宣告', () => {
  // 用 seed.sql 當載體：`supabase/migrations/*` 這個路徑**同時**會命中 c3
  // （已提交的 migration 不可修改），那是正確行為但會讓 deepEqual 對不上。
  // migrations 路徑另外用最後一條斷言蓋。
  const sql = (text) => guard('supabase/seed.sql', text);

  assert.deepEqual(sql('DELETE FROM public.ba_session WHERE "expiresAt" < NOW();'), ['c2']);
  assert.deepEqual(sql('INSERT INTO public.ba_user (id) VALUES (1);'), ['c2']);
  assert.deepEqual(sql('UPDATE public.ba_user SET name = 1;'), ['c2']);
  // 沒有 public. 前綴也要抓
  assert.deepEqual(sql('DELETE FROM ba_account;'), ['c2']);

  // ── 放行：schema 宣告不是寫資料 ──
  // 這行同時含 "ba_user" 與 "DELETE"，是最容易誤傷的形狀
  assert.deepEqual(sql('user_id text REFERENCES public.ba_user(id) ON DELETE SET NULL,'), []);
  assert.deepEqual(
    sql('ALTER TABLE public.ba_user ADD CONSTRAINT ba_user_phone_key UNIQUE (phone);'),
    [],
  );
  // 別的表的 DML 不歸 c2 管
  assert.deepEqual(sql('DELETE FROM public.students;'), []);

  // 註解豁免：migrations 裡真的有「使用 ba_user(id) 而非 profiles(id)」這種說明
  assert.deepEqual(sql('-- 舊版是 DELETE FROM public.ba_user，已改走 API'), []);

  // migrations 路徑：c2 照樣抓，而且會**多帶一條 c3** —— 已提交的 migration
  // 不可修改。兩條都對：這種寫入既違反 c2，也不該用改舊檔的方式進來。
  assert.deepEqual(guard('supabase/migrations/x.sql', 'DELETE FROM public.ba_user;'), ['c2', 'c3']);
});

/**
 * inline 載體抽取（2026-09-04，gate 載體盲區掃描的產物）。
 *
 * **在 Angular 裡，`.ts` 檔同時也是模板、也是樣式表。** repo 有 15 支 inline template、
 * 2 支 inline styles，其中 `leave-form-dialog` 兩者皆是（沒有 `.html` 也沒有 `.scss`），
 * 於是它同時對 c7、雙軌表格、對比、ghost-token、page-actions 五道 gate 隱形。
 */
test('inline 載體：抽得出模板與樣式，抽不到的安靜跳過', () => {
  const comp = (body) => [{ path: 'a.component.ts', source: `@Component({${body}})` }];

  const both = inlineCarriers(
    comp('template: `<div *ngIf="x"></div>`, styles: [`.a { color: red; }`]'),
  );
  assert.equal(both.templates.length, 1);
  assert.equal(both.styles.length, 1);
  assert.match(both.templates[0].source, /\*ngIf/);
  assert.match(both.styles[0].source, /color: red/);

  // `styles: ``` 是空的樣板字串 —— repo 真的有一支（sessions.component.ts）。
  // 抽出空字串要當成「沒有樣式載體」，不然下游會拿到一堆空殼。
  assert.equal(inlineCarriers(comp('template: `<p>x</p>`, styles: ``')).styles.length, 0);

  // 用 templateUrl / styleUrl 的元件：沒有 inline 載體，兩邊都不該出現
  const external = inlineCarriers(comp("templateUrl: './a.html', styleUrl: './a.scss'"));
  assert.equal(external.templates.length, 0);
  assert.equal(external.styles.length, 0);

  // 不是元件的 .ts（service、guard…）不該被當成載體
  assert.equal(
    inlineCarriers([{ path: 'a.service.ts', source: 'const template = `<p>x</p>`;' }]).templates
      .length,
    0,
  );
});

/**
 * c7 的 inline template 載體。**立法時零違規**（repo 15 支 inline template
 * 一個 `*ngIf` 都沒有），所以零 baseline —— 那是最便宜的立法時機。
 */
test('c7 的 inline template 載體：.ts 裡的舊指令照擋', () => {
  assert.deepEqual(guard('apps/web/src/app/a.component.ts', 'template: `<div *ngIf="x">`'), ['c7']);
  assert.deepEqual(guard('apps/web/src/app/a.component.ts', 'template: `@if (x) { <div> }`'), []);
  // 註解掉的舊寫法是死程式碼，不是違規
  assert.deepEqual(guard('apps/web/src/app/a.component.ts', '// 舊版是 *ngIf，已改 @if'), []);
  assert.deepEqual(
    guard('apps/web/src/app/a.component.spec.ts', 'template: `<div *ngIf="x">`'),
    [],
  );
});

/**
 * c6 的 HTML 載體：`[style.height]` / `[ngStyle]` 綁定，以及 index.html 的
 * `<style>` 區塊 —— 那是全螢幕啟動畫面，**最容易伸手拿 100vh 的地方**，
 * 而它先前只被 c7 掃過（.html），c6 看不到。
 */
test('c6 的 HTML 載體：inline style 綁定與 index.html 的 <style>', () => {
  const html = (t) => guard('apps/web/src/app/a.component.html', t);

  assert.deepEqual(html('<div [style.height]="\'100vh\'"></div>'), ['c6']);
  assert.deepEqual(html('<div style="width: 90vw"></div>'), ['c6']);
  // var() 的 fallback 在這個載體一樣放行 —— 判準跨載體要一致
  assert.deepEqual(html('<div [style.height]="\'var(--window-height, 100dvh)\'"></div>'), []);
  // HTML 註解裡的不算
  assert.deepEqual(html('<!-- 這裡不能用 90vw -->'), []);
});

/**
 * 掃描範圍的 ratchet（2026-09-04）。
 *
 * A17 少掃 `shared/` 不知道多久，而**它一直是綠的** —— 因為沒有東西看著範圍本身。
 * review-steward 講得最準：「gate 說 0 筆，但它沒說『我只看了這些地方』」。
 *
 * 所以這支要抓的**主要**不是範圍擴大（那通常是刻意的），是**範圍靜靜縮小**。
 */
test('掃描範圍：縮小與擴大分開講，縮小才是主戲', () => {
  const was = { a: { roots: ['x', 'y'], exts: ['.scss'] } };

  // 縮小 —— 訊息要點名「不再掃什麼」，不然收到紅燈的人得自己比對兩份 JSON
  const shrunk = diffScopes({ a: { roots: ['x'], exts: ['.scss'] } }, was);
  assert.equal(shrunk.length, 1);
  assert.match(shrunk[0], /縮小/);
  assert.match(shrunk[0], /y/);

  // 擴大 —— 也要報（不然新 gate 的範圍永遠不會被記下來），但用字不同
  const grown = diffScopes({ a: { roots: ['x', 'y', 'z'], exts: ['.scss'] } }, was);
  assert.equal(grown.length, 1);
  assert.match(grown[0], /擴大/);

  // 整道 gate 消失 —— 最嚴重的一種，不能只當成「roots 空了」
  const gone = diffScopes({}, was);
  assert.match(gone[0], /整道 gate 不見了/);

  // 副檔名跟目錄要分開講：只掃 .scss 改成只掃 .ts 是「換了載體」不是「換了地方」
  const ext = diffScopes({ a: { roots: ['x', 'y'], exts: ['.ts'] } }, was);
  assert.equal(ext.length, 2, '一縮一擴要各報一筆');

  // **沒有變動就一個字都不印** —— 12 道每次刷一片會稀釋訊號
  assert.deepEqual(diffScopes({ a: { roots: ['x', 'y'], exts: ['.scss'] } }, was), []);
});

/**
 * 範圍收的是 walk 的**參數**，不是走出來的檔案路徑。
 *
 * 第一版從檔案路徑推導根目錄：零漂移，但**噪音太大** —— 新增一個
 * `apps/api/src/routes/<新功能>/` 子目錄就會讓 gate 變紅，而那跟範圍無關。
 * **每次都紅的 gate，人的反應是把它關掉。**
 */
test('掃描範圍：同一道 gate 記多次會累加，不會互相覆蓋', () => {
  // c2 掃兩處（apps/api 的 .ts 與 supabase 的 .sql），靠兩次 recordScope 疊起來
  recordScope('t', { roots: ['apps/api/src'], exts: ['.ts'] });
  recordScope('t', { roots: ['supabase'], exts: ['.sql'] });

  const { t } = collectedScopes();
  assert.deepEqual(t.roots, ['apps/api/src', 'supabase']);
  assert.deepEqual(t.exts, ['.sql', '.ts']);
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

// ── A17 的三項邊界（2026-09-04）────────────────────────────────────────────────────
//
// 焦點哨兵：鍵盤陷阱用的 1×1 元素是給 Tab 走的，使用者永遠不會用手指點它。
// 判準必須窄 —— 放寬到「很小就算哨兵」會把 32px 的小按鈕一起放掉，而那正是要抓的。
// **兩層寫法有三種等價的 SCSS 形式，三種都要認。**
//
// 2026-09-04 teacher-pages 首次外用時回報：他照交接文件寫兩層，gate 一筆都沒認。
// 原因是我的 self-test **只測了「@media 在頂層、選擇器已展開」那一種** ——
// 剛好是 dashboard 用的那種，也就是我唯一看過的那種。
// 巢狀 @media（SCSS 最慣用的寫法）的 44px 掛不到任何 selector 上，於是看不見。
//
// 這條測試存在的意義不是「測兩層寫法」，是**測三種形式的等價性** ——
// 只測其中一種，就是把「我看過的案例」誤當成「案例的全集」。
test('A17 認得兩層寫法的三種 SCSS 形式', () => {
  const t = (src) => touchTargetViolations([{ path: 'a.scss', source: src }]).map((v) => v.kind);

  // A：@media 在頂層、選擇器已展開
  assert.deepEqual(
    t(`.d { &__skip { min-height: 40px; cursor: pointer; } }
       @media (pointer: coarse) { .d__skip { min-height: 44px; } }`),
    [],
  );
  // B：@media 巢狀在規則裡面（最慣用）
  assert.deepEqual(
    t(`.d { &__skip { min-height: 40px; cursor: pointer;
           @media (pointer: coarse) { min-height: 44px; } } }`),
    [],
  );
  // C：@media 在父層區塊裡、內含展開的選擇器
  assert.deepEqual(
    t(`.d { &__skip { min-height: 40px; cursor: pointer; }
           @media (pointer: coarse) { .d__skip { min-height: 44px; } } }`),
    [],
  );

  // **反例**：放寬到三種形式之後，這些仍然要擋
  assert.deepEqual(t('.d { &__skip { min-height: 40px; cursor: pointer; } }'), ['below-threshold']);
  assert.deepEqual(t('.d { &__skip { padding: 0; cursor: pointer; } }'), ['no-floor']);
  assert.deepEqual(
    t(`.d { &__skip { cursor: pointer;
           @media (pointer: coarse) { min-height: 32px; } } }`),
    ['below-threshold'],
  );
});

test('A17 放行 1×1 焦點哨兵，但不放行小按鈕', () => {
  const t = (src) => touchTargetViolations([{ path: 'a.scss', source: src }]).map((v) => v.kind);
  assert.deepEqual(t('.sentinel { width: 1px; height: 1px; cursor: pointer; }'), []);
  assert.deepEqual(t('.s2 { width: 2px; height: 2px; cursor: pointer; }'), []);
  // **反例**：32px 的小按鈕仍然要擋
  assert.deepEqual(t('.btn { width: 32px; height: 32px; cursor: pointer; }'), ['below-threshold']);
  // 只有一軸很小 → 不是哨兵（可能是一條可點的細長條）
  assert.deepEqual(t('.bar { height: 1px; cursor: pointer; }'), ['below-threshold']);
});

// ── 雙軌表格 ────────────────────────────────────────────────────────────────────────
//
// 訊號是 SCSS 裡**互補的 display 開關**：基準藏 A、條件顯 A、條件藏 B。
// 反例比正例重要，因為第一版（認 \`__mobile*\` 命名）就是被反例的反面咬到的 ——
// 它漏掉手機版叫 \`__record-cards\` 的那一支，還把它誤判成「破版」推出了一個假需求。
const SCSS_PAIR = `
  .b {
    &__cards { display: none; }
  }
  @include respond-to('tablet-portrait') {
    .b {
      &__table-wrap { display: none; }
      &__cards { display: grid; }
    }
  }
`;

test('雙軌表格認互補 display 開關，不認命名', () => {
  const t = (template, scss) => dualTrackTables([{ path: 'a.html', template, scss }]);
  const TABLE = '<table><tr><td>x</td></tr></table>';

  const hit = t(TABLE, SCSS_PAIR);
  assert.equal(hit.length, 1);
  // 報告要說出是哪一組在翻面，不然收到紅燈的人得自己再找一次
  assert.equal(hit[0].shown, '.b__cards');
  assert.equal(hit[0].hidden, '.b__table-wrap');

  // 命名完全無關 —— 這是第一版漏掉第四支的原因
  assert.equal(t(TABLE, SCSS_PAIR.replaceAll('cards', 'zzz')).length, 1);

  // 反例一：沒有 <table> —— 非表格元件的手機變體，不歸這支管
  assert.equal(t('<div>no table</div>', SCSS_PAIR).length, 0);

  // 反例二：有表格、有基準 display:none，但**沒有翻面** ——
  // invoice-detail-dialog 的列印節點就長這樣，它不是雙軌
  assert.equal(t(TABLE, '.b { &__print-source { display: none; } }').length, 0);

  // 反例三：條件裡只藏東西、沒有任何軌道被放出來
  assert.equal(
    t(TABLE, "@include respond-to('x') { .b { &__table-wrap { display: none; } } }").length,
    0,
  );

  // 反例四：responsive-table 的形狀 —— 單軌，零個 display:none
  assert.equal(t(TABLE, "@include respond-to('x') { .b { &__cell { padding: 4px; } } }").length, 0);
});

// 去重的鍵是「這一對宣告的位置」，不是顏色值。這組測試守的是一個真的踩過的洞：
// 舊版用 `fg.src|bg.src`，於是同一支檔案裡第二個湊出同樣配色的地方會靜靜消失 ——
// 第一筆若被 baseline 或豁免蓋住，那個新違規等於完全不存在。
// 實際吞掉過 class-form-dialog 的 `&__dash`。
test('對比掃描：同一支檔案裡兩個不同的地方湊出同樣配色，兩筆都要報', () => {
  const found = scan(`
.a {
  background: ${ICON_BG};
  color: ${ICON_FG};
}

.b {
  background: ${ICON_BG};
  color: ${ICON_FG};
}
`);
  assert.equal(found.length, 2, '兩個獨立的宣告位置就是兩筆違規，不能只報第一筆');
  assert.deepEqual(
    found.map((v) => v.selector),
    ['.a', '.b'],
  );
});

test('對比掃描：後代從同一個祖先繼承同一組配色，只報一次（噪音仍然要收）', () => {
  const found = scan(`
.card {
  background: ${ICON_BG};
  color: ${ICON_FG};

  .one {
    font-weight: 600;
  }

  .two {
    font-weight: 400;
  }
}
`);
  assert.equal(found.length, 1, 'fg / bg 來自同兩行，是同一個問題');
});

test('對比掃描：違規要帶著選擇器回報（baseline 與豁免的鍵靠它才夠精確）', () => {
  const found = scan(`
.x__thing {
  background: ${ICON_BG};
  color: ${ICON_FG};
}
`);
  assert.equal(found[0].selector, '.x__thing');
});

// ── API query 參數覆蓋率 ─────────────────────────────────────────────────────────────
// **反例優先。** 這道 gate 的第一版有兩個洞，都是「用訊號看得到的案例去驗證訊號」
// 造成的：整檔 grep 對普通名字全盲（`status` 因為註解提到就算數）、
// 只認引號害物件簡寫 `{ params: { date } }` 被誤報成缺漏。
// 所以這裡兩個方向都測：**該紅的要紅，該安靜的要安靜。**

test('sendsParam 認得四種組 query 的寫法', () => {
  assert.equal(sendsParam(`p = p.set('dateFrom', x);`, 'dateFrom'), true, 'HttpParams .set()');
  assert.equal(sendsParam(`query['status'] = params.status;`, 'status'), true, 'Record 賦值');
  assert.equal(sendsParam(`this.http.get(url, { params: { date } });`, 'date'), true, '物件簡寫');
  assert.equal(
    sendsParam(`const query: Record<string, string> = { dateFrom: a, dateTo: b };`, 'dateFrom'),
    true,
    '先組物件再傳',
  );
});

// 誤報方向：名字出現在註解裡不算「有支援」。
// invoices.service.ts 的檔頭寫著「`status` / `total` 全由後端推導」，
// 第一版因此認為它支援 status —— 即使組 query 那一行被刪掉也不會紅。
test('sendsParam 不把註解裡的名字當成有支援', () => {
  const source = ` * **狀態不是欄位** —— \`status\` 由後端推導\n  return this.http.get(url);`;
  assert.equal(sendsParam(stripComments(source), 'status'), false);
});

test('sendsParam 對純粹出現在別處的名字保持否定', () => {
  assert.equal(sendsParam(`interface Q { status?: InvoiceStatus }`, 'status'), false);
});

test('servicePrefixes 不綁前面的變數名，也剔除註解', () => {
  const source = [
    '  private readonly endpoint = `${this.baseUrl}/api/classes`;',
    '  // 見 /api/leaves 的說明',
  ].join('\n');
  assert.deepEqual(servicePrefixes(source), ['/api/classes'], 'baseUrl 也要抓到、註解裡的不算');
});

test('matchesPrefix 有邊界，不會讓 /api/classes 命中 /api/classes-archive', () => {
  assert.equal(matchesPrefix('/api/classes/{id}/sessions', '/api/classes'), true);
  assert.equal(matchesPrefix('/api/classes-archive', '/api/classes'), false);
});

test('findOrphanEndpoints 把沒人認領的端點列出來，不靜靜跳過', () => {
  const apiParams = { '/api/meals': ['date'], '/api/session-packs': ['studentId'] };
  const services = [{ file: 'meals.service.ts', source: '`${environment.apiUrl}/api/meals`' }];
  assert.deepEqual(findOrphanEndpoints(apiParams, services), ['/api/session-packs']);
});
