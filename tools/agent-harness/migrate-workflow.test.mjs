/**
 * `migrate.yml` 的安全邊界（#968 計畫席審出的 pwn-request 形狀）。`npm run harness:test` 會跑到。
 *
 * 這些斷言守的是**結構**，不是行為 —— workflow 沒辦法在本機跑。但洞的形狀本來就是結構性的：
 * 「同一個 job 帶 secret 又執行 checkout 下來的程式碼」。哪天有人為了方便把 node 腳本搬回
 * 帶 secret 的 job，這裡會紅。只用標準庫（依縮排切 job），不依賴間接安裝的 yaml 套件。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const yml = readFileSync('.github/workflows/migrate.yml', 'utf8');
const code = yml
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

/** `jobs:` 底下兩格縮排的每個 key 切成一塊 */
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
const RUNS_REPO_CODE = /\b(node|npm|npx|bash)\s|tools\//;

test('三個 job 都在（拆開才有邊界）', () => {
  assert.deepEqual(Object.keys(all).sort(), ['apply', 'plan', 'remote']);
});

test('帶 secret 的 job 不執行 repo 的腳本', () => {
  for (const [name, body] of Object.entries(all)) {
    if (!body.includes('secrets.')) continue;
    const runs = body.split('\n').filter((line) => !line.includes('secrets.'));
    assert.equal(
      runs.some((line) => RUNS_REPO_CODE.test(line)),
      false,
      `${name} 帶 secret 又執行 repo 的程式碼`,
    );
  }
});

test('跑 migrate-plan.mjs 的 plan 拿不到 secret（沒有 environment、不讀 secrets）', () => {
  assert.match(all.plan, /migrate-plan\.mjs/);
  assert.doesNotMatch(all.plan, /secrets\./);
  assert.doesNotMatch(all.plan, /environment:/);
});

test('remote 帶 secret，所以不 checkout', () => {
  assert.match(all.remote, /secrets\.SUPABASE_DB_URL/);
  assert.doesNotMatch(all.remote, /actions\/checkout/);
});

test('入口只接本 repo main 上的 push（fork PR 可以把分支取名 main）', () => {
  assert.match(all.remote, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(
    all.remote,
    /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/,
  );
  assert.match(all.remote, /github\.event\.workflow_run\.head_branch == 'main'/);
});

test('apply 在 prod-db（required reviewer）後面', () => {
  assert.match(all.apply, /environment: prod-db\s*$/m);
});

test('永不帶 --include-all', () => {
  assert.doesNotMatch(code, /--include-all/);
});

// ── #968 reviewer 審出的兩個執行洞 ──────────────────────────────────────────────

test('concurrency 只掛在 apply —— 頂層的話中間 commit 的 plan 會被丟，⓪ 找不到截線', () => {
  const topLevel = code.slice(0, code.indexOf('\njobs:\n'));
  assert.doesNotMatch(topLevel, /^concurrency:/m);
  assert.doesNotMatch(all.remote, /concurrency:/);
  assert.doesNotMatch(all.plan, /concurrency:/);
  assert.match(all.apply, /concurrency:\s*\n\s+group: migrate-prod\s*\n\s+cancel-in-progress: false/);
});

test('dispatch（after-deploy）的標題與目標都是 deployed_sha —— ⓪ 用標題找部署截線那顆', () => {
  assert.match(code, /^run-name: .*inputs\.deployed_sha/m);
  assert.match(code, /TARGET_SHA: .*inputs\.deployed_sha/);
  // 標題全字比對，所以只收完整 SHA
  assert.match(all.plan, /\[0-9a-f\]\{40\}/);
});
