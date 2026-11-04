// stop-verify.sh 的「工作樹非空才跑完整閘門」（#2253）：只改 .claude/ 底下（例：db-reset 席刻意保留的
// settings.json）不算 —— 那不是產品碼，改它弄不壞測試；每輪跑全套 affected 只會跟持鎖席搶資源、隨機假紅。
//
// 做法：把真的 stop-verify.sh 放進一個暫存 repo，check-harness.mjs、npx、test-gate.mjs 都換成只留記號的替身，
// 看閘門有沒有被叫到。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'stop-verify-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  mkdirSync(join(root, 'tools/agent-harness/hooks'), { recursive: true });
  copyFileSync(
    join(here, 'hooks/stop-verify.sh'),
    join(root, 'tools/agent-harness/hooks/stop-verify.sh'),
  );
  // 閘門的三段都換成只留記號的替身
  const mark = join(root, 'gate-ran');
  write(
    'tools/agent-harness/check-harness.mjs',
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(mark)}, 'x');`,
  );
  write('tools/agent-harness/test-gate.mjs', '');
  write('bin/npx', '#!/bin/sh\nexit 0\n');
  chmodSync(join(root, 'bin/npx'), 0o755);
  write('.claude/settings.json', '{}\n');
  write('apps/web/a.ts', 'export {};\n');
  write('.gitignore', 'gate-ran\nbin/\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  const run = () => {
    const r = spawnSync('bash', [join(root, 'tools/agent-harness/hooks/stop-verify.sh')], {
      input: '{}',
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        CLESSIA_STOP_GATE: '1',
      },
    });
    return { code: r.status, gateRan: existsSync(mark) };
  };
  return { write, run };
}

test('只改 .claude/settings.json：不跑閘門（#2253）', () => {
  const r = makeRepo();
  r.write('.claude/settings.json', '{"permissions":{}}\n');
  assert.deepEqual(r.run(), { code: 0, gateRan: false });
});

test('.claude/ 底下多一個未追蹤檔：也不跑', () => {
  const r = makeRepo();
  r.write('.claude/settings.local.json', '{}\n');
  assert.deepEqual(r.run(), { code: 0, gateRan: false });
});

test('改了產品檔：照跑（就算 .claude/ 也有改）', () => {
  const r = makeRepo();
  r.write('.claude/settings.json', '{"permissions":{}}\n');
  r.write('apps/web/a.ts', 'export const x = 1;\n');
  assert.deepEqual(r.run(), { code: 0, gateRan: true });
});

test('工作樹乾淨：不跑', () => {
  assert.deepEqual(makeRepo().run(), { code: 0, gateRan: false });
});
