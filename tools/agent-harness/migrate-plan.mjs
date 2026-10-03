#!/usr/bin/env node
/**
 * `migrate.yml` 的計畫步驟（#963）：算 repo 對正式 DB 的 migration 差集，決定能不能自動套。
 * 判斷在 `lib/migration-plan.mjs`（有測試）；這支只負責讀檔、寫 GitHub 的 output 與 summary。
 *
 *   node tools/agent-harness/migrate-plan.mjs --remote <file> [--deployed] [--expect <v1,v2>] [--expect-clean]
 *
 * - `--remote`：正式 DB `supabase_migrations.schema_migrations` 的 version，一行一支
 * - `--deployed`：部署者確認這一批程式碼已上線（允許套 after-deploy backfill）
 * - `--expect`：apply 前重算一次，待套清單必須跟 plan 時一模一樣 —— 等核准的期間有人動過 DB 就停
 * - `--expect-clean`：apply 後重算，差集必須為 0
 *
 * exit 1 = 不能往下走（blocked，或 expect 不符）。其餘 exit 0，狀態看 `state` output。
 */
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { isAfterDeploy, planMigrations, splitsTransaction } from './lib/migration-plan.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const DIR = 'supabase/migrations';
const local = readdirSync(DIR)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => {
    const version = /^(\d{14})_/.exec(file)?.[1];
    if (!version) throw new Error(`migration 檔名不合 c4 格式：${file}`);
    const sql = readFileSync(join(DIR, file), 'utf8');
    return {
      version,
      file,
      afterDeploy: isAfterDeploy(sql),
      splitsTransaction: splitsTransaction(sql),
    };
  });

const remoteFile = value('--remote');
if (!remoteFile) throw new Error('缺 --remote <file>');
const remote = readFileSync(remoteFile, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const plan = planMigrations({ local, remote, deployed: flag('--deployed') });
const pendingCsv = plan.pending.map((m) => m.version).join(',');

let failure = plan.state === 'blocked' ? plan.reason : null;
const expected = value('--expect');
if (expected !== undefined && expected !== pendingCsv) {
  failure = `待套清單跟 plan 時不一樣（plan：${expected || '無'}；現在：${pendingCsv || '無'}）—— 等核准的期間正式 DB 被動過，停。`;
}
if (flag('--expect-clean') && plan.state !== 'clean') {
  failure = `套完之後差集不是 0：${plan.reason}`;
}

const summary = [
  `### migration 差集：\`${plan.state}\``,
  '',
  plan.reason,
  '',
  `repo ${local.length} 支／正式 DB ${remote.length} 支`,
  '',
  ...(plan.pending.length > 0
    ? [
        '| 待套 | 類型 |',
        '| --- | --- |',
        ...plan.pending.map(
          (m) => `| \`${m.file}\` | ${m.afterDeploy ? 'after-deploy' : 'schema'} |`,
        ),
      ]
    : []),
  ...(failure ? ['', `**❌ ${failure}**`] : []),
].join('\n');

console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `state=${plan.state}\npending=${pendingCsv}\n`);
}
if (failure) process.exit(1);
