#!/usr/bin/env node
/**
 * 修憲工具 —— 在憲法末尾新增一條 clause。
 *
 *   node tools/amend-constitution.mjs
 *
 * ⚠️ **這支腳本不是護欄，是便利工具。**
 *
 * `.claude/settings.json` 用 `Edit(kb/wiki/architecture/constitution.md)` 的 deny 規則
 * 擋住 agent 修憲。腳本繞得過那條規則（它走 Bash 不走 Edit），所以**這支腳本本身
 * 也必須在 deny 名單裡**，否則護欄形同虛設。護欄要留在 harness 層，不能靠腳本自律。
 *
 * 設計上的三個限制：
 *   1. 只新增，不修改也不刪除既有條文 —— 改既有的法是更重的行為，不該有捷徑
 *   2. 強制互動確認（要 TTY）—— 非互動環境直接拒絕
 *   3. 寫入後立刻跑 harness，A5 會斷言被引用的 clause 真的存在
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAW = join(ROOT, 'kb/wiki/architecture/constitution.md');
const ENFORCE = join(ROOT, 'kb/wiki/architecture/constitution-enforcement.md');

if (!existsSync(LAW)) {
  console.error(`✖ 找不到憲法：${LAW}`);
  process.exit(1);
}

// ── 限制 2：非互動就拒絕 ────────────────────────────────────────────────────
if (!process.stdin.isTTY) {
  console.error('✖ 修憲必須互動執行（需要 TTY）。');
  console.error('  這是刻意的：修法是人類的行為，不該能被腳本或 agent 非互動觸發。');
  process.exit(1);
}

const source = readFileSync(LAW, 'utf8');
const ids = [...source.matchAll(/^### (c\d+) /gm)].map((m) => m[1]);
const nextId = `c${Math.max(...ids.map((i) => Number(i.slice(1)))) + 1}`;

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));

console.log(`\n現有條款：${ids.join(', ')}`);
console.log(`新條款編號：${nextId}\n`);

const title = await ask('條款標題（例：客戶必須能夠脫離並自架）：');
if (!title) { console.error('✖ 標題不可空白。'); rl.close(); process.exit(1); }

let kind = '';
while (!['d', 's'].includes(kind)) {
  kind = (await ask('可決定性 [d]eterministic（機器可判定）/ [s]emantic（需人判斷）：')).toLowerCase();
}
const decidability = kind === 'd' ? 'Deterministic' : 'Semantic';

console.log('\n條文內容（多行，輸入單獨一行 . 結束）：');
const body = [];
for (;;) {
  const line = await ask('');
  if (line === '.') break;
  body.push(line);
}
if (body.length === 0) { console.error('✖ 條文不可空白。'); rl.close(); process.exit(1); }

const violation = await ask('\n違反例（一行，可留空）：');
const rationale = await ask('理由指標（例：kb/wiki/architecture/foo.md，可留空）：');

// ── 組出條文 ────────────────────────────────────────────────────────────────
const parts = [`### ${nextId} ${title} [${decidability}]`, '', body.join('\n')];
if (violation) parts.push('', `違反例：${violation}`);
if (rationale) parts.push('', `> 理由：${rationale}`);
const clause = parts.join('\n') + '\n';

console.log('\n' + '─'.repeat(60));
console.log(clause);
console.log('─'.repeat(60));

const confirm = await ask('\n確認寫入憲法？這是修法行為。輸入 yes 確認：');
rl.close();
if (confirm !== 'yes') { console.log('已取消，未寫入任何內容。'); process.exit(0); }

// ── 限制 1：只在最後一條之後插入，不碰既有內容 ──────────────────────────────
const anchor = '\n---\n\n## 附錄';
const at = source.indexOf(anchor);
if (at === -1) { console.error('✖ 找不到附錄錨點，憲法結構可能已改變。請手動編輯。'); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);
let next = source.slice(0, at) + '\n' + clause + source.slice(at);
next = next.replace(/^updated: .*$/m, `updated: ${today}`);
writeFileSync(LAW, next);
console.log(`\n✓ ${nextId} 已寫入 ${LAW.replace(ROOT + '/', '')}`);

// 強制機制表補一列待填
if (existsSync(ENFORCE)) {
  const e = readFileSync(ENFORCE, 'utf8');
  const rows = e.split('\n');
  const last = rows.map((l, i) => (/^\| c\d+ /.test(l) ? i : -1)).filter((i) => i >= 0).pop();
  if (last !== undefined) {
    rows.splice(last + 1, 0, `| ${nextId} ${title} | ${decidability} | **待補** | ❌ 未接 |`);
    writeFileSync(ENFORCE, rows.join('\n'));
    console.log(`✓ ${ENFORCE.replace(ROOT + '/', '')} 已補上待填列 —— 記得填上守它的機制`);
  }
}

// ── 限制 3：立刻驗證 ────────────────────────────────────────────────────────
console.log('\n跑 harness 驗證…\n');
try {
  execSync('npm run harness', { cwd: ROOT, stdio: 'inherit' });
} catch {
  console.error('\n✖ harness 未通過 —— 請檢查上面的訊息。憲法已寫入，必要時用 git 還原。');
  process.exit(1);
}
console.log('\n完成。記得 commit，並在 constitution-enforcement.md 填上強制機制。');
