/**
 * `deploy.yml` 的結構（#1283）。`npm run harness:test` 會跑到。
 *
 * 守的是**結構**不是行為（workflow 沒辦法在本機跑），寫法照 `migrate-workflow.test.mjs`：
 * 依縮排切 job、只用標準庫。每一條對應一個「改壞了會在正式環境出事、而且不會有人馬上發現」的形狀。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const yml = readFileSync('.github/workflows/deploy.yml', 'utf8');
const code = yml
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

function jobs() {
  const lines = code.slice(code.indexOf('\njobs:\n') + 7).split('\n');
  const out = {};
  let name = null;
  for (const line of lines) {
    const m = /^ {2}([\w-]+):\s*$/.exec(line);
    if (m) {
      name = m[1];
      out[name] = '';
    } else if (name) out[name] += `${line}\n`;
  }
  return out;
}

const all = jobs();

test('五個 job 都在：plan → deploy-api → deploy-web → verify-live → probe-api', () => {
  assert.deepEqual(Object.keys(all), [
    'plan',
    'deploy-api',
    'deploy-web',
    'verify-live',
    'probe-api',
  ]);
});

// 接在 verify 後面的話，「套完才部署」就要靠 poll migrate —— 接在 migrate 後面是結構保證
test('觸發是 migrate 的 completed，不是 verify', () => {
  assert.match(code, /workflow_run:\s*\n\s+workflows: \[migrate\]\s*\n\s+types: \[completed\]/);
  assert.doesNotMatch(code, /workflows: \[verify\]/);
});

test('入口只接本 repo、main、conclusion success 的 migrate（fork 的 PR 可以把分支取名 main）', () => {
  assert.match(all.plan, /workflow_run\.conclusion == 'success'/);
  assert.match(all.plan, /workflow_run\.head_branch == 'main'/);
  assert.match(all.plan, /workflow_run\.head_repository\.full_name == github\.repository/);
  assert.match(all.plan, /git merge-base --is-ancestor "\$target" origin\/main/);
});

// job 層的 group 會讓這顆的 deploy-web 去取代下一顆排隊中的 deploy-api
test('concurrency 掛在頂層、不殺正在跑的', () => {
  const topLevel = code.slice(0, code.indexOf('\njobs:\n'));
  assert.match(
    topLevel,
    /^concurrency:\s*\n\s+group: .*'deploy-prod'[^\n]*\n\s+cancel-in-progress: false/m,
  );
  // dry-run 不能跟真部署同 group —— 否則 dispatch 一顆 dry-run 會取代排隊中的真部署（reviewer 二讀）
  assert.match(
    topLevel,
    /group: \$\{\{ \(inputs\.dry_run \|\| vars\.DEPLOY_ENABLED != 'true'\) && 'deploy-dry-run' \|\| 'deploy-prod' \}\}/,
  );
  for (const body of Object.values(all)) assert.doesNotMatch(body, /concurrency:/);
});

test('api 先 web 後；api 失敗 web 不跑', () => {
  assert.match(all['deploy-web'], /needs: \[plan, deploy-api\]/);
  assert.match(
    all['deploy-web'],
    /needs\.deploy-api\.result == 'success' \|\| needs\.deploy-api\.result == 'skipped'/,
  );
});

test('帶 secret 的只有兩個 deploy job 與 probe-api，而且都在 production environment', () => {
  for (const name of ['deploy-api', 'deploy-web', 'probe-api']) {
    assert.match(all[name], /environment: production/, name);
  }
  for (const name of ['plan', 'verify-live']) {
    assert.doesNotMatch(all[name], /environment:/, name);
    assert.doesNotMatch(all[name], /secrets\./, name);
  }
});

test('不碰 DB：migration 歸 migrate.yml 管', () => {
  assert.doesNotMatch(code, /supabase db push|db push/);
});

test('api 真的部署前先 dry-run 驗 binding', () => {
  const api = all['deploy-api'];
  const dry = api.indexOf('--dry-run');
  const real = api.indexOf('wrangler deploy --env production |');
  assert.ok(dry > 0 && real > dry, 'dry-run 要排在真的部署前面');
});

test('dry-run 的 run 標題要標出來 —— plan 撈「上次部署」時靠它排除', () => {
  // DEPLOY_ENABLED 沒開的那幾輪也要標 —— 否則開關打開後，那段期間的改動被 diff 當成已部署
  assert.match(
    code,
    /^run-name: >-\s*\n.*\(inputs\.dry_run \|\| vars\.DEPLOY_ENABLED != 'true'\) && ' \(dry-run\)'/m,
  );
  assert.match(all.plan, /select\(test\("dry-run"\) \| not\)/);
});

// workflow 進 main、secret 一放，下一次 migrate completed 就會觸發 —— 開關讓「先 dry-run」有空檔
test('真的部署的兩個 step 都要 DEPLOY_ENABLED == true', () => {
  for (const name of ['deploy-api', 'deploy-web']) {
    assert.match(
      all[name],
      /- id: deploy\s*\n\s+if: [^\n]*!inputs\.dry_run && vars\.DEPLOY_ENABLED == 'true'/,
      name,
    );
  }
});

// #1435：帶身分的列表探針，紅就回滾 api。最要緊的是**憑證壞掉不能觸發回滾**
test('probe-api 只在 api 真的部署了才跑', () => {
  assert.match(
    all['probe-api'],
    /if: always\(\) && needs\.deploy-api\.outputs\.deployed == 'true'/,
  );
});

test('回滾只在 result == broken；auth（401／403 憑證問題）只紅燈', () => {
  const job = all['probe-api'];
  const rollback = job.slice(0, job.indexOf('wrangler rollback'));
  const lastIf = rollback.slice(rollback.lastIndexOf('- if:'));
  assert.match(lastIf, /^- if: steps\.probe\.outputs\.result == 'broken'\s*\n/);
  assert.match(job, /wrangler rollback --env production -y -m /);
});

test('探針沒設 secret 不紅：腳本 skipped，紅燈 step 只認 broken／auth／unknown', () => {
  const job = all['probe-api'];
  assert.match(job, /PROBE_COOKIE: \$\{\{ secrets\.PROBE_COOKIE \}\}/);
  assert.match(
    job,
    /- if: steps\.probe\.outputs\.result == 'broken' \|\| steps\.probe\.outputs\.result == 'auth' \|\| steps\.probe\.outputs\.result == 'unknown'\s*\n\s+run: \|[\s\S]*exit 1/,
  );
});
