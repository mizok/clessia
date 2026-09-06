#!/usr/bin/env node
/**
 * Harness gate — asserts that the agent-facing docs still describe reality.
 *
 * Two modes, one script:
 *   node tools/agent-harness/check-harness.mjs           # --check (default): stale → exit 1
 *   node tools/agent-harness/check-harness.mjs --write    # regenerate the generated blocks
 *
 * What this gate does NOT prove: that any skill or doc is *good*, only that what the docs
 * claim exists actually exists. Semantic quality is a review/LLM job, not a gate's.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatGenerated } from './lib/format.mjs';
import { bandContrastViolations } from './lib/band-contrast.mjs';
import { readTokenPalette, usageContrastViolations } from './lib/scss-contrast.mjs';
import { countDesktopFirst, desktopFirstFiles } from './lib/mobile-first.mjs';
import { orphanModuleImports } from './lib/orphan-imports.mjs';
import { destructivePrimaryActions, headerActionButtons } from './lib/page-actions.mjs';
import { matchWriteRules } from './lib/rules.mjs';
import { crossFeatureImports } from './lib/feature-boundaries.mjs';
import { dualTrackTables } from './lib/dual-track-table.mjs';
import { blankComments } from './lib/comments.mjs';
import { inlineCarriers, inlineStyles, inlineTemplate } from './lib/inline-carriers.mjs';
import { recordScope, collectedScopes, diffScopes } from './lib/scan-scope.mjs';
import { definedClasses, unstyledInteractive } from './lib/orphan-class.mjs';
import {
  collectApiParams,
  findMissing,
  findOrphanEndpoints,
  loadServices,
} from './lib/api-param-coverage.mjs';
import { touchTargetViolations, TOUCH_MIN_PX } from './lib/touch-target.mjs';
import { missingUserSkills } from './lib/user-skills.mjs';
import { usesRawSupabase } from './lib/parent-route-scan.mjs';
import guardRules from './rules/pre-guard.rules.json' with { type: 'json' };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CONTRAST_BASELINE = join(ROOT, 'tools/agent-harness/scss-contrast-baseline.json');

/**
 * 對比檢查的**永久豁免**，語意跟 `scss-contrast-baseline.json` 完全不同：
 *
 * - baseline JSON 是**債** —— 該修但還沒排到，目標是歸零。
 * - 這張表是**豁免** —— 有明文依據或設計上不該修，不會歸零，所以每一筆都要寫理由。
 *
 * **為什麼豁免寫在程式碼裡而不是 JSON**：baseline 那支 JSON 由
 * `npm run harness:write` 重生，理由欄位會被靜默沖掉。一個沒有理由的豁免
 * 就只是一個沒人敢動的數字 —— 那正是帳本規則要防的東西。
 *
 * 鍵的格式跟 baseline 一樣：`檔案|選擇器|前景|背景`。
 * **選擇器一定要在鍵裡** —— 只用 `檔案|前景|背景` 的話，一筆豁免會把同一支檔案裡
 * 所有同色配對的違規一起蓋掉（實測過，而且真的吞掉過一筆 `&__dash`）。
 * **豁免對不上任何實際違規時 gate 會紅** —— 一筆指向已經不存在的地方的豁免是謊，
 * 不是保險；改完就要把它刪掉。
 */
const CONTRAST_EXEMPT = {
  // ─ 空狀態的大圖示：WCAG 1.4.11 明文豁免「純裝飾」 ─
  // 三處都是同一個形狀：一個 24–40px 的灰圖示，旁邊必定有標題與說明文字，
  // 圖示不承載任何文字沒講的資訊。提高對比會讓它從「氣氛」變成「重點」。
  'apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.scss|.pi|var(--zinc-400)|var(--zinc-100)':
    '空狀態圖示（.pi 24px，圓底 zinc-100），旁邊有 __empty-title 承載全部資訊 —— 1.4.11 純裝飾豁免',
  'apps/web/src/app/features/admin/pages/grades/exams/score-entry/school-score-editor/school-score-editor.component.scss|i|var(--zinc-300)|var(--zinc-50)':
    '空狀態圖示（i 40px），同一個容器裡的 zinc-500 說明文字承載資訊 —— 1.4.11 純裝飾豁免',
  'apps/web/src/app/shared/components/empty-state/empty-state.component.scss|i|var(--zinc-400)|var(--zinc-100)':
    '共用空狀態元件的圖示（i 28px，圓底 zinc-100），__title 與說明文字承載資訊 —— 1.4.11 純裝飾豁免',

  // ─ disabled 控制項：WCAG 1.4.3 明文豁免 ─
  'apps/web/src/app/features/admin/pages/courses/class-form-dialog/class-form-dialog.component.scss|&:disabled|var(--zinc-400)|var(--zinc-50)':
    'disabled 輸入框 —— 1.4.3 明文豁免；提高對比反而讓它看起來可以按（理由也寫在該處）',
};
const MOBILE_FIRST_BASELINE = join(ROOT, 'tools/agent-harness/mobile-first-baseline.json');
const PAGE_ACTIONS_BASELINE = join(ROOT, 'tools/agent-harness/page-actions-baseline.json');
const TOUCH_TARGET_BASELINE = join(ROOT, 'tools/agent-harness/touch-target-baseline.json');
const API_PARAM_BASELINE = join(ROOT, 'tools/agent-harness/api-param-baseline.json');

/**
 * 觸控尺寸的**永久豁免**。語意跟 `touch-target-baseline.json` 不同，
 * 跟 `CONTRAST_EXEMPT` 同一個形狀（連「為什麼寫在程式碼裡」的理由都一樣）：
 *
 * - baseline JSON 是**債** —— 該修但還沒排到，目標歸零。
 * - 這張表是**豁免** —— 沒有合規路徑或修了反而更糟，不會歸零，所以必須寫理由。
 *
 * 豁免寫在這裡而不是 JSON，因為 baseline 由 `npm run harness:write` 重生，
 * 理由欄位會被靜默沖掉 —— 沒有理由的豁免只是一個沒人敢動的數字。
 *
 * 鍵的格式跟 baseline 一樣：`檔案|選擇器`。
 * **豁免對不上任何實際違規時 gate 會紅** —— 指向已經不存在的地方的豁免是謊。
 */
const TOUCH_TARGET_EXEMPT = {
  // ─ 三筆 `<tr>`：真正的修復在 responsive-table，不在這三個檔 ─
  // `min-height` 對 `display: table-row` **不生效**，所以在這裡加任何下限都是
  // 看起來修好、實際沒有的假修復。唯一能抬高列的是儲存格的內距，而那住在共用的
  // `responsive-table`（`@media (pointer: coarse)` 的 `__cell { padding-block }`，
  // 已經加了，一行同時解決三個頁面與未來每一張表）。
  //
  // 尺寸跨檔案來自共用元件，是這個 gate 已知的盲區 —— 它只看得到單一檔案。
  'apps/web/src/app/features/admin/pages/contact-book/contact-book.page.scss|.contact-book__row':
    '<tr>，列高由 responsive-table 的 __cell padding-block 決定（coarse 下已抬到 ≈44.5px）；min-height 在 table-row 上不生效',
  'apps/web/src/app/features/admin/pages/enrollments/enrollments.page.scss|.enrollments__row':
    '同上：<tr>，真正的修復在 responsive-table 的共用 coarse 區塊',
  'apps/web/src/app/features/admin/pages/payments/payments.page.scss|.payments__row':
    '同上：<tr>，真正的修復在 responsive-table 的共用 coarse 區塊',

  // ─ 原生 checkbox：撐大它會讓方框本身變巨大 ─
  'apps/web/src/app/features/admin/pages/courses/class-row/class-row.component.scss|.batch-checkbox':
    '15×15 原生 checkbox，坐在 min-height 44px 的 class-row__summary 裡，而且它的 (change) 與外層 (click) 發同一個 toggleSelection —— 同一個動作已經有 44px 的目標。原生 checkbox 的 width/height 直接改視覺尺寸不是內距，撐大只會讓方框變巨大',
};
const DUAL_TRACK_BASELINE = join(ROOT, 'tools/agent-harness/dual-track-baseline.json');
const SCAN_SCOPE = join(ROOT, 'tools/agent-harness/scan-scope.json');
const AGENTS_MD = join(ROOT, 'AGENTS.md');
const SKILLS_DIR = join(ROOT, '.agents/skills');
const THIN_ENTRYPOINTS = ['CLAUDE.md'];
const THIN_MAX_LINES = 60;

const START =
  '<!-- SKILLS:START — auto-generated by tools/agent-harness/check-harness.mjs; do not hand-edit -->';
const END = '<!-- SKILLS:END -->';

const mode = process.argv.includes('--write') ? 'write' : 'check';
const failures = [];
const fail = (message) => failures.push(message);
/** 看得見但不擋人的缺口 —— 不影響 exit code。 */
const warnings = [];

/**
 * `skills-lock.json` 是 AGENTS.md skill 表的真相來源；磁碟用來重生 lock。
 *
 * 由來：skill 一度只有部分進版控（`.agents/` 被 gitignore，但多數檔案在規則加上去之前
 * 就已經在裡面了），CI 的 clone 因此看到部分存在的目錄，第一次跑就紅。現在 skill 全部
 * 進版控，兩個環境看到的是同一份，lock 保留下來作為文件與現實之間的明確接縫。
 */
const LOCK = join(ROOT, 'tools/agent-harness/skills-lock.json');

/** Canonical order: plain alphabetical. Never rely on readdir order — it is platform-dependent. */
function skillsOnDisk() {
  if (!existsSync(SKILLS_DIR)) return null; // 目錄不存在 → 無從比對，不是錯誤
  const names = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(SKILLS_DIR, name, 'SKILL.md')))
    .sort();
  return names.map((name) => {
    const entry = { name, description: skillDescription(name) };
    const source = skillOrigin(name);
    if (source) entry.source = source;
    return entry;
  });
}

/**
 * 選擇性的 `ORIGIN` 檔（`<url> <ref>`）記錄該 skill 的 upstream。
 *
 * 只有 angular-scss-bem-standards 有 —— 它原本是一個巢狀 git clone，於是 git 只存了一個
 * 160000 gitlink 而非內容，clone 出來是空目錄（CI 因此紅過）。解除巢狀 repo 之後，
 * upstream 就靠這個檔案留存。其餘 skill 沒有 upstream，就是這份。
 */
function skillOrigin(name) {
  const path = join(SKILLS_DIR, name, 'ORIGIN');
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
}

function skillDescription(name) {
  const source = readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
  const match = /^description:\s*(.+)$/m.exec(source.slice(0, 2000));
  const text = match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
  return text.length > 110 ? `${text.slice(0, 107)}…` : text;
}

/** 遞迴列出副檔名相符的檔案。A10 / A11 / A12 共用 —— 原本各自帶一份一樣的閉包。 */
function walk(dir, ext) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(dir, entry.name), ext)
      : entry.name.endsWith(ext)
        ? [join(dir, entry.name)]
        : [],
  );
}

function readLock() {
  if (!existsSync(LOCK)) return [];
  return JSON.parse(readFileSync(LOCK, 'utf8')).skills ?? [];
}

function renderSkillBlock(skills) {
  if (skills.length === 0) return '_（`skills-lock.json` 目前是空的。）_';
  return [
    '| Skill | 用途 |',
    '| --- | --- |',
    ...skills.map((skill) => `| \`${skill.name}\` | ${skill.description || '—'} |`),
  ].join('\n');
}

function spliceBlock(source, inner) {
  const from = source.indexOf(START);
  const to = source.indexOf(END);
  if (from === -1 || to === -1 || to < from) return null;
  return `${source.slice(0, from + START.length)}\n\n${inner}\n\n${source.slice(to)}`;
}

function currentInner(source) {
  const from = source.indexOf(START);
  const to = source.indexOf(END);
  if (from === -1 || to === -1 || to < from) return null;
  return source.slice(from + START.length, to).trim();
}

/**
 * Compare on content, not on layout. The PostToolUse formatter owns this file and re-aligns
 * markdown table padding after `--write` renders it — comparing raw strings made the gate go
 * red on every prettier run, and regenerating produced output prettier changed right back.
 * Collapsing inter-cell whitespace and separator-row dashes leaves the assertion intact
 * (adding, removing or renaming a skill still changes the normalized form) without the ping-pong.
 */
function normalize(block) {
  return block
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/-{2,}/g, '-')
        .replace(/[ \t]+/g, ' '),
    )
    .filter((line) => line !== '')
    .join('\n');
}

// ── A1a. skills-lock.json 與磁碟一致（只在磁碟有 skill 目錄時，即本機）────────────────────
const onDisk = skillsOnDisk();

if (mode === 'write' && onDisk && onDisk.length > 0) {
  writeFileSync(
    LOCK,
    `${JSON.stringify(
      {
        note: 'AGENTS.md skill 表的真相來源。skill 本身也進版控；這份 manifest 是文件與磁碟之間的明確接縫。重生：npm run harness:write',
        skills: onDisk,
      },
      null,
      2,
    )}\n`,
  );
}

const locked = readLock();

// skill 現在全部進版控，所以 CI 的 clone 與本機看到的是同一份 —— 這個比對兩邊都跑。
// （先前 `.agents/` 被 gitignore 但多數 skill 早已在版控裡，CI 看到的是部分存在的目錄，
//  當時只能用 process.env.CI 跳過。把版控狀態弄一致之後那個 workaround 就不需要了。）
if (mode !== 'write' && onDisk && JSON.stringify(onDisk) !== JSON.stringify(locked)) {
  fail('skills-lock.json 與 .agents/skills/ 磁碟現況不符。重生：npm run harness:write');
}

// ── A6. 每個 skill 在各 CLI 目錄都有 symlink ─────────────────────────────────────────────
// `.agents/skills/` 是真身，其餘 CLI 目錄靠相對 symlink 共用同一份。這個結構會無聲漂掉：
// 實際發生過 —— .codex 少了 angular-scss-bem-standards（而 AGENTS.md 明文要求寫 SCSS 前
// 先 invoke 它），沒有任何東西發現。
const SYMLINK_TARGETS = ['.claude', '.codex'];
// Claude 由 plugin 取得 ui-ux-pro-max，不需要本地副本；其餘 CLI 沒有 plugin 機制。
const SYMLINK_EXEMPT = { '.claude': ['ui-ux-pro-max'] };

for (const dir of SYMLINK_TARGETS) {
  const skillsDir = join(ROOT, dir, 'skills');
  if (!existsSync(skillsDir)) continue;
  const exempt = SYMLINK_EXEMPT[dir] ?? [];
  for (const { name } of locked) {
    if (exempt.includes(name)) continue;
    if (!existsSync(join(skillsDir, name, 'SKILL.md'))) {
      fail(`${dir}/skills/${name} 不存在或斷鏈 —— 該 CLI 叫不到這個 skill。`);
    }
  }
}

// ── A1b. AGENTS.md 的表格與 lock 一致（CI 只驗得到這一段，因為它沒有 skill 檔）───────────
const agentsSource = readFileSync(AGENTS_MD, 'utf8');
const inner = renderSkillBlock(locked);

if (spliceBlock(agentsSource, inner) === null) {
  fail(`AGENTS.md 缺少 SKILLS:START / SKILLS:END marker，無法同步 skill 清單。`);
} else if (mode === 'write') {
  writeFileSync(AGENTS_MD, spliceBlock(agentsSource, inner));
  formatGenerated([AGENTS_MD], ROOT);
  console.log('✓ AGENTS.md skill 清單已重生');
} else if (normalize(currentInner(agentsSource)) !== normalize(inner)) {
  fail('AGENTS.md 的 skill 清單與 skills-lock.json 不符。重生：npm run harness:write');
}

// ── A2. CLAUDE.md stays a thin importer ──────────────────────────────────────────────────
for (const name of THIN_ENTRYPOINTS) {
  const path = join(ROOT, name);
  if (!existsSync(path)) continue;
  const source = readFileSync(path, 'utf8');
  const lines = source.split('\n').length;
  if (!source.includes('@AGENTS.md')) {
    fail(`${name} 沒有 import AGENTS.md — 專案規則的單一真相是 AGENTS.md（clause c10）。`);
  }
  if (lines > THIN_MAX_LINES) {
    fail(
      `${name} 有 ${lines} 行，超過 ${THIN_MAX_LINES} 行上限 — 規則請寫進 AGENTS.md（clause c10）。`,
    );
  }
}

// ── A3. no parallel documentation tree (clause c9) ───────────────────────────────────────
for (const stray of ['doc', 'docs']) {
  if (existsSync(join(ROOT, stray))) {
    fail(`偵測到 ${stray}/ 目錄。文件只准放 kb/（clause c9）。`);
  }
}

// ── A5. every clause cited anywhere in the harness exists in the constitution ────────────
// The guard blocks a write citing a clause id, and the router tells the agent which clause to
// read. Renumbering the law without updating them points the agent at a phantom article —
// which is exactly what happened the first time these clauses were renumbered.
const constitutionPath = join(ROOT, 'kb/wiki/architecture/constitution.md');
if (!existsSync(constitutionPath)) {
  fail('kb/wiki/architecture/constitution.md 不存在，但 harness 規則引用它。');
} else {
  const law = readFileSync(constitutionPath, 'utf8');
  const declared = new Set([...law.matchAll(/^###\s+(c\d+)\s/gm)].map((match) => match[1]));
  const sources = {
    'pre-guard': 'tools/agent-harness/rules/pre-guard.rules.json',
    'doc-router': 'tools/agent-harness/rules/doc-router.rules.json',
  };
  for (const [label, relPath] of Object.entries(sources)) {
    // ids come from rule.id (pre-guard) and from free text in the router's hints
    const raw = readFileSync(join(ROOT, relPath), 'utf8');
    const cited = [...new Set([...raw.matchAll(/\bc(\d+)\b/g)].map((match) => `c${match[1]}`))];
    for (const id of cited.sort()) {
      if (!declared.has(id)) fail(`${label} 引用了憲法沒有的條款 ${id}（${relPath}）。`);
    }
  }
}

// ── A7. 每一支 API route 掛載時都宣告了可用角色（clause c1）─────────────────────────────
// 這個洞當初長出來的方式：新增 route 時沒有人想到要限制角色，而預設是全開。
// 18 支 route 裡只有 2 支擋了角色，其餘任何登入者（含家長）都讀得到全組織的學生與成績。
// 見 kb/wiki/architecture/role-authorization.md
const apiIndex = join(ROOT, 'apps/api/src/index.ts');
if (existsSync(apiIndex)) {
  const source = readFileSync(apiIndex, 'utf8');

  for (const [, path] of source.matchAll(/app\.route\('(\/api\/[^']+)'/g)) {
    fail(`${path} 用 app.route 掛載，沒有宣告可用角色。改用 mount(path, route, roles)`);
  }

  for (const [call, path] of source.matchAll(/mount\('(\/api\/[^']+)'[^;]*;/g)) {
    // mount(path, route, roles) —— 少了第三個引數就是忘了宣告
    if (call.split(',').length < 3) {
      fail(`${path} 的 mount() 少了角色宣告`);
    }
  }
}

// ── A7b. 細部權限的詞彙表每一個值都要有 mount 真的用到（clause c1）─────────────────────
// 七個權限裡只有 manage_finance 與 view_reports 在 API 有效力，其餘五個只擋前端 ——
// 直接打 API 就繞過去。middleware/auth.ts 的註解自己寫著「那是畫面控制不是授權」，
// 金流補了、其餘沒有。見 kb/wiki/architecture/authorization-scope.md 洞 2。
const permissionsFile = join(ROOT, 'apps/api/src/lib/permissions.ts');
if (existsSync(apiIndex) && existsSync(permissionsFile)) {
  const vocabulary = [
    ...readFileSync(permissionsFile, 'utf8')
      .slice(readFileSync(permissionsFile, 'utf8').indexOf('export const PERMISSIONS'))
      .matchAll(/'([a-z_]+)'/g),
  ].map(([, value]) => value);
  const source = readFileSync(apiIndex, 'utf8');
  const enforced = new Set(
    [...source.matchAll(/\{\s*(?:all|write):\s*'([a-z_]+)'\s*\}/g)].map(([, value]) => value),
  );
  // 不是靠 mount 而是靠路由自己掛的（例如組織設定的 writeRequiresAdmin）也算數
  for (const [, value] of readdirSync(join(ROOT, 'apps/api/src/routes'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
    .flatMap((name) => [
      ...readFileSync(join(ROOT, 'apps/api/src/routes', name), 'utf8').matchAll(
        /writeRequiresAdmin\('([a-z_]+)'\)/g,
      ),
    ])) {
    enforced.add(value);
  }
  // 這一個不是 mount 擋的，是 lib/campus-scope.ts 在 middleware 裡讀的
  enforced.add('all_campuses');
  // 這一個比 mount 細，在 staff.ts 的 handler 裡依 body 判斷
  enforced.add('manage_roles');

  for (const permission of vocabulary) {
    if (!enforced.has(permission)) {
      fail(
        `權限 ${permission} 沒有任何 API 在強制 —— 它只擋得住前端選單，` +
          `直接打 API 就繞過去了（見 kb/wiki/architecture/authorization-scope.md 洞 2）`,
      );
    }
  }
}

// ── A7c. 每一支碰 campus_id 的路由都要接上分校預設過濾（clause c1）──────────────────────
// 「指名別的分校」由全域的 campusRequestGuard 擋住，但「沒指定時只回自己的分校」
// 要各路由自己過濾。**14 支已全部接上，所以這條從提醒升級成擋。**
//
// 升級的理由：覆蓋率一旦完整，下一個洞就不會是「還沒做完」而是「新路由忘了接」——
// 而那種洞是靜默的（查詢正常回應，只是回了不該看的資料）。漸進期用提醒是對的，
// 完成之後還留在提醒就等於把門開著。
{
  const routesDir = join(ROOT, 'apps/api/src/routes');
  const pending = [];
  for (const name of readdirSync(routesDir)) {
    if (!name.endsWith('.ts') || name.endsWith('.spec.ts')) continue;
    const source = readFileSync(join(routesDir, name), 'utf8');
    if (!/campus_id|campusId/.test(source)) continue;
    // ⚠️ **`getCampusScope` 要明著列出來，不能靠 `campusScope` 這個 substring** ——
    // 大小寫不同（`getCampusScope` 裡是 `CampusScope`），所以 #515 把 20 個讀取點
    // 從 `c.get('campusScope')` 遷到 `getCampusScope(c)` 之後，這道 gate 當場對
    // 五支路由紅了。**它辨識「有沒有接分校過濾」靠的是識別字，而識別字被改名了。**
    // 這一族在本 repo 記過（識別字在兩個載體之間對不上）；這次是 harness 自己攔下的。
    if (/campusFilterIds|campusScope|getCampusScope/.test(source)) continue;
    pending.push(name);
  }
  for (const name of pending) {
    fail(
      `routes/${name} 碰 campus_id 但沒有接分校預設過濾 —— ` +
        `用 lib/campus-scope.ts 的 applyCampusFilter / campusFilterIds。` +
        `沒指定分校時要縮到呼叫者的 campusScope，不是回全部` +
        `（見 kb/wiki/architecture/authorization-scope.md 洞 5）`,
    );
  }
}

// ── A8. 每張業務表都啟用了 RLS（clause c1 的 fail-closed 後盾）─────────────────────────
// 這是靜態掃 migration 而不是查 DB：gate 在 CI 上跑，那裡沒有資料庫。
// 漂移是這樣發生的：早期的表都有開，後來新增的忘了，而沒有任何東西會提醒。
// 30 張表裡有 16 張就這樣一路沒開。
const MIGRATIONS = join(ROOT, 'supabase/migrations');
if (existsSync(MIGRATIONS)) {
  const sql = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');

  // Better Auth 的表不歸我們管（c2）
  const created = [
    ...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)/gi),
  ]
    .map((m) => m[1])
    .filter((name) => !name.startsWith('ba_'));

  const rlsEnabled = new Set(
    [
      ...sql.matchAll(/alter\s+table\s+(?:public\.)?([a-z_]+)\s+enable\s+row\s+level\s+security/gi),
    ].map((m) => m[1]),
  );

  // 建了又刪的不算 —— school_exam_schedules 就是這樣被誤報的
  const dropped = new Set(
    [...sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_]+)/gi)].map(
      (m) => m[1],
    ),
  );

  for (const table of new Set(created)) {
    if (dropped.has(table)) continue;
    if (!rlsEnabled.has(table)) {
      fail(`業務表 ${table} 沒有 ENABLE ROW LEVEL SECURITY（c1 的 fail-closed 後盾）`);
    }
  }
}

// ── A10. 不依賴雲端供應商的專屬服務（clause c12）─────────────────────────────────────────
// c12：客戶必須能夠取走資料、在自己的基礎設施上運行整套系統。用了 Workers KV / R2 /
// Durable Objects 之類的專屬服務，客戶的自架環境就得先有那個東西 —— 離開的權利就消失了。
//
// 限制的是**程式碼**，不是部署目標：部署到 Cloudflare 沒問題，讓程式碼只能跑在
// Cloudflare 才有問題。理由見 kb/wiki/architecture/vendor-relationship.md
const VENDOR_LOCKIN = [
  ['KVNamespace', 'Workers KV'],
  ['DurableObject', 'Durable Objects'],
  ['R2Bucket', 'R2'],
  ['AnalyticsEngineDataset', 'Analytics Engine'],
  ['@cloudflare/ai', 'Workers AI'],
];
const apiSrc = join(ROOT, 'apps/api/src');
if (existsSync(apiSrc)) {
  for (const file of walk(apiSrc, '.ts')) {
    const text = readFileSync(file, 'utf8');
    for (const [token, label] of VENDOR_LOCKIN) {
      if (text.includes(token)) {
        const rel = file.replace(ROOT + '/', '');
        fail(`${rel} 依賴 ${label}（${token}）—— 客戶無法自架（c12）`);
      }
    }
  }
}

// ── A11. createUser 不得帶 password（clause c1 的 CPU 前提）─────────────────────────────
// 密碼雜湊用 scrypt，那是刻意昂貴的演算法（防暴力破解），而 Cloudflare Workers 免費方案
// 每個請求只有 10ms CPU。實測並發 1 也會 503 —— 無法靠改程式碼修好，因為任何安全的
// 密碼雜湊都會超過 10ms。所以整個系統改用 OAuth + 一次性連結，密碼路徑全部移除。
//
// **這條 gate 存在是因為漏過一次**：改的時候記得了 parents.ts 與 staff.ts，
// 漏掉 bootstrap-org.ts。結果是「scrypt 從系統消失」這個宣稱是假的，而且開新站的
// 第一個管理員拿到一組在任何地方都無法輸入的密碼。
//
// Better Auth 的 createUser 明說：不給 password 就是「magic link 或 social login only
// user」——那是官方支援的路。見 kb/wiki/architecture/line-oauth-login.md
if (existsSync(apiSrc)) {
  for (const file of walk(apiSrc, '.ts')) {
    if (file.endsWith('.spec.ts')) continue;
    const text = readFileSync(file, 'utf8');
    // 抓 createUser({ ... }) 的 body，看裡面有沒有 password 這個 key
    for (const m of text.matchAll(/createUser\(\{[\s\S]{0,600}?\}\s*\)/g)) {
      if (/\bpassword\s*[,:]/.test(m[0])) {
        const rel = file.replace(ROOT + '/', '');
        fail(
          `${rel} 的 createUser 帶了 password —— scrypt 會超過 Workers 的 10ms CPU 上限，而且那組密碼沒有任何地方能輸入`,
        );
      }
    }
  }
}

// ── A9. deny 規則指向的檔案真的存在 ────────────────────────────────────────────────────
// deny 規則是路徑字串比對。憲法從 kb/architecture/ 搬到 kb/wiki/architecture/ 時，
// 如果忘了同步更新，護欄會**靜默失效** —— 沒有任何測試會發現，直到有人修了不該修的東西。
// 這次是運氣好記得更新；下次不會。
const settingsPath = join(ROOT, '.claude/settings.json');
if (existsSync(settingsPath)) {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const denies = settings?.permissions?.deny ?? [];

  for (const rule of denies) {
    // 只驗看得出具體路徑的規則：Edit(<path>) 或 Bash(node <path>:*)
    const m = /^(?:Edit|Read|Write)\(([^)*]+)\)$/.exec(rule) ?? /^Bash\(node ([^\s:)]+)/.exec(rule);
    if (!m) continue;
    const target = m[1];
    if (target.includes('*')) continue; // glob 規則無法逐一驗證
    if (!existsSync(join(ROOT, target))) {
      fail(`deny 規則指向不存在的檔案：${rule} —— 檔案搬走時護欄會靜默失效`);
    }
  }
}

// ── A12 / A13 / A14 / A15. hook-only clause 的存量那一半 ────────────────────────────────
//
// PreToolUse hook 刻意只看**新寫進去的那段文字**（`lib/hook-io.mjs` 的 `pendingWrites`
// 只取 new_string —— 不然修掉違規反而會被擋）。代價是**存量完全沒有覆蓋**：早於 hook 存在、
// 之後沒人重寫過的違規永遠不會被送進判斷，而 enforcement 表上那幾條卻寫著「已接」。
//
// 這幾條補上另一半。**一律用同一份規則餵同一支 matcher**（`pre-guard.rules.json` +
// `matchWriteRules`），不另寫第二份 regex —— 兩份會漂，而漂掉的方向一定是 gate 比 hook 寬。
//
// 整份檔案一次餵進去而不是逐行：c2 的 regex 跨行（`from('ba_user')` 與 `.update(` 中間
// 可以隔 120 個字元），逐行掃會**完全看不到它**。行號只用於訊息，判斷權在 matcher。

/**
 * 掃一棵樹，回報某條 clause 的存量違規。
 *
 * 兩份清單，**語意不同不要混**：
 *
 * - `allowlist`（`{ 路徑: 數量 }`）是**債** —— 該修但還沒排到。目標是歸零，歸零那天整筆刪掉，
 *   gate 自動變成全面覆蓋，不需要有人記得回來拆鷹架。
 * - `exempt`（`{ 路徑: { count, why } }`）是**永久豁免** —— 沒有合規路徑可走，
 *   修不了也不該修。它不會歸零，所以必須寫 `why`，否則下一個人只會看到一個沒人敢動的數字。
 *
 * 分開記的理由：混在一起的話「清到零」這個機制永遠跑不完 ——
 * 帳面上永遠有幾筆，而沒有人知道那幾筆是還沒修還是不用修。
 *
 * 兩者都是**比容許量多 → 紅燈**（新違規擋得住）、**比容許量少 → 也紅燈**（逼帳本跟上）。
 * 只記路徑不記數量的話，同一個檔案裡新增的違規會靜靜溜過去。
 */
function scanExisting({ clause, dir, ext, label, allowlist = {}, exempt = {} }) {
  const rules = guardRules.rules.filter((rule) => rule.id === clause);
  if (!existsSync(dir) || rules.length === 0) return;

  // **不能寫死 rules[0]** —— 同一條 clause 可以有多條規則（c6 就有 .scss 與 .ts 兩條）。
  // 取第一條會拿到別的檔型的 regex；兩條剛好相同時它「安靜地對」，分岔那天才靜靜指錯行。
  const forbidOf = (rel) => {
    const rule = rules.find((r) => new RegExp(r.path).test(rel));
    return rule?.forbid ? new RegExp(rule.forbid, 'g') : null;
  };
  const seen = new Set();

  recordScope(clause, { roots: [dir.replace(ROOT + '/', '')], exts: [ext] });

  for (const file of walk(dir, ext)) {
    const rel = file.replace(ROOT + '/', '');
    const source = readFileSync(file, 'utf8');
    // 判斷權在共用 matcher（它也負責 path 比對，例如 c8 的排除 .spec.ts）
    if (matchWriteRules([{ filePath: rel, text: source }], rules).length === 0) continue;

    // 行號純粹是為了讓訊息可點擊；matcher 說有、regex 卻定不出位置時仍然照報。
    // **要跟 matcher 看同一份文字**（註解已抹白），否則會數到 matcher 根本沒看到的
    // 註解裡那幾筆，於是「有幾筆」跟 allowlist 的帳對不起來。blankComments 保長度，
    // 所以位移與行號仍然對得回原始檔。
    const code = blankComments(source, rel);
    const forbid = forbidOf(rel);
    const lines = forbid
      ? [...code.matchAll(forbid)].map((m) => code.slice(0, m.index).split('\n').length)
      : [];
    const debt = allowlist[rel] ?? 0;
    const permanent = exempt[rel]?.count ?? 0;
    const tolerated = debt + permanent;
    seen.add(rel);

    if (lines.length > tolerated) {
      const shown = lines.slice(tolerated).join(', ') || '(位置未定)';
      fail(
        `${rel} ${label}（${clause}）—— 第 ${shown} 行；` +
          (tolerated > 0
            ? `這個檔案容許 ${tolerated} 筆（債 ${debt} + 永久豁免 ${permanent}），現在有 ${lines.length} 筆`
            : ''),
      );
    } else if (lines.length < tolerated) {
      fail(
        `${rel} 的 ${clause} 帳面過期：容許 ${tolerated} 筆（債 ${debt} + 永久豁免 ${permanent}）、` +
          `實際 ${lines.length} 筆。清掉的是債就把 allowlist 數字改小（歸零整筆刪掉）；` +
          `若連豁免的那處也沒了，才動 exempt`,
      );
    }
  }

  for (const rel of [...Object.keys(allowlist), ...Object.keys(exempt)]) {
    if (!seen.has(rel)) {
      fail(`${rel} 已無 ${clause} 違規（或檔案已不存在），請從 check-harness.mjs 的清單移除`);
    }
  }
}

const WEB_SRC = join(ROOT, 'apps/web/src');
const API_SRC = join(ROOT, 'apps/api/src');

// A12（c6）— 存量早就是 0 以外的東西了，維持零容忍
scanExisting({ clause: 'c6', dir: WEB_SRC, ext: '.scss', label: '使用了 viewport 單位' });
// 同一條 clause 的 TS 側。**零 baseline 上線**（#273 把 14 處清成 0）——
// baseline 只該給「接受的現況」，不該給「排隊中的修復」。
scanExisting({ clause: 'c6', dir: WEB_SRC, ext: '.ts', label: '使用了 viewport 單位' });
// c6 的 **HTML 載體**：`[style.height]` / `[ngStyle]` 綁定（16 處），
// 以及 index.html 的 <style> 區塊 —— 那是全螢幕啟動畫面，**最容易伸手拿 100vh 的地方**，
// 而它先前只被 c7 掃過（.html），c6 看不到。同樣零違規、零 baseline。
scanExisting({ clause: 'c6', dir: WEB_SRC, ext: '.html', label: '使用了 viewport 單位' });

// A13（c7）— 存量本來就是 0（Angular 21 全面用新語法），gate 立起來防回歸
scanExisting({ clause: 'c7', dir: WEB_SRC, ext: '.html', label: '使用了舊版結構指令' });
// c7 的 **inline template 載體**。repo 有 15 支元件把模板寫在 `template:` 字串裡，
// 只掃 .html 的話那 15 支完全隱形。**立法時零違規**，所以零 baseline ——
// 那是最便宜的立法時機（A18 當初也是）。
scanExisting({ clause: 'c7', dir: WEB_SRC, ext: '.ts', label: '使用了舊版結構指令' });

// A14（c8）— **存量已清零**（PR #81），allowlist 空著就是它該有的樣子。
// 原本列的 4 筆（jdenticon-avatar 的 2 @Input + 1 @ViewChild、shell-layout 的
// 1 @ViewChild）在 #81 全部轉成 functional API，那支 PR 比這支 gate 早合，
// 所以兩邊各自綠、合起來紅 —— allowlist 是「已知存量」的快照，快照會過期。
// 邊界：`@HostListener` **不在** c8 內（沒有 functional 對應物，使用者 2026-08-29 釐清）——
// 這件事由 pre-guard 的 regex 本身保證，這裡不重述，共用規則就是為了不重述。
scanExisting({ clause: 'c8', dir: WEB_SRC, ext: '.ts', label: '使用了裝飾器版 API' });

// A15（c2）— 2026-09-03 兩輪驗證後收斂到「**真債 0 筆** + 永久豁免 5 筆」。
//
// 原本 9 筆，處理如下：
//   -3  只寫 `orgId` 的三處改由 **pre-guard 規則本身**豁免（不是靠這裡的清單）——
//       `orgId` 在 auth.ts 是 `input: false`，Better Auth 的 API 明確拒收，直寫是唯一路徑。
//       規則只放行「payload 就只有 orgId」，夾帶其他欄位照樣擋。
//   -1  staff.ts 那筆是**冗餘**：同一個 handler 的 createUser 已在 `data` 帶了 phone，已刪除。
//   =5  剩下 4 筆真債 + 1 筆永久豁免。
//
// **2026-09-03 的可行性驗證（billing-api 席）之後再減一：me.ts 的 email 從債改成豁免。**
// 驗證結論（報告見該席 scratchpad `c2-updateuser-feasibility.md`）：
//   - `updateUser` **明確拒絕** email（`api/routes/update-user.mjs:54` 丟
//     `BAD_REQUEST` / `EMAIL_CAN_NOT_BE_UPDATED`）
//   - 合法路徑 `changeEmail` 的三個前置**這個專案一個都不成立**（見 exempt 的 why）
// 剩下的 3 筆全是「管理員改別人的資料」，而**那條路也走不通**（第二輪驗證）：
//   - `updateUser` 掛 `sessionMiddleware`，要的是**被改的那個人**的 session ——
//     管理員手上沒有
//   - admin plugin 的 `adminUpdateUser` 看的是 **`ba_user.role`**
//     （`has-permission.mjs`：`role: ctx.context.session.user.role` + `user: ['update']`），
//     而這個專案**每一個 ba_user 的 role 都是 `'user'`** —— 管理員身分住在我們自己的
//     `user_roles` 表。所以每一次呼叫都會是 403 `YOU_ARE_NOT_ALLOWED_TO_UPDATE_USERS`。
//     要讓它通過只有兩條路，兩條都比直寫糟：把管理員寫進 `ba_user.role`
//     （本身就是 c2 寫入，而且會一併授予 impersonate / ban / setRole），
//     或在設定裡寫死 `adminUserIds` 清單（把角色真相複製到設定檔）。
//
// 唯一走得通的是「**本人改自己**」：`me.ts` 的 phone 已於本輪改走
// `auth.api.updateUser`（session headers 拿得到，`phone` 是宣告過的 additionalField）。
scanExisting({
  clause: 'c2',
  dir: API_SRC,
  ext: '.ts',
  label: '直接寫入 ba_* 表',
  // 真債歸零 —— 剩下的每一筆都驗證過「沒有合規路徑」，所以是豁免不是待辦。
  // **這正是把債與豁免分開記的意義**：allowlist 空了才代表沒有欠著沒做的事。
  allowlist: {},
  exempt: {
    // me.ts:151 在同一個 update 裡寫 `phone` 與 `username`。phone 本身可以走 API，
    // 但 `username` 沒有 API —— username plugin 已被刻意移除（auth.ts:148，它提供的
    // /sign-in/username 也是密碼登入），而那個欄位**還在被當唯一性鍵使用**：
    // parents.ts 有 4 處 `buildPostgrestEq('username', phone)` 靠它做家長匯入的重複偵測。
    // 拆成「一次 API 呼叫 + 一次直寫」只會更難懂，所以整處永久豁免。
    //
    // me.ts:124 的 `email` 也沒有路徑（2026-09-03 驗證）：`updateUser` 在
    // `update-user.mjs:54` 明著擋掉 email；合法路徑 `changeEmail` 的三個前置
    // **這個專案一個都不成立** —— 兩個要寄信管道（本專案沒有任何寄信管道，
    // 見 auth.ts 的 magic-link 註解），第三個 `updateEmailWithoutVerification`
    // 要求 `emailVerified !== true`，但 LINE 登入的使用者我們**刻意**標成
    // `emailVerified: true`（`lineProfileToUser`，為了讓 link-account 通過）。
    // parents.ts / staff.ts 都是「管理員改別人的資料」——
    // `updateUser` 要被改者的 session（拿不到），`adminUpdateUser` 看 `ba_user.role`
    // （全都是 `'user'`）必 403。詳見上方註解。
    'apps/api/src/routes/parents.ts': {
      count: 2,
      why: '管理員改別人的 email/phone：updateUser 要被改者的 session、adminUpdateUser 看 ba_user.role（本專案全是 user）必 403',
    },
    'apps/api/src/routes/staff.ts': {
      count: 1,
      why: '同上（管理員改別人的 phone）',
    },
    'apps/api/src/routes/me.ts': {
      count: 2,
      why: 'username 無 API 路徑（plugin 已移除）且仍是家長匯入的唯一性鍵；email 被 updateUser 明著拒絕，而 changeEmail 的前置需要寄信管道（本專案沒有）',
    },
  },
});

// c2 的 **SQL 載體**。2026-09-04 的載體盲區掃描挖出來的：gate 在 TS 那側精確記著
// 5 筆永久豁免、每筆都有查證過的 why，程式碼還寫著「真債歸零」—— 而 `seed.sql` 裡
// 有 **9 條**直接寫 ba_* 的語句，**完全在掃描範圍外**。
// 「真債歸零」當時的真實含義是「在我們碰巧會掃的那個載體裡歸零」。
//
// seed 本身是正當的（SQL 裡叫不到 `admin.createUser()`，而且只跑本機），
// **但它該是宣告過的豁免，不是看不見的洞** —— 差別在於：現在沒有任何東西
// 阻止有人把那個寫法複製進正式程式碼，也沒有東西擋 seed 再長出第 10 條。
scanExisting({
  clause: 'c2',
  dir: join(ROOT, 'supabase'),
  ext: '.sql',
  label: '直接寫入 ba_* 表',
  allowlist: {},
  exempt: {
    'supabase/seed.sql': {
      count: 9,
      why: '本機示範資料：SQL 裡叫不到 admin.createUser()，而 seed 只跑在本機 db:reset。INSERT ba_user ×5 / DELETE ba_user ×2 / UPDATE ba_user ×1 / DELETE ba_account ×1',
    },
    // **這一筆跑在正式環境**，跟 seed 不同層級。它是 pg_cron 每週清掉已過期的
    // ba_session —— Better Auth 自己不清，不清的話那張表會無限長大。
    // 刪的是 `"expiresAt" < NOW()` 的列，**不是動身分資料**，而且 Better Auth
    // 沒有提供清理 API。加上它是已提交的 migration（c3），本來也只能豁免不能改。
    //
    // 它是這道 SQL 側 gate 上線第一次執行就抓到的 —— 而我自己那份載體掃描報告
    // 寫的是「migrations 沒有任何 DML」。**錯在 grep 被 `| head` 截斷**：
    // `REFERENCES ... ON DELETE SET NULL` 也含 "delete"，噪音把訊號擠出了前 10 行。
    'supabase/migrations/20260222000002_session_cleanup_cron.sql': {
      count: 1,
      why: 'pg_cron 每週刪除已過期的 ba_session（expiresAt < NOW()）—— Better Auth 不自動清且無清理 API，不清則該表無限長大；刪的是過期列不是身分資料。且為已提交 migration（c3）',
    },
  },
});

// ── A16. 本分支有沒有改到已提交的 migration（clause c3）──────────────────────────────────
// c3 的「存量」語意跟其他條不同：樹上不可能躺著一個「已經被改壞的 migration」——
// 修改一定是**相對某個基準的差異**。所以這條比的是三點差異 `origin/main...HEAD`：
// 本分支從分岔點以來，對 supabase/migrations/ 底下**既有檔案**做的任何 M / D / R。
// 新增（A）當然放行，那正是 c3 要求的做法。
//
// 三點而不是兩點是刻意的：兩點會把「main 自己新增的 migration」也算成本分支的改動。
//
// 覆蓋範圍的誠實話：直接推 main 的話 `origin/main...HEAD` 兩端相同、這條看不到東西。
// 本專案不在 main 上工作（AGENTS.md），而寫入當下那一層由 pre-guard 的 c3（whenTracked）擋，
// 所以缺口是可接受的。拿不到 origin/main 時（淺 clone、離線）只警告不紅燈 ——
// 環境問題不該偽裝成違憲。
const migrationsChanged = spawnSync(
  'git',
  [
    'diff',
    '--name-status',
    '--diff-filter=MDR',
    'origin/main...HEAD',
    '--',
    'supabase/migrations/',
  ],
  { cwd: ROOT, encoding: 'utf8' },
);

if (migrationsChanged.status !== 0) {
  warnings.push(
    `拿不到 origin/main，跳過 c3 的存量檢查（A16）—— CI 上 actions/checkout 需要 fetch-depth: 0`,
  );
} else {
  for (const line of migrationsChanged.stdout.split('\n').filter(Boolean)) {
    const [status, ...paths] = line.split('\t');
    fail(
      `${paths.at(-1)} 是已提交的 migration，本分支卻${status.startsWith('D') ? '刪除' : status.startsWith('R') ? '改名' : '修改'}了它（c3）。` +
        `schema 變更請新增一支 ALTER TABLE migration：npx supabase migration new <description>`,
    );
  }
}

// kb/ 的內容健康度（frontmatter、索引新鮮度、斷鏈、孤兒頁）由 kb-wiki skill 的 lint 負責，
// 不由 harness gate 管 —— 這跟 fvg 的配置一致：harness 守程式碼與流程，kb-wiki 守知識庫。

// ── A17. 自己刻的可點元素有沒有尺寸下限（44px 觸控門檻）──────────────────────────────────
// 規則是**反過來**寫的：不是「宣告了小數字就報」，而是「宣告了 cursor: pointer 卻沒有
// 任何尺寸下限就報」。理由見 lib/touch-target.mjs —— 最嚴重的實際案例（老師端 dashboard
// 那兩顆 20px 連結）SCSS 裡根本沒有尺寸宣告，找小數字的掃描一無所獲。
//
// 範圍**自己算**不要手寫：老師端全部 + admin 裡**已經遷成手機優先**的（也就是不在
// mobile-first baseline 裡的）。這樣一頁遷完就自動納入觸控檢查，不需要有人記得回來加。
function checkTouchTargets() {
  const teacherDir = join(ROOT, 'apps/web/src/app/features/teacher');
  const adminDir = join(ROOT, 'apps/web/src/app/features/admin');
  // 公開頁全數納入（2026-09-04）：它們是**未登入的人唯一會碰到的畫面**，
  // 而且不像 admin 有「已遷手機優先」這個天然的分批依據 —— 公開頁本來就少。
  const publicDir = join(ROOT, 'apps/web/src/app/features/public');
  // **shared/ 是影響面最大的一塊**（2026-09-04 的載體盲區掃描順帶量到）：
  // responsive-table、shell-layout、共用 dialog 全住這裡，**每個角色的每一頁都在用**，
  // 而它先前完全不在範圍內 —— 9 筆報出、8 筆是真債（26–43px），
  // 包含一顆連尺寸宣告都沒有的麵包屑連結（正是這道 gate 反向判準要抓的形狀）。
  const sharedDir = join(ROOT, 'apps/web/src/app/shared');
  const selectRoleDir = join(ROOT, 'apps/web/src/app/features/select-role');
  if (!existsSync(teacherDir) || !existsSync(adminDir)) return;

  const desktopFirst = new Set(
    existsSync(MOBILE_FIRST_BASELINE)
      ? JSON.parse(readFileSync(MOBILE_FIRST_BASELINE, 'utf8'))
      : [],
  );

  const scoped = [
    ...walk(teacherDir, '.scss'),
    ...(existsSync(publicDir) ? walk(publicDir, '.scss') : []),
    ...(existsSync(sharedDir) ? walk(sharedDir, '.scss') : []),
    ...(existsSync(selectRoleDir) ? walk(selectRoleDir, '.scss') : []),
    ...walk(adminDir, '.scss').filter((f) => !desktopFirst.has(f.slice(ROOT.length + 1))),
  ];

  recordScope('touch-target', {
    roots: [teacherDir, publicDir, sharedDir, selectRoleDir, adminDir]
      .filter((d) => existsSync(d))
      .map((d) => d.slice(ROOT.length + 1)),
    exts: ['.scss'],
  });

  const current = new Map();
  for (const file of scoped) {
    const rel = file.slice(ROOT.length + 1);
    for (const v of touchTargetViolations([{ path: rel, source: readFileSync(file, 'utf8') }])) {
      current.set(`${rel}|${v.selector}`, v);
    }
  }

  // 豁免不是債 —— 它不進 baseline，`harness:write` 也不會把它寫成債。
  const exemptKeys = Object.keys(TOUCH_TARGET_EXEMPT);
  const keys = [...current.keys()].filter((k) => !(k in TOUCH_TARGET_EXEMPT)).sort();

  if (mode === 'write') {
    writeFileSync(TOUCH_TARGET_BASELINE, `${JSON.stringify(keys, null, 2)}\n`);
    return;
  }

  // 那三筆 `<tr>` 的豁免理由指向**另一個檔案裡的一行**（responsive-table 的
  // `__cell padding-block`）。如果有人把那一行拿掉，豁免就變成謊而沒有任何東西
  // 會說話 —— 三個頁面的列高會靜靜掉回 36.5px。所以在這裡驗證那個機制還在。
  //
  // 這不是手抄清單（c11）：它斷言的是**豁免理由所依賴的那個機制**，
  // 豁免刪掉的那天這段也一起刪。
  const rtPath = join(
    ROOT,
    'apps/web/src/app/shared/components/responsive-table/responsive-table.component.scss',
  );
  if (existsSync(rtPath)) {
    const rt = readFileSync(rtPath, 'utf8');
    const coarse = rt.slice(rt.lastIndexOf('@media (pointer: coarse)'));
    if (!/__cell\s*\{[^}]*padding-block/.test(coarse)) {
      fail(
        'responsive-table 的 pointer: coarse 區塊少了 `__cell { padding-block }` —— ' +
          '三筆 <tr> 的觸控豁免正是靠它才成立（少了它列高掉回 36.5px）。' +
          '要拿掉的話，TOUCH_TARGET_EXEMPT 裡那三筆也要一起重新評估',
      );
    }
  }

  // 豁免必須是可否證的：對不上任何實際違規時就是謊，不是保險。
  // 這條 write 模式修不掉（豁免寫在程式碼裡），只能人刪 —— 刻意的。
  for (const key of exemptKeys.filter((k) => !current.has(k))) {
    const [file, sel] = key.split('|');
    fail(
      `觸控豁免過期：${file} 的 ${sel} 已經不違規了 —— ` +
        `把 TOUCH_TARGET_EXEMPT 裡那一筆刪掉（豁免歸零不是改數字，是整筆移除）`,
    );
  }

  const baseline = new Set(
    existsSync(TOUCH_TARGET_BASELINE)
      ? JSON.parse(readFileSync(TOUCH_TARGET_BASELINE, 'utf8'))
      : [],
  );

  for (const key of keys.filter((k) => !baseline.has(k))) {
    const v = current.get(key);
    fail(
      v.kind === 'no-floor'
        ? `${v.file}:${v.line} 的 ${v.selector} 有 cursor: pointer 卻沒有任何尺寸下限` +
            `（${TOUCH_MIN_PX}px 觸控門檻）—— 加 min-height，觸控下再由 pointer: coarse 抬到 ${TOUCH_MIN_PX}`
        : `${v.file}:${v.line} 的 ${v.selector} 下限只有 ${v.px}px，低於 ${TOUCH_MIN_PX}px 觸控門檻`,
    );
  }

  const stale = [...baseline].filter((k) => !current.has(k));
  if (stale.length > 0) {
    warnings.push(
      `觸控尺寸 baseline 有 ${stale.length} 筆已經修好了 —— 跑 npm run harness:write 把它們移出清單`,
    );
  }

  const remaining = keys.filter((k) => baseline.has(k));
  if (remaining.length > 0) {
    // 最大宗的目錄**算出來**不要寫死（c11）
    const byArea = new Map();
    for (const k of remaining) {
      const area = k.split('/').slice(4, 6).join('/');
      byArea.set(area, (byArea.get(area) ?? 0) + 1);
    }
    const [area, n] = [...byArea].sort((a, b) => b[1] - a[1])[0];
    warnings.push(
      `${remaining.length} 處可點元素沒有尺寸下限（在 baseline 裡、不擋）—— 最多的是 ${area}，佔 ${n} 筆`,
    );
  }

  // **空殼頁的綠燈沒有意義，要講出來。** 一個還沒實作的頁面必然零違規 ——
  // 不是因為它合格，是因為它裡面什麼都沒有。不標記的話，等它實作完成時
  // 沒有任何東西會提醒「這頁從來沒有被真的量過」。
  //
  // 判準是**檔案內容**不是人工清單 —— 寫死頁面名稱的話，那份清單會在頁面實作完成後
  // 靜靜地過期（c11）。
  //
  // **要看模板不能只看 SCSS。** 第一版只判斷「SCSS 沒有實質內容」，結果把
  // `campus-form-dialog`（html 69 行、ts 113 行，樣式繼承自全域 `.form-dialog`）
  // 也標成空殼 —— 那是**已完成**的元件，說它「從來沒被量過」是錯的訊息。
  // 實測分界很乾淨：真空殼的模板 9 行以內，已實作的 69 行。
  for (const file of scoped) {
    const rel = file.slice(ROOT.length + 1);
    const hasStyle = readFileSync(file, 'utf8')
      .split('\n')
      .some((l) => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('@use');
      });
    if (hasStyle) continue;

    const template = file.replace(/\.scss$/, '.html');
    if (!existsSync(template)) continue;
    const templateLines = readFileSync(template, 'utf8')
      .split('\n')
      .filter((l) => l.trim()).length;
    if (templateLines > 12) continue; // 有實質模板 = 已實作，只是樣式在別處

    warnings.push(
      `${rel} 目前是空殼（樣式與模板都幾乎是空的）—— 這頁的觸控尺寸**從來沒有被量過**，` +
        `gate 綠燈只代表沒有東西可檢查。實作完成後要重新量一次`,
    );
  }

  // **能力邊界要明寫。** 綠燈的意思是「掃描範圍內、自己刻的可點元素都有下限」，
  // 不是「觸控目標都合格」：尺寸由 padding 與行高撐出來的看不到（那要在裝置上量），
  // PrimeNG 元件不在範圍（由 styles.scss 的 pointer: coarse token 統一負責），
  // 而 parent / public 兩區**沒有人量過也不在掃描範圍**。
}

// **`checkMobileFirst()` 必須排在 `checkTouchTargets()` 之前。**
// 觸控檢查的範圍是從 mobile-first baseline 推導的（見 checkTouchTargets 的註解），
// 所以 write 模式下如果先跑觸控、它讀到的會是**還沒更新的**那份 —— 這一輪剛遷完的
// 檔案不會進範圍，於是 `npm run harness:write` 跑一次到不了不動點，得跑兩次才收斂。
//
// 實際踩到：一次遷完 9 支 grades 之後 write 一次，check 立刻報 12 筆新違規；
// 再 write 一次那 12 筆才進 baseline。「write 完還是紅」會讓人以為 gate 壞了。
checkMobileFirst();
checkTouchTargets();

// ── A18. feature 之間不得互相 import（clause c5）─────────────────────────────────────────
// **沒有 baseline，因為立法時是零違規的。** 那是最便宜的立法時機 —— 不必分診舊債，
// 也不會有「這筆算不算」的爭議。之後任何一筆都是新的。
//
// 為什麼是專用函式不是 pre-guard 規則、以及它看不到什麼，見 lib/feature-boundaries.mjs。
// 摘要：c5 是 Semantic 條款，這支只機器化「路徑層面的直接 import」那一半，
// **經由 core/ 或 shared/ 的間接耦合看不到**，那一半仍然靠 review。
const FEATURES_DIR = join(ROOT, 'apps/web/src/app/features');
if (existsSync(FEATURES_DIR)) {
  // 別名也要認：`@features/teacher/…` 與 `@app/features/teacher/…` 都到得了別的 feature。
  // 目前沒有人這樣寫，但 tsconfig 定義了它們 —— 只擋相對路徑等於留一個看不見的洞。
  const aliases = {
    '@features/': FEATURES_DIR,
    '@app/': join(ROOT, 'apps/web/src/app'),
  };
  for (const v of crossFeatureImports(FEATURES_DIR, ROOT, aliases)) {
    fail(
      `${v.file}:${v.line} 從 ${v.from} import 了 ${v.to} 的東西（c5）：${v.spec} —— ` +
        `要共用就往 shared/ 提（元件）或 core/ 提（狀態），不要橫向拉`,
    );
  }
}

// ── A19. 家長端檔案不得出現 c.get('supabase') ────────────────────────────────────────────
// `routes/parent/**` 是家長端專屬檔案的目錄（見 kb/wiki/architecture/parent-data-scope.md
// 第二節）。這些檔案只能透過 `c.get('childDb')` 查詢，不能拿原始 supabase ——
// 「查詢走一個強制吃 scope 的 helper」守不住「根本沒呼叫」，route 裡直接寫
// `c.get('supabase').from('scores')…` 一樣編得過。這一支只負責收尾：抓那個看得見的
// 繞過動作，不是要求 review 的人記得檢查每一支查詢有沒有帶 scope。
//
// **零 baseline，因為立法時是零違規**（目錄本身跟這道 gate 同一輪引入）——
// 跟 A18 的 feature 隔離同一個立法時機，不必分診舊債。
//
// **用共用的 `walk()` 遞迴掃，不是 `readdirSync` 只列一層。** `routes/parent/`
// 遲早會長出子目錄（`routes/` 底下現在已經有 `announcements/`、`sessions/` 等
// 6 個子目錄），`readdirSync` 只看那一層的話子目錄裡的檔案會安靜地不被掃到 ——
// 而且 gate 照樣綠，因為它掃的那一層真的沒有違規。`recordScope` 宣告了整棵
// 子樹，實作就要對得上這個宣告（infra 席審查抓到，見 PR #326）。
//
// **能力邊界（不必修，寫給下一個人看）**：這裡只掃 `routes/parent/**`，
// 不掃 `lib/`。`lib/child-db.ts` 本身是授權過的包裝，內部本來就要用原始
// supabase 才建得出綁好 scope 的查詢入口 —— 綠燈的意思是「家長端 route 檔案
// 沒有繞過 childDb」，不是「這個 codebase 沒有任何地方碰得到原始 supabase」。
{
  const parentRoutesDir = join(ROOT, 'apps/api/src/routes/parent');
  if (existsSync(parentRoutesDir)) {
    recordScope('A19', { roots: ['apps/api/src/routes/parent'], exts: ['.ts'] });
    for (const file of walk(parentRoutesDir, '.ts')) {
      if (file.endsWith('.spec.ts')) continue;
      const rel = file.replace(ROOT + '/', '');
      const source = readFileSync(file, 'utf8');
      if (usesRawSupabase(source, rel)) {
        fail(
          `${rel} 出現 c.get('supabase') —— 家長端檔案只能用 ` +
            `c.get('childDb')，見 kb/wiki/architecture/parent-data-scope.md 第二節`,
        );
      }
    }
  }
}

// ── A20. 分校範圍只能經由 getCampusScope() 取用（issue #515）────────────────────────────
//
// `AppEnv` 宣告的是 `campusScope: CampusScope`（**沒有 `?`**），而 runtime 拿得到
// `undefined` —— **那個型別在 2026-09-06 之前是假的**。缺席不是一種範圍，是
// `authMiddleware` 沒跑過，而 `lib/campus-scope.ts` 的 `getCampusScope()` 對它丟例外。
//
// **為什麼需要 gate 而不是只提供 accessor**：**可以呼叫的 helper 就是可以忘記呼叫的
// helper**。只有 accessor 的話它落在「願意停下來讀的人」那一層（第三層），
// 不是「錯的寫法寫不出來」那一層（第一層）。判準是 #295 預審那條：
// **問「錯的寫法還寫不寫得出來」，不是問「對的寫法方不方便」。**
//
// **零 baseline，因為立法時是零違規**（20 個讀取點跟這道 gate 同一輪遷移完）——
// 立法時零違規是最便宜的立法時機，跟 A18 / A19 同一個判斷。
//
// **兩筆永久豁免**（不是債，不會歸零）：
//   - `lib/campus-scope.ts` —— accessor 自己，它就是那個唯一入口的定義
//   - `middleware/auth.ts` —— `campusRequestGuard` 在 auth 層，它跟 accessor 平級
//
// **能力邊界（不必修，寫給下一個人看）**：這道 gate 認的是 `c.get('campusScope')`
// 這個字面。**值被傳進 lib 之後它就看不到了** —— `lib/attendance-session-events.ts`
// 這類收 `CampusScope` 當參數的函式，範圍正不正確由呼叫端負責，gate 管不到。
// 綠燈的意思是「沒有人繞過那個入口去拿值」，不是「每一處都正確地套用了範圍」。
{
  const scopeRoots = ['apps/api/src/routes', 'apps/api/src/lib', 'apps/api/src/middleware'];
  const CAMPUS_SCOPE_EXEMPT = new Set([
    'apps/api/src/lib/campus-scope.ts',
    'apps/api/src/middleware/auth.ts',
  ]);
  recordScope('A20', { roots: scopeRoots, exts: ['.ts'] });
  for (const root of scopeRoots) {
    const dir = join(ROOT, root);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir, '.ts')) {
      if (file.endsWith('.spec.ts')) continue;
      const rel = file.replace(ROOT + '/', '');
      if (CAMPUS_SCOPE_EXEMPT.has(rel)) continue;
      if (readFileSync(file, 'utf8').includes("get('campusScope')")) {
        fail(
          `${rel} 裸用 c.get('campusScope') —— 分校範圍只能經由 ` +
            `lib/campus-scope.ts 的 getCampusScope(c) 取用（缺席會丟，見 issue #515）`,
        );
      }
    }
  }
}

// ── 雙軌表格：不要再手刻第二份手機版 ────────────────────────────────────────────────────
// 同一份資料在元件裡宣告兩次（`<table>` + 一組平行的手機標記），靠斷點互相切換。
// 改欄位時要記得改兩處，而**忘記的那一次不會有任何錯誤** —— 跟 page-actions 同源。
// 既有 4 支進 baseline（成績區），只擋新增的；正解是走 responsive-table 共用元件。
//
// 偵測訊號與能力邊界見 lib/dual-track-table.mjs。摘要：認的是 SCSS 裡**互補的
// display 開關**（基準藏 A、條件顯 A 且藏 B），不是命名 —— 第一版認 `__mobile*`
// 漏掉了手機版叫 `__record-cards` 的那一支，而且漏得很安靜。
function checkDualTrackTables() {
  const webSrc = join(ROOT, 'apps/web/src');
  if (!existsSync(webSrc)) return;

  // **inline 的元件也是元件。** 模板寫在 `template:`、樣式寫在 `styles:` 的話，
  // 「有 .html 也有同名 .scss」這個條件永遠不成立，於是整支對這道 gate 隱形。
  const inlineComponents = [];
  const walkTs = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walkTs(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        const src = readFileSync(full, 'utf8');
        if (!src.includes('@Component')) continue;
        const template = inlineTemplate(src);
        const scss = inlineStyles(src);
        if (template.trim() && scss.trim()) {
          inlineComponents.push({ path: full.slice(ROOT.length + 1), template, scss });
        }
      }
    }
  };
  walkTs(webSrc);

  // 要模板與 SCSS 成對：訊號一半在模板（有沒有 <table>）、一半在 SCSS（有沒有翻面）
  const components = walk(webSrc, '.html')
    .filter((f) => existsSync(f.replace(/\.html$/, '.scss')))
    .map((f) => ({
      path: f.slice(ROOT.length + 1),
      template: readFileSync(f, 'utf8'),
      scss: readFileSync(f.replace(/\.html$/, '.scss'), 'utf8'),
    }));
  const judged = [...components, ...inlineComponents];
  recordScope('dual-track-table', {
    roots: [webSrc.slice(ROOT.length + 1)],
    exts: ['.html', '.ts'],
  });

  const current = new Map(dualTrackTables(judged).map((v) => [v.file, v]));
  const keys = [...current.keys()].sort();

  if (mode === 'write') {
    writeFileSync(DUAL_TRACK_BASELINE, `${JSON.stringify(keys, null, 2)}\n`);
    return;
  }

  const baseline = new Set(
    existsSync(DUAL_TRACK_BASELINE) ? JSON.parse(readFileSync(DUAL_TRACK_BASELINE, 'utf8')) : [],
  );

  for (const key of keys.filter((k) => !baseline.has(k))) {
    fail(
      `${key} 是雙軌表格：斷點把 ${current.get(key).hidden} 藏起來、換成 ` +
        `${current.get(key).shown}。同一份資料宣告兩次，改欄位時漏掉一邊不會有任何錯誤 —— ` +
        `改用 responsive-table 共用元件`,
    );
  }

  const stale = [...baseline].filter((k) => !current.has(k));
  if (stale.length > 0) {
    warnings.push(
      `雙軌表格 baseline 有 ${stale.length} 筆已經遷移了 —— 跑 npm run harness:write 把它們移出清單`,
    );
  }

  const remaining = keys.filter((k) => baseline.has(k));
  if (remaining.length > 0) {
    warnings.push(
      `${remaining.length} 支表格是雙軌實作（在 baseline 裡、不擋）—— 遷到 responsive-table 之後跑 harness:write`,
    );
  }
}

checkDualTrackTables();

// ── W1. 使用者層級 skill 在這台機器上存在嗎（警告，不紅燈）────────────────────────────
// 而那個 kb-wiki skill 不進版控（它是使用者跨專案共用的），所以「AGENTS.md 說得出口的
// 指令」與「這台機器叫得動的指令」之間有一道無聲的縫。這條把縫顯示出來，但不擋 CI ——
// CI 上本來就不會有使用者的 skill。
for (const skill of missingUserSkills()) {
  warnings.push(
    `${skill.name} 是使用者層級 skill，這台機器上找不到 ~/${skill.probe} —— ${skill.why}`,
  );
}

// ── 幽靈 token ───────────────────────────────────────────────────────────────────────────
/**
 * `var(--foo)` 引用一個從來沒有定義過的 token。
 *
 * 沒有 fallback 的話**那條規則完全無效** —— 顏色不會套上去，而且不會有任何錯誤訊息；
 * 有 fallback 的話值被寫死在 fallback 裡，換色系時換不到它。
 *
 * 2026-08 換色系時一次掃出 56 個，其中 25 個連 fallback 都沒有（`--text-muted` 一個就
 * 26 處）。那些規則從寫下的那天起就沒有生效過，沒有人發現。所以做成提醒。
 *
 * 執行時由 JS 設定的 token 不算幽靈（directive 用 setProperty 寫進去，SCSS 裡當然找不到定義）。
 */
const RUNTIME_TOKENS = new Set([
  '--window-height',
  '--window-width',
  '--shell-layout-body-height',
  '--shell-layout-body-width',
  '--clessia-tooltip-enter-duration',
  '--clessia-tooltip-leave-duration',
  '--h',
  '--avatar-hue',
  '--item-hue',
]);

// ── 樣式載體 ────────────────────────────────────────────────────────────────
// **在 Angular 裡，`.ts` 檔同時也是樣式表。** 只掃 `.scss` 的 gate 對
// `leave-form-dialog` 這種全 inline 的元件完全隱形 —— 它就是這樣藏著一個
// `var(--red-500)`（未定義、無 fallback，所以必填星號根本不是紅的），
// 而抓這種的 gate 當天還在報別的 token。載體錯，規則再對也沒用。
function styleCarriers(webSrc) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.scss')) {
        out.push({ path: full.slice(ROOT.length + 1), source: readFileSync(full, 'utf8') });
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        const ts = readFileSync(full, 'utf8');
        if (!ts.includes('@Component')) continue;
        const css = inlineStyles(ts);
        if (css.trim()) out.push({ path: full.slice(ROOT.length + 1), source: css });
      }
    }
  };
  walk(webSrc);
  return out;
}

function scanGhostTokens() {
  const webSrc = join(ROOT, 'apps/web/src');
  if (!existsSync(webSrc)) return;

  const carriers = styleCarriers(webSrc);
  recordScope('ghost-token', {
    roots: [webSrc.slice(ROOT.length + 1)],
    exts: ['.scss', '.ts', '.html'],
  });

  const defined = new Set();
  const indexHtml = join(webSrc, 'index.html');
  const sources = existsSync(indexHtml)
    ? [...carriers, { path: 'index.html', source: readFileSync(indexHtml, 'utf8') }]
    : carriers;
  for (const { source } of sources) {
    for (const m of source.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) defined.add(m[1]);
  }

  // PrimeNG **原始調色盤**（--p-sky-600、--p-zinc-400 …）。這些是 PrimeNG 自己定義的，
  // 所以永遠不算 ghost —— 但正因為「有定義、會生效」，它們是設計系統的旁路：
  // 換掉 preset 也換不到它們，畫面上就留著一塊上一代的顏色。
  // 2026-08 的實例：37 處 --p-zinc-* / --p-sky-* 撐過了整輪 token 替換，
  // 儀表板的連結與警示卡直到跑起真站截圖才看見還是天藍的。
  const PALETTE_BYPASS =
    /^--p-(sky|blue|indigo|violet|purple|fuchsia|cyan|teal|emerald|green|lime|red|orange|amber|yellow|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}$/;

  const ghosts = new Map();
  const bypass = new Map();
  for (const { source } of carriers) {
    for (const m of source.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/g)) {
      const name = m[1];
      if (PALETTE_BYPASS.test(name)) {
        bypass.set(name, (bypass.get(name) ?? 0) + 1);
        continue;
      }
      if (defined.has(name) || RUNTIME_TOKENS.has(name) || name.startsWith('--p-')) continue;
      const hit = ghosts.get(name) ?? { count: 0, withoutFallback: 0 };
      hit.count += 1;
      if (!m[2]) hit.withoutFallback += 1;
      ghosts.set(name, hit);
    }
  }

  if (bypass.size > 0) {
    const total = [...bypass.values()].reduce((n, c) => n + c, 0);
    const top = [...bypass.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, c]) => `${name}（${c} 處）`)
      .join('、');
    warnings.push(
      `${total} 處直接引用 PrimeNG 原始調色盤，繞過設計 token（換 preset 換不到）：${top}` +
        (bypass.size > 5 ? ' …' : ''),
    );
  }

  if (ghosts.size === 0) return;
  const dead = [...ghosts.values()].reduce((n, g) => n + g.withoutFallback, 0);
  const top = [...ghosts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([name, g]) => `${name}（${g.count} 處）`)
    .join('、');
  warnings.push(
    `${ghosts.size} 個 token 被 var() 引用但從未定義，其中 ${dead} 處沒有 fallback（那些規則不會生效）：${top}` +
      (ghosts.size > 5 ? ' …' : ''),
  );
}

scanGhostTokens();

// ── 橘帶的對比硬地板 ─────────────────────────────────────────────────────────────────────
// 數學住在 lib/band-contrast.mjs（可單獨測），這裡只負責把違規接上 fail()。
// 為什麼要 gate 而不是註解：近黑字降透明度掉出 AA 沒有任何編譯期訊號，
// 畫面上看起來也只是「淡了一點」—— 兩席各自憑直覺寫過 0.32~0.72，全部不合格。
function checkBandContrast() {
  const file = join(ROOT, 'apps/web/src/styles.scss');
  if (!existsSync(file)) return;

  // **12 道 gate 裡唯一沒有登記範圍的一道**（2026-09-06 的載體複查抓到）。
  // 它只讀一個檔，所以不會像走目錄的 gate 那樣「靜靜少掃一片」——
  // 但**路徑被改掉或加了提早 return 一樣沒有訊號**，而那正是 scan-scope 要防的。
  //
  // 能力邊界：它讀的是 styles.scss 裡的**全域 token 定義**。
  // 元件若自己重新定義 `--accent-vivid` 之類，會在該元件底下遮蔽全域值，
  // 而這道 gate 看不到。**2026-09-06 查過：那四個 token 目前只在 styles.scss 定義**，
  // 所以單檔範圍今天是對的 —— 但它是「現況」不是「保證」。
  recordScope('band-contrast', { roots: ['apps/web/src'], exts: ['.scss'] });
  for (const violation of bandContrastViolations(readFileSync(file, 'utf8'))) fail(violation);
}

checkBandContrast();

// ── 使用處的文字對比 ───────────────────────────────────────────────────────────────────────
// band-contrast 守的是 token 自己的值；這一支守的是**配對**：每個 token 都合格、
// 配在一起卻不合格。判例是琥珀 chip —— `--warning-600` 對白 5.02 ✓、對 100 底 4.51 ✓，
// 但 hover 換到 200 底只剩 4.03 ✗，而那個 hover 區塊只寫 background、文字色是繼承的。
//
// 既有的違規進 baseline（跟 test-baseline.json 同一套想法）：**只擋新增的**。
// baseline 的數量會印成警告持續曝光，不然它會變成一個沒人記得要縮小的清單。
function checkUsageContrast() {
  const stylesPath = join(ROOT, 'apps/web/src/styles.scss');
  const webSrc = join(ROOT, 'apps/web/src');
  if (!existsSync(stylesPath) || !existsSync(webSrc)) return;

  const palette = readTokenPalette(readFileSync(stylesPath, 'utf8'));
  const carriers = styleCarriers(webSrc);
  recordScope('usage-contrast', { roots: [webSrc.slice(ROOT.length + 1)], exts: ['.scss', '.ts'] });

  const current = new Map();
  for (const { path: rel, source } of carriers) {
    for (const v of usageContrastViolations(source, palette)) {
      current.set(`${rel}|${v.selector}|${v.fg}|${v.bg}`, v);
    }
  }

  // 豁免不是債 —— 它不進 baseline，所以 `harness:write` 也不會把它寫成債。
  const exemptKeys = Object.keys(CONTRAST_EXEMPT);
  const keys = [...current.keys()].filter((k) => !(k in CONTRAST_EXEMPT)).sort();

  if (mode === 'write') {
    writeFileSync(CONTRAST_BASELINE, `${JSON.stringify(keys, null, 2)}\n`);
    return;
  }

  // **豁免必須是可否證的。** 一筆對不上任何實際違規的豁免是謊不是保險：
  // 它讀起來像「這裡有個已知的例外」，實際上那個地方早就改掉了。
  // 這一條是 write 模式修不掉的（豁免寫在程式碼裡），只能由人刪，這是刻意的。
  const orphanExempt = exemptKeys.filter((k) => !current.has(k));
  for (const key of orphanExempt) {
    const [file, sel, fg, bg] = key.split('|');
    fail(
      `對比豁免過期：${file} 的 ${sel} 用 ${fg} 疊 ${bg} 已經不違規了 —— ` +
        `把 CONTRAST_EXEMPT 裡那一筆刪掉（豁免歸零不是把數字改小，是整筆移除）`,
    );
  }

  const baseline = new Set(
    existsSync(CONTRAST_BASELINE) ? JSON.parse(readFileSync(CONTRAST_BASELINE, 'utf8')) : [],
  );

  const fresh = keys.filter((k) => !baseline.has(k));
  for (const key of fresh) {
    const [file, sel, fg, bg] = key.split('|');
    const v = current.get(key);
    fail(
      `${file}:${v.line} 的 ${sel} 用 ${fg} 疊在 ${bg} 上只有 ${v.ratio.toFixed(2)}:1，` +
        `低於文字的 AA 門檻 4.5:1`,
    );
  }

  const stale = [...baseline].filter((k) => !current.has(k));
  if (stale.length > 0) {
    warnings.push(
      `對比 baseline 有 ${stale.length} 筆已經修好了 —— 跑 npm run harness:write 把它們移出清單`,
    );
  }

  // 最大宗的那個配對**算出來**，不要寫死 —— 上一版硬寫「多數是 --zinc-400 那筆全站舊債」，
  // 那筆清掉之後這句就變成假的，而且沒有任何東西會提醒你（c11）。
  // **豁免要跟債分開講。** 債歸零之後上面那段統計就不觸發了，而如果這裡什麼都不說，
  // 「零債」會被讀成「零例外」—— 那不是真的，只是例外搬到另一本帳上。
  if (exemptKeys.length > 0) {
    warnings.push(
      `對比債 ${keys.filter((k) => baseline.has(k)).length} 筆、永久豁免 ${exemptKeys.length} 筆` +
        `（豁免有明文理由，看 check-harness.mjs 的 CONTRAST_EXEMPT；` +
        `豁免對不上實際違規時 gate 會紅）`,
    );
  }

  const stillInBaseline = keys.filter((k) => baseline.has(k));
  if (stillInBaseline.length > 0) {
    const byPair = new Map();
    for (const k of stillInBaseline) {
      const [, , fg, bg] = k.split('|');
      const pair = `${fg} 疊 ${bg}`;
      byPair.set(pair, (byPair.get(pair) ?? 0) + 1);
    }
    const [pair, n] = [...byPair].sort((a, b) => b[1] - a[1])[0];
    warnings.push(
      `${stillInBaseline.length} 處既有的文字對比不合格（在 baseline 裡、不擋）—— ` +
        `最大宗是 ${pair}，佔 ${n} 筆`,
    );
  }

  // **能力邊界要明寫，不能默認。** 這道 gate 綠燈的意思是「掃得到的那一半沒問題」，
  // 不是「對比都沒問題」—— 底色來自跨檔案 DOM 祖先的配對它看不到，而那是最常見的
  // 寫錯形狀（只宣告 color、底色在別的元件裡）。
  //
  // 評估過三個補法都不划算，數字留在這裡免得下次有人再想一遍：
  //   容器白名單    手維護的 class→底色對映，正是 c11 擋的會腐化清單
  //   假設白底      實測訊噪比 2:133（135 個命中裡只有 2 個可信）
  //   真算 CSS 串接  跨檔案跨元件，成本高一個量級，換來的主要是重複報同一筆債
  // 那 135 個命中裡有 121 個是 --zinc-400 / --zinc-300 這一筆已知債的分身 ——
  // 盲點後面藏的不是一堆未知 bug，是一筆已知的債。那是工單不是 gate 的事。
  warnings.push(
    '對比 gate 只看得到「同一個規則區塊或它的祖先裡同時宣告了 color 與 background」的配對；' +
      '底色來自跨檔案 DOM 祖先的它看不到 —— 綠燈的意思是「掃得到的那一半沒問題」',
  );
}

checkUsageContrast();

// ── 手機優先遷移的 ratchet ─────────────────────────────────────────────────────────────
// 邏輯住在 lib/mobile-first.mjs（可單獨測）。守的是「桌機優先的寫法只准變少」。
// 沒有這道 ratchet，遷移會停在「大家都同意要做」然後永遠不動 ——
// 因為每一次「就這一次先照舊寫」都是局部理性的。
function checkMobileFirst() {
  const webSrc = join(ROOT, 'apps/web/src');
  if (!existsSync(webSrc)) return;

  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.scss')) {
        files.push({ path: full.slice(ROOT.length + 1), source: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(webSrc);

  recordScope('mobile-first', { roots: [webSrc.slice(ROOT.length + 1)], exts: ['.scss'] });

  const current = desktopFirstFiles(files);

  if (mode === 'write') {
    writeFileSync(MOBILE_FIRST_BASELINE, `${JSON.stringify(current, null, 2)}\n`);
    return;
  }

  const baseline = new Set(
    existsSync(MOBILE_FIRST_BASELINE)
      ? JSON.parse(readFileSync(MOBILE_FIRST_BASELINE, 'utf8'))
      : [],
  );

  for (const path of current.filter((p) => !baseline.has(p))) {
    fail(
      `${path} 用了 respond-to（max-width，桌機優先）。全站已改為手機優先 —— ` +
        `請改用 respond-from（min-width）。既有檔案在 mobile-first-baseline.json 裡，新增的會擋。`,
    );
  }

  const migrated = [...baseline].filter((p) => !current.includes(p));
  if (migrated.length > 0) {
    warnings.push(
      `手機優先基線有 ${migrated.length} 支已經遷移完了 —— 跑 npm run harness:write 把成果記下來`,
    );
  }

  if (current.length > 0) {
    const total = files
      .filter((f) => current.includes(f.path))
      .reduce((n, f) => n + countDesktopFirst(f.source), 0);
    warnings.push(
      `手機優先遷移進度：還有 ${current.length} 支 SCSS 用桌機優先寫法（共 ${total} 處 respond-to）`,
    );
  }
}

// ── PrimeNG 模組的孤兒 import ──────────────────────────────────────────────
// Angular 的 NG8113 只對 standalone 元件發診斷，**不涵蓋 NgModule** ——
// `imports: [TagModule]` 在模板早就不用 <p-tag> 之後，編譯器一句話都不會說。
// 這個坑在這個 repo 長出來過兩次（#119 三支、3b-3 收尾十支，而同一次 build 的
// NG8113 計數是 0）。兩次都靠人記得對帳。**第三次不要再靠人。**
function checkOrphanImports() {
  const webSrc = join(ROOT, 'apps/web/src');
  if (!existsSync(webSrc)) return;

  const components = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        const ts = readFileSync(full, 'utf8');
        if (!ts.includes('@Component')) continue;
        const html = full.replace(/\.ts$/, '.html');
        components.push({
          path: full.slice(ROOT.length + 1),
          ts,
          template: existsSync(html) ? readFileSync(html, 'utf8') : '',
        });
      }
    }
  };
  walk(webSrc);

  recordScope('orphan-imports', { roots: [webSrc.slice(ROOT.length + 1)], exts: ['.ts', '.html'] });

  for (const { path, module } of orphanModuleImports(components)) {
    fail(
      `${path} 的 imports 有 ${module}，但模板沒有用到它提供的任何選擇器。` +
        `**Angular 的 NG8113 不涵蓋 NgModule**，所以編譯器不會說話 —— 請自己刪掉。`,
    );
  }
}

checkOrphanImports();

// ── 拇指區的兩條規則 ────────────────────────────────────────────────────────
// 邏輯住在 lib/page-actions.mjs（可單獨測）。
// 沒有 gate 的話這個決定會慢慢被磨掉：下一個人加新頁面時最順手的寫法仍然是
// 「在標頭放一顆 p-button」，而那在桌機上看起來完全正常 ——
// **手機上按不到這件事，寫的人不會在自己的螢幕上發現。**
function checkPageActions() {
  const webSrc = join(ROOT, 'apps/web/src');
  if (!existsSync(webSrc)) return;

  const html = [];
  const ts = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) {
        html.push({ path: full.slice(ROOT.length + 1), source: readFileSync(full, 'utf8') });
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        ts.push({ path: full.slice(ROOT.length + 1), source: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(webSrc);

  // ── 規則一：標頭裡不得直接放按鈕（既有的進 baseline，只擋新增）──
  // 規則一吃的是**模板**，而 15 支元件的模板住在 `.ts` 的 `template:` 字串裡。
  // 這個函式本來就已經收了 `ts` 陣列（給規則二用），只是規則一沒吃到。
  const judged = [...html, ...inlineCarriers(ts).templates];
  recordScope('page-actions', { roots: [webSrc.slice(ROOT.length + 1)], exts: ['.html', '.ts'] });

  const current = headerActionButtons(judged);

  if (mode === 'write') {
    writeFileSync(PAGE_ACTIONS_BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  } else {
    const baseline = new Set(
      existsSync(PAGE_ACTIONS_BASELINE)
        ? JSON.parse(readFileSync(PAGE_ACTIONS_BASELINE, 'utf8'))
        : [],
    );
    for (const path of current.filter((p) => !baseline.has(p))) {
      fail(
        `${path} 在 __header-actions 裡直接放了 p-button —— 主要行動請改用 ` +
          `app-page-actions（桌機標頭 / 手機停靠列，一次宣告兩處渲染）。` +
          `既有的在 page-actions-baseline.json 裡，新增的會擋。`,
      );
    }
    const migrated = [...baseline].filter((p) => !current.includes(p));
    if (migrated.length > 0) {
      warnings.push(
        `拇指區基線有 ${migrated.length} 支已經遷移完了 —— 跑 npm run harness:write 把成果記下來`,
      );
    }
  }

  // ── 規則二：破壞性行動永不進停靠列（**沒有 baseline，一律擋**）──
  // 這條不給豁免：拇指範圍最容易誤觸，而誤觸刪除是資料沒了。
  for (const hit of destructivePrimaryActions(ts)) {
    fail(
      `${hit.path} 把「${hit.label}」設成主要行動，但它含有破壞性動詞「${hit.word}」。` +
        `**破壞性行動永不進停靠列** —— 拇指範圍最容易誤觸，誤觸「新增」是多一筆草稿，` +
        `誤觸「刪除」是資料沒了。請留在選單裡並加確認。`,
    );
  }
}

checkPageActions();

// ── API query 參數的前端覆蓋率 ───────────────────────────────────────────────────────────
// **抓「schema 有這個參數，前端 service 沒有」。** 這一族發生過三次
//（`billingMode` #186、`hasInvoice` #238、`attendanceTaken` #298），每次的症狀都一樣：
// API 從一開始就吃那個參數，但前端的參數型別漏了它，**於是呼叫端不知道那個能力存在**。
// #186 那次的代價是整批報名的計費設定全部沒送出。
//
// 判準、四種形狀的偵測、與能力邊界見 `api-param-coverage.mjs` 的檔頭。
// 一句話的邊界：**它只比對名字有沒有被當成 query key 送出，不驗型別正確性。**
function checkApiParamCoverage() {
  if (!existsSync(join(ROOT, 'apps/api/src/index.ts'))) return;

  let apiParams;
  try {
    apiParams = collectApiParams(ROOT, recordScope);
  } catch {
    // 產不出文件就沒有東西可比 —— **說出來，不要靜靜跳過**（那會是一個沒有範圍的 0）
    warnings.push('API 文件產生失敗，本輪跳過 query 參數覆蓋率檢查（`getOpenAPIDocument` 叫不動）');
    return;
  }

  const services = loadServices(ROOT, recordScope);
  const missing = findMissing(apiParams, services);
  const baseline = new Set(
    existsSync(API_PARAM_BASELINE) ? JSON.parse(readFileSync(API_PARAM_BASELINE, 'utf8')) : [],
  );

  for (const hit of missing) {
    const key = `${hit.path}|${hit.name}`;
    if (baseline.has(key)) continue;
    fail(
      `${hit.file} 沒有把 \`${hit.name}\` 當成 query 參數送出，但 \`${hit.path}\` 收它。` +
        `**前端不知道這個能力存在** —— 不是型別寫錯，是那個參數從來沒被傳過。` +
        `刻意不支援的話請加進 api-param-coverage.mjs 的 EXEMPT（要寫 why）。`,
    );
  }

  // 對應不上的端點要可見 —— 跳過等於「gate 說沒問題，但它根本沒去看那裡」
  const orphans = findOrphanEndpoints(apiParams, services);
  if (orphans.length > 0) {
    warnings.push(
      `${orphans.length} 個帶 query 參數的端點沒有任何 service 認領（${orphans.join('、')}）—— ` +
        `它們不在這道 gate 的守備範圍內。`,
    );
  }
}

checkApiParamCoverage();

// ── 掃描範圍的 ratchet ──────────────────────────────────────────────────────────────────
// **不是「印出範圍」，是把範圍釘住。** 理由與已知邊界見 lib/scan-scope.mjs。
// 摘要一句：一樣就一個字都不印（12 道每次刷一片會稀釋訊號），
// 不一樣就紅燈 —— 而且**範圍縮小**跟新增違規一樣是紅的，那是這支主要要抓的。
//
// A17 少掃 shared/ 不知道多久而一直是綠的，就是因為沒有東西看著範圍本身。
function checkScanScope() {
  const current = collectedScopes();

  if (mode === 'write') {
    writeFileSync(SCAN_SCOPE, `${JSON.stringify(current, null, 2)}\n`);
    return;
  }

  if (!existsSync(SCAN_SCOPE)) {
    warnings.push('還沒有 scan-scope.json —— 跑 npm run harness:write 建立掃描範圍的基準');
    return;
  }

  for (const line of diffScopes(current, JSON.parse(readFileSync(SCAN_SCOPE, 'utf8')))) {
    fail(
      `掃描範圍變了 —— ${line}。` +
        `**縮小**通常是意外（多了一個 filter、一個提早 return），先確認不是；` +
        `確定是刻意的就跑 npm run harness:write`,
    );
  }
}

// ── A20. 可互動元素的 class 不得全部沒定義 ──────────────────────────────────────────────
// 守「**可點的東西看起來不可點**」。判準與能力邊界見 lib/orphan-class.mjs。
//
// **零 baseline，立法時零違規** —— 而那個 0 是用陷阱驗過的，不是掃出來就信：
// 天真的單行 regex 會漏掉幾乎所有真實模板（Angular 的 button 經 prettier 之後
// 都是多行的），而那樣得到的 0 跟真正的 0 在輸出上一模一樣。
//
// 全站另有 81 個「用了但沒定義」的自家 class，**刻意不納入** ——
// 嚴重度差太多（多數是死修飾詞或遷移殘留），而一份沒有人會清的 baseline
// 等於裝飾：它長期發出「有債」的訊號，而那訊號永遠不變。
function checkUnstyledInteractive() {
  const webSrc = join(ROOT, 'apps/web/src');
  if (!existsSync(webSrc)) return;

  recordScope('unstyled-interactive', {
    roots: [webSrc.slice(ROOT.length + 1)],
    exts: ['.scss', '.html', '.ts'],
  });

  // **樣式的載體不只 .scss。** 只讀 .scss 的話，全 inline 的元件（leave-form-dialog
  // 的 12 個 class）與 index.html 的 <style>（啟動畫面 4 個）會被整批判成孤兒 ——
  // 我第一版就是這樣，當場製造 17 個假陽性。
  const styleSources = walk(webSrc, '.scss').map((f) => readFileSync(f, 'utf8'));
  for (const f of walk(webSrc, '.ts')) {
    if (f.endsWith('.spec.ts')) continue;
    const src = readFileSync(f, 'utf8');
    // **整份 .ts 都餵進去，不只 `styles:`。** 樣式在 TS 裡有第四種載體：
    // 直接寫成 CSS 字串注入別的視窗（invoice-detail-dialog 的列印版面就是，
    // 9 個 .print-doc__* 全在那裡）。多收的代價是 JS 的 `foo.bar {` 也會被
    // 當成 selector 而多出幾個名字 —— **那個方向是安全的**：它造成漏報不是誤報，
    // 而誤報會讓人關掉整道 gate。BEM 名字夠獨特，撞名的機率很低。
    styleSources.push(src);
  }
  const indexHtml = join(webSrc, 'index.html');
  if (existsSync(indexHtml)) styleSources.push(readFileSync(indexHtml, 'utf8'));

  const defined = definedClasses(styleSources);

  const templates = walk(webSrc, '.html').map((f) => ({
    path: f.slice(ROOT.length + 1),
    source: readFileSync(f, 'utf8'),
  }));
  for (const f of walk(webSrc, '.ts')) {
    if (f.endsWith('.spec.ts')) continue;
    const src = readFileSync(f, 'utf8');
    if (!src.includes('@Component')) continue;
    const t = inlineTemplate(src);
    if (t.trim()) templates.push({ path: f.slice(ROOT.length + 1), source: t });
  }

  for (const { path, source } of templates) {
    for (const classes of unstyledInteractive(source, defined)) {
      fail(
        `${path} 有一個可點的元素，但它的 class（${classes}）**全庫沒有任何 SCSS 定義** —— ` +
          `它會吃全域 button reset 渲染成純文字，於是沒有人會去點它。` +
          `注意 BEM 的 &__x 巢狀：用字面 grep 找不到不代表沒定義`,
      );
    }
  }
}

checkUnstyledInteractive();

checkScanScope();

// ── 生成出來的 baseline 也要過 prettier ────────────────────────────────────────────────
// **不加這段的話，排版取決於作者有沒有順手跑 prettier。** 我自己 #300 手動跑過，
// 所以 scan-scope.json 進 main 時是壓縮形式；下一個人走 harness:write 產出的是
// JSON.stringify 的展開形式，於是整個檔在他的 diff 裡重排 —— 看起來像他改了一大片。
// （2026-09-04 admin-pages 的 #304 就是這樣，那是我引進的噪音不是他的。）
//
// gate 本身對排版免疫（比對的是 JSON.parse 之後的物件），所以這不會造成紅燈乒乓，
// 純粹是 diff 噪音 —— 但 diff 噪音會讓 review 的人略過真正的變動。
//
// 用整個目錄而不是逐一列舉：**下一個 baseline 自動被涵蓋**。列舉的話，
// 忘記加的那一支會安靜地帶著不同排版進來 —— 那正是這段要修的病本身。
if (mode === 'write') {
  // **只吃 .json**：整個目錄的話 prettier 會連 .mjs 一起重排 —— harness:write
  // 不該去動原始碼（實測會改到 lib/orphan-imports.mjs，那不是它的事）。
  // prettier 自己會展開這個 glob，不需要 shell。
  formatGenerated(['tools/agent-harness/*.json'], ROOT);
}

// ── report ───────────────────────────────────────────────────────────────────────────────
// --write 一律 exit 0：它的工作是「修好能自動修的」，剩下的（例如 CLAUDE.md 被塞進規則）
// 本來就得人改。若這裡跟著 exit 1，`harness:write` 的 `&&` 會短路，KB 的 --write 就整個
// 不會跑 —— 踩過一次。真正的把關由隨後的 --check 負責。
// `--scope [路徑…]` —— 查詢用，不進常規輸出。
// 帶路徑時做**反查**：這些檔會被哪幾道 gate 看到。review 別人的 PR 時最常要的是這個
// （steward 2026-09-04 提的使用情境），而不是 12 道的完整範圍。
if (process.argv.includes('--scope')) {
  const scopes = collectedScopes();
  const paths = process.argv
    .slice(process.argv.indexOf('--scope') + 1)
    .filter((a) => !a.startsWith('--'));

  if (paths.length === 0) {
    for (const [gate, { roots, exts }] of Object.entries(scopes)) {
      console.log(`${gate}\n  目錄：${roots.join('、')}\n  副檔名：${exts.join('、')}`);
    }
  } else {
    for (const rel of paths) {
      const seen = Object.entries(scopes)
        .filter(
          ([, { roots, exts }]) =>
            roots.some((r) => rel.startsWith(`${r}/`)) && exts.some((e) => rel.endsWith(e)),
        )
        .map(([gate]) => gate);
      // **「沒有任何 gate 看它」本身就是答案** —— 那正是載體盲區的形狀
      console.log(
        `${rel}\n  → ${seen.length > 0 ? seen.join('、') : '**沒有任何 gate 看這個檔**'}`,
      );
    }
  }
  process.exit(0);
}

if (warnings.length > 0) {
  console.warn(`⚠ harness 有 ${warnings.length} 項提醒（不擋，exit code 不受影響）：`);
  for (const message of warnings) console.warn(`  - ${message}`);
}

if (failures.length > 0 && mode !== 'write') {
  console.error(`✖ harness gate 有 ${failures.length} 項不同步：`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}
if (failures.length > 0) {
  console.warn(`⚠ 另有 ${failures.length} 項無法自動修，需要人工處理（細節跑 npm run harness）`);
} else {
  console.log(`✓ harness gate 全綠（${locked.length} 個 skill）`);
}
