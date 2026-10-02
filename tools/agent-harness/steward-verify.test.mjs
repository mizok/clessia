// steward-merge.sh 的 verify 判定:同一 head 多筆 verify 時取「最新一筆」(#1050)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FILTER = fileURLToPath(new URL('../steward-verify.jq', import.meta.url));

function latest(rollup) {
  return execFileSync('jq', ['-r', '-f', FILTER], {
    input: JSON.stringify({ statusCheckRollup: rollup }),
  })
    .toString()
    .trim();
}

const run = (conclusion, startedAt, name = 'verify') => ({ name, conclusion, startedAt });

test('較舊的 CANCELLED + 較新的 SUCCESS → SUCCESS(#1050 的形狀)', () => {
  assert.equal(
    latest([run('CANCELLED', '2026-10-02T14:21:17Z'), run('SUCCESS', '2026-10-02T14:21:21Z')]),
    'SUCCESS',
  );
});

test('較舊的 SUCCESS + 較新的 CANCELLED → CANCELLED(不能被舊綠燈蓋掉)', () => {
  assert.equal(
    latest([run('SUCCESS', '2026-10-02T14:21:17Z'), run('CANCELLED', '2026-10-02T14:21:21Z')]),
    'CANCELLED',
  );
});

test('陣列順序不影響結果(以 startedAt 為準)', () => {
  assert.equal(
    latest([run('SUCCESS', '2026-10-02T14:21:21Z'), run('CANCELLED', '2026-10-02T14:21:17Z')]),
    'SUCCESS',
  );
});

test('較新的還在跑(沒有 conclusion) → 空字串,不是綠燈', () => {
  assert.equal(
    latest([run('SUCCESS', '2026-10-02T14:00:00Z'), run('', '2026-10-02T14:30:00Z')]),
    '',
  );
});

test('較新的排隊中(連 startedAt 都沒有) → 空字串,舊 SUCCESS 不能蓋掉它', () => {
  assert.equal(latest([run('SUCCESS', '2026-10-02T14:00:00Z'), run('', null)]), '');
});

test('沒有 verify(check 還沒註冊) → 空字串', () => {
  assert.equal(latest([]), '');
  assert.equal(latest([run('SUCCESS', '2026-10-02T14:00:00Z', 'seed-reset')]), '');
});

test('只看名叫 verify 的,別的 check 不影響', () => {
  assert.equal(
    latest([run('SUCCESS', '2026-10-02T14:00:00Z'), run('FAILURE', '2026-10-02T15:00:00Z', 'x')]),
    'SUCCESS',
  );
});
