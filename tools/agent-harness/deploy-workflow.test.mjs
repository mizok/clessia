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

test('四個 job 都在：plan → deploy-api → deploy-web → verify-live', () => {
  assert.deepEqual(Object.keys(all), ['plan', 'deploy-api', 'deploy-web', 'verify-live']);
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
    /^concurrency:\s*\n\s+group: deploy-prod\s*\n\s+cancel-in-progress: false/m,
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

test('帶 secret 的只有兩個 deploy job，而且都在 production environment', () => {
  for (const name of ['deploy-api', 'deploy-web']) {
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
  assert.match(code, /^run-name: >-\s*\n.*inputs\.dry_run && ' \(dry-run\)'/m);
  assert.match(all.plan, /select\(test\("dry-run"\) \| not\)/);
});
